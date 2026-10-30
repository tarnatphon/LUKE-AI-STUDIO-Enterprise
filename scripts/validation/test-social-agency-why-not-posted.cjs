#!/usr/bin/env node
"use strict";

/**
 * Social Agency — `social-agency-why-not-posted.cjs` and the scheduler heartbeat.
 *
 * "ทำไมโพสต์ไม่ขึ้น" has an answer, but only if something remembers whether the
 * app was running at the time it should have posted. That is the heartbeat on
 * disk: start / every tick / stop, plus the windows where it was demonstrably
 * gone. The CLI then reads the same state file the app writes and says, in Thai,
 * which gate is holding the post: no approval, image gate, AI score, dry-run, a
 * stopped or stale scheduler, TikTok consent, or the 2-hour "missed" cutoff.
 *
 * What this suite pins:
 *   - heartbeat arithmetic (start / tick / stop / gaps / was-running-at);
 *   - a heartbeat that is missing reads as "no evidence", not "app was closed";
 *   - the CLI's report on a real state file: status, due time, whether the app
 *     was up then, every blocking gate, the scores, the dry-run flag;
 *   - --list / --entry / --json / placeholder ids / missing state;
 *   - read-only: the state file is byte-identical after the CLI runs.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const heartbeat = require(path.join(root, "scripts", "server", "scheduler-heartbeat.cjs"));
const why = require(path.join(root, "scripts", "social-agency-why-not-posted.cjs"));

const MIN = 60 * 1000;

function bkk(ms) {
  const d = new Date(ms + 7 * 3600 * 1000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

function writeState(dir, state) {
  const stateDir = path.join(dir, "app", "runtime-state", "social-agency");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "thai-modern-bags.json"), JSON.stringify(state, null, 2));
  return path.join(stateDir, "thai-modern-bags.json");
}

function fixtureRoot(nowMs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-why-"));
  const past = bkk(nowMs - 90 * MIN);
  const future = bkk(nowMs + 90 * MIN);
  writeState(tmp, {
    version: 2,
    activeClientId: "c1",
    clients: [{
      id: "c1",
      name: "ทดสอบร้านค้า",
      industry: "ของใช้",
      tone: "เจ้าของแบรนด์",
      products: [{ sku: "A-1", name: "แก้วเซรามิก A-1", imageSubject: "ceramic mug" }],
      connectors: {
        linkedin: { dryRun: false, testedAt: new Date(nowMs - 3600 * 1000).toISOString(), testOk: true },
        facebook: { dryRun: true },
      },
      settings: { threshold: 80, viralThreshold: 60 },
      calendar: [
        { id: "cal-approve", ...past, platform: "linkedin", sku: "A-1", productName: "แก้วเซรามิก A-1", status: "needs_review", updatedAt: new Date(nowMs - 85 * MIN).toISOString() },
        { id: "cal-gated", ...future, platform: "linkedin", sku: "A-1", productName: "แก้วเซรามิก A-1", status: "planned", imagePrompt: "Professional product photography of product (A-1)", image: { path: path.join(tmp, "nope.jpg") } },
        { id: "cal-dry", ...future, platform: "facebook", sku: "A-1", productName: "แก้วเซรามิก A-1", status: "planned" },
        { id: "cal-missed", ...bkk(nowMs - 6 * 3600 * 1000), platform: "linkedin", sku: "A-1", productName: "แก้วเซรามิก A-1", status: "missed", missedAt: new Date(nowMs - 4 * 3600 * 1000).toISOString() },
        { id: "cal-auto", ...future, platform: "linkedin", sku: "A-1", productName: "แก้วเซรามิก A-1", status: "planned" },
      ],
      workflowRuns: [{ id: "run-1", entryId: "cal-approve", clientId: "c1", trigger: "schedule", status: "needs_review", startedAt: new Date(nowMs - 95 * MIN).toISOString(), check: { score: 48, verdict: "review", issues: ["อ้างราคาที่ไม่มีหลักฐาน"] } }],
    }],
  });
  // The app ticked two minutes ago and has been up for four hours: the due time
  // of cal-approve falls inside that window.
  fs.writeFileSync(path.join(tmp, "app", "runtime-state", "social-agency", "scheduler-heartbeat.json"), JSON.stringify({
    version: 1,
    pid: 4242,
    tickMs: 60000,
    timezone: "Asia/Bangkok",
    startedAt: new Date(nowMs - 4 * 3600 * 1000).toISOString(),
    lastTickAt: new Date(nowMs - 2 * MIN).toISOString(),
    stoppedAt: null,
    gaps: [],
  }, null, 2));
  return tmp;
}

async function captureMain(argv, options = {}) {
  const out = [];
  const err = [];
  const stream = { write: (chunk) => { out.push(String(chunk)); return true; } };
  const oldOut = process.stdout.write;
  const oldErr = process.stderr.write;
  process.stdout.write = stream.write;
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  let code;
  try {
    code = await why.main(argv, { ...options, say: (line = "") => out.push(`${line}\n`) });
  } finally {
    process.stdout.write = oldOut;
    process.stderr.write = oldErr;
  }
  return { code, stdout: out.join(""), stderr: err.join("") };
}

async function main() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const T0 = Date.parse("2026-10-30T03:00:00Z");

  // ── heartbeat arithmetic ─────────────────────────────────────────────────

  test("เริ่มรอบแรก: เริ่มต้นที่มี lastTickAt และไม่มีช่องว่าง", () => {
    const hb = heartbeat.recordStart(null, new Date(T0).toISOString(), { tickMs: 60000, pid: 1 });
    assert.strictEqual(hb.startedAt, new Date(T0).toISOString());
    assert.strictEqual(hb.lastTickAt, new Date(T0).toISOString());
    assert.deepStrictEqual(hb.gaps, []);
    assert.strictEqual(hb.tickMs, 60000);
  });

  test("เริ่มรอบใหม่หลังปิดไป 10 นาที → บันทึกช่องว่างที่แอปไม่ได้ทำงาน", () => {
    const prev = heartbeat.recordStart(null, new Date(T0).toISOString());
    const next = heartbeat.recordStart(prev, new Date(T0 + 10 * MIN).toISOString());
    assert.strictEqual(next.gaps.length, 1);
    assert.strictEqual(next.gaps[0].ms, 10 * MIN);
    assert.strictEqual(next.gaps[0].from, new Date(T0).toISOString());
  });

  test("รีสตาร์ทเร็ว ๆ (30 วินาที) ไม่นับเป็นช่องว่าง", () => {
    const prev = heartbeat.recordStart(null, new Date(T0).toISOString());
    const next = heartbeat.recordStart(prev, new Date(T0 + 30 * 1000).toISOString());
    assert.deepStrictEqual(next.gaps, []);
  });

  test("tick ขยับ lastTickAt แต่เก็บ startedAt และช่องว่างเดิมไว้", () => {
    let hb = heartbeat.recordStart(null, new Date(T0).toISOString());
    hb = heartbeat.recordStart(hb, new Date(T0 + 10 * MIN).toISOString());
    const ticked = heartbeat.recordTick(hb, new Date(T0 + 11 * MIN).toISOString());
    assert.strictEqual(ticked.startedAt, new Date(T0 + 10 * MIN).toISOString());
    assert.strictEqual(ticked.lastTickAt, new Date(T0 + 11 * MIN).toISOString());
    assert.strictEqual(ticked.gaps.length, 1);
  });

  test("stop บันทึก stoppedAt และไม่ลบหลักฐานเดิม", () => {
    const hb = heartbeat.recordStart(null, new Date(T0).toISOString());
    const stopped = heartbeat.recordStop(hb, new Date(T0 + MIN).toISOString());
    assert.strictEqual(stopped.stoppedAt, new Date(T0 + MIN).toISOString());
    assert.strictEqual(stopped.lastTickAt, hb.lastTickAt);
  });

  test("wasRunningAt: ในหน้าต่างที่เดินอยู่ = ใช่ / ในช่องว่าง = ไม่ใช่ / หลังหยุด = ไม่ใช่", () => {
    let hb = heartbeat.recordStart(null, new Date(T0).toISOString());
    hb = heartbeat.recordTick(hb, new Date(T0 + 60 * MIN).toISOString());
    hb = heartbeat.recordStart(hb, new Date(T0 + 120 * MIN).toISOString());

    const inside = heartbeat.wasRunningAt(hb, T0 + 30 * MIN);
    assert.strictEqual(inside.running, true);
    assert.match(inside.reason, /แอปเปิดอยู่/);

    const gap = heartbeat.wasRunningAt(hb, T0 + 90 * MIN);
    assert.strictEqual(gap.running, false);
    assert.match(gap.reason, /แอปไม่ได้เปิดอยู่ตอนนั้น/);

    const stopped = heartbeat.recordStop(hb, new Date(T0 + 121 * MIN).toISOString());
    const afterStop = heartbeat.wasRunningAt(stopped, T0 + 130 * MIN);
    assert.strictEqual(afterStop.running, false);
    assert.match(afterStop.reason, /ถูกหยุดไปแล้ว/);
  });

  test("ไม่มี heartbeat = ไม่มีหลักฐาน (ไม่ใช่ \"แอปปิด\")", () => {
    const unknown = heartbeat.wasRunningAt(null, T0);
    assert.strictEqual(unknown.known, false);
    assert.match(unknown.reason, /ยังไม่มีบันทึก/);
  });

  test("อ่านไฟล์ที่ไม่มี → บอกตรง ๆ ว่าไม่มีไฟล์", () => {
    const missing = heartbeat.readHeartbeat(path.join(os.tmpdir(), "definitely-not-here", "hb.json"));
    assert.strictEqual(missing.ok, false);
    assert.match(missing.error, /ยังไม่มีไฟล์ heartbeat/);
  });

  // ── the CLI ──────────────────────────────────────────────────────────────

  const nowMs = Date.now();
  const tmp = fixtureRoot(nowMs);

  test("--list แสดงเฉพาะรายการที่ยังไม่ออกเอง และไม่นับ \"จะขึ้นเอง\" เป็นปัญหา", async () => {
      const report = await why.buildReport(tmp, { nowMs });
      assert.strictEqual(report.ok, true);
      const ids = report.entries.map((e) => e.entryId);
      assert.deepStrictEqual(ids, ["cal-missed", "cal-approve", "cal-gated", "cal-dry"]);
      assert.ok(!ids.includes("cal-auto"), "a post that will go out by itself is not a problem");
      assert.strictEqual(report.counts.waitingApproval, 1);
      assert.strictEqual(report.counts.missed, 1);
      assert.strictEqual(report.counts.dryRun, 1);
    });

    test("รายการที่รออนุมัติ: บอกสถานะ เวลา แอปเปิดอยู่ไหม ด่าน คะแนน dry-run", async () => {
      const report = await why.buildReport(tmp, { entryId: "cal-approve", nowMs });
      const item = report.entries[0];
      const text = item.lines.join("\n");
      assert.strictEqual(item.status, "needs_review");
      assert.match(text, /สถานะ: รออนุมัติ/);
      assert.match(text, /ควรโพสต์เมื่อ: .*เลยมา 1 ชม\./);
      assert.match(text, /แอปเปิดอยู่ตอนนั้นไหม: ใช่/);
      assert.match(text, /ยังไม่มีคนอนุมัติ/);
      assert.match(text, /AI Check 48 \/ เกณฑ์ 80 ✗/);
      assert.match(text, /dry-run ปิด → ส่งจริงได้/);
      assert.match(text, /สรุป: ✗ ยังไม่มีคนอนุมัติ/);
      assert.match(text, /scripts\/social-agency-review-images\.cjs --confirm cal-approve/);
      assert.strictEqual(item.verdict.code, "waiting_approval");
    });

    test("รายการที่เลยกำหนด 6 ชั่วโมง: บอกว่า \"พลาดโพสต์\" และทางออกคือส่งเลยตอนนี้", async () => {
      const report = await why.buildReport(tmp, { entryId: "cal-missed", nowMs });
      const item = report.entries[0];
      assert.strictEqual(item.verdict.code, "missed");
      assert.match(item.lines.join("\n"), /ส่งเลยตอนนี้/);
      assert.match(item.lines.join("\n"), /เลยกำหนดเกิน 2 ชั่วโมง/);
    });

    test("รายการ dry-run: บอกว่าไม่ส่งขึ้นจริงพร้อมวิธีปิด", async () => {
      const report = await why.buildReport(tmp, { entryId: "cal-dry", nowMs });
      const item = report.entries[0];
      assert.strictEqual(item.outlook.key, "dry_run");
      assert.strictEqual(item.connector.dryRun, true);
      assert.match(item.lines.join("\n"), /dry-run เปิดอยู่ → ระบบจะไม่ส่งขึ้นจริง/);
      assert.match(item.verdict.next.join(" "), /ปิด dry-run/);
    });

    test("รายการที่ด่านตรวจภาพไม่ผ่าน: ชี้ด่านตรง ๆ พร้อมคำสั่งยืนยัน", async () => {
      const report = await why.buildReport(tmp, { entryId: "cal-gated", nowMs });
      const text = report.entries[0].lines.join("\n");
      assert.match(text, /ด่านตรวจภาพ/);
      assert.match(text, /--confirm cal-gated/);
    });

    test("รายการ ที่ยังไม่ถึงเวลาและไม่มีอะไรขวาง: ตอบว่า \"จะขึ้นเอง\" ไม่ใช่ \"ไม่ขึ้น\"", async () => {
      const report = await why.buildReport(tmp, { entryId: "cal-auto", nowMs });
      const item = report.entries[0];
      assert.strictEqual(item.outlook.key, "auto");
      assert.match(item.lines.join("\n"), /ยังตอบไม่ได้|ยังไม่ถึงเวลา/);
      assert.strictEqual(item.verdict.code, "will_post");
    });

    test("process ภายนอกเห็นตัวตั้งเวลา \"เดินอยู่\" จาก heartbeat ไม่ใช่ \"หยุดอยู่\" เสมอ", async () => {
      const report = await why.buildReport(tmp, { nowMs });
      assert.strictEqual(report.scheduler.running, true);
      assert.strictEqual(report.scheduler.observedVia, "heartbeat");
      // and a stale heartbeat does not claim the loop is alive
      fs.writeFileSync(path.join(tmp, "app", "runtime-state", "social-agency", "scheduler-heartbeat.json"), JSON.stringify({
        version: 1, tickMs: 60000, timezone: "Asia/Bangkok",
        startedAt: new Date(nowMs - 4 * 3600 * 1000).toISOString(),
        lastTickAt: new Date(nowMs - 40 * MIN).toISOString(),
        stoppedAt: null, gaps: [],
      }));
      const stale = await why.buildReport(tmp, { nowMs });
      assert.strictEqual(stale.scheduler.running, false);
      const planned = (await why.buildReport(tmp, { entryId: "cal-auto", nowMs })).entries[0];
      assert.strictEqual(planned.verdict.code, "scheduler_off");
    });

    test("CLI: --entry พิมพ์รายงานไทย และไม่เขียนทับไฟล์สถานะ", async () => {
      const stateFile = path.join(tmp, "app", "runtime-state", "social-agency", "thai-modern-bags.json");
      const before = fs.readFileSync(stateFile);
      const run = await captureMain(["--root", tmp, "--entry", "cal-approve"]);
      assert.strictEqual(run.code, 0);
      assert.match(run.stdout, /ทำไมโพสต์นี้ยังไม่ขึ้น/);
      assert.match(run.stdout, /สรุป: ✗/);
      assert.ok(fs.readFileSync(stateFile).equals(before), "read-only command must not rewrite state");
    });

    test("CLI: --json คืนข้อมูลที่ parse ได้", async () => {
      const run = await captureMain(["--root", tmp, "--list", "--json"]);
      assert.strictEqual(run.code, 0);
      const parsed = JSON.parse(run.stdout);
      assert.strictEqual(parsed.ok, true);
      assert.ok(parsed.entries.length >= 3);
      assert.ok(parsed.entries.every((e) => typeof e.outlook.key === "string"));
    });

    test("CLI: id ตัวอย่าง (cal-…) ถูกบอกว่าเป็นตัวอย่าง ไม่ใช่ \"ไม่พบรายการ\"", async () => {
      const run = await captureMain(["--root", tmp, "--entry", "cal-…"]);
      assert.strictEqual(run.code, 1);
      assert.match(run.stdout, /เป็นข้อความตัวอย่าง ไม่ใช่ ID จริง/);
      assert.match(run.stdout, /--list/);
    });

    test("CLI: id ที่ไม่มีจริง → บอกให้ดู --list", async () => {
      const run = await captureMain(["--root", tmp, "--entry", "cal-does-not-exist"]);
      assert.strictEqual(run.code, 1);
      assert.match(run.stdout, /ไม่พบรายการ "cal-does-not-exist"/);
    });

    test("CLI: ยังไม่มีไฟล์สถานะ → บอกให้เปิดแอปหนึ่งครั้งก่อน (ไม่ thrown)", async () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sa-why-empty-"));
      const run = await captureMain(["--root", empty]);
      assert.strictEqual(run.code, 1);
      assert.match(run.stdout, /ยังไม่มีไฟล์/);
      fs.rmSync(empty, { recursive: true, force: true });
    });

    test("CLI: --help ทำงานได้โดยไม่ต้องมีสถานะ", async () => {
      const run = await captureMain(["--help"]);
      assert.strictEqual(run.code, 0);
      assert.match(run.stdout, /--entry ENTRY_ID/);
      assert.match(run.stdout, /ไม่เปลี่ยนสถานะ/);
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
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!process.exitCode) console.log(`PASS: ${passed} why-not-posted checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
