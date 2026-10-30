#!/usr/bin/env node
"use strict";

/**
 * Two models must never start loading at the same time.
 *
 * The bug this covers was not a refusal that failed — it was silence. On an
 * 18 GB Mac, SDXL took 825 s to come off a slow external disk, and in the middle
 * of that a 9B chat model was started on top of it. Neither was "resident" yet,
 * so the memory budget saw an empty machine, allowed both, and the result was
 * 5 GB of swap and a llama.cpp that never answered.
 *
 * So this suite checks both halves:
 *   - a model that is still loading is counted as holding its bytes;
 *   - the second load waits for the first, and starts anyway when the wait runs
 *     out — a stuck backend must never wedge the app.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const guard = require(path.join(root, "scripts", "server", "model-load-guard.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const GIB = 1024 ** 3;

function fakeClock(start = 0) {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

async function main() {
  // ── counting what is on its way in ──────────────────────────────────────
  test("โมเดลที่กำลังโหลดถูกนับเป็นพื้นที่ที่จองแล้ว", () => {
    const bytes = guard.inFlightBytes([
      { loading: true, bytes: 6.6 * GIB },
      { loading: false, bytes: 5 * GIB },
      { loading: true, bytes: 2 * GIB },
      { loading: "yes", bytes: 9 * GIB },
      null,
    ]);
    assert.strictEqual(Math.round((bytes / GIB) * 10) / 10, 8.6, "only the loading ones count");
    assert.strictEqual(guard.inFlightBytes([]), 0);
    assert.strictEqual(guard.inFlightBytes(null), 0);
  });

  test("ไม่มีอะไรโหลดอยู่ = เริ่มได้เลย", () => {
    const plan = guard.planLoadStart({ target: "text", otherLoading: false });
    assert.strictEqual(plan.action, "proceed");
    assert.match(plan.reason, /nothing else is loading/);
    assert.strictEqual(plan.timedOut, undefined);
  });

  test("รูปกำลังโหลดอยู่ = โมเดลข้อความรอก่อน พร้อมบอกขนาด", () => {
    const plan = guard.planLoadStart({
      target: "text",
      otherLoading: true,
      otherLabel: "the image model",
      otherGb: 6.6,
      waitedMs: 0,
      waitMs: guard.DEFAULT_WAIT_MS,
    });
    assert.strictEqual(plan.action, "wait");
    assert.match(plan.reason, /the image model is loading \(6\.6 GB\)/);
    assert.match(plan.reason, /waiting up to 5 min/);
    assert.strictEqual(plan.remainingMs, guard.DEFAULT_WAIT_MS);
  });

  test("รอจนหมดเวลาแล้วก็เริ่มอยู่ดี แต่ต้องบอกว่าเคยรอ", () => {
    const plan = guard.planLoadStart({
      target: "text",
      otherLoading: true,
      otherGb: 6.6,
      waitedMs: guard.DEFAULT_WAIT_MS,
      waitMs: guard.DEFAULT_WAIT_MS,
    });
    assert.strictEqual(plan.action, "proceed");
    assert.strictEqual(plan.timedOut, true);
    assert.match(plan.reason, /still loading after 5 min/);
    assert.match(plan.reason, /may make the machine swap/);
  });

  test("ปิดการรอ (0) = ไม่รอเลย แต่ยังบอกเหตุผล", () => {
    const plan = guard.planLoadStart({ target: "image", otherLoading: true, waitMs: 0 });
    assert.strictEqual(plan.action, "proceed");
    assert.strictEqual(plan.timedOut, true);
    assert.match(plan.reason, /the text model is still loading/);
    assert.match(plan.reason, /the wait is switched off/);
  });

  // ── the waiting itself ──────────────────────────────────────────────────
  test("รอจริง: ปล่อยให้รูปโหลดเสร็จแล้วค่อยเริ่ม ออก log ครั้งเดียว", async () => {
    const clock = fakeClock();
    let loading = true;
    const waits = [];
    const plan = await guard.waitForOtherLoad({
      target: "text",
      otherLabel: "the image model",
      waitMs: 600000,
      pollMs: 2000,
      isOtherLoading: () => loading,
      otherBytes: () => (loading ? 6.6 * GIB : 0),
      now: clock.now,
      sleep: async (ms) => {
        clock.advance(ms);
        // after four polls the image model answers
        if (clock.now() >= 8000) loading = false;
      },
      onWait: (entry) => waits.push(entry.reason),
    });
    assert.strictEqual(plan.action, "proceed");
    assert.strictEqual(plan.timedOut, undefined, "it did not give up, it waited");
    assert.strictEqual(waits.length, 1, "one line, not one per poll");
    assert.strictEqual(clock.now(), 8000, "waited exactly as long as the other load took");
    assert.match(waits[0], /6\.6 GB/);
  });

  test("รอจนหมดเวลาแล้วเริ่มต่อ ไม่ค้างตลอดไป", async () => {
    const clock = fakeClock();
    let warned = null;
    const plan = await guard.waitForOtherLoad({
      target: "text",
      waitMs: 6000,
      pollMs: 2000,
      isOtherLoading: () => true,
      otherBytes: () => 5 * GIB,
      now: clock.now,
      sleep: async (ms) => clock.advance(ms),
      onDone: (entry) => {
        warned = entry;
      },
    });
    assert.strictEqual(plan.action, "proceed");
    assert.strictEqual(plan.timedOut, true);
    assert.ok(clock.now() >= 6000, "the budget was respected");
    assert.ok(warned && warned.timedOut, "the timeout is reported, not swallowed");
  });

  // ── the wiring in serve.cjs ─────────────────────────────────────────────
  test("serve.cjs: การโหลดข้อความรอโมเดลภาพ และการโหลดภาพรอโมเดลข้อความ", () => {
    const startLlm = serveSource.slice(
      serveSource.indexOf("async function startLlm(settings = {})"),
      serveSource.indexOf("async function startLlmWithBackend"),
    );
    assert.match(startLlm, /await waitForOtherModelLoad\(\{ target: "text" \}\)/);
    const startBackend = serveSource.slice(
      serveSource.indexOf("async function startBackend(settings = {})"),
      serveSource.indexOf("async function startBackend(settings = {})") + 20000,
    );
    assert.match(startBackend, /await waitForOtherModelLoad\(\{ target: "image" \}\)/);
  });

  test("serve.cjs: โมเดลที่กำลังโหลดถูกนับใน residentHeavyModelBytes", () => {
    const start = serveSource.indexOf("function residentHeavyModelBytes()");
    const body = serveSource.slice(start, serveSource.indexOf("function evaluateModelMemoryBudget"));
    assert.match(body, /imageModelLoadingBytes/, "the image load in flight");
    assert.match(body, /llmModelLoadingBytes/, "the text load in flight");
  });

  test("serve.cjs: ตั้งค่า in-flight ตอนสั่งโหลด และเคลียร์เมื่อพร้อม/ถูกปิด", () => {
    assert.match(serveSource, /imageModelLoadingBytes = estimateModelBytes\(imageLoadPath\)/);
    assert.match(
      serveSource,
      /imageModelResidentBytes = 0;\n\s*imageModelLoadingBytes = 0;/,
      "cleared when the backend is stopped",
    );
    assert.match(
      serveSource,
      /imageModelResidentBytes = estimateModelBytes\([\s\S]{0,220}?\);\n\s*imageModelLoadingBytes = 0;/,
      "cleared when the image model becomes resident",
    );
    assert.match(serveSource, /llmModelLoadingBytes = estimateModelBytes\(loadPath\)/);
    assert.match(serveSource, /llmModelLoadingBytes = 0;\n\s*noteEngineUsed\("text"\)/, "cleared when the text model is ready");
    assert.match(serveSource, /async function killLlm\(\) \{\n\s*llmReady = false;\n\s*llmModelLoadingBytes = 0;/, "cleared when it is stopped");
  });

  test("serve.cjs: รอได้นานเท่าที่ LUKE_MODEL_LOAD_WAIT_MS กำหนด", () => {
    assert.match(serveSource, /LUKE_MODEL_LOAD_WAIT_MS/);
    const body = serveSource.slice(serveSource.indexOf("async function waitForOtherModelLoad"));
    assert.match(body, /modelLoadGuard\.waitForOtherLoad\(/);
    assert.match(body, /onWait: \(plan\) => console\.log/);
    assert.match(body, /if \(plan\.timedOut\) console\.warn/);
  });

  test("serve.cjs: พร้อมแล้ว/ตายระหว่างโหลด ต้องไม่ทิ้ง in-flight ค้างไว้", () => {
    const ready = serveSource.slice(
      serveSource.indexOf("function markBackendReady()"),
      serveSource.indexOf("function pingBackendReady()"),
    );
    assert.match(ready, /imageModelResidentBytes = estimateModelBytes\(/, "ready means resident");
    assert.match(ready, /imageModelLoadingBytes = 0;/, "and no longer in flight");
    // The backend's own exit handler clears it too: a model that died mid-load
    // must not make the next text load look like the machine is full.
    assert.match(
      serveSource,
      /backendLoadState\.active = false;\n\s*\/\/ It never became resident,[\s\S]{0,120}?imageModelLoadingBytes = 0;/,
      "a backend that died mid-load holds nothing",
    );
    assert.match(serveSource, /llmModelLoadingBytes = 0;\n\s*if \(code !== 0 && code !== null && !llmError\)/);
  });

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok - ${name}`);
    } catch (err) {
      console.error(`  FAIL - ${name}\n${err.stack || err}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`PASS: ${tests.length} model load guard checks`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
