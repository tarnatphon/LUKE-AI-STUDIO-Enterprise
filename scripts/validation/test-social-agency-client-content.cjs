#!/usr/bin/env node
"use strict";

/**
 * Social Agency — คอนเทนต์อิงลูกค้า (client-driven content, ไม่ใช่กระเป๋าโดยปริยาย).
 *
 * Content used to be authored for one business: every client was planned with
 * the same angles ("เบื้องหลังการผลิต", "โปรโมชัน/ข้อเสนอ OEM"), the same
 * caption leads ("โรงงานเราวันนี้คึกคักมาก") and the same factory hashtag
 * fallback. These checks pin the new contract:
 *
 * - `detectContentKind()` reads the client's industry + products and answers
 *   goods / food / service / shop / generic (seed clients land on the right
 *   one; an explicit `contentKind` wins);
 * - a client's month is planned with ITS OWN angles, weighted by its pillars,
 *   and the calendar can narrow that list (`angles: [...]`);
 * - untouched legacy default pillars are swapped once for the client's kind,
 *   but pillars the operator edited are never overwritten;
 * - captions, ready-made caption examples, hashtags and the English image
 *   style phrase all follow the client's kind — while a client without one
 *   (and the bag factory itself) sees exactly the copy it saw before;
 * - the angle picker and the "what the client wants" summary exist in the UI.
 *
 * Everything is mocked: no network, no real account, no image backend.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const kinds = require("../server/social-agency-content-kinds.cjs");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");

function futureMonth(offsetMonths = 2) {
  const now = new Date(Date.now() + 7 * 3600000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  return d.toISOString().slice(0, 7);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-content-kinds-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientOf = (id) => rt._read().clients.find((c) => c.id === id);
  const month = futureMonth(2);

  // ── kind detection ───────────────────────────────────────────────────────

  test("every seed client is detected as the business it actually runs", () => {
    const expected = {
      "thai-modern-bags": "goods",
      "oven-ban-bakery": "food",
      "doi-hom-coffee": "food",
      "plai-fon-yoga": "service",
      "plant-club": "shop",
    };
    for (const [id, kind] of Object.entries(expected)) {
      const client = clientOf(id);
      assert.strictEqual(kinds.detectContentKind(client), kind, `${id} should read as ${kind}`);
      assert.ok(kinds.kindLabel(kind).length > 0, "every kind has a Thai label");
    }
  });

  test("an unknown industry falls back to generic, and an explicit kind always wins", () => {
    const made = rt.createClient({ name: "ร้านทดสอบธุรกิจใหม่", industry: "", tone: "เจ้าของแบรนด์", firstProduct: "สินค้าทดสอบ A-001" }).id;
    assert.strictEqual(kinds.detectContentKind(clientOf(made)), "generic", "no signal → generic, never goods");
    rt.updateClient(made, { contentKind: "service" });
    assert.strictEqual(kinds.detectContentKind(clientOf(made)), "service", "operator choice wins over detection");
    assert.throws(() => rt.updateClient(made, { contentKind: "bakery" }), /ไม่รู้จักประเภทธุรกิจนี้/);
  });

  test("each kind owns five role angles and the legacy five are the goods kind", () => {
    const legacy = ["เปิดตัวสินค้า", "เบื้องหลังการผลิต", "เคล็ดลับการใช้งาน", "เรื่องจากลูกค้า", "โปรโมชัน/ข้อเสนอ OEM"];
    assert.deepStrictEqual(kinds.anglesForKind("goods"), legacy, "the original labels stay the goods set");
    assert.deepStrictEqual([...kinds.allAngles()].slice(0, legacy.length), legacy, "goods angles come first in the union");
    for (const kind of kinds.KINDS) {
      const angles = kinds.anglesForKind(kind);
      assert.strictEqual(angles.length, 5, `${kind} plans five angles (one per role)`);
      assert.strictEqual(new Set(angles).size, 5, `${kind} has no duplicate label`);
      for (const angle of angles) assert.ok(kinds.allAngles().includes(angle), `${angle} is in the validation union`);
    }
    assert.strictEqual(kinds.roleOfAngle("เบื้องหลังครัว", "food"), "behind");
    assert.strictEqual(kinds.roleOfAngle("เบื้องหลังการผลิต", "food"), "behind", "a legacy label still resolves by role");
  });

  // ── planning with the client's own angles ────────────────────────────────

  test("a month is planned with the client's own angles, not the factory set", async () => {
    const plan = await rt.autoPlanPreview("plai-fon-yoga", { month, onePerDay: true, platforms: ["facebook"] });
    assert.strictEqual(plan.contentKind, "service");
    assert.strictEqual(plan.contentKindLabel, kinds.kindLabel("service"));
    const serviceAngles = kinds.anglesForKind("service");
    assert.ok(plan.slots.length > 0);
    for (const slot of plan.slots) {
      assert.ok(serviceAngles.includes(slot.angle), `${slot.angle} belongs to the studio, not the factory`);
    }
    assert.ok(!plan.slots.some((s) => s.angle === "โปรโมชัน/ข้อเสนอ OEM"), "no OEM offer for a yoga studio");
    assert.ok(plan.angleMix.length > 0 && plan.angleMix.every((row) => row.count > 0), "the preview reports its angle mix");
    assert.strictEqual(plan.angleMix.reduce((sum, row) => sum + row.count, 0), plan.slots.length, "the mix covers every slot");
  });

  test("pillar weight decides how often an angle comes back (round robin, never twice in a row)", () => {
    const client = { contentKind: "food", products: [] };
    const pool = kinds.planAnglesFor(client);
    const unique = [...new Set(pool)];
    assert.strictEqual(unique.length, 5, "five angles in the rotation");
    assert.ok(pool.length > unique.length, "weight 2 angles are repeated");
    for (let i = 1; i < pool.length; i += 1) {
      assert.notStrictEqual(pool[i], pool[i - 1], "two consecutive slots never repeat the same angle");
    }
    const heavy = kinds.planAnglesFor({ contentKind: "generic", pillars: [{ name: "ขาย", angles: ["ของใหม่จากร้าน"], weight: 4 }] });
    assert.strictEqual(heavy.length, 4, "weight 4 spends four passes on one angle");
  });

  test("the calendar's angle picker narrows the month to exactly the ticked angles", async () => {
    const client = clientOf("oven-ban-bakery");
    const picked = [kinds.anglesForKind("food")[0], kinds.anglesForKind("food")[4]];
    const plan = await rt.autoPlanPreview("oven-ban-bakery", { month, onePerDay: true, platforms: ["facebook", "line"], angles: picked });
    assert.deepStrictEqual([...plan.angles].sort(), [...picked].sort(), "the preview lists exactly what was picked");
    for (const slot of plan.slots) assert.ok(picked.includes(slot.angle), `${slot.angle} was not picked`);
    assert.ok(plan.slots.some((s) => s.angle === picked[0]) && plan.slots.some((s) => s.angle === picked[1]), "both picked angles are used");
    const all = kinds.planAnglesFor(client);
    assert.ok(!all.includes("ของใหม่จากร้าน"), "another kind's angle never leaks in");
  });

  test("entries applied from a plan keep the plan's angle and the client's pillar", async () => {
    const id = rt.createClient({ name: "สตูดิโอทดสอบ", industry: "สตูดิโอโยคะ", tone: "พนักงานขาย", firstProduct: "คลาสทดสอบ C-001" }).id;
    rt.addProduct(id, { name: "คลาสทดสอบ C-002" });
    const plan = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["facebook"] });
    const applied = rt.applyAutoPlan(id, { month, slots: plan.slots.slice(0, 2) });
    assert.strictEqual(applied.created.length, 2);
    for (const entry of applied.created) {
      assert.ok(kinds.anglesForKind("service").includes(entry.angle), `${entry.angle} is a service angle`);
      assert.ok(entry.pillar, "every entry names the pillar it came from");
      assert.strictEqual(entry.status, "planned");
    }
  });

  // ── pillars ──────────────────────────────────────────────────────────────

  test("untouched factory pillars are swapped for the client's kind exactly once", () => {
    const bakery = clientOf("oven-ban-bakery");
    assert.ok(bakery.pillars.some((p) => p.name === "ขายเมนู"), "a new bakery client starts with its own pillars");
    assert.ok(!bakery.pillars.some((p) => p.angles.includes("โปรโมชัน/ข้อเสนอ OEM")), "no OEM angle on a bakery pillar");
    // the bag factory keeps the legacy pillar set it always had
    const bags = clientOf("thai-modern-bags");
    assert.deepStrictEqual(bags.pillars.map((p) => p.name), ["ขายตรง", "ให้ความรู้", "สร้างความเชื่อใจ"]);
    assert.ok(bags.pillars.some((p) => p.angles.includes("โปรโมชัน/ข้อเสนอ OEM")));

    // A state file saved BEFORE kinds existed carries the factory pillars on
    // every client — that is what the one-time swap is for.
    const state = rt._read();
    const bakeryState = state.clients.find((c) => c.id === "oven-ban-bakery");
    bakeryState.pillars = kinds.pillarsForKind("goods", new Date().toISOString());
    delete bakeryState.contentPillarsSyncedAt;
    delete bakeryState.contentPillarsSyncedKind;
    rt._write(state);
    const upgraded = clientOf("oven-ban-bakery");
    assert.ok(upgraded.pillars.some((p) => p.name === "ขายเมนู"), "an old state file is upgraded to the bakery's pillars");
    assert.ok(!upgraded.pillars.some((p) => p.angles.includes("โปรโมชัน/ข้อเสนอ OEM")), "the factory angles are gone");
    assert.strictEqual(upgraded.contentPillarsSyncedKind, "food");
    assert.ok(upgraded.contentPillarsSyncedAt, "the one-time sync is timestamped");
    // …and the swap is not repeated on the next read
    const again = clientOf("oven-ban-bakery");
    assert.deepStrictEqual(again.pillars.map((p) => p.id), upgraded.pillars.map((p) => p.id), "second read changes nothing");
  });

  test("a pillar the operator edited is never overwritten by the sync", () => {
    const id = rt.createClient({ name: "ร้านขนมทดสอบ", industry: "เบเกอรี่ เค้ก ขนม", tone: "แอดมินเพจ", firstProduct: "เค้กทดสอบ K-001" }).id;
    rt.updatePillar(id, clientOf(id).pillars[0].id, { name: "เสาของฉัน", weight: 3 });
    const before = clientOf(id).pillars.map((p) => p.name);
    rt.updateClient(id, { industry: "สตูดิโอโยคะ" }); // business changes under it
    assert.deepStrictEqual(clientOf(id).pillars.map((p) => p.name), before, "an edited pillar survives the kind change");
    assert.ok(clientOf(id).contentPillarsEditedAt, "the edit is recorded");
  });

  test("new pillars accept this client's angles and still reject nonsense", () => {
    const id = "plai-fon-yoga";
    const pillar = rt.addPillar(id, { name: "เสาทดสอบมุมใหม่", angles: ["ความรู้/วิธีปฏิบัติ", "ไม่ได้มีอยู่จริง"], weight: 2 });
    assert.deepStrictEqual(pillar.angles, ["ความรู้/วิธีปฏิบัติ"], "unknown labels are dropped");
    // no angles at all = "ใช้ทุกมุมของลูกค้ารายนี้" (the client's own pool, never another kind's)
    const all = rt.addPillar(id, { name: "เสาทุกมุม", weight: 1 });
    assert.deepStrictEqual(all.angles, kinds.anglesForKind("service"));
    assert.throws(() => rt.updatePillar(id, pillar.id, { angles: [] }), /อย่างน้อย 1 มุม/);
    const list = rt.listPillars(id);
    assert.ok(Array.isArray(list) && list.some((p) => p.name === "เสาทดสอบมุมใหม่"), "listPillars still answers an array");
    const profile = rt.contentProfile(id);
    assert.strictEqual(profile.contentKind, "service");
    assert.deepStrictEqual(profile.angles, kinds.anglesForKind("service"), "the editor offers the studio's own angles");
  });

  // ── copy follows the client ──────────────────────────────────────────────

  test("captions speak the client's business — and the factory's copy is unchanged", () => {
    const state = rt.getState();
    const yoga = state.clients.find((c) => c.id === "plai-fon-yoga");
    const bakery = state.clients.find((c) => c.id === "oven-ban-bakery");
    const bags = state.clients.find((c) => c.id === "thai-modern-bags");

    const yogaCaption = SocialAgencyRuntime._templateCaption(yoga.products[0], { angle: "คลาส/บริการใหม่", platform: "facebook", tone: yoga.tone, seed: "kind-test", client: yoga });
    assert.ok(!/โรงงาน|ผลิต|OEM|สต็อก/.test(yogaCaption), `a studio never talks about production:\n${yogaCaption}`);
    assert.ok(/#(โยคะ|คลาสโยคะ)/.test(yogaCaption), "the studio keeps its own hashtags");

    const bakeryCaption = SocialAgencyRuntime._templateCaption(bakery.products[0], { angle: "เมนูใหม่", platform: "facebook", tone: bakery.tone, seed: "kind-test", client: bakery });
    assert.ok(!/โรงงาน|OEM|ผลิต/.test(bakeryCaption), `a bakery never talks about production:\n${bakeryCaption}`);
    assert.ok(/จำนวนขั้นต่ำ|เริ่มต้น/.test(bakeryCaption), "ordering facts use the food wording");

    const bagsCaption = SocialAgencyRuntime._templateCaption(bags.products[0], { angle: "เปิดตัวสินค้า", platform: "facebook", tone: "เจ้าของแบรนด์", seed: "kind-test" });
    assert.ok(/สั่งขั้นต่ำ/.test(bagsCaption), "without a client the wording is the original one");
    assert.ok(/#กระเป๋าผ้า|#ผลิตกระเป๋า/.test(bagsCaption), "…and so are the hashtags");
    const bagsWithClient = SocialAgencyRuntime._templateCaption(bags.products[0], { angle: "เปิดตัวสินค้า", platform: "facebook", tone: "เจ้าของแบรนด์", seed: "kind-test", client: bags });
    assert.strictEqual(bagsWithClient.replace(/\n+/g, "\n"), bagsCaption.replace(/\n+/g, "\n"), "the bag factory's own copy is byte-identical");
  });

  test("the three ready-made examples follow the kind too", () => {
    const state = rt.getState();
    const food = state.clients.find((c) => c.id === "oven-ban-bakery");
    const service = state.clients.find((c) => c.id === "plai-fon-yoga");
    const foodDrafts = SocialAgencyRuntime._captionPresets.map((p) => p.build({ product: food.products[1], platform: "facebook", client: food }));
    const serviceDrafts = SocialAgencyRuntime._captionPresets.map((p) => p.build({ product: service.products[0], platform: "facebook", client: service }));
    assert.strictEqual(foodDrafts.length, 3);
    for (const draft of foodDrafts) assert.ok(!/โรงงาน|OEM|ผลิต 30/.test(draft), draft);
    assert.ok(serviceDrafts.some((d) => /รอบเวลา|เป้าหมาย|คลาส/.test(d)), serviceDrafts.join("\n---\n"));
    for (const draft of serviceDrafts) assert.ok(!/โรงงาน|OEM/.test(draft), draft);
  });

  test("hashtags come from the client's kind, with a fallback that fits the business", () => {
    const unknownFoodProduct = { name: "ข้าวเหนียวมะม่วง", category: "Thai dessert" };
    const foodTags = kinds.hashtagsForKind("food", unknownFoodProduct);
    assert.ok(foodTags.every((t) => /อร่อย|เมนู|กิน|ร้าน|ชิม/.test(t)), `food fallback reads like food: ${foodTags.join(" ")}`);
    const serviceTags = kinds.hashtagsForKind("service", { name: "คลาสใหม่", category: "Workshop" });
    const themed = (tags, re) => tags.filter((t) => re.test(t)).length >= 3;
    assert.ok(themed(serviceTags, /คลาส|สุขภาพ|เริ่มต้น|จอง/), `service fallback reads like a studio: ${serviceTags.join(" ")}`);
    const shopTags = kinds.hashtagsForKind("shop", { name: "ของใช้ครัวเรือน", category: "Household" });
    assert.ok(themed(shopTags, /ของ|ร้าน|ช้อป|สอบถาม/), `shop fallback reads like a shop: ${shopTags.join(" ")}`);
    assert.ok(!/สั่งทำ|ผ้าฝีมือ|โรงงาน|OEM/.test([...foodTags, ...serviceTags, ...shopTags].join(" ")), "no factory tags leak into other businesses");
    // the categories that already had good copy keep it
    assert.ok(kinds.hashtagsForKind("food", { name: "เค้กวันเกิด", category: "Birthday cakes" }).includes("#เค้กสั่งทำ"));
    assert.ok(kinds.hashtagsForKind("goods", { name: "กระเป๋ากล้อง", category: "Camera bags" }).includes("#OEMกระเป๋า"));
    // legacy behaviour is still reachable without a client
    assert.deepStrictEqual(kinds.legacyHashtags(unknownFoodProduct), ["#สั่งทำ", "#ฝีมือคนไทย", "#ของดีแนะนำ", "#ร้านน่าติดตาม", "#ช้อปสบายๆ"]);
  });

  test("the English image style phrase changes with the business, Thai copy never enters the prompt", () => {
    assert.strictEqual(kinds.angleImagePrompt("เบื้องหลังครัว", "food"), "behind-the-scenes kitchen, hands preparing fresh food");
    assert.strictEqual(kinds.angleImagePrompt("เบื้องหลังการผลิต", "goods"), "behind-the-scenes artisan workshop");
    const product = { name: "คลาสโยคะสำหรับมือใหม่", category: "Yoga classes", sku: "YG-B01" };
    const prompt = SocialAgencyRuntime._templateImagePrompt(product, { angle: "ความรู้/วิธีปฏิบัติ", seed: "kind-test", kind: "service" });
    assert.ok(/step-by-step technique demonstration/.test(prompt), prompt);
    assert.ok(!/[\u0E00-\u0E7F]/.test(prompt), "Stable Diffusion prompts stay ASCII-only");
  });

  test("existing state keeps working: old angle labels stay valid after the upgrade", () => {
    const id = "thai-modern-bags";
    const entry = rt.createCalendarEntry(id, { entry: { date: `${month}-07`, time: "09:00", platform: "facebook", sku: clientOf(id).products[0].sku, angle: "โปรโมชัน/ข้อเสนอ OEM" } });
    assert.strictEqual(entry.angle, "โปรโมชัน/ข้อเสนอ OEM", "a legacy label is still accepted");
    const patched = rt.updateCalendarEntry(id, entry.id, { angle: "เบื้องหลังครัว" });
    assert.strictEqual(patched.angle, "เบื้องหลังครัว", "a new-kind label is accepted on an old client too");
    const auto = rt.createCalendarEntry(id, { entry: { date: `${month}-08`, time: "10:00", platform: "facebook", sku: clientOf(id).products[0].sku } });
    assert.ok(kinds.anglesForKind("goods").includes(auto.angle), `with no angle the entry still gets one of its own kind (${auto.angle})`);
    assert.ok(auto.pillar, "…and the pillar it belongs to");
  });

  // ── UI ───────────────────────────────────────────────────────────────────

  test("the calendar lets the operator say what this month is about", () => {
    const calendar = read("app", "frontend", "src", "social-agency", "CalendarTab.jsx");
    assert.match(calendar, /sa-plan-angles/);
    assert.match(calendar, /activeClient\?\.planAngles/);
    assert.match(calendar, /angles: \[\.\.\.planAngles\]/);
    assert.match(calendar, /มุมคอนเทนต์:/);
    const modals = read("app", "frontend", "src", "social-agency", "modals.jsx");
    assert.match(modals, /มุมคอนเทนต์เดือนนี้/);
    assert.match(modals, /preview\.angleMix/);
    const style = read("app", "frontend", "src", "social-agency", "StyleTab.jsx");
    assert.match(style, /content\?\.angles/);
    assert.match(style, /contentKindLabel/);
    const css = read("app", "frontend", "src", "social-agency.css");
    assert.match(css, /\.sa-plan-angles/);
    assert.match(css, /\.sa-plan-angle\.on/);
  });

  test("the server hands the UI the client's own plan angles", () => {
    const state = rt.getState();
    for (const client of state.clients) {
      assert.ok(Array.isArray(client.contentAngles) && client.contentAngles.length === 5, `${client.id} exposes five angles`);
      assert.ok(Array.isArray(client.planAngles) && client.planAngles.length >= 5, `${client.id} exposes the weighted rotation`);
      assert.ok(client.contentKind && client.contentKindLabel, `${client.id} names its business kind`);
      assert.ok(Array.isArray(client.angleOptions) && client.angleOptions.length >= 5, `${client.id} exposes the picker options`);
    }
    const listed = rt.listClients();
    assert.ok(listed.every((c) => c.contentKindLabel), "the client switcher can label each business");
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
  if (!process.exitCode) console.log(`PASS: ${passed} client-content checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
