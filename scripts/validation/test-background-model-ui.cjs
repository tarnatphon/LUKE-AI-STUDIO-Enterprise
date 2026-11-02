#!/usr/bin/env node
"use strict";

/**
 * "No small model is downloaded" must be visible where the work happens.
 *
 * The routing (translation → the smallest local model) is worthless if nobody
 * can tell it is not running. On the user's Mac the only GGUF is a 9B, so every
 * name still goes through a 5 GB chat model the governor keeps taking away —
 * and the tab said nothing about it.
 *
 * What this suite pins:
 *   - the Products tab says, in the row where names are missing, that no small
 *     model exists and where to get one;
 *   - when one does exist, the tab names it instead (proof it is being used);
 *   - the Performance panel's card covers all three states — chosen, missing,
 *     switched off — and never shows a blank form.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const CLIENT = {
  id: "c1",
  name: "Thai Modern Bags Co.,Ltd.",
  products: [
    { sku: "CLB-001", name: "กระเป๋าเก็บความเย็น", imageSubject: "cooler bag", image: "/sa-products/c1/CLB-001.jpg" },
    { sku: "CLB-002", name: "กระเป๋าสะพายผ้าใบ", sourceUrl: "https://example.com/p/2" },
    { sku: "CLB-003", name: "กระเป๋าเดินทางขนาด cabin" },
  ],
};

const MISSING = {
  llmReady: false,
  missing: 2,
  pending: 0,
  failed: 0,
  running: false,
  backgroundModel: {
    enabled: true,
    maxSizeGb: 3.2,
    preferredModel: null,
    model: null,
    reason: "no model between 0.2 and 3.2 GB is downloaded — the chat model is used",
    mainReady: false,
  },
};

const CHOSEN = {
  ...MISSING,
  llmReady: true,
  backgroundModel: {
    enabled: true,
    maxSizeGb: 3.2,
    preferredModel: null,
    model: { filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf", sizeGb: 0.8 },
    reason: "Llama-3.2-1B-Instruct-Q4_K_M.gguf is the smallest downloaded model that fits the 3.2 GB background cap (0.8 GB)",
    mainReady: true,
  },
};

async function main() {
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "background-model-ui-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(
    entryFile,
    [
      `export { default as ProductsTab } from ${JSON.stringify(
        path.join(frontend, "src", "social-agency", "ProductsTab.jsx"),
      )};`,
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
      rollupOptions: { output: { format: "cjs", entryFileNames: "bg.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const built = require(path.join(work, "out", "bg.cjs"));

  const renderTab = (autofill) =>
    built.renderToStaticMarkup(
      built.createElement(built.ProductsTab, {
        activeClient: CLIENT,
        refreshKey: 0,
        onChanged() {},
        subjectAutofill: autofill,
      }),
    );

  try {
    test("ยังไม่มีโมเดลเล็ก: แท็บ สินค้า บอกตรง ๆ ว่าต้องโหลดที่ไหน", () => {
      const markup = renderTab(MISSING);
      assert.match(markup, /ยังไม่มีโมเดลเล็กระดับ 2–3 GB/);
      assert.match(markup, /Settings → Text Models/);
      assert.match(markup, /ใช้โมเดลแชท/, "it says what is doing the work instead");
      assert.doesNotMatch(markup, /แปลด้วย Llama/, "no model name is claimed when there is none");
    });

    test("มีโมเดลเล็กแล้ว: แท็บบอกชื่อและขนาดว่าเป็นตัวที่ใช้แปล", () => {
      const markup = renderTab(CHOSEN);
      assert.match(markup, /แปลด้วย Llama-3\.2-1B-Instruct-Q4_K_M\.gguf/);
      assert.match(markup, /0\.8 GB/);
      assert.match(markup, /ไม่ต้องใช้โมเดลแชท/);
      assert.doesNotMatch(markup, /ยังไม่มีโมเดลเล็กระดับ/, "the warning disappears");
    });

    test("ไม่มีชื่อขาดอยู่ = ไม่ต้องรบกวนด้วยเรื่องโมเดล", () => {
      const allNamed = {
        ...MISSING,
        missing: 0,
        backgroundModel: MISSING.backgroundModel,
      };
      const markup = built.renderToStaticMarkup(
        built.createElement(built.ProductsTab, {
          activeClient: { ...CLIENT, products: [CLIENT.products[0]] },
          refreshKey: 0,
          onChanged() {},
          subjectAutofill: allNamed,
        }),
      );
      assert.doesNotMatch(markup, /ยังไม่มีโมเดลเล็กระดับ/);
    });

    // ── the Performance card ──────────────────────────────────────────────
    const renderCard = (data) =>
      built.renderToStaticMarkup(built.createElement(built.BackgroundModelCard, { data, note: "" }));

    test("การ์ดในหน้า Performance: เลือกโมเดลแล้วบอกชื่อและเหตุผล", () => {
      const markup = renderCard({
        enabled: true,
        maxSizeGb: 3.2,
        preferredModel: null,
        model: { filename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf", sizeGb: 1.9 },
        reason: "the smallest downloaded model",
        mainReady: true,
      });
      assert.match(markup, /Background model \(product names\)/);
      assert.match(markup, /Qwen2\.5-3B-Instruct-Q4_K_M\.gguf/);
      assert.match(markup, /1\.9 GB/);
    });

    test("การ์ดในหน้า Performance: ไม่มีโมเดลเล็ก บอกเพดานและทางแก้", () => {
      const markup = renderCard(MISSING.backgroundModel);
      assert.match(markup, /No small model is downloaded yet/);
      assert.match(markup, /3\.2 GB or less/);
      assert.match(markup, /Settings →\s*Text Models/);
      assert.match(markup, /not loaded right now/, "it says the chat model is not even loaded");
    });

    test("การ์ดในหน้า Performance: ปิดไว้ / ยังอ่านอยู่ ก็ยังอธิบายได้", () => {
      const off = renderCard({ ...MISSING.backgroundModel, enabled: false });
      assert.match(off, /Switched off/);
      assert.match(off, /background-model\.json/);

      const empty = renderCard(null);
      assert.match(empty, /Reading the model folder/);
      assert.match(empty, /Background model \(product names\)/);
    });

    test("หน้า Performance ดึงสถานะจาก route เดียวกัน", () => {
      const panel = fs.readFileSync(
        path.join(frontend, "src", "components", "PerformancePanel.jsx"),
        "utf8",
      );
      assert.match(panel, /fetch\("\/api\/background-model"\)/);
      assert.match(panel, /<BackgroundModelCard[\s\S]{0,120}?data=\{backgroundModel\}/);
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
  if (!process.exitCode) console.log(`PASS: ${tests.length} background model UI checks`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
