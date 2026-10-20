#!/usr/bin/env node
"use strict";

/**
 * Social Agency — per-client contact footer and the Facebook/Instagram product
 * pair (AI image + real product photo).
 *
 * Thai Modern Bags gets its company paragraph and contact lines appended to
 * Facebook and Instagram copy only. Other customers get nothing unless they set
 * their own. The footer is plain text, never duplicated when a composed draft is
 * edited again, and is composed at publish time so the sent text matches the
 * preview. Instagram image posts go out as a two-image carousel, and a missing
 * product photo refuses the post before any network call.
 *
 * Everything is mocked: no network, no real account, no image backend.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const copy = require("../server/social-agency-post-copy.cjs");

const PNG_A = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const REF500_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-500px-jpeg-bytes")]);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const bangkokToday = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-brand-footer-"));
  const realHttps = SocialAgencyRuntime._https;
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const bagsId = "thai-modern-bags";
  const bakery = state.clients.find((c) => c.id !== bagsId);
  const bags = state.clients.find((c) => c.id === bagsId);
  assert.ok(bags && bakery, "seed contains both clients");
  const sku = bags.products[0].sku;
  const bakerySku = bakery.products[0].sku;

  // Local product photo + its 500px derivative, stored the way the app stores them.
  const photoDir = path.join(root, "app", "outputs", "sa-products", bagsId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG_A);
  fs.writeFileSync(path.join(photoDir, `${sku}.ref500.jpg`), REF500_JPEG);
  const setProductImage = (value) => {
    const st = rt._read();
    st.clients.find((c) => c.id === bagsId).products.find((p) => p.sku === sku).image = value;
    rt._write(st);
  };
  setProductImage(`/sa-products/${bagsId}/${sku}.png`);

  rt.saveConnectors(bagsId, { connectors: {
    facebook: { pageId: "1234567890", accessToken: "fake-fb-token", dryRun: false },
    instagram: { igUserId: "1784", accessToken: "fake-ig-token", imgbbApiKey: "fake-imgbb-key", dryRun: false },
  } });

  const getClient = (id = bagsId) => rt._read().clients.find((c) => c.id === id);
  const getEntry = (id, clientId = bagsId) => getClient(clientId).calendar.find((e) => e.id === id);
  const mk = (platform, time, clientId = bagsId, productSku = sku) => {
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(-1), time, platform, sku: productSku, angle: "เปิดตัวสินค้า" } });
    rt.updateCalendarEntry(clientId, e.id, { caption: "ดูสินค้าใหม่ได้ที่ https://shop.example.com/p/wlb-006 ครับ" });
    return e.id;
  };
  const attachImage = (id, clientId = bagsId) => {
    const file = path.join(root, `ai-${id}.png`);
    fs.writeFileSync(file, PNG_A);
    const st = rt._read();
    const ent = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id);
    ent.image = { path: file, filename: path.basename(file), url: `/api/output-file?filename=${path.basename(file)}`, publicUrl: "https://cdn.example.com/ai.png" };
    rt._write(st);
    rt.reviewEntryImage(clientId, id, { confirmed: true });
  };
  const resetClocks = () => {
    const st = rt._read();
    const c = st.clients.find((x) => x.id === bagsId);
    delete c.connectors.facebook.lastPublishAt;
    delete c.connectors.instagram.lastPublishAt;
    rt._write(st);
  };

  let calls = [];
  let fbPhotoCount = 0;
  SocialAgencyRuntime._https = async (opts = {}) => {
    const body = Buffer.isBuffer(opts.body) ? opts.body.toString("latin1") : String(opts.body ?? "");
    calls.push({ method: opts.method, host: opts.host, urlPath: opts.path, body });
    if (opts.host === "api.imgbb.com") return { status: 200, json: { data: { display_url: `https://i.ibb.co/ref-${calls.length}.jpg` } }, text: "{}" };
    if (opts.path && opts.path.includes("/photos")) {
      fbPhotoCount += 1;
      return { status: 200, json: { id: `photo-${fbPhotoCount}` } };
    }
    if (opts.path && opts.path.includes("/feed")) return { status: 200, json: { id: "fb-post-1" } };
    if (opts.path && opts.path.endsWith("/media") && opts.method === "POST") {
      const parsed = JSON.parse(body || "{}");
      return { status: 200, json: { id: parsed.is_carousel_item ? `child-${calls.length}` : `container-${calls.length}` } };
    }
    if (opts.path && opts.path.includes("fields=status_code")) return { status: 200, json: { status_code: "FINISHED" } };
    if (opts.path && opts.path.endsWith("/media_publish")) return { status: 200, json: { id: "ig-post-1" } };
    throw new Error(`unexpected https call ${opts.host}${opts.path}`);
  };

  {
    test("Thai Modern Bags gets the footer on Facebook and Instagram only; other customers get none", () => {
      const footers = rt.getState().clients.find((c) => c.id === bagsId).captionFooters;
      assert.ok(footers.facebook.includes("กว่า 40 ปี ที่ Thai Modern Bags"), "facebook footer seeded");
      assert.ok(footers.instagram.includes("กว่า 40 ปี ที่ Thai Modern Bags"), "instagram footer seeded");
      assert.ok(footers.facebook.includes("0-2466-3312, 02-465-3355"));
      assert.ok(footers.facebook.includes("097-469-4656, 095-226-4565"));
      assert.ok(footers.facebook.includes("@thaimodernbags"));
      assert.ok(footers.facebook.includes("ekkaphon@thaimodernbags.com"));
      // Facebook cannot carry a website link in a post, so only the bare domain is written.
      assert.ok(footers.facebook.includes("🌐 WEBSITE: thaimodernbags.com"), "facebook uses the bare domain");
      assert.ok(!footers.facebook.includes("https://"), "facebook has no URL scheme");
      assert.ok(footers.instagram.includes("🌐 WEBSITE: https://www.thaimodernbags.com"), "instagram keeps the full URL");
      assert.strictEqual(footers.line, "", "LINE does not get the long block by default");
      assert.strictEqual(footers.tiktok, "");
      assert.strictEqual(footers.demo, "");
      const other = rt.getState().clients.find((c) => c.id !== bagsId).captionFooters;
      for (const value of Object.values(other)) assert.strictEqual(value, "", "a different customer never inherits Thai Modern Bags' contacts");
    });

    test("an existing saved Facebook footer with the old full URL is migrated once; other edits are kept", () => {
      const st = rt._read();
      const c = st.clients.find((x) => x.id === bagsId);
      c.captionFooters = { ...copy.captionFootersFor(c), facebook: copy.LEGACY_THAI_MODERN_BAGS_FACEBOOK };
      rt._write(st);
      assert.ok(rt.getState().clients.find((x) => x.id === bagsId).captionFooters.facebook.endsWith("🌐 WEBSITE: thaimodernbags.com"), "old value migrated on read");
      const edited = { ...copy.captionFootersFor(bags), facebook: "ข้อความของเราเอง\n🌐 WEBSITE: https://www.thaimodernbags.com" };
      rt.updateClient(bagsId, { captionFooters: edited });
      assert.strictEqual(rt.getState().clients.find((x) => x.id === bagsId).captionFooters.facebook, edited.facebook, "a deliberate operator edit is never overwritten");
      rt.updateClient(bagsId, { captionFooters: copy.defaultCaptionFooters({ id: bagsId }) });
    });

    test("the footer is plain text: no backticks, no Markdown link syntax, no duplicate on re-compose", () => {
      const footer = copy.captionFootersFor(bags).facebook;
      assert.ok(!/[`]/.test(footer), "no backticks");
      assert.ok(!/\]\(/.test(footer), "no markdown links");
      const once = copy.formatPostCaption(bags, "facebook", "ข้อความทดสอบครับ\n#ทดสอบ");
      assert.strictEqual(copy.formatPostCaption(bags, "facebook", once), once, "idempotent");
      assert.strictEqual(once.split("กว่า 40 ปี").length - 1, 1, "footer appears exactly once");
      // a footer pasted into an already-composed draft is removed before re-adding
      const pasted = `${once}\n\n${copy.THAI_MODERN_BAGS_CONTACT}`;
      assert.strictEqual(copy.formatPostCaption(bags, "facebook", pasted).split("กว่า 40 ปี").length - 1, 1);
    });

    test("the other customer's copy is untouched (no footer, raw text kept)", () => {
      const raw = "กาแฟเย็นใหม่ของเรา ลองดูนะครับ\n#กาแฟ";
      assert.strictEqual(copy.formatPostCaption(bakery, "facebook", raw), raw);
    });

    test("PATCH saves a custom footer per platform, keeps history, and rejects bad input", () => {
      const next = { ...copy.captionFootersFor(bags), line: "LINE: @thaimodernbags สั้นๆ" };
      rt.updateClient(bagsId, { captionFooters: next });
      const saved = getClient().captionFooters;
      assert.strictEqual(saved.line, "LINE: @thaimodernbags สั้นๆ");
      assert.ok(getClient().captionFooterHistory.length >= 1, "previous block kept for audit");
      assert.throws(() => rt.updateClient(bagsId, { captionFooters: { telegram: "x" } }), /ไม่รู้จัก/);
      assert.throws(() => rt.updateClient(bagsId, { captionFooters: { facebook: 123 } }), /ต้องเป็นข้อความ/);
      assert.throws(() => rt.updateClient(bagsId, { captionFooters: { facebook: "x".repeat(2000) } }), /ยาวเกิน/);
      // restore the seeded block for the publishing tests below
      rt.updateClient(bagsId, { captionFooters: copy.defaultCaptionFooters({ id: bagsId }) });
    });

    test("live Facebook post carries the footer, and the sent text is what the preview showed", async () => {
      const id = mk("facebook", "13:01");
      attachImage(id);
      resetClocks();
      calls = [];
      const preview = rt.buildPlatformVersions({ caption: getEntry(id).caption, product: bags.products[0], client: getClient() }).versions.facebook;
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });
      const feed = calls.find((c) => c.urlPath.includes("/feed"));
      const message = JSON.parse(feed.body).message;
      assert.ok(message.includes("กว่า 40 ปี ที่ Thai Modern Bags"), "footer sent");
      assert.ok(message.includes("🌐 WEBSITE: thaimodernbags.com"), "Facebook sends the bare domain");
      assert.ok(!message.includes("https://www.thaimodernbags.com"), "Facebook never sends the full website URL");
      assert.ok(message.includes("https://shop.example.com/p/wlb-006?utm_source=facebook"), "outbound link still gets UTM");
      assert.strictEqual(out.publishedCaption, message, "publishedCaption records exactly what was sent");
      assert.ok(preview.includes("กว่า 40 ปี"), "the preview promised the same footer");
    });

    test("Instagram image post is a two-image carousel: AI image first, real product photo second", async () => {
      const id = mk("instagram", "13:02");
      attachImage(id);
      resetClocks();
      calls = [];
      const out = await rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" });
      assert.strictEqual(out.mediaKind, "carousel");
      assert.strictEqual(out.attachedProductRef, true);
      const items = calls.filter((c) => c.urlPath.endsWith("/media") && c.method === "POST" && c.body.includes("is_carousel_item"));
      assert.strictEqual(items.length, 2, "two carousel items");
      assert.ok(items[0].body.includes("https://cdn.example.com/ai.png"), "AI image first");
      assert.ok(items[1].body.includes("https://i.ibb.co/"), "product photo second, hosted via imgbb");
      const parent = calls.find((c) => c.urlPath.endsWith("/media") && c.body.includes("CAROUSEL"));
      assert.ok(parent, "carousel container created");
      const parentBody = JSON.parse(parent.body);
      assert.strictEqual(parentBody.children.split(",").length, 2, "parent lists both children");
      assert.ok(parentBody.caption.includes("กว่า 40 ปี"), "footer in the Instagram caption");
      assert.ok(parentBody.caption.includes("🌐 WEBSITE: https://www.thaimodernbags.com"), "Instagram keeps the full URL");
      assert.ok(calls.some((c) => c.urlPath.endsWith("/media_publish")), "carousel published");
    });

    test("Instagram refuses before any upload when the product photo is missing", async () => {
      setProductImage("https://cdn.example.com/elsewhere.png");
      const id = mk("instagram", "13:03");
      attachImage(id);
      resetClocks();
      calls = [];
      await assert.rejects(() => rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" }), /รูปสินค้าจริงคู่กับภาพ AI/);
      assert.strictEqual(calls.length, 0, "no request leaves the machine");
      setProductImage(`/sa-products/${bagsId}/${sku}.png`);
    });

    test("Instagram refuses a carousel without an imgbb key, not a silent one-photo post", async () => {
      const id = mk("instagram", "13:04");
      attachImage(id);
      resetClocks();
      rt.saveConnectors(bagsId, { connectors: { instagram: { imgbbApiKey: "" } } });
      calls = [];
      try {
        await assert.rejects(() => rt._publishEntry(getClient(), getEntry(id), { trigger: "manual" }), /imgbb API key/);
        assert.ok(!calls.some((c) => c.urlPath.endsWith("/media_publish")), "nothing published");
      } finally {
        rt.saveConnectors(bagsId, { connectors: { instagram: { imgbbApiKey: "fake-imgbb-key" } } });
      }
    });

    test("a preset-applied caption stores the body only; the footer is added when it is shown or sent", () => {
      const id = mk("facebook", "13:05");
      const body = "สินค้าใหม่จากโรงงานของเรา ลองดูได้เลยครับ\n#กระเป๋า";
      rt.applyCaptionPreset(bagsId, id, { presetId: "product-intro", caption: body });
      const stored = getEntry(id).caption;
      assert.strictEqual(stored, body, "the editable body is stored, not a second footer copy");
      assert.ok(copy.formatPostCaption(bags, "facebook", stored).includes("กว่า 40 ปี"));
    });

    test("the Thai Modern Bags footer stays within the Facebook and Instagram limits", () => {
      const limit = copy.PLATFORM_RULES.facebook.maxChars;
      const composed = copy.formatPostCaption(bags, "facebook", "ก".repeat(200));
      assert.ok(composed.length <= limit, `${composed.length} <= ${limit}`);
      assert.ok(copy.footerLimit("facebook") >= copy.THAI_MODERN_BAGS_CONTACT.length, "block fits the editing limit");
    });
  }

  let passed = 0;
  try {
    for (const [name, fn] of tests) {
      try {
        await fn();
        passed += 1;
        console.log(`  ok - ${name}`);
      } catch (err) {
        console.error(`  FAIL - ${name}\n${err.stack || err}`);
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    SocialAgencyRuntime._https = realHttps;
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (!process.exitCode) console.log(`PASS: ${passed} brand footer and product-pair checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
