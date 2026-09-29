#!/usr/bin/env node
"use strict";

/**
 * Social Agency — image review gate + product-image path guard.
 *
 * A real send (Facebook / Instagram / LINE OA broadcast) with an image attached
 * needs a human image review that is separate from caption approval. The review
 * is bound to the file bytes + Public URL + SKU, so replacing the file, changing
 * the URL, changing the product or regenerating the image blocks the send again.
 * Recording a review must never start a workflow or publish. Dry-run stays usable.
 *
 * Everything is mocked: no network, no real account, no image backend.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const PNG_A = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const PNG_B = Buffer.concat([PNG_A, Buffer.from("changed")]);

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-image-gate-"));
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const products = state.clients.find((c) => c.id === clientId).products;
  const sku = products[0].sku;
  const otherSku = products[1].sku;
  const imgFile = path.join(root, "gen-image.png");
  fs.writeFileSync(imgFile, PNG_A);

  rt.saveConnectors(clientId, { connectors: {
    facebook: { pageId: "1234567890", accessToken: "fake-fb-token", dryRun: false },
    instagram: { igUserId: "1784", accessToken: "fake-ig-token", dryRun: false },
    line: { channelAccessToken: "fake-line-token", dryRun: false },
  } });

  const getClient = () => rt._read().clients.find((c) => c.id === clientId);
  const getEntry = (id) => getClient().calendar.find((e) => e.id === id);
  const mk = (platform, time, extra = {}) => {
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(-1), time, platform, sku, angle: "เปิดตัวสินค้า" } });
    rt.updateCalendarEntry(clientId, e.id, { caption: "ข้อความทดสอบ" });
    // attach an AI image the way _generateEntryImage does
    const st = rt._read();
    const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === e.id);
    ent.image = { path: imgFile, filename: "gen-image.png", url: "/x.png", publicUrl: "https://cdn.example.com/a.png", ...extra };
    rt._write(st);
    return e.id;
  };

  const calls = [];
  const realHttps = SocialAgencyRuntime._https;
  SocialAgencyRuntime._https = async (opts = {}) => {
    calls.push(`${opts.host}${opts.path}`);
    if (opts.host === "graph.facebook.com") return { status: 200, json: { id: "fb_1", post_id: "fb_1" }, text: "{}" };
    if (opts.path === "/v2/bot/message/quota") return { status: 200, json: { value: 1000 }, text: "{}" };
    if (opts.path === "/v2/bot/message/quota/consumption") return { status: 200, json: { totalUsage: 1 }, text: "{}" };
    if (opts.path === "/v2/bot/message/broadcast") return { status: 200, json: {}, text: "{}" };
    throw new Error(`unexpected https call ${opts.host}${opts.path}`);
  };
  // Facebook Page has a 5-minute publish spacing guard; it is not what we test here.
  const resetSpacing = () => {
    const st = rt._read();
    const c = st.clients.find((x) => x.id === clientId);
    for (const k of ["facebook", "line", "instagram"]) if (c.connectors[k]) c.connectors[k].lastPublishAt = null;
    rt._write(st);
  };
  const publish = (id, ctx = { trigger: "schedule" }) => { resetSpacing(); return rt._publishEntry(getClient(), getEntry(id), ctx); };

  try {
    // ── gate behaviour ──
    test("unreviewed image blocks a live Facebook send before any network call", async () => {
      const id = mk("facebook", "01:01");
      const before = calls.length;
      await assert.rejects(() => publish(id), /ด่านตรวจภาพ.*ยังไม่ได้ตรวจภาพ/);
      assert.strictEqual(calls.length, before, "no request may leave the machine");
    });

    test("unreviewed image also blocks LINE OA broadcast and Instagram", async () => {
      const line = mk("line", "01:02");
      const ig = mk("instagram", "01:03");
      const before = calls.length;
      await assert.rejects(() => publish(line), /ด่านตรวจภาพ/);
      await assert.rejects(() => publish(ig), /ด่านตรวจภาพ/);
      assert.strictEqual(calls.length, before);
    });

    test("dry-run keeps working with an unreviewed image", async () => {
      const id = mk("facebook", "01:04");
      rt.saveConnectors(clientId, { connectors: { facebook: { dryRun: true } } });
      try {
        const out = await publish(id);
        assert.notStrictEqual(out.mode, "live");
      } finally {
        rt.saveConnectors(clientId, { connectors: { facebook: { dryRun: false } } });
      }
    });

    test("review needs explicit confirmation, records approval, and does NOT run or publish", async () => {
      const id = mk("facebook", "01:05");
      const runsBefore = getClient().workflowRuns.length;
      const statusBefore = getEntry(id).status;
      const before = calls.length;
      assert.throws(() => rt.reviewEntryImage(clientId, id, {}), /ยืนยัน/);
      const out = rt.reviewEntryImage(clientId, id, { confirmed: true });
      assert.strictEqual(out.imageGate.status, "approved");
      assert.strictEqual(out.imageGate.ok, true);
      assert.strictEqual(getClient().workflowRuns.length, runsBefore, "no workflow started");
      assert.strictEqual(getEntry(id).status, statusBefore, "status untouched");
      assert.strictEqual(getEntry(id).inFlight === true, false);
      assert.strictEqual(calls.length, before, "nothing published by reviewing");
    });

    test("a reviewed image goes out live on Facebook and LINE", async () => {
      const fb = mk("facebook", "01:06");
      const line = mk("line", "01:07");
      rt.reviewEntryImage(clientId, fb, { confirmed: true });
      rt.reviewEntryImage(clientId, line, { confirmed: true });
      assert.strictEqual((await publish(fb)).mode, "live");
      assert.strictEqual((await publish(line)).mode, "live");
      assert.ok(calls.some((c) => c.includes("/broadcast")));
    });

    test("changing the image file blocks the send again", async () => {
      const id = mk("facebook", "01:08");
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      const own = path.join(root, "own.png");
      fs.writeFileSync(own, PNG_A);
      const st = rt._read();
      st.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id).image.path = own;
      rt._write(st);
      assert.strictEqual(rt._imageGateInfo(getEntry(id)).ok, true, "same bytes, different path: still the reviewed image");
      fs.writeFileSync(own, PNG_B);
      const info = rt._imageGateInfo(getEntry(id));
      assert.strictEqual(info.status, "stale");
      await assert.rejects(() => publish(id), /เปลี่ยนหลังตรวจภาพ/);
    });

    test("changing the Public URL blocks the send again and drops the review", async () => {
      const id = mk("line", "01:09");
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      rt.updateCalendarEntry(clientId, id, { previewImagePublicUrl: "https://cdn.example.com/other.png" });
      assert.strictEqual(getEntry(id).imageReview, undefined);
      await assert.rejects(() => publish(id), /ด่านตรวจภาพ/);
    });

    test("changing the product (SKU) invalidates the review", async () => {
      const id = mk("facebook", "01:10");
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      rt.updateCalendarEntry(clientId, id, { sku: otherSku });
      assert.strictEqual(rt._imageGateInfo(getEntry(id)).status, "stale");
    });

    test("a replacement image being generated blocks the send, and a finished one needs a new review", async () => {
      const id = mk("facebook", "01:11");
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      let st = rt._read();
      st.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id).imageJob = { status: "running", startedAt: new Date().toISOString() };
      rt._write(st);
      assert.strictEqual(rt._imageGateInfo(getEntry(id)).status, "generating");
      await assert.rejects(() => publish(id), /กำลังสร้างภาพ/);
      assert.throws(() => rt.reviewEntryImage(clientId, id, { confirmed: true }), /กำลังสร้างภาพ/);
      // finish the "generation": new file replaces the old one
      const fresh = path.join(root, "fresh.png");
      fs.writeFileSync(fresh, PNG_B);
      st = rt._read();
      const ent = st.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id);
      ent.imageJob = { status: "done" };
      ent.image = { ...ent.image, path: fresh };
      rt._write(st);
      assert.strictEqual(rt._imageGateInfo(getEntry(id)).ok, false);
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      assert.strictEqual((await publish(id)).mode, "live");
    });

    test("a missing image file cannot be reviewed or sent", async () => {
      const id = mk("facebook", "01:12", { path: path.join(root, "nope.png") });
      assert.throws(() => rt.reviewEntryImage(clientId, id, { confirmed: true }), /อ่านไฟล์ภาพไม่ได้/);
      await assert.rejects(() => publish(id), /ด่านตรวจภาพ/);
    });

    test("text-only entries and TikTok/demo are not affected by the gate", async () => {
      const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(-1), time: "01:13", platform: "facebook", sku } });
      rt.updateCalendarEntry(clientId, e.id, { caption: "ข้อความล้วน" });
      assert.strictEqual(rt._imageGateInfo(getEntry(e.id)).required, false);
      assert.strictEqual((await publish(e.id)).mode, "live");
      assert.strictEqual(rt._imageGateInfo({ platform: "tiktok", image: { path: imgFile } }).required, false);
      assert.strictEqual(rt._imageGateInfo({ platform: "demo", image: { path: imgFile } }).required, false);
    });

    test("read APIs expose imageGate but never persist it", async () => {
      const id = mk("facebook", "01:14");
      const viaState = rt.getState().clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id);
      assert.strictEqual(viaState.imageGate.status, "unreviewed");
      assert.strictEqual(rt.listCalendar(clientId).find((e) => e.id === id).imageGate.required, true);
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      const onDisk = JSON.parse(fs.readFileSync(rt.filePath, "utf8"));
      const raw = onDisk.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id);
      assert.strictEqual(raw.imageGate, undefined);
      assert.strictEqual(raw.imageReview.status, "approved");
    });

    test("revoking a review blocks the send again", async () => {
      const id = mk("facebook", "01:15");
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      rt.reviewEntryImage(clientId, id, { approve: false });
      assert.strictEqual(rt._imageGateInfo(getEntry(id)).status, "unreviewed");
    });

    test("HTTP route records the review (409 on refusal) without running anything", async () => {
      const id = mk("facebook", "01:16");
      const call = async (body) => {
        const res = {};
        await rt.handleApiRequest({ method: "POST", url: "/api/social-agency/entry-image/review" }, res, {
          readJsonRequestBody: async () => body,
          json: (r, code, payload) => { r.statusCode = code; r.body = payload; },
        });
        return res;
      };
      const refused = await call({ clientId, entryId: id });
      assert.strictEqual(refused.statusCode, 409);
      const ok = await call({ clientId, entryId: id, confirmed: true });
      assert.strictEqual(ok.statusCode, 200);
      assert.strictEqual(ok.body.imageGate.status, "approved");
    });

    // ── the workflow: an unreviewed image parks the entry, never fails/sends ──
    test("workflow (even force-approved) parks an unreviewed live image for image review; nothing is sent", async () => {
      const id = mk("facebook", "01:17");
      const before = calls.length;
      resetSpacing();
      rt.runWorkflow(clientId, id, { trigger: "approve", force: true });
      for (let i = 0; i < 100 && getEntry(id).inFlight; i += 1) await sleep(200);
      const entry = getEntry(id);
      assert.strictEqual(entry.inFlight, false);
      assert.strictEqual(entry.status, "needs_review");
      const run = getClient().workflowRuns.find((r) => r.entryId === id);
      assert.strictEqual(run.gate.decision, "image-review");
      assert.strictEqual(run.publish, null);
      assert.strictEqual(calls.length, before);
    });

    test("after the image review, approving the same entry publishes", async () => {
      const id = mk("facebook", "01:18");
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      resetSpacing();
      rt.runWorkflow(clientId, id, { trigger: "approve", force: true });
      for (let i = 0; i < 100 && getEntry(id).inFlight; i += 1) await sleep(200);
      assert.strictEqual(getEntry(id).status, "published");
      assert.strictEqual(getEntry(id).publishMode, "live");
    });

    // ── product image path guard ──
    test("product image path must belong to this client and SKU", async () => {
      const client = getClient();
      const product = client.products.find((p) => p.sku === sku);
      const dir = path.join(root, "app", "outputs", "sa-products", clientId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${sku}.jpg`), PNG_A);
      fs.writeFileSync(path.join(dir, `${otherSku}.jpg`), PNG_B);
      const secret = path.join(root, "secret.txt");
      fs.writeFileSync(secret, "do not read");

      const good = rt._resolveProductImageFile(client, { ...product, image: `/sa-products/${clientId}/${sku}.jpg` });
      assert.ok(good.file && good.file.endsWith(`${sku}.jpg`), JSON.stringify(good));
      for (const bad of [
        `/sa-products/${clientId}/${otherSku}.jpg`,          // another SKU
        `/sa-products/other-client/${sku}.jpg`,              // another client
        `/sa-products/../../../secret.txt`,                  // traversal
        `/sa-products/${clientId}/../${clientId}/${sku}.jpg`, // dot-segments
        `/sa-products/${clientId}/${sku}.txt`,               // not an image
        `/sa-products/${clientId}/${sku}.jpg/../../x.jpg`,
      ]) {
        assert.ok(rt._resolveProductImageFile(client, { ...product, image: bad }).error, `must refuse ${bad}`);
      }
      // a symlink inside the product folder pointing elsewhere is refused too
      try {
        fs.symlinkSync(secret, path.join(dir, "LINKED.jpg"));
        assert.ok(rt._resolveProductImageFile(client, { sku: "LINKED", image: `/sa-products/${clientId}/LINKED.jpg` }).error);
      } catch (err) { if (err.code !== "EPERM") throw err; }
    });

    test("a mismatched product image is not read for the reference, and the reason is reported", async () => {
      const client = getClient();
      const info = {};
      const ent = { sku };
      const c2 = { ...client, products: client.products.map((p) => (p.sku === sku ? { ...p, image: `/sa-products/${clientId}/${otherSku}.jpg` } : p)) };
      assert.strictEqual(await rt._productReferenceDataUrl(c2, ent, info), null);
      assert.match(info.warning, /ไม่ตรงกับลูกค้า\/SKU/);
      const ok = await rt._productReferenceDataUrl({ ...client, products: client.products.map((p) => (p.sku === sku ? { ...p, image: `/sa-products/${clientId}/${sku}.jpg` } : p)) }, ent, {});
      assert.ok(ok && ok.dataUrl.startsWith("data:image/jpeg;base64,"));
    });

    test("saving a product image path for another client/SKU is rejected", async () => {
      const client = getClient();
      const product = client.products.find((p) => p.sku === sku);
      assert.throws(() => rt._applyProductImage(client, product, "/sa-products/other/x.jpg"), /เฉพาะ|เท่านั้น/);
      assert.throws(() => rt._applyProductImage(client, product, "/sa-products/../../etc/passwd"), /เท่านั้น/);
      assert.strictEqual(rt._applyProductImage(client, product, `/sa-products/${clientId}/${sku}.jpg`), `/sa-products/${clientId}/${sku}.jpg`);
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
  if (!process.exitCode) console.log(`PASS: ${passed} image review gate checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
