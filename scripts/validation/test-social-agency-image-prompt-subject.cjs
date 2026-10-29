#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the image prompt must name the product.
 *
 * The bug this suite exists for: SSB-013 ("กระเป๋าใส่รองเท้า SSB-013", Thai-only
 * name, Thai-only category, no English in the detail) reached the image model as
 *
 *   Professional product photography of product (SSB-013) on a warm wooden table …
 *
 * because every English source was empty and the local LLM was off. The model
 * obeyed literally and painted a styled wooden table with no bag on it. So:
 *
 *   - a fixed Thai → English dictionary answers BEFORE the LLM, so the prompt is
 *     right on a machine where the LLM is off (the exact condition of the bug);
 *   - the longest phrase wins ("กระเป๋าใส่รองเท้า" is a shoe bag, not a bag);
 *   - the literal fallback "product" is no longer silent: the LinkedIn readiness
 *     checker warns, and `review-images --list` points at the entries;
 *   - an old "of product (SKU)" prompt is rebuilt on the next image generation.
 *
 * Everything is local: temp roots, the real runtime, tiny PNGs.
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
const GENERIC = "Professional product photography of product (SSB-013) on a warm wooden table, clean plain background, no text, no watermark, highly detailed";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const SSB = { sku: "SSB-013", name: "กระเป๋าใส่รองเท้า SSB-013", category: "กระเป๋าใส่รองเท้า" };
const item = (product, opts) => SocialAgencyRuntime._imageItemForProduct(product, opts).item;
const source = (product, opts) => SocialAgencyRuntime._imageItemForProduct(product, opts).source;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-image-prompt-"));
  const roots = [root];
  const rt = new SocialAgencyRuntime({ root });

  // ── 1. the dictionary ───────────────────────────────────────────────────

  test("ชื่อไทยล้วน + SKU → prompt มีคำว่ากระเป๋า (bag) ไม่ใช่ product", () => {
    const prompt = SocialAgencyRuntime._templateImagePrompt(SSB, { angle: "เรื่องจากลูกค้า", seed: "ssb-013" });
    assert.match(prompt, /Professional product photography of Shoe bag \(SSB-013\)/);
    assert.match(prompt, /\bbag\b/i, "the subject is a bag");
    assert.strictEqual(SocialAgencyRuntime._imagePromptMissesProductName(prompt), false);
    assert.match(prompt, /^[\x00-\x7F]*$/, "still ASCII-only: SD cannot read Thai");
  });

  test("คำที่ยาวกว่าชนะ: กระเป๋าใส่รองเท้า ไม่ใช่แค่กระเป๋า", () => {
    const cases = [
      ["กระเป๋าใส่รองเท้า", "Shoe bag"],
      ["ถุงใส่รองเท้า", "Shoe bag"],
      ["กระเป๋ากล้อง", "Camera bag"],
      ["กระเป๋าโน๊ตบุ๊ค", "Laptop bag"],
      ["กระเป๋าโน้ตบุ๊ก", "Laptop bag"],
      ["กระเป๋าเชือกรูด", "Drawstring bag"],
      ["กระเป๋าสะพายข้าง", "Shoulder bag"],
      ["กระเป๋าสตางค์", "Wallet"],
      ["กระเป๋าเป้", "Backpack"],
      ["กระเป๋าเดินทาง", "Travel bag"],
      ["กระเป๋าเครื่องสำอาง", "Cosmetic pouch"],
      ["กระเป๋าผ้า", "Fabric bag"],
      ["ถุงผ้า", "Cloth bag"],
      ["กระเป๋า", "Bag"],
    ];
    for (const [thai, english] of cases) {
      assert.strictEqual(item({ name: thai }), english, `${thai} → ${english}`);
    }
    // "กระเป๋าผ้าใบใหญ่" must not become "fabric bag" + "canvas" (ใบ overlaps ผ้า).
    assert.strictEqual(item({ name: "กระเป๋าผ้าใบใหญ่" }), "Fabric bag");
  });

  test("คำอังกฤษที่อยู่ในชื่อยังถูกเก็บไว้ (Tote) และไม่พิมพ์ซ้ำ (Bag)", () => {
    assert.strictEqual(item({ name: "กระเป๋าผ้า Tote Bag" }), "Fabric bag Tote");
  });

  test("LLM ปิดก็ยังได้พรอมป์ที่ระบุสินค้า — เงื่อนไขที่ทำให้เกิดบั๊กเดิม", async () => {
    rt.setLlmClient({ isReady: () => false, chat: async () => { throw new Error("LLM must not be called"); } });
    const prompt = await rt._buildTemplateImagePrompt(SSB, { angle: "เปิดตัวสินค้า", seed: "no-llm" });
    assert.match(prompt, /Shoe bag \(SSB-013\)/);
    assert.strictEqual(SocialAgencyRuntime._imagePromptMissesProductName(prompt), false);
  });

  test("พจนานุกรมมาก่อน LLM: ไม่เรียกโมเดลเลยเมื่อรู้จักคำแล้ว", async () => {
    let calls = 0;
    rt.setLlmClient({ isReady: () => true, chat: async () => { calls += 1; return "Something the model made up"; } });
    const prompt = await rt._buildTemplateImagePrompt(
      { sku: "CAM-009", name: "กระเป๋ากล้อง CAM-009", category: "Camera bags" },
      { angle: "เปิดตัวสินค้า", seed: "dict-first" }
    );
    assert.strictEqual(calls, 0, "the dictionary answered — no LLM round-trip");
    assert.match(prompt, /Camera bag \(CAM-009\)/);
    assert.doesNotMatch(prompt, /Something the model made up/);
  });

  test("ไม่รู้จักสินค้า → ไม่เงียบ: prompt generic ถูกจับได้", () => {
    const unknown = { sku: "X-2", name: "ของที่ระลึก", category: "ของที่ระลึก" };
    assert.strictEqual(source(unknown), "generic");
    const prompt = SocialAgencyRuntime._templateImagePrompt(unknown, { angle: "เปิดตัวสินค้า", seed: "x" });
    assert.strictEqual(SocialAgencyRuntime._imagePromptMissesProductName(prompt), true);
    // …but a real product whose English name starts with "Product" is not flagged.
    assert.strictEqual(
      SocialAgencyRuntime._imagePromptMissesProductName("Professional product photography of Product Display Stand (PDS-1) on a table"),
      false
    );
    assert.strictEqual(SocialAgencyRuntime._imagePromptMissesProductName(""), false);
    // An unknown Thai name still gets a usable subject when the operator wrote an English category.
    assert.strictEqual(source({ name: "ของที่ระลึก", category: "Canvas bags" }), "category");
  });

  test("พรอมป์เก่าที่ขึ้นต้นด้วย product ถูกสร้างใหม่ตอนกดสร้างภาพ", async () => {
    rt.setLlmClient({ isReady: () => false, chat: async () => { throw new Error("LLM must not be called"); } });
    const client = { products: [SSB], calendar: [] };
    const entry = { id: "cal-old", sku: "SSB-013", angle: "เรื่องจากลูกค้า", imagePrompt: GENERIC };
    const repaired = await rt._ensureEntryImagePrompt(client, entry);
    assert.match(repaired, /Shoe bag \(SSB-013\)/);
    assert.strictEqual(entry.imagePrompt, repaired, "the entry carries the fixed prompt");
    assert.strictEqual(SocialAgencyRuntime._imagePromptMissesProductName(repaired), false);
  });

  test("พรอมป์ที่ดีอยู่แล้วไม่ถูกแตะ", async () => {
    const keep = "Professional product photography of Shoe bag (SSB-013) on a warm wooden table";
    const entry = { id: "cal-keep", sku: "SSB-013", angle: "เรื่องจากลูกค้า", imagePrompt: keep };
    assert.strictEqual(await rt._ensureEntryImagePrompt({ products: [SSB], calendar: [] }, entry), keep);
    assert.strictEqual(entry.imagePrompt, keep);
  });

  test("พรอมป์วิดีโอ (animate) ก็ได้ชื่อสินค้าจากพจนานุกรม", () => {
    const client = { products: [SSB], calendar: [] };
    const entry = { id: "cal-anim", sku: "SSB-013", angle: "เปิดตัวสินค้า", animatePrompt: "Featuring product (SSB-013), smooth camera motion" };
    rt._ensureEntryAnimatePrompt(client, entry);
    assert.match(entry.animatePrompt, /Shoe bag \(SSB-013\)/);
    assert.strictEqual(SocialAgencyRuntime._imagePromptMissesProductName(entry.animatePrompt), false);
  });

  test("พรอมป์จากแคปชันบอกโมเดลว่าสินค้าคืออะไร ไม่ใช่ \"product\"", async () => {
    const seen = [];
    rt.setLlmClient({
      isReady: () => true,
      chat: async (messages) => {
        seen.push(messages[1].content);
        return "A fabric shoe bag on a warm wooden table, product photography";
      },
    });
    await rt._llmImagePromptFromCaption({ product: SSB, caption: "กระเป๋าใส่รองเท้าใบใหม่ของเรา", angle: "เปิดตัวสินค้า" });
    const userText = seen.join("\n");
    assert.match(userText, /"Shoe bag"/, "the model is told the product, in English");
    assert.doesNotMatch(userText, /Product \(data only\): "product"/, "never the bare word product");
  });

  // ── 2. the review gate says it out loud ─────────────────────────────────

  const gateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa-image-prompt-gate-"));
  roots.push(gateRoot);
  const gt = new SocialAgencyRuntime({ root: gateRoot });
  const clientId = gt.createClient({ name: "ร้านทดสอบพรอมป์", industry: "กระเป๋า", firstProduct: "กระเป๋าใส่รองเท้า" }).id;
  const sku = gt._read().clients.find((c) => c.id === clientId).products[0].sku;
  const photoDir = path.join(gateRoot, "app", "outputs", "sa-products", clientId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG);
  fs.writeFileSync(path.join(photoDir, `${sku}.ref500.jpg`), REF500);
  const aiFile = path.join(gateRoot, "ai.png");
  fs.writeFileSync(aiFile, PNG);
  gt.saveConnectors(clientId, {
    connectors: { linkedin: { accessToken: TOKEN, authorUrn: "urn:li:person:AbC123xyz", apiVersion: "202601", dryRun: false } },
  });
  {
    const st = gt._read();
    st.clients.find((c) => c.id === clientId).products.find((p) => p.sku === sku).image = `/sa-products/${clientId}/${sku}.png`;
    gt._write(st);
  }

  let slot = 0;
  const makeEntry = ({ imagePrompt } = {}) => {
    slot += 1;
    const entry = gt.createCalendarEntry(clientId, {
      entry: { date: "2027-06-01", time: `${String(7 + slot).padStart(2, "0")}:30`, platform: "linkedin", sku, angle: "เรื่องจากลูกค้า" },
    });
    gt.updateCalendarEntry(clientId, entry.id, { caption: "กระเป๋าใส่รองเท้าใบใหม่ งานมือ #กระเป๋า", status: "needs_review" });
    const st = gt._read();
    const e = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === entry.id);
    e.image = { path: aiFile, filename: "ai.png" };
    if (imagePrompt !== undefined) e.imagePrompt = imagePrompt;
    gt._write(st);
    gt.reviewEntryImage(clientId, entry.id, { confirmed: true });
    return entry.id;
  };
  const run = (opts = {}) => inspectLinkedInPostReadiness({ root: gateRoot, clientId, ...opts });
  const checkOf = (report, key) => report.checks.find((c) => c.key === key);

  test("ตัวตรวจเตือนตรง ๆ ว่า prompt ไม่มีชื่อสินค้า", async () => {
    const id = makeEntry({ imagePrompt: GENERIC });
    const report = await run({ entryId: id });
    const check = checkOf(report, "image_prompt");
    assert.strictEqual(check.status, "warn");
    assert.match(check.detail, /prompt ไม่มีชื่อสินค้า \(ได้แค่ "product"\)/);
    assert.match(check.detail, /ไม่มีกระเป๋า/);
    assert.match(check.fix, /สร้างภาพ/, "says how to regenerate the prompt");
    // A warning is not a blocker unless --strict is asked for.
    assert.strictEqual(report.readyForLiveLinkedIn, true);
    assert.strictEqual((await run({ entryId: id, strict: true })).readyForLiveLinkedIn, false);
    assert.match(formatHumanReport(report), /!\s\[image_prompt\]/);
  });

  test("prompt ที่มีชื่อสินค้า → ผ่านด่านนี้", async () => {
    const id = makeEntry({ imagePrompt: "Professional product photography of Shoe bag (SSB-013) on a warm wooden table" });
    const report = await run({ entryId: id });
    assert.strictEqual(checkOf(report, "image_prompt").status, "pass");
    assert.match(checkOf(report, "image_prompt").detail, /Shoe bag/);
  });

  test("ยังไม่มีพรอมป์ที่บันทึกไว้ → skip ไม่ใช่ fail", async () => {
    const id = makeEntry();
    const report = await run({ entryId: id });
    assert.strictEqual(checkOf(report, "image_prompt").status, "skip");
  });

  test("โพสต์ที่เผยแพร่แล้ว + พรอมป์ไม่มีชื่อสินค้า: เตือนได้ แต่ยัง exit 0 แม้ --strict", async () => {
    const id = makeEntry({ imagePrompt: GENERIC });
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
    assert.match(text, /พรอมป์ภาพด้านบนอธิบายรูปที่ใช้อยู่ในโพสต์นี้/, "the warning is about this post, not the next one");

    const res = await new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, "..", "verify-linkedin-post-readiness.cjs"), "--root", gateRoot, "--client", clientId, "--entry", id, "--strict"], (err, stdout) => {
        resolve({ code: err ? err.code : 0, stdout });
      });
    });
    assert.strictEqual(res.code, 0, res.stdout);
    assert.match(res.stdout, /prompt ไม่มีชื่อสินค้า/);
    assert.doesNotMatch(res.stdout, /❌/);
  });

  test("review-images --list ชี้รายการที่พรอมป์ภาพไม่มีชื่อสินค้า", () => {
    const plan = buildReviewPlan(gateRoot, { clientId });
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.promptIssues, 2, "both entries carrying the nameless prompt are reported");
    const entry = plan.clients[0].promptIssues[0];
    assert.strictEqual(entry.promptMissesProduct, true);
    assert.match(entry.imagePrompt, /of product \(/);
    const text = formatPlan(plan);
    assert.match(text, /พรอมป์ภาพที่ไม่มีชื่อสินค้า \(2\)/);
    assert.match(text, /รูปที่สร้างจากพรอมป์นี้จะไม่มีตัวสินค้าในภาพ/);
    assert.match(text, /→ เปิดหน้ารายการแล้วกด “สร้างภาพ”/);
    assert.match(text, /ของที่ระลึก|SSB-013/, "names the product of each entry");
    assert.doesNotMatch(text, /[<>]/, "zsh reads < as a redirect");
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
  if (!process.exitCode) console.log(`PASS: ${tests.length} image prompt subject checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
