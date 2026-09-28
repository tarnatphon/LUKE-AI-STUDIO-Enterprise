// Isolated Meta metrics + adaptive planning regression; no network or live posts.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("./social-agency-runtime.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-metrics-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientId = rt.getState().activeClientId;
  const sku = rt.getState().clients[0].products[0].sku;
  rt.saveConnectors(clientId, { connectors: {
    facebook: { pageId: "page-test", accessToken: "fake-fb-token", apiVersion: "v25.0", dryRun: false },
    instagram: { igUserId: "ig-test", accessToken: "fake-ig-token", insightsAccessToken: "fake-ig-insights-token", apiVersion: "v24.0", dryRun: false },
  } });
  const make = (platform, postId, mediaKind, hour = "10:00") => {
    const date = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
    const e = rt.createCalendarEntry(clientId, { entry: { date, time: hour, platform, sku } });
    rt._mutateClient(clientId, (c) => {
      const row = c.calendar.find((r) => r.id === e.id);
      Object.assign(row, { status: "published", publishMode: "live", postId, mediaKind, publishedAt: new Date(Date.now() - 72 * 3600000).toISOString() });
    });
    return e.id;
  };
  const fbId = make("facebook", "page_123", "post", "14:37");
  const igId = make("instagram", "179123", "reel", "14:38");
  const videoId = make("facebook", "video-123", "video", "14:39");
  const calls = [];
  const original = SocialAgencyRuntime._https;
  let igInsightsFail = false;
  let fbFail = false;
  SocialAgencyRuntime._https = async ({ host, path: url }) => {
    assert.equal(host, "graph.facebook.com");
    calls.push(url);
    if (url.startsWith("/v25.0/page_123")) {
      if (fbFail) return { status: 401, json: { error: { message: "token fake-fb-token invalid" } } };
      if (url.includes("fields=shares")) return { status: 200, json: { shares: { count: 3 } } };
      return { status: 200, json: { reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } } } };
    }
    if (url.startsWith("/v25.0/video-123")) return { status: 200, json: { likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 1 } } } };
    if (url.startsWith("/v24.0/179123/insights")) {
      if (igInsightsFail) return { status: 400, json: { error: { message: "missing instagram_manage_insights" } } };
      return { status: 200, json: { data: url.includes("shares") ? [{ name: "shares", values: [{ value: 4 }] }] : [] } };
    }
    if (url.startsWith("/v24.0/179123")) return { status: 200, json: { like_count: 9, comments_count: 1 } };
    throw new Error("unexpected: " + url);
  };
  try {
    const fb = await rt.syncEntryMetrics(clientId, fbId, { force: true });
    assert.deepEqual([fb.metrics.likes, fb.metrics.comments, fb.metrics.shares, fb.metrics.views], [7, 2, 3, undefined]);
    assert.equal(fb.metrics.source, "meta");
    assert.ok(calls.some((x) => x.includes("/v25.0/page_123?fields=reactions")));
    const video = await rt.syncEntryMetrics(clientId, videoId, { force: true });
    assert.deepEqual([video.metrics.likes, video.metrics.comments, video.metrics.shares], [12, 1, undefined]);
    assert.ok(calls.some((x) => x.includes("/v25.0/video-123?fields=likes")));
    const ig = await rt.syncEntryMetrics(clientId, igId, { force: true });
    assert.deepEqual([ig.metrics.likes, ig.metrics.comments, ig.metrics.shares, ig.metrics.views], [9, 1, 4, undefined]);
    assert.ok(calls.some((x) => x.includes("/v24.0/179123?fields=like_count") && x.includes("fake-ig-insights-token")));
    assert.ok(!fs.readFileSync(rt.filePath, "utf8").includes("fake-ig-insights-token"), "insights token not persisted in state");
    assert.ok(!fs.readFileSync(rt.filePath, "utf8").includes("fake-ig-token"), "no tokens in state");

    // Editing one number must not freeze the rest; empty removes the override.
    rt.updateCalendarEntry(clientId, igId, { metrics: { likes: 40 } });
    igInsightsFail = true;
    const mixed = await rt.syncEntryMetrics(clientId, igId, { force: true });
    assert.equal(mixed.metrics.likes, 40);
    assert.equal(mixed.metrics.comments, 1);
    assert.equal(mixed.metrics.shares, 4); // missing insight must not become 0
    assert.match(mixed.warning, /instagram_manage_insights/);
    rt.updateCalendarEntry(clientId, igId, { metrics: { likes: "" } });
    const restored = await rt.syncEntryMetrics(clientId, igId, { force: true });
    assert.equal(restored.metrics.likes, 9);
    assert.deepEqual(restored.metrics.manualFields, []);

    fbFail = true;
    await assert.rejects(rt.syncEntryMetrics(clientId, fbId, { force: true }), /\[redacted\]/);
    const unchanged = rt._findEntry(clientId, fbId).entry;
    assert.equal(unchanged.metrics.likes, 7);
    assert.ok(unchanged.metricsSync.lastAttemptAt);
    assert.ok(!fs.readFileSync(rt.filePath, "utf8").includes("fake-fb-token"));
    assert.deepEqual(await rt.syncEntryMetrics(clientId, fbId), { skipped: "recently-refreshed" });

    // Sweep does at most one network fetch per tick; manual batch capped at three.
    fbFail = false;
    rt._mutateClient(clientId, (c) => {
      for (const id of [fbId, igId, videoId]) {
        const e = c.calendar.find((r) => r.id === id);
        delete e.metricsSync;
      }
    });
    calls.length = 0;
    await rt._maybeSyncMetrics();
    assert.equal(rt._findEntry(clientId, fbId).entry.metricsSync?.lastAttemptAt ? 1 : 0, 1);
    assert.equal(rt._findEntry(clientId, igId).entry.metricsSync, undefined);
    // User edits during an in-flight request win over the eventual API response.
    const normalFetch = rt._fetchMetaMetrics;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    rt._fetchMetaMetrics = async () => { await gate; return { values: { likes: 888, comments: 6 }, warnings: [] }; };
    const pending = rt.syncEntryMetrics(clientId, igId, { force: true });
    assert.deepEqual(await rt.syncEntryMetrics(clientId, igId, { force: true }), { skipped: "already-syncing" });
    rt.updateCalendarEntry(clientId, igId, { metrics: { likes: 55 } });
    release();
    await pending;
    assert.equal(rt._findEntry(clientId, igId).entry.metrics.likes, 55);
    assert.equal(rt._findEntry(clientId, igId).entry.metrics.comments, 6);
    rt._fetchMetaMetrics = normalFetch;

    const batch = await rt.syncRecentMetrics(clientId);
    assert.equal(batch.attempted, 3);
    assert.equal(batch.updated, 3);
    const route = async (body) => {
      const req = { method: "POST", url: `/api/social-agency/metrics/refresh?clientId=${clientId}` };
      const res = {};
      await rt.handleApiRequest(req, res, { readJsonRequestBody: async () => body, json: (r, code, data) => { r.statusCode = code; r.body = data; } });
      return res;
    };
    assert.equal((await route({ entryId: fbId })).body.result.metrics.likes, 7);
    const demo = rt.createCalendarEntry(clientId, { entry: { date: "2027-01-02", time: "12:00", platform: "demo", sku } });
    assert.equal((await route({ entryId: demo.id })).statusCode, 400);

    // Ranking needs two comparable, mature groups with >=3 samples each.
    const base = { id: "planning-test", calendar: [] };
    assert.equal(rt._planningSignals(base).platformSource, "default");
    const publishedAt = (weekday, hour, weeksAgo) => {
      const day = new Date(Date.now() - weeksAgo * 7 * 86400000);
      const offset = (day.getUTCDay() - weekday + 7) % 7;
      day.setUTCDate(day.getUTCDate() - offset);
      day.setUTCHours(hour - 7, 0, 0, 0); // Bangkok hour
      return day.toISOString();
    };
    for (let i = 1; i <= 3; i += 1) {
      for (const [platform, hour, likes] of [
        ["facebook", 9, 100], ["facebook", 18, 10],
        ["instagram", 9, 10], ["instagram", 18, 10],
      ]) base.calendar.push({ id: `${platform}-${hour}-${i}`, platform, status: "published", publishMode: "live", publishedAt: publishedAt(2, hour, i), metrics: { likes, comments: 1 } });
    }
    let strategy = rt._planningSignals(base);
    assert.equal(strategy.platformRotation[0], "facebook");
    assert.equal(strategy.weekdayTime, "09:30");
    assert.equal(strategy.weekendTime, "11:00");
    const month = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 7);
    const plannedClient = { ...base, products: [{ sku: "A", name: "Alpha" }], id: "planning-test" };
    assert.ok(rt._buildFallbackSlots(plannedClient, month, 5).some((s) => s.time === "09:30"));
    for (let i = 1; i <= 3; i += 1) {
      for (const [hour, likes] of [[8, 80], [11, 10]]) base.calendar.push({ id: `sat-${hour}-${i}`, platform: "facebook", status: "published", publishMode: "live", publishedAt: publishedAt(6, hour, i), metrics: { likes, comments: 1 } });
    }
    strategy = rt._planningSignals(base);
    assert.equal(strategy.weekendTime, "08:00");
    base.calendar.push({ platform: "demo", status: "published", publishMode: "demo", publishedAt: publishedAt(2, 18, 1), metrics: { likes: 9999, comments: 9999 } });
    assert.equal(rt._planningSignals(base).weekdayTime, "09:30");
    console.log("PASS: Meta metrics refresh, override/empty values, backoff, routing and evidence-based planning");
  } finally {
    SocialAgencyRuntime._https = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
