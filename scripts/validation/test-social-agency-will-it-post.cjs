#!/usr/bin/env node
"use strict";

/**
 * Social Agency — “โพสต์นี้จะขึ้นเองไหม”
 *
 * The calendar cell, the post page and the approval queue all looked the same
 * whether a post was going to publish itself or not: a planned post whose
 * scheduler was stopped, whose connector was still on dry-run, whose image gate
 * had never been reviewed, or which was already more than two hours late all
 * showed "วางแผนไว้" and nothing else. Waiting for one of those is the whole bug.
 *
 * This suite pins the single answer (`postOutlook`), the two derived lists the
 * app now shows without being asked (`pendingApprovals`, `missedPosts`), the
 * scheduler's own health, and the places that display them (rendered for real
 * through the app's own Vite build):
 *
 *   - calendar chip carries the verdict and the reason in its title;
 *   - the post page states it before the operator waits;
 *   - the app raises a card when a post is 5+ minutes past due and unapproved,
 *     with the approve button, and for a missed post with "ส่งเลยตอนนี้";
 *   - the scheduler card says whether the loop is alive, not just whether a
 *     timer object exists;
 *   - the server can actually send a missed post now (sendMissedNow + route).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

// Fixed clock for the pure rules: 2026-10-30 10:00 Bangkok.
const NOW = Date.parse("2026-10-30T03:00:00Z");

function clientFixture(overrides = {}) {
  return {
    id: "c1",
    name: "ทดสอบร้านค้า",
    industry: "ของใช้",
    tone: "เจ้าของแบรนด์",
    products: [{ sku: "A-1", name: "แก้วเซรามิก A-1", imageSubject: "ceramic mug", image: "/sa-products/c1/A-1.jpg" }],
    connectors: {
      linkedin: { dryRun: false, testedAt: "2026-10-20T00:00:00.000Z", testOk: true },
      facebook: { dryRun: true, testedAt: "2026-10-20T00:00:00.000Z", testOk: true },
      instagram: { dryRun: true },
      demo: { dryRun: false, testOk: true },
    },
    settings: { threshold: 80, viralThreshold: 60 },
    calendar: [],
    workflowRuns: [],
    ...overrides,
  };
}

function entryFixture(overrides = {}) {
  return {
    id: "cal-a",
    date: "2026-10-30",
    time: "11:00",
    platform: "linkedin",
    sku: "A-1",
    productName: "แก้วเซรามิก A-1",
    angle: "เปิดตัวสินค้า",
    status: "planned",
    ...overrides,
  };
}

const IMAGE = { path: path.join(root, "app", "outputs", "sa-products", "c1", "A-1.jpg"), publicUrl: "" };

function schedulerFixture(nowMs, overrides = {}) {
  return {
    running: true,
    stale: false,
    lastTickAt: new Date(nowMs - 30 * 1000).toISOString(),
    startedAt: new Date(nowMs - 3600 * 1000).toISOString(),
    tickMs: 60000,
    staleAfterMs: 180000,
    activeCount: 0,
    nextPostAt: new Date(nowMs + 3600 * 1000).toISOString(),
    nextPostLabel: "ทดสอบร้านค้า · แก้วเซรามิก A-1 · 2026-10-30 11:00",
    overdueApprovals: [],
    timezone: "Asia/Bangkok",
    serverNow: new Date(nowMs).toISOString(),
    ...overrides,
  };
}

async function main() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const lib = await import(pathToFileURL(path.join(frontend, "src", "social-agency", "lib.js")).href);
  const { postOutlook, pendingApprovals, missedPosts, schedulerHealth } = lib;

  // ── the single answer ─────────────────────────────────────────────────────

  test("วางแผนไว้ + ตัวตั้งเวลาเดิน + dry-run ปิด + ยังไม่ถึงเวลา → “จะขึ้นเอง” พร้อมเงื่อนไขที่เหลือ", () => {
    const outlook = postOutlook(entryFixture(), clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "auto");
    assert.strictEqual(outlook.tone, "ok");
    assert.match(outlook.short, /ขึ้นเอง/);
    assert.match(outlook.title, /11:00/);
    // “จะขึ้นเอง” must not hide the two gates that still run at that moment.
    assert.match(outlook.detail, /AI Check ≥ 80/);
    assert.match(outlook.detail, /ด่านตรวจภาพ/);
  });

  test("ตัวตั้งเวลาหยุดอยู่ → บอกว่าไม่ขึ้นเอง และชี้ที่ปุ่ม ▶ (ไม่ปล่อยให้รอเปล่า)", () => {
    const outlook = postOutlook(entryFixture(), clientFixture(), schedulerFixture(NOW, { running: false }), NOW);
    assert.strictEqual(outlook.key, "scheduler_off");
    assert.strictEqual(outlook.tone, "warn");
    assert.match(outlook.title, /ไม่ขึ้นเอง/);
    assert.match(outlook.detail, /ตัวตั้งเวลาหยุดอยู่/);
    assert.match(outlook.detail, /▶/);
    assert.deepStrictEqual(outlook.actions, ["start-scheduler"]);
  });

  test("ตัวตั้งเวลาเดินแต่ tick ล่าสุดนานเกิน 3 นาที → เตือนว่าอาจค้าง (ไม่ใช่เขียวหลอก)", () => {
    const stale = schedulerFixture(NOW, { lastTickAt: new Date(NOW - 10 * 60 * 1000).toISOString() });
    const outlook = postOutlook(entryFixture(), clientFixture(), stale, NOW);
    assert.strictEqual(outlook.key, "scheduler_stale");
    assert.match(outlook.detail, /นานเกิน 3 นาที/);
  });

  test("dry-run เปิดอยู่ → “จะไม่ขึ้นบนเครือข่ายจริง” ถึงแม้เวลาจะมาถึง", () => {
    const outlook = postOutlook(entryFixture({ platform: "facebook" }), clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "dry_run");
    assert.match(outlook.short, /ไม่ขึ้นจริง/);
    assert.match(outlook.detail, /dry-run/);
    assert.match(outlook.detail, /Connectors/);
  });

  test("ด่านตรวจภาพยังไม่ผ่าน → บอกว่าติดด่านภาพ ไม่ใช่ \"รอเวลา\"", () => {
    const entry = entryFixture({
      image: IMAGE,
      imageGate: { required: true, ok: false, status: "unreviewed", reason: "ยังไม่ได้ตรวจภาพในหน้าโพสต์" },
    });
    const outlook = postOutlook(entry, clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "gated");
    assert.match(outlook.detail, /ยังไม่ได้ตรวจภาพในหน้าโพสต์/);
    assert.deepStrictEqual(outlook.actions, ["review-image", "approve"]);
  });

  test("รออนุมัติ → ไม่ขึ้นเองจนกว่าจะอนุมัติ และบอกว่าเลยมากี่นาที + จะส่งจริงหรือ dry-run", () => {
    const entry = entryFixture({ status: "needs_review", time: "09:00" });
    const outlook = postOutlook(entry, clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "needs_approval");
    assert.match(outlook.title, /รออนุมัติ/);
    assert.match(outlook.detail, /ผ่านมา 1 ชม\./);
    assert.match(outlook.detail, /ส่งจริงทันที/, "linkedin dry-run is off");
    const dry = postOutlook({ ...entry, platform: "facebook" }, clientFixture(), schedulerFixture(NOW), NOW);
    assert.match(dry.detail, /dry-run/);
  });

  test("พลาดโพสต์ → บอกว่าไม่มีใครส่งแล้ว และมีทางออก “ส่งเลยตอนนี้”", () => {
    const outlook = postOutlook(entryFixture({ status: "missed", time: "07:00", missedAt: "2026-10-30T00:10:00.000Z" }), clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "missed");
    assert.strictEqual(outlook.tone, "bad");
    assert.match(outlook.detail, /ส่งเลยตอนนี้/);
    assert.ok(outlook.actions.includes("send-now"));
  });

  test("เลยเวลาแต่ยังอยู่ใน 2 ชั่วโมง → จะรันช้า (tick ถัดไป) ไม่ใช่ \"หาย\"", () => {
    const outlook = postOutlook(entryFixture({ time: "09:30" }), clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "late");
    assert.match(outlook.detail, /เลยมา 30 นาที/);
  });

  test("เลยกำหนดเกิน 2 ชั่วโมงแต่ยังเป็น planned → บอกว่า tick ถัดไปจะตีเป็นพลาดโพสต์", () => {
    const outlook = postOutlook(entryFixture({ time: "05:00" }), clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "missed_soon");
    assert.match(outlook.title, /พลาดโพสต์/);
  });

  test("TikTok ที่ยังไม่ยินยอม → ไม่ขึ้นเองโดยเจตนา", () => {
    const outlook = postOutlook(entryFixture({ platform: "tiktok" }), clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "tiktok_consent");
    assert.match(outlook.detail, /ยินยอม/);
  });

  test("เผยแพร่แล้ว → จบ ไม่ต้องทำอะไร (และไม่ขึ้น badge ซ้ำในปฏิทิน)", () => {
    const outlook = postOutlook(entryFixture({ status: "published", publishMode: "live", publishedAt: "2026-10-30T01:00:00.000Z" }), clientFixture(), schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "published");
    assert.strictEqual(outlook.tone, "ok");
  });

  test("ปิด dry-run แต่ยังไม่เคยทดสอบการเชื่อมต่อ → พูดตรง ๆ ว่า token อาจไม่มี", () => {
    const client = clientFixture({ connectors: { linkedin: { dryRun: false } } });
    const outlook = postOutlook(entryFixture(), client, schedulerFixture(NOW), NOW);
    assert.strictEqual(outlook.key, "auto");
    assert.match(outlook.detail, /ยังไม่เคยกดทดสอบ/);
  });

  // ── derived lists the app raises by itself ───────────────────────────────

  test("คิวที่เลยมา 5 นาทีขึ้นไป → ต้องขึ้นการ์ด และตัดรายการที่เพิ่งเลย 2 นาทีออก", () => {
    const client = clientFixture({
      calendar: [
        entryFixture({ id: "late-1h", status: "needs_review", time: "09:00" }),
        entryFixture({ id: "late-2m", status: "needs_review", time: "09:58" }),
        entryFixture({ id: "future", status: "needs_review", time: "12:00" }),
        entryFixture({ id: "planned", status: "planned", time: "09:00" }),
      ],
    });
    const list = pendingApprovals(client, schedulerFixture(NOW), NOW);
    assert.deepStrictEqual(list.map((i) => i.entry.id), ["late-1h"]);
    assert.strictEqual(list[0].minutesLate, 60);
    assert.strictEqual(list[0].outlook.key, "needs_approval");
  });

  test("การ์ดหลายใบเรียงจากที่เลยมานานสุดก่อน", () => {
    const client = clientFixture({
      calendar: [
        entryFixture({ id: "b", status: "needs_review", time: "09:00" }),
        entryFixture({ id: "a", status: "needs_review", time: "06:00" }),
      ],
    });
    const list = pendingApprovals(client, schedulerFixture(NOW), NOW);
    assert.deepStrictEqual(list.map((i) => i.entry.id), ["a", "b"]);
  });

  test("missedPosts เอาไว้รายงาน ไม่ปนกับคิวอนุมัติ", () => {
    const client = clientFixture({
      calendar: [
        entryFixture({ id: "m1", status: "missed" }),
        entryFixture({ id: "nr", status: "needs_review" }),
      ],
    });
    assert.deepStrictEqual(missedPosts(client).map((e) => e.id), ["m1"]);
  });

  // ── scheduler health ─────────────────────────────────────────────────────

  test("schedulerHealth: เดินอยู่ / หยุด / ค้าง / ไม่รู้ — คนละคำตอบ", () => {
    const on = schedulerHealth(schedulerFixture(NOW), NOW);
    assert.strictEqual(on.running, true);
    assert.strictEqual(on.stale, false);
    assert.match(on.label, /ทำงานอยู่/);
    assert.match(on.lastTickText, /วินาทีที่แล้ว/);

    const off = schedulerHealth(schedulerFixture(NOW, { running: false }), NOW);
    assert.match(off.label, /หยุดอยู่/);

    const stale = schedulerHealth(schedulerFixture(NOW, { lastTickAt: new Date(NOW - 600000).toISOString() }), NOW);
    assert.strictEqual(stale.stale, true);
    assert.match(stale.label, /นานเกิน 3 นาที/);

    const unknown = schedulerHealth(null, NOW);
    assert.strictEqual(unknown.known, false);
    assert.match(unknown.label, /ไม่ทราบ/);
  });

  // ── what the operator actually sees ──────────────────────────────────────

  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-will-it-post-"));
  const src = path.join(frontend, "src", "social-agency");
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { default as CalendarTab } from ${JSON.stringify(path.join(src, "CalendarTab.jsx"))};`,
    `export { default as SchedulerAlerts } from ${JSON.stringify(path.join(src, "SchedulerAlerts.jsx"))};`,
    `export { default as SchedulerStatusCard, SchedulerPill } from ${JSON.stringify(path.join(src, "SchedulerStatus.jsx"))};`,
    `export { EntryDrawer } from ${JSON.stringify(path.join(src, "drawers.jsx"))};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));
  await vite.build({
    root: frontend,
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    build: {
      ssr: entryFile,
      outDir: path.join(work, "out"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "ui.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const ui = require(path.join(work, "out", "ui.cjs"));
  const { createElement, renderToStaticMarkup } = ui;

  // SSR uses the real clock, so fixtures are built around "now".
  const realNow = Date.now();
  const realScheduler = schedulerFixture(realNow);
  const inHours = (h) => {
    const d = new Date(realNow + h * 3600 * 1000);
    const bkk = new Date(d.getTime() + 7 * 3600 * 1000).toISOString();
    return { date: bkk.slice(0, 10), time: bkk.slice(11, 16) };
  };

  const renderCalendar = (client, scheduler = realScheduler) => renderToStaticMarkup(createElement(ui.CalendarTab, {
    state: { clients: [client], activeClientId: client.id, scheduler },
    activeClient: client,
    busy: false,
    onOpenEntry() {},
    onRunNow() {},
    onReschedule() {},
    onDeleteEntry() {},
    onCreateEntry() {},
    onAutoPlan: async () => ({ slots: [] }),
    onApplyPlan: async () => {},
    onDeleteEntriesBatch() {},
  }));

  const renderAlerts = (client, handlers = {}) => renderToStaticMarkup(createElement(ui.SchedulerAlerts, {
    client,
    scheduler: realScheduler,
    busy: false,
    onOpenEntry() {},
    onApprove() {},
    onSendNow() {},
    ...handlers,
  }));

  const renderDrawer = (entry, client, handlers = {}) => renderToStaticMarkup(createElement(ui.EntryDrawer, {
    entry,
    client,
    scheduler: realScheduler,
    busy: false,
    onClose() {},
    onRunNow() {},
    onSendNow() {},
    onApprove() {},
    onReject() {},
    onReschedule() {},
    onDelete() {},
    onOpenInWorkflow() {},
    ...handlers,
  }));

  try {
    test("ชิปในปฏิทินพกคำตอบ + เหตุผลเต็ม (เดิมวางแผนไว้ทุกใบหน้าตาเหมือนกัน)", () => {
      const client = clientFixture({
        calendar: [
          entryFixture({ id: "auto", status: "planned", ...inHours(3) }),
          entryFixture({ id: "review", status: "needs_review", ...inHours(-1) }),
        ],
      });
      const markup = renderCalendar(client);
      assert.match(markup, /data-outlook="auto"/);
      assert.match(markup, /จะขึ้นเอง/);
      assert.match(markup, /data-outlook="needs_approval"/);
      assert.match(markup, /รออนุมัติ — จะไม่ขึ้นเองจนกว่าจะอนุมัติ/, "the reason is in the chip title");
    });

    test("ชิปบอกเรื่อง dry-run ด้วย ไม่ใช่ขึ้น \"จะขึ้นเอง\" ทั้งที่ยังไม่ส่งจริง", () => {
      const client = clientFixture({ calendar: [entryFixture({ id: "dry", status: "planned", platform: "facebook", ...inHours(3) })] });
      const markup = renderCalendar(client);
      assert.match(markup, /data-outlook="dry_run"/);
      assert.match(markup, /ไม่ขึ้นจริง/);
    });

    test("หน้ารายการตอบ \"จะขึ้นเองไหม\" ก่อนผู้ใช้จะรอเปล่า", () => {
      const client = clientFixture();
      const markup = renderDrawer(entryFixture({ status: "needs_review", ...inHours(-1) }), client);
      assert.match(markup, /class="sa-outlook warn"/);
      assert.match(markup, /รออนุมัติ — จะไม่ขึ้นเองจนกว่าจะอนุมัติ/);
      assert.match(markup, /ติดด่านตรวจภาพ|อนุมัติแล้วระบบจะส่งจริงทันที/);
    });

    test("รายการที่พลาด → มีปุ่ม \"ส่งเลยตอนนี้\" ทั้งในหน้ารายการและการ์ดแจ้งเตือน", () => {
      const client = clientFixture({ calendar: [entryFixture({ id: "m1", status: "missed", ...inHours(-5) })] });
      const drawer = renderDrawer(client.calendar[0], client);
      assert.match(drawer, /ส่งเลยตอนนี้/);
      const alerts = renderAlerts(client);
      assert.match(alerts, /sa-alert-card missed/);
      assert.match(alerts, /ส่งเลยตอนนี้/);
      assert.match(alerts, /เลื่อนรายการนี้มาตอนนี้/, "explains what the button does");
    });

    test("ถึงเวลาแล้วยังไม่อนุมัติ → การ์ดพร้อมปุ่มอนุมัติและบอกว่าจะส่งจริงทันที", () => {
      const client = clientFixture({ calendar: [entryFixture({ id: "late", status: "needs_review", ...inHours(-1) })] });
      const markup = renderAlerts(client);
      assert.match(markup, /sa-alert-card overdue/);
      assert.match(markup, /เลยเวลามา 1 ชม\./);
      assert.match(markup, /อนุมัติและเผยแพร่เลย/);
      assert.match(markup, /อนุมัติแล้วระบบจะส่งขึ้นจริงทันที/);
    });

    test("การ์ดที่ติดด่านตรวจภาพ → ไม่ให้กดอนุมัติจากการ์ด แต่พาไปตรวจภาพก่อน", () => {
      const client = clientFixture({
        calendar: [entryFixture({
          id: "gated",
          status: "needs_review",
          ...inHours(-1),
          image: IMAGE,
          imageGate: { required: true, ok: false, status: "unreviewed", reason: "ยังไม่ได้ตรวจภาพในหน้าโพสต์" },
        })],
      });
      const markup = renderAlerts(client);
      assert.match(markup, /เปิดรูป \/ ตรวจภาพ/);
      assert.match(markup, /อนุมัติตอนนี้ระบบก็ยังไม่ส่ง/);
      assert.match(markup, /<button class="sa-btn success sm" disabled=""/, "approve from the card is refused");
    });

    test("ไม่มีอะไรเลย → ไม่มีแถบแจ้งเตือนโผล่มา", () => {
      const markup = renderAlerts(clientFixture({ calendar: [] }));
      assert.strictEqual(markup, "");
    });

    test("การ์ดตัวตั้งเวลาบอกว่าทำงานอยู่/หยุดอยู่ + tick ล่าสุด + รอบการทำงาน", () => {
      const on = renderToStaticMarkup(createElement(ui.SchedulerStatusCard, { scheduler: realScheduler }));
      assert.match(on, /ตัวตั้งเวลาทำงานอยู่/);
      assert.match(on, /tick ล่าสุด/);
      assert.match(on, /ทุก 60 วินาที/);
      assert.match(on, /Asia\/Bangkok/);
      const off = renderToStaticMarkup(createElement(ui.SchedulerStatusCard, { scheduler: schedulerFixture(realNow, { running: false }) }));
      assert.match(off, /ตัวตั้งเวลาหยุดอยู่/);
      assert.match(off, /จะไม่ขึ้นเองเลยจนกว่าจะกด ▶/);
      const stale = renderToStaticMarkup(createElement(ui.SchedulerStatusCard, {
        scheduler: schedulerFixture(realNow, { lastTickAt: new Date(realNow - 600000).toISOString() }),
      }));
      assert.match(stale, /นานเกิน 3 นาที/);
    });

    test("ป้ายในหัวหน้าแอปบอก tick ล่าสุด ไม่ใช่แค่ \"ทำงานอยู่\"", () => {
      const markup = renderToStaticMarkup(createElement(ui.SchedulerPill, { scheduler: realScheduler }));
      assert.match(markup, /tick ล่าสุด/);
      assert.match(markup, /data-scheduler-state="on"/);
      const off = renderToStaticMarkup(createElement(ui.SchedulerPill, { scheduler: schedulerFixture(realNow, { running: false }) }));
      assert.match(off, /data-scheduler-state="off"/);
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  // ── wiring + server ──────────────────────────────────────────────────────

  test("หน้าหลักส่ง sendNow/scheduler ลงไปให้ครบ (ไม่ใช่ปุ่มที่ไม่มีใครต่อ)", () => {
    const page = read("app", "frontend", "src", "components", "SocialAgency.jsx");
    assert.match(page, /postJson\("\/api\/social-agency\/send-now"/);
    const drawerStart = page.indexOf("<EntryDrawer");
    const drawerBlock = page.slice(drawerStart, page.indexOf("/>", drawerStart) + 2);
    assert.match(drawerBlock, /onSendNow=\{sendNow\}/);
    assert.match(drawerBlock, /scheduler=\{state\.scheduler\}/);
    const alertsStart = page.indexOf("<SchedulerAlerts");
    const alertsBlock = page.slice(alertsStart, page.indexOf("/>", alertsStart) + 2);
    assert.match(alertsBlock, /onSendNow=\{sendNow\}/);
    assert.match(alertsBlock, /onApprove=\{approve\}/);
    assert.match(page, /scheduler=\{state\.scheduler\}\s*\n\s*refreshKey=\{refreshSeq\}/, "overview gets the scheduler for its card");
  });

  test("เซิร์ฟเวอร์มี \"ส่งเลยตอนนี้\": เลื่อนมาเวลานี้ เก็บของเดิม แล้วรัน", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-send-now-"));
    const stateDir = path.join(tmp, "app", "runtime-state", "social-agency");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "thai-modern-bags.json"), JSON.stringify({
      version: 2,
      activeClientId: "c1",
      clients: [clientFixture({
        calendar: [entryFixture({ id: "m1", status: "missed", date: "2026-10-20", time: "07:00", missedAt: "2026-10-20T00:10:00.000Z" })],
      })],
    }, null, 2));
    const { SocialAgencyRuntime } = require(path.join(root, "scripts", "server", "social-agency-runtime.cjs"));
    const rt = new SocialAgencyRuntime({ root: tmp });
    let started = null;
    rt.runWorkflow = (clientId, entryId, options) => {
      started = { clientId, entryId, options };
      return { runId: "run-fake", status: "running", entryId };
    };
    const result = rt.sendMissedNow("c1", "m1");
    assert.strictEqual(result.runId, "run-fake");
    assert.strictEqual(started.entryId, "m1");
    assert.strictEqual(started.options.trigger, "send-now");
    const { entry } = rt._findEntry("c1", "m1");
    assert.strictEqual(entry.status, "planned", "runWorkflow owns the in_workflow transition");
    assert.notStrictEqual(`${entry.date} ${entry.time}`, "2026-10-20 07:00", "moved to now, not left in the past");
    const bkkNow = new Date(Date.now() + 7 * 3600 * 1000).toISOString();
    assert.strictEqual(entry.date, bkkNow.slice(0, 10));
    assert.strictEqual(entry.rescheduledFrom.length, 1);
    assert.strictEqual(entry.rescheduledFrom[0].date, "2026-10-20");
    assert.strictEqual(entry.rescheduledFrom[0].status, "missed");

    // Refuses entries that never missed: they have "รันเลยตอนนี้" already.
    assert.throws(() => rt.sendMissedNow("c1", "m1"), /ไม่ได้พลาดหรือล้มเหลว/);

    // And the route exists.
    assert.match(read("scripts", "server", "social-agency-runtime.cjs"), /pathname === "\/api\/social-agency\/send-now"/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("tick เขียน heartbeat และเตือนครั้งเดียวเมื่อเลยเวลาแต่ยังไม่อนุมัติ", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-tick-"));
    const stateDir = path.join(tmp, "app", "runtime-state", "social-agency");
    fs.mkdirSync(stateDir, { recursive: true });
    const overdue = new Date(Date.now() - 30 * 60 * 1000);
    const bkk = new Date(overdue.getTime() + 7 * 3600 * 1000).toISOString();
    fs.writeFileSync(path.join(stateDir, "thai-modern-bags.json"), JSON.stringify({
      version: 2,
      activeClientId: "c1",
      clients: [clientFixture({
        calendar: [entryFixture({ id: "late", status: "needs_review", date: bkk.slice(0, 10), time: bkk.slice(11, 16) })],
      })],
    }, null, 2));
    const { SocialAgencyRuntime } = require(path.join(root, "scripts", "server", "social-agency-runtime.cjs"));
    const rt = new SocialAgencyRuntime({ root: tmp });
    // The rest of the tick talks to the outside world; this test is about the
    // two things the tick owes the operator.
    rt._maybeReconcileTikTok = async () => {};
    rt._maybeSyncMetrics = async () => {};
    rt._maybeWeeklySummary = async () => {};
    rt.runWorkflow = () => ({ runId: "x" });
    const warned = [];
    const realWarn = console.warn;
    console.warn = (...args) => warned.push(args.join(" "));
    try {
      await rt._tick();
    } finally {
      console.warn = realWarn;
    }
    const heartbeat = JSON.parse(fs.readFileSync(path.join(stateDir, "scheduler-heartbeat.json"), "utf8"));
    assert.ok(heartbeat.lastTickAt, "a tick always leaves a heartbeat");
    assert.strictEqual(heartbeat.tickMs, 60000);
    const { entry } = rt._findEntry("c1", "late");
    assert.ok(entry.approvalReminderAt, "a late unapproved post is announced");
    assert.ok(warned.some((line) => /ถึงเวลาแล้วยังไม่อนุมัติ/.test(line)));
    const firstReminder = entry.approvalReminderAt;
    await rt._tick();
    const again = rt._findEntry("c1", "late").entry;
    assert.strictEqual(again.approvalReminderAt, firstReminder, "one reminder, not one per minute");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("สถานะตัวตั้งเวลาที่เซิร์ฟเวอร์ส่งให้ UI มีทั้ง stale และคิวที่เลยเวลารออนุมัติ", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-status-"));
    const stateDir = path.join(tmp, "app", "runtime-state", "social-agency");
    fs.mkdirSync(stateDir, { recursive: true });
    const overdue = new Date(Date.now() - 30 * 60 * 1000);
    const bkk = new Date(overdue.getTime() + 7 * 3600 * 1000).toISOString();
    fs.writeFileSync(path.join(stateDir, "thai-modern-bags.json"), JSON.stringify({
      version: 2,
      activeClientId: "c1",
      clients: [clientFixture({
        calendar: [entryFixture({ id: "late", status: "needs_review", date: bkk.slice(0, 10), time: bkk.slice(11, 16) })],
      })],
    }, null, 2));
    const { SocialAgencyRuntime } = require(path.join(root, "scripts", "server", "social-agency-runtime.cjs"));
    const rt = new SocialAgencyRuntime({ root: tmp });
    const status = rt.getSchedulerStatus();
    assert.strictEqual(status.running, false);
    assert.strictEqual(status.stale, false, "a stopped scheduler is not 'stale'");
    assert.strictEqual(status.tickMs, 60000);
    assert.strictEqual(status.overdueApprovals.length, 1);
    assert.strictEqual(status.overdueApprovals[0].entryId, "late");
    assert.ok(status.overdueApprovals[0].minutesLate >= 29);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok - ${name}`);
    } catch (err) {
      console.error(`  FAIL - ${name}\n${err.stack || err}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`PASS: ${passed} will-it-post checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
