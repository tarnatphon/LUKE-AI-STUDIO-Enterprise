#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the image prompt belongs to the client, not to a business type.
 *
 * The bug this suite grew out of: SSB-013 ("กระเป๋าใส่รองเท้า SSB-013") reached the
 * image model as "Professional product photography of product (SSB-013) …" because
 * every English source was empty and the local LLM was off. The model obeyed and
 * painted a warm wooden table with nothing on it.
 *
 * The first fix — a Thai→English dictionary in the runtime — was wrong in a deeper
 * way: it hard-coded one industry ("bag") into a product used by every client. So
 * the subject now comes from the client's own product record (`imageSubject`,
 * translated once at intake and stored), and:
 *
 *   - a bakery, a yoga studio and a bag factory each get their own subject, and
 *     nothing from another business appears in the prompt;
 *   - there is no dictionary and no "product" fallback: without a subject the
 *     prompt is empty and generation stops with a message naming the product;
 *   - the readiness checker and `review-images --list` say which product needs it.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const { inspectLinkedInPostReadiness, formatHumanReport } = require("../verify-linkedin-post-readiness.cjs");
const { buildReviewPlan, formatPlan } = require("../social-agency-review-images.cjs");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const REF500 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const TOKEN = "li-member-token-abcdef1234567890";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Three clients, three businesses, three subjects — none of them hard-coded.
const BAKERY = { sku: "BAK-001", name: "ครัวซองต์เนยสด", category: "เบเกอรี่", imageSubject: "butter croissant" };
const YOGA = { sku: "YOG-001", name: "คลาสโยคะพื้นฐาน", category: "คลาสเรียน", imageSubject: "yoga mat in a bright studio" };
const BAGS = { sku: "SSB-013", name: "กระเป๋าใส่รองเท้า SSB-013", category: "กระเป๋าใส่รองเท้า", imageSubject: "shoe bag" };
const UNNAMED = { sku: "XYZ-001", name: "ของที่ระลึกงานบุญ", category: "ของที่ระลึก" };

