// Smoke tests for Social Agency follow-up groups (3/4/5) + serve.cjs wiring.
// Runs the runtime against an isolated temp state dir — no network, no scheduler.
// Usage: node scripts/server/social-agency-groups-smoke.cjs
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SocialAgencyRuntime } = require("./social-agency-runtime.cjs");

function bangkokToday(offsetDays = 0) {
  const bkk = new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000);
  return bkk.toISOString().slice(0, 10);
}

// Minimal harness for handleApiRequest(req, res, { readJsonRequestBody, json })
function makeHttp(rt) {
  const json = (res, code, body) => {
    res.statusCode = code;
    res.body = body;
  };
  return async function call(method, url, body) {
    const req = { method, url };
    const res = {};
    const readJsonRequestBody = async () => body || {};
    const handled = await rt.handleApiRequest(req, res, { readJsonRequestBody, json });
    assert.notStrictEqual(handled, false, `${method} ${url} was not handled`);
    return res;
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-groups-smoke-"));
  const rt = new SocialAgencyRuntime({ root });
  const call = makeHttp(rt);
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  };

  const state = rt.getState();
  const clientId = state.activeClientId;
  const sku = state.clients[0].products[0].sku;
  assert.ok(clientId && sku, "seed client + product must exist");

  // ── group 3: overview + calendar filters ──
  const e1 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(1), time: "07:13", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
  const e2 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(2), time: "08:14", platform: "line", sku, angle: "เคล็ดลับการใช้งาน" } });
  const e3 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(3), time: "09:15", platform: "instagram", sku, angle: "เรื่องจากลูกค้า", brief: "มะม่วงอบแห้งล็อตใหม่" } });
  rt.updateCalendarEntry(clientId, e2.id, { status: "needs_review", caption: "แคปชันทดสอบมะม่วง" });
  rt.updateCalendarEntry(clientId, e3.id, { status: "published" });

  check("overview shape", () => {
    const ov = rt.getOverview(clientId);
    assert.strictEqual(ov.clientId, clientId);
    assert.ok(ov.counts && typeof ov.counts.scheduled === "number");
    assert.ok(Array.isArray(ov.upcoming) && ov.upcoming.length >= 1);
    assert.ok(ov.needsReview.some((e) => e.id === e2.id), "review queue contains e2");
    assert.ok(ov.byPlatform.facebook >= 1);
  });

  check("listCalendar status filter", () => {
    const rows = rt.listCalendar(clientId, { status: "needs_review" });
    assert.ok(rows.length >= 1 && rows.every((r) => r.status === "needs_review"));
  });

  check("listCalendar platform + date-range filter", () => {
    const rows = rt.listCalendar(clientId, { platform: "facebook,line", from: bangkokToday(0), to: bangkokToday(2) });
    assert.ok(rows.some((r) => r.id === e1.id));
    assert.ok(rows.some((r) => r.id === e2.id));
    assert.ok(!rows.some((r) => r.id === e3.id), "e3 is out of range");
  });

  check("listCalendar text search", () => {
    const rows = rt.listCalendar(clientId, { q: "มะม่วง" });
    assert.ok(rows.some((r) => r.id === e2.id), "caption match");
    assert.ok(rows.some((r) => r.id === e3.id), "brief match");
    assert.ok(!rows.some((r) => r.id === e1.id));
  });

  const ovRes = await call("GET", `/api/social-agency/overview?clientId=${clientId}`);
  check("GET /overview", () => {
    assert.strictEqual(ovRes.statusCode, 200);
    assert.strictEqual(ovRes.body.ok, true);
    assert.strictEqual(ovRes.body.overview.clientId, clientId);
  });

  const calRes = await call("GET", `/api/social-agency/calendar?clientId=${clientId}&status=published&q=มะม่วง`);
  check("GET /calendar with filters", () => {
    assert.strictEqual(calRes.statusCode, 200);
    assert.ok(calRes.body.entries.some((e) => e.id === e3.id));
  });

  // ── group 4: per-platform versions + few-shot ──
  const longCaption = `มะม่วงอบแห้งล็อตใหม่มาแล้วนะครับ ${"หวานธรรมชาติไม่ใส่น้ำตาล ".repeat(30)}#มะม่วง #ของกิน #ขนม #ของฝาก #ผลไม้ #อร่อย #สุขภาพ`;
  check("platform version rules", () => {
    const out = rt.buildPlatformVersions({ caption: longCaption, product: state.clients[0].products[0], angle: "เปิดตัวสินค้า", tone: "เจ้าของแบรนด์" });
    assert.strictEqual(out.versions.demo, longCaption, "demo stays verbatim");
    assert.ok(out.versions.line.length <= 400, `line <= 400 chars (got ${out.versions.line.length})`);
    assert.ok(out.meta.line.hashtags <= 2, "line <= 2 hashtags");
    assert.ok(out.meta.facebook.hashtags <= 4, "facebook <= 4 hashtags");
    assert.ok(out.meta.instagram.hashtags <= 8, "instagram <= 8 hashtags");
    assert.strictEqual(out.meta.line.truncated, true, "long input truncates line version");
  });

  check("preview from entry", () => {
    const preview = rt.previewPlatformVersions(clientId, { entryId: e2.id });
    assert.strictEqual(preview.entryId, e2.id);
    assert.ok(preview.versions.facebook.includes("มะม่วง"), "entry caption flows into versions");
  });

  const shot = rt.addFewShot(clientId, { platform: "facebook", caption: "ตัวอย่างสไตล์แบรนด์ที่เขียนดีมากๆ ยาวเกินยี่สิบตัวอักษรแน่นอน", note: "โพสต์ขายดี" });
  check("few-shot add/list/rank", () => {
    rt.addFewShot(clientId, { platform: "line", caption: "อีกหนึ่งตัวอย่างสไตล์สั้นกระชับสำหรับ LINE โดยเฉพาะเลยครับ" });
    const shots = rt.listFewShots(clientId);
    assert.strictEqual(shots.length, 2);
    assert.throws(() => rt.addFewShot(clientId, { caption: "สั้นไป" }), /สั้นเกินไป/);
    const ranked = rt._fewShotExamples({ fewShots: shots }, "line");
    assert.strictEqual(ranked[0].platform, "line", "same-platform shot ranks first");
  });

  check("few-shot delete", () => {
    rt.deleteFewShot(clientId, shot.id);
    assert.strictEqual(rt.listFewShots(clientId).length, 1);
    assert.throws(() => rt.deleteFewShot(clientId, "nope"), /ไม่พบ/);
  });

  const pvRes = await call("POST", `/api/social-agency/platform-versions?clientId=${clientId}`, { caption: longCaption });
  check("POST /platform-versions", () => {
    assert.strictEqual(pvRes.statusCode, 200);
    assert.ok(pvRes.body.preview.versions.line.length <= 400);
  });

  const fsAdd = await call("POST", `/api/social-agency/few-shots?clientId=${clientId}`, { platform: "instagram", caption: "ตัวอย่างผ่าน HTTP ยาวเกินยี่สิบตัวอักษรเพื่อทดสอบ endpoint" });
  check("POST /few-shots", () => {
    assert.strictEqual(fsAdd.statusCode, 201);
    assert.ok(fsAdd.body.fewShot.id);
  });
  const fsDel = await call("DELETE", `/api/social-agency/few-shots/${fsAdd.body.fewShot.id}?clientId=${clientId}`);
  check("DELETE /few-shots/:id", () => {
    assert.strictEqual(fsDel.statusCode, 200);
    assert.strictEqual(fsDel.body.deleted, fsAdd.body.fewShot.id);
  });

  // ── serve.cjs wiring: health + scheduler lifecycle ──
  check("getHealth shape", () => {
    const health = rt.getHealth();
    assert.strictEqual(health.version, 2);
    assert.ok(health.scheduler && typeof health.scheduler.running === "boolean");
    assert.ok(health.clients >= 1);
    assert.strictEqual(health.llmReady, false, "no LLM injected in smoke env");
    assert.ok(health.stateFile.endsWith("thai-modern-bags.json"));
  });

  check("scheduler start/stop idempotent", () => {
    const started = rt.startScheduler();
    assert.strictEqual(started.running, true);
    const startedAgain = rt.startScheduler();
    assert.strictEqual(startedAgain.running, true, "double start stays on");
    const stopped = rt.stopScheduler();
    assert.strictEqual(stopped.running, false);
    const stoppedAgain = rt.stopScheduler();
    assert.strictEqual(stoppedAgain.running, false, "double stop stays off");
  });

  const healthRes = await call("GET", "/api/social-agency/health");
  check("GET /health", () => {
    assert.strictEqual(healthRes.statusCode, 200);
    assert.strictEqual(healthRes.body.ok, true);
    assert.strictEqual(healthRes.body.health.version, 2);
  });

  const startRes = await call("POST", "/api/social-agency/scheduler/start", {});
  check("POST /scheduler/start", () => {
    assert.strictEqual(startRes.statusCode, 200);
    assert.strictEqual(startRes.body.scheduler.running, true);
  });
  const stopRes = await call("POST", "/api/social-agency/scheduler/stop", {});
  check("POST /scheduler/stop", () => {
    assert.strictEqual(stopRes.statusCode, 200);
    assert.strictEqual(stopRes.body.scheduler.running, false);
  });

  console.log(`\nPASS: ${passed} checks (root: ${root})`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
