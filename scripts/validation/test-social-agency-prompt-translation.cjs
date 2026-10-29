#!/usr/bin/env node
"use strict";

/**
 * Social Agency image prompts should name the product in English, ASCII-only.
 *
 * Two sources, in this order: the fixed Thai dictionary (deterministic, works
 * with the local LLM off) and, only for words the dictionary does not know, the
 * injected local LLM. Whatever happens the prompt must stay ASCII and must keep
 * a usable subject.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-prompt-translation-"));
  try {
    const rt = new SocialAgencyRuntime({ root });
    const product = {
      sku: "CAM-009",
      name: "กระเป๋ากล้อง CAM-009",
      category: "Camera bags",
    };
    let calls = 0;
    let response = "Camera bag CAM-009";
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

    const translated = await rt._llmTranslateForPrompt(product.name);
    assert.equal(translated, "Camera bag", "the Thai name is translated, while the separately appended SKU is removed");
    assert.equal(calls, 1);
    assert.equal(lastOptions.temperature, 0.1);
    assert.ok(lastMessages[0].content.includes("Translate Thai product names"));
    assert.ok(lastMessages[1].content.includes(JSON.stringify(product.name)));

    const client = { products: [product], calendar: [] };
    const entry = { id: "entry-translation-test", sku: product.sku, angle: "เปิดตัวสินค้า" };
    const prompt = await rt._ensureEntryImagePrompt(client, entry);
    assert.equal(entry.imagePrompt, prompt);
    assert.match(prompt, /Professional product photography of Camera bag \(CAM-009\)/);
    assert.doesNotMatch(prompt, /Camera bags/, "the specific name takes precedence over the broad category");
    assert.match(prompt, /^[\x00-\x7F]*$/, "the image prompt remains ASCII-only");
    assert.equal(calls, 1, "the dictionary answered for กระเป๋ากล้อง — no extra LLM round-trip");

    assert.equal(await rt._llmTranslateForPrompt("Canvas Tote Bag"), "", "English product names do not need translation");
    assert.equal(calls, 1, "English names skip the LLM call");

    rt.setLlmClient({ isReady: () => false, chat: async () => { throw new Error("must not be called"); } });
    const dictionary = await rt._buildTemplateImagePrompt(
      { sku: "BAG-004", name: "กระเป๋าผ้า", category: "Canvas bags" },
      { angle: "เปิดตัวสินค้า", seed: "fallback" }
    );
    assert.match(dictionary, /Fabric bag \(BAG-004\)/, "no LLM, no category guess: the Thai dictionary names the product");
    assert.match(dictionary, /^[\x00-\x7F]*$/);

    const categoryFallback = await rt._buildTemplateImagePrompt(
      { sku: "GFT-001", name: "ของที่ระลึก", category: "Canvas bags" },
      { angle: "เปิดตัวสินค้า", seed: "category-fallback" }
    );
    assert.match(categoryFallback, /Canvas bags \(GFT-001\)/, "a word the dictionary does not know still falls back to the English category");
    assert.match(categoryFallback, /^[\x00-\x7F]*$/);

    response = "คำอธิบายภาษาไทยเท่านั้น";
    rt.setLlmClient({ isReady: () => true, chat: async () => response });
    const invalidFallback = await rt._buildTemplateImagePrompt(
      { sku: "GFT-002", name: "ของขวัญ", category: "Cotton bags" },
      { angle: "เปิดตัวสินค้า", seed: "invalid-translation" }
    );
    assert.match(invalidFallback, /Cotton bags \(GFT-002\)/, "an unusable response falls back to the English category");
    assert.match(invalidFallback, /^[\x00-\x7F]*$/);

    console.log("PASS social-agency prompt translation (6 checks)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
