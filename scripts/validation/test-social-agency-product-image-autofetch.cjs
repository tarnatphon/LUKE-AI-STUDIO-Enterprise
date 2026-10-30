#!/usr/bin/env node
"use strict";

/**
 * Social Agency — product photos are fetched without being asked.
 *
 * Pressing "ดึงรูปสินค้าจากเว็บ" once a month was the chore this suite removes:
 * the scheduler sweeps once when a new month starts and tops up daily while
 * anything is still missing. What must stay true:
 *   - a photo the user chose is never replaced (imageSource = "manual");
 *   - one pass opens only a handful of pages per client (shop servers see a
 *     trickle, not the whole catalogue);
 *   - a page that failed is retried after a week, not every twenty minutes;
 *   - the per-month box records what was fetched, and keeps twelve months;
 *   - a product that only now got a photo also gets its English name.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const { SocialAgencyRuntime } = require(path.join(root, "scripts", "server", "social-agency-runtime.cjs"));
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

// A one-pixel PNG: the smallest real image a page can serve.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function startShop(port = 0) {
  const server = http.createServer((req, res) => {
    const url = String(req.url || "");
    if (url.startsWith("/img/")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG);
      return;
    }
    const m = url.match(/^\/product\/([\w-]+)\.html$/);
    if (m) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta property="og:image" content="/img/${m[1]}.jpg"><title>${m[1]}</title></head><body><h1>${m[1]}</h1></body></html>`);
      return;
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><body>not found</body></html>");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function settle(rt, clientId) {
  const job = rt._subjectJobs.get(clientId);
  if (job) await job;
  await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  console.log("Product photo autofetch validation");
  const { server, port } = await startShop();
  const base = `http://127.0.0.1:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-img-fetch-"));
  const rt = new SocialAgencyRuntime({ root: tmp });
  let llmCalls = 0;
  rt.setLlmClient({ isReady: () => true, chat: async () => { llmCalls += 1; return `cooler bag ${llmCalls}`; } });

  const clientId = rt.createClient({
    name: "Thai Modern Bags Co.,Ltd.",
    industry: "กระเป๋า",
    tone: "เจ้าของแบรนด์",
    firstProduct: "กระเป๋าเก็บความเย็น CLB-001",
  }).id;
  // the first product has no photo and no link yet; keep the catalogue small
  rt.updateProduct(clientId, rt._read().clients.find((c) => c.id === clientId).products[0].sku, { imageSubject: "cooler bag" });

  const addWithLink = (sku, extra = {}) => {
    const product = rt.addProduct(clientId, { name: `กระเป๋ารุ่น ${sku}`, sku, sourceUrl: `${base}/product/${sku}.html`, ...extra });
    return product;
  };
  const clientRow = () => rt._read().clients.find((c) => c.id === clientId);
  const productOf = (sku) => clientRow().products.find((p) => p.sku === sku);

  test("สินค้าที่มีลิงก์แต่ยังไม่มีรูป ถูกดึงรูปให้เอง", async () => {
    addWithLink("CLB-101");
    addWithLink("CLB-102");
    const report = await rt._maybeAutoFetchImages({ force: true, clientIds: [clientId] });
    assert.ok(report.fetched >= 2, `fetched ${report.fetched}`);
    for (const sku of ["CLB-101", "CLB-102"]) {
      const product = productOf(sku);
      assert.match(String(product.image || ""), new RegExp(`^/sa-products/${clientId}/${sku}\\.(png|jpg)$`), `${sku} has a local photo`);
      assert.strictEqual(product.imageSource, "web");
      assert.ok(product.imageSourceUrl, "the page it came from is kept");
    }
  });

  test("รูปที่ผู้ใช้เลือกเองไม่ถูกแทนที่ (imageSource = manual)", async () => {
    const kept = rt.addProduct(clientId, {
      name: "กระเป๋ารุ่น CLB-103",
      sku: "CLB-103",
      sourceUrl: `${base}/product/CLB-103.html`,
      image: `${base}/img/manual.jpg`,
    });
    assert.strictEqual(kept.imageSource, "manual");
    await rt._maybeAutoFetchImages({ force: true, clientIds: [clientId] });
    const after = productOf("CLB-103");
    assert.strictEqual(after.image, `${base}/img/manual.jpg`, "the chosen photo survives the sweep");
  });

  test("บันทึกลงช่องของเดือนนี้ (และบอกว่ารอบล่าสุดได้กี่รูป)", async () => {
    const record = clientRow().imageAutofetch;
    const month = `${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7)}`;
    assert.strictEqual(record.lastMonth, month);
    assert.ok(record.lastRunAt);
    assert.ok(record.months[month].fetched >= 2);
    assert.ok(record.months[month].at);
  });

  test("ไม่ยิงซ้ำทันที: รอบถัดไปต้องรออย่างน้อย 20 นาที", async () => {
    const again = await rt._maybeAutoFetchImages({ clientIds: [clientId] });
    assert.strictEqual(again.skipped, "recently-checked");
  });

  test("ขึ้นเดือนใหม่ → ดึงเองโดยไม่ต้องกด", async () => {
    const state = rt._read();
    const client = state.clients.find((c) => c.id === clientId);
    client.imageAutofetch = { ...(client.imageAutofetch || {}), lastMonth: "2000-01" };
    rt._write(state);
    rt._imageFetchSweepAt = 0;
    addWithLink("CLB-104");
    const report = await rt._maybeAutoFetchImages({ clientIds: [clientId] });
    assert.ok(report.fetched >= 1, "the new month triggers a pass");
    assert.match(String(productOf("CLB-104").image || ""), /sa-products/);
  });

  test("จำกัดจำนวนต่อรอบ (ไม่เปิดทั้งแคตตาล็อกในครั้งเดียว)", async () => {
    for (const sku of ["CLB-201", "CLB-202", "CLB-203", "CLB-204"]) addWithLink(sku);
    rt._imageFetchSweepAt = 0;
    const report = await rt._maybeAutoFetchImages({ force: true, perRun: 2, clientIds: [clientId] });
    assert.strictEqual(report.clients[0].checked, 2, "only two pages are opened");
    const fetched = ["CLB-201", "CLB-202", "CLB-203", "CLB-204"].filter((sku) => productOf(sku).image);
    assert.strictEqual(fetched.length, 2);
  });

  test("หน้าที่ล้มเหลว: บอกเหตุผล และรอถึงสัปดาห์ค่อยลองใหม่", async () => {
    rt.addProduct(clientId, { name: "กระเป๋ารุ่น CLB-301", sku: "CLB-301", sourceUrl: `${base}/missing.html` });
    // one pass wide enough to reach this row (the cap is tested separately)
    rt._imageFetchSweepAt = 0;
    await rt._maybeAutoFetchImages({ force: true, perRun: 12, clientIds: [clientId] });
    const product = productOf("CLB-301");
    assert.ok(product.imageFetchTriedAt, "the attempt is stamped");
    assert.ok(product.imageFetchError, "and the reason is kept");
    assert.match(String(product.imageFetchError), /404|HTTP/);
    const pendingNow = SocialAgencyRuntime._imageFetchPending({ products: [product] });
    const pendingAfterWeek = SocialAgencyRuntime._imageFetchPending(
      { products: [{ ...product, imageFetchTriedAt: new Date(Date.now() - 8 * 86400000).toISOString() }] },
    );
    assert.strictEqual(pendingNow.length, 0, "not retried within the week");
    assert.strictEqual(pendingAfterWeek.length, 1, "retried after it");
  });

  test("ช่องรายเดือนเก็บ 12 เดือนล่าสุด และไม่ทับข้อมูลเดือนอื่น", async () => {
    const state = rt._read();
    const client = state.clients.find((c) => c.id === clientId);
    const months = {};
    for (let i = 1; i <= 14; i += 1) months[`2025-${String(i).padStart(2, "0")}`] = { fetched: i, failed: 0, runs: 1, at: "2025-01-01T00:00:00.000Z" };
    client.imageAutofetch = { ...client.imageAutofetch, months };
    rt._write(state);
    addWithLink("CLB-401");
    rt._imageFetchSweepAt = 0;
    await rt._maybeAutoFetchImages({ force: true, perRun: 1, clientIds: [clientId] });
    const kept = Object.keys(clientRow().imageAutofetch.months);
    assert.strictEqual(kept.length, 12, "twelve months, no more");
    assert.ok(kept.includes(`${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7)}`), "the current month is kept");
    assert.ok(!kept.includes("2025-01"), "the oldest months fall off");
  });

  test("รูปใหม่มาพร้อมชื่ออังกฤษ: หลังดึงรูป ระบบแปลชื่อให้ต่อทันที", async () => {
    const sku = "CLB-501";
    rt.addProduct(clientId, { name: "กระเป๋าเป้สะพายหลัง CLB-501", sku, sourceUrl: `${base}/product/${sku}.html` });
    rt._imageFetchSweepAt = 0;
    await rt._maybeAutoFetchImages({ force: true, perRun: 3, clientIds: [clientId] });
    await settle(rt, clientId);
    const product = productOf(sku);
    assert.match(String(product.image || ""), /sa-products/, "photo");
    assert.ok(product.imageSubject, "and an English name");
    assert.strictEqual(product.imageSubjectSource, "llm");
  });

  // ── what the tab shows ──────────────────────────────────────────────────
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-products-photos-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { default as ProductsTab } from ${JSON.stringify(path.join(frontend, "src", "social-agency", "ProductsTab.jsx"))};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));
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
      rollupOptions: { output: { format: "cjs", entryFileNames: "photos.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const built = require(path.join(work, "out", "photos.cjs"));
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const client = {
    id: "c1",
    name: "Thai Modern Bags Co.,Ltd.",
    website: "",
    imageAutofetch: {
      lastMonth: month,
      lastRunAt: new Date().toISOString(),
      lastSaved: 3,
      months: { [month]: { fetched: 3, failed: 1, runs: 2, at: new Date().toISOString() } },
    },
    calendar: [{ id: "cal-1", date: `${month}-05`, time: "09:00", platform: "linkedin", sku: "CLB-001", status: "planned" }],
    products: [
      { sku: "CLB-001", name: "กระเป๋าเก็บความเย็น", imageSubject: "cooler bag", image: "/sa-products/c1/CLB-001.jpg" },
      { sku: "CLB-002", name: "กระเป๋าสะพาย", sourceUrl: "https://example.com/p/2" },
    ],
  };
  const markup = built.renderToStaticMarkup(built.createElement(built.ProductsTab, {
    activeClient: client,
    refreshKey: 0,
    onChanged() {},
    subjectAutofill: { llmReady: true, missing: 1, pending: 0, failed: 0, running: false },
  }));

  try {
    test("แท็บ สินค้า: บอกว่ารูปมาจากระบบ ไม่ใช่ปุ่มเดียว", () => {
      assert.match(markup, /รูปใหม่เดือนนี้/);
      assert.match(markup, /ระบบดึงจากเว็บให้เอง/);
      assert.match(markup, /ดึงรูปอัตโนมัติรอบล่าสุด/);
      assert.match(markup, /ดึงรูปเดี๋ยวนี้/);
    });

    test("ช่องรายเดือนบอกจำนวนรูปที่ดึงได้ในเดือนนั้นด้วย", () => {
      assert.match(markup, /รูปใหม่ 3/);
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
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!process.exitCode) console.log(`PASS: ${tests.length} product photo autofetch checks`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
