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

  console.log(`\nPASS: ${passed} checks (root: ${root})`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
