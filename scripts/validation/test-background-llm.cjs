#!/usr/bin/env node
"use strict";

/**
 * Background chores (product-name translation) get the small model.
 *
 * Translating forty Thai product names into English labels is about eighty
 * tokens of dictionary work per product. It used to go through whatever chat
 * model was loaded — on an 18 GB Mac that meant loading a 9B model (5 GB) next
 * to SDXL (6.6 GB), swapping, and the resource governor taking the chat model
 * away before a single name was translated.
 *
 * What must stay true:
 *   - the smallest downloaded model under the cap is the one chosen;
 *   - the chat model is still what answers a conversation, and only a request
 *     that asks for translation is routed away from it;
 *   - if the small model cannot run, the chat model answers instead;
 *   - one load serves every translation, not one per product.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const background = require(path.join(root, "scripts", "server", "background-llm.cjs"));
const runtimeSource = fs.readFileSync(path.join(root, "scripts", "server", "social-agency-runtime.cjs"), "utf8");
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const GIB = 1024 ** 3;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const MODELS = [
  { filename: "Qwen3.8-9B-heretic-uncensored.Q4_K_S.gguf", sizeBytes: 5 * GIB },
  { filename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf", sizeBytes: 1.9 * GIB },
  { filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf", sizeBytes: 0.8 * GIB },
  { filename: "mmproj-vision-f16.gguf", sizeBytes: 0.6 * GIB },
];

function silentLogger() {
  const lines = [];
  return {
    lines,
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message),
    error: (message) => lines.push(message),
  };
}

/** A pool that records what it was asked to load and answers with content. */
function fakePool({ failLoad = false, content = "cooler bag" } = {}) {
  const calls = { ensureLoaded: [], generate: [] };
  return {
    calls,
    ensureLoaded: async (ids) => {
      calls.ensureLoaded.push([...ids]);
      if (failLoad) {
        return { instances: [], failures: [{ modelId: ids[0], error: "not enough memory" }] };
      }
      return {
        instances: [{ modelId: ids[0], status: "ready", port: 28200 }],
        failures: [],
      };
    },
    generate: async ({ modelId, messages, options }) => {
      calls.generate.push({ modelId, messages, options });
      return { content };
    },
  };
}

