#!/usr/bin/env node
"use strict";

/**
 * Calendar + Workflow (Social Agency) — the layout an operator actually works in.
 *
 * Two pages were doing too much talking at once:
 *
 *   Calendar: one wrapping toolbar carried five checkbox groups, two switches,
 *   a legend, a time zone and the primary action, so the month started halfway
 *   down the screen and the same information appeared twice (legend + chips).
 *   The status summary is now the legend and the status filter; the planner and
 *   the filter row fold away and state their active choices on one line.
 *
 *   Workflow: ten 208px node cards sat on one horizontal conveyor, so the last
 *   steps of a run were always off screen, and every run row wrapped its
 *   "show on canvas"/"open post" links in a second role=button inside the row
 *   button. The canvas is a wrapping grid, a step rail lists the whole run, and
 *   each action is its own button.
 *
 * The checks below pin the parts that make those changes true. Nothing here
 * touches a backend, an account or a real calendar: the components are
 * server-rendered with hand-made data and the stylesheet is read for contracts
 * that SSR cannot observe (hover, grid geometry).
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
const calendarSource = read("social-agency/CalendarTab.jsx");
const workflowSource = read("social-agency/WorkflowTab.jsx");

// Only the rules that live at the top level of the sheet: a declaration inside
// @media (hover: none) must not look like the resting state of a control.
function declarations(selector) {
  const result = {};
  css.walkRules((rule) => {
    if (rule.parent.type !== "root") return;
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
  });
  assert.ok(Object.keys(result).length, `missing top-level CSS selector ${selector}`);
  return result;
}

function ruleText(selector) {
  let found = null;
  css.walkRules((rule) => {
    if (rule.selectors.includes(selector)) found = rule.toString();
  });
  assert.ok(found, `missing CSS rule ${selector}`);
  return found;
}

function buttonDepth(markup) {
  let depth = 0;
  let deepest = 0;
  for (const match of markup.matchAll(/<\/?button\b[^>]*>/g)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    deepest = Math.max(deepest, depth);
    assert.ok(depth >= 0, "a button closes without being opened");
  }
  assert.equal(depth, 0, "a button is left open");
  return deepest;
}

const NODE_DEFS = [
  ["schedule", "ตั้งเวลา"], ["research", "วิจัย"], ["brief", "ร่าง Brief"], ["create", "เขียนคอนเทนต์"],
  ["check", "AI Check"], ["autofix", "แก้อัตโนมัติ"], ["score", "คะแนนไวรัล"], ["gate", "ประตูอนุมัติ"],
  ["publish", "เผยแพร่"], ["result", "ผลลัพธ์"],
];

function makeRun(overrides = {}) {
  return {
    id: "run-1",
    entryId: "entry-1",
    label: "โพสต์ทดสอบ",
    trigger: "manual",
    status: "needs_review",
    startedAt: "2026-10-20T03:00:00.000Z",
    finishedAt: "2026-10-20T03:00:45.000Z",
    durationMs: 45000,
    nodes: NODE_DEFS.map(([key], i) => ({
      key,
      status: i < 5 ? "done" : i === 5 ? "waiting" : "idle",
      durationMs: i < 5 ? 100 * (i + 1) : 0,
      output: i < 5 ? `ผลของขั้น ${i + 1}` : "",
      detail: "",
    })),
    check: { score: 48, verdict: "review", issues: ["อ้างราคาที่ไม่มีในหลักฐาน"] },
    gate: { decision: "review", reason: "score 48 ต่ำกว่าเกณฑ์ 80" },
    publish: null,
    ...overrides,
  };
}

function makeClient(overrides = {}) {
  const run = makeRun();
  return {
    id: "client-1",
    name: "ลูกค้าทดสอบ",
    products: [],
    pillars: [],
    contentAngles: [],
    planAngles: [],
    researcherRoles: [{ id: "role-1", name: "นักวิจัยตลาด", questions: ["คู่แข่งพูดอะไรบ้าง"], builtIn: true }],
    calendar: [
      {
        id: "entry-1", date: "2026-10-20", time: "10:00", platform: "facebook",
        productName: "กระเป๋าหนังแท้ รุ่นทดสอบ", sku: "SKU-01", angle: "เปิดตัวสินค้า", pillar: "ขายตรง",
        status: "needs_review", caption: "แคปชันตัวอย่าง", tags: ["concept"],
      },
    ],
    workflowRuns: [run],
    ...overrides,
  };
}

async function main() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);

  // Both components pull in the shared CommonJS copy helper through drawers.jsx.
  // Vite's dev SSR loader cannot evaluate that file, so the pair is bundled with
  // Vite's own SSR build (which converts CommonJS) and rendered with the same
  // React the app uses — the same route the LINE preview check takes.
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const os = require("node:os");
  // Inside the frontend's node_modules so the bundler resolves the same React copy.
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-calendar-workflow-"));
  const entry = path.join(work, "entry.jsx");
  const component = (name) => path.join(frontend, "src", "social-agency", `${name}.jsx`);
  fs.writeFileSync(entry, [
    `export { default as CalendarTab } from ${JSON.stringify(component("CalendarTab"))};`,
    `export { default as WorkflowTab } from ${JSON.stringify(component("WorkflowTab"))};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));
  await vite.build({
    root: frontend,
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    build: {
      ssr: entry,
      outDir: path.join(work, "out"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "ui.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const { CalendarTab, WorkflowTab, createElement, renderToStaticMarkup } = require(path.join(work, "out", "ui.cjs"));
  const { NODE_KEYS } = await import(pathToFileURL(path.join(frontend, "src", "social-agency", "lib.js")).href);

  try {
    const renderCalendar = (client, extra = {}) => renderToStaticMarkup(createElement(CalendarTab, {
      activeClient: client,
      onOpenEntry() {}, onReschedule() {}, onDeleteEntry() {}, onDeleteEntriesBatch() {},
      ...extra,
    }));
    const renderWorkflow = (client, extra = {}) => renderToStaticMarkup(createElement(WorkflowTab, {
      activeClient: client,
      selectedEntryId: client.calendar[0]?.id,
      onSelectEntry() {}, onOpenEntry() {}, onSaveRoles() {},
      onRunNow() {}, onApprove() {}, onReject() {},
      ...extra,
    }));

    const client = makeClient();
    const calendarMarkup = renderCalendar(client);
    const workflowMarkup = renderWorkflow(client);

    // ── calendar ────────────────────────────────────────────────────────────

    test("the month header states the month at a glance and folds the rest away", () => {
      assert.match(calendarSource, /<div className="sa-calendar-summary"[^>]*aria-label="สรุปสถานะโพสต์ในเดือนนี้">/);
      assert.match(calendarMarkup, /class="sa-summary-chip active"[^>]*><b>1<\/b> โพสต์/);
      assert.match(calendarMarkup, /class="sa-summary-chip needs-review"/);
      assert.match(calendarMarkup, /รออนุมัติ<b>1<\/b>/);
      // Planner and filters are closed on arrival, so one row of controls sits
      // above the month instead of three.
      assert.match(calendarSource, /const \[plannerOpen, setPlannerOpen\] = useState\(false\)/);
      assert.match(calendarSource, /aria-expanded=\{plannerOpen\}/);
      assert.match(calendarMarkup, /class="sa-planner-toggle"/);
      assert.doesNotMatch(calendarMarkup, /<select/, "no filter dropdown is rendered until the filter row is opened");
      assert.match(calendarSource, /aria-expanded=\{filtersOpen\}/);
    });

    test("the folded planner still says what it will do", () => {
      assert.match(calendarSource, /const summaryText = \[/);
      assert.match(calendarSource, /PLATFORM_META\[p\]\.label/);
      assert.match(calendarSource, /onePerDay \? "ทุกวัน" : "เฉพาะวันที่ว่าง"/);
      assert.match(calendarSource, /planAngles\.size \? `\$\{planAngles\.size\} มุม` : "ทุกมุม"/);
      assert.match(calendarSource, /replacePlanned \? "แทนที่แผนเดิม" : ""/);
      assert.match(calendarMarkup, /class="sa-planner-summary">Facebook · Instagram · LINE · เว็บ \(Demo\) · ทุกวัน · ทุกมุม/);
    });

    test("filters keep the grid honest when they are folded out of sight", () => {
      assert.match(calendarSource, /const activeFilterCount = \[/);
      assert.match(calendarSource, /className=\{`sa-filter-toggle\$\{filtersOpen \|\| filtering \? " on" : ""\}`\}/);
      assert.match(calendarSource, /\(filtersOpen \|\| filtering\) && \(/);
      assert.match(calendarSource, /<span className="sa-filter-count">\{activeFilterCount\}<\/span>/);
      const toggle = declarations(".sa-filter-toggle");
      assert.equal(toggle.display, "inline-flex");
      assert.match(ruleText(".sa-filter-toggle.on"), /border-color: var\(--sa-primary\)/);
    });

    test("the status summary doubles as the legend and the status filter", () => {
      assert.match(calendarSource, /setStatusFilter\(statusFilter === s \? "all" : s\)/);
      assert.match(calendarSource, /aria-pressed=\{statusFilter === s\}/);
      assert.match(calendarSource, /<span className=\{`sa-legend-dot \$\{STATUS_META\[s\]\.cls\}`\} \/>/);
      const active = declarations(".sa-summary-chip.active");
      assert.equal(active["border-color"], "var(--sa-primary)");
      // The old standalone legend row is gone: one place explains the colours.
      assert.doesNotMatch(calendarSource, /className="sa-legend"/);
    });

    test("a card names the angle/pillar once and never repeats its own title", () => {
      assert.match(calendarSource, /const context = \[entry\.angle && entry\.angle !== productTitle \? entry\.angle : "", entry\.pillar \|\| ""\]/);
      assert.match(calendarMarkup, /class="sa-chip-context">เปิดตัวสินค้า · ขายตรง</);
      const noProduct = renderCalendar(makeClient({
        calendar: [{
          id: "entry-2", date: "2026-10-20", time: "09:00", platform: "line", productName: "",
          angle: "เปิดตัวสินค้า", pillar: "ขายตรง", status: "planned",
        }],
      }));
      assert.match(noProduct, /class="sa-chip-title">เปิดตัวสินค้า<\/span>/);
      assert.match(noProduct, /class="sa-chip-context">ขายตรง</);
    });

    test("delete never covers the time and platform line", () => {
      const del = declarations(".sa-chip-del");
      assert.equal(del.position, "absolute");
      assert.equal(del.top, "2px");
      assert.equal(del.opacity, "0");
      assert.match(ruleText(".sa-chip:hover .sa-chip-del"), /opacity: 1/);
      assert.equal(declarations(".sa-chip-meta")["padding-right"], "16px");
      assert.match(ruleText(".sa-day:focus-within .sa-day-add"), /opacity: 1/);
      // Touch devices have no hover, so the affordance has to stay visible.
      const touch = [...css.nodes].find(
        (node) => node.type === "atrule" && node.name === "media" && /hover: none/.test(node.params)
      );
      assert.ok(touch, "missing the hover:none media query");
      assert.match(touch.toString(), /\.sa-chip-del \{ opacity: 1; \}/);
    });

    test("adding a post and asking why planning is blocked are one click away", () => {
      assert.match(calendarSource, /onClick=\{\(\) => setNewEntryDate\(today\)\}/);
      assert.match(calendarSource, /const noProducts = !\(activeClient\?\.products \|\| \[\]\)\.length/);
      assert.match(calendarSource, /const planBlockedReason = noProducts/);
      assert.match(calendarMarkup, /เพิ่มสินค้าอย่างน้อย 1 ชิ้น/);
      assert.match(calendarMarkup, /class="sa-btn ghost sm"[^>]*title="เพิ่มโพสต์ในวันนี้/);
    });

    test("today can be found again from any month", () => {
      assert.match(calendarSource, /setMonth\(currentMonth\(\)\); setWantToday\(true\)/);
      assert.match(calendarSource, /querySelector\?\.\(`\.sa-day\[data-date="\$\{today\}"\]`\)/);
      assert.match(calendarMarkup, /aria-label="เดือนก่อน"/);
      assert.match(calendarMarkup, /class="sa-day-num today"/);
      assert.match(calendarMarkup, /class="sa-day-today-label">วันนี้/);
    });

    // ── workflow ────────────────────────────────────────────────────────────

    test("all ten steps are on screen at once instead of one long conveyor", () => {
      const canvas = declarations(".sa-canvas");
      assert.equal(canvas.display, "grid");
      assert.match(canvas["grid-template-columns"], /^repeat\(auto-fit, minmax\(\d+px, 1fr\)\)$/);
      assert.equal(canvas["min-width"], undefined, "the canvas must not force a horizontal min-width");
      const steps = [...workflowMarkup.matchAll(/class="sa-node-step">(\d+)</g)].map((m) => Number(m[1]));
      assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      assert.equal((workflowMarkup.match(/class="sa-node /g) || []).length, 10);
      // Reading order still follows the workflow itself.
      const nodes = [...workflowMarkup.matchAll(/class="sa-node-title"><b>([^<]+)<\/b>/g)].map((m) => m[1]);
      assert.deepEqual(nodes, NODE_DEFS.map(([, label]) => label));
      assert.deepEqual(NODE_KEYS, NODE_DEFS.map(([key]) => key));
    });

    test("the step rail mirrors the run and opens the same detail as the card", () => {
      assert.match(workflowSource, /<ol className="sa-wf-stepper" aria-label="ลำดับขั้นตอนของ workflow">/);
      const rail = [...workflowMarkup.matchAll(/class="sa-step-num">(\d+)</g)].map((m) => Number(m[1]));
      assert.deepEqual(rail, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      assert.equal((workflowMarkup.match(/class="sa-step /g) || []).length, 10);
      assert.match(workflowSource, /onClick=\{\(\) => setNodeDetail\(node\)\}/);
      assert.match(workflowSource, /aria-current=\{node\.status === "running" \? "step" : undefined\}/);
      assert.match(workflowMarkup, /class="sa-step done"/);
      assert.match(workflowMarkup, /class="sa-step waiting"/);
      const stepper = declarations(".sa-wf-stepper");
      assert.equal(stepper.display, "grid");
      assert.match(stepper["grid-template-columns"], /repeat\(auto-fit, minmax\(\d+px, 1fr\)\)/);
    });

    test("every workflow action is its own button — nothing is nested", () => {
      assert.equal(buttonDepth(workflowMarkup), 1);
      assert.match(workflowSource, /className="sa-run-toggle"/);
      assert.match(workflowSource, /className="sa-run-action"/);
      assert.doesNotMatch(workflowSource, /role="button"/, "links inside a row button were replaced by real buttons");
      assert.equal((workflowMarkup.match(/class="sa-run-toggle"/g) || []).length, 1);
      // The run on the canvas needs only "open post"; an older run also offers
      // "show on canvas", and each one is its own button.
      assert.equal((workflowMarkup.match(/class="sa-run-action"/g) || []).length, 1);
      const twoRuns = renderWorkflow(makeClient({
        workflowRuns: [makeRun(), makeRun({ id: "run-0", status: "success", startedAt: "2026-10-19T03:00:00.000Z" })],
      }));
      assert.equal((twoRuns.match(/class="sa-run-toggle"/g) || []).length, 2);
      assert.equal((twoRuns.match(/class="sa-run-action"/g) || []).length, 3);
      assert.match(twoRuns, /แสดงการรันครั้งนี้บนผังด้านบน/);
    });

    test("the header carries the post facts, the run controls and the report", () => {
      assert.match(workflowMarkup, /class="sa-wf-entry-facts"/);
      assert.match(workflowMarkup, /2026-10-20 · 10:00/);
      assert.match(workflowMarkup, /class="sa-platform-chip facebook">Facebook</);
      assert.match(workflowMarkup, /class="sa-pill needs-review">รออนุมัติ</);
      assert.match(workflowMarkup, /กระเป๋าหนังแท้ รุ่นทดสอบ/);
      assert.match(workflowMarkup, /AI 48/);
      assert.match(workflowMarkup, /รันเลยตอนนี้/);
      assert.match(workflowMarkup, /class="sa-btn ghost sm"[^>]*title="เปิดรายละเอียดและพรีวิวโพสต์นี้"/);
      assert.match(workflowMarkup, /รายงาน/);
    });

    test("approval, progress and the gate note stay in one place", () => {
      assert.match(workflowMarkup, /อนุมัติ &amp; เผยแพร่/);
      assert.match(workflowMarkup, /class="sa-btn ghost sm danger"/);
      assert.match(workflowMarkup, /class="sa-wf-gate-note"/);
      assert.match(workflowMarkup, /score 48 ต่ำกว่าเกณฑ์ 80/);
      assert.match(workflowMarkup, /role="progressbar"/);
      assert.match(workflowMarkup, /aria-valuenow="6"/);
      assert.match(workflowMarkup, /6\/10 ขั้น/);
    });

    test("an older run is labelled and can be dropped back to the latest", () => {
      assert.match(workflowSource, /const viewingOlderRun = Boolean\(run && latestRun && run\.id !== latestRun\.id\)/);
      assert.match(workflowSource, /onClick=\{\(\) => setCanvasRunId\(null\)\}/);
      assert.match(workflowSource, /ดูรันล่าสุด/);
    });

    test("empty states point at the next useful step", () => {
      const noEntries = renderWorkflow(makeClient({ calendar: [], workflowRuns: [] }), {
        onOpenCalendar() {},
      });
      assert.match(noEntries, /ยังไม่มีโพสต์ในปฏิทิน/);
      assert.match(noEntries, /ไปวางแผนที่ปฏิทิน/);
      assert.doesNotMatch(noEntries, /รันเลยตอนนี้/, "there is nothing to run yet");

      const notRun = renderWorkflow(makeClient({ workflowRuns: [] }));
      assert.match(notRun, /โพสต์นี้ยังไม่เคยรัน/);
      assert.match(notRun, /รันเลยตอนนี้/);
      assert.match(notRun, /ยังไม่มีประวัติ/);
    });

    test("run history filters keep their labels and offer a way back", () => {
      assert.match(workflowSource, /const RUN_FILTERS = \[/);
      assert.match(workflowMarkup, /class="sa-wf-filter-chip active">ทั้งหมด</);
      assert.match(workflowMarkup, /1\/1 ครั้ง/);
      assert.match(workflowSource, /onClick=\{\(\) => setHistoryFilter\("all"\)\}/);
      assert.match(workflowSource, /ไม่มีรันที่ตรงตัวกรอง/);
    });

    for (const [name, fn] of tests) {
      await fn();
      console.log(`  ok - ${name}`);
    }
    console.log(`PASS: ${tests.length} Social Agency calendar/workflow UI checks`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
