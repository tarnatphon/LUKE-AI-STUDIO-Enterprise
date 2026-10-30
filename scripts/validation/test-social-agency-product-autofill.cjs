#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the Products tab does the chores itself.
 *
 * Two complaints drove this suite:
 *   1. "ยังไม่มีชื่อภาษาอังกฤษ" sat there until someone pressed "แปลให้" on every
 *      row, and a product without an English name cannot be illustrated at all.
 *   2. 20+ products on one page meant a long list with five repair buttons in
 *      the header and no way to find anything.
 *
 * What this suite pins:
 *   - a product added without an English name gets one in the background (the
 *     request that added it does not wait for the local model);
 *   - a name the user typed, or deliberately cleared, is never overwritten;
 *   - renaming a product re-translates (the old name's translation is stale);
 *   - model off → nothing spins forever, the row keeps its warning, no crash;
 *   - one product that cannot be translated does not stop the others;
 *   - the tab shows the work: stats, search, folded repair tools, per-month
 *     record of which products ran.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const { SocialAgencyRuntime } = require(path.join(root, "scripts", "server", "social-agency-runtime.cjs"));

const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A local model that answers in one line, like the real llama-server does.
function fakeLlm({ failOn = "แปลไม่ได้", calls = { n: 0 } } = {}) {
  return {
    calls,
    isReady: () => true,
    chat: async (messages) => {
      const prompt = String(messages?.[1]?.content || "");
      calls.n += 1;
      if (prompt.includes(failOn)) return "ไม่ใช่ภาษาอังกฤษ";
      return `cooler bag ${calls.n}`;
    },
  };
}

async function settle(rt, clientId) {
  // The backfill runs off the request path; wait for the job it queued.
  const job = rt._subjectJobs.get(clientId);
  if (job) await job;
  await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  console.log("Products tab autofill validation");

  // ── 1. English names arrive without pressing anything ────────────────────
  const rootDir = tempRoot("sa-autofill-");
  const rt = new SocialAgencyRuntime({ root: rootDir });
  const llm = fakeLlm();
  rt.setLlmClient(llm);
  const clientId = rt.createClient({
    name: "Thai Modern Bags Co.,Ltd.",
    industry: "กระเป๋า",
    tone: "เจ้าของแบรนด์",
    firstProduct: "กระเป๋าเก็บความเย็น CLB-008",
  }).id;
  const clientRow = () => rt._read().clients.find((c) => c.id === clientId);
  const productOf = (sku) => (clientRow().products || []).find((p) => p.sku === sku);

  test("สินค้าที่เพิ่มโดยไม่มีชื่ออังกฤษ ได้ชื่อเองเบื้องหลัง (ไม่ต้องกด)", async () => {
    const added = rt.addProduct(clientId, { name: "กระเป๋าสะพายข้าง CLB-009" });
    assert.strictEqual(added.imageSubject, undefined, "the response is not blocked by the model");
    await settle(rt, clientId);
    const product = productOf(added.sku);
    assert.match(String(product.imageSubject || ""), /cooler bag \d+/);
    assert.strictEqual(product.imageSubjectSource, "llm");
    assert.ok(product.imageSubjectAt);
    assert.ok(!product.imageSubjectPending, "the row stops saying กำลังแปล");
    assert.ok(!product.imageSubjectError);
  });

  test("การนำเข้าหลายรายการ: แปลให้ทุกแถวที่ยังไม่มีชื่อ", async () => {
    const imported = rt.importProducts(clientId, {
      products: [{ name: "กระเป๋าเดินทาง CLB-010" }, { name: "กระเป๋าสตางค์ CLB-011" }],
    });
    assert.strictEqual(imported.count, 2);
    await settle(rt, clientId);
    for (const sku of imported.added) {
      assert.ok(productOf(sku).imageSubject, `${sku} got a name`);
    }
  });

  test("ชื่อที่ผู้ใช้พิมพ์เอง (manual) ไม่ถูกทับด้วยของอัตโนมัติ", async () => {
    const product = rt.addProduct(clientId, { name: "กระเป๋าผ้า CLB-012", imageSubject: "canvas tote bag" });
    assert.strictEqual(product.imageSubjectSource, "manual");
    await settle(rt, clientId);
    assert.strictEqual(productOf(product.sku).imageSubject, "canvas tote bag");
  });

  test("ลบชื่อออกเอง = ตัดสินใจแล้ว ระบบไม่อัตโนมัติเติมกลับ", async () => {
    const sku = clientRow().products.find((p) => p.imageSubject).sku;
    rt.updateProduct(clientId, sku, { imageSubject: "" });
    const cleared = productOf(sku);
    assert.strictEqual(cleared.imageSubject, undefined);
    assert.strictEqual(cleared.imageSubjectAutofillSkipped, true, "the decision is remembered");
    rt.fillMissingSubjects(clientId).catch(() => {});
    await settle(rt, clientId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(productOf(sku).imageSubject, undefined, "it must not come back by itself");
    // …but the explicit button retries it
    const forced = await rt.fillImageSubjects(clientId, { force: true });
    assert.ok(forced.filled >= 1);
    assert.ok(productOf(sku).imageSubject, "an explicit request does fill it");
  });

  test("เปลี่ยนชื่อสินค้า → ชื่ออังกฤษที่แปลไว้เดิมถูกแปลใหม่ (ไม่ค้างของเก่า)", async () => {
    const product = rt.addProduct(clientId, { name: "กระเป๋าเป้ CLB-013" });
    await settle(rt, clientId);
    const before = productOf(product.sku).imageSubject;
    assert.ok(before);
    rt.updateProduct(clientId, product.sku, { name: "กระเป๋าเป้สะพายหลัง CLB-013" });
    const midway = productOf(product.sku);
    assert.strictEqual(midway.imageSubject, undefined, "the stale translation is dropped");
    await settle(rt, clientId);
    assert.ok(productOf(product.sku).imageSubject, "and a fresh one arrives");
  });

  test("แปลไม่ได้ → บอกเหตุผลบนแถวนั้น ไม่ค้าง และไม่หยุดรายการอื่น", async () => {
    const bad = rt.addProduct(clientId, { name: "สินค้าแปลไม่ได้ CLB-014" });
    const good = rt.addProduct(clientId, { name: "กระเป๋าใส่แก้ว CLB-015" });
    await settle(rt, clientId);
    const badRow = productOf(bad.sku);
    assert.strictEqual(badRow.imageSubject, undefined);
    assert.match(String(badRow.imageSubjectError || ""), /พิมพ์ชื่ออังกฤษเอง/);
    assert.ok(!badRow.imageSubjectPending, "no endless spinner");
    assert.ok(productOf(good.sku).imageSubject, "the next row is still translated");
  });

  test("สถานะที่ UI ใช้ตัดสินใจ: missing / pending / llmReady", async () => {
    const status = rt.subjectAutofillStatus();
    assert.strictEqual(status.llmReady, true);
    assert.ok(status.missing >= 1, "one product is still without a name");
    const state = rt.getState();
    assert.ok(state.subjectAutofill, "getState exposes it");
    assert.strictEqual(state.subjectAutofill.llmReady, true);
  });

  // ── 2. the same state when the local model is off ────────────────────────
  const offRoot = tempRoot("sa-autofill-off-");
  const offRt = new SocialAgencyRuntime({ root: offRoot });
  test("โมเดลปิดอยู่: ไม่มี pending ค้าง ไม่ thrown และบอกว่าพร้อมเมื่อไรจะแปลให้", async () => {
    const id = offRt.createClient({ name: "ร้านไม่มีโมเดล", industry: "ของใช้", tone: "เจ้าของแบรนด์", firstProduct: "แก้วเซรามิก A-1" }).id;
    const added = offRt.addProduct(id, { name: "จานเซรามิก A-2" });
    assert.ok(!added.imageSubjectPending, "nothing claims to be translating");
    const result = await offRt.fillMissingSubjects(id);
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /LLM ยังไม่พร้อม/);
    assert.strictEqual(offRt.subjectAutofillStatus().llmReady, false);
    assert.strictEqual(offRt._read().clients.find((c) => c.id === id).products.find((p) => p.sku === added.sku).imageSubject, undefined);
  });

  // ── 3. the tab as it is written ──────────────────────────────────────────
  const tabSource = fs.readFileSync(path.join(frontend, "src", "social-agency", "ProductsTab.jsx"), "utf8");
  test("แท็บ สินค้า: ค้นหาได้ + ยุบเครื่องมือซ่อม + บอกสถานะชื่ออังกฤษ", () => {
    assert.match(tabSource, /sa-prod-search/, "a search box for 20+ products");
    assert.match(tabSource, /useState\(""\)/, "…with its own state");
    assert.match(tabSource, /<details className="sa-repair-tools">/, "the repair buttons are folded away");
    assert.match(tabSource, /กำลังแปล…/);
    assert.match(tabSource, /imageSubjectPending/);
    assert.match(tabSource, /subjectAutofill/);
  });

  test("แท็บ สินค้า: มีช่องข้อมูลรายเดือนว่าสินค้าไหนถูกใช้ไปแล้ว", () => {
    assert.match(tabSource, /สินค้าที่ใช้ในแต่ละเดือน/);
    assert.match(tabSource, /ยังไม่ใช้:/);
    assert.match(tabSource, /ใช้ครบทุกชิ้นแล้ว/);
  });

  // ── 4. rendered: what the user actually sees ─────────────────────────────
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-products-tab-"));
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
      rollupOptions: { output: { format: "cjs", entryFileNames: "products.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const built = require(path.join(work, "out", "products.cjs"));
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const client = {
    id: "c1",
    name: "Thai Modern Bags Co.,Ltd.",
    website: "",
    calendar: [
      { id: "cal-1", date: `${month}-05`, time: "09:00", platform: "linkedin", sku: "CLB-008", status: "planned" },
      { id: "cal-2", date: `${month}-06`, time: "08:00", platform: "linkedin", sku: "CLB-009", status: "planned" },
    ],
    products: [
      { sku: "CLB-008", name: "กระเป๋าเก็บความเย็น", imageSubject: "cooler bag", image: "/sa-products/c1/CLB-008.jpg" },
      { sku: "CLB-009", name: "กระเป๋าสะพายข้าง", imageSubjectPending: true },
      { sku: "CLB-010", name: "กระเป๋าสตางค์" },
    ],
  };
  const markup = built.renderToStaticMarkup(built.createElement(built.ProductsTab, {
    activeClient: client,
    refreshKey: 0,
    onChanged() {},
    subjectAutofill: { llmReady: true, missing: 2, pending: 1, failed: 0, running: true },
  }));

  try {
    test("เรนเดอร์จริง: แถวที่กำลังแปลขึ้นว่า “กำลังแปล…” ไม่ใช่เตือนให้กดเอง", () => {
      assert.match(markup, /กำลังแปล…/);
      assert.strictEqual((markup.match(/กำลังแปล…/g) || []).length, 1, "only the pending row");
      assert.match(markup, /ไม่ต้องกดอะไร/);
    });

    test("เรนเดอร์จริง: สรุปตัวเลข + ช่องค้นหา + เครื่องมือซ่อมที่ยุบไว้", () => {
      assert.match(markup, /sa-prod-stats/);
      assert.match(markup, /มีชื่ออังกฤษ/);
      assert.match(markup, /ใช้ในปฏิทินเดือนนี้/);
      assert.match(markup, /placeholder="ค้นหาชื่อสินค้า \/ SKU \/ ชื่ออังกฤษ"/);
      assert.match(markup, /เครื่องมือซ่อมข้อมูล/);
      assert.doesNotMatch(markup, /<details class="sa-repair-tools" open/, "folded by default");
    });

    test("เรนเดอร์จริง: ปฏิทินบอกว่าเดือนนี้ใช้สินค้าไปแล้วกี่ชิ้น", () => {
      assert.match(markup, /สินค้าที่ใช้ในแต่ละเดือน/);
      assert.match(markup, /ใช้ 2\/3 สินค้า/, "two of three products ran this month");
      assert.match(markup, /ยังไม่ใช้: CLB-010/);
    });

    test("ชื่ออังกฤษที่พิมพ์เองยังแก้ได้ (ปุ่มเดิมยังอยู่)", () => {
      assert.match(markup, /cooler bag/, "an existing name is shown, not hidden");
      assert.match(markup, /ชื่อสินค้าภาษาอังกฤษ — ใช้สร้างพรอมป์ภาพและพรอมป์วิดีโอ \(แก้ได้ทุกเมื่อ\)/);
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
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.rmSync(offRoot, { recursive: true, force: true });
  if (!process.exitCode) console.log(`PASS: ${tests.length} product autofill checks`);
}

function clientOf(rt, clientId) {
  return rt._read().clients.find((c) => c.id === clientId);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
