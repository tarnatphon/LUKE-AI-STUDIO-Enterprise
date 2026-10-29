#!/usr/bin/env node
"use strict";

/**
 * Social Agency — tests for scripts/social-agency-review-images.cjs.
 *
 * The helper exists because of a queue people actually face: a month of planned
 * posts, every picture needing a human "ตรวจภาพแล้ว" before it can go live, and
 * no way to see which ones are still waiting without opening drawer after
 * drawer. What has to be true:
 *
 *   - the list names exactly the posts the runtime gate would block, with the
 *     real entry id in a command that runs as-is in zsh (no `<>`);
 *   - posts with no picture are reported separately, not as "waiting for review"
 *     (nothing can be reviewed yet);
 *   - --confirm goes through reviewEntryImage, so the gate's own rules still
 *     apply (no image / unreadable / publishing / A/B source all refuse);
 *   - confirming never changes a post's status and never publishes;
 *   - listing is read-only: the state file is byte-identical afterwards.
 *
 * Everything is local: a temp root, the real SocialAgencyRuntime, tiny PNGs.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const {
  buildReviewPlan,
  formatPlan,
  parseArgs,
  runConfirm,
  runOpen,
  statusLabel,
  REVIEW_PLATFORMS,
} = require("../social-agency-review-images.cjs");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-review-images-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientId = rt.createClient({ name: "ร้านทดสอบรีวิว", industry: "กระเป๋า", firstProduct: "กระเป๋าผ้า" }).id;
  const sku = rt._read().clients.find((c) => c.id === clientId).products[0].sku;
  const imageFile = path.join(root, "ai-1.png");
  fs.writeFileSync(imageFile, PNG);

  let slot = 0;
  const addEntry = ({ platform = "linkedin", withImage = true, file = imageFile, status = "planned" } = {}) => {
    slot += 1;
    const entry = rt.createCalendarEntry(clientId, {
      entry: { date: "2027-05-10", time: `${String(7 + slot).padStart(2, "0")}:00`, platform, sku, angle: "เปิดตัวสินค้า" },
    });
    rt.updateCalendarEntry(clientId, entry.id, { caption: "กระเป๋าผ้าใบใหญ่ งานมือคุณภาพ", status });
    if (withImage) {
      const st = rt._read();
      const e = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === entry.id);
      e.image = { path: file, filename: path.basename(file) };
      rt._write(st);
    }
    return entry.id;
  };
  const readState = () => fs.readFileSync(path.join(root, "app", "runtime-state", "social-agency", "thai-modern-bags.json"), "utf8");
  const entryOf = (id) => rt._read().clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id);
  // A callable sink: the helpers take `say` as a function, tests want the lines.
  const quiet = () => {
    const sink = (line = "") => { sink.lines.push(line); };
    sink.lines = [];
    sink.text = () => sink.lines.join("\n");
    return sink;
  };

  // ── the list ────────────────────────────────────────────────────────────

  test("ลิสต์เฉพาะรายการที่ด่านตรวจภาพยังไม่ผ่าน พร้อม id จริงและคำสั่งที่รันได้", async () => {
    for (let i = 0; i < 3; i += 1) addEntry({ withImage: true });
    const plan = buildReviewPlan(root, { clientId });
    assert.strictEqual(plan.ok, true);
    const client = plan.clients[0];
    assert.strictEqual(client.pending.length, 3, "every entry with an unreviewed image is pending");
    assert.strictEqual(plan.reviewed, 0);
    const text = formatPlan(plan);
    for (const entry of client.pending) {
      assert.ok(text.includes(`--confirm ${entry.id}`), `missing a runnable command for ${entry.id}`);
    }
    assert.doesNotMatch(text, /[<>]/, "zsh reads < as a redirect");
    assert.match(text, /ยังไม่ได้ตรวจภาพ/);
  });

  test("ยืนยันแล้วรายการหลุดจากคิว และไฟล์รูปถูกอ้างถึงให้เปิดดูก่อน", async () => {
    const plan = buildReviewPlan(root, { clientId });
    const first = plan.clients[0].pending[0];
    assert.match(formatPlan(plan), new RegExp(`รูป: .*ai-1\\.png`), "the file to look at is named");
    const say = quiet();
    await runConfirm(root, first.id, { clientId, say });
    assert.match(say.text(), new RegExp(`✓ ยืนยันภาพแล้ว: ${first.id}`));
    assert.match(say.text(), /--confirm /, "names the next post to review");
    const after = buildReviewPlan(root, { clientId }).clients[0];
    assert.ok(!after.pending.some((e) => e.id === first.id), "a confirmed post leaves the queue");
    assert.strictEqual(after.reviewed, 1);
  });

  test("ยืนยันแล้วไม่เปลี่ยนสถานะโพสต์ และไม่สร้าง run/การเผยแพร่", async () => {
    const plan = buildReviewPlan(root, { clientId });
    const target = plan.clients[0].pending[0];
    const before = entryOf(target.id);
    await runConfirm(root, target.id, { clientId, say: quiet() });
    const after = entryOf(target.id);
    assert.strictEqual(after.status, before.status, "status is untouched");
    assert.strictEqual(after.imageReview.status, "approved");
    assert.ok(after.imageReview.fingerprint, "the fingerprint is what the gate compares later");
    const runs = rt._read().runs || [];
    assert.strictEqual(runs.length, 0, "no workflow is started");
  });

  test("รายการที่ไม่มีภาพ ถูกแยกออกจากคิว (ยังตรวจไม่ได้) แต่ยังถูกทำให้เห็น", async () => {
    const bare = addEntry({ withImage: false, platform: "facebook" });
    const plan = buildReviewPlan(root, { clientId });
    const client = plan.clients[0];
    assert.ok(!client.pending.some((e) => e.id === bare), "nothing to review yet is not a pending review");
    assert.ok(client.withoutImage.some((e) => e.id === bare), "but it is still visible");
    assert.match(formatPlan(plan), /ยังไม่มีภาพ/);
    await assert.rejects(() => runConfirm(root, bare, { clientId, say: quiet() }), /ไม่มีภาพแนบให้ตรวจ/);
  });

  test("รูปเปลี่ยนหลังตรวจ → กลับเข้าคิวพร้อมบอกว่าต้องตรวจใหม่", async () => {
    const id = addEntry({ withImage: true });
    await runConfirm(root, id, { clientId, say: quiet() });
    assert.strictEqual(buildReviewPlan(root, { clientId }).clients[0].pending.some((e) => e.id === id), false);
    // A different image file behind the same entry is exactly what happens when
    // the operator presses "สร้างภาพใหม่".
    const second = path.join(root, "ai-2.png");
    fs.writeFileSync(second, Buffer.concat([PNG, Buffer.from([0])]));
    const st = rt._read();
    const e = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === id);
    e.image = { path: second, filename: "ai-2.png" };
    rt._write(st);
    const pending = buildReviewPlan(root, { clientId }).clients[0].pending.find((x) => x.id === id);
    assert.ok(pending, "a changed image needs a new review");
    assert.strictEqual(statusLabel(pending), "ภาพเปลี่ยนหลังตรวจ — ต้องตรวจใหม่");
  });

  test("--platform กรองได้ และแพลตฟอร์มที่ไม่รู้จักถูกปฏิเสธ", () => {
    const onlyFb = buildReviewPlan(root, { clientId, platform: "facebook" });
    assert.deepStrictEqual(onlyFb.platforms, ["facebook"]);
    assert.ok(onlyFb.clients[0].entries.every((e) => e.platform === "facebook"));
    const all = buildReviewPlan(root, { clientId, platform: "all" });
    assert.deepStrictEqual(all.platforms, REVIEW_PLATFORMS);
    assert.throws(() => buildReviewPlan(root, { clientId, platform: "tiktok" }), /ไม่รู้จักแพลตฟอร์ม/);
  });

  test("การลิสต์อ่านอย่างเดียว — ไฟล์สถานะไม่ถูกเขียนทับ", async () => {
    const before = readState();
    buildReviewPlan(root, { clientId });
    formatPlan(buildReviewPlan(root, { clientId }));
    assert.strictEqual(readState(), before, "listing must not write state");
  });

  test("--open เปิดไฟล์จริงให้ (ไม่เรียกโปรแกรมภายนอกเมื่อฉีดตัวเปิด)", async () => {
    const id = addEntry({ withImage: true });
    const opened = [];
    const say = quiet();
    const info = await runOpen(root, id, { clientId, say, openFile: (file) => { opened.push(file); return true; } });
    assert.deepStrictEqual(opened, [imageFile]);
    assert.match(say.text(), /ai-1\.png/);
    assert.strictEqual(info.imageAbsolutePath, imageFile);
  });

  test("--open รายการที่ไม่มีภาพ → บอกให้สร้างภาพก่อน ไม่ใช่เปิดไฟล์มั่ว", async () => {
    const bare = addEntry({ withImage: false });
    await assert.rejects(() => runOpen(root, bare, { clientId, say: quiet(), openFile: () => true }), /ยังไม่มีไฟล์ภาพ/);
  });

  test("entry id ที่ไม่มีจริง → บอกให้ใช้ --list (ไม่เดา)", async () => {
    await assert.rejects(
      () => runConfirm(root, "cal-does-not-exist", { clientId, say: quiet() }),
      /ไม่พบรายการ "cal-does-not-exist"[\s\S]*--list/,
    );
  });

  test("--platform linkedin + entry ของ facebook → บอกให้ใส่ --platform ที่ถูก", async () => {
    const fb = addEntry({ platform: "facebook" });
    await assert.rejects(
      () => runConfirm(root, fb, { clientId, platform: "linkedin", say: quiet() }),
      /--platform facebook/,
    );
  });

  test("ไฟล์สถานะยังไม่มี → exit 1 พร้อมวิธีสร้าง และไม่ไปสร้างไฟล์ให้เอง", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sa-review-empty-"));
    const plan = buildReviewPlan(empty, {});
    assert.strictEqual(plan.ok, false);
    assert.match(plan.error, /ยังไม่มีไฟล์/);
    assert.match(formatPlan(plan), /✗/);
    assert.strictEqual(fs.existsSync(path.join(empty, "app", "runtime-state", "social-agency")), false);
  });

  test("help ระบุว่าคำสั่งนี้เขียนสถานะเฉพาะตอน --confirm และห้ามมี < >", () => {
    const { main } = require("../social-agency-review-images.cjs");
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    return main(["--help"]).then((code) => {
      process.stdout.write = original;
      const help = chunks.join("");
      assert.strictEqual(code, 0);
      for (const line of help.split("\n").filter((l) => /^\s+--/.test(l))) {
        assert.doesNotMatch(line, /[<>]/, `placeholder brackets: ${line.trim()}`);
      }
      assert.match(help, /--confirm ENTRY_ID/);
      assert.match(help, /เขียนสถานะเมื่อสั่ง --confirm/);
      assert.match(help, /ไม่เผยแพร่/);
    });
  });

  test("parseArgs อ่านค่าได้ครบและปฏิเสธ flag ที่ไม่มีค่า", () => {
    const args = parseArgs(["--confirm", "cal-1", "--platform", "linkedin", "--json", "--list"]);
    assert.strictEqual(args.confirm, "cal-1");
    assert.strictEqual(args.platform, "linkedin");
    assert.strictEqual(args.json, true);
    assert.strictEqual(args.list, true);
    assert.throws(() => parseArgs(["--confirm"]), /ต้องการค่าสำหรับ --confirm/);
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
  if (!process.exitCode) console.log("PASS: image review queue checks");
}

main().catch((err) => { console.error(err); process.exit(1); });
