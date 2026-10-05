#!/usr/bin/env node
"use strict";

/**
 * Social Agency — Facebook multi-photo post with the real product photo,
 * plus the 500px derivative cache and the calendar image-size settings.
 *
 * A Facebook image post carries [1] the AI image (generated as usual) and
 * [2] the product's real photo — unmodified apart from the ≤500px long-edge
 * derivative the app produces with canvas and caches as <sku>.ref500.jpg.
 * Delivery is two unpublished photo uploads + one feed post with
 * attached_media. When there is nothing to attach (setting off, no local
 * product photo) the plain single-photo path is kept, and a failed second
 * upload degrades to a single-photo post with a note instead of losing the
 * whole post.
 *
 * Everything is mocked: no network, no real account, no image backend.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const PNG_A = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const REF500_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-500px-jpeg-bytes")]);

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-fb-refpost-"));
  const realHttps = SocialAgencyRuntime._https;
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const client0 = state.clients.find((c) => c.id === clientId);
  const sku = client0.products[0].sku;

  // A local product photo + its 500px derivative, the way the app stores them.
  const photoDir = path.join(root, "app", "outputs", "sa-products", clientId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG_A);
  const setProductImage = (value) => {
    const st = rt._read();
    st.clients.find((c) => c.id === clientId).products.find((p) => p.sku === sku).image = value;
    rt._write(st);
  };
  setProductImage(`/sa-products/${clientId}/${sku}.png`);

  rt.saveConnectors(clientId, { connectors: { facebook: { pageId: "1234567890", accessToken: "fake-fb-token", dryRun: false } } });

  const getClient = () => rt._read().clients.find((c) => c.id === clientId);
  const getEntry = (id) => getClient().calendar.find((e) => e.id === id);
  const mk = (time) => {
    // yesterday, so a manual trigger is due now and publishes live in the mock
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(-1), time, platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
    rt.updateCalendarEntry(clientId, e.id, { caption: "ดูสินค้าใหม่ได้ที่ https://shop.example.com/p/wlb-006 ครับ" });
    return e.id;
  };
  const attachImage = (id) => {
    const file = path.join(root, `ai-${id}.png`);
    fs.writeFileSync(file, PNG_A);
    const st = rt._read();
    const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id);
    ent.image = { path: file, filename: path.basename(file), url: `/api/output-file?filename=${path.basename(file)}` };
    rt._write(st);
    rt.reviewEntryImage(clientId, id, { confirmed: true });
  };
  const resetFbClock = () => {
    const st = rt._read();
    const fb = st.clients.find((c) => c.id === clientId).connectors.facebook;
    delete fb.lastPublishAt;
    rt._write(st);
  };

  // ── Graph API mock ────────────────────────────────────────────────────────
  let calls = [];
  let photoFailures = 0; // how many /photos uploads fail (counted from the first)
  let photoCount = 0;
  SocialAgencyRuntime._https = async ({ method, host, path: urlPath, body }) => {
    calls.push({ method, host, urlPath, body: Buffer.isBuffer(body) ? body.toString("latin1") : String(body ?? "") });
    if (urlPath.includes("/photos")) {
      photoCount += 1;
      if (photoCount > 1 && photoFailures > 0) {
        photoFailures -= 1;
        return { status: 400, json: { error: { message: "mock upload failure" } } };
      }
      return { status: 200, json: { id: `photo-${photoCount}` } };
    }
    if (urlPath.includes("/feed")) return { status: 200, json: { id: "post-123" } };
    return { status: 404, json: {} };
  };
  const freshCalls = () => { calls = []; photoCount = 0; return calls; };
  const photosCalls = (seen) => seen.filter((c) => c.urlPath.endsWith("/photos"));
  const feedCall = (seen) => seen.find((c) => c.urlPath.endsWith("/feed"));
  const multipartField = (body, name) => {
    const m = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`));
    return m ? m[1] : undefined;
  };
  const hasFile = (body, filename) => body.includes(`filename="${filename}"`);

  try {
    test("multi-photo happy path: AI image first, 500px product photo second, caption on the feed post", async () => {
      fs.writeFileSync(path.join(photoDir, `${sku}.ref500.jpg`), REF500_JPEG);
      const id = mk("09:00");
      attachImage(id);
      resetFbClock();
      freshCalls();
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });
      assert.strictEqual(out.mode, "live");
      assert.strictEqual(out.mediaKind, "multi-photo");
      assert.strictEqual(out.attachedProductRef, true);
      assert.strictEqual(out.postId, "post-123");
      const ups = photosCalls(calls);
      assert.strictEqual(ups.length, 2, "two unpublished photo uploads");
      assert.strictEqual(multipartField(ups[0].body, "published"), "false");
      assert.strictEqual(multipartField(ups[1].body, "published"), "false");
      assert.ok(hasFile(ups[0].body, path.basename(getEntry(id).image.filename)), "AI image uploaded first");
      assert.ok(hasFile(ups[1].body, `${sku}.ref500.jpg`), "500px product photo uploaded second");
      assert.ok(ups[1].body.includes(REF500_JPEG.toString("latin1")), "the 500px bytes are the product derivative");
      const feed = feedCall(calls);
      assert.ok(feed, "feed post created");
      const feedBody = JSON.parse(feed.body);
      assert.deepStrictEqual(feedBody.attached_media, [{ media_fbid: "photo-1" }, { media_fbid: "photo-2" }]);
      assert.strictEqual(feedBody.access_token, "fake-fb-token");
      assert.ok(feedBody.message.includes("https://shop.example.com/p/wlb-006"), "caption carried over");
      assert.ok(feedBody.message.includes("utm_source=facebook"), "outbound links still get UTM");
    });

    test("turning productRefInPost off keeps the plain single-photo post", async () => {
      rt.saveConnectors(clientId, { settings: { productRefInPost: false } });
      const id = mk("09:30");
      attachImage(id);
      resetFbClock();
      freshCalls();
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });
      assert.strictEqual(out.mediaKind !== "multi-photo", true);
      assert.strictEqual(out.attachedProductRef, false);
      const ups = photosCalls(calls);
      assert.strictEqual(ups.length, 1, "single photo upload");
      assert.strictEqual(multipartField(ups[0].body, "published"), undefined, "the old path publishes directly");
      assert.strictEqual(multipartField(ups[0].body, "caption").includes("utm_source=facebook"), true);
      assert.strictEqual(feedCall(calls), undefined);
      rt.saveConnectors(clientId, { settings: { productRefInPost: true } });
    });

    test("without the 500px derivative the original product photo is attached with a note", async () => {
      fs.rmSync(path.join(photoDir, `${sku}.ref500.jpg`));
      const id = mk("10:00");
      attachImage(id);
      resetFbClock();
      freshCalls();
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });
      assert.strictEqual(out.attachedProductRef, true);
      assert.strictEqual(out.mediaKind, "multi-photo");
      const ups = photosCalls(calls);
      assert.strictEqual(ups.length, 2);
      assert.ok(hasFile(ups[1].body, `${sku}.png`), "the original product photo is the fallback");
      assert.ok(out.note.includes("500"), `note mentions 500px: ${out.note}`);
    });

    test("a failed product-photo upload degrades to a single-photo post, never loses the whole post", async () => {
      fs.writeFileSync(path.join(photoDir, `${sku}.ref500.jpg`), REF500_JPEG);
      const id = mk("10:30");
      attachImage(id);
      resetFbClock();
      freshCalls();
      photoFailures = 1;
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });
      assert.strictEqual(out.postId, "post-123");
      assert.strictEqual(out.attachedProductRef, false);
      assert.strictEqual(out.mediaKind, "post");
      const feed = feedCall(calls);
      const feedBody = JSON.parse(feed.body);
      assert.deepStrictEqual(feedBody.attached_media, [{ media_fbid: "photo-1" }]);
      assert.ok(out.note.includes("แนบรูปสินค้าไม่สำเร็จ"), out.note);
      photoFailures = 0;
    });

    test("no local product photo at all keeps the single-photo path silently", async () => {
      setProductImage("https://cdn.example.com/somewhere-else.png");
      // Use a slot distinct from the demo seed's published weekend entry (11:00).
      const id = mk("11:15");
      attachImage(id);
      resetFbClock();
      freshCalls();
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });
      assert.strictEqual(out.attachedProductRef, false);
      assert.strictEqual(photosCalls(calls).length, 1);
      assert.strictEqual(feedCall(calls), undefined);
      setProductImage(`/sa-products/${clientId}/${sku}.png`);
    });

    test("ref-image-500 endpoint: status, save, validation, and client/SKU binding", () => {
      fs.rmSync(path.join(photoDir, `${sku}.ref500.jpg`), { force: true });
      const status0 = rt.getProductRef500Status(clientId, sku);
      assert.strictEqual(status0.local, true);
      assert.strictEqual(status0.exists, false);
      assert.throws(() => rt.getProductRef500Status(clientId, "NOPE-404"), /ไม่พบสินค้า/);
      assert.throws(() => rt.saveProductRef500(clientId, { sku, dataUrl: "data:image/png;base64,AAAA" }), /data:image\/jpeg/);
      assert.throws(() => rt.saveProductRef500(clientId, { sku: "NOPE-404", dataUrl: "data:image/jpeg;base64,AAAA" }), /ไม่พบสินค้า/);
      const okB64 = REF500_JPEG.toString("base64");
      const saved = rt.saveProductRef500(clientId, { sku, dataUrl: `data:image/jpeg;base64,${okB64}` });
      assert.strictEqual(saved.sku, sku);
      assert.ok(fs.existsSync(path.join(photoDir, `${sku}.ref500.jpg`)));
      assert.strictEqual(fs.readFileSync(path.join(photoDir, `${sku}.ref500.jpg`)).toString("base64"), okB64, "bytes stored exactly — no re-encode");
      const status1 = rt.getProductRef500Status(clientId, sku);
      assert.strictEqual(status1.exists, true);
      assert.strictEqual(status1.url, `/sa-products/${clientId}/${sku}.ref500.jpg`);
    });

    test("an entry for a product of another client never resolves to that client's photo", () => {
      // The path guard already refuses mismatched client/SKU; the ref500 writer
      // goes through the same resolver, so a cross-client attach is impossible.
      const st = rt._read();
      const other = st.clients.find((c) => c.id !== clientId);
      if (!other) return;
      const product = getClient().products.find((p) => p.sku === sku);
      const guarded = rt._resolveProductImageFile(other, product);
      assert.ok(guarded.error, "mismatched client/SKU must not resolve");
      assert.ok(/ไม่ตรงกับลูกค้า\/SKU/.test(guarded.error), guarded.error);
    });

    test("calendar image size: default banner 1024×600, per-client override, junk falls back", () => {
      const size = rt._clientImageSize(getClient());
      assert.deepStrictEqual(size, { width: 1024, height: 600 });
      rt.saveConnectors(clientId, { settings: { imageWidth: 800, imageHeight: 600 } });
      assert.deepStrictEqual(rt._clientImageSize(getClient()), { width: 800, height: 600 });
      rt.saveConnectors(clientId, { settings: { imageWidth: "junk", imageHeight: -5 } });
      assert.deepStrictEqual(rt._clientImageSize(getClient()), { width: 1024, height: 600 }, "junk falls back to the default");
      rt.saveConnectors(clientId, { settings: { imageWidth: 9999, imageHeight: 601 } });
      assert.deepStrictEqual(rt._clientImageSize(getClient()), { width: 1536, height: 600 }, "clamped to max and snapped to a multiple of 8");
    });

    test("the client size reaches both generation bodies (txt2img size + img2img width/height)", () => {
      rt.saveConnectors(clientId, { settings: { imageWidth: 1024, imageHeight: 600 } });
      const size = rt._clientImageSize(getClient());
      const plan = rt._imageRequestPlan("a prompt", null, { enabled: false, mode: "img2img", denoise: 0.38 }, {}, size);
      assert.strictEqual(plan.body.size, "1024x600");
      const img2img = rt._imageImg2ImgBody("a prompt", PNG_A.toString("base64"), null, 0.38, { steps: 20, sent: 53, capped: false }, { width: 1024, height: 600 });
      assert.strictEqual(img2img.width, 1024);
      assert.strictEqual(img2img.height, 600);
      // without a client size (other callers) the old behaviour is untouched
      const legacy = rt._imageGenBody("a prompt", null, null);
      assert.ok(legacy.size, "legacy size still present");
    });

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
  } finally {
    SocialAgencyRuntime._https = realHttps;
  }
  if (!process.exitCode) console.log(`PASS: ${passed} facebook ref multi-photo checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
