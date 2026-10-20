#!/usr/bin/env node
"use strict";

/**
 * Social Agency — "รันเลยตอนนี้" creates the image in parallel with the text.
 *
 * A manual run starts the image as soon as the caption is written (it does not
 * wait for the check step), the image prompt is built from that caption, and the
 * run waits for the image before the image-review gate. Scheduled runs are not
 * changed. Existing images are kept. Failures park the run for review.
 *
 * Everything is mocked: no network, no real account, no image backend, no LLM.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const SCENE = "SCENE-FROM-CAPTION-7731 cozy morning kitchen with the product on the counter";
// Two lines: the pipeline may replace the first line with a better hook, so the
// body line is what must survive into the entry and into the image prompt.
const CAPTION = "เช้านี้ทำอาหารกลางวันให้ลูกไปโรงเรียน\nของหนูต้องพกใบเล็กไปด้วยทุกวัน ลองดูนะคะ";
const BODY = "ของหนูต้องพกใบเล็กไปด้วยทุกวัน";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitRun(rt, clientId, runId, timeoutMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const run = rt._read().clients.find((c) => c.id === clientId).workflowRuns.find((r) => r.id === runId);
    if (run && run.status !== "running") return run;
    if (Date.now() - t0 > timeoutMs) throw new Error("workflow run did not finish in time");
    await sleep(50);
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-run-now-image-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientId = rt.getState().activeClientId;
  const getClient = () => rt._read().clients.find((c) => c.id === clientId);
  const getEntry = (id) => getClient().calendar.find((e) => e.id === id);
  const sku = getClient().products[0].sku;

  // Mock the image backend and capture the prompts it receives.
  const requests = [];
  let imageDelayMs = 0;
  let imageFail = false;
  rt._postImageRequest = async (backend, p, body) => {
    requests.push(body);
    await sleep(imageDelayMs);
    if (imageFail) throw new Error("mock backend down");
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG.toString("base64") }] }) };
  };
  rt.setImageSaver(async (dataUrl, meta) => {
    const file = path.join(root, `gen-${requests.length}.png`);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).replace(/^data:[^;]+;base64,/, ""), "base64"));
    return { absPath: file, image: path.basename(file), url: "" };
  });

  // The local LLM is "ready" but only answers the two prompts this suite checks;
  // every other call fails so the template fallbacks are used.
  rt._llmReady = () => true;
  let imagePromptInput = "";
  rt._llmChat = async (messages) => {
    const system = messages[0].content;
    if (system.includes("ONE image-generation prompt")) {
      imagePromptInput = messages[1].content;
      return `${SCENE}, soft daylight`;
    }
    if (system.includes("แอดมินเพจ")) return CAPTION;
    throw new Error("mock llm: not used in this check");
  };
  rt._aiCheck = async () => ({ score: 95, issues: [] });

  // One date per entry: the calendar refuses two posts in the same slot.
  let slot = 0;
  const mkEntry = (extra = {}) => {
    slot += 1;
    const date = `2026-12-${String(slot).padStart(2, "0")}`;
    const e = rt.createCalendarEntry(clientId, { entry: { date, time: "18:30", platform: "facebook", sku, angle: "ประโยชน์การใช้งาน" } });
    if (extra.image) {
      const st = rt._read();
      const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === e.id);
      ent.image = extra.image;
      rt._write(st);
    }
    return e.id;
  };

  test("รันเลย: ข้อความถูกเขียนก่อน แล้วภาพถูกสร้างจากข้อความนั้น และเสร็จก่อนด่านภาพ", async () => {
    imageDelayMs = 0;
    imageFail = false;
    requests.length = 0;
    const id = mkEntry();
    const { runId } = rt.runWorkflow(clientId, id, { trigger: "manual", withImage: true });
    const run = await waitRun(rt, clientId, runId);
    const entry = getEntry(id);
    assert.ok(entry.caption.includes(BODY), "caption written by the create step");
    assert.ok(imagePromptInput.includes(BODY), "the image prompt model was given the text the AI just wrote");
    assert.ok(entry.imagePrompt && entry.imagePrompt.includes(SCENE), "image prompt built from the caption");
    assert.strictEqual(entry.imageJob.status, "done", "image finished");
    assert.ok(entry.image && entry.image.path, "image attached to the entry");
    assert.strictEqual(requests.length, 1, "one image request for the run");
    assert.ok(JSON.stringify(requests[0]).includes(SCENE), "the backend received the caption-based prompt");
    assert.ok(run.image && run.image.started === true, "run records the image as started");
    // The image still needs a person to look at it before anything can be sent.
    // Dry-run never sends, so it passes without a review. A live send still
    // needs a person to approve this exact image: the gate says so.
    assert.strictEqual(run.status, "success", "dry-run completes without a live send");
    const gateNode = run.nodes.find((n) => n.key === "gate");
    assert.ok(gateNode.output.includes("ภาพสร้างเสร็จแล้ว"), "gate node reports the finished image");
    const live = rt._imageGateInfo(getEntry(id));
    assert.strictEqual(live.required, true, "a Facebook image needs review before a live send");
    assert.strictEqual(live.status, "unreviewed", "the parallel image is not auto-approved");
  });

  test("ภาพเริ่มทำงานขนานกับ AI Check (ไม่รอให้ check จบก่อน)", async () => {
    imageDelayMs = 300;
    imageFail = false;
    const id = mkEntry();
    let statusAtCheck = null;
    const realCheck = rt._aiCheck;
    rt._aiCheck = async (...args) => {
      statusAtCheck = getEntry(id).imageJob?.status || "none";
      return realCheck(...args);
    };
    try {
      const { runId } = rt.runWorkflow(clientId, id, { trigger: "manual", withImage: true });
      await waitRun(rt, clientId, runId);
    } finally {
      rt._aiCheck = realCheck;
    }
    assert.strictEqual(statusAtCheck, "running", "image was already running when the check started");
    assert.strictEqual(getEntry(id).imageJob.status, "done", "image finished before the run ended");
    imageDelayMs = 0;
  });

  test("รันตามเวลาปกติ (schedule) ไม่สร้างภาพ — พฤติกรรมเดิม", async () => {
    imageFail = false;
    requests.length = 0;
    const id = mkEntry();
    const { runId } = rt.runWorkflow(clientId, id, { trigger: "schedule" });
    await waitRun(rt, clientId, runId);
    const entry = getEntry(id);
    assert.strictEqual(requests.length, 0, "no image request on a scheduled run");
    assert.ok(!entry.imageJob, "no image job on a scheduled run");
  });

  test("รันเลย: มีภาพอยู่แล้วก็ใช้ภาพเดิม ไม่สร้างทับ", async () => {
    requests.length = 0;
    const existing = { path: path.join(root, "existing.png"), filename: "existing.png", url: "", createdAt: new Date().toISOString() };
    fs.writeFileSync(existing.path, PNG);
    const id = mkEntry({ image: existing });
    const { runId } = rt.runWorkflow(clientId, id, { trigger: "manual", withImage: true });
    const run = await waitRun(rt, clientId, runId);
    assert.strictEqual(requests.length, 0, "no new image when one exists");
    assert.strictEqual(getEntry(id).image.path, existing.path, "existing image kept");
    assert.ok(run.image && run.image.note.includes("ใช้ภาพเดิม"), "run says the existing image is used");
  });

  test("สร้างภาพไม่สำเร็จ → หยุดที่ด่านตรวจ ไม่ส่งโพสต์ที่ไม่มีภาพ", async () => {
    imageFail = true;
    const id = mkEntry();
    const { runId } = rt.runWorkflow(clientId, id, { trigger: "manual", withImage: true });
    const run = await waitRun(rt, clientId, runId);
    imageFail = false;
    assert.strictEqual(run.status, "needs_review", "run waits for a person");
    assert.strictEqual(run.gate.decision, "image-review");
    assert.ok(run.gate.reason.includes("สร้างภาพไม่สำเร็จ"), "reason says image generation failed");
    assert.notStrictEqual(getEntry(id).status, "published", "nothing published");
  });

  test("ไม่มี LLM → ใช้ template prompt แต่ยังสร้างภาพให้", async () => {
    const savedReady = rt._llmReady;
    rt._llmReady = () => false;
    requests.length = 0;
    try {
      const id = mkEntry();
      const { runId } = rt.runWorkflow(clientId, id, { trigger: "manual", withImage: true });
      await waitRun(rt, clientId, runId);
      const entry = getEntry(id);
      assert.ok(entry.imagePrompt && !entry.imagePrompt.includes(SCENE), "template prompt used");
      assert.strictEqual(entry.imageJob.status, "done", "image still generated");
    } finally {
      rt._llmReady = savedReady;
    }
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
  rt.setImageSaver(null);
  if (!process.exitCode) console.log(`PASS: ${passed} run-now image checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
