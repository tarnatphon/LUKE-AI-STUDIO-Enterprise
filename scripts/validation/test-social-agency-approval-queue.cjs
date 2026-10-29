#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the approval queue must not be a dead end.
 *
 * What happened in the app: a post waiting in "คิวอนุมัติ" had an unreviewed AI
 * image, so the workflow parked it in needs_review and sent nothing (correct).
 * The card, however, still offered the same enabled "อนุมัติและเผยแพร่" button
 * and looked identical after the click — press it again, same result. Operators
 * described it as "กดอนุมัติแล้วก็วนอยู่ในหลุม", which is exactly what an
 * invisible gate feels like.
 *
 * The queue now has to:
 *   - say the image review is the missing step, before the click;
 *   - gate the approve button behind an explicit "ตรวจภาพเทียบรูปสินค้าจริงแล้ว"
 *     tick (the review is a human decision, not a side effect of approving);
 *   - offer one button that records the review and then approves, in that order;
 *   - warn that a post whose time already passed will be sent immediately when
 *     dry-run is off.
 *
 * The card is rendered for real (React SSR through the app's own Vite build) and
 * the pure decision helper is exercised directly.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

async function main() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);

  const { approvalBlock } = await import(pathToFileURL(path.join(frontend, "src", "social-agency", "lib.js")).href);

  const CLIENT = {
    id: "thai-modern-bags",
    name: "Thai Modern Bags Co.,Ltd.",
    settings: { threshold: 80 },
    connectors: { linkedin: { dryRun: false }, facebook: { dryRun: true }, instagram: {} },
    products: [{ sku: "SSB-013", name: "กระเป๋าใส่รองเท้า SSB-013", image: "/sa-products/thai-modern-bags/SSB-013.jpg" }],
    workflowRuns: [],
  };

  const makeEntry = (overrides = {}) => ({
    id: "cal-1abc6b9e-8cd1",
    date: "2026-10-29",
    time: "08:00",
    platform: "linkedin",
    sku: "SSB-013",
    productName: "กระเป๋าใส่รองเท้า SSB-013",
    angle: "เรื่องจากลูกค้า",
    status: "needs_review",
    caption: "เพิ่งได้คุยกับลูกค้าใหม่เรื่องถุงใส่รองเท้ารุ่น SSB-013 ของเรานะครับ",
    imageGate: { required: true, ok: false, status: "unreviewed", reason: "ยังไม่ได้ตรวจภาพในหน้าโพสต์" },
    ...overrides,
  });

  // ── the decision helper ───────────────────────────────────────────────────

  test("ด่านตรวจภาพที่ยังไม่ผ่าน → ถูกนับเป็นตัวบล็อก พร้อมเหตุผล", () => {
    const block = approvalBlock(makeEntry(), CLIENT, Date.parse("2026-10-29T01:00:00Z"));
    assert.strictEqual(block.blocked, true);
    assert.strictEqual(block.status, "unreviewed");
    assert.match(block.reason, /ยังไม่ได้ตรวจภาพ/);
  });

  test("ยืนยันภาพแล้ว หรือรายการที่ไม่ต้องตรวจ → ไม่บล็อก", () => {
    assert.strictEqual(approvalBlock(makeEntry({ imageGate: { required: true, ok: true, status: "approved" } }), CLIENT).blocked, false);
    assert.strictEqual(approvalBlock(makeEntry({ imageGate: { required: false, ok: true, status: "not_required" } }), CLIENT).blocked, false);
    assert.strictEqual(approvalBlock(makeEntry({ imageGate: undefined }), CLIENT).blocked, false);
  });

  test("live = ปิด dry-run ของแพลตฟอร์มนั้นเท่านั้น (ไม่รู้ค่า = ยัง dry-run)", () => {
    assert.strictEqual(approvalBlock(makeEntry(), CLIENT).live, true, "linkedin dry-run off");
    assert.strictEqual(approvalBlock(makeEntry({ platform: "facebook" }), CLIENT).live, false, "facebook still dry-run");
    assert.strictEqual(approvalBlock(makeEntry({ platform: "instagram" }), CLIENT).live, false, "missing flag means dry-run on");
    assert.strictEqual(approvalBlock(makeEntry({ platform: "line" }), CLIENT).live, false, "no connector at all");
  });

  test("เวลาโพสต์ที่ผ่านไปแล้ว → overdue (อนุมัติแล้วจะส่งทันทีเมื่อ live)", () => {
    const after = Date.parse("2026-10-29T02:00:00Z"); // 09:00 Bangkok
    const before = Date.parse("2026-10-29T00:00:00Z"); // 07:00 Bangkok
    assert.strictEqual(approvalBlock(makeEntry(), CLIENT, after).overdue, true);
    assert.strictEqual(approvalBlock(makeEntry(), CLIENT, before).overdue, false);
    const noDate = approvalBlock(makeEntry({ date: "" }), CLIENT, after);
    assert.strictEqual(noDate.overdue, false, "a broken date is not 'overdue'");
    assert.strictEqual(noDate.dueMs, null);
  });

  // ── the card ──────────────────────────────────────────────────────────────

  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-approval-queue-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { default as RunsTab } from ${JSON.stringify(path.join(frontend, "src", "social-agency", "RunsTab.jsx"))};`,
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
      rollupOptions: { output: { format: "cjs", entryFileNames: "queue.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const { RunsTab, createElement, renderToStaticMarkup } = require(path.join(work, "out", "queue.cjs"));

  const state = { clients: [CLIENT], runLog: [] };
  const renderQueue = (client) => renderToStaticMarkup(createElement(RunsTab, {
    state,
    activeClient: client,
    busy: false,
    onApprove() {},
    onReject() {},
    onOpenEntry() {},
    onOpenInWorkflow() {},
    onReviewImage() {},
  }));

  try {
    test("บัตรที่ด่านยังไม่ผ่าน: บอกว่าติดอะไร และปุ่มอนุมัติยังกดไม่ได้", () => {
      const markup = renderQueue({ ...CLIENT, calendar: [makeEntry()] });
      assert.match(markup, /คิวอนุมัติ — Thai Modern Bags Co\./);
      assert.match(markup, /⛔ ด่านตรวจภาพ: ยังไม่ได้ตรวจภาพในหน้าโพสต์/);
      assert.match(markup, /อนุมัติตอนนี้ระบบจะยังไม่ส่งจริง/, "explains why the button did nothing before");
      assert.match(markup, /ตรวจภาพเทียบรูปสินค้าจริงแล้ว/);
      assert.match(markup, /ยังไม่ได้ยืนยันภาพ — ปุ่มอนุมัติจะยังกดไม่ได้จนกว่าจะติ๊ก/);
      assert.match(markup, /<button class="sa-btn success sm" disabled=""/, "approve is disabled until the tick");
      assert.match(markup, /ยืนยันภาพแล้ว \+ อนุมัติ/);
      assert.match(markup, /ดูรูป \/ ตรวจภาพ/, "the way to actually look at the picture");
    });

    test("บัตรที่ด่านผ่านแล้ว: กลับเป็นปุ่มอนุมัติปกติ ไม่มี checkbox เกินมา", () => {
      const markup = renderQueue({
        ...CLIENT,
        calendar: [makeEntry({ imageGate: { required: true, ok: true, status: "approved", reason: "" } })],
      });
      assert.doesNotMatch(markup, /ตรวจภาพเทียบรูปสินค้าจริงแล้ว/);
      assert.match(markup, /อนุมัติและเผยแพร่/);
      assert.doesNotMatch(markup, /<button class="sa-btn success sm" disabled=""/);
    });

    test("โพสต์ที่เลยเวลาและปิด dry-run → เตือนว่าจะส่งจริงทันทีเมื่ออนุมัติ", () => {
      const past = makeEntry({ date: "2026-10-26", time: "10:00" });
      const markup = renderQueue({ ...CLIENT, calendar: [past] });
      assert.match(markup, /เวลาของโพสต์นี้ผ่านไปแล้ว และปิด dry-run ไว้/);
      assert.match(markup, /จะส่งขึ้น LinkedIn ทันที/);
      const dry = renderQueue({ ...CLIENT, connectors: { linkedin: { dryRun: true } }, calendar: [past] });
      assert.doesNotMatch(dry, /จะส่งขึ้น LinkedIn ทันที/, "dry-run on → no live-send warning");
    });

    test("คิวว่าง → บอกว่าว่างจริง ไม่ใช่ปล่อยหน้าว่าง", () => {
      const markup = renderQueue({ ...CLIENT, calendar: [] });
      assert.match(markup, /ไม่มีรายการรออนุมัติ/);
      assert.match(markup, /0 รายการรอคนตัดสิน/);
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  test("คิวอนุมัติได้รับฟังก์ชันบันทึกผลตรวจภาพจากหน้าหลัก (ไม่ใช่ปุ่มที่ทำเองเงียบ ๆ)", () => {
    const page = read("app", "frontend", "src", "components", "SocialAgency.jsx");
    // The element is self-closing, so bound the slice by the tab block instead.
    const start = page.indexOf("<RunsTab");
    const runsBlock = page.slice(start, page.indexOf("/>", start) + 2);
    assert.match(runsBlock, /onReviewImage=\{reviewImage\}/);
    const queue = read("app", "frontend", "src", "social-agency", "RunsTab.jsx");
    assert.match(queue, /await onReviewImage\(entry\.id\);\s*\n\s*await onApprove\(entry\.id\);/, "review first, then approve");
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
  if (!process.exitCode) console.log(`PASS: ${passed} approval-queue checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
