#!/usr/bin/env node
"use strict";

/**
 * Social Agency — LINE image broadcasts carry the same PAIR as Facebook/Instagram.
 *
 * A LINE broadcast with an image is [1] the AI image, [2] the real product photo
 * (≤500px derivative, hosted through imgbb because LINE fetches images by URL),
 * then the caption text. When the pair cannot be made, the send is refused before
 * anything is broadcast. Turning productRefInPost off keeps the single-image send.
 *
 * Everything is mocked: no network, no LINE account, no imgbb.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const PNG_A = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const REF500_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-500px-jpeg-bytes")]);
const AI_URL = "https://cdn.example.com/ai-image.png";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-line-refpair-"));
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const client0 = state.clients.find((c) => c.id === clientId);
  const sku = client0.products[0].sku;

  // A local product photo and its 500px derivative, stored the way the app stores them.
  const photoDir = path.join(root, "app", "outputs", "sa-products", clientId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG_A);
  fs.writeFileSync(path.join(photoDir, `${sku}.ref500.jpg`), REF500_JPEG);
  const setProductImage = (value) => {
    const st = rt._read();
    st.clients.find((c) => c.id === clientId).products.find((p) => p.sku === sku).image = value;
    rt._write(st);
  };
  const localPhoto = `/sa-products/${clientId}/${sku}.png`;
  setProductImage(localPhoto);

  rt.saveConnectors(clientId, { connectors: {
    line: { channelAccessToken: "fake-line-token", dryRun: false },
    instagram: { imgbbApiKey: "fake-imgbb-key" },
  } });

  const getClient = () => rt._read().clients.find((c) => c.id === clientId);
  const getEntry = (id) => getClient().calendar.find((e) => e.id === id);
  let slot = 0;
  const mk = () => {
    slot += 1;
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(-slot), time: "09:00", platform: "line", sku, angle: "เปิดตัวสินค้า" } });
    rt.updateCalendarEntry(clientId, e.id, { caption: "สินค้าใหม่มาแล้วค่ะ ดูรายละเอียดได้เลย" });
    return e.id;
  };
  const attachImage = (id) => {
    const file = path.join(root, `ai-${id}.png`);
    fs.writeFileSync(file, PNG_A);
    const st = rt._read();
    const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id);
    ent.image = { path: file, filename: path.basename(file), url: `/api/output-file?filename=${path.basename(file)}`, publicUrl: AI_URL };
    rt._write(st);
    rt.reviewEntryImage(clientId, id, { confirmed: true });
  };

  // ── LINE + imgbb mocks ───────────────────────────────────────────────────
  let broadcasts = [];
  let uploads = [];
  rt._lineBroadcast = async (secret, messages) => {
    broadcasts.push(messages);
    return { quotaNote: "" };
  };
  rt._imgbbUpload = async (image, key) => {
    uploads.push({ filename: image.filename, key, bytes: image.buffer ? Buffer.from(image.buffer) : null });
    return `https://i.ibb.example/${uploads.length}-${image.filename}`;
  };
  // Keyless free host — the whole point of the chain is that LINE can post
  // without an imgbb account.
  let freeUploads = 0;
  rt._uploadToCatbox = async (bytes) => {
    freeUploads += 1;
    return `https://files.catbox.example/${freeUploads}-${bytes.filename}`;
  };
  const resetLineClock = () => {
    const st = rt._read();
    delete st.clients.find((c) => c.id === clientId).connectors.line.lastPublishAt;
    rt._write(st);
  };
  const publish = (id) => rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });

  test("LINE broadcast: AI image, then the real product photo, then the caption", async () => {
    broadcasts = [];
    uploads = [];
    setProductImage(localPhoto);
    const id = mk();
    attachImage(id);
    resetLineClock();
    const out = await publish(id);
    assert.strictEqual(out.mode, "live");
    assert.strictEqual(broadcasts.length, 1, "one broadcast");
    const msgs = broadcasts[0];
    assert.deepStrictEqual(msgs.map((m) => m.type), ["image", "image", "text"], "image, product photo, text");
    assert.strictEqual(msgs[0].originalContentUrl, AI_URL, "AI image first");
    assert.ok(msgs[1].originalContentUrl.startsWith("https://i.ibb.example/"), "product photo hosted at a public URL");
    assert.strictEqual(msgs[1].previewImageUrl, msgs[1].originalContentUrl, "preview matches the photo");
    assert.strictEqual(uploads.length, 1, "only the product photo is uploaded");
    assert.strictEqual(uploads[0].key, "fake-imgbb-key", "uploaded with the imgbb key");
    assert.ok(uploads[0].bytes && uploads[0].bytes.equals(REF500_JPEG), "the 500px derivative is what was uploaded");
    assert.strictEqual(out.attachedProductRef, true, "result says the product photo was attached");
  });

  test("ไม่มีรูปสินค้าจริง → ไม่ส่ง LINE เลย (ไม่ส่งภาพเดียว)", async () => {
    broadcasts = [];
    uploads = [];
    setProductImage("https://www.example-shop.test/product/ssb-018.jpg");
    const id = mk();
    attachImage(id);
    resetLineClock();
    await assert.rejects(() => publish(id), /LINE/, "refused with a LINE message");
    assert.strictEqual(broadcasts.length, 0, "nothing broadcast");
    assert.strictEqual(uploads.length, 0, "nothing uploaded");
    setProductImage(localPhoto);
  });

  test("ไม่มี imgbb API key → ใช้โฮสต์ฟรีที่ไม่มี key แทน (ยังส่ง 2 รูป)", async () => {
    broadcasts = [];
    uploads = [];
    freeUploads = 0;
    rt.saveConnectors(clientId, { connectors: { instagram: { imgbbApiKey: "" } } });
    const id = mk();
    attachImage(id);
    resetLineClock();
    const out = await publish(id);
    assert.strictEqual(out.mode, "live", "no key needed any more");
    assert.deepStrictEqual(broadcasts[0].map((m) => m.type), ["image", "image", "text"], "still the pair, never one image");
    assert.ok(broadcasts[0][1].originalContentUrl.startsWith("https://files.catbox.example/"), "product photo on the free host");
    assert.strictEqual(freeUploads, 1, "exactly one free upload for the product photo");
    assert.strictEqual(uploads.length, 0, "imgbb is skipped when there is no key");
    assert.deepStrictEqual(out.imageHost, ["publicUrl", "catbox"], "the result says where each picture came from");
    rt.saveConnectors(clientId, { connectors: { instagram: { imgbbApiKey: "fake-imgbb-key" } } });
  });

  test("ไม่มีที่พักรูปเลย → ไม่ส่งภาพเดียวแทน", async () => {
    broadcasts = [];
    uploads = [];
    freeUploads = 0;
    // "own" with no address = no provider can run; the post must fail, not degrade.
    rt.saveConnectors(clientId, { settings: { imageHost: { provider: "own", ownUrl: "" } } });
    const id = mk();
    attachImage(id);
    resetLineClock();
    await assert.rejects(() => publish(id), /ที่พักสาธารณะ|ที่พักรูป/, "refused when nothing can host the photo");
    assert.strictEqual(broadcasts.length, 0, "nothing broadcast");
    assert.strictEqual(freeUploads, 0, "the free host is not used when the operator picked another provider");
    rt.saveConnectors(clientId, { settings: { imageHost: { provider: "auto", ownUrl: "" } } });
  });

  test("productRefInPost ปิด → LINE ส่งภาพเดียวเหมือนเดิม", async () => {
    broadcasts = [];
    uploads = [];
    rt.saveConnectors(clientId, { settings: { productRefInPost: false } });
    const id = mk();
    attachImage(id);
    resetLineClock();
    await publish(id);
    assert.deepStrictEqual(broadcasts[0].map((m) => m.type), ["image", "text"], "single image kept when the pair is off");
    assert.strictEqual(uploads.length, 0, "no product photo uploaded");
    rt.saveConnectors(clientId, { settings: { productRefInPost: true } });
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
  if (!process.exitCode) console.log(`PASS: ${passed} LINE product-photo pair checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
