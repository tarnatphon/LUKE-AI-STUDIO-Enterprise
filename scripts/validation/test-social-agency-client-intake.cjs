#!/usr/bin/env node
"use strict";

/**
 * Social Agency — adding a client must be strict about the product.
 *
 * A client is planned entirely from its own first product: the product name goes
 * into every caption, and its English name goes into every image prompt. The form
 * used to accept anything — an empty industry, no product, and the product name
 * "สินค้า" — and the result was a month of posts about nothing plus prompts the
 * image model painted as an empty table.
 *
 * So this suite pins down:
 *   - the pure rules the form and the error line share (whole-word checks, so
 *     "สินค้าทดสอบ A-001" is still a valid name);
 *   - the rendered dialog: five required fields, a disabled create button, and a
 *     line under it naming exactly what is missing;
 *   - the runtime: same rules, the English name stored on the product, and the
 *     public route rejecting what the form rejects;
 *   - the payoff: the calendar built for that client carries the client's own
 *     subject into the image prompt.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const VALID = {
  name: "ครัวคุณหมู",
  industry: "ร้านอาหารตามสั่ง",
  tone: "เจ้าของแบรนด์",
  firstProduct: "ผัดกะเพราหมูสับ",
  imageSubject: "stir-fried basil pork",
  sku: "KHM-001",
};

async function main() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-client-intake-"));
  const lib = await import(pathToFileURL(path.join(frontend, "src", "social-agency", "lib.js")).href);

  // ── 1. the shared rules ────────────────────────────────────────────────
  test("ฟอร์มเปล่า → บอกครบทุกช่องที่ขาด (ไม่ใช่แค่ชื่อลูกค้า)", () => {
    const issues = lib.clientIntakeIssues({});
    assert.deepStrictEqual(issues.map((i) => i.field), ["name", "industry", "firstProduct", "imageSubject", "sku"]);
    assert.match(lib.clientIntakeSummary({}), /ยังสร้างไม่ได้:/);
  });

  test("ครบทุกช่อง → ไม่มีข้อติดขัด", () => {
    assert.deepStrictEqual(lib.clientIntakeIssues(VALID), []);
    assert.strictEqual(lib.clientIntakeSummary(VALID), "");
  });

  test("ชื่อสินค้าเป็นคำกว้างถูกปฏิเสธ แต่ชื่อจริงที่ขึ้นต้นด้วยคำเดียวกันผ่าน", () => {
    for (const vague of ["สินค้า", "ของ", "ของฝาก", "อื่นๆ", "ทดสอบ"]) {
      const issues = lib.clientIntakeIssues({ ...VALID, firstProduct: vague });
      assert.ok(issues.some((i) => i.field === "firstProduct"), `rejects ${vague}`);
    }
    for (const real of ["สินค้าทดสอบ A-001", "ของฝากกล่องไม้สัก", "ผัดกะเพราหมูสับ"]) {
      const issues = lib.clientIntakeIssues({ ...VALID, firstProduct: real });
      assert.ok(!issues.some((i) => i.field === "firstProduct"), `accepts ${real}`);
    }
  });

  test("ชื่ออังกฤษ: ต้องเป็นชื่อจริง ไม่ใช่ product / item / อักษรไทย", () => {
    for (const bad of ["", "product", "Item", "สินค้า"]) {
      assert.ok(lib.clientIntakeIssues({ ...VALID, imageSubject: bad }).some((i) => i.field === "imageSubject"), `rejects ${JSON.stringify(bad)}`);
    }
    assert.strictEqual(lib.cleanEnglishSubject("  stir-fried   basil pork "), "stir-fried basil pork");
    assert.strictEqual(lib.isValidEnglishSubject("butter croissant"), true);
  });

  test("SKU: ตัวอักษร/ตัวเลข/-/_ เท่านั้น และแนะนำค่าให้เมื่อยังไม่กรอก", () => {
    assert.ok(lib.clientIntakeIssues({ ...VALID, sku: "KHM 001!" }).some((i) => i.field === "sku"));
    const sku = lib.suggestSku("ผัดกะเพราหมูสับ");
    assert.match(sku, /^PROD-\d{4}$/, "a Thai-only name still yields a usable SKU");
    const withAscii = lib.suggestSku("Tote Bag ใบใหญ่");
    assert.match(withAscii, /^TOTE-\d{4}$/);
    assert.strictEqual(lib.suggestSku("ของ", ["PROD-1234"]).startsWith("PROD-"), true);
  });

  // ── 2. the dialog as it is actually rendered ───────────────────────────
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-client-intake-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { AddClientModal } from ${JSON.stringify(path.join(frontend, "src", "social-agency", "modals.jsx"))};`,
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
      rollupOptions: { output: { format: "cjs", entryFileNames: "intake.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const { AddClientModal, createElement, renderToStaticMarkup } = require(path.join(work, "out", "intake.cjs"));
  const markup = renderToStaticMarkup(createElement(AddClientModal, { onClose() {}, onCreate: async () => {} }));

  try {
    test("ไดอะล็อก: มีช่องที่จำเป็นครบ และปุ่มสร้างถูกปิดไว้ตั้งแต่แรก", () => {
      assert.match(markup, /เพิ่มลูกค้าใหม่/);
      assert.match(markup, /ชื่อลูกค้า \*/);
      assert.match(markup, /ประเภทธุรกิจ \*/);
      assert.match(markup, /ชื่อสินค้าชิ้นแรก \(ไทย\) \*/);
      assert.match(markup, /ชื่อสินค้าภาษาอังกฤษ \(ใช้ในพรอมป์ภาพ\) \*/);
      assert.match(markup, /รหัสสินค้า \(SKU\) \*/);
      assert.match(markup, /<button class="sa-btn primary" disabled=""/, "create is disabled while fields are missing");
    });

    test("ไดอะล็อก: บอกว่ายังขาดอะไร ใต้ปุ่ม (ไม่ปล่อยให้ปุ่มจางเฉย ๆ)", () => {
      assert.match(markup, /ยังสร้างไม่ได้: กรอกชื่อลูกค้าอย่างน้อย 2 ตัวอักษร/);
      assert.match(markup, /ระบุชื่อสินค้าชิ้นแรก/);
      assert.match(markup, /กรอกชื่อสินค้าภาษาอังกฤษ/);
      assert.match(markup, /ช่องนี้คือสิ่งที่โมเดลภาพจะวาด/, "says what the English field is for");
      // The visible text (HTML tags stripped) must not contain < or >: zsh reads
      // them as redirections when an operator copies a message.
      const visible = markup.replace(/<[^>]+>/g, " ");
      assert.doesNotMatch(visible, /[<>]/, "no < or > in text an operator might copy into zsh");
    });

    test("ไดอะล็อก: มีปุ่มแปลชื่ออังกฤษ และคำแนะนำประเภทธุรกิจ", () => {
      assert.match(markup, /แปลให้/);
      assert.match(markup, /sa-industry-suggestions/);
      assert.match(markup, /ร้านเบเกอรี่/);
    });

    // ── 3. the runtime enforces the same thing ───────────────────────────
    const rt = new SocialAgencyRuntime({ root: rootDir });
    test("runtime: ชื่อลูกค้า/สินค้า/ชื่ออังกฤษ ที่ผิด ถูกปฏิเสธพร้อมข้อความไทย", () => {
      assert.throws(() => rt.createClient({ ...VALID, name: "ก" }), /อย่างน้อย 2 ตัวอักษร/);
      assert.throws(() => rt.createClient({ ...VALID, firstProduct: "สินค้า" }), /คำกว้าง/);
      assert.throws(() => rt.createClient({ ...VALID, firstProduct: "" }), /อย่างน้อย 3 ตัวอักษร/);
      assert.throws(() => rt.createClient({ ...VALID, imageSubject: "product" }), /ต้องเป็นชื่อจริง/);
      assert.throws(
        () => rt.createClient({ ...VALID, requireSubject: true, requireIndustry: true, imageSubject: "" }),
        /กรอกชื่อสินค้าภาษาอังกฤษ/,
      );
      assert.throws(() => rt.createClient({ ...VALID, requireIndustry: true, industry: "" }), /ระบุประเภทธุรกิจ/);
    });

    test("runtime: สร้างลูกค้าแล้วได้สินค้าที่มีชื่ออังกฤษ + SKU ที่กำหนด ไว้ใช้ต่อ", () => {
      const client = rt.createClient(VALID);
      const product = client.products[0];
      assert.strictEqual(product.name, "ผัดกะเพราหมูสับ");
      assert.strictEqual(product.sku, "KHM-001");
      assert.strictEqual(product.category, "ร้านอาหารตามสั่ง", "the industry becomes the first product's category");
      assert.strictEqual(product.imageSubject, "stir-fried basil pork");
      assert.strictEqual(product.imageSubjectSource, "intake");
      assert.ok(product.imageSubjectAt);
      // …and the calendar for that client is built from that product
      const entry = rt.createCalendarEntry(client.id, {
        entry: { date: "2027-07-01", time: "09:00", platform: "linkedin", sku: "KHM-001", angle: "เปิดตัวสินค้า" },
      });
      const prompt = SocialAgencyRuntime._templateImagePrompt(product, { angle: entry.angle, seed: entry.id });
      assert.match(prompt, /of stir-fried basil pork \(KHM-001\)/);
      assert.doesNotMatch(prompt, /\bbag\b/i, "no other business's word appears");
    });

    test("runtime: สินค้าที่เพิ่มทีหลังไม่มีชื่ออังกฤษ → สร้างภาพไม่ได้จนกว่าจะกรอก", async () => {
      const client = rt._read().clients[0];
      rt.addProduct(client.id, { name: "ข้าวผัดปู" });
      const added = rt._read().clients[0].products.find((p) => p.name === "ข้าวผัดปู");
      assert.strictEqual(added.imageSubject, undefined);
      await assert.rejects(
        () => rt._ensureEntryImagePrompt({ products: [added], calendar: [] }, { id: "cal-2", sku: added.sku }),
        /ยังไม่มีชื่ออังกฤษ/,
      );
      rt.updateProduct(client.id, added.sku, { imageSubject: "crab fried rice" });
      const fixed = rt._read().clients[0].products.find((p) => p.sku === added.sku);
      assert.strictEqual(fixed.imageSubject, "crab fried rice");
      assert.match(
        await rt._ensureEntryImagePrompt({ products: [fixed], calendar: [] }, { id: "cal-3", sku: added.sku }),
        /crab fried rice/,
      );
      // and clearing it puts the product back into the "needs a name" state
      rt.updateProduct(client.id, added.sku, { imageSubject: "" });
      assert.strictEqual(rt._read().clients[0].products.find((p) => p.sku === added.sku).imageSubject, undefined);
    });

    test("runtime: ชื่ออังกฤษที่แปลไม่ได้/เป็นคำคว้าง ถูกปฏิเสธตอนเพิ่มสินค้า", () => {
      const client = rt._read().clients[0];
      assert.throws(() => rt.addProduct(client.id, { name: "ชาไทย", imageSubject: "stuff" }), /ต้องเป็นชื่อจริง/);
      assert.throws(() => rt.addProduct(client.id, { name: "ของ" }), /คำกว้าง/);
    });

    test("หน้ารายการโพสต์เตือนก่อนกดสร้างภาพ ไม่ใช่รอให้ job ล้มเหลว", () => {
      const drawer = fs.readFileSync(path.join(root, "app", "frontend", "src", "social-agency", "drawers.jsx"), "utf8");
      assert.match(drawer, /isValidEnglishSubject\(entryProduct\.imageSubject\)/);
      assert.match(drawer, /ยังไม่มีชื่ออังกฤษสำหรับพรอมป์ภาพ/);
      assert.match(drawer, /ระบบจะไม่สร้างภาพให้สินค้านี้/);
      assert.match(drawer, /fill-image-subjects|เติมชื่ออังกฤษให้ทุกรายการ/);
    });

    test("route: POST /clients ใช้กติกาเดียวกับฟอร์ม (เรียก API ตรงก็ข้ามไม่ได้)", () => {
      const source = fs.readFileSync(path.join(root, "scripts", "server", "social-agency-runtime.cjs"), "utf8");
      assert.match(source, /this\.createClient\(\{ \.\.\.body, requireSubject: true, requireIndustry: true \}\)/);
      assert.match(source, /products\/propose-image-subject/);
      assert.match(source, /products\/fill-image-subjects/);
    });

    // Every test above is registered by now (some needed the built dialog).
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
    if (!process.exitCode) console.log(`PASS: ${tests.length} client intake checks`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
