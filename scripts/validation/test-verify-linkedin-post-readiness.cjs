#!/usr/bin/env node
"use strict";

/**
 * Social Agency — ตัวตรวจความพร้อมก่อนโพสต์ LinkedIn จริง.
 *
 * scripts/verify-linkedin-post-readiness.cjs must be able to answer, before the
 * scheduled time, whether that entry can actually go live: token present and not
 * dry-run, version not sunset, Author URN is a personal profile, the product
 * photo for picture 2 is on disk, the AI image passed the review gate, the
 * caption fits LinkedIn's 3000 characters after little-text escaping, and the
 * button the operator plans to press is not the one that silently degrades to a
 * dry-run. --online additionally proves the token with /v2/userinfo and reserves
 * an image upload slot (no bytes, no post).
 *
 * The online half runs against a local HTTPS-free mock server (LUKE_LI_HOST /
 * LUKE_LI_PORT / LUKE_LI_TLS=0), so no LinkedIn account is needed and nothing
 * leaves the machine. Everything is read-only: the state file is never rewritten.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const {
  inspectLinkedInPostReadiness,
  formatHumanReport,
  buildInventory,
  formatInventory,
  parseArgs,
} = require("../verify-linkedin-post-readiness.cjs");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const REF500 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const TOKEN = "li-member-token-abcdef1234567890";

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-li-readiness-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientId = rt.createClient({ name: "ร้านทดสอบ LinkedIn", industry: "กระเป๋า", tone: "เจ้าของแบรนด์", firstProduct: "กระเป๋าผ้าใบใหญ่" }).id;
  const sku = rt._read().clients.find((c) => c.id === clientId).products[0].sku;

  const photoDir = path.join(root, "app", "outputs", "sa-products", clientId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG);
  fs.writeFileSync(path.join(photoDir, `${sku}.ref500.jpg`), REF500);
  const aiFile = path.join(root, "ai-linkedin.png");
  fs.writeFileSync(aiFile, PNG);

  const setImage = () => {
    const st = rt._read();
    const c = st.clients.find((x) => x.id === clientId);
    c.products.find((p) => p.sku === sku).image = `/sa-products/${clientId}/${sku}.png`;
    rt._write(st);
  };
  setImage();

  let slot = 0;
  const makeEntry = ({ time = "09:00", caption = "กระเป๋าผ้าใบใหญ่ งานมือคุณภาพ ราคา (990 บาท) #กระเป๋าผ้า" } = {}) => {
    slot += 1;
    const entry = rt.createCalendarEntry(clientId, {
      entry: { date: "2027-04-20", time: `${String(8 + slot).padStart(2, "0")}:${time.slice(3)}`, platform: "linkedin", sku, angle: "เปิดตัวสินค้า" },
    });
    rt.updateCalendarEntry(clientId, entry.id, { caption, status: "needs_review" });
    const st = rt._read();
    const e = st.clients.find((c) => c.id === clientId).calendar.find((x) => x.id === entry.id);
    e.image = { path: aiFile, filename: "ai-linkedin.png" };
    rt._write(st);
    return entry.id;
  };

  const ready = () => {
    rt.saveConnectors(clientId, {
      connectors: {
        linkedin: { accessToken: TOKEN, authorUrn: "urn:li:person:AbC123xyz", apiVersion: "202601", dryRun: false },
        instagram: { imgbbApiKey: "fake-imgbb-key" },
      },
    });
  };

  const run = (opts = {}) => inspectLinkedInPostReadiness({ root, clientId, ...opts });
  const checkOf = (report, key) => report.checks.find((c) => c.key === key);
  const statusOf = (report) => Object.fromEntries(report.checks.map((c) => [c.key, c.status]));

  // ── offline ─────────────────────────────────────────────────────────────

  test("ทุกด่านผ่าน → พร้อมโพสต์รูปคู่จริง", async () => {
    ready();
    const id = makeEntry();
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const report = await run({ entryId: id });
    const s = statusOf(report);
    assert.strictEqual(s.state, "pass");
    assert.strictEqual(s.connector, "pass");
    assert.strictEqual(s.version, "pass");
    assert.strictEqual(s.author_urn, "pass");
    assert.strictEqual(s.product_photo, "pass");
    assert.strictEqual(s.entry_media, "pass");
    assert.strictEqual(s.image_gate, "pass");
    assert.strictEqual(s.caption, "pass");
    assert.strictEqual(report.readyForLiveLinkedIn, true, JSON.stringify(report.blockers));
    assert.strictEqual(report.willAttachSecondPhoto, true);
    assert.strictEqual(report.mediaKind, "carousel");
    // the token is masked in the report, never echoed
    assert.strictEqual(report.tokenMasked, `li-m…567890`);
    assert.ok(!JSON.stringify(report).includes(TOKEN), "raw token never appears in the report");
    assert.match(formatHumanReport(report), /พร้อมโพสต์ LinkedIn จริง/);
  });

  test("แคปชันถูก escape เป็น little text ให้เห็นในผลตรวจ", async () => {
    ready();
    const id = makeEntry({ caption: "ราคา (990 บาท) #กระเป๋าผ้า" });
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const report = await run({ entryId: id });
    const caption = checkOf(report, "caption");
    assert.strictEqual(caption.status, "pass");
    assert.match(caption.detail, /\\\(990 บาท\\\)/, "brackets escaped — the post will not be cut at the first (");
    assert.match(caption.detail, /\{hashtag\|\\#\|กระเป๋าผ้า\}/, "hashtags converted to clickable links");
  });

  test("ไม่มี token → ไม่พร้อม (และไม่แอบใช้ dry-run แทน)", async () => {
    rt.saveConnectors(clientId, { connectors: { linkedin: { accessToken: "", authorUrn: "" } } });
    const report = await run();
    assert.strictEqual(checkOf(report, "connector").status, "fail");
    assert.match(checkOf(report, "connector").detail, /Member Access Token/);
    assert.strictEqual(report.readyForLiveLinkedIn, false);
  });

  test("ยังเปิด dry-run → ไม่พร้อม แม้ token ครบ", async () => {
    ready();
    const st = rt._read();
    const c = st.clients.find((x) => x.id === clientId);
    c.connectors.linkedin.dryRun = true;
    rt._write(st);
    const report = await run();
    assert.strictEqual(checkOf(report, "connector").status, "fail");
    assert.match(checkOf(report, "connector").detail, /dry-run/);
    ready();
  });

  test("URN ของเพจบริษัท → ไม่ผ่าน พร้อมบอกเหตุผลที่ทำไม่ได้", async () => {
    ready();
    rt.saveConnectors(clientId, { connectors: { linkedin: { authorUrn: "urn:li:organization:123456" } } });
    const report = await run();
    const c = checkOf(report, "author_urn");
    assert.strictEqual(c.status, "fail");
    assert.match(c.detail, /Community Management/);
    assert.strictEqual(report.readyForLiveLinkedIn, false);
    ready();
  });

  test("เวอร์ชันที่หมดอายุ → ไม่ผ่าน (ไม่ปล่อยไปเจอ 426 ตอนส่ง)", async () => {
    ready();
    const st = rt._read();
    st.clients.find((x) => x.id === clientId).connectors.linkedin.apiVersion = "202401";
    rt._write(st);
    const report = await run();
    assert.strictEqual(checkOf(report, "version").status, "fail");
    ready();
  });

  test("ไม่มีรูปสินค้าจริง → ไม่ผ่าน เพราะโพสต์รูปคู่จะถูกปฏิเสธ", async () => {
    ready();
    const st = rt._read();
    st.clients.find((x) => x.id === clientId).products.find((p) => p.sku === sku).image = "https://shop.example.com/remote.jpg";
    rt._write(st);
    const report = await run();
    const c = checkOf(report, "product_photo");
    assert.strictEqual(c.status, "fail");
    assert.strictEqual(report.willAttachSecondPhoto, false);
    setImage();
  });

  test("ยังไม่ตรวจภาพ → ไม่ผ่านด่านตรวจภาพ", async () => {
    ready();
    const id = makeEntry();
    const report = await run({ entryId: id });
    assert.strictEqual(checkOf(report, "image_gate").status, "fail");
    assert.match(checkOf(report, "image_gate").detail, /unreviewed|ตรวจภาพ/);
  });

  test("กด “รันเลยตอนนี้” บนโพสต์อนาคต → ไม่ผ่าน เพราะจะกลายเป็น dry-run", async () => {
    ready();
    const id = makeEntry();
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const report = await run({ entryId: id, trigger: "manual" });
    const c = checkOf(report, "trigger");
    assert.strictEqual(c.status, "fail");
    assert.match(c.detail, /dry-run/);
    assert.match(c.fix, /อนุมัติและเผยแพร่/);
  });

  test("รายการวิดีโอ / ที่โพสต์ไปแล้ว ถูกจับก่อนถึงเวลาส่ง", async () => {
    ready();
    const id = makeEntry();
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const report = await run({ entryId: id });
    assert.strictEqual(report.readyForLiveLinkedIn, true);

    const st = rt._read();
    const e = st.clients.find((x) => x.id === clientId).calendar.find((x) => x.id === id);
    e.video = { path: aiFile };
    rt._write(st);
    const videoReport = await run({ entryId: id });
    assert.strictEqual(checkOf(videoReport, "entry_media").status, "fail");
    assert.match(checkOf(videoReport, "entry_media").detail, /วิดีโอ/);

    const st2 = rt._read();
    const e2 = st2.clients.find((x) => x.id === clientId).calendar.find((x) => x.id === id);
    delete e2.video;
    e2.status = "published";
    e2.postId = "urn:li:share:1";
    rt._write(st2);
    const published = await run({ entryId: id });
    assert.strictEqual(checkOf(published, "entry_media").status, "fail");
    assert.match(checkOf(published, "entry_media").detail, /published/);
  });

  test("token ที่เพิ่งวาง → เตือนเรื่องอายุ 60 วันเฉพาะเมื่อใกล้ครบ", async () => {
    ready();
    const fresh = await run();
    assert.strictEqual(checkOf(fresh, "token_age").status, "pass", "a token pasted today is fine");

    const st = rt._read();
    const c = st.clients.find((x) => x.id === clientId);
    c.connectors.linkedin.tokenSavedAt = new Date(Date.now() - 52 * 86400000).toISOString();
    rt._write(st);
    const old = await run();
    assert.strictEqual(checkOf(old, "token_age").status, "warn");
    assert.match(checkOf(old, "token_age").detail, /เหลือประมาณ 8 วัน/);

    const st2 = rt._read();
    const c2 = st2.clients.find((x) => x.id === clientId);
    c2.connectors.linkedin.tokenSavedAt = new Date(Date.now() - 65 * 86400000).toISOString();
    rt._write(st2);
    const dead = await run();
    assert.strictEqual(checkOf(dead, "token_age").status, "fail");
    assert.strictEqual(dead.readyForLiveLinkedIn, false);
    ready();
  });

  test("ตัวตรวจอ่านอย่างเดียว — ไฟล์สถานะไม่ถูกเขียนทับ", async () => {
    ready();
    const id = makeEntry();
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const before = fs.readFileSync(path.join(root, "app", "runtime-state", "social-agency", "thai-modern-bags.json"), "utf8");
    await run({ entryId: id });
    const after = fs.readFileSync(path.join(root, "app", "runtime-state", "social-agency", "thai-modern-bags.json"), "utf8");
    assert.strictEqual(after, before, "no state write");
  });

  test("--strict ทำให้คำเตือนกลายเป็นไม่พร้อม", async () => {
    ready();
    const id = makeEntry({ caption: "" });
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const loose = await run({ entryId: id });
    assert.strictEqual(loose.readyForLiveLinkedIn, true, "an empty caption is only a warning");
    const strict = await run({ entryId: id, strict: true });
    assert.strictEqual(strict.readyForLiveLinkedIn, false);
  });

  // ── online against a local mock ─────────────────────────────────────────

  const requestsSeen = [];
  let userinfoSub = "AbC123xyz";
  let userinfoStatus = 200;
  let imageStatus = 200;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requestsSeen.push({ method: req.method, url: req.url, auth: req.headers.authorization, version: req.headers["linkedin-version"], body });
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url.startsWith("/v2/userinfo")) {
        if (userinfoStatus !== 200) return send(userinfoStatus, { message: "Invalid access token" });
        return send(200, { sub: userinfoSub, name: `นายทดสอบ (${userinfoSub})` });
      }
      if (req.url.startsWith("/rest/images?action=initializeUpload")) {
        if (imageStatus !== 200) return send(imageStatus, { message: "Not enough permissions to access: images.CREATE" });
        return send(200, { value: { uploadUrl: "https://upload.linkedin.example/abc?sig=1", image: "urn:li:image:C4E10AQ" } });
      }
      return send(404, { message: "not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  test("--online: token ตรงกับ URN + จองอัปโหลดรูปได้ → ผ่านทั้งสองด่าน", async () => {
    ready();
    const id = makeEntry();
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    requestsSeen.length = 0;
    userinfoSub = "AbC123xyz";
    const report = await inspectLinkedInPostReadiness({ root, clientId, entryId: id, online: true, host: "127.0.0.1", port, tls: false });
    assert.strictEqual(checkOf(report, "online_graph").status, "pass", JSON.stringify(checkOf(report, "online_graph")));
    assert.strictEqual(checkOf(report, "online_images").status, "pass");
    assert.strictEqual(report.readyForLiveLinkedIn, true);
    const urls = requestsSeen.map((r) => r.url);
    assert.ok(urls.some((u) => u.startsWith("/v2/userinfo")), "checked the token");
    assert.ok(urls.some((u) => u.startsWith("/rest/images?action=initializeUpload")), "reserved an upload slot");
    const probe = requestsSeen.find((r) => r.url.startsWith("/rest/images"));
    assert.strictEqual(probe.method, "POST");
    assert.strictEqual(probe.version, "202601", "sends the version header");
    assert.match(probe.body, /"owner":"urn:li:person:AbC123xyz"/, "owner is the author URN");
    assert.ok(!JSON.stringify(report).includes(TOKEN), "token stays out of the report");
  });

  test("--online: token เป็นของคนอื่น → ไม่ผ่าน (โพสต์จะขึ้นผิดโปรไฟล์)", async () => {
    ready();
    userinfoSub = "SomeoneElse9";
    const report = await inspectLinkedInPostReadiness({ root, clientId, online: true, host: "127.0.0.1", port, tls: false });
    const c = checkOf(report, "online_graph");
    assert.strictEqual(c.status, "fail");
    assert.match(c.detail, /urn:li:person:SomeoneElse9/);
    assert.match(c.detail, /ไม่ตรงกับ Author URN/);
    userinfoSub = "AbC123xyz";
  });

  test("--online: token ถูกปฏิเสธ (401) → ไม่ผ่าน พร้อมบอกสิทธิ์ที่ต้องมี", async () => {
    ready();
    userinfoStatus = 401;
    try {
      const report = await inspectLinkedInPostReadiness({ root, clientId, online: true, host: "127.0.0.1", port, tls: false });
      const c = checkOf(report, "online_graph");
      assert.strictEqual(c.status, "fail");
      assert.match(c.detail, /401/);
      assert.match(c.detail, /w_member_social/);
    } finally {
      userinfoStatus = 200;
    }
  });

  test("--online: ขาดสิทธิ์อัปโหลดรูป (403) → ด่านรูปไม่ผ่าน", async () => {
    ready();
    imageStatus = 403;
    try {
      const report = await inspectLinkedInPostReadiness({ root, clientId, online: true, host: "127.0.0.1", port, tls: false });
      const c = checkOf(report, "online_images");
      assert.strictEqual(c.status, "fail");
      assert.match(c.detail, /w_member_social/);
    } finally {
      imageStatus = 200;
    }
  });

  test("--online ไม่มีในพารามิเตอร์เริ่มต้น: ไม่ยิงเน็ตเลย", async () => {
    ready();
    requestsSeen.length = 0;
    const report = await run();
    assert.strictEqual(requestsSeen.length, 0, "offline by default");
    assert.ok(!report.checks.some((c) => c.key === "online_graph"));
  });

  test("CLI: exit code 0 เมื่อพร้อม และ 1 เมื่อไม่พร้อม (ไม่พิมพ์ token)", async () => {
    ready();
    const id = makeEntry();
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const script = path.join(__dirname, "..", "verify-linkedin-post-readiness.cjs");
    const runCli = (extra = []) => new Promise((resolve) => {
      execFile(process.execPath, [script, "--root", root, "--client", clientId, "--entry", id, ...extra], { timeout: 30000 }, (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
      });
    });

    // a future entry + "manual" is the trap the checker exists for
    const blocked = await runCli(["--trigger", "manual"]);
    assert.strictEqual(blocked.code, 1, "not ready → exit 1");
    assert.match(blocked.out, /ยังไม่พร้อมโพสต์ LinkedIn จริง/);

    const ok = await runCli();
    assert.strictEqual(ok.code, 0, `ready → exit 0\n${ok.out}`);
    assert.match(ok.out, /พร้อมโพสต์ LinkedIn จริง/);
    assert.ok(!ok.out.includes(TOKEN), "token never printed");
    assert.match(ok.out, /li-m…567890/, "masked token only");

    const json = await runCli(["--json"]);
    const parsed = JSON.parse(json.out);
    assert.strictEqual(parsed.readyForLiveLinkedIn, true);
    assert.ok(!json.out.includes(TOKEN), "token never printed in --json either");
  });

  // ── what the first real run actually looks like ──────────────────────────

  test("ยังไม่มี token แต่ขอ --online → บอกว่าข้าม ไม่ปล่อยเงียบ", async () => {
    const st = rt._read();
    st.clients.find((x) => x.id === clientId).connectors.linkedin.dryRun = false;
    rt._write(st);
    rt.saveConnectors(clientId, { connectors: { linkedin: { accessToken: "", authorUrn: "" } } });
    const report = await run({ online: true });
    const c = checkOf(report, "online_graph");
    assert.ok(c, "the online gate is reported even though it did not run");
    assert.strictEqual(c.status, "skip");
    assert.match(c.detail, /ข้ามการตรวจออนไลน์/);
    assert.strictEqual(report.blockers.some((b) => b.includes("ตรวจ token กับ LinkedIn")), false, "a skip is never a blocker");
    assert.match(formatHumanReport(report), /– \[online_graph\]/, "shown with its own marker, not an ✗");
    ready();
  });

  test("SKU ที่ไม่มีจริง → บอก SKU ที่มีให้เลือก", async () => {
    ready();
    const report = await run({ sku: "WLB-006" });
    const c = checkOf(report, "product_photo");
    assert.strictEqual(c.status, "fail");
    assert.match(c.detail, /SKU ที่มี: .*SKU-01-01|SKU ที่มี: /);
    assert.ok(c.detail.includes(sku), "lists the real SKU of this client");
    assert.match(c.fix, /--list/);
  });

  test("ยังไม่มีรายการ LinkedIn → บอกว่ายังไม่มี และชี้ไป --list", async () => {
    // a brand-new client: nothing in the calendar yet
    const freshId = rt.createClient({ name: "ลูกค้าใหม่ยังไม่วางแผน", industry: "กระเป๋า", tone: "เจ้าของแบรนด์", firstProduct: "กระเป๋าใหม่" }).id;
    const report = await run({ clientId: freshId });
    const c = checkOf(report, "entry_media");
    assert.strictEqual(c.status, "fail");
    assert.match(c.detail, /ยังไม่มีรายการ LinkedIn ในปฏิทินเลย|รายการ LinkedIn ที่มี/);
    assert.match(c.fix, /--list/);
    assert.strictEqual(report.mediaKind, null, "no entry is not a text-only post");
    assert.match(formatHumanReport(report), /รูปแบบที่จะส่ง: \(ยังไม่มีรายการให้ตรวจ\)/);
  });

  test("ส่ง cal-xxxx (ตัวอย่างจาก help) มาตามตรง → บอกว่าเป็นตัวอย่าง ต้องใส่ ID จริง", async () => {
    ready();
    const report = await run({ entryId: "cal-xxxx" });
    assert.match(checkOf(report, "entry_media").detail, /ตัวอย่างจากวิธีใช้งาน/);
  });

  test("--list แสดงสินค้า + รายการ LinkedIn + สถานะ connector โดยไม่ตัดสิน", async () => {
    ready();
    const id = makeEntry();
    rt.reviewEntryImage(clientId, id, { confirmed: true });
    const inv = buildInventory(root, { clientId });
    assert.strictEqual(inv.ok, true);
    const c = inv.clients[0];
    assert.strictEqual(c.id, clientId);
    assert.strictEqual(c.linkedin.configured, true);
    assert.strictEqual(c.linkedin.dryRun, false);
    assert.ok(c.products.some((p) => p.sku === sku && p.hasPhoto), "product photo state");
    const entryRow = c.entries.find((e) => e.id === id);
    assert.ok(entryRow, "the entry is listed");
    assert.strictEqual(entryRow.hasImage, true);
    assert.strictEqual(entryRow.reviewed, true);
    const text = formatInventory(inv);
    assert.match(text, /รายการ LinkedIn ในปฏิทิน/);
    assert.match(text, new RegExp(`--entry ${id}`));
    assert.ok(!text.includes(TOKEN), "no secrets in the inventory");
  });

  test("parseArgs อ่านค่าที่ตัวตรวจต้องใช้ครบ", () => {
    const args = parseArgs(["--sku", "WLB-006", "--trigger", "manual", "--online", "--strict", "--host", "127.0.0.1"]);
    assert.strictEqual(args.sku, "WLB-006");
    assert.strictEqual(args.trigger, "manual");
    assert.strictEqual(args.online, true);
    assert.strictEqual(args.strict, true);
    assert.strictEqual(args.host, "127.0.0.1");
    assert.strictEqual(args["probe-images"], true);
    assert.throws(() => parseArgs(["--sku"]), /ต้องการค่าสำหรับ --sku/);
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
  server.close();
  if (!process.exitCode) console.log(`PASS: ${tests.filter(() => true).length} LinkedIn readiness checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
