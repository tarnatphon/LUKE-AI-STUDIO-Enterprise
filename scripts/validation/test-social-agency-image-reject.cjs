#!/usr/bin/env node
"use strict";

/**
 * Social Agency — "ไม่ใช่ — ห้ามใช้รูปนี้" (reject the image).
 *
 * Rejecting an entry's image must (1) remember the image fingerprint so the
 * exact same bytes can never be approved or published again, (2) clear any
 * recorded review, (3) start generating a replacement right away (unless the
 * caller passes regenerate: false). A regenerated image that comes back with
 * the same bytes is blocked again automatically. Dry-run stays usable.
 *
 * Everything is mocked: no network, no real account, no image backend.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const PNG_A = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const PNG_B = Buffer.concat([PNG_A, Buffer.from("regenerated")]);
const PNG_A_B64 = PNG_A.toString("base64");
const PNG_B_B64 = PNG_B.toString("base64");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-image-reject-"));
  const realFetch = globalThis.fetch;
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const sku = state.clients.find((c) => c.id === clientId).products[0].sku;

  // The image backend: defaults to returning different bytes than the rejected
  // image, so a regenerated replacement clears the block.
  let responderB64 = PNG_B_B64;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: responderB64, seed: 42 }] }) });

  const saver = async (dataUrl) => {
    const name = `sa-img-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
    const file = path.join(root, name);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(",")[1], "base64"));
    return { image: name, url: `/api/output-file?filename=${name}`, absPath: file };
  };
  rt.setImageSaver(saver);

  const getClient = () => rt._read().clients.find((c) => c.id === clientId);
  const getEntry = (id) => getClient().calendar.find((e) => e.id === id);
  const mk = (time) => {
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(365), time, platform: "facebook", sku, angle: "เปิดตัวสินค้า" } });
    rt.updateCalendarEntry(clientId, e.id, { caption: "ข้อความทดสอบ" });
    return e.id;
  };
  const attach = (id, buf) => {
    const file = path.join(root, `attach-${id}-${buf.length}.png`);
    fs.writeFileSync(file, buf);
    const st = rt._read();
    const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id);
    ent.image = { path: file, filename: path.basename(file), url: `/api/output-file?filename=${path.basename(file)}` };
    rt._write(st);
  };
  const waitJob = async (id) => {
    const t0 = Date.now();
    for (;;) {
      const job = getEntry(id).imageJob;
      if (job && job.status !== "running") return job;
      if (Date.now() - t0 > 15000) throw new Error("image job did not finish in 15s");
      await sleep(25);
    }
  };

  try {
    test("rejecting records the fingerprint, clears the review, and blocks live sends", () => {
      const id = mk("09:00");
      attach(id, PNG_A);
      rt.reviewEntryImage(clientId, id, { confirmed: true });
      assert.strictEqual(getEntry(id).imageGate?.status ?? rt._imageGateInfo(getEntry(id)).status, "approved");
      const res = rt.rejectEntryImage(clientId, id, { regenerate: false });
      const ent = getEntry(id);
      assert.strictEqual(ent.imageRejections.length, 1);
      assert.strictEqual(ent.imageRejections[0].sku, sku);
      assert.ok(ent.imageRejections[0].fingerprint, "fingerprint recorded");
      assert.strictEqual(ent.imageReview, undefined, "approval cleared");
      const gate = rt._imageGateInfo(ent);
      assert.strictEqual(gate.status, "rejected");
      assert.strictEqual(gate.ok, false);
      assert.throws(() => rt._assertImageReviewed(ent), /ห้ามใช้รูปนี้|ถูกปฏิเสธ/);
      assert.strictEqual(res.regenerated, false);
    });

    test("even a forced approval cannot unblock a rejected image", () => {
      const id = mk("09:30");
      attach(id, PNG_A);
      rt.rejectEntryImage(clientId, id, { regenerate: false });
      rt.reviewEntryImage(clientId, id, { confirmed: true }); // forced re-approve
      const gate = rt._imageGateInfo(getEntry(id));
      assert.strictEqual(gate.status, "rejected", "the fingerprint check outranks the recorded approval");
      assert.strictEqual(gate.ok, false);
    });

    test("reject starts generating a replacement by default", async () => {
      const id = mk("10:00");
      attach(id, PNG_A);
      const res = rt.rejectEntryImage(clientId, id, {});
      assert.strictEqual(res.regenerated, true);
      const job = await waitJob(id);
      assert.strictEqual(job.status, "done", job.error);
      const gate = rt._imageGateInfo(getEntry(id));
      assert.strictEqual(gate.status, "unreviewed", "a different replacement image needs a fresh review, not another block");
    });

    test("a regenerated image with the same bytes is blocked again automatically", async () => {
      const id = mk("10:30");
      attach(id, PNG_A);
      rt.rejectEntryImage(clientId, id, { regenerate: false });
      responderB64 = PNG_A_B64; // the backend hands back the very same image
      rt.startEntryImageGen(clientId, id);
      await waitJob(id);
      const gate = rt._imageGateInfo(getEntry(id));
      assert.strictEqual(gate.status, "rejected", "identical bytes must stay blocked");
      assert.ok(/ห้ามใช้รูปนี้/.test(gate.reason), gate.reason);
      responderB64 = PNG_B_B64;
    });

    test("regenerate: false leaves the entry alone (no image job)", () => {
      const id = mk("11:00");
      attach(id, PNG_A);
      rt.rejectEntryImage(clientId, id, { regenerate: false });
      assert.strictEqual(getEntry(id).imageJob, undefined);
    });

    test("rejecting twice keeps one rejection per fingerprint, not two", () => {
      const id = mk("11:30");
      attach(id, PNG_A);
      rt.rejectEntryImage(clientId, id, { regenerate: false });
      rt.rejectEntryImage(clientId, id, { regenerate: false });
      assert.strictEqual(getEntry(id).imageRejections.length, 1);
    });

    test("rejecting without an image, or while generating, is refused", () => {
      const noImage = mk("12:00");
      assert.throws(() => rt.rejectEntryImage(clientId, noImage, { regenerate: false }), /ไม่มีภาพแนบ/);
      const id = mk("12:30");
      attach(id, PNG_A);
      rt.startEntryImageGen(clientId, id);
      assert.throws(() => rt.rejectEntryImage(clientId, id, { regenerate: false }), /กำลังสร้างภาพ/);
    });

    test("a published / publishing entry can no longer be rejected", () => {
      const id = mk("13:00");
      attach(id, PNG_A);
      const st = rt._read();
      st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id).status = "published";
      rt._write(st);
      assert.throws(() => rt.rejectEntryImage(clientId, id, { regenerate: false }), /เผยแพร่แล้ว/);
    });

    test("the rejected gate state reaches listCalendar responses", () => {
      const id = mk("13:30");
      attach(id, PNG_A);
      rt.rejectEntryImage(clientId, id, { regenerate: false });
      const listed = rt.listCalendar(clientId, {}).find((e) => e.id === id);
      assert.strictEqual(listed.imageGate.status, "rejected");
      assert.strictEqual(listed.imageGate.ok, false);
    });

    test("dry-run publishing still works on a rejected image", async () => {
      rt.saveConnectors(clientId, { connectors: { facebook: { pageId: "123", accessToken: "tok", dryRun: true } } });
      const id = mk("14:00");
      attach(id, PNG_A);
      rt.rejectEntryImage(clientId, id, { regenerate: false });
      const client = getClient();
      const entry = getEntry(id);
      const out = await rt._publishEntry(client, entry, { trigger: "manual" });
      assert.strictEqual(out.mode, "dry", "dry-run must not be blocked by the image gate");
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
  if (!process.exitCode) console.log(`PASS: ${passed} image reject checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
