#!/usr/bin/env node
"use strict";

/**
 * Social Agency — LinkedIn in the calendar.
 *
 * LinkedIn is the one platform in the calendar whose posting API is real but
 * whose setup is not: a member token (w_member_social) comes from the user's own
 * LinkedIn app, lasts 60 days, and there is no in-app OAuth here — the same
 * honest position the TikTok connector takes. So this suite pins three things:
 *
 *   1. LinkedIn is a first-class planning target (platform list, caption limit,
 *      per-platform caption versions, auto-plan, footer editor) — usable with no
 *      token at all, because planning never needed one;
 *   2. a real send goes out only with a token AND an author URN, goes to
 *      /rest/posts with the required versioning headers, and carries the caption
 *      escaped as little-text (an unescaped "(" silently truncates the post);
 *   3. everything that could lie is refused: no token → dry-run with a note that
 *      says so, video → an error instead of a silently dropped clip, a sunset
 *      Linkedin-Version → an error before the request.
 *
 * No network: `_https` is replaced with a recorder, as the other Social Agency
 * suites do. No token, no account.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime, linkedInCommentary, LINKEDIN_API_VERSION } = require("../server/social-agency-runtime.cjs");
const { PLATFORM_RULES } = require("../server/social-agency-post-copy.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082",
  "hex",
);

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-linkedin-"));
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const sku = state.clients.find((c) => c.id === clientId).products[0].sku;
  const imgFile = path.join(root, "li-image.png");
  fs.writeFileSync(imgFile, PNG);

  const getClient = () => rt._read().clients.find((c) => c.id === clientId);
  const getEntry = (id) => getClient().calendar.find((e) => e.id === id);

  // The product-photo pair has its own suite; keep this one about LinkedIn.
  rt.saveConnectors(clientId, { settings: { productRefInPost: false } });

  // One entry per (date, time) slot, so each fixture takes its own minute.
  let slot = 0;
  const mk = (extra = {}) => {
    slot += 1;
    const time = `08:${String(slot).padStart(2, "0")}`;
    const entry = rt.createCalendarEntry(clientId, {
      entry: { date: bangkokToday(-1), time, platform: "linkedin", sku, angle: "เปิดตัวสินค้า" },
    });
    rt.updateCalendarEntry(clientId, entry.id, { caption: extra.caption || "ทดสอบ LinkedIn" });
    if (extra.image !== false) {
      const st = rt._read();
      const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === entry.id);
      ent.image = { path: imgFile, filename: "li-image.png", url: "/x.png", publicUrl: "https://cdn.example.com/li.png" };
      rt._write(st);
    }
    return entry.id;
  };

  const calls = [];
  const realHttps = SocialAgencyRuntime._https;
  SocialAgencyRuntime._https = async (opts = {}) => {
    calls.push({ host: opts.host, path: opts.path, method: opts.method || "GET", body: opts.body, headers: opts.headers });
    if (opts.path === "/v2/userinfo") return { status: 200, json: { sub: "AbC123", name: "สมชาย ทดสอบ" }, text: "{}" };
    if (opts.path === "/rest/images?action=initializeUpload") {
      return { status: 200, json: { value: { uploadUrl: "https://www.linkedin.com/dms-uploads/abc?sig=1", image: "urn:li:image:C4E10AQ" } }, text: "{}" };
    }
    if (String(opts.path || "").startsWith("/dms-uploads")) return { status: 201, json: null, text: "" };
    if (opts.path === "/rest/posts") return { status: 201, json: null, text: "", headers: { "x-restli-id": "urn:li:share:6864768486615375872" } };
    throw new Error(`unexpected https call ${opts.method || "GET"} ${opts.host}${opts.path}`);
  };

    // ── planning is free ─────────────────────────────────────────────────────
    test("LinkedIn is a real platform in the calendar, not a label", () => {
      assert.ok(SocialAgencyRuntime ? true : true);
      assert.ok(require("../server/social-agency-runtime.cjs").PLATFORMS.includes("linkedin"), "PLATFORMS includes linkedin");
      assert.deepEqual({ ...PLATFORM_RULES.linkedin }, { maxChars: 3000, maxHashtags: 5 });
      // The caption formatter must apply the LinkedIn limit, not the 2000 default.
      const long = rt.buildPlatformVersions({
        caption: "ก".repeat(2500),
        product: { sku, name: "x" },
        angle: "เปิดตัวสินค้า",
        tone: "เจ้าของแบรนด์",
        client: { id: "c", captionFooters: {}, settings: {} },
      });
      assert.ok(long.versions.linkedin.length > 2000, "a 2500-char post survives on LinkedIn (limit 3000)");
      assert.equal(long.meta.linkedin.truncated, false);
      assert.ok(long.meta.linkedin.hashtags <= 5, "hashtags are capped at 5");
    });

    test("an entry can be planned on LinkedIn and auto-plan accepts it", () => {
      const id = mk({ image: false });
      const entry = getEntry(id);
      assert.equal(entry.platform, "linkedin");
      assert.deepEqual(rt._autoPlanPlatforms(["linkedin", "linkedin", "tiktok"]), ["linkedin"], "auto-plan accepts linkedin, de-dupes, still excludes tiktok");
    });

    // ── escaping ─────────────────────────────────────────────────────────────
    test("commentary is escaped as little-text, hashtags stay clickable", () => {
      const out = linkedInCommentary("ราคา (30 บาท) #กระเป๋าผ้า #OEM 50% a_b @x");
      assert.equal(out, "ราคา \\(30 บาท\\) {hashtag|\\#|กระเป๋าผ้า} {hashtag|\\#|OEM} 50% a\\_b \\@x");
      // One pass only: the backslash is reserved, so a second pass would double it.
      assert.equal(linkedInCommentary("C# #1"), "C\\# \\#1", "a # that is not a hashtag is escaped as text");
      assert.equal(linkedInCommentary("ปกติ"), "ปกติ", "plain Thai text is untouched");
      assert.equal(linkedInCommentary(""), "");
    });

    // ── connector ────────────────────────────────────────────────────────────
    test("the connector stores the token server-side and shows only the last 4", async () => {
      rt.saveConnectors(clientId, { connectors: { linkedin: { accessToken: "li-token-abcdef123456", authorUrn: "urn:li:person:AbC123", dryRun: false } } });
      const view = rt.getConnectorsView(clientId).linkedin;
      assert.equal(view.configured, true);
      assert.equal(view.hasToken, true);
      assert.equal(view.authorUrn, "urn:li:person:AbC123");
      assert.equal(view.accessToken, "••••3456", "the token is masked");
      assert.equal(JSON.stringify(rt.getConnectorsView(clientId)).includes("li-token-abcdef123456"), false, "the raw token never leaves the server");
      assert.equal(view.dryRun, false);
      assert.equal(view.apiVersion, LINKEDIN_API_VERSION);
      const secrets = fs.readFileSync(path.join(rt.stateDir, "connectors.json"), "utf8");
      assert.match(secrets, /li-token-abcdef123456/);
    });

    test("a sunset or invented Linkedin-Version is refused with an explanation", () => {
      assert.equal(SocialAgencyRuntime._linkedInVersion("202601"), "202601");
      assert.throws(() => SocialAgencyRuntime._linkedInVersion("2024-01"), /YYYYMM/);
      assert.throws(() => SocialAgencyRuntime._linkedInVersion("202301"), /ยังไม่รองรับ/);
      assert.throws(() => SocialAgencyRuntime._linkedInVersion("202510"), /ยังไม่รองรับ|หมดอายุ/);
      rt.saveConnectors(clientId, { connectors: { linkedin: { apiVersion: "202604" } } });
      assert.equal(rt.getConnectorsView(clientId).linkedin.apiVersion, "202604");
    });

    test("testing the connector resolves the author URN and stores it", async () => {
      rt.saveConnectors(clientId, { connectors: { linkedin: { authorUrn: "" } } });
      const result = await rt.testConnector(clientId, "linkedin", { accessToken: "li-token-abcdef123456" });
      assert.equal(result.ok, true);
      assert.equal(result.authorUrn, "urn:li:person:AbC123");
      assert.equal(rt.getConnectorsView(clientId).linkedin.authorUrn, "urn:li:person:AbC123", "the URN is remembered");
      assert.match(result.message, /สมชาย/);
      const call = calls.find((c) => c.path === "/v2/userinfo");
      assert.equal(call.headers.Authorization, "Bearer li-token-abcdef123456");
      assert.equal(rt.getConnectorsView(clientId).linkedin.testedAt !== null, true);
      // No token → a clear instruction, not a stack trace.
      await assert.rejects(() => rt.testConnector(clientId, "linkedin", { accessToken: "" }), /Access Token/);
    });

    // ── publishing ───────────────────────────────────────────────────────────
    test("a live post uploads the image, then posts escaped text with the right headers", async () => {
      rt.saveConnectors(clientId, { connectors: { linkedin: { accessToken: "li-token-abcdef123456", authorUrn: "urn:li:person:AbC123", dryRun: false } } });
      const id = mk({ caption: "โปรโมชัน (จำกัด 30 ชิ้น) #กระเป๋าผ้า" });
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      calls.length = 0;
      const before = calls.length;
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "schedule" });
      assert.equal(out.mode, "live");
      assert.equal(out.postId, "urn:li:share:6864768486615375872", "the post id comes from x-restli-id");
      assert.equal(calls.length, before + 3, "initializeUpload → upload bytes → create post");

      const [init, upload, post] = calls;
      assert.equal(init.host, "api.linkedin.com");
      assert.equal(init.path, "/rest/images?action=initializeUpload");
      assert.equal(init.headers["Linkedin-Version"], "202604", "the configured version is sent");
      assert.equal(init.headers["X-Restli-Protocol-Version"], "2.0.0");
      assert.deepEqual(JSON.parse(init.body), { initializeUploadRequest: { owner: "urn:li:person:AbC123" } });

      assert.equal(upload.method, "PUT");
      assert.equal(upload.host, "www.linkedin.com", "the upload URL is used as given");
      assert.match(upload.path, /^\/dms-uploads\/abc/);
      assert.ok(Buffer.isBuffer(upload.body) && upload.body.length === PNG.length, "the image bytes are uploaded");

      assert.equal(post.method, "POST");
      assert.equal(post.path, "/rest/posts");
      const body = JSON.parse(post.body);
      assert.equal(body.author, "urn:li:person:AbC123");
      assert.equal(body.visibility, "PUBLIC");
      assert.equal(body.lifecycleState, "PUBLISHED");
      assert.equal(body.distribution.feedDistribution, "MAIN_FEED");
      assert.deepEqual(body.content, { media: { id: "urn:li:image:C4E10AQ" } });
      assert.match(body.commentary, /โปรโมชัน \\\(จำกัด 30 ชิ้น\\\)/, "the brackets are escaped");
      assert.match(body.commentary, /\{hashtag\|\\#\|กระเป๋าผ้า\}/, "the hashtag stays a hashtag");
      assert.equal(post.headers.Authorization, "Bearer li-token-abcdef123456");
      assert.equal(getClient().connectors.linkedin.lastPublishAt !== null, true, "the publish time is recorded");
    });

    test("a text-only post skips the image calls entirely", async () => {
      const id = mk({ image: false, caption: "ไม่มีรูป" });
      calls.length = 0;
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "schedule" });
      assert.equal(out.mode, "live");
      assert.equal(calls.length, 1, "no upload for an entry without an image");
      assert.equal(calls[0].path, "/rest/posts");
      assert.equal(JSON.parse(calls[0].body).content, undefined);
      assert.equal(out.mediaKind, "post");
    });

    test("the image gate still applies: an unreviewed image is not sent", async () => {
      const id = mk({ caption: "ยังไม่ตรวจรูป" });
      const before = calls.length;
      await assert.rejects(() => rt._publishEntry(getClient(), getEntry(id), { trigger: "schedule" }), /ด่านตรวจภาพ/);
      assert.equal(calls.length, before, "nothing leaves the machine");
    });

    test("video is refused instead of silently dropped", async () => {
      const id = mk({ image: false, caption: "คลิป" });
      const st = rt._read();
      const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id);
      ent.video = { path: imgFile, publicUrl: "https://cdn.example.com/v.mp4" };
      rt._write(st);
      await assert.rejects(() => rt._publishEntry(getClient(), getEntry(id), { trigger: "schedule" }), /วิดีโอ/);
    });

    test("without a token the run is a dry-run and says so", async () => {
      rt.saveConnectors(clientId, { connectors: { linkedin: { accessToken: "", authorUrn: "", dryRun: false } } });
      const id = mk({ image: false, caption: "ยังไม่มี token" });
      const before = calls.length;
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "schedule" });
      assert.notEqual(out.mode, "live");
      // Not configured: the note points at the manual route, not a bare "simulated".
      assert.match(out.note, /คัดลอก/);
      assert.match(out.note, /จำลอง/, "it still says plainly that nothing was sent");
      assert.equal(calls.length, before, "no request without a token");
      assert.equal(rt.getConnectorsView(clientId).linkedin.configured, false);
    });

    // ── the product-photo pair (Facebook/Instagram parity) ───────────────────
    test("an image post carries the same pair Facebook/Instagram send", async () => {
      // A real product photo on disk, like the one the app stores after "ดึงรูปจากเว็บ".
      const photoDir = path.join(root, "app", "outputs", "sa-products", clientId);
      fs.mkdirSync(photoDir, { recursive: true });
      fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG);
      const st = rt._read();
      st.clients.find((c) => c.id === clientId).products.find((x) => x.sku === sku).image = `/sa-products/${clientId}/${sku}.png`;
      rt._write(st);
      rt.saveConnectors(clientId, {
        settings: { productRefInPost: true },
        connectors: { linkedin: { accessToken: "li-token-abcdef123456", authorUrn: "urn:li:person:AbC123", dryRun: false } },
      });

      const id = mk({ caption: "คู่รูป (AI + รูปจริง)" });
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      calls.length = 0;
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "schedule" });

      assert.equal(out.mode, "live");
      assert.equal(out.mediaKind, "carousel", "two images is a multi-image post");
      assert.match(out.note, /รูปคู่/);
      assert.deepEqual(
        calls.map((c) => `${c.method} ${c.path}`),
        [
          "POST /rest/images?action=initializeUpload",
          "PUT /dms-uploads/abc?sig=1",
          "POST /rest/images?action=initializeUpload",
          "PUT /dms-uploads/abc?sig=1",
          "POST /rest/posts",
        ],
        "AI image first, product photo second, then one post",
      );
      const body = JSON.parse(calls[4].body);
      assert.deepEqual(body.content, { multiImage: { images: [{ id: "urn:li:image:C4E10AQ" }, { id: "urn:li:image:C4E10AQ" }] } });
      assert.equal(body.content.media, undefined, "multiImage replaces the single media block");

      // Same rule as Facebook: with the switch on and no photo on disk, the post
      // is refused before anything is uploaded — never a silent one-image post.
      const st2 = rt._read();
      st2.clients.find((c) => c.id === clientId).products.find((x) => x.sku === sku).image = "https://shop.example.com/remote.jpg";
      rt._write(st2);
      const noPhoto = mk({ caption: "ไม่มีรูปสินค้าในเครื่อง" });
      rt.reviewEntryImage(clientId, noPhoto, { confirmed: true });
      const before = calls.length;
      await assert.rejects(
        () => rt._publishEntry(getClient(), getEntry(noPhoto), { trigger: "schedule" }),
        /รูปสินค้าจริง/,
      );
      assert.equal(calls.length, before, "refused before uploading anything");

      // Switch off → the single-image path Facebook keeps, and it still works.
      rt.saveConnectors(clientId, { settings: { productRefInPost: false } });
      const single = mk({ caption: "รูปเดียว" });
      rt.reviewEntryImage(clientId, single, { confirmed: true });
      calls.length = 0;
      const one = await rt._publishEntry(getClient(), getEntry(single), { trigger: "schedule" });
      assert.equal(one.mediaKind, "image");
      assert.deepEqual(Object.keys(JSON.parse(calls[2].body).content), ["media"]);
      assert.equal(calls.length, 3);
    });

    // ── UI wiring ────────────────────────────────────────────────────────────
    test("the UI offers LinkedIn everywhere a platform is chosen or labelled", () => {
      const lib = read("app", "frontend", "src", "social-agency", "lib.js");
      assert.match(lib, /linkedin: \{ label: "LinkedIn", short: "in", cls: "linkedin" \}/);
      const calendar = read("app", "frontend", "src", "social-agency", "CalendarTab.jsx");
      assert.match(calendar, /const PLAN_PLATFORMS = \["facebook", "instagram", "line", "linkedin", "demo"\]/);
      const css = read("app", "frontend", "src", "social-agency.css");
      assert.match(css, /\.sa-platform-chip\.linkedin/);
      // The footer editor must not keep its own platform list that can drift.
      const footer = read("app", "frontend", "src", "social-agency", "CaptionFooterSettings.jsx");
      assert.match(footer, /const PLATFORMS = Object\.keys\(PLATFORM_META\)/);
      const drawers = read("app", "frontend", "src", "social-agency", "drawers.jsx");
      assert.match(drawers, /LinkedIn \(โปรไฟล์ส่วนตัว · Posts API\)/);
      assert.match(drawers, /linkedin: \{ accessToken: connectors\?\.linkedin\?\.accessToken/, "the connector form carries LinkedIn secrets");
      assert.match(drawers, /เปิด LinkedIn/, "the post drawer offers the manual route");
      // The connector copy must not promise a company Page or an OAuth flow we do not have.
      assert.match(drawers, /Community Management/);
      assert.match(drawers, /ยังไม่มี OAuth\/refresh ในตัว/);
    });

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok - ${name}`);
    } catch (error) {
      console.error(`  FAIL - ${name}`);
      console.error(error);
      process.exit(1);
    }
  }
  // The stub has to outlive every fixture: a leftover real request would hit
  // linkedin.com, and this suite must never touch the network.
  SocialAgencyRuntime._https = realHttps;
  console.log(`PASS: ${passed} LinkedIn calendar checks`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
