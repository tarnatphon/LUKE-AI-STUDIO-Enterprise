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

function bangkokMonday(offsetWeeks = 0) {
  const nowBkk = new Date(Date.now() + 7 * 3600000);
  const dow = (nowBkk.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(nowBkk.getUTCFullYear(), nowBkk.getUTCMonth(), nowBkk.getUTCDate() - dow - offsetWeeks * 7));
  return monday.toISOString().slice(0, 10);
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

  // ── group 5: backup + weekly LINE summary ──
  check("exportBackup shape + strips inFlight", () => {
    const st = rt._read();
    st.clients[0].calendar[0].inFlight = true;
    rt._write(st);
    const all = rt.exportBackup();
    assert.strictEqual(all.scope, "all");
    assert.ok(all.clients.length >= 1);
    assert.ok(all.clients.every((c) => (c.calendar || []).every((e) => e.inFlight === false)), "inFlight stripped");
    const one = rt.exportBackup(clientId);
    assert.strictEqual(one.scope, "client");
    assert.strictEqual(one.clients[0].id, clientId);
    assert.throws(() => rt.exportBackup("nope"), /ไม่พบ/);
    const st2 = rt._read();
    st2.clients[0].calendar[0].inFlight = false;
    rt._write(st2);
  });

  check("snapshot + listBackups", () => {
    const snap = rt.saveBackupSnapshot(clientId);
    assert.ok(snap.file.startsWith(`backup-${clientId}-`));
    assert.ok(rt.listBackups().some((b) => b.file === snap.file));
  });

  check("restoreBackup round-trip + validation", () => {
    const before = rt.exportBackup(clientId);
    assert.ok(before.clients[0].calendar.some((e) => e.id === e1.id));
    rt.deleteCalendarEntry(clientId, e1.id);
    assert.ok(!rt.listCalendar(clientId).some((e) => e.id === e1.id));
    const snapCount = rt.listBackups().length;
    const res = rt.restoreBackup(clientId, before);
    assert.deepStrictEqual(res.restored, [clientId]);
    assert.ok(rt.listCalendar(clientId).some((e) => e.id === e1.id), "e1 restored");
    assert.ok(rt.listBackups().length > snapCount, "safety copy written");
    assert.throws(() => rt.restoreBackup(clientId, {}), /ไม่ถูกต้อง/);
    assert.throws(() => rt.restoreBackup(clientId, { clients: [{ id: "x" }] }), /ไม่ถูกต้อง/);
  });

  const monEntry = rt.createCalendarEntry(clientId, { entry: { date: bangkokMonday(0), time: "06:06", platform: "facebook", sku, angle: "โปรโมชัน/ข้อเสนอ OEM" } });
  rt.updateCalendarEntry(clientId, monEntry.id, { status: "published", caption: "สรุปสัปดาห์ทดสอบ: โปร OEM กระเป๋าผ้ารักษ์โลก สั่งขั้นต่ำ 50 ใบ" });
  const monFail = rt.createCalendarEntry(clientId, { entry: { date: bangkokMonday(0), time: "06:07", platform: "line", sku, angle: "เรื่องจากลูกค้า" } });
  rt.updateCalendarEntry(clientId, monFail.id, { status: "failed" });
  check("buildWeeklySummary + format", () => {
    const summary = rt.buildWeeklySummary(clientId, 0);
    assert.strictEqual(summary.clientId, clientId);
    assert.ok(summary.counts.published >= 1 && summary.counts.failed >= 1);
    assert.ok(summary.byPlatform.facebook >= 1);
    assert.ok(summary.publishedPosts.some((p) => p.caption.includes("สรุปสัปดาห์ทดสอบ")));
    const text = rt.formatWeeklySummaryText(summary);
    assert.ok(text.length <= 900, `summary text <= 900 (got ${text.length})`);
    assert.ok(text.includes(summary.clientName) && text.includes("📊"));
  });

  check("sendWeeklySummary guards", async () => {
    await assert.rejects(() => rt.sendWeeklySummary(clientId, {}), /LINE/);
  });
  // fake token on disk → dryRun gate (default on) blocks real send
  fs.writeFileSync(
    path.join(root, "app", "runtime-state", "social-agency", "connectors.json"),
    JSON.stringify({ version: 1, clients: { [clientId]: { line: { channelAccessToken: "fake-token" } } } }),
    "utf8"
  );
  const dryRes = await rt.sendWeeklySummary(clientId, {});
  check("sendWeeklySummary dryRun", () => {
    assert.strictEqual(dryRes.sent, false);
    assert.strictEqual(dryRes.reason, "dryRun");
    assert.ok(dryRes.text.includes("📊"));
  });

  const wsRes = await call("GET", `/api/social-agency/weekly-summary?clientId=${clientId}&weekOffset=0`);
  check("GET /weekly-summary", () => {
    assert.strictEqual(wsRes.statusCode, 200);
    assert.ok(wsRes.body.summary.counts.published >= 1);
    assert.ok(wsRes.body.text.length <= 900);
  });
  const wsSend = await call("POST", `/api/social-agency/weekly-summary/send?clientId=${clientId}`, { weekOffset: 0 });
  check("POST /weekly-summary/send (dryRun)", () => {
    assert.strictEqual(wsSend.statusCode, 202);
    assert.strictEqual(wsSend.body.sent, false);
  });
  const bkRes = await call("GET", `/api/social-agency/backup?clientId=${clientId}`);
  check("GET /backup", () => {
    assert.strictEqual(bkRes.statusCode, 200);
    assert.strictEqual(bkRes.body.backup.scope, "client");
  });
  const bksRes = await call("GET", "/api/social-agency/backups");
  check("GET /backups", () => {
    assert.strictEqual(bksRes.statusCode, 200);
    assert.ok(bksRes.body.backups.length >= 1);
  });
  const snapRes = await call("POST", "/api/social-agency/backup/snapshot", { clientId });
  check("POST /backup/snapshot", () => {
    assert.strictEqual(snapRes.statusCode, 201);
    assert.ok(snapRes.body.snapshot.file);
  });
  const noChangeSnap = rt.exportBackup();
  const restoreRes = await call("POST", "/api/social-agency/backup/restore", { snapshot: noChangeSnap });
  check("POST /backup/restore", () => {
    assert.strictEqual(restoreRes.statusCode, 200);
    assert.ok(restoreRes.body.restored.includes(clientId));
  });

  // ── live-publish gating regression (fix: per-platform secrets) ──
  check("_connectorConfigured matrix", () => {
    assert.strictEqual(rt._connectorConfigured("line", { channelAccessToken: "x" }), true);
    assert.strictEqual(rt._connectorConfigured("line", {}), false);
    assert.strictEqual(rt._connectorConfigured("facebook", { pageId: "1", accessToken: "x" }), true);
    assert.strictEqual(rt._connectorConfigured("facebook", { pageId: "1" }), false);
    assert.strictEqual(rt._connectorConfigured("instagram", { igUserId: "1", accessToken: "x" }), true);
    assert.strictEqual(rt._connectorConfigured("instagram", {}), false);
    assert.strictEqual(rt._connectorConfigured("demo", {}), true);
  });

  // configure both connectors for real (tokens + dryRun off) via the public path
  rt.saveConnectors(clientId, { connectors: {
    facebook: { pageId: "1234567890", accessToken: "fake-fb-token", dryRun: false },
    line: { channelAccessToken: "fake-line-token", dryRun: false },
  } });
  const fbLiveEntry = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(-1), time: "05:05", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
  const lineLiveEntry = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(-1), time: "05:06", platform: "line", sku, angle: "เคล็ดลับการใช้งาน" } });
  const futureEntry = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(5), time: "05:05", platform: "facebook", sku, angle: "เรื่องจากลูกค้า" } });

  const httpsCalls = [];
  const realHttps = SocialAgencyRuntime._https;
  SocialAgencyRuntime._https = async (opts = {}) => {
    httpsCalls.push(`${opts.host}${opts.path}`);
    if (opts.host === "graph.facebook.com") return { status: 200, json: { id: "fb_live_123" }, text: "{}" };
    if (opts.path === "/v2/bot/message/quota") return { status: 200, json: { value: 1000 }, text: "{}" };
    if (opts.path === "/v2/bot/message/quota/consumption") return { status: 200, json: { totalUsage: 5 }, text: "{}" };
    if (opts.path === "/v2/bot/message/broadcast") return { status: 200, json: {}, text: "{}" };
    throw new Error(`unexpected https call ${opts.host}${opts.path}`);
  };
  let fbLiveOut, lineLiveOut, dryOut, earlyOut;
  try {
    const getClient = () => rt._read().clients.find((c) => c.id === clientId);
    const entryById = (id) => getClient().calendar.find((e) => e.id === id);
    fbLiveOut = await rt._publishEntry(getClient(), { ...entryById(fbLiveEntry.id), caption: "โพสต์ทดสอบ live" }, { trigger: "schedule" });
    lineLiveOut = await rt._publishEntry(getClient(), { ...entryById(lineLiveEntry.id), caption: "ข้อความทดสอบสั้นๆ" }, { trigger: "schedule" });
    rt.saveConnectors(clientId, { connectors: { line: { dryRun: true } } });
    dryOut = await rt._publishEntry(getClient(), { ...entryById(lineLiveEntry.id), caption: "ข้อความทดสอบสั้นๆ" }, { trigger: "schedule" });
    earlyOut = await rt._publishEntry(getClient(), { ...entryById(futureEntry.id), caption: "โพสต์ล่วงหน้า" }, { trigger: "manual" });
  } finally {
    SocialAgencyRuntime._https = realHttps;
  }
  check("facebook publishes live when configured + dryRun off", () => {
    assert.strictEqual(fbLiveOut.mode, "live");
    assert.strictEqual(fbLiveOut.postId, "fb_live_123");
    assert.ok(httpsCalls.some((c) => c.includes("/feed")), `feed called: ${httpsCalls.join(",")}`);
  });
  check("line broadcasts live when configured + dryRun off", () => {
    assert.strictEqual(lineLiveOut.mode, "live");
    assert.ok(httpsCalls.some((c) => c.includes("/broadcast")), `broadcast called: ${httpsCalls.join(",")}`);
  });
  check("dryRun on forces dry mode", () => {
    assert.strictEqual(dryOut.mode, "dry");
  });
  check("manual early trigger forces dry mode", () => {
    assert.strictEqual(earlyOut.mode, "dry");
  });

  check("template imagePrompt is English-only (SD cannot read Thai)", () => {
    const angles = ["เปิดตัวสินค้า", "เบื้องหลังการผลิต", "เคล็ดลับการใช้งาน", "เรื่องจากลูกค้า", "โปรโมชัน/ข้อเสนอ OEM", "มุมที่ไม่มีในแผนที่"];
    for (const angle of angles) {
      const out = SocialAgencyRuntime._templateImagePrompt(
        { sku: "CAM-009", name: "กระเป๋ากล้อง CAM-009", category: "Camera bags" },
        { angle }
      );
      assert.ok(/^[\x00-\x7F]*$/.test(out), `ASCII-only prompt for angle "${angle}": ${out}`);
      assert.ok(out.includes("Camera bags"), `uses English category: ${out}`);
      assert.ok(out.includes("CAM-009"), `keeps SKU reference: ${out}`);
    }
    const fallback = SocialAgencyRuntime._templateImagePrompt(
      { sku: "สยาม-01", name: "กระเป๋าผ้า", category: "กระเป๋าผ้า" },
      { angle: "มุมประหลาด" }
    );
    assert.ok(/^[\x00-\x7F]*$/.test(fallback), `Thai-only input still yields ASCII: ${fallback}`);
  });

  check("template imagePrompts vary per entry (no repeats)", () => {
    const prod = { sku: "CAM-009", name: "กระเป๋ากล้อง CAM-009", category: "Camera bags" };
    const used = [];
    for (let i = 0; i < 12; i++) {
      const out = SocialAgencyRuntime._templateImagePrompt(prod, { angle: "เปิดตัวสินค้า", seed: `entry-${i}`, avoid: used });
      assert.ok(/^[\x00-\x7F]*$/.test(out), `ASCII-only: ${out}`);
      used.push(out);
    }
    assert.strictEqual(new Set(used).size, 12, "12 chained prompts are all distinct");
    const a = SocialAgencyRuntime._templateImagePrompt(prod, { angle: "เปิดตัวสินค้า", seed: "stable-1" });
    const b = SocialAgencyRuntime._templateImagePrompt(prod, { angle: "เปิดตัวสินค้า", seed: "stable-1" });
    assert.strictEqual(a, b, "same seed reproduces the same prompt");
  });
  check("template captions vary and never repeat siblings", () => {
    const prod = { sku: "CAM-009", name: "กระเป๋ากล้อง CAM-009", category: "Camera bags", minimumOrder: "100 ใบ", productionTime: "30 วัน" };
    const used = [];
    for (let i = 0; i < 15; i++) {
      const out = SocialAgencyRuntime._templateCaption(prod, { angle: "เปิดตัวสินค้า", platform: "facebook", tone: "เจ้าของแบรนด์", seed: `entry-${i}`, avoid: used });
      used.push(out);
    }
    assert.strictEqual(new Set(used).size, 15, "15 chained captions are all distinct");
  });

  console.log(`\nPASS: ${passed} checks (root: ${root})`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
