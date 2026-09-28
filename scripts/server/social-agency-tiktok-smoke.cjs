// TikTok Direct Post: isolated state and fully mocked HTTPS. Never calls TikTok or posts live.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("./social-agency-runtime.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-tiktok-"));
  const rt = new SocialAgencyRuntime({ root });
  const originalHttps = SocialAgencyRuntime._https;
  try {
    const clientId = rt.getState().activeClientId;
    const sku = rt.getState().clients[0].products[0].sku;
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const file = path.join(root, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(21_000_001, 65)); // chunk split: 10 MB + 11,000,001 bytes
    rt.saveConnectors(clientId, { connectors: { tiktok: { accessToken: "mock-token", dryRun: false } } });
    const connector = rt.getConnectorsView(clientId).tiktok;
    assert.equal(connector.configured, true);
    assert.equal(connector.auditApproved, false);
    assert.ok(!JSON.stringify(connector).includes("mock-token"), "access token never exposed in connector view");
    const entry = rt.createCalendarEntry(clientId, { entry: { date, time: "15:43", sku, platform: "tiktok" } });
    rt.updateCalendarEntry(clientId, entry.id, { caption: "ดูเลย https://shop.example/p ครับ 😊" });
    rt._mutateClient(clientId, (c) => { c.calendar.find((e) => e.id === entry.id).video = { path: file, seconds: 5 }; });
    const getEntry = () => rt._findEntry(clientId, entry.id).entry;
    const getClient = () => rt._findEntry(clientId, entry.id).client;
    const requests = [];
    let privacyOptions = ["SELF_ONLY", "PUBLIC_TO_EVERYONE"];
    let username = "sample.creator";
    let remoteStatus = "PROCESSING_UPLOAD";
    SocialAgencyRuntime._https = async (req) => {
      requests.push(req);
      assert.ok(!req.host.includes("example.com"), "never fetch unverified media URL");
      if (req.path === "/v2/post/publish/creator_info/query/") return { status: 200, json: { error: { code: "ok" }, data: {
        creator_username: username, creator_nickname: "Test Creator", privacy_level_options: privacyOptions,
        max_video_post_duration_sec: 60, comment_disabled: true, duet_disabled: false, stitch_disabled: false,
      } } };
      if (req.path === "/v2/post/publish/video/init/") return { status: 200, json: { error: { code: "ok" }, data: {
        publish_id: "v_pub_file~mock-1", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=abc&upload_token=secret",
      } } };
      if (req.host === "open-upload.tiktokapis.com") return { status: requests.filter((r) => r.host === req.host).length === 1 ? 206 : 201, json: null };
      if (req.path === "/v2/post/publish/status/fetch/") return { status: 200, json: { error: { code: "ok" }, data: {
        status: remoteStatus, ...(remoteStatus === "PUBLISH_COMPLETE" ? { publicaly_available_post_id: [] } : {}),
      } } };
      throw Error(`unexpected ${req.host} ${req.path}`);
    };
    const creatorPreview = await rt.getTikTokCreatorInfo(clientId, entry.id);
    assert.equal(creatorPreview.creator_username, username);
    assert.match(creatorPreview.captionPreview, /utm_source=tiktok/);
    const apiResponse = {};
    const handled = await rt.handleApiRequest(
      { method: "GET", url: `/api/social-agency/tiktok/creator-info?clientId=${encodeURIComponent(clientId)}&entryId=${encodeURIComponent(entry.id)}` },
      apiResponse,
      { readJsonRequestBody: async () => ({}), json: (res, code, body) => { res.statusCode = code; res.body = body; } }
    );
    assert.notEqual(handled, false);
    assert.equal(apiResponse.statusCode, 200);
    assert.equal(apiResponse.body.creator.captionPreview, creatorPreview.captionPreview);
    await assert.rejects(rt._publishEntry(getClient(), getEntry(), { trigger: "schedule" }), /ต้องเลือก privacy/);
    assert.equal(requests.filter((r) => !r.path.includes("creator_info/query")).length, 0, "no posting calls without consent");
    await assert.rejects(rt.consentTikTokPost(clientId, entry.id, { privacyLevel: "SELF_ONLY" }), /ยืนยัน/);
    const previewFor = (id) => SocialAgencyRuntime._tagCaptionLinks(rt._findEntry(clientId, id).entry.caption, clientId, "tiktok", id);
    const basics = { creatorUsername: username, previewCaption: previewFor(entry.id), uploadConsent: true, musicUsageConfirmed: true };
    await assert.rejects(rt.consentTikTokPost(clientId, entry.id, { ...basics, privacyLevel: "" }), /เลือก privacy/);
    await assert.rejects(rt.consentTikTokPost(clientId, entry.id, { ...basics, privacyLevel: "PUBLIC_TO_EVERYONE" }), /audit/);
    await assert.rejects(rt.consentTikTokPost(clientId, entry.id, { ...basics, privacyLevel: "SELF_ONLY", commercialContent: true }), /Commercial Content/);
    await assert.rejects(rt.consentTikTokPost(clientId, entry.id, { ...basics, privacyLevel: "SELF_ONLY", commercialContent: true, brandedContent: true }), /Branded content/);
    await assert.rejects(rt.consentTikTokPost(clientId, entry.id, { ...basics, privacyLevel: "SELF_ONLY", creatorUsername: "wrong" }), /บัญชี/);
    const consent = await rt.consentTikTokPost(clientId, entry.id, { ...basics, privacyLevel: "SELF_ONLY" });
    assert.equal(consent.privacyLevel, "SELF_ONLY");
    assert.equal(consent.videoHash, undefined, "do not expose digest");
    assert.equal(getEntry().captionManual, true);
    assert.throws(() => rt.useEntryHook(clientId, entry.id, 0), /ไม่สามารถเปลี่ยน hook/);
    assert.equal(rt._entryVideoFile(getEntry()).buffer.length, 21_000_001);
    // The user may manually run before the scheduled time; TikTok must not silently dry-run as other platforms do.
    const pending = await rt._publishEntry(getClient(), getEntry(), { trigger: "manual" });
    assert.equal(pending.pending, true);
    assert.equal(pending.postId, "v_pub_file~mock-1");
    assert.equal(getEntry().status, "publishing");
    assert.equal(getEntry().publishedAt, undefined);
    assert.equal(getEntry().tiktokUploadComplete, true);
    const init = requests.find((r) => r.path === "/v2/post/publish/video/init/");
    const body = JSON.parse(init.body);
    assert.equal(body.post_info.privacy_level, "SELF_ONLY");
    assert.equal(body.post_info.is_aigc, true);
    assert.equal(body.post_info.disable_comment, true);
    assert.equal(body.source_info.source, "FILE_UPLOAD");
    assert.deepEqual([body.source_info.video_size, body.source_info.chunk_size, body.source_info.total_chunk_count], [21_000_001, 10_000_000, 2]);
    assert.match(body.post_info.title, /utm_source=tiktok/);
    const puts = requests.filter((r) => r.method === "PUT");
    assert.deepEqual(puts.map((r) => r.headers["Content-Range"]), ["bytes 0-9999999/21000001", "bytes 10000000-21000000/21000001"]);
    assert.equal(puts[0].path, "/video/?upload_id=abc&upload_token=secret");
    await assert.rejects(rt._publishEntry(getClient(), getEntry(), { trigger: "manual" }), /ห้ามส่งซ้ำ/);
    assert.throws(() => rt.runWorkflow(clientId, entry.id), /ไม่สามารถรันซ้ำ/);
    assert.throws(() => rt.deleteCalendarEntry(clientId, entry.id), /ลบไม่ได้/);
    assert.throws(() => rt.updateCalendarEntry(clientId, entry.id, { status: "published" }), /ห้ามแก้ไข/);
    const postCount = requests.length;
    await rt._maybeReconcileTikTok(true);
    assert.equal(getEntry().status, "publishing");
    assert.equal(requests.length, postCount + 1);
    remoteStatus = "PUBLISH_COMPLETE";
    await rt._maybeReconcileTikTok(true);
    assert.equal(getEntry().status, "published");
    assert.equal(getEntry().publishMode, "live");
    assert.ok(getEntry().publishedAt);
    assert.equal(requests.filter((r) => r.path.endsWith("/video/init/")).length, 1, "init is never retried");
    rt._mutateClient(clientId, (c) => {
      const e = c.calendar.find((x) => x.id === entry.id);
      e.status = "publishing"; e.tiktokStatusCheckedAt = null;
    });
    remoteStatus = "FAILED";
    await rt._maybeReconcileTikTok(true);
    assert.equal(getEntry().status, "failed");
    assert.equal(getEntry().publishMode, "failed");
    assert.throws(() => rt.runWorkflow(clientId, entry.id), /ไม่สามารถรันซ้ำ/);
    // Changing caption invalidates consent; changing privacy/account remotely is rejected before init.
    const second = rt.createCalendarEntry(clientId, { entry: { date, time: "16:43", sku, platform: "tiktok" } });
    rt._mutateClient(clientId, (c) => { c.calendar.find((e) => e.id === second.id).video = { path: file, seconds: 5 }; });
    rt.updateCalendarEntry(clientId, second.id, { caption: "ของใหม่มาแล้ว" });
    await rt.consentTikTokPost(clientId, second.id, { ...basics, previewCaption: previewFor(second.id), privacyLevel: "SELF_ONLY" });
    rt.updateCalendarEntry(clientId, second.id, { caption: "แก้แล้ว" });
    assert.equal(rt._findEntry(clientId, second.id).entry.tiktokPost, undefined);
    await assert.rejects(rt.consentTikTokPost(clientId, second.id, { ...basics, privacyLevel: "SELF_ONLY" }), /ตัวอย่างเปลี่ยน/);
    await rt.consentTikTokPost(clientId, second.id, { ...basics, previewCaption: previewFor(second.id), privacyLevel: "SELF_ONLY" });
    privacyOptions = ["PUBLIC_TO_EVERYONE"];
    await assert.rejects(rt._publishEntry(rt._findEntry(clientId, second.id).client, rt._findEntry(clientId, second.id).entry, { trigger: "schedule" }), /privacy TikTok เปลี่ยน/);
    assert.equal(requests.filter((r) => r.path.endsWith("/video/init/")).length, 1);
    // Workflow must not mark an accepted init/upload as published before status fetch confirms it.
    privacyOptions = ["SELF_ONLY"];
    const third = rt.createCalendarEntry(clientId, { entry: { date, time: "17:43", sku, platform: "tiktok" } });
    rt.updateCalendarEntry(clientId, third.id, { caption: "โปรดดูคลิปสินค้าของเรา 😊" });
    rt._mutateClient(clientId, (c) => { c.calendar.find((e) => e.id === third.id).video = { path: file, seconds: 5 }; });
    await rt.consentTikTokPost(clientId, third.id, { ...basics, previewCaption: previewFor(third.id), privacyLevel: "SELF_ONLY" });
    const savedCheck = rt._aiCheck;
    const savedPublisher = rt._publishEntry;
    rt._aiCheck = async () => ({ score: 95, verdict: "pass", issues: [] });
    rt._publishEntry = async () => ({ platform: "tiktok", mode: "live", pending: true, postId: "v_pub_file~mock-third", latencyMs: 1, mediaKind: "video" });
    try {
      const workflow = rt.runWorkflow(clientId, third.id, { trigger: "manual", force: true });
      const until = Date.now() + 5000;
      while (rt._findEntry(clientId, third.id).entry.inFlight && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
      const row = rt._findEntry(clientId, third.id).entry;
      const run = rt.listRuns(clientId, third.id)[0];
      assert.equal(row.status, "publishing");
      assert.equal(row.publishedAt, undefined);
      assert.equal(row.publishMode, "pending");
      assert.equal(run.status, "pending");
      assert.equal(run.nodes.find((n) => n.key === "result").status, "idle");
      assert.ok(workflow.runId);
    } finally { rt._aiCheck = savedCheck; rt._publishEntry = savedPublisher; }

    // A network-ambiguous init attempt must survive restart without another scheduled send.
    privacyOptions = ["SELF_ONLY"];
    SocialAgencyRuntime._https = async (req) => {
      if (req.path === "/v2/post/publish/creator_info/query/") return { status: 200, json: { error: { code: "ok" }, data: {
        creator_username: username, privacy_level_options: privacyOptions, max_video_post_duration_sec: 60,
      } } };
      if (req.path === "/v2/post/publish/video/init/") throw new Error("network timeout");
      throw Error("unexpected request");
    };
    await assert.rejects(rt._publishEntry(rt._findEntry(clientId, second.id).client, rt._findEntry(clientId, second.id).entry, { trigger: "schedule" }), /network timeout/);
    assert.ok(rt._findEntry(clientId, second.id).entry.tiktokInitAttemptedAt);
    rt._mutateClient(clientId, (c) => { const e = c.calendar.find((x) => x.id === second.id); e.inFlight = true; e.status = "in_workflow"; });
    const recovered = new SocialAgencyRuntime({ root });
    recovered._recoverInFlightOnce();
    assert.equal(recovered._findEntry(clientId, second.id).entry.status, "failed");
    assert.throws(() => recovered.runWorkflow(clientId, second.id), /ไม่สามารถรันซ้ำ/);
    console.log("PASS: TikTok consent/privacy/AI disclosure, private-only gate, chunked upload, pending status, polling and no ambiguous retries (mocked HTTPS only)");
  } finally {
    SocialAgencyRuntime._https = originalHttps;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
