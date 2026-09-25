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

  check("static research fallback includes custom roles", () => {
    const client = { industry: "ผู้ผลิตถุงแบรนด์", researcherRoles: [
      { name: "นักวิจัยตลาด", questions: ["q1"] },
      { name: "นักวิจัยเทรนด์", questions: ["q2"] },
      { name: "นักออกแบบกราฟฟิก", questions: ["ใช้รูปเล่าใน 1 วิ", "ฟอนต์ที่ตัดกับเทรนด์"] },
    ] };
    const notes = rt._staticResearchNotes(client, "เปิดตัวสินค้า");
    assert.strictEqual(notes.length, 3);
    assert.deepStrictEqual(notes.map((n) => n.role), ["นักวิจัยตลาด", "นักวิจัยเทรนด์", "นักออกแบบกราฟฟิก"]);
    assert.ok(notes[2].notes.includes("ฟอนต์ที่ตัดกับเทรนด์"), "custom questions carried into fallback notes");
    assert.ok(notes[0].notes.includes("ชอบดูของจริง"), "built-in crafted notes unchanged");
  });
  check("llm research payload includes all roles (up to 8)", () => {
    const roles = Array.from({ length: 8 }, (_, i) => ({ name: `role-${i}`, questions: [`q${i}`] }));
    const payload = rt._researchPayload({ researcherRoles: roles });
    assert.strictEqual(payload.length, 8);
    assert.strictEqual(payload[7].role, "role-7");
    assert.deepStrictEqual(payload[0], { role: "role-0", questions: ["q0"] });
    const six = rt._researchPayload({ researcherRoles: roles.slice(0, 6) });
    assert.strictEqual(six.length, 6, "user with 6 roles keeps all of them");
  });

  check("entry image request body matches SD backend schema", () => {
    const body = rt._imageGenBody("a red bag on a table");
    assert.strictEqual(body.prompt, "a red bag on a table");
    assert.strictEqual(body.response_format, "b64_json");
    assert.strictEqual(body.size, "512x512");
    assert.strictEqual(body.n, 1);
    assert.ok(Number.isInteger(body.seed));
  });

  check("image gen body follows model presets (lightning 4 steps)", () => {
    const fb = rt._imageGenBody("x");
    assert.strictEqual(fb.steps, 20);
    assert.strictEqual(fb.cfg_scale, 7.0);
    assert.strictEqual(fb.size, "512x512");
    rt.setImageGenDefaultsProvider(() => ({ model: "DreamShaperXL_Lightning.safetensors" }));
    const li = rt._imageGenBody("x");
    assert.strictEqual(li.steps, 4);
    assert.strictEqual(li.cfg_scale, 1.5);
    assert.strictEqual(li.size, "1024x1024");
    rt.setImageGenDefaultsProvider(() => ({ model: "DreamShaperXL_Lightning.safetensors", steps: 6, cfgScale: 2, width: 768, height: 768, sampler: "dpmpp_2m" }));
    const ov = rt._imageGenBody("x");
    assert.strictEqual(ov.steps, 6);
    assert.strictEqual(ov.cfg_scale, 2);
    assert.strictEqual(ov.size, "768x768");
    assert.strictEqual(ov.sample_method, "dpmpp_2m");
    rt.setImageGenDefaultsProvider(null);
  });

  // ── async checks (awaited in main body; future sync checks go above this marker) ──
  await (async () => {
    const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const realFetch = globalThis.fetch;
    let seen = null;
    rt.setImageSaver(async (dataUrl) => {
      const name = `sa-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
      const file = path.join(root, name);
      fs.writeFileSync(file, Buffer.from(String(dataUrl).split(",")[1], "base64"));
      return { image: name, url: `/api/output-file?filename=${name}`, absPath: file };
    });
    const waitJob = async (eid) => {
      const t0 = Date.now();
      for (;;) {
        const { entry } = rt._findEntry(clientId, eid);
        if (entry.imageJob && entry.imageJob.status !== "running") return entry.imageJob;
        if (Date.now() - t0 > 15000) throw new Error("image job did not finish in 15s");
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    try {
      globalThis.fetch = async (url, opts) => {
        seen = { url: String(url), body: JSON.parse(opts.body) };
        return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: TINY_PNG, seed: 7 }] }) };
      };
      const e1 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(11), time: "10:30", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
      const started = rt.startEntryImageGen(clientId, e1.id);
      assert.strictEqual(started.status, "running");
      assert.strictEqual(rt.startEntryImageGen(clientId, e1.id).status, "running", "second start while running is a no-op");
      const job = await waitJob(e1.id);
      assert.strictEqual(job.status, "done");
      const { entry: done } = rt._findEntry(clientId, e1.id);
      assert.ok(done.imagePrompt && done.imagePrompt.length > 10, "prompt auto-built when missing");
      assert.ok(done.image.url.startsWith("/api/output-file?filename="));
      assert.ok(fs.existsSync(done.image.path));
      assert.ok(seen.url.endsWith("/v1/images/generations"));
      assert.strictEqual(seen.body.prompt, done.imagePrompt);
      assert.strictEqual(seen.body.response_format, "b64_json");
      fs.unlinkSync(done.image.path);
      const got = rt.getEntryImage(clientId, e1.id);
      assert.strictEqual(got.job.status, "done");
      assert.strictEqual(got.image.url, done.image.url);
      globalThis.fetch = async () => { throw new Error("backend down"); };
      const e2 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(12), time: "11:30", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
      rt.startEntryImageGen(clientId, e2.id);
      const job2 = await waitJob(e2.id);
      assert.strictEqual(job2.status, "error");
      assert.ok(job2.error.includes("backend down"), `error surfaced, got: ${job2.error}`);
    } finally {
      globalThis.fetch = realFetch;
      rt.setImageSaver(null);
    }
    passed += 1;
    console.log("  ok - entry image generation attaches preview (stubbed backend)");
  })();

  await (async () => {
    const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const imgFile = path.join(root, `sa-test-vid-${Date.now()}.png`);
    fs.writeFileSync(imgFile, Buffer.from(TINY_PNG, "base64"));
    let created = null;
    const script = ["queued", "running", "running", "completed"];
    let calls = 0;
    rt.setImageToVideoJobs({
      createJob: (payload) => { created = payload; return { id: "job-test-1", state: "queued" }; },
      prepare: (payload, jobId) => ({ outputPath: path.join(root, `${jobId}.mp4`), outputRelative: `app/outputs/video/${jobId}.mp4`, workerArgs: [], modelId: "svd" }),
      start: () => {},
      getJob: () => {
        const state = script[Math.min(calls++, script.length - 1)];
        return { id: "job-test-1", state, progress: { percent: state === "running" ? 42 : 100 }, output: state === "completed" ? { videoUrl: "app/outputs/video/job-test-1.mp4" } : null, error: null };
      },
      failJob: () => {},
    });
    rt.i2vPollMs = 20;
    try {
      const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(13), time: "12:30", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
      assert.throws(() => rt.startEntryVideoGen(clientId, e.id), /สร้างภาพนิ่งก่อน/);
      {
        const f = rt._findEntry(clientId, e.id);
        f.entry.image = { path: imgFile, filename: "x.png", url: "/api/output-file?filename=x.png" };
        rt._write(f.state);
      }
      const started = rt.startEntryVideoGen(clientId, e.id);
      assert.strictEqual(started.status, "running");
      const t0 = Date.now();
      let job;
      for (;;) {
        const { entry } = rt._findEntry(clientId, e.id);
        if (entry.videoJob && entry.videoJob.status !== "running") { job = entry.videoJob; break; }
        if (Date.now() - t0 > 15000) throw new Error("video job did not finish in 15s");
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.strictEqual(job.status, "done");
      assert.strictEqual(job.jobId, "job-test-1");
      assert.strictEqual(job.progress, 100);
      assert.strictEqual(created.modelId, "auto");
      assert.strictEqual(created.seconds, 5);
      assert.ok(String(created.imageDataUrl).startsWith("data:image/png;base64,"));
      const { entry: done } = rt._findEntry(clientId, e.id);
      assert.strictEqual(done.video.url, "/outputs/video/job-test-1.mp4");
      assert.strictEqual(done.video.jobId, "job-test-1");
      assert.ok(done.animatePrompt && /smooth camera motion/.test(done.animatePrompt), "video gen ensures animate prompt");
      const got = rt.getEntryVideo(clientId, e.id);
      assert.strictEqual(got.job.status, "done");
      assert.strictEqual(got.video.url, "/outputs/video/job-test-1.mp4");
      fs.unlinkSync(imgFile);
    } finally {
      rt.setImageToVideoJobs(null);
      delete rt.i2vPollMs;
    }
    passed += 1;
    console.log("  ok - entry video generation attaches preview (stubbed i2v)");
  })();


  check("entries get unique EN animate prompts with camera moves", () => {
    const s = rt.getState();
    const cal = s.clients.find((c) => c.id === clientId).calendar;
    assert.ok(cal.length >= 2, "need 2+ entries, got " + cal.length);
    for (const e of cal) {
      assert.ok(e.animatePrompt && !/[\u0E00-\u0E7F]/.test(e.animatePrompt), "EN-only animate prompt for " + e.id);
      assert.ok(/smooth camera motion/.test(e.animatePrompt), "motion suffix for " + e.id);
      assert.ok(e.animateCamera && e.animateCameraLabel, "camera id+label for " + e.id);
    }
    assert.strictEqual(new Set(cal.map((e) => e.animatePrompt)).size, cal.length, "prompts unique");
    assert.strictEqual(new Set(cal.map((e) => e.animateCamera)).size, cal.length, "cameras unique");
  });

  check("publish media selection prefers video, then image", () => {
    assert.strictEqual(rt._selectPublishMedia({}), "text");
    assert.strictEqual(rt._selectPublishMedia({ image: { path: "/tmp/x.jpg" } }), "image");
    assert.strictEqual(rt._selectPublishMedia({ video: { publicUrl: "https://x/y.mp4" } }), "video");
    assert.strictEqual(rt._selectPublishMedia({ image: { path: "/tmp/x.jpg" }, video: { path: "/tmp/x.mp4" } }), "video");
  });

  check("video file read + public host url parse", () => {
    const vf = path.join(root, "clip.mp4");
    fs.writeFileSync(vf, Buffer.from("fake-mp4-bytes"));
    const got = rt._entryVideoFile({ video: { path: vf } });
    assert.ok(got && got.buffer.length > 0, "reads video buffer");
    assert.strictEqual(got.filename, "clip.mp4");
    assert.strictEqual(rt._entryVideoFile({}), null);
    assert.strictEqual(rt._entryVideoFile({ video: { path: path.join(root, "nope.mp4") } }), null);
    assert.strictEqual(SocialAgencyRuntime._parsePublicFileUrl("https://0x0.st/abc123.mp4\n"), "https://0x0.st/abc123.mp4");
    assert.throws(() => SocialAgencyRuntime._parsePublicFileUrl("error"), /โฮสต์สาธารณะ/);
    fs.unlinkSync(vf);
  });

  check("stale running video job reconciles to error on read", () => {
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(4), time: "10:00", platform: "demo", sku, angle: "เปิดตัวสินค้า" } });
    const f = rt._findEntry(clientId, e.id);
    f.entry.videoJob = { status: "running", jobId: "job-stale-1", progress: 99, startedAt: new Date().toISOString(), finishedAt: null, error: "" };
    rt._write(f.state);
    rt.setImageToVideoJobs({ getJob: () => ({ state: "failed", error: { message: "The application restarted" } }) });
    try {
      const got = rt.getEntryVideo(clientId, e.id);
      assert.strictEqual(got.job.status, "error");
      assert.ok(/restarted/.test(got.job.error), "carries i2v reason: " + got.job.error);
      const f2 = rt._findEntry(clientId, e.id);
      assert.strictEqual(f2.entry.videoJob.status, "error");
    } finally {
      rt.setImageToVideoJobs(null);
    }
  });

  check("completed i2v job late-attaches video on read", () => {
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(5), time: "11:00", platform: "demo", sku, angle: "เคล็ดลับการใช้งาน" } });
    const f = rt._findEntry(clientId, e.id);
    f.entry.videoJob = { status: "running", jobId: "job-late-1", progress: 99, startedAt: new Date().toISOString(), finishedAt: null, error: "" };
    rt._write(f.state);
    rt.setImageToVideoJobs({ getJob: () => ({ state: "completed", output: { videoUrl: "app/outputs/video/late.mp4" } }) });
    try {
      const got = rt.getEntryVideo(clientId, e.id);
      assert.strictEqual(got.job.status, "done");
      assert.strictEqual(got.video.url, "/outputs/video/late.mp4");
    } finally {
      rt.setImageToVideoJobs(null);
    }
  });

  check("viral scorer rewards strong hooks, penalizes weak posts", () => {
    const good = "ใครกำลังมองหากระเป๋ากล้อง หยุดเลื่อนก่อน 10 วินาทีนะ 📷\nรุ่น CAM-009 ใส่เลนส์ได้ 3 ตัว ผ้ากันน้ำ ซิป YKK ทนๆ เลย\nทักแชทสอบถามได้ครับ มีแค่ 20 ใบ\n#กระเป๋ากล้อง #camerabag #ของมันต้องมี";
    const bad = "สินค้าดีมีคุณภาพ\nสนใจติดต่อ";
    const g = SocialAgencyRuntime._scoreViral(good, "facebook");
    const b = SocialAgencyRuntime._scoreViral(bad, "facebook");
    assert.ok(g.score >= 80, "good scores high, got " + g.score);
    assert.ok(b.score < 50, "bad scores low, got " + b.score);
    assert.strictEqual(g.breakdown.reduce((a, c) => a + c.points, 0), g.score);
    assert.strictEqual(b.breakdown.reduce((a, c) => a + c.points, 0), b.score);
  });

  check("template hooks are TH, unique and seed-stable", () => {
    const p = { name: "กระเป๋ากล้อง", category: "กระเป๋า" };
    const a = SocialAgencyRuntime._templateHooks(p, { angle: "เปิดตัวสินค้า", seed: "e1" });
    const b2 = SocialAgencyRuntime._templateHooks(p, { angle: "เปิดตัวสินค้า", seed: "e1" });
    const c = SocialAgencyRuntime._templateHooks(p, { angle: "เปิดตัวสินค้า", seed: "e2" });
    assert.strictEqual(a.length, 3);
    assert.deepStrictEqual(a, b2);
    assert.ok(a.every((h) => /[\u0E00-\u0E7F]/.test(h)), "thai hooks");
    assert.strictEqual(new Set(a).size, 3, "unique");
    assert.notDeepStrictEqual(a, c);
  });

  const he = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(6), time: "12:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
  {
    const f = rt._findEntry(clientId, he.id);
    f.entry.caption = "บรรทัดแรกเดิม\nเนื้อหาข้างในยาวพอสมควรมีรายละเอียดให้อ่านกันครับ #tag1";
    f.entry.captionManual = true;
    f.entry.hookVariants = [
      { text: "บรรทัดแรกเดิม", score: 40, used: true },
      { text: "ใครกำลังมองหากระเป๋า หยุดเลื่อนก่อนนะ", score: 85, used: false },
    ];
    rt._write(f.state);
  }
  const hookRes = await call("POST", "/api/social-agency/entry-hook", { clientId, entryId: he.id, index: 1 });
  check("POST /entry-hook swaps first line and rescores", () => {
    assert.strictEqual(hookRes.statusCode, 200);
    const { entry: ue } = rt._findEntry(clientId, he.id);
    assert.ok(ue.caption.startsWith("ใครกำลังมองหากระเป๋า"), "first line swapped");
    assert.ok(ue.viralScore && Number.isFinite(ue.viralScore.score), "rescored");
    assert.strictEqual(ue.hookVariants.filter((h) => h.used).length, 1);
    assert.strictEqual(ue.captionManual, true);
  });

  const pillars0 = rt.listPillars(clientId);
  check("pillar defaults backfilled", () => {
    assert.strictEqual(pillars0.length, 3);
    assert.deepStrictEqual(pillars0.map((p) => p.name), ["ขายตรง", "ให้ความรู้", "สร้างความเชื่อใจ"]);
    assert.deepStrictEqual(pillars0.map((p) => p.weight), [2, 2, 1]);
  });

  const p1 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(7), time: "10:00", platform: "facebook", sku, angle: "เคล็ดลับการใช้งาน" } });
  check("create assigns pillar containing the angle", () => {
    assert.strictEqual(p1.pillar, "ให้ความรู้");
    assert.strictEqual(p1.angle, "เคล็ดลับการใช้งาน");
  });

  const p2 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(8), time: "10:00", platform: "facebook", sku, pillar: "ขายตรง", angle: "เคล็ดลับการใช้งาน" } });
  check("create corrects angle outside the chosen pillar", () => {
    assert.strictEqual(p2.pillar, "ขายตรง");
    assert.ok(["เปิดตัวสินค้า", "โปรโมชัน/ข้อเสนอ OEM"].includes(p2.angle), "angle coerced: " + p2.angle);
  });

  check("weighted least-used pillar pick", () => {
    const r = SocialAgencyRuntime._pickPillar(pillars0, { "ขายตรง": 10, "ให้ความรู้": 0, "สร้างความเชื่อใจ": 0 }, { seed: "x" });
    assert.notStrictEqual(r.pillar, "ขายตรง");
    const r2 = SocialAgencyRuntime._pickPillar(pillars0, {}, { angle: "เรื่องจากลูกค้า", seed: "x" });
    assert.strictEqual(r2.pillar, "สร้างความเชื่อใจ");
    assert.strictEqual(r2.angle, "เรื่องจากลูกค้า");
  });

  const pAdd = await call("POST", "/api/social-agency/pillars", { clientId, name: "รีวิวลูกค้า", angles: ["เรื่องจากลูกค้า", "มุมผี"], weight: 3 });
  assert.strictEqual(pAdd.statusCode, 201);
  const pId = pAdd.body.pillar.id;
  const pList = await call("GET", `/api/social-agency/pillars?clientId=${clientId}`);
  const pPatch = await call("PATCH", `/api/social-agency/pillars/${pId}?clientId=${clientId}`, { weight: 5 });
  const pDel = await call("DELETE", `/api/social-agency/pillars/${pId}?clientId=${clientId}`, {});
  check("pillar CRUD routes + junk angles sanitized", () => {
    assert.deepStrictEqual(pAdd.body.pillar.angles, ["เรื่องจากลูกค้า"]);
    assert.strictEqual(pAdd.body.pillar.weight, 3);
    assert.ok(pList.body.pillars.some((p) => p.id === pId));
    assert.strictEqual(pPatch.statusCode, 200);
    assert.strictEqual(pPatch.body.pillar.weight, 5);
    assert.strictEqual(pDel.statusCode, 200);
    assert.ok(!rt.listPillars(clientId).some((p) => p.id === pId));
  });

  const rsrc = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(9), time: "10:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
  rt.updateCalendarEntry(clientId, rsrc.id, { caption: "ใครกำลังมองหากระเป๋ากล้อง หยุดเลื่อนก่อน 10 วินาทีนะ 📷\nรุ่น CAM-009 ใส่เลนส์ได้ 3 ตัว ผ้ากันน้ำ ซิป YKK ทนๆ เลย\nทักแชทสอบถามได้ครับ มีแค่ 20 ใบ\n#กระเป๋ากล้อง #camerabag #ของมันต้องมี" });
  const rep = await rt.repurposeEntry(clientId, rsrc.id, {});
  check("repurpose creates linked children with instant scores", () => {
    assert.strictEqual(rep.count, 3);
    assert.deepStrictEqual(rep.created.map((e) => e.platform).sort(), ["demo", "instagram", "line"]);
    for (const c of rep.created) {
      assert.strictEqual(c.repurposedFrom, rsrc.id);
      assert.strictEqual(c.captionManual, true);
      assert.strictEqual(c.angle, rsrc.angle);
      assert.ok(c.caption && c.caption.length >= 20, "child has caption");
      assert.ok(c.viralScore && Number.isFinite(c.viralScore.score), "child scored");
      assert.strictEqual(c.date, rsrc.date);
    }
    assert.strictEqual(new Set(rep.created.map((e) => e.time)).size, 3, "distinct times");
  });

  const bare = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(10), time: "10:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
  await assert.rejects(() => rt.repurposeEntry(clientId, bare.id, {}), /แคปชัน/);
  check("repurpose rejects caption-less source", () => {
    assert.ok(!rt.getState().clients.find((c) => c.id === clientId).calendar.some((e) => e.repurposedFrom === bare.id), "no children created");
  });

  const repRoute = await call("POST", "/api/social-agency/repurpose", { clientId, entryId: rsrc.id, platforms: ["line"] });
  check("POST /repurpose filters platforms via route", () => {
    assert.strictEqual(repRoute.statusCode, 201);
    assert.strictEqual(repRoute.body.count, 1);
    assert.strictEqual(repRoute.body.created[0].platform, "line");
    assert.strictEqual(repRoute.body.created[0].captionSource, "repurpose-template");
  });

  const repDate = await call("POST", "/api/social-agency/repurpose", { clientId, entryId: rsrc.id, platforms: ["instagram", "demo"], date: bangkokToday(11) });
  check("POST /repurpose honors date override", () => {
    assert.strictEqual(repDate.statusCode, 201);
    assert.strictEqual(repDate.body.count, 2);
    assert.ok(repDate.body.created.every((e) => e.date === bangkokToday(11)), "children on override date");
  });

  const m1 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(12), time: "10:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
  const m2 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(13), time: "10:00", platform: "instagram", sku, angle: "เคล็ดลับการใช้งาน" } });
  const m3 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(14), time: "10:00", platform: "line", sku, angle: "เรื่องจากลูกค้า" } });
  rt.updateCalendarEntry(clientId, m1.id, { status: "published", metrics: { likes: 100, comments: 10, shares: 5, views: 1000 } });
  rt.updateCalendarEntry(clientId, m2.id, { status: "published", metrics: { likes: 20, comments: 2, shares: 1 } });
  rt.updateCalendarEntry(clientId, m3.id, { metrics: { likes: 5 } });
  check("metrics patch validates + merges", () => {
    const g = (id) => rt._findEntry(clientId, id).entry.metrics;
    assert.strictEqual(g(m1.id).likes, 100);
    assert.strictEqual(g(m1.id).views, 1000);
    assert.strictEqual(g(m2.id).views, undefined);
    assert.ok(g(m3.id).recordedAt, "recordedAt stamped");
    assert.throws(() => rt.updateCalendarEntry(clientId, m1.id, { metrics: { likes: -1 } }), /ตัวเลข/);
    assert.throws(() => rt.updateCalendarEntry(clientId, m1.id, { metrics: { likes: "เยอะ" } }), /ตัวเลข/);
  });

  check("metrics merge keeps old numbers", () => {
    rt.updateCalendarEntry(clientId, m2.id, { metrics: { likes: 30 } });
    const m = rt._findEntry(clientId, m2.id).entry.metrics;
    assert.strictEqual(m.likes, 30);
    assert.strictEqual(m.comments, 2);
  });

  const mPatch = await call("PATCH", `/api/social-agency/calendar/${m3.id}?clientId=${clientId}`, { metrics: { shares: 2 } });
  check("PATCH calendar route saves metrics", () => {
    assert.strictEqual(mPatch.statusCode, 200);
    assert.strictEqual(mPatch.body.entry.metrics.shares, 2);
    assert.strictEqual(mPatch.body.entry.metrics.likes, 5);
  });

  const perfRes = await call("GET", `/api/social-agency/performance?clientId=${clientId}`);
  check("GET /performance aggregates + ranks + suggests", () => {
    assert.strictEqual(perfRes.statusCode, 200);
    const pf = perfRes.body.performance;
    assert.strictEqual(pf.measured, 3);
    assert.ok(Array.isArray(pf.pillars) && Array.isArray(pf.angles) && Array.isArray(pf.platforms));
    const sell = pf.pillars.find((p) => p.name === "ขายตรง");
    assert.strictEqual(sell.avg, 115);
    assert.strictEqual(pf.top[0].id, m1.id);
    assert.strictEqual(pf.bottom[0].id, m3.id);
    assert.ok(pf.suggestions.some((s) => s.includes("ขายตรง")), "suggests best pillar");
  });

  const prod = rt.addProduct(clientId, { name: "สินค้าทดสอบ", category: "ทดสอบ", price: "199" });
  check("product CRUD rejects duplicate sku", () => {
    assert.ok(prod.sku);
    assert.throws(() => rt.addProduct(clientId, { name: "ซ้ำ", sku: prod.sku }), /SKU/);
    const upd = rt.updateProduct(clientId, prod.sku, { price: "259" });
    assert.strictEqual(upd.price, "259");
    const del = rt.deleteProduct(clientId, prod.sku);
    assert.strictEqual(del.deleted, prod.sku);
    assert.ok(!rt.listProducts(clientId).some((p) => p.sku === prod.sku));
  });

  check("web extract parses JSON-LD products", () => {
    const html = `<html><head><title>ร้านทดสอบ</title><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "กระเป๋าผ้า", description: "ผ้าแคนวาส", image: "https://x.test/bag.jpg", offers: { price: "1290", priceCurrency: "THB" } })}</script></head><body><h1>ร้านทดสอบ</h1></body></html>`;
    const found = SocialAgencyRuntime._extractProducts(html, "https://x.test/p1");
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].name, "กระเป๋าผ้า");
    assert.strictEqual(found[0].price, "1290");
  });

  const http = require("http");
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/product-p2") res.end(`<html><head><title>P2</title></head><body><h1>หมวก</h1><p>฿199</p></body></html>`);
    else res.end(`<html><head><title>ร้าน</title></head><body><h1>เสื้อยืด</h1><p>฿350</p><a href="/product-p2">หมวก</a></body></html>`);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const siteBase = `http://127.0.0.1:${srv.address().port}`;
  let imp;
  try {
    imp = await rt.importUrl(clientId, { url: siteBase + "/", maxPages: 3 });
  } finally {
    srv.close();
  }
  check("import-url extracts + discovers same-site", () => {
    assert.ok(imp.products.some((p) => p.name === "เสื้อยืด"), JSON.stringify(imp.products));
    assert.ok(imp.products.some((p) => p.name === "หมวก"), "discovered p2");
    assert.strictEqual(imp.fetched, 2);
  });

  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-scan-"));
  fs.writeFileSync(path.join(scanDir, "กระเป๋าผ้า-1290.jpg"), "fake-bytes");
  fs.writeFileSync(path.join(scanDir, "ราคาสินค้า.csv"), "ชื่อ,ราคา,หมวด\nเสื้อยืด,350,เสื้อผ้า\nหมวก,199,เครื่องประดับ\n");
  const scan = await rt.scanFolder(clientId, { path: scanDir });
  check("scan-folder finds images + csv rows", () => {
    assert.strictEqual(scan.images.length, 1);
    assert.strictEqual(scan.images[0].name, "กระเป๋าผ้า");
    assert.strictEqual(scan.images[0].price, "1290");
    assert.strictEqual(scan.rows.length, 2);
    assert.strictEqual(scan.rows[0].name, "เสื้อยืด");
  });

  const impRes = rt.importProducts(clientId, { products: [...scan.images, ...scan.rows] });
  check("import batch adds products + copies image", () => {
    assert.strictEqual(impRes.count, 3);
    const withImg = rt.listProducts(clientId).find((p) => p.name === "กระเป๋าผ้า");
    assert.ok(withImg.image.startsWith("/sa-products/"), withImg.image);
    assert.ok(fs.existsSync(path.join(root, "app", "outputs", "sa-products", clientId, withImg.sku + ".jpg")));
  });

  const nextMonth = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const fbClient = rt.getState().clients.find((c) => c.id === clientId);
  const fb = rt._buildFallbackSlots(fbClient, nextMonth, 3);
  check("fallback covers every product before repeat", () => {
    const skus = fbClient.products.map((p) => p.sku);
    assert.ok(fb.length >= skus.length, `slots ${fb.length} >= products ${skus.length}`);
    const first = fb.slice(0, skus.length).map((s) => s.sku);
    assert.deepStrictEqual([...first].sort(), [...skus].sort());
    const counts = {};
    for (const s of fb) counts[s.sku] = (counts[s.sku] || 0) + 1;
    const vals = Object.values(counts);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, "balanced: " + JSON.stringify(counts));
  });

  rt.createCalendarEntry(clientId, { entry: { date: `${nextMonth}-05`, time: "18:30", platform: "demo", sku, angle: "เปิดตัวสินค้า" } });
  rt.createCalendarEntry(clientId, { entry: { date: `${nextMonth}-06`, time: "18:30", platform: "demo", sku, angle: "เปิดตัวสินค้า" } });
  const fb2 = rt._buildFallbackSlots(rt.getState().clients.find((c) => c.id === clientId), nextMonth, 3);
  check("fallback prioritizes least-used products", () => {
    assert.ok(fb2.length > 0);
    assert.notStrictEqual(fb2[0].sku, sku, "heavy product goes last");
  });

  // ── P5d: listing-page import (nested anchors + encoded URLs, 127.0.0.1 fixture) ──
  // (reuses `http` already required above in main)
  const detailHtml = (code) => `<html><head><title>กระเป๋าใส่แผ่นซีดี ${code} | Thai Modern Bags</title><meta property="og:title" content="กระเป๋าใส่แผ่นซีดี ${code}"><meta property="og:description" content="รายละเอียด ${code}"></head><body><h1>กระเป๋าใส่แผ่นซีดี ${code}</h1></body></html>`;
  const listingHtml = `<html><head><title>รายการสินค้าหมวดซีดี</title></head><body>` +
    `<a href="/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2/cdb-001.html"><img src="http://x/y.jpg" alt="กระเป๋าใส่แผ่นซีดี CDB-001"></a>` +
    `<a href="/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2/cdb-002.html"><span>กระเป๋าใส่แผ่นซีดี CDB-002</span></a>` +
    `<a href="/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2/cdb-003.html">กระเป๋าใส่แผ่นซีดี CDB-003</a>` +
    `<a href="/about.html">เกี่ยวกับเรา</a></body></html>`;
  const listingSrv = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (String(req.url || "").startsWith("/listing")) res.end(listingHtml);
    else {
      const code = (String(req.url || "").match(/cdb-\d+/i) || ["CDB-000"])[0].toUpperCase();
      res.end(detailHtml(code));
    }
  });
  await new Promise((resolve) => listingSrv.listen(0, "127.0.0.1", resolve));
  const listingBase = `http://127.0.0.1:${listingSrv.address().port}`;
  let listingRes = null;
  try {
    listingRes = await rt.importUrl(clientId, { url: `${listingBase}/listing.html`, maxPages: 5 });
  } finally { listingSrv.close(); }
  check("listing import yields separate items", () => {
    const names = listingRes.products.map((p) => p.name);
    assert.ok(names.some((n) => n.includes("CDB-001")), "img-alt anchor: " + JSON.stringify(names));
    assert.ok(names.some((n) => n.includes("CDB-002")), "nested-span anchor: " + JSON.stringify(names));
    assert.ok(names.some((n) => n.includes("CDB-003")), "plain anchor: " + JSON.stringify(names));
    assert.ok(!names.some((n) => n.includes("เกี่ยวกับเรา")), "nav link excluded: " + JSON.stringify(names));
    assert.ok(listingRes.products.length >= 3, "got " + listingRes.products.length);
    assert.ok(listingRes.fetched >= 2, "crawl followed links, fetched=" + listingRes.fetched);
  });

  // ── P5e: deep import follows two levels (top -> subs -> leaves) ──
  const deepTop = `<html><head><title>ร้านทั้งร้าน</title></head><body>` +
    `<a href="/สินค้า/sub1.html">หมวดซีดี</a>` +
    `<a href="/สินค้า/sub2.html">หมวดดินสอ</a></body></html>`;
  const deepSub = (leafs) => `<html><head><title>หมวดย่อย</title></head><body>` +
    leafs.map((c) => `<a href="/สินค้า/${c}.html"><span>กระเป๋า ${c.toUpperCase()}</span></a>`).join("") + `</body></html>`;
  const deepDetail = (code) => `<html><head><title>กระเป๋า ${code}</title><meta property="og:title" content="กระเป๋า ${code}"></head><body><h1>กระเป๋า ${code}</h1></body></html>`;
  const deepSrv = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    const u = String(req.url || "");
    if (u.startsWith("/top")) res.end(deepTop);
    else if (u.includes("sub1")) res.end(deepSub(["cdb-001", "cdb-002"]));
    else if (u.includes("sub2")) res.end(deepSub(["pnc-001", "pnc-002"]));
    else {
      const code = (u.match(/(cdb|pnc)-\d+/i) || ["X-0"])[0].toUpperCase();
      res.end(deepDetail(code));
    }
  });
  await new Promise((resolve) => deepSrv.listen(0, "127.0.0.1", resolve));
  const deepBase = `http://127.0.0.1:${deepSrv.address().port}`;
  let deepRes = null;
  try {
    deepRes = await rt.importUrl(clientId, { url: `${deepBase}/top.html`, deep: true });
  } finally { deepSrv.close(); }
  check("deep import follows two levels", () => {
    const names = deepRes.products.map((p) => p.name);
    for (const c of ["CDB-001", "CDB-002", "PNC-001", "PNC-002"]) {
      assert.ok(names.some((n) => n.includes(c)), "missing " + c + ": " + JSON.stringify(names));
    }
    assert.strictEqual(deepRes.fetched, 7, "1 top + 2 subs + 4 leaves, fetched=" + deepRes.fetched);
  });

  // ── P5g: nav/chrome links don't crowd out product cards ──
  let navDecoys = "";
  for (let i = 1; i <= 12; i++) navDecoys += `<a href="/สินค้า/cat${i}.html">หมวด ${i}</a>`;
  const navTop = `<html><head><title>หมวดซีดี</title></head><body>` +
    `<header><a href="/สินค้า/catH.html">หมวด H</a></header>` +
    `<nav class="menu">${navDecoys}</nav>` +
    `<aside><a href="/สินค้า/catA.html">หมวด A</a></aside>` +
    `<main><a href="/สินค้า/cdb-001.html"><img src="http://x/y.jpg" alt="กระเป๋าใส่แผ่นซีดี CDB-001"></a>` +
    `<a href="/สินค้า/cdb-002.html"><span>กระเป๋าใส่แผ่นซีดี CDB-002</span></a></main>` +
    `<footer><a href="/สินค้า/catF.html">หมวด F</a></footer></body></html>`;
  const navSrv = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (String(req.url || "").startsWith("/navtop")) res.end(navTop);
    else {
      const code = (String(req.url || "").match(/cdb-\d+/i) || ["CDB-000"])[0].toUpperCase();
      res.end(`<html><head><title>กระเป๋า ${code}</title><meta property="og:title" content="กระเป๋า ${code}"></head><body></body></html>`);
    }
  });
  await new Promise((resolve) => navSrv.listen(0, "127.0.0.1", resolve));
  const navBase = `http://127.0.0.1:${navSrv.address().port}`;
  let navRes = null;
  try {
    navRes = await rt.importUrl(clientId, { url: `${navBase}/navtop.html`, maxPages: 5 });
  } finally { navSrv.close(); }
  check("nav links don't crowd out product cards", () => {
    const names = navRes.products.map((p) => p.name);
    assert.ok(names.some((n) => n.includes("CDB-001")), "leaf 1: " + JSON.stringify(names));
    assert.ok(names.some((n) => n.includes("CDB-002")), "leaf 2: " + JSON.stringify(names));
    assert.ok(!names.some((n) => n.includes("หมวด ")), "chrome decoys excluded: " + JSON.stringify(names));
    assert.strictEqual(navRes.fetched, 3, "1 page + 2 leaves, fetched=" + navRes.fetched);
  });

  // ── P5h: enrich fills missing details from source pages ──
  const enrichSrv = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    const u = String(req.url || "");
    if (u.includes("jsonld")) {
      res.end(`<html><head><title>J</title><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "กระเป๋า JSON", description: "รายละเอียด JSON", image: "https://x.test/j.jpg", offers: { price: "990", priceCurrency: "THB" } })}</script></head><body></body></html>`);
    } else if (u.includes("meta")) {
      res.end(`<html><head><title>M</title><meta property="og:title" content="กระเป๋า M"><meta property="og:description" content="รายละเอียด M"><meta property="og:image" content="https://x.test/m.jpg"></head><body><h1>กระเป๋า M</h1><p>฿199</p></body></html>`);
    } else {
      res.writeHead(404); res.end("nope");
    }
  });
  await new Promise((resolve) => enrichSrv.listen(0, "127.0.0.1", resolve));
  const enrichBase = `http://127.0.0.1:${enrichSrv.address().port}`;
  const ep1 = rt.addProduct(clientId, { name: "E1", sourceUrl: `${enrichBase}/jsonld.html` });
  const ep2 = rt.addProduct(clientId, { name: "E2", sourceUrl: `${enrichBase}/meta.html` });
  const ep3 = rt.addProduct(clientId, { name: "E3", sourceUrl: `${enrichBase}/missing.html` });
  const ep4 = rt.addProduct(clientId, { name: "E4" });
  let enrichRes = null;
  try {
    enrichRes = await rt.enrichProducts(clientId, { limit: 10, skus: [ep1.sku, ep2.sku, ep3.sku, ep4.sku] });
  } finally { enrichSrv.close(); }
  check("enrich fills missing details", () => {
    assert.strictEqual(enrichRes.enrichedCount, 2, JSON.stringify(enrichRes));
    assert.strictEqual(enrichRes.failed.length, 1);
    assert.strictEqual(enrichRes.remaining, 0);
    const after = rt.getState().clients.find((c) => c.id === clientId).products;
    const g = (sku) => after.find((p) => p.sku === sku);
    assert.strictEqual(g(ep1.sku).detail, "รายละเอียด JSON");
    assert.strictEqual(g(ep1.sku).price, "990");
    assert.strictEqual(g(ep1.sku).image, "https://x.test/j.jpg");
    assert.strictEqual(g(ep2.sku).detail, "รายละเอียด M");
    assert.strictEqual(g(ep2.sku).price, "199");
    assert.strictEqual(g(ep2.sku).name, "E2", "name untouched");
    assert.strictEqual(g(ep4.sku).detail, "", "no-source product skipped");
  });

  // ── P5i: bulk delete (products + calendar) ──
  const bdA = rt.addProduct(clientId, { name: "BD-A" });
  const bdB = rt.addProduct(clientId, { name: "BD-B" });
  const bdC = rt.addProduct(clientId, { name: "BD-C" });
  rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(20), time: "18:30", platform: "demo", sku: bdA.sku, angle: "เปิดตัวสินค้า" } });
  const bdDel = rt.deleteProductsBatch(clientId, { skus: [bdA.sku, bdC.sku, "NOPE"] });
  check("products bulk delete", () => {
    assert.deepStrictEqual([...bdDel.deleted].sort(), [bdA.sku, bdC.sku].sort());
    assert.deepStrictEqual(bdDel.notFound, ["NOPE"]);
    assert.strictEqual(bdDel.orphans, 1);
    const skus = rt.getState().clients.find((c) => c.id === clientId).products.map((p) => p.sku);
    assert.ok(!skus.includes(bdA.sku) && !skus.includes(bdC.sku) && skus.includes(bdB.sku));
  });
  const be1 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(21), time: "18:30", platform: "demo", sku: bdB.sku, angle: "เปิดตัวสินค้า" } });
  const be2 = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(22), time: "18:30", platform: "demo", sku: bdB.sku, angle: "เปิดตัวสินค้า" } });
  const stW = rt.getState();
  stW.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === be2.id).inFlight = true;
  rt._write(stW);
  const beDel = rt.deleteCalendarEntriesBatch(clientId, { ids: [be1.id, be2.id, "NOPE"] });
  check("calendar bulk delete skips in-flight", () => {
    assert.deepStrictEqual(beDel.deleted, [be1.id]);
    assert.deepStrictEqual(beDel.skipped, [be2.id]);
    assert.deepStrictEqual(beDel.notFound, ["NOPE"]);
    const ids = rt.getState().clients.find((c) => c.id === clientId).calendar.map((e) => e.id);
    assert.ok(!ids.includes(be1.id) && ids.includes(be2.id));
  });

  // ── P5m: product link repair (fix wrong category-page sourceUrls) ──
  const fx1 = rt.addProduct(clientId, { name: "กระเป๋าใส่อุปกรณ์กีฬา SPB-002", sourceUrl: "https://shop.example/cat/spb.html" });
  const fx2 = rt.addProduct(clientId, { name: "สินค้าไม่มีในหน้า", sourceUrl: "https://shop.example/cat/other.html" });
  rt._fetchHtml = async () => `<html><body><nav><a href="/cat/other.html">เมนู</a></nav><main>
    <a href="/cat/spb-002.html">กระเป๋าใส่อุปกรณ์กีฬา SPB-002</a>
    <a href="/cat/spb-003.html">กระเป๋าใส่อุปกรณ์กีฬา SPB-003</a>
  </main></body></html>`;
  const fxRes = await rt.fixProductsUrls(clientId, {});
  check("product links fixed from listing page", () => {
    const cFx = rt.getState().clients.find((c) => c.id === clientId);
    const pFx = cFx.products.find((p) => p.sku === fx1.sku);
    assert.strictEqual(pFx.sourceUrl, "https://shop.example/cat/spb-002.html");
    assert.ok(fxRes.fixed >= 1 && fxRes.unfound.includes(fx2.sku));
  });
  const fxRoute = await call("POST", "/api/social-agency/products/fix-links?clientId=" + clientId, { skus: [fx1.sku] });
  check("product fix-links route", () => {
    assert.strictEqual(fxRoute.statusCode, 200);
    assert.strictEqual(fxRoute.body.ok, true);
    assert.strictEqual(fxRoute.body.fixed, 0); // already correct -> no change
  });

  // ── P5n: code-token fallback (SEO-suffixed names still match their leaf link) ──
  rt._fetchHtml = async () => `<html><body><main>
    <a href="/cat/spb-002.html">กระเป๋าใส่อุปกรณ์กีฬา SPB-002</a>
    <a href="/cat/อะไรก็ได้อื่น-spb-004-รีวิวสินค้า.pdf">SPB-004 รีวิว</a>
    <a href="/cat/กระเป๋าใส่อุปกรณ์กีฬา-spb-004.html">กระเป๋า SPB-004</a>
  </main></body></html>`;
  const seo1 = rt.addProduct(clientId, { name: "โรงงานผลิตกระเป๋าใส่อุปกรณ์กีฬา SPB-004 - Thai Modern Bags Co., Ltd.", sourceUrl: "https://shop.example/cat/spb.html" });
  const nRes = await rt.fixProductsUrls(clientId, { skus: [seo1.sku] });
  check("product code fallback fixes SEO-titled rows", () => {
    const pSeo = rt.getState().clients.find((c) => c.id === clientId).products.find((x) => x.sku === seo1.sku);
    assert.ok(/-spb-004\.html$/.test(pSeo.sourceUrl));
    assert.strictEqual(nRes.fixed, 1);
  });

  // ── P5p: long percent-encoded Thai URLs survive; download links are ignored ──
  const longLeaf = "/รายการสินค้าและผลิตภัณฑ์กระเป๋า/กระเป๋าใส่อุปกรณ์กีฬา/ผลิตภัณฑ์/" + encodeURIComponent("กระเป๋าใส่อุปกรณ์กีฬา-spb-010") + ".html";
  rt._fetchHtml = async () => `<html><body><main>
    <a href="/product/download/file_id-9.html">กระเป๋าใส่อุปกรณ์กีฬา SPB-010</a>
    <a href="${longLeaf}">กระเป๋าใส่อุปกรณ์กีฬา SPB-010</a>
  </main></body></html>`;
  const longRow = rt.addProduct(clientId, { name: "กระเป๋าใส่อุปกรณ์กีฬา SPB-010", sourceUrl: "https://shop.example/cat/spb.html" });
  const longRes = await rt.fixProductsUrls(clientId, { skus: [longRow.sku] });
  const longSaved = rt.getState().clients.find((c) => c.id === clientId).products.find((x) => x.sku === longRow.sku);
  check("long thai leaf url kept intact, download link skipped", () => {
    assert.strictEqual(longRes.fixed, 1);
    assert.ok(longSaved.sourceUrl.length > 500, `expected >500 chars, got ${longSaved.sourceUrl.length}`);
    assert.ok(/-spb-010\.html$/.test(longSaved.sourceUrl), "tail must survive");
    assert.ok(!/download|file_id/i.test(longSaved.sourceUrl), "download junk must be skipped");
  });

  // ── P5q: enrich overwrite mode refreshes rows that already have text ──
  rt._fetchHtml = async () => `<html><head><meta property="og:title" content="กระเป๋า SPB-099"><meta property="og:description" content="คำอธิบายใหม่จากหน้าใบสินค้า"></head><body><h1>กระเป๋า SPB-099</h1></body></html>`;
  const qRow = rt.addProduct(clientId, { name: "กระเป๋า SPB-099", sourceUrl: "https://shop.example/cat/กระเป๋า-spb-099.html" });
  rt.updateProduct(clientId, qRow.sku, { detail: "ของเดิมที่ดึงมาผิด" });
  const pickDetail = () => rt.getState().clients.find((c) => c.id === clientId).products.find((x) => x.sku === qRow.sku).detail;
  await rt.enrichProducts(clientId, { limit: 10, skus: [qRow.sku] });
  const afterDefault = pickDetail();
  await rt.enrichProducts(clientId, { limit: 10, skus: [qRow.sku], overwrite: true });
  const afterOverwrite = pickDetail();
  check("enrich overwrite refreshes rows that already have text", () => {
    assert.strictEqual(afterDefault, "ของเดิมที่ดึงมาผิด");
    assert.ok(/คำอธิบายใหม่/.test(afterOverwrite), `unexpected: ${afterOverwrite}`);
  });

  // ── P5r: leaf-page enrich wins over same-name anchor + honest failure reason ──
  const rLeafUrl = "https://shop.example/cat/spb/กระเป๋า-spb-077.html";
  rt._fetchHtml = async () => `<html><head><title>กระเป๋า SPB-077</title>
    <meta property="og:title" content="กระเป๋า SPB-077">
    <meta property="og:description" content="คำอธิบายจาก og ของหน้าใบสินค้า ใช้ทดสอบการ merge ข้อมูล">
  </head><body>
    <main><a href="${rLeafUrl}"><img src="https://img.example/a.jpg" alt="กระเป๋า SPB-077">กระเป๋า SPB-077</a></main>
  </body></html>`;
  const rRow = rt.addProduct(clientId, { name: "กระเป๋า SPB-077", sourceUrl: rLeafUrl });
  const rRes = await rt.enrichProducts(clientId, { limit: 10, skus: [rRow.sku], overwrite: true });
  check("leaf page enrich merges anchor + page description", () => {
    const row = rt.getState().clients.find((c) => c.id === clientId).products.find((x) => x.sku === rRow.sku);
    assert.strictEqual(rRes.enrichedCount, 1);
    assert.ok(/คำอธิบายจาก og/.test(String(row.detail)), `unexpected detail: ${row.detail}`);
    assert.strictEqual(row.image, "https://img.example/a.jpg");
  });
  rt._fetchHtml = async () => `<html><body><main><p>สั้นเกิน</p></main></body></html>`;
  const rRow2 = rt.addProduct(clientId, { name: "สินค้าหน้าเปล่า SPB-078", sourceUrl: "https://shop.example/cat/spb.html" });
  const rRes2 = await rt.enrichProducts(clientId, { limit: 10, skus: [rRow2.sku] });
  check("empty leaf page reports a reason instead of fake success", () => {
    assert.strictEqual(rRes2.enrichedCount, 0);
    assert.strictEqual(rRes2.failed.length, 1);
    assert.ok(/ไม่มีข้อมูล/.test(rRes2.failed[0].error), `unexpected error: ${rRes2.failed[0].error}`);
  });

  // ── P5s: probe reports exactly what the fetcher sees ──
  const spUrl = "https://shop.example/cat/ผลิตภัณฑ์/กระเป๋า-spb-088.html";
  const spRow = rt.addProduct(clientId, { name: "กระเป๋า SPB-088", sourceUrl: spUrl });
  rt._fetchDetailed = async () => ({
    status: 200,
    finalUrl: spUrl,
    text: `<html><head><title>กระเป๋า SPB-088</title><meta property="og:description" content="คำอธิบายยาว ๆ สำหรับทดสอบ probe ของหน้าใบสินค้าจริง"></head>
      <body><main><img src="https://img.example/big.jpg" width="600" height="600" alt="p"></main></body></html>`,
  });
  const probe = await rt.probeProductFetch(clientId, { sku: spRow.sku });
  check("probe reports status, tags and what enrich would write", () => {
    assert.strictEqual(probe.httpStatus, 200);
    assert.ok(probe.linkLooksLikeLeaf);
    assert.ok(probe.ogDescription.startsWith("คำอธิบายยาว"));
    assert.ok(probe.candidates.length >= 1);
    assert.strictEqual(probe.imageGuess, "https://img.example/big.jpg");
    assert.ok(/คำอธิบายยาว/.test(probe.wouldWrite), `wouldWrite: ${probe.wouldWrite}`);
    assert.ok(probe.verdict.startsWith("ดึงได้ปกติ"), `verdict: ${probe.verdict}`);
    assert.ok(probe.htmlFile.endsWith(".html"));
  });
  rt._fetchDetailed = async () => { throw new Error("HTTP 403"); };
  const probeBlocked = await rt.probeProductFetch(clientId, { sku: spRow.sku });
  check("probe explains a blocked fetch", () => {
    assert.strictEqual(probeBlocked.httpStatus, undefined);
    assert.ok(/403/.test(probeBlocked.fetchError));
    assert.ok(/เปิดหน้าไม่ได้จากเครื่องนี้/.test(probeBlocked.verdict));
  });

  // ── P5t: a capped pass must reach the tail rows, and stop early when done ──
  const tCodes = [1, 2, 3].map((i) => rt.addProduct(clientId, { name: `กระเป๋าทดสอบ SPB-07${i}`, sourceUrl: `https://shop.example/t/spb-07${i}.html` }));
  const tSkus = tCodes.map((x) => x.sku);
  rt._fetchHtml = async () => `<html><head><title>หน้าทดสอบ</title><meta property="og:description" content="คำอธิบายจากหน้าทดสอบ สำหรับ P5t smoke"></head><body><main><p>ย่อหน้าเนื้อหาสินค้าที่มีความยาวพอจะผ่านเกณฑ์ตัวดึงข้อมูลของระบบ</p></main></body></html>`;
  const t1 = await rt.enrichProducts(clientId, { limit: 2, cooldownMinutes: 5, skus: tSkus });
  const t2 = await rt.enrichProducts(clientId, { limit: 2, cooldownMinutes: 5, skus: tSkus });
  const t3 = await rt.enrichProducts(clientId, { limit: 2, cooldownMinutes: 5, skus: tSkus });
  check("capped enrich pass advances then stops (no starved tail)", () => {
    assert.strictEqual(t1.checked, 2);
    assert.strictEqual(t2.checked, 1, `round 2 should pick the remaining row, got ${t2.checked}`);
    assert.strictEqual(t2.enrichedCount, 1);
    assert.strictEqual(t3.checked, 0, "cooldown must stop the loop instead of re-reading the same rows");
    const rows = tSkus.map((s) => rt.getState().clients.find((c) => c.id === clientId).products.find((p) => p.sku === s));
    assert.ok(rows.every((r) => /คำอธิบายจากหน้าทดสอบ/.test(String(r.detail))), JSON.stringify(rows.map((r) => r.detail)));
  });
  rt._fetchHtml = async () => `<html><head><title>x</title>
    <meta property="og:description" content="โรงงานผลิตกระเป๋าใส่แผ่นซีดี CDB-009 สำหรับลูกค้าทุกกลุ่ม รับทำและออกแบบตามออเดอร์">
  </head><body><main><h1>กระเป๋าทดสอบ SPB-090</h1><p>กระเป๋าใส่อุปกรณ์กีฬา SPB-090 ผลิตตามสั่ง กันน้ำ บุโฟม เหมาะกับทีมกีฬาและงานอีเวนต์</p></main></body></html>`;
  const mRow = rt.addProduct(clientId, { name: "กระเป๋าทดสอบ SPB-090", sourceUrl: "https://shop.example/t/spb-090.html" });
  const mRes = await rt.enrichProducts(clientId, { limit: 5, cooldownMinutes: 0, skus: [mRow.sku] });
  check("mismatched shop SEO text is replaced by on-page text and flagged", () => {
    const row = rt.getState().clients.find((c) => c.id === clientId).products.find((p) => p.sku === mRow.sku);
    assert.ok(/SPB-090/.test(String(row.detail)), `detail: ${row.detail}`);
    assert.ok(!/CDB-009/.test(String(row.detail)), "must not keep the wrong product's description");
    assert.strictEqual(mRes.mismatch.length, 1);
    assert.strictEqual(mRes.mismatch[0].sku, mRow.sku);
  });

  // ── P5u: junk links are refused with a real reason, then relinked by product code ──
  const uListing = `<html><head><title>หมวดสินค้า</title></head><body><main>
    <a href="/cat/ผลิตภัณฑ์/กระเป๋า-uux-021.html">กระเป๋าอเนกประสงค์ UUX-021</a>
    <a href="/cat/ผลิตภัณฑ์/กระเป๋า-uux-022.html">กระเป๋าอเนกประสงค์ UUX-022</a>
    <a href="/cat/ผลิตภัณฑ์/กระเป๋า-uux-023.html">กระเป๋าอเนกประสงค์ UUX-023</a>
    <a href="/cat/ผลิตภัณฑ์/กระเป๋า-uux-024.html">กระเป๋าอเนกประสงค์ UUX-024</a></main></body></html>`;
  const uGood = rt.addProduct(clientId, { name: "กระเป๋าอเนกประสงค์ UUX-020", sourceUrl: "https://shop.example/cat/ผลิตภัณฑ์/กระเป๋า-uux-020.html" });
  const uJunk = rt.addProduct(clientId, { name: "กระเป๋าอเนกประสงค์ UUX-021", sourceUrl: "https://shop.example/product/download/file_id-77.html", detail: "ข้อความโรงงานทั่วไปที่ไม่ใช่ของรุ่นนี้" });
  let uFetches = 0;
  rt._fetchHtml = async () => { uFetches += 1; return uListing; };
  const uSkip = await rt.enrichProducts(clientId, { limit: 10, overwrite: true, cooldownMinutes: 0, skus: [uJunk.sku] });
  check("asset/download link is skipped with a reason and never fetched", () => {
    assert.strictEqual(uSkip.skippedLinkCount, 1, JSON.stringify(uSkip));
    assert.match(uSkip.skippedLink[0].reason, /ไม่ใช่หน้าสินค้า/);
    assert.strictEqual(uFetches, 0, "a junk link must not be fetched at all");
    assert.strictEqual(uSkip.enrichedCount, 0);
  });
  rt._fetchHtml = async (u) => (/download/i.test(u) ? "<html><body><p>ไฟล์สเปคสำหรับดาวน์โหลด</p></body></html>" : uListing);
  const uFix = await rt.fixProductsUrls(clientId, { skus: [uJunk.sku, uGood.sku] });
  check("fix-links relinks the broken row by product code (same origin) and drops the wrong text", () => {
    assert.ok(uFix.relinkedByCode.includes(uJunk.sku), JSON.stringify(uFix.relinkedByCode));
    const row = rt.getState().clients.find((c) => c.id === clientId).products.find((x) => x.sku === uJunk.sku);
    assert.match(decodeURIComponent(row.sourceUrl), /-uux-021\.html$/);
    assert.ok(row.sourceUrl.startsWith("https://shop.example/"), "must never link a row to another domain");
    assert.strictEqual(String(row.detail || "").trim(), "", "text taken from the wrong page must be cleared");
  });
  const uCat = rt.addProduct(clientId, { name: "กระเป๋าทดสอบหน้าหมวด UUX-099", sourceUrl: "https://shop.example/cat/รายการสินค้า.html" });
  const uList = await rt.enrichProducts(clientId, { limit: 10, cooldownMinutes: 0, skus: [uCat.sku] });
  check("a category page is refused instead of copying a sibling product's text", () => {
    assert.strictEqual(uList.enrichedCount, 0);
    assert.ok(uList.failed.some((f) => f.sku === uCat.sku && /หน้าหมวด/.test(f.error)), JSON.stringify(uList.failed));
    const row = rt.getState().clients.find((c) => c.id === clientId).products.find((x) => x.sku === uCat.sku);
    assert.strictEqual(String(row.detail || "").trim(), "");
  });

  console.log(`\nPASS: ${passed} checks (root: ${root})`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
