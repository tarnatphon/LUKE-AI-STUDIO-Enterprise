#!/usr/bin/env node
"use strict";

/**
 * "No small model" ends with a download button, not with homework.
 *
 * Telling somebody their translations are falling back to a 5 GB chat model and
 * leaving them to find a GGUF is half an answer. The app ships a signed catalog
 * and a download queue already, so the panel offers the exact model that fits
 * the cap — and picks it with the same rule it uses at run time.
 *
 * What this suite pins:
 *   - the smallest catalog model inside the cap wins, not the first one listed;
 *   - a model already on disk is never suggested again;
 *   - a variant this machine cannot run (too much minimum RAM) is not offered;
 *   - nothing fits → no suggestion, and a reason instead of a dead button;
 *   - the button queues exactly the model it names, on the existing queue;
 *   - the card renders the button only when there is something to download.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const suggestionModule = require(path.join(root, "scripts", "server", "background-model-suggestion.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const panelSource = fs.readFileSync(
  path.join(root, "app", "frontend", "src", "components", "PerformancePanel.jsx"),
  "utf8",
);
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const GIB = 1024 ** 3;

const CATALOG = {
  schemaVersion: 1,
  models: [
    {
      id: "qwen3-4b",
      name: { en: "Qwen3 4B", th: "Qwen3 4B" },
      variants: [
        { id: "q4-k-m", filename: "Qwen3-4B-Q4_K_M.gguf", sizeBytes: 2.5 * GIB, minimumRamBytes: 8 * GIB },
        { id: "q8-0", filename: "Qwen3-4B-Q8_0.gguf", sizeBytes: 4.6 * GIB, minimumRamBytes: 16 * GIB },
      ],
    },
    {
      id: "dolphin3-llama3.2-3b",
      name: { en: "Dolphin 3.0 Llama 3.2 3B", th: "Dolphin 3.0 Llama 3.2 3B" },
      variants: [
        { id: "q4-k-m", filename: "Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf", sizeBytes: 2.02 * GIB, minimumRamBytes: 8 * GIB },
      ],
    },
    {
      id: "huge-70b",
      name: { en: "A 70B model", th: "โมเดล 70B" },
      variants: [
        { id: "q4-k-m", filename: "Huge-70B-Q4_K_M.gguf", sizeBytes: 40 * GIB, minimumRamBytes: 64 * GIB },
      ],
    },
  ],
};

async function main() {
  // ── choosing what to offer ──────────────────────────────────────────────
  test("เสนอตัวเล็กสุดในแคตตาล็อกที่ยังไม่โหลดและอยู่ในเพดาน", () => {
    const { suggestion, candidates } = suggestionModule.chooseSuggestion({
      catalog: CATALOG,
      installed: [],
      maxSizeGb: 3.2,
      totalRamGb: 18,
    });
    assert.strictEqual(suggestion.filename, "Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf");
    assert.strictEqual(suggestion.modelId, "dolphin3-llama3.2-3b");
    assert.strictEqual(suggestion.variantId, "q4-k-m");
    assert.strictEqual(suggestion.sizeGb, 2.02);
    assert.ok(!candidates.some((entry) => entry.sizeGb > 3.2), "nothing above the cap is offered");
  });

  test("โมเดลที่โหลดอยู่แล้วไม่ถูกเสนอซ้ำ — ไปเอาตัวถัดไป", () => {
    const { suggestion } = suggestionModule.chooseSuggestion({
      catalog: CATALOG,
      installed: ["Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf"],
      maxSizeGb: 3.2,
      totalRamGb: 18,
    });
    assert.strictEqual(suggestion.filename, "Qwen3-4B-Q4_K_M.gguf");
  });

  test("ชื่อไฟล์ที่ส่งมาเป็น path ก็ยังรู้ว่าโหลดแล้ว", () => {
    const { suggestion } = suggestionModule.chooseSuggestion({
      catalog: CATALOG,
      installed: ["/Users/ekky/ai/app/llm-models/dolphin3.0-llama3.2-3b-q4_k_m.gguf"],
      maxSizeGb: 3.2,
      totalRamGb: 18,
    });
    assert.strictEqual(suggestion.filename, "Qwen3-4B-Q4_K_M.gguf");
  });

  test("เครื่อง RAM น้อย: ไม่เสนอตัวที่รันไม่ได้", () => {
    const tight = suggestionModule.chooseSuggestion({
      catalog: CATALOG,
      installed: [],
      maxSizeGb: 3.2,
      totalRamGb: 6,
    });
    assert.strictEqual(tight.suggestion, null);
    assert.match(tight.reason, /can run on this machine/);
  });

  test("ไม่มีอะไรให้เสนอ = ไม่มีปุ่มลอย ๆ แต่มีเหตุผล", () => {
    const none = suggestionModule.chooseSuggestion({
      catalog: CATALOG,
      installed: ["Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf", "Qwen3-4B-Q4_K_M.gguf"],
      maxSizeGb: 3.2,
      totalRamGb: 18,
    });
    assert.strictEqual(none.suggestion, null);
    assert.match(none.reason, /no model between 0\.2 and 3\.2 GB/);

    const noCatalog = suggestionModule.chooseSuggestion({ catalog: null, installed: [], maxSizeGb: 3.2 });
    assert.strictEqual(noCatalog.suggestion, null);
  });

  test("variant ที่ไม่ใช่ .gguf หรือไม่มีขนาด ถูกข้าม", () => {
    const { suggestion } = suggestionModule.chooseSuggestion({
      catalog: {
        models: [
          { id: "broken", name: { en: "Broken" }, variants: [
            { id: "v1", filename: "notes.txt", sizeBytes: 1 * GIB },
            { id: "v2", filename: "NoSize.gguf", sizeBytes: 0 },
          ] },
          { id: "ok", name: { en: "Fine" }, variants: [{ id: "q4", filename: "Fine-Q4.gguf", sizeBytes: 1.5 * GIB }] },
        ],
      },
      installed: [],
      maxSizeGb: 3.2,
    });
    assert.strictEqual(suggestion.filename, "Fine-Q4.gguf");
  });

  // ── the route ───────────────────────────────────────────────────────────
  test("route /api/background-model แนบข้อเสนอที่เลือกจากแคตตาล็อกจริง", () => {
    assert.match(serveSource, /backgroundModelSuggestion\.chooseSuggestion\(\{/);
    assert.match(serveSource, /catalog: readTextModelCatalog\(\)/);
    assert.match(serveSource, /installed: getLlmModels\(\)\.map\(\(model\) => model\.filename\)/);
    assert.match(serveSource, /result: \{ \.\.\.status, suggestion, suggestionReason \}/);
  });

  test("แคตตาล็อกจริงมีโมเดลที่อยู่ในเพดาน 3.2 GB ให้เสนอได้", () => {
    const real = JSON.parse(fs.readFileSync(path.join(root, "app", "config", "text-models", "signed-catalog.json"), "utf8"));
    const { suggestion } = suggestionModule.chooseSuggestion({
      catalog: real,
      installed: [],
      maxSizeGb: 3.2,
      totalRamGb: 18,
    });
    assert.ok(suggestion, "the shipped catalog offers a small model");
    assert.ok(suggestion.sizeGb <= 3.2, `${suggestion.sizeGb} GB`);
    assert.match(suggestion.filename, /\.gguf$/i);
  });

  test("หน้า Performance สั่งดาวน์โหลดผ่านคิวเดิม ไม่ได้ประดิษฐ์ทางใหม่", () => {
    assert.match(panelSource, /fetch\("\/api\/text-models\/download-queue"/);
    assert.match(panelSource, /JSON\.stringify\(\{ modelId: suggestion\.modelId, variantId: suggestion\.variantId \}\)/);
    assert.match(panelSource, /onDownload=\{downloadBackgroundModel\}/);
  });

  // ── what the card shows ─────────────────────────────────────────────────
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "background-download-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(
    entryFile,
    [
      `export { default as BackgroundModelCard } from ${JSON.stringify(
        path.join(frontend, "src", "components", "BackgroundModelCard.jsx"),
      )};`,
      'export { createElement } from "react";',
      'export { renderToStaticMarkup } from "react-dom/server";',
    ].join("\n"),
  );
  await vite.build({
    root: frontend,
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    build: {
      ssr: entryFile,
      outDir: path.join(work, "out"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "bg-download.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const built = require(path.join(work, "out", "bg-download.cjs"));

  const { suggestion } = suggestionModule.chooseSuggestion({
    catalog: CATALOG,
    installed: [],
    maxSizeGb: 3.2,
    totalRamGb: 18,
  });

  try {
    test("การ์ดมีปุ่มดาวน์โหลด พร้อมชื่อและขนาดที่แน่นอน", () => {
      const markup = built.renderToStaticMarkup(
        built.createElement(built.BackgroundModelCard, {
          data: {
            enabled: true,
            maxSizeGb: 3.2,
            model: null,
            mainReady: false,
            reason: "no model between 0.2 and 3.2 GB is downloaded — the chat model is used",
            suggestion,
            suggestionReason: "Dolphin 3.0 Llama 3.2 3B Q4_K_M (2.02 GB) is the smallest catalog model inside the 3.2 GB background cap",
          },
          onDownload: () => {},
        }),
      );
      assert.match(markup, /data-testid="background-model-download"/);
      assert.match(markup, /Download Dolphin 3\.0 Llama 3\.2 3B \(2\.02 GB\)/);
      assert.match(markup, /smallest catalog model inside the 3\.2 GB background cap/);
    });

    test("ไม่มีอะไรให้เสนอ = ไม่มีปุ่ม แต่ยังบอกเหตุผล", () => {
      const markup = built.renderToStaticMarkup(
        built.createElement(built.BackgroundModelCard, {
          data: {
            enabled: true,
            maxSizeGb: 3.2,
            model: null,
            mainReady: false,
            reason: "no model between 0.2 and 3.2 GB is downloaded — the chat model is used",
            suggestion: null,
            suggestionReason: "the catalog has no model between 0.2 and 3.2 GB that is not already downloaded",
          },
          onDownload: () => {},
        }),
      );
      assert.doesNotMatch(markup, /data-testid="background-model-download"/);
      assert.match(markup, /the catalog has no model between 0\.2 and 3\.2 GB/);
    });

    test("มีโมเดลอยู่แล้ว = ไม่มีปุ่มดาวน์โหลดรบกวน", () => {
      const markup = built.renderToStaticMarkup(
        built.createElement(built.BackgroundModelCard, {
          data: {
            enabled: true,
            maxSizeGb: 3.2,
            model: { filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf", sizeGb: 0.8 },
            reason: "the smallest downloaded model",
            mainReady: true,
            suggestion,
          },
          onDownload: () => {},
        }),
      );
      assert.doesNotMatch(markup, /data-testid="background-model-download"/);
      assert.match(markup, /Llama-3\.2-1B-Instruct-Q4_K_M\.gguf/);
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

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
  if (!process.exitCode) console.log(`PASS: ${tests.length} background model download checks`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
