#!/usr/bin/env node
"use strict";

/**
 * Social Agency — ready-made caption examples (ตัวอย่างสำเร็จรูป).
 *
 * The few-shot library keeps text the client wrote. These three examples are
 * complete drafts the runtime fills with the entry's own product evidence
 * (แนะนำสินค้า / ชวนคิดจากโจทย์ใช้งาน / ชวนเริ่มพูดคุย), previewed with the
 * post's own image and platform layout. Applying one replaces the caption and
 * nothing else: no image, no date, no time, no status, and no publish. When the
 * entry has no post media the preview falls back to the product photo and says
 * so — the UI side of that is asserted from the component sources below.
 *
 * Everything is mocked: no network, no real account, no image backend.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-caption-presets-"));
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const client = () => rt._read().clients.find((c) => c.id === clientId);
  const sku = client().products[0].sku;
  const day = bangkokToday(200);
  let slot = 0;

  const mk = (extra = {}) => {
    slot += 1;
    const time = `${String(7 + Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "15" : "45"}`;
    const entry = rt.createCalendarEntry(clientId, {
      entry: { date: day, time, platform: "facebook", sku, angle: "เปิดตัวสินค้า", ...extra },
    });
    return rt.updateCalendarEntry(clientId, entry.id, {});
  };
  const fresh = (entryId) => client().calendar.find((e) => e.id === entryId);
  const set = (entryId, patch) => {
    const st = rt._read();
    const entry = st.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === entryId);
    Object.assign(entry, patch);
    rt._write(st);
    return entry;
  };

  test("three examples exist: recommend a product, think from a use case, start a conversation", () => {
    const presets = SocialAgencyRuntime._captionPresets;
    assert.strictEqual(presets.length, 3);
    assert.deepStrictEqual(presets.map((p) => p.id), ["product-intro", "use-case-prompt", "conversation-starter"]);
    assert.deepStrictEqual(presets.map((p) => p.label), ["แนะนำสินค้า", "ชวนคิดจากโจทย์ใช้งาน", "ชวนเริ่มพูดคุย"]);
    for (const p of presets) {
      assert.ok(typeof p.hint === "string" && p.hint.length > 10, `${p.id} needs a hint`);
      assert.strictEqual(typeof p.build, "function");
    }
  });

  test("drafts are filled with this entry's product, in Thai, inside every platform's caption rules", () => {
    const entry = mk();
    const product = client().products.find((p) => p.sku === entry.sku);
    for (const platform of ["facebook", "instagram", "line", "tiktok"]) {
      rt.updateCalendarEntry(clientId, entry.id, { platform });
      const listed = rt.listCaptionPresets(clientId, entry.id);
      assert.strictEqual(listed.platform, platform);
      assert.strictEqual(listed.editable, true);
      assert.strictEqual(listed.drafts.length, 3);
      for (const draft of listed.drafts) {
        assert.ok(draft.text.includes(product.name), `${draft.id} must name the product`);
        assert.ok(draft.text.length <= draft.limit, `${draft.id} on ${platform}: ${draft.text.length} > ${draft.limit}`);
        const hashtags = draft.text.match(/#[^\s#]+/g) || [];
        if (platform === "line") assert.ok(hashtags.length <= 2, `LINE draft asked for ${hashtags.length} hashtags`);
        else assert.ok(hashtags.length >= 3 && hashtags.length <= 8, `${platform} draft hashtags: ${hashtags.length}`);
        // The same AI Check the workflow runs must find nothing to fix: these
        // are ready-made drafts, not drafts that get sent back for review.
        assert.deepStrictEqual(rt._localEvidenceIssues(draft.text, product), [], `${draft.id} on ${platform} evidence`);
        assert.deepStrictEqual(rt._localCheck(draft.text, product, platform, client()).issues, [], `${draft.id} on ${platform} check`);
      }
    }
  });

  test("LINE drafts stay compact enough for a broadcast", () => {
    const entry = mk({ platform: "line" });
    for (const draft of rt.listCaptionPresets(clientId, entry.id).drafts) {
      assert.ok(draft.limit === 400 && draft.text.length < 400, `${draft.id} is ${draft.text.length} chars`);
    }
  });

  test("a caption quotes a price only when the product carries one, and the evidence guard accepts it", () => {
    const entry = mk();
    const plain = rt.listCaptionPresets(clientId, entry.id).drafts;
    for (const draft of plain) assert.ok(!/ราคา/.test(draft.text), `${draft.id} invented a price`);

    const priced = rt.addProduct(clientId, { name: "กระเป๋าพรีเมียม", category: "bag", price: "199" });
    const pricedEntry = mk({ sku: priced.sku });
    const drafts = rt.listCaptionPresets(clientId, pricedEntry.id).drafts;
    assert.ok(drafts.every((d) => d.text.includes("ราคา 199")), "a product price must reach the draft");
    const product = client().products.find((p) => p.sku === priced.sku);
    for (const draft of drafts) {
      assert.deepStrictEqual(rt._localEvidenceIssues(draft.text, product), [], `${draft.id} price evidence`);
    }
    // A number the product record does not carry is still refused.
    assert.match(rt._localEvidenceIssues("ราคาเพียง 1,200 บาท สนใจทักมาได้เลยครับ", product).join(" "), /อ้างราคา/);
  });

  test("listing the drafts writes nothing", () => {
    const entry = mk();
    const before = JSON.stringify(client().calendar.find((e) => e.id === entry.id));
    rt.listCaptionPresets(clientId, entry.id);
    const after = JSON.stringify(client().calendar.find((e) => e.id === entry.id));
    assert.strictEqual(before, after);
  });

  test("applying a draft replaces only the caption — media, schedule and status stay as they were", () => {
    const entry = mk({ platform: "instagram" });
    set(entry.id, {
      status: "needs_review",
      image: { url: "/outputs/sa/keep.png" },
      video: { url: "/outputs/sa/keep.mp4" },
      metrics: { likes: 3 },
    });
    const original = fresh(entry.id);
    const runsBefore = client().workflowRuns.length;
    const draft = rt.listCaptionPresets(clientId, entry.id).drafts[1];
    const applied = rt.applyCaptionPreset(clientId, entry.id, { presetId: draft.id });

    assert.strictEqual(applied.caption, draft.text);
    assert.strictEqual(applied.captionManual, true, "the workflow must keep this caption instead of writing a new one");
    assert.strictEqual(applied.captionSource, `preset:${draft.id}`);
    const stored = fresh(entry.id);
    for (const key of ["date", "time", "platform", "sku", "productName", "status", "angle", "inFlight", "publishMode", "publishedAt", "postId"]) {
      assert.deepStrictEqual(stored[key], original[key], `${key} changed when a preset was applied`);
    }
    assert.deepStrictEqual(stored.image, original.image);
    assert.deepStrictEqual(stored.video, original.video);
    assert.deepStrictEqual(stored.metrics, original.metrics);
    assert.strictEqual(client().workflowRuns.length, runsBefore, "applying a preset must not start a run");
  });

  test("applying on an entry waiting for approval does not approve or publish it", () => {
    const entry = mk();
    set(entry.id, { status: "needs_review" });
    const draft = rt.listCaptionPresets(clientId, entry.id).drafts[0];
    rt.applyCaptionPreset(clientId, entry.id, { presetId: draft.id });
    assert.strictEqual(fresh(entry.id).status, "needs_review");
    assert.ok(!fresh(entry.id).publishedAt);
  });

  test("an edited draft wins; an empty edit falls back to the draft text", () => {
    const entry = mk();
    const draft = rt.listCaptionPresets(clientId, entry.id).drafts[2];
    rt.applyCaptionPreset(clientId, entry.id, { presetId: draft.id, caption: `${draft.text}\n\nเพิ่มบรรทัดที่แก้เองครับ 📝` });
    assert.ok(fresh(entry.id).caption.endsWith("เพิ่มบรรทัดที่แก้เองครับ 📝"));
    rt.applyCaptionPreset(clientId, entry.id, { presetId: draft.id, caption: "   " });
    assert.strictEqual(fresh(entry.id).caption, draft.text);
  });

  test("over-long edits and unknown examples are refused without touching the caption", () => {
    const entry = mk({ platform: "line" });
    rt.updateCalendarEntry(clientId, entry.id, { caption: "ของเดิม" });
    const draft = rt.listCaptionPresets(clientId, entry.id).drafts[0];
    assert.throws(
      () => rt.applyCaptionPreset(clientId, entry.id, { presetId: draft.id, caption: "ก".repeat(401) }),
      /เกินสำหรับ line/
    );
    assert.throws(() => rt.applyCaptionPreset(clientId, entry.id, { presetId: "nope" }), /ไม่รู้จักตัวอย่างนี้/);
    assert.strictEqual(fresh(entry.id).caption, "ของเดิม");
  });

  test("entries that are not editable are refused with a reason, and the caption stays put", () => {
    const cases = [
      ["published", { status: "published" }, /เผยแพร่แล้ว/],
      ["running", { inFlight: true }, /กำลังรันอยู่/],
      ["publishing", { status: "publishing" }, /กำลังรันอยู่/],
      ["tiktok consented", { platform: "tiktok", tiktokPost: { privacyLevel: "SELF_ONLY" } }, /TikTok/],
      ["tiktok init sent", { platform: "tiktok", tiktokInitAttemptedAt: "2026-10-07T00:00:00.000Z" }, /TikTok/],
      ["A/B variant", { abTest: { id: "ab1", variant: "A" } }, /A\/B/],
      ["A/B original", { abTestSource: { id: "ab1" } }, /A\/B/],
    ];
    for (const [name, patch, expected] of cases) {
      const entry = mk();
      rt.updateCalendarEntry(clientId, entry.id, { caption: "ข้อความเดิม" });
      set(entry.id, patch);
      const listed = rt.listCaptionPresets(clientId, entry.id);
      assert.strictEqual(listed.editable, false, `${name} should not be editable`);
      assert.match(listed.reason, expected);
      assert.throws(
        () => rt.applyCaptionPreset(clientId, entry.id, { presetId: "product-intro" }),
        expected,
        `${name} must refuse the apply`
      );
      assert.strictEqual(fresh(entry.id).caption, "ข้อความเดิม", `${name} lost its caption`);
    }
  });

  test("each entry's drafts follow that entry's own platform", () => {
    const fb = mk({ platform: "facebook" });
    const line = mk({ platform: "line" });
    const fbDraft = rt.listCaptionPresets(clientId, fb.id).drafts[0].text;
    const lineDraft = rt.listCaptionPresets(clientId, line.id).drafts[0].text;
    assert.notStrictEqual(fbDraft, lineDraft);
    assert.ok((fbDraft.match(/#[^\s#]+/g) || []).length > (lineDraft.match(/#[^\s#]+/g) || []).length);
  });

  test("the calendar card shows an eye when the entry has something to preview", () => {
    const calendar = read("app", "frontend", "src", "social-agency", "CalendarTab.jsx");
    assert.match(calendar, /import \{[^}]*\bEye\b[^}]*\} from "lucide-react"/);
    assert.match(calendar, /const previewable = Boolean\(entry\.caption \|\| entry\.publishedCaption \|\| entry\.image\?\.url \|\| entry\.video\?\.url\)/);
    assert.match(calendar, /\{previewable && \(/);
    assert.match(calendar, /<span className="sa-chip-eye" aria-hidden="true"/);
    assert.match(calendar, /<Eye size=\{11\} \/>/);
  });

  test("the post preview sits at the top of the entry details and carries the examples", () => {
    const drawers = read("app", "frontend", "src", "social-agency", "drawers.jsx");
    const meta = drawers.indexOf('className="sa-entry-meta"');
    const preview = drawers.indexOf("พรีวิวโพสต์เต็ม");
    const presets = drawers.indexOf("<CaptionPresets");
    const facts = drawers.indexOf('className="sa-entry-facts"');
    const reschedule = drawers.indexOf("เลื่อนเวลา");
    assert.ok(meta > -1 && preview > meta, "preview must come after the entry header");
    assert.ok(presets > preview, "examples must follow the preview");
    assert.ok(facts > presets, "facts must follow the preview");
    assert.ok(reschedule > presets, "rescheduling must follow the preview");
    assert.strictEqual(drawers.indexOf("พรีวิวโพสต์เต็ม", preview + 1), -1, "only one copy of the preview section");
    assert.match(drawers, /<CaptionPresets entry=\{entry\} client=\{client\} product=\{product\} busy=\{busy\} onApplied=\{onCaptionApplied\} \/>/);
  });

  test("the component previews with the entry's own image and applies through the narrow route", () => {
    const component = read("app", "frontend", "src", "social-agency", "CaptionPresets.jsx");
    assert.match(component, /<PostPreview entry=\{entry\} client=\{client\} product=\{product\} caption=\{draft\} \/>/);
    assert.match(component, /\/api\/social-agency\/caption-presets\?clientId=\$\{encodeURIComponent\(clientId\)\}&entryId=\$\{encodeURIComponent\(entryId\)\}/);
    assert.match(component, /postJson\("\/api\/social-agency\/entry-caption\/preset", \{/);
    assert.match(component, /entryId,\s*presetId: active\.id,\s*caption: draft,/);
    assert.match(component, /แทนที่เฉพาะแคปชัน/);
    assert.match(component, /ไม่เผยแพร่ทันที/);
    // No post media → the preview says it is showing the product photo, not the post.
    assert.match(component, /const productFallback = !hasPostMedia && Boolean\(product\?\.image\)/);
    assert.match(component, /รูปสินค้าต้นฉบับ/);
    assert.match(component, /ระบบจะไม่ส่งรูปนี้แทนสื่อโพสต์/);
    // Editing is bounded by the platform limit the runtime reports.
    assert.match(component, /const tooLong = limit > 0 && draft\.length > limit/);
    assert.match(component, /disabled=\{!editable \|\| saving \|\| busy \|\| !draft\.trim\(\) \|\| tooLong \|\| unchanged\}/);
    const agency = read("app", "frontend", "src", "components", "SocialAgency.jsx");
    assert.match(agency, /onCaptionApplied=\{refresh\}/);
  });

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
  if (!process.exitCode) console.log(`PASS: ${passed} caption preset checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
