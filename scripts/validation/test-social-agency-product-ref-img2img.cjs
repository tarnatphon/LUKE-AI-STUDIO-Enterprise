#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the real product photo must reach the backend in a form the
 * backend actually uses.
 *
 * The bundled stable-diffusion backend ignores `reference_images` on
 * /v1/images/generations: it answers 200 with a picture of something else (a
 * bag came back as a dress, and the image review gate then asked a human to
 * approve the wrong product). The Generator workspace already avoids this by
 * sending img2img — the photo as the init image with a low denoising strength —
 * so calendar image generation does the same, and says so on the job record.
 *
 * What is asserted here:
 *   - default settings put the product photo in `init_images` on
 *     /sdapi/v1/img2img, with the configured (low) denoising strength
 *   - the job records refMode / denoise so the interface can show the truth
 *   - a backend without img2img falls back to the old path *and* warns
 *   - a rejected / missing product photo still generates, and warns
 *   - `useProductRef: false` and `productRefMode: "reference"` stay available
 *   - the denoise value cannot be configured outside 0.15–0.75
 *   - the backend URL comes from the live provider, not a stale default
 *
 * Everything is mocked: no network, no image backend, no real account.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

// 1×1 transparent PNG — an image the file-type check accepts.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082",
  "hex"
);
const PNG_BASE64 = PNG.toString("base64");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-ref-img2img-"));
  const realFetch = globalThis.fetch;
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const products = state.clients.find((c) => c.id === clientId).products;
  const sku = products[0].sku;
  const otherSku = products[1].sku;

  // The product photo the calendar image has to look like.
  const photoDir = path.join(root, "app", "outputs", "sa-products", clientId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG);
  fs.writeFileSync(path.join(photoDir, `${otherSku}.png`), PNG);

  const setProductImage = (value) => {
    const st = rt._read();
    const client = st.clients.find((c) => c.id === clientId);
    client.products.find((p) => p.sku === sku).image = value;
    rt._write(st);
  };
  setProductImage(`/sa-products/${clientId}/${sku}.png`);

  const saver = async (dataUrl, metadata) => {
    const name = `sa-img-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
    const file = path.join(root, name);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(",")[1], "base64"));
    return { image: name, url: `/api/output-file?filename=${name}`, absPath: file };
  };
  rt.setImageSaver(saver);

  // ── request capture ──────────────────────────────────────────────────────
  let calls = [];
  let responder = () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_BASE64, seed: 42 }] }) });
  globalThis.fetch = async (url, opts) => {
    const res = await responder(String(url), opts);
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return res;
  };

  const makeEntry = (time, extra = {}) => {
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(1), time, platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
    if (Object.keys(extra).length) rt.updateCalendarEntry(clientId, e.id, extra);
    return e.id;
  };
  const getEntry = (id) => rt._read().clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id);
  const waitJob = async (id) => {
    const t0 = Date.now();
    for (;;) {
      const job = getEntry(id).imageJob;
      if (job && job.status !== "running") return job;
      if (Date.now() - t0 > 15000) throw new Error("image job did not finish in 15s");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const regenerate = async (id) => {
    calls = [];
    rt.startEntryImageGen(clientId, id);
    const job = await waitJob(id);
    return { id, job, entry: getEntry(id), calls };
  };
  const generate = async (time, extra = {}) => {
    calls = [];
    return regenerate(makeEntry(time, extra));
  };
  const setSettings = (settings) => rt.saveConnectors(clientId, { settings });

  try {
    test("the product photo goes to the backend as the init image (img2img)", async () => {
      const { id, job, entry, calls: seen } = await generate("01:01");
      assert.strictEqual(job.status, "done", job.error);
      assert.strictEqual(seen.length, 1, "one request, no fallback");
      assert.ok(seen[0].url.endsWith("/sdapi/v1/img2img"), seen[0].url);
      assert.deepStrictEqual(seen[0].body.init_images, [PNG_BASE64], "the real product photo is the init image");
      assert.strictEqual(seen[0].body.denoising_strength, 0.38, "low denoise by default");
      assert.ok(seen[0].body.denoising_strength <= 0.5, "denoise stays low enough to keep the product");
      // same body shape the Generator sends for img2img (see services/api.js)
      assert.strictEqual(seen[0].body.reference_settings.denoiseGuidance, 0.38);
      assert.strictEqual(seen[0].body.reference_images[0].role, "Appearance");
      assert.strictEqual(job.refMode, "img2img");
      assert.strictEqual(job.usedProductRef, true);
      assert.strictEqual(job.denoise, 0.38);
      assert.strictEqual(job.warning, undefined, "no warning when the product really was used");
      assert.ok(entry.image.url.startsWith("/api/output-file?filename="), "the generated image is attached");
      assert.ok(fs.existsSync(entry.image.path));
    });

    test("the job record survives a read and drives the interface", async () => {
      const { id } = await generate("01:02");
      const fromState = rt.getState().clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id);
      assert.strictEqual(fromState.imageJob.refMode, "img2img");
      assert.strictEqual(fromState.imageJob.denoise, 0.38);
      // listCalendar decorates the same entry the tabs read
      const listed = rt.listCalendar(clientId).find((e) => e.id === id);
      assert.strictEqual(listed.imageJob.refMode, "img2img");
    });

    test("generating a new image clears the old human image review", async () => {
      const { id } = await generate("01:03");
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      assert.strictEqual(rt._imageGateInfo(getEntry(id)).status, "approved");
      const redone = await regenerate(id); // regenerate the image of the same entry
      assert.strictEqual(redone.job.status, "done");
      assert.strictEqual(redone.job.refMode, "img2img");
      assert.strictEqual(rt._imageGateInfo(getEntry(id)).status, "unreviewed", "a new image needs a new review");
    });

    test("a backend without img2img falls back to reference_images and warns", async () => {
      responder = async (url) => (url.endsWith("/sdapi/v1/img2img")
        ? { ok: false, status: 404, json: async () => ({ error: "not found" }) }
        : { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_BASE64, seed: 1 }] }) });
      const { job, calls: seen } = await generate("01:04");
      responder = () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_BASE64, seed: 42 }] }) });
      assert.strictEqual(job.status, "done", "a missing endpoint must not fail the post");
      assert.strictEqual(seen.length, 2, "tried img2img, then fell back");
      assert.ok(seen[0].url.endsWith("/sdapi/v1/img2img"));
      assert.ok(seen[1].url.endsWith("/v1/images/generations"));
      assert.strictEqual(seen[1].body.reference_images[0].src, `data:image/png;base64,${PNG_BASE64}`);
      assert.strictEqual(job.refMode, "reference");
      assert.match(job.warning, /ไม่ได้ใช้รูปสินค้าอ้างอิง/);
      assert.match(job.warning, /ไม่รองรับ img2img/);
    });

    test("a 400 that names an img2img-only field falls back, any other 400 fails", async () => {
      responder = async (url) => (url.endsWith("/sdapi/v1/img2img")
        ? { ok: false, status: 400, text: async () => '{"error":"unknown field init_images"}' }
        : { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_BASE64, seed: 1 }] }) });
      const fellBack = await generate("01:05");
      assert.strictEqual(fellBack.job.status, "done");
      assert.strictEqual(fellBack.calls.length, 2);
      assert.strictEqual(fellBack.job.refMode, "reference");

      responder = async () => ({ ok: false, status: 400, text: async () => '{"error":"prompt too long"}' });
      const real = await generate("01:06");
      responder = () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_BASE64, seed: 42 }] }) });
      assert.strictEqual(real.job.status, "error");
      assert.match(real.job.error, /HTTP 400/);
      assert.strictEqual(real.calls.length, 1, "a real bad request is not retried as a different feature");
    });

    test("a rejected product photo still generates, and the reason is on the job", async () => {
      setProductImage(`/sa-products/${clientId}/${otherSku}.png`); // another SKU: the guard refuses it
      const { job, calls: seen } = await generate("01:07");
      assert.strictEqual(job.status, "done");
      assert.strictEqual(seen.length, 1);
      assert.ok(seen[0].url.endsWith("/v1/images/generations"), "no init image to send");
      assert.deepStrictEqual(seen[0].body.reference_images, []);
      assert.strictEqual(job.refMode, "none");
      assert.strictEqual(job.usedProductRef, false);
      assert.match(job.warning, /ไม่ได้ใช้รูปสินค้าอ้างอิง/);
      assert.match(job.warning, /ไม่ตรงกับลูกค้า\/SKU/);
      setProductImage(`/sa-products/${clientId}/${sku}.png`);
    });

    test("a product with no photo at all warns instead of silently inventing one", async () => {
      setProductImage("");
      const { job, calls: seen } = await generate("01:08");
      assert.strictEqual(job.status, "done");
      assert.ok(seen[0].url.endsWith("/v1/images/generations"));
      assert.strictEqual(job.usedProductRef, false);
      assert.match(job.warning, /ไม่ได้ใช้รูปสินค้าอ้างอิง/);
      assert.match(job.warning, /ยังไม่มีรูป/);
      setProductImage(`/sa-products/${clientId}/${sku}.png`);
    });

    test("denoise is clamped, and an unknown mode is ignored", async () => {
      setSettings({ productRefDenoise: 0.9, productRefMode: "img2img" });
      assert.strictEqual(rt.getConnectorsView(clientId).settings.productRefDenoise, 0.75, "0.9 clamps down to 0.75");
      const high = await generate("01:09");
      assert.strictEqual(high.calls[0].body.denoising_strength, 0.75);
      assert.strictEqual(high.job.denoise, 0.75);

      setSettings({ productRefDenoise: 0.01, productRefMode: "not-a-mode" });
      const view = rt.getConnectorsView(clientId).settings;
      assert.strictEqual(view.productRefDenoise, 0.15, "0.01 clamps up to 0.15");
      assert.strictEqual(view.productRefMode, "img2img", "an unknown mode cannot leave the allowed set");
      const low = await generate("01:10");
      assert.strictEqual(low.calls[0].body.denoising_strength, 0.15);
      setSettings({ productRefDenoise: 0.38 });
    });

    test("the legacy reference mode is still available, and keeps a low denoiseGuidance", async () => {
      setSettings({ productRefMode: "reference" });
      const { job, calls: seen } = await generate("01:11");
      assert.ok(seen[0].url.endsWith("/v1/images/generations"));
      assert.ok(!seen[0].body.init_images, "no init image in reference mode");
      assert.strictEqual(seen[0].body.reference_images[0].src, `data:image/png;base64,${PNG_BASE64}`);
      assert.strictEqual(job.refMode, "reference");
      assert.strictEqual(job.usedProductRef, true);
      assert.strictEqual(job.warning, undefined, "the legacy mode is a choice, not a failure");
      setSettings({ productRefMode: "img2img" });
    });

    test("turning the product photo off sends neither an init image nor a reference", async () => {
      setSettings({ useProductRef: false });
      const { job, calls: seen } = await generate("01:12");
      assert.ok(seen[0].url.endsWith("/v1/images/generations"));
      assert.ok(!seen[0].body.init_images);
      assert.deepStrictEqual(seen[0].body.reference_images, []);
      assert.strictEqual(job.refMode, "off");
      assert.strictEqual(job.usedProductRef, false);
      assert.strictEqual(job.warning, undefined, "an explicit setting is not a warning");
      setSettings({ useProductRef: true });
    });

    test("the backend URL is read live, so a moved Image API port still works", async () => {
      rt.setImageBackendProvider(() => "http://127.0.0.1:9123/");
      const { calls: seen } = await generate("01:13");
      assert.ok(seen[0].url.startsWith("http://127.0.0.1:9123/"), seen[0].url);
      rt.setImageBackendProvider(() => "");
      const fallback = await generate("01:14");
      assert.ok(fallback.calls[0].url.startsWith("http://127.0.0.1:8080/"), fallback.calls[0].url);
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
    globalThis.fetch = realFetch;
    rt.setImageSaver(null);
  }
  if (!process.exitCode) console.log(`PASS: ${passed} product-reference img2img checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