const promptFor = (product, angle = "เปิดตัวสินค้า") =>
  SocialAgencyRuntime._templateImagePrompt(product, { angle, seed: "seed" });

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-image-prompt-"));
  const roots = [root];
  const rt = new SocialAgencyRuntime({ root });

  // ── 1. the subject is the client's own product data ────────────────────

  test("สินค้าของลูกค้าแต่ละราย → พรอมป์ใช้ชื่อของสินค้ารายนั้น", () => {
    assert.match(promptFor(BAKERY), /Professional product photography of butter croissant \(BAK-001\)/);
    assert.match(promptFor(YOGA), /of yoga mat in a bright studio \(YOG-001\)/);
    assert.match(promptFor(BAGS), /of shoe bag \(SSB-013\)/);
  });

  test("ไม่มีคำของธุรกิจอื่นหลุดเข้าไปในพรอมป์ของลูกค้ารายนั้น", () => {
    const bakery = promptFor(BAKERY, "เรื่องจากลูกค้า");
    assert.doesNotMatch(bakery, /\bbags?\b/i, "a bakery prompt never mentions bags");
    assert.doesNotMatch(bakery, /shoe|drawstring|wallet/i);
    const yoga = promptFor(YOGA);
    assert.doesNotMatch(yoga, /\bbags?\b/i);
    assert.match(yoga, /yoga mat/);
    // and the other direction: no bakery word in the bag prompt
    assert.doesNotMatch(promptFor(BAGS), /croissant|bread|cake/i);
  });

  test("ไม่มีพจนานุกรมกลางเหลืออยู่แล้ว — ระบบไม่เดาคำให้สินค้าที่ไม่มีชื่ออังกฤษ", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "server", "social-agency-runtime.cjs"), "utf8");
    assert.ok(!/THAI_PRODUCT_GLOSSARY/.test(source), "the per-industry dictionary is gone from the runtime");
    const missing = SocialAgencyRuntime._imageItemForProduct(UNNAMED);
    assert.strictEqual(missing.item, "");
    assert.strictEqual(missing.source, "missing");
  });

  test("สินค้าที่ไม่มีชื่ออังกฤษ → ไม่มีพรอมป์ (ไม่ใช่พรอมป์ที่มีคำว่า product)", () => {
    assert.strictEqual(promptFor(UNNAMED), "", "no prompt is better than a prompt that names nothing");
    const animate = require("../server/social-agency-runtime.cjs").SocialAgencyRuntime;
    assert.ok(animate, "module loaded");
  });

  test("ข้อความแจ้งบอกชื่อสินค้าและที่กรอก พร้อมรหัสจริง", () => {
    const message = SocialAgencyRuntime._imageSubjectError(UNNAMED);
    assert.match(message, /ของที่ระลึกงานบุญ · XYZ-001/);
    assert.match(message, /แท็บ สินค้า/);
    assert.match(message, /ชื่อสินค้าภาษาอังกฤษ/);
    assert.doesNotMatch(message, /[<>]/, "zsh reads < as a redirect");
  });

  test("สร้างภาพไม่ได้เลยถ้าสินค้ายังไม่มีชื่ออังกฤษ — หยุดพร้อมบอก ไม่สร้างเงียบ ๆ", async () => {
    const client = { products: [UNNAMED], calendar: [] };
    const entry = { id: "cal-unnamed", sku: "XYZ-001", angle: "เปิดตัวสินค้า" };
    await assert.rejects(() => rt._ensureEntryImagePrompt(client, entry), /ยังไม่มีชื่ออังกฤษสำหรับพรอมป์ภาพ/);
    assert.strictEqual(entry.imagePrompt, undefined, "nothing is written onto the entry");
    // the same product with a subject builds immediately
    const named = { ...UNNAMED, imageSubject: "souvenir keychain" };
    const fixed = await rt._ensureEntryImagePrompt({ products: [named], calendar: [] }, { id: "cal-named", sku: "XYZ-001" });
    assert.match(fixed, /of souvenir keychain \(XYZ-001\)/);
  });

  test("พรอมป์เก่าที่ขึ้นต้นด้วย product ถูกสร้างใหม่จากชื่ออังกฤษของสินค้า", async () => {
    const entry = { id: "cal-old", sku: "SSB-013", angle: "เรื่องจากลูกค้า", imagePrompt: "Professional product photography of product (SSB-013) on a warm wooden table" };
    const repaired = await rt._ensureEntryImagePrompt({ products: [BAGS], calendar: [] }, entry);
    assert.match(repaired, /of shoe bag \(SSB-013\)/);
  });

  test("พรอมป์ที่ดีอยู่แล้วไม่ถูกแตะ และการสร้างวิดีโอใช้ชื่อเดียวกัน", async () => {
    const keep = "Professional product photography of butter croissant (BAK-001) on a wooden table";
    const entry = { id: "cal-keep", sku: "BAK-001", imagePrompt: keep };
    assert.strictEqual(await rt._ensureEntryImagePrompt({ products: [BAKERY], calendar: [] }, entry), keep);

    const video = { id: "cal-video", sku: "YOG-001" };
    rt._ensureEntryAnimatePrompt({ products: [YOGA], calendar: [] }, video);
    assert.match(video.animatePrompt, /yoga mat in a bright studio/);

    const unnamedVideo = { id: "cal-video-2", sku: "XYZ-001" };
    rt._ensureEntryAnimatePrompt({ products: [UNNAMED], calendar: [] }, unnamedVideo);
    assert.strictEqual(unnamedVideo.animatePrompt, undefined, "no video prompt without a subject either");
  });

  test("พรอมป์จากแคปชันบอกโมเดลว่าเป็นสินค้าตัวไหน", async () => {
    const seen = [];
    rt.setLlmClient({
      isReady: () => true,
      chat: async (messages) => {
        seen.push(messages[1].content);
        return "A butter croissant on a plate, product photography";
      },
    });
    await rt._llmImagePromptFromCaption({ product: BAKERY, caption: "ครัวซองต์เนยหอม ๆ เพิ่งอบเสร็จ", angle: "เปิดตัวสินค้า" });
    assert.match(seen.join("\n"), /"butter croissant"/);
    assert.doesNotMatch(seen.join("\n"), /bag/i);
  });

  // ── 2. the gates say it out loud ───────────────────────────────────────

  const gateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa-image-prompt-gate-"));
  roots.push(gateRoot);
  const gt = new SocialAgencyRuntime({ root: gateRoot });
  const clientId = gt.createClient({
    name: "ร้านเบเกอรี่ทดสอบ",
    industry: "ร้านเบเกอรี่",
    firstProduct: "ครัวซองต์เนยสด",
    imageSubject: "butter croissant",
    sku: "BAK-001",
  }).id;
  const photoDir = path.join(gateRoot, "app", "outputs", "sa-products", clientId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, "BAK-001.png"), PNG);
  fs.writeFileSync(path.join(photoDir, "BAK-001.ref500.jpg"), REF500);
  const aiFile = path.join(gateRoot, "ai.png");
  fs.writeFileSync(aiFile, PNG);
  gt.saveConnectors(clientId, {
    connectors: { linkedin: { accessToken: TOKEN, authorUrn: "urn:li:person:AbC123xyz", apiVersion: "202601", dryRun: false } },
  });
  {
    const st = gt._read();
    const c = st.clients.find((x) => x.id === clientId);
    c.products[0].image = `/sa-products/${clientId}/BAK-001.png`;
    gt._write(st);
  }

  let slot = 0;
  const makeEntry = ({ imagePrompt, dropSubject = false } = {}) => {
    slot += 1;
    const entry = gt.createCalendarEntry(clientId, {
      entry: { date: "2027-06-01", time: `${String(7 + slot).padStart(2, "0")}:30`, platform: "linkedin", sku: "BAK-001", angle: "เมนูใหม่" },
    });
    gt.updateCalendarEntry(clientId, entry.id, { caption: "ครัวซองต์เนยสดอบใหม่ #เบเกอรี่", status: "needs_review" });
    const st = gt._read();
    const e = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === entry.id);
    e.image = { path: aiFile, filename: "ai.png" };
    if (imagePrompt !== undefined) e.imagePrompt = imagePrompt;
    if (dropSubject) {
      const p = st.clients.find((c) => c.id === clientId).products[0];
      delete p.imageSubject;
    }
    gt._write(st);
    gt.reviewEntryImage(clientId, entry.id, { confirmed: true });
    return entry.id;
  };
  const run = (opts = {}) => inspectLinkedInPostReadiness({ root: gateRoot, clientId, ...opts });
  const checkOf = (report, key) => report.checks.find((c) => c.key === key);

  test("ตัวตรวจ: พรอมป์ที่มีชื่อสินค้าของลูกค้ารายนี้ = ผ่าน", async () => {
    const id = makeEntry({ imagePrompt: "Professional product photography of butter croissant (BAK-001)" });
    const report = await run({ entryId: id });
    assert.strictEqual(checkOf(report, "image_prompt").status, "pass");
    assert.match(checkOf(report, "image_prompt").detail, /butter croissant/);
  });

  test("ตัวตรวจ: สินค้ายังไม่มีชื่ออังกฤษ → เตือนพร้อมชื่อสินค้าและรหัส", async () => {
    const id = makeEntry({ dropSubject: true });
    const report = await run({ entryId: id });
    const check = checkOf(report, "image_prompt");
    assert.strictEqual(check.status, "warn");
    assert.match(check.detail, /ครัวซองต์เนยสด · BAK-001/);
    assert.match(check.detail, /ยังไม่มีชื่ออังกฤษสำหรับพรอมป์ภาพ/);
    assert.match(check.fix, /แท็บ สินค้า/);
    assert.doesNotMatch(check.fix, /[<>]/);
    assert.strictEqual(report.readyForLiveLinkedIn, true, "a warning is not a blocker");
    assert.strictEqual((await run({ entryId: id, strict: true })).readyForLiveLinkedIn, false, "…but --strict treats it as one");
    assert.match(formatHumanReport(report), /!\s\[image_prompt\]/);
  });

  test("ตัวตรวจ: พรอมป์เก่าที่ไม่ได้ระบุสินค้า → เตือนอธิบายรูปที่ใช้อยู่", async () => {
    const id = makeEntry({ imagePrompt: "Professional product photography of product (BAK-001) on a table" });
    const report = await run({ entryId: id });
    const check = checkOf(report, "image_prompt");
    assert.strictEqual(check.status, "warn");
    assert.match(check.detail, /ไม่ได้ระบุชื่อสินค้า/);
    assert.match(formatHumanReport(report), /!\s\[image_prompt\]/);
  });

  test("โพสต์ที่เผยแพร่แล้ว + พรอมป์ไม่มีชื่อสินค้า: เตือนได้ แต่ exit 0 แม้ --strict", async () => {
    const id = makeEntry({ imagePrompt: "Professional product photography of product (BAK-001) on a table" });
    const st = gt._read();
    const e = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id);
    e.status = "published";
    e.postId = "urn:li:ugcPost:7521421999051751424";
    e.publishedAt = "2026-10-29T04:00:29.204Z";
    gt._write(st);

    const report = await run({ entryId: id, strict: true });
    assert.strictEqual(report.published, true);
    assert.strictEqual(checkOf(report, "image_prompt").status, "warn");
    const text = formatHumanReport(report);
    assert.match(text, /✅ โพสต์นี้เผยแพร่บน LinkedIn แล้ว/);
    assert.match(text, /พรอมป์ภาพด้านบนอธิบายรูปที่ใช้อยู่ในโพสต์นี้/);

    const res = await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, "..", "verify-linkedin-post-readiness.cjs"), "--root", gateRoot, "--client", clientId, "--entry", id, "--strict"], (err, stdout) => {
        resolve({ code: err ? err.code : 0, stdout });
      });
    });
    assert.strictEqual(res.code, 0, res.stdout);
    assert.doesNotMatch(res.stdout, /❌/);
  });

  test("review-images --list ชี้รายการที่พรอมป์ภาพไม่มีชื่อสินค้า", () => {
    const plan = buildReviewPlan(gateRoot, { clientId });
    assert.strictEqual(plan.ok, true);
    assert.ok(plan.promptIssues >= 1, "the nameless prompt is listed");
    const entry = plan.clients[0].promptIssues[0];
    assert.strictEqual(entry.promptMissesProduct, true);
    const text = formatPlan(plan);
    assert.match(text, /พรอมป์ภาพที่ไม่มีชื่อสินค้า/);
    assert.match(text, /→ เปิดหน้ารายการแล้วกด “สร้างภาพ”/);
    assert.doesNotMatch(text, /[<>]/);
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
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
  if (!process.exitCode) console.log(`PASS: ${tests.length} per-client image prompt checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
