#!/usr/bin/env node
"use strict";

/**
 * Social Agency — auto-plan รายเดือน: วางแผนซ้ำได้ + หลายงานต่อวัน.
 *
 * The month planner used to be one-shot: the first "วางแผนอัตโนมัติทั้งเดือน"
 * filled every day with exactly one post, and every later run found no free
 * day and no unused product. These checks pin the new contract:
 *
 * - one day can carry several posts side by side (Facebook + Instagram +
 *   LINE + LinkedIn + เว็บ), one slot per selected platform, staggered times;
 * - one product per day is cross-posted across those platforms, and two
 *   different days never share a product while unused products remain;
 * - auto-plan is repeatable inside the same month: a later run fills only the
 *   (date, platform) combos a previous run left open, and `replacePlanned`
 *   re-plans over unstarted entries without touching anything that already
 *   ran or is running;
 * - apply accepts a full multi-platform month (well past the old 31 cap) and
 *   never stacks two posts on the same platform on the same day.
 *
 * Everything is mocked: no network, no real account, no image backend.
 * The UI half is asserted from the component sources.
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

// A month that is always ahead of "today", so fromDay is always 1.
function futureMonth(offsetMonths = 2) {
  const now = new Date(Date.now() + 7 * 3600000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  return d.toISOString().slice(0, 7);
}

function daysInMonth(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-auto-plan-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientOf = (id) => rt._read().clients.find((c) => c.id === id);
  const month = futureMonth(2);
  const days = daysInMonth(month);
  // What a plan fills when nobody picks platforms — LinkedIn included.
  const PLATFORMS5 = ["facebook", "instagram", "line", "linkedin", "demo"];
  const PLATFORMS4 = ["facebook", "instagram", "line", "demo"];

  const makeClient = (name, productCount) => {
    const id = rt.createClient({ name, industry: "ทดสอบ", tone: "เจ้าของแบรนด์", firstProduct: `${name} P-001` }).id;
    for (let i = 2; i <= productCount; i += 1) rt.addProduct(id, { name: `${name} P-${String(i).padStart(3, "0")}` });
    return id;
  };

  // ── one day, many jobs ──────────────────────────────────────────────────

  test("one day carries every selected platform: 5 posts/day (LinkedIn included), staggered times, one product cross-posted", async () => {
    const id = makeClient("วันละห้าช่อง", days + 5);
    const plan = await rt.autoPlanPreview(id, { month, onePerDay: true });
    assert.strictEqual(plan.mode, "one-per-day");
    assert.deepStrictEqual(plan.platforms, PLATFORMS5, "the default plan now includes LinkedIn");
    assert.strictEqual(plan.slots.length, days * 5, `every day × 5 platforms (got ${plan.slots.length})`);
    for (const date of new Set(plan.slots.map((s) => s.date))) {
      const day = plan.slots.filter((s) => s.date === date);
      assert.deepStrictEqual(day.map((s) => s.platform).sort(), [...PLATFORMS5].sort(), `${date}: FB+IG+LINE+LinkedIn+web together`);
      assert.strictEqual(new Set(day.map((s) => s.time)).size, 5, `${date}: times must not collide`);
      assert.strictEqual(new Set(day.map((s) => s.sku)).size, 1, `${date}: one product per day, cross-posted`);
    }
    // LinkedIn reads best before the workday: 08:00 on a weekday, 09:30 on a
    // weekend — never the Facebook anchor time.
    for (const slot of plan.slots.filter((s) => s.platform === "linkedin")) {
      const weekday = (new Date(Date.parse(`${slot.date}T00:00:00Z`)).getUTCDay() + 6) % 7;
      assert.strictEqual(slot.time, weekday >= 5 ? "09:30" : "08:00", `${slot.date}: LinkedIn keeps its own time`);
    }
    assert.strictEqual(new Set(plan.slots.map((s) => s.sku)).size, days, "a product must not repeat between days");
    assert.strictEqual(plan.shortBy, 0);
  });

  test("selected platforms decide what runs per day — and TikTok is never auto-planned", async () => {
    const id = makeClient("เลือกช่อง", 12);
    const plan = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["facebook", "line", "tiktok"] });
    assert.deepStrictEqual(plan.platforms, ["facebook", "line"], "tiktok must be dropped");
    assert.ok(plan.slots.every((s) => ["facebook", "line"].includes(s.platform)));
    const byDate = new Map(plan.slots.map((s) => [s.date, s]));
    assert.strictEqual(plan.slots.length, Math.min(12, days) * 2);
    for (const date of new Set(plan.slots.map((s) => s.date))) {
      assert.strictEqual(plan.slots.filter((s) => s.date === date).length, 2);
    }
    assert.ok([...byDate.keys()].length > 0);
  });

  test("an existing post on a day blocks only its own platform, not the whole day", async () => {
    const id = makeClient("มีของเดิม", 10);
    const product = clientOf(id).products[0];
    const date = `${month}-05`;
    rt.createCalendarEntry(id, { entry: { date, time: "09:00", platform: "instagram", sku: product.sku, angle: "เปิดตัวสินค้า" } });
    const plan = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: PLATFORMS4 });
    const day = plan.slots.filter((s) => s.date === date);
    assert.deepStrictEqual(day.map((s) => s.platform).sort(), ["demo", "facebook", "line"], "the taken instagram slot is skipped");
    assert.ok(!day.some((s) => s.time === "09:00"), "the taken time is avoided");
    assert.ok(day.every((s) => s.sku === product.sku), "the day keeps its product (cross-posting)");
  });

  // ── planning more than once per month ───────────────────────────────────

  test("auto-plan can run again in the same month and fills what the previous run left open", async () => {
    const id = makeClient("วางแผนซ้ำ", days + 5);
    const first = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["facebook"] });
    assert.strictEqual(first.slots.length, days, "first run: one facebook post per day");
    rt.applyAutoPlan(id, { month, slots: first.slots, enforceUniqueProducts: true });

    const second = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["instagram", "line", "demo"] });
    assert.strictEqual(second.slots.length, days * 3, "second run adds the missing platforms");
    const daySku = new Map(first.slots.map((s) => [s.date, s.sku]));
    assert.ok(second.slots.every((s) => daySku.get(s.date) === s.sku), "same day = same product across platforms");
    const applied = rt.applyAutoPlan(id, { month, slots: second.slots, enforceUniqueProducts: true });
    assert.strictEqual(applied.count, days * 3);

    // The default run still has LinkedIn open for every day — it fills exactly
    // that leftover slot, nothing else.
    const third = await rt.autoPlanPreview(id, { month, onePerDay: true });
    assert.deepStrictEqual(third.platforms, PLATFORMS5);
    assert.strictEqual(third.slots.length, days, "only the LinkedIn slot per day is left");
    assert.ok(third.slots.every((s) => s.platform === "linkedin"));
    const thirdApplied = rt.applyAutoPlan(id, { month, slots: third.slots, enforceUniqueProducts: true });
    assert.strictEqual(thirdApplied.count, days);

    const fourth = await rt.autoPlanPreview(id, { month, onePerDay: true });
    assert.strictEqual(fourth.slots.length, 0, "every platform of every day now has a post");

    const all = clientOf(id).calendar;
    assert.strictEqual(all.length, days * 5);
    for (const date of new Set(all.map((e) => e.date))) {
      assert.strictEqual(all.filter((e) => e.date === date).length, 5, `${date}: 5 jobs in one day`);
      assert.strictEqual(new Set(all.filter((e) => e.date === date).map((e) => e.time)).size, 5);
      assert.ok(all.some((e) => e.date === date && e.platform === "linkedin"), `${date}: LinkedIn planned by default`);
    }
  });

  test("replacePlanned re-plans over unstarted entries and leaves finished/in-flight ones alone", async () => {
    const id = makeClient("แทนที่แผน", days + 5);
    const first = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["facebook", "demo"] });
    rt.applyAutoPlan(id, { month, slots: first.slots, enforceUniqueProducts: true });
    // day 3's demo post already went live and day 4's is running: replace must not touch them
    const live = clientOf(id).calendar.find((e) => e.date === `${month}-03` && e.platform === "demo");
    rt.updateCalendarEntry(id, live.id, { status: "published" });
    const flying = clientOf(id).calendar.find((e) => e.date === `${month}-04` && e.platform === "demo");
    rt.updateCalendarEntry(id, flying.id, { status: "in_workflow" });

    const replan = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["facebook", "demo"], replacePlanned: true });
    assert.strictEqual(replan.replacePlanned, true);
    assert.ok(replan.slots.every((s) => s.platform !== "demo" || ![`${month}-03`, `${month}-04`].includes(s.date)), "occupied live combos stay occupied");
    assert.strictEqual(replan.slots.filter((s) => s.platform === "facebook").length, days, "unstarted facebook slots are re-planned");
    const applied = rt.applyAutoPlan(id, { month, slots: replan.slots, replacePlanned: true, enforceUniqueProducts: true });
    assert.ok(applied.replaced >= days, `the unstarted posts are replaced (replaced=${applied.replaced})`);

    const all = clientOf(id).calendar;
    assert.ok(all.some((e) => e.id === live.id), "the published post survives");
    assert.ok(all.some((e) => e.id === flying.id), "the in-flight post survives");
    assert.strictEqual(all.filter((e) => e.date === `${month}-03` && e.platform === "demo").length, 1);
    assert.strictEqual(all.filter((e) => e.platform === "facebook").length, days, "still one facebook post per day");
    assert.strictEqual(all.filter((e) => e.date === `${month}-03` && e.platform === "demo" && e.status === "published").length, 1);
  });

  test("without replacePlanned the same preview leaves planned entries where they are", async () => {
    const id = makeClient("ไม่แตะของเดิม", 8);
    const first = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["facebook"] });
    rt.applyAutoPlan(id, { month, slots: first.slots, enforceUniqueProducts: true });
    const before = clientOf(id).calendar.map((e) => e.id).sort();
    const again = await rt.autoPlanPreview(id, { month, onePerDay: true, platforms: ["facebook"] });
    assert.strictEqual(again.slots.length, 0, "the combo is taken");
    const applied = rt.applyAutoPlan(id, { month, slots: again.slots.length ? again.slots : first.slots, enforceUniqueProducts: true });
    assert.strictEqual(applied.count, 0, "nothing new is written over the existing plan");
    assert.deepStrictEqual(clientOf(id).calendar.map((e) => e.id).sort(), before);
  });

  // ── apply keeps the day sane ────────────────────────────────────────────

  test("apply accepts a full multi-platform month (well past the old 31 cap)", async () => {
    const id = makeClient("เดือนเต็ม", days + 5);
    const plan = await rt.autoPlanPreview(id, { month, onePerDay: true });
    assert.ok(plan.slots.length > 31, `the test needs more than 31 slots (got ${plan.slots.length})`);
    const applied = rt.applyAutoPlan(id, { month, slots: plan.slots, enforceUniqueProducts: true });
    assert.strictEqual(applied.count, plan.slots.length);
    assert.strictEqual(clientOf(id).calendar.length, plan.slots.length);
  });

  test("apply never stacks two posts on the same platform on the same day nor the same time", async () => {
    const id = makeClient("กันชน", 8);
    const sku = clientOf(id).products[0].sku;
    const date = `${month}-07`;
    rt.createCalendarEntry(id, { entry: { date, time: "11:00", platform: "line", sku, angle: "เปิดตัวสินค้า" } });
    const applied = rt.applyAutoPlan(id, {
      month,
      slots: [
        { date, time: "12:00", platform: "line", sku, angle: "เปิดตัวสินค้า" }, // same platform that day
        { date, time: "11:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" }, // same time that day
        { date, time: "13:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" }, // fine
      ],
    });
    assert.strictEqual(applied.count, 1);
    assert.strictEqual(applied.skippedConflict, 2);
    assert.strictEqual(clientOf(id).calendar.filter((e) => e.date === date).length, 2);
  });

  test("enforceUniqueProducts: one product per day is fine across platforms, never across days", async () => {
    const id = makeClient("ไม่ซ้ำ", 8);
    const sku = clientOf(id).products[0].sku;
    const applied = rt.applyAutoPlan(id, {
      month,
      slots: [
        { date: `${month}-08`, time: "09:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" },
        { date: `${month}-08`, time: "10:00", platform: "line", sku, angle: "เปิดตัวสินค้า" }, // same day: cross-post
        { date: `${month}-09`, time: "09:00", platform: "facebook", sku, angle: "เปิดตัวสินค้า" }, // another day: repeat
      ],
      enforceUniqueProducts: true,
    });
    assert.strictEqual(applied.count, 2, "both same-day posts are written");
    assert.strictEqual(applied.skippedDuplicateProduct, 1, "the repeat on a different day is skipped");
    assert.strictEqual(clientOf(id).calendar.filter((e) => e.date === `${month}-08`).length, 2);
    assert.strictEqual(clientOf(id).calendar.filter((e) => e.date === `${month}-09`).length, 0);
  });

  test("a short product pool covers only the days it can — and deleting frees products for a re-plan", async () => {
    const id = makeClient("สินค้าน้อย", 1);
    const plan = await rt.autoPlanPreview(id, { month, onePerDay: true });
    assert.strictEqual(plan.slots.length, 5, "1 product covers 1 day × 5 platforms");
    assert.strictEqual(new Set(plan.slots.map((s) => s.sku)).size, 1);
    assert.strictEqual(plan.shortBy, days - 1);
    rt.applyAutoPlan(id, { month, slots: plan.slots, enforceUniqueProducts: true });
    const again = await rt.autoPlanPreview(id, { month, onePerDay: true });
    assert.strictEqual(again.slots.length, 0, "the single product is used up");
    rt.deleteCalendarEntriesBatch(id, { ids: clientOf(id).calendar.map((e) => e.id) });
    const refreed = await rt.autoPlanPreview(id, { month, onePerDay: true });
    assert.strictEqual(refreed.slots.length, 5, "deleting the entries frees the product for planning again");
  });

  // ── weekly cadence mode ─────────────────────────────────────────────────

  test("weekly mode rotates through the selected platforms only", async () => {
    const id = makeClient("รายสัปดาห์", 20);
    const plan = await rt.autoPlanPreview(id, { month, onePerDay: false, postsPerWeek: 6, platforms: ["facebook", "line"] });
    assert.ok(plan.slots.length > 0);
    assert.ok(plan.slots.every((s) => ["facebook", "line"].includes(s.platform)), "only the picked platforms rotate");
    assert.ok(plan.slots.every((s) => s.platform !== "tiktok"));
    assert.strictEqual(new Set(plan.slots.map((s) => `${s.date} ${s.time}`)).size, plan.slots.length, "date+time unique");
    assert.strictEqual(new Set(plan.slots.map((s) => `${s.date}|${s.platform}`)).size, plan.slots.length, "one post per platform per day");
  });

  // ── helpers ─────────────────────────────────────────────────────────────

  test("_autoPlanPlatforms validates input and _nudgeFreeTime never returns a taken time", () => {
    assert.deepStrictEqual(rt._autoPlanPlatforms(["line", "line", "tiktok", "demo", "bogus"]), ["line", "demo"]);
    assert.deepStrictEqual(rt._autoPlanPlatforms(null), ["facebook", "instagram", "line", "linkedin", "demo"]);
    assert.deepStrictEqual(rt._autoPlanPlatforms([]), ["facebook", "instagram", "line", "linkedin", "demo"]);
    const taken = new Set(["18:30", "19:00", "18:00"]);
    const moved = SocialAgencyRuntime._nudgeFreeTime(taken, "18:30");
    assert.ok(!taken.has(moved), `nudged time ${moved} must be free`);
    assert.strictEqual(SocialAgencyRuntime._nudgeFreeTime(new Set(), "18:30"), "18:30", "a free time is kept as-is");
  });

  // ── UI sources ──────────────────────────────────────────────────────────

  test("the calendar toolbar picks platforms per day and can re-plan", () => {
    const calendar = read("app", "frontend", "src", "social-agency", "CalendarTab.jsx");
    assert.match(calendar, /sa-plan-platforms/);
    assert.match(calendar, /const PLAN_PLATFORMS = \["facebook", "instagram", "line", "linkedin", "demo"\]/);
    assert.match(calendar, /const \[planPlatforms, setPlanPlatforms\] = useState\(\(\) => new Set\(PLAN_PLATFORMS\)\)/, "LinkedIn is ticked by default");
    assert.match(calendar, /\{PLAN_PLATFORMS\.map\(\(p\) => \(/, "every plan platform gets a checkbox");
    assert.match(calendar, /platforms: PLAN_PLATFORMS\.filter\(\(p\) => planPlatforms\.has\(p\)\)/);
    assert.match(calendar, /replacePlanned/);
    assert.match(calendar, /แทนที่แผนเดิม/);
    assert.match(calendar, /แพลตฟอร์ม\/วัน/);
    assert.match(calendar, /onApplyPlan\(activeClient\.id, m, slots, \{/);
    assert.match(calendar, /replacePlanned: true/);
    assert.ok(!/1 สินค้า\/วัน \(ไม่ซ้ำ\)/.test(calendar), "the one-post-a-day checkbox is gone");
  });

  test("the auto-plan preview explains multi-post days and the replace mode", () => {
    const modals = read("app", "frontend", "src", "social-agency", "modals.jsx");
    assert.match(modals, /ช่อง\/วัน/);
    assert.match(modals, /preview\?\.platforms/);
    assert.match(modals, /preview\?\.replacePlanned/);
    assert.match(modals, /โหมดแทนที่แผนเดิม/);
    assert.match(modals, /ครบทุกแพลตฟอร์มที่เลือกแล้ว/);
    assert.match(modals, /เวลาจะกระจายกันไม่ให้ชนกัน/);
    const lib = read("app", "frontend", "src", "social-agency", "lib.js");
    assert.match(lib, /demo: \{ label: "เว็บ \(Demo\)", short: "WEB"/);
    const css = read("app", "frontend", "src", "social-agency.css");
    assert.match(css, /\.sa-plan-platforms/);
    assert.match(css, /\.sa-autoplan-list \{[^}]*max-height/);
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
  if (!process.exitCode) console.log(`PASS: ${passed} auto-plan checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