async function main() {
  // ── choosing ────────────────────────────────────────────────────────────
  test("เลือกโมเดลเล็กสุดที่โหลดไว้ ไม่ใช่ตัวใหญ่ที่ผู้ใช้แชทอยู่", () => {
    const picked = background.chooseBackgroundModel(MODELS, { maxSizeGb: 3.2 });
    assert.ok(picked.model, "a model was chosen");
    assert.strictEqual(picked.model.filename, "Llama-3.2-1B-Instruct-Q4_K_M.gguf");
    assert.strictEqual(picked.model.sizeGb, 0.8);
    assert.match(picked.reason, /smallest downloaded model/);
  });

  test("ไม่เลือก mmproj และไม่เลือกตัวที่ใหญ่เกินเพดาน", () => {
    const picked = background.chooseBackgroundModel(MODELS, { maxSizeGb: 3.2 });
    const names = picked.candidates.map((model) => model.filename);
    assert.ok(!names.some((name) => /mmproj/i.test(name)), "mmproj is a projector, not a model");
    assert.ok(picked.model.sizeGb <= 3.2);
  });

  test("เพดานต่ำลงจนไม่มีอะไร fit = ไม่เลือกอะไรเลย และบอกเหตุผล", () => {
    const picked = background.chooseBackgroundModel(MODELS, { maxSizeGb: 0.5 });
    assert.strictEqual(picked.model, null);
    assert.match(picked.reason, /no model between/);
  });

  test("โมเดลที่ผู้ใช้เลือกเองชนะ เพียงถ้ามีไฟล์นั้นจริง", () => {
    const chosen = background.chooseBackgroundModel(MODELS, {
      preferredModel: "Qwen3.8-9B-heretic-uncensored.Q4_K_S.gguf",
    });
    assert.strictEqual(chosen.model.filename, "Qwen3.8-9B-heretic-uncensored.Q4_K_S.gguf");
    assert.match(chosen.reason, /preferred background model/);

    const missing = background.chooseBackgroundModel(MODELS, { preferredModel: "not-downloaded.gguf" });
    assert.strictEqual(missing.model.filename, "Llama-3.2-1B-Instruct-Q4_K_M.gguf", "falls back to the smallest");
  });

  test("ปิดไว้ = ไม่มีโมเดลพื้นหลัง ใช้โมเดลแชทเหมือนเดิม", () => {
    const picked = background.chooseBackgroundModel(MODELS, { enabled: false });
    assert.strictEqual(picked.model, null);
    assert.match(picked.reason, /switched off/);
  });

  // ── routing ─────────────────────────────────────────────────────────────
  test("งานแปลใช้โมเดลเล็ก และไม่ได้แตะโมเดลแชทเลย", async () => {
    const pool = fakePool({ content: "cooler bag" });
    let mainCalls = 0;
    const client = background.createBackgroundLlmClient({
      policy: { maxSizeGb: 3.2 },
      listModels: () => MODELS,
      getPool: () => pool,
      mainClient: { isReady: () => true, chat: async () => { mainCalls += 1; return "chat answer"; } },
      logger: silentLogger(),
    });
    const content = await client.chat(
      [{ role: "user", content: "Product name: กระเป๋าเก็บความเย็น" }],
      { purpose: "translate", maxTokens: 80 },
    );
    assert.strictEqual(content, "cooler bag");
    assert.strictEqual(mainCalls, 0, "the chat model was never asked");
    assert.deepStrictEqual(pool.calls.ensureLoaded, [["Llama-3.2-1B-Instruct-Q4_K_M.gguf"]]);
    assert.strictEqual(pool.calls.generate[0].modelId, "Llama-3.2-1B-Instruct-Q4_K_M.gguf");
  });

  test("บทสนทนายังเป็นของโมเดลแชท (ไม่ถูกเปลี่ยนไปใช้ตัวเล็ก)", async () => {
    const pool = fakePool();
    const client = background.createBackgroundLlmClient({
      policy: { maxSizeGb: 3.2 },
      listModels: () => MODELS,
      getPool: () => pool,
      mainClient: { isReady: () => true, chat: async () => "chat answer" },
      logger: silentLogger(),
    });
    const content = await client.chat([{ role: "user", content: "สวัสดี" }], { maxTokens: 200 });
    assert.strictEqual(content, "chat answer");
    assert.strictEqual(pool.calls.generate.length, 0, "the pool was never used");
  });

  test("โมเดลเล็กโหลดไม่ได้ = โมเดลแชทตอบแทน พร้อม log ครั้งเดียว", async () => {
    const logger = silentLogger();
    const client = background.createBackgroundLlmClient({
      policy: { maxSizeGb: 3.2 },
      listModels: () => MODELS,
      getPool: () => fakePool({ failLoad: true }),
      mainClient: { isReady: () => true, chat: async () => "chat answer" },
      logger,
    });
    const content = await client.chat([{ role: "user", content: "x" }], { purpose: "translate" });
    assert.strictEqual(content, "chat answer");
    assert.strictEqual(logger.lines.filter((line) => /could not run the translation/.test(line)).length, 1);
  });

  test("ไม่มีอะไรใช้ได้เลย = โยน error ไม่ใช่คืนค่าว่างเงียบ ๆ", async () => {
    const client = background.createBackgroundLlmClient({
      policy: { maxSizeGb: 3.2 },
      listModels: () => MODELS,
      getPool: () => fakePool({ failLoad: true }),
      mainClient: { isReady: () => false, chat: async () => "should not be called" },
      logger: silentLogger(),
    });
    await assert.rejects(() => client.chat([{ role: "user", content: "x" }], { purpose: "translate" }), /not enough memory/);
  });

  test("โหลดครั้งเดียวใช้ได้ทุกคำ: สี่สิบสินค้าไม่ได้โหลดสี่สิบรอบ", async () => {
    const pool = fakePool();
    const client = background.createBackgroundLlmClient({
      policy: { maxSizeGb: 3.2 },
      listModels: () => MODELS,
      getPool: () => pool,
      mainClient: { isReady: () => false, chat: async () => "" },
      logger: silentLogger(),
    });
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        client.chat([{ role: "user", content: `Product name: สินค้า ${index}` }], { purpose: "translate" })
      ),
    );
    assert.strictEqual(pool.calls.ensureLoaded.length, 1, "one load, six translations");
    assert.strictEqual(pool.calls.generate.length, 6);
  });

  test("มีโมเดลเล็กอยู่ = งานแปลเริ่มได้แม้โมเดลแชทยังไม่โหลด", async () => {
    const client = background.createBackgroundLlmClient({
      policy: { maxSizeGb: 3.2 },
      listModels: () => MODELS,
      getPool: () => fakePool(),
      mainClient: { isReady: () => false, chat: async () => "" },
      logger: silentLogger(),
    });
    assert.strictEqual(client.isReady(), true);
    assert.strictEqual(client.status().model.filename, "Llama-3.2-1B-Instruct-Q4_K_M.gguf");
    assert.strictEqual(client.status().mainReady, false);

    const empty = background.createBackgroundLlmClient({
      policy: { maxSizeGb: 0.1 },
      listModels: () => MODELS,
      getPool: () => fakePool(),
      mainClient: { isReady: () => false, chat: async () => "" },
      logger: silentLogger(),
    });
    assert.strictEqual(empty.isReady(), false, "nothing small, nothing loaded: not ready");
  });

  // ── the wiring ──────────────────────────────────────────────────────────
  test("งานแปลชื่อส่ง purpose: \"translate\" เพื่อให้เปลี่ยนเส้นทางได้", () => {
    assert.match(runtimeSource, /purpose: "translate"/);
  });

  test("serve.cjs ต่อ client ผ่าน background-llm และมี route ให้ดูว่าตัวไหนถูกเลือก", () => {
    assert.match(serveSource, /backgroundLlm\.createBackgroundLlmClient\(/);
    assert.match(serveSource, /app", "config", "social-agency", "background-model\.json"/);
    assert.match(serveSource, /req\.url === "\/api\/background-model" && req\.method === "GET"/);
  });

  test("config ที่มากับแอปเปิดไว้ และเพดานยังเล็กกว่าโมเดลแชท", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(root, "app", "config", "social-agency", "background-model.json"), "utf8"),
    );
    assert.strictEqual(config.enabled, true);
    assert.ok(config.maxSizeGb > 0 && config.maxSizeGb <= 4, `cap ${config.maxSizeGb} GB`);
  });

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok - ${name}`);
    } catch (err) {
      console.error(`  FAIL - ${name}\n${err.stack || err}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`PASS: ${tests.length} background model checks`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
