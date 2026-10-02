#!/usr/bin/env node
"use strict";

/**
 * Social Agency — entry tags (ป้ายกำกับรายการ).
 *
 * Tags are free-form labels (e.g. "concept", "pencil case") the operator
 * attaches to calendar entries from the post drawer. They ride the existing
 * PATCH /api/social-agency/calendar/:entryId endpoint, persist in runtime
 * state, show up on the calendar cards, and are searchable/filterable.
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

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-entry-tags-"));
  const rt = new SocialAgencyRuntime({ root });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const client = () => rt._read().clients.find((c) => c.id === clientId);
  const products = client().products;
  const sku = products[0].sku;

  const mk = (time, extra = {}) => {
    const e = rt.createCalendarEntry(clientId, { entry: { date: bangkokToday(365), time, platform: "facebook", sku, angle: "เปิดตัวสินค้า", ...extra } });
    rt.updateCalendarEntry(clientId, e.id, { caption: "ข้อความทดสอบ" });
    return rt.updateCalendarEntry(clientId, e.id, {});
  };

  test("_normalizeTags trims, squashes spaces, drops empties and dedupes case-insensitively", () => {
    assert.deepStrictEqual(
      SocialAgencyRuntime._normalizeTags(["  concept ", "pencil   case", "", "CONCEPT", null, " Pencil Case "]),
      ["concept", "pencil case"]
    );
  });

  test("_normalizeTags rejects a tag longer than 24 characters", () => {
    assert.throws(() => SocialAgencyRuntime._normalizeTags(["x".repeat(25)]), /ยาวเกิน 24/);
  });

  test("_normalizeTags rejects more than 8 tags", () => {
    assert.throws(() => SocialAgencyRuntime._normalizeTags(["1", "2", "3", "4", "5", "6", "7", "8", "9"]), /สูงสุด 8 ป้าย/);
  });

  test("_normalizeTags null/undefined becomes an empty list, non-list throws", () => {
    assert.deepStrictEqual(SocialAgencyRuntime._normalizeTags(null), []);
    assert.deepStrictEqual(SocialAgencyRuntime._normalizeTags(undefined), []);
    assert.throws(() => SocialAgencyRuntime._normalizeTags("concept"), /รายการข้อความ/);
  });

  test("tags persist through updateCalendarEntry and survive a reload", () => {
    const e = mk("09:00");
    const updated = rt.updateCalendarEntry(clientId, e.id, { tags: ["concept", "pencil case"] });
    assert.deepStrictEqual(updated.tags, ["concept", "pencil case"]);
    const reloaded = new SocialAgencyRuntime({ root });
    const again = reloaded._read().clients.find((c) => c.id === clientId).calendar.find((x) => x.id === e.id);
    assert.deepStrictEqual(again.tags, ["concept", "pencil case"]);
  });

  test("tags replace wholesale: sending [] clears them", () => {
    const e = mk("09:30");
    rt.updateCalendarEntry(clientId, e.id, { tags: ["concept"] });
    assert.deepStrictEqual(client().calendar.find((x) => x.id === e.id).tags, ["concept"]);
    const cleared = rt.updateCalendarEntry(clientId, e.id, { tags: [] });
    assert.deepStrictEqual(cleared.tags, []);
  });

  test("invalid tags are refused by the API boundary, not silently truncated", () => {
    const e = mk("10:00");
    assert.throws(() => rt.updateCalendarEntry(clientId, e.id, { tags: ["ยาวเกินยี่สิบสี่ตัวอักษรแน่นอน"] }), /ยาวเกิน 24/);
    assert.throws(() => rt.updateCalendarEntry(clientId, e.id, { tags: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] }), /สูงสุด 8 ป้าย/);
    const untouched = client().calendar.find((x) => x.id === e.id);
    assert.ok(!Array.isArray(untouched.tags) || untouched.tags.length === 0, "a refused patch must not leave tags behind");
  });

  test("Thai tags keep their script and are case-deduped without losing the first spelling", () => {
    const e = mk("11:00");
    const updated = rt.updateCalendarEntry(clientId, e.id, { tags: ["แบนเนอร์", "แบนเนอร์"] });
    assert.deepStrictEqual(updated.tags, ["แบนเนอร์"]);
  });

  test("listCalendar returns tags and its q filter finds entries by tag", () => {
    const a = mk("12:00");
    rt.updateCalendarEntry(clientId, a.id, { tags: ["concept"] });
    const b = mk("12:30");
    rt.updateCalendarEntry(clientId, b.id, { tags: ["pencil case"] });
    const all = rt.listCalendar(clientId, {});
    assert.ok(all.find((e) => e.id === a.id).tags.includes("concept"));
    const hit = rt.listCalendar(clientId, { q: "pencil case" }).map((e) => e.id);
    assert.ok(hit.includes(b.id) && !hit.includes(a.id), `search hit ${hit}`);
    const th = rt.listCalendar(clientId, { q: "แบนเนอร์" }).map((e) => e.id);
    assert.ok(!th.includes(a.id));
  });

  test("tags never leak into the overview slim entries", () => {
    const e = mk("13:00");
    rt.updateCalendarEntry(clientId, e.id, { tags: ["concept"] });
    const overview = rt.getOverview ? rt.getOverview(clientId) : null;
    if (overview) {
      const flat = JSON.stringify(overview);
      assert.ok(!flat.includes(`"id":"${e.id}","tags"`), "slim overview must not carry tags");
    }
  });

  test("other patch fields keep working alongside tags", () => {
    const e = mk("14:00");
    const updated = rt.updateCalendarEntry(clientId, e.id, { tags: ["concept"], brief: "สรุปใหม่" });
    assert.deepStrictEqual(updated.tags, ["concept"]);
    assert.strictEqual(updated.brief, "สรุปใหม่");
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
  if (!process.exitCode) console.log(`PASS: ${passed} entry tags checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
