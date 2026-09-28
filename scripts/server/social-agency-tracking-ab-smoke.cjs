// UTM + A/B hook checks: isolated state, mocked network, never publishes live.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("./social-agency-runtime.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-ab-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientId = rt.getState().activeClientId;
  const sku = rt.getState().clients[0].products[0].sku;
  const future = (days) => new Date(Date.now() + (days * 24 + 7) * 3600000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  rt.saveConnectors(clientId, { connectors: {
    facebook: { pageId: "page1", accessToken: "fake-fb", dryRun: false },
    instagram: { igUserId: "ig1", accessToken: "fake-ig", dryRun: false },
    line: { channelAccessToken: "fake-line", dryRun: false },
  } });
  const originalHttps = SocialAgencyRuntime._https;
  try {
    const raw = 'Visit https://shop.example/p?a=1#details, and (https://shop.example/x?utm_source=old&b=2). No ftp://a.test';
    const tagged = SocialAgencyRuntime._tagCaptionLinks(raw, clientId, "facebook", "cal-123");
    assert.match(tagged, /utm_source=facebook/);
    assert.match(tagged, /utm_campaign=thai-modern-bags/);
    assert.match(tagged, /utm_content=cal-123/);
    assert.match(tagged, /a=1/);
    assert.match(tagged, /#details,/);
    assert.match(tagged, /b=2/);
    assert.match(tagged, /\)\./);
    assert.equal((tagged.match(/utm_source=facebook/g) || []).length, 2);
    assert.equal(SocialAgencyRuntime._tagCaptionLinks(tagged, clientId, "facebook", "cal-123"), tagged, "idempotent tracking");
    assert.equal(SocialAgencyRuntime._tagCaptionLinks("just text", clientId, "line", "e"), "just text");

    const post = rt.createCalendarEntry(clientId, { entry: { date: yesterday, time: "14:14", sku, platform: "facebook" } });
    const getClient = () => rt._read().clients.find((c) => c.id === clientId);
    const withPost = (id, extra = {}) => ({ ...getClient().calendar.find((e) => e.id === id), caption: `แวะดู https://shop.example/p?sku=1 ครับ 😊`, ...extra });
    const requests = [];
    SocialAgencyRuntime._https = async (opts) => {
      requests.push(opts);
      if (opts.host === "graph.facebook.com" && opts.path.endsWith("/feed")) return { status: 200, json: { id: "page_123" } };
      if (opts.host === "graph.facebook.com" && opts.path.endsWith("/videos")) return { status: 200, json: { id: "video-123" } };
      if (opts.host === "graph.facebook.com" && opts.path.endsWith("/media")) return { status: 200, json: { id: "container" } };
      if (opts.host === "graph.facebook.com" && opts.path.includes("fields=status_code")) return { status: 200, json: { status_code: "FINISHED" } };
      if (opts.host === "graph.facebook.com" && opts.path.endsWith("/media_publish")) return { status: 200, json: { id: "ig-media" } };
      if (opts.path === "/v2/bot/message/quota") return { status: 200, json: { value: 1000 } };
      if (opts.path === "/v2/bot/message/quota/consumption") return { status: 200, json: { totalUsage: 0 } };
      if (opts.path === "/v2/bot/message/broadcast") return { status: 200, json: {} };
      throw new Error(`unexpected: ${opts.host}${opts.path}`);
    };
    const fb = await rt._publishEntry(getClient(), withPost(post.id), { trigger: "schedule" });
    const fbMessage = JSON.parse(requests.find((r) => r.path.endsWith("/feed")).body).message;
    assert.equal(fbMessage, fb.publishedCaption);
    assert.match(fbMessage, /utm_source=facebook/);
    assert.ok(!withPost(post.id).caption.includes("utm_source="), "draft remains untouched");
    rt._mutateClient(clientId, (c) => {
      const e = c.calendar.find((x) => x.id === post.id);
      Object.assign(e, { status: "published", publishMode: "live", publishedCaption: fb.publishedCaption });
    });
    let report = rt.buildTrackingReport(clientId);
    assert.equal(report.byPlatform.facebook, 1);
    assert.equal(report.rows[0].entryId, post.id);
    assert.equal(report.rows[0].url.includes("utm_content=" + post.id), true);

    const vf = path.join(root, "clip.mp4");
    fs.writeFileSync(vf, Buffer.from("fake-video"));
    rt._mutateClient(clientId, (c) => { c.connectors.facebook.lastPublishAt = null; });
    const fbVideo = await rt._publishEntry(getClient(), withPost(post.id, { video: { path: vf } }), { trigger: "schedule" });
    assert.match(fbVideo.publishedCaption, /utm_content=/);
    assert.ok(requests.find((r) => r.path.endsWith("/videos")).body.toString("utf8").includes("utm_source=facebook"));

    const igEntry = rt.createCalendarEntry(clientId, { entry: { date: yesterday, time: "14:15", sku, platform: "instagram" } });
    const ig = await rt._publishEntry(getClient(), withPost(igEntry.id, { image: { publicUrl: "https://media.example/p.jpg" } }), { trigger: "schedule" });
    assert.equal(ig.postId, "ig-media");
    const igBody = JSON.parse(requests.find((r) => r.path.endsWith("/media")).body);
    assert.match(igBody.caption, /utm_source=instagram/);
    assert.equal(igBody.image_url, "https://media.example/p.jpg", "media URLs must never gain UTM");

    const lineEntry = rt.createCalendarEntry(clientId, { entry: { date: yesterday, time: "14:16", sku, platform: "line" } });
    const line = await rt._publishEntry(getClient(), withPost(lineEntry.id), { trigger: "schedule" });
    const messages = JSON.parse(requests.find((r) => r.path === "/v2/bot/message/broadcast").body).messages;
    assert.equal(messages[0].text, line.publishedCaption);
    assert.match(messages[0].text, /utm_source=line/);
    await assert.rejects(rt._publishEntry(getClient(), withPost(lineEntry.id, { caption: "x".repeat(375) + " https://shop.example/p" }), { trigger: "schedule" }), /เกิน 400/);

    const source = rt.createCalendarEntry(clientId, { entry: { date: future(3), time: "15:00", sku, platform: "facebook" } });
    rt._mutateClient(clientId, (c) => {
      const e = c.calendar.find((x) => x.id === source.id);
      Object.assign(e, { status: "needs_review", caption: "Hook ต้นฉบับ\nเนื้อหาเดียวกันกับทุกแบบครับ 😊 https://shop.example/offer", hookVariants: [
        { text: "Hook เช้าสุดคุ้ม", score: 88, used: true }, { text: "Hook เย็นเด็ดมาก", score: 85, used: false },
      ] });
    });
    const pair = rt.createHookExperiment(clientId, source.id, { firstIndex: 0, secondIndex: 1, date: future(2), morning: "09:15", evening: "18:45" });
    assert.equal(pair.created.length, 2);
    assert.notEqual(pair.created[0].id, pair.created[1].id);
    assert.equal(pair.created[0].platform, pair.created[1].platform);
    assert.equal(pair.created[0].time, "09:15");
    assert.equal(pair.created[1].time, "18:45");
    assert.match(pair.created[0].caption, /^Hook เช้าสุดคุ้ม\n/);
    assert.match(pair.created[1].caption, /^Hook เย็นเด็ดมาก\n/);
    assert.equal(pair.created[0].caption.split("\n").slice(1).join("\n"), pair.created[1].caption.split("\n").slice(1).join("\n"));
    assert.equal(rt._findEntry(clientId, source.id).entry.status, "rejected");
    assert.throws(() => rt.runWorkflow(clientId, source.id), /ต้นฉบับนี้ถูกเก็บ/);
    assert.throws(() => rt.useEntryHook(clientId, pair.created[0].id, 1), /ไม่สามารถเปลี่ยน hook/);
    assert.throws(() => rt.updateCalendarEntry(clientId, pair.created[0].id, { caption: "changed" }), /โพสต์ A\/B/);
    assert.throws(() => rt.createHookExperiment(clientId, source.id, { firstIndex: 0, secondIndex: 1, date: future(4) }), /ยังไม่เผยแพร่/);
    // The case of already occupied A/B slot is rejected without archiving source.
    const another = rt.createCalendarEntry(clientId, { entry: { date: future(5), time: "15:00", sku, platform: "facebook" } });
    rt._mutateClient(clientId, (c) => {
      const e = c.calendar.find((x) => x.id === another.id);
      Object.assign(e, { caption: "Caption\nเนื้อหาเหมือนกันครับ 😊", hookVariants: [{ text: "First" }, { text: "Second" }] });
    });
    assert.throws(() => rt.createHookExperiment(clientId, another.id, { firstIndex: 0, secondIndex: 1, date: future(2), morning: "09:15", evening: "18:45" }), /มีโพสต์/);
    assert.equal(rt._findEntry(clientId, another.id).entry.status, "planned");

    rt._mutateClient(clientId, (c) => {
      for (const e of c.calendar.filter((e) => e.abTest?.id === pair.testId)) {
        e.status = "published";
        e.publishMode = "live";
        e.publishedAt = new Date(Date.now() - 3 * 86400000).toISOString();
        e.metrics = { likes: e.abTest.variant === "A" ? 28 : 12, comments: 3 };
      }
    });
    const performance = rt.buildPerformance(clientId);
    const experiment = performance.experiments.find((e) => e.id === pair.testId);
    assert.equal(experiment.winner, "A");
    assert.deepEqual(experiment.variants.map((v) => v.engagement), [31, 15]);
    assert.throws(() => rt.cancelHookExperiment(clientId, pair.testId), /เผยแพร่แล้ว/);
    rt.deleteCalendarEntry(clientId, source.id);
    assert.equal(rt.buildPerformance(clientId).experiments.find((e) => e.id === pair.testId).winner, "A", "report survives deleted source");

    const next = rt.createHookExperiment(clientId, another.id, { firstIndex: 0, secondIndex: 1, date: future(6), morning: "09:00", evening: "18:30" });
    assert.throws(() => rt.startEntryVideoGen(clientId, next.created[0].id), /แชร์สื่อเดียวกัน/);
    assert.throws(() => rt.startEntryImageGen(clientId, next.created[0].id), /แชร์สื่อเดียวกัน/);
    const cancelled = rt.cancelHookExperiment(clientId, next.testId);
    assert.equal(cancelled.restoredEntryId, another.id);
    assert.equal(rt._findEntry(clientId, another.id).entry.status, "planned");
    assert.throws(() => rt._findEntry(clientId, next.created[0].id), /ไม่พบรายการ/);

    // The workflow must not replace a chosen variant with a newly scored hook.
    const workflowPair = rt.createHookExperiment(clientId, another.id, { firstIndex: 0, secondIndex: 1, date: future(7), morning: "09:00", evening: "18:30" });
    const savedCheck = rt._aiCheck;
    const savedPublisher = rt._publishEntry;
    rt._aiCheck = async () => ({ score: 95, verdict: "pass", issues: [] });
    rt._publishEntry = async () => ({ platform: "facebook", mode: "dry", postId: "dry-test", latencyMs: 1 });
    try {
      const work = rt.runWorkflow(clientId, workflowPair.created[0].id, { trigger: "manual", force: true });
      const until = Date.now() + 2000;
      while (Date.now() < until) {
        const row = rt._findEntry(clientId, workflowPair.created[0].id).entry;
        if (!row.inFlight) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const row = rt._findEntry(clientId, workflowPair.created[0].id).entry;
      assert.equal(row.status, "published");
      assert.match(row.caption, /^First\n/);
      assert.equal(row.hook, "First");
      assert.throws(() => rt.runWorkflow(clientId, row.id), /เผยแพร่แล้ว/);
      assert.ok(work.runId);
    } finally {
      rt._aiCheck = savedCheck;
      rt._publishEntry = savedPublisher;
    }
    console.log("PASS: outgoing UTM, tracked report, opt-in A/B pair, archived source and 48h comparison");
  } finally {
    SocialAgencyRuntime._https = originalHttps;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
