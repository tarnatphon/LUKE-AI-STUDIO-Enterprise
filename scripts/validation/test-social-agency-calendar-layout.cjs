#!/usr/bin/env node
"use strict";

/**
 * Calendar containment regression: four cross-posts must stay in their day,
 * never paint over next week. CSS contracts cover the sizing/scroll chain;
 * the actual React component is server-rendered to check grouping, ordering,
 * accessibility and that a crowded day loses no entries. No backend or account
 * is involved. Pixel geometry and pointer/keyboard interactions are checked
 * separately in a browser (SSR does not perform layout).
 *
 * Uses the existing frontend React/Vite/PostCSS dependencies, no new packages.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));
const read = (file) => fs.readFileSync(path.join(frontend, "src", file), "utf8");
const css = fromFrontend("postcss").parse(read("social-agency.css"));
const source = read("social-agency/CalendarTab.jsx");

function declarations(selector) {
  const result = {};
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
  });
  assert.ok(Object.keys(result).length, `missing CSS selector ${selector}`);
  return result;
}

function daysOf(markup) {
  return new Map([...markup.matchAll(/<div\b[^>]*\bdata-date="([^"]+)"[^>]*>([\s\S]*?)(?=<div\b[^>]*\bdata-date="|$)/g)]
    .map((match) => [match[1], match[2]]));
}

function entryIds(markup) {
  return [...markup.matchAll(/data-entry-id="([^"]+)"/g)].map((match) => match[1]);
}

async function main() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const { createServer } = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const { createElement } = fromFrontend("react");
  const { renderToStaticMarkup } = fromFrontend("react-dom/server");
  const { currentMonth, monthMatrix } = await import(pathToFileURL(path.join(frontend, "src", "social-agency", "lib.js")).href);
  const server = await createServer({
    root: frontend,
    configFile: false,
    plugins: [react()],
    // There is no client page here; do not start an asynchronous index.html scan
    // that could outlive the SSR assertions or compete with another dev server.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    logLevel: "error",
  });

  try {
    const { default: CalendarTab } = await server.ssrLoadModule("/src/social-agency/CalendarTab.jsx");
    const month = currentMonth();
    const day = `${month}-20`;
    const nextDay = `${month}-21`;
    const platforms = ["line", "instagram", "demo", "facebook"];
    const times = ["10:00", "12:30", "15:00", "18:30"];
    const entries = times.map((time, i) => ({
      id: `cross-post-${i}`, date: day, time, platform: platforms[i],
      productName: "ชื่อสินค้าภาษาไทยที่ยาวมากไว้ทดสอบการตัดข้อความ", sku: "SKU-01",
      angle: "เปิดตัวสินค้า", pillar: "ขายตรง", status: i === 0 ? "published" : "planned",
      caption: "ตัวอย่างพรีวิว", tags: ["concept", "pencil case", "แบนเนอร์", "campaign"],
    }));
    const render = (calendar) => renderToStaticMarkup(createElement(CalendarTab, {
      activeClient: { id: "test-client", calendar, products: [] },
      onDeleteEntry() {}, onOpenEntry() {}, onReschedule() {},
    }));
    const input = [...entries].reverse();
    const before = JSON.stringify(input);
    const markup = render(input);
    const days = daysOf(markup);

    test("weekday header and month share the same seven columns and horizontal scroller", () => {
      for (const selector of [".sa-grid-head", ".sa-grid-body"]) {
        const rule = declarations(selector);
        assert.equal(rule["grid-template-columns"], "repeat(7, minmax(0, 1fr))");
        assert.equal(rule["min-width"], "var(--sa-calendar-min-width)");
        assert.equal(rule.width, "100%");
      }
      assert.equal(declarations(".sa-grid").overflow, "auto");
      assert.equal(declarations(".sa-grid-body").overflow, undefined, "the body must not scroll separately from the header");
      assert.equal(declarations(".sa-grid-head").position, "sticky");
      assert.equal(declarations(".sa-grid-head").top, "0");
    });

    test("day rows have room for four cards rather than squeezing them into 96px", () => {
      const calendar = declarations(".sa-calendar");
      assert.ok(parseInt(calendar["--sa-calendar-day-height"], 10) >= 300);
      assert.ok(parseInt(calendar["--sa-calendar-min-width"], 10) >= 7 * 120);
      assert.equal(declarations(".sa-grid-body")["grid-auto-rows"], "var(--sa-calendar-day-height)");
      const dayRule = declarations(".sa-day");
      assert.equal(dayRule["min-height"], "0");
      assert.equal(dayRule["min-width"], "0");
      assert.equal(dayRule.overflow, "hidden");
      assert.equal(declarations(".sa-day-head").flex, "none");
    });

    test("only the list inside a crowded day scrolls; cards never shrink into each other", () => {
      const list = declarations(".sa-day-chips");
      assert.equal(list.flex, "1");
      assert.equal(list["min-height"], "0");
      assert.equal(list["overflow-y"], "auto");
      assert.equal(list["overflow-x"], "hidden");
      assert.equal(list["overscroll-behavior-y"], "contain");
      assert.equal(declarations(".sa-chip").flex, "none");
      assert.equal(declarations(".sa-chip").overflow, "hidden");
    });

    test("long product names and tags stay within the card without stretching columns", () => {
      assert.equal(declarations(".sa-chip-open")["min-width"], "0");
      const title = declarations(".sa-chip-title");
      assert.equal(title["text-overflow"], "ellipsis");
      assert.equal(title["white-space"], "nowrap");
      assert.equal(title.overflow, "hidden");
      assert.equal(declarations(".sa-chip-tags")["flex-wrap"], "nowrap");
      assert.equal(declarations(".sa-chip-tags").overflow, "hidden");
      assert.match(markup, /class="sa-chip-title">ชื่อสินค้าภาษาไทย/);
      assert.match(markup, /ป้าย: concept, pencil case, แบนเนอร์, campaign/);
    });

    test("all four cross-posts belong to the correct date, in time order", () => {
      assert.deepEqual(entryIds(days.get(day)), entries.map((e) => e.id));
      assert.deepEqual(entryIds(days.get(nextDay)), []);
      assert.match(days.get(day), /class="sa-day-count"[^>]*>4 โพสต์/);
      for (const time of times) assert.ok(days.get(day).includes(`class="sa-chip-time">${time}</span>`));
      assert.equal(JSON.stringify(input), before, "rendering must not mutate the client's calendar");
    });

    test("a crowded day retains every post, including the ones reached by scrolling", () => {
      const crowded = Array.from({ length: 24 }, (_, i) => ({
        ...entries[0], id: `busy-${i}`, time: `${String(i).padStart(2, "0")}:00`,
      }));
      const neighbor = { ...entries[1], id: "neighbor", date: nextDay };
      const result = daysOf(render([...crowded].reverse().concat(neighbor)));
      assert.deepEqual(entryIds(result.get(day)), crowded.map((e) => e.id));
      assert.deepEqual(entryIds(result.get(nextDay)), ["neighbor"]);
      assert.match(result.get(day), /class="sa-day-count"[^>]*>↕ 24 โพสต์/);
      assert.match(result.get(day), /class="sa-day-chips"[^>]*tabindex="0"/);
    });

    test("month padding stays empty and is never shown as an active drop target", () => {
      const expectedDates = monthMatrix(month).flat().filter(Boolean);
      assert.deepEqual([...days.keys()], expectedDates);
      assert.doesNotMatch(markup, /class="sa-day empty[^"]*dragover/);
      for (const [value, count] of [["2027-02", 4], ["2026-02", 5], ["2026-03", 6]]) {
        const weeks = monthMatrix(value);
        assert.equal(weeks.length, count);
        assert.ok(weeks.every((week) => week.length === 7));
        assert.equal(weeks.flat().filter(Boolean).length, new Date(Number(value.slice(0, 4)), Number(value.slice(5)), 0).getDate());
      }
    });

    test("open and delete are separate native keyboard buttons, never nested", () => {
      let depth = 0;
      for (const match of markup.matchAll(/<\/?button\b[^>]*>/g)) {
        depth += match[0].startsWith("</") ? -1 : 1;
        assert.ok(depth >= 0 && depth <= 1, "a button is nested inside another button");
      }
      assert.equal(depth, 0);
      assert.equal((markup.match(/class="sa-chip-open"/g) || []).length, 4);
      assert.equal((markup.match(/class="sa-chip-del"/g) || []).length, 4);
      assert.match(markup, /aria-label="เปิดโพสต์ 10:00 · LINE · เผยแพร่แล้ว/);
      assert.match(markup, /aria-label="ลบโพสต์ 10:00 · LINE/);
      assert.match(markup, /class="sa-grid" role="region"[^>]*tabindex="0"/);
      assert.match(source, /aria-pressed=\{selectMode \? selected : undefined\}/);
    });

    test("a missing product name still has a readable title and the preview eye survives", () => {
      const result = render([{ ...entries[0], productName: "" }]);
      assert.match(result, /class="sa-chip-title">เปิดตัวสินค้า<\/span>/);
      assert.match(result, /class="sa-chip-eye" aria-hidden="true"/);
      assert.match(result, /class="sa-tag mini more">\+1<\/span>/);
    });

    test("running entries cannot drag, while ordinary posts keep the existing reschedule contract", () => {
      const running = render([{ ...entries[0], inFlight: true }]);
      assert.match(running, /data-entry-id="cross-post-0" draggable="false"/);
      assert.match(markup, /data-entry-id="cross-post-0" draggable="true"/);
      assert.match(source, /setData\("text\/sa-entry", entry\.id\)/);
      assert.match(source, /onReschedule\(entryId, date, null\)/);
      assert.match(source, /onDelete\(entry\.id\)/);
      assert.match(source, /onToggle\(entry\.id\)/);
    });

    for (const [name, fn] of tests) {
      await fn();
      console.log(`  ok - ${name}`);
    }
    console.log(`PASS: ${tests.length} Social Agency calendar layout checks`);
  } finally {
    await server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
