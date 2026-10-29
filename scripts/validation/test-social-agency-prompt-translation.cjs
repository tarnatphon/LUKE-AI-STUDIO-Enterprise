#!/usr/bin/env node
"use strict";

/**
 * Social Agency — where the English product name comes from.
 *
 * The image model cannot read Thai, so every prompt needs an English subject, and
 * that subject is the CLIENT's own data: `product.imageSubject`, translated once
 * (by the local LLM, at intake or from the Products tab) and then stored. The
 * prompt builder is a pure function of the client's record: it never calls the
 * LLM, never invents a word, and returns no prompt at all when the product has no
 * English name.
 *
 * This suite owns the translation half (LLM → stored subject); the per-client
 * behaviour of the prompt itself lives in test-social-agency-image-prompt-subject.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-prompt-subject-"));
  try {
    const rt = new SocialAgencyRuntime({ root });
    let calls = 0;
    let response = "camera bag";
    let lastMessages = null;
    let lastOptions = null;
    rt.setLlmClient({
      isReady: () => true,
      chat: async (messages, options) => {
        calls += 1;
        lastMessages = messages;
        lastOptions = options;
        return response;
      },
    });

    // ── the LLM is an intake tool, not a prompt-time dependency ────────────
    const translated = await rt._llmTranslateForPrompt("กระเป๋ากล้อง CAM-009");
    assert.equal(translated, "camera bag", "the Thai name is translated");
    assert.equal(calls, 1);
    assert.equal(lastOptions.temperature, 0.1);
    assert.ok(lastMessages[0].content.includes("Translate Thai product names"));
    assert.ok(lastMessages[1].content.includes(JSON.stringify("กระเป๋ากล้อง CAM-009")));

    assert.equal(await rt._llmTranslateForPrompt("Canvas Tote Bag"), "", "English names are not translated");
    assert.equal(calls, 1, "no LLM call for an English name");

    // ── the stored subject wins, and no LLM call happens while prompting ───
    const camera = { sku: "CAM-009", name: "กระเป๋ากล้อง CAM-009", category: "Camera bags", imageSubject: "camera bag" };
    const prompt = SocialAgencyRuntime._templateImagePrompt(camera, { angle: "เปิดตัวสินค้า", seed: "s1" });
    assert.match(prompt, /Professional product photography of camera bag \(CAM-009\)/);
    assert.match(prompt, /^[\x00-\x7F]*$/, "the prompt stays ASCII-only");
    assert.equal(calls, 1, "building a prompt never calls the LLM");

    // A category is a fallback only: with a subject present it is not used.
    assert.doesNotMatch(prompt, /Camera bags/);
    const noSubject = { sku: "CAM-010", name: "กระเป๋ากล้อง CAM-010", category: "Camera bags" };
    assert.match(
      SocialAgencyRuntime._templateImagePrompt(noSubject, { angle: "เปิดตัวสินค้า", seed: "s2" }),
      /Camera bags \(CAM-010\)/,
      "an English category still answers when the product has no subject",
    );

    // ── a subject that says nothing is not a subject ───────────────────────
    for (const junk of ["product", "Item", "stuff", "  ", "สินค้า"]) {
      assert.equal(SocialAgencyRuntime._isValidImageSubject(junk), false, `rejects ${JSON.stringify(junk)}`);
    }
    for (const good of ["camera bag", "stir-fried basil pork", "butter croissant"]) {
      assert.equal(SocialAgencyRuntime._isValidImageSubject(good), true, `accepts ${JSON.stringify(good)}`);
    }
    assert.equal(SocialAgencyRuntime._cleanImageSubject("  butter   croissant  "), "butter croissant");

    // ── the form's translate button ────────────────────────────────────────
    response = "butter croissant";
    const proposed = await rt.proposeImageSubject({ name: "ครัวซองต์เนย" });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.subject, "butter croissant");

    response = "คำอธิบายภาษาไทยเท่านั้น";
    const unusable = await rt.proposeImageSubject({ name: "เค้กช็อกโกแลต" });
    assert.equal(unusable.ok, false);
    assert.match(unusable.reason, /พิมพ์ชื่อสินค้าภาษาอังกฤษเอง/);

    rt.setLlmClient({ isReady: () => false, chat: async () => { throw new Error("must not be called"); } });
    const offline = await rt.proposeImageSubject({ name: "บราวนี่อัลมอนด์" });
    assert.equal(offline.ok, false);
    assert.match(offline.reason, /LLM ยังไม่พร้อม/);

    // ── batch fill: one button instead of 40 fields, result stored ─────────
    const clientId = rt.createClient({
      name: "ร้านขนมทดสอบ",
      industry: "ร้านเบเกอรี่",
      tone: "เจ้าของแบรนด์",
      firstProduct: "ครัวซองต์เนย",
    }).id;
    rt.addProduct(clientId, { name: "ชีสเค้กนิวยอร์ก" });
    const noLlm = await rt.fillImageSubjects(clientId);
    assert.equal(noLlm.ok, false);
    assert.match(noLlm.reason, /LLM ยังไม่พร้อม/);
    assert.strictEqual(rt._read().clients.find((c) => c.id === clientId).products[0].imageSubject, undefined, "nothing is written while the LLM is off");

    rt.setLlmClient({ isReady: () => true, chat: async (messages) => (messages[1].content.includes("ชีสเค้ก") ? "new york cheesecake" : "butter croissant") });
    const filled = await rt.fillImageSubjects(clientId);
    assert.equal(filled.ok, true);
    assert.equal(filled.filled, 2);
    const stored = rt._read().clients.find((c) => c.id === clientId).products;
    assert.equal(stored[0].imageSubject, "butter croissant");
    assert.equal(stored[0].imageSubjectSource, "llm");
    assert.equal(stored[1].imageSubject, "new york cheesecake");
    assert.ok(stored[0].imageSubjectAt, "the moment it was filled is recorded");
    // The bakery prompt now comes from the bakery's own data.
    const baked = SocialAgencyRuntime._templateImagePrompt(stored[1], { angle: "เมนูใหม่", seed: "b" });
    assert.match(baked, /of new york cheesecake /);
    assert.doesNotMatch(baked, /bag/i, "nothing from another business leaks in");

    // Filling again is a no-op unless forced.
    const again = await rt.fillImageSubjects(clientId);
    assert.equal(again.filled, 0);
    assert.equal(again.total, 0);

    console.log("PASS: product image subject (12 checks)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
