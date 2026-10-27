#!/usr/bin/env node
"use strict";

/**
 * Social Agency — ที่พักรูปสาธารณะ (public image host).
 *
 * Facebook and LinkedIn upload the bytes themselves, so an image post there has
 * no host at all. Instagram and LINE are different: both only accept a public
 * https URL and fetch the picture themselves, so the calendar could not publish
 * until somebody bought an imgbb key. These checks pin the replacement chain:
 *
 *   auto → own website → imgbb (if key) → catbox.moe → litterbox (72h)
 *
 * - every provider is optional: with no key and no website the post is uploaded
 *   through a keyless host instead of being refused;
 * - when no provider can take the picture the error names every candidate, and
 *   the publish still fails instead of quietly sending one image;
 * - an image that already has a public URL is never uploaded twice;
 * - the operator's own host receives multipart `file` (+ optional Bearer token)
 *   and answers JSON { "url": … } or a bare URL;
 * - the connector view never returns the raw token;
 * - the "ทดสอบอัปโหลด" button really pushes a file through the same chain.
 *
 * Everything is mocked: no network, no real host, no account.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const passedHolder = { n: 0 };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const REF500 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-image-host-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientId = rt.createClient({ name: "ทดสอบโฮสต์", industry: "กระเป๋า", tone: "เจ้าของแบรนด์", firstProduct: "กระเป๋าทดสอบ" }).id;
  const sku = rt._read().clients.find((c) => c.id === clientId).products[0].sku;

  const getClient = () => rt._read().clients.find((c) => c.id === clientId);
  const setSettings = (patch) => {
    const st = rt._read();
    const c = st.clients.find((x) => x.id === clientId);
    c.settings = { ...c.settings, ...patch };
    rt._write(st);
  };

  // ── mocks ────────────────────────────────────────────────────────────────
  let calls = [];
  let catboxReply = "https://files.catbox.moe/abc.png";
  let litterboxReply = "https://litter.catbox.moe/def.png";
  let ownReply = { status: 200, json: { url: "https://www.example-shop.test/uploads/photo.jpg" }, text: "" };
  let ownStatus = 200;
  const realHttps = SocialAgencyRuntime._https;
  SocialAgencyRuntime._https = async (opts = {}) => {
    const body = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body ?? ""), "utf8");
    calls.push({ host: opts.host, urlPath: opts.path, headers: opts.headers || {}, body });
    if (opts.host === "api.imgbb.com") {
      return {
        status: 200,
        json: { data: { display_url: `https://i.ibb.co/img-${calls.length}.jpg` } },
        text: "",
      };
    }
    if (opts.host === "catbox.moe") return { status: 200, json: null, text: catboxReply };
    if (opts.host === "litterbox.catbox.moe") return { status: 200, json: null, text: litterboxReply };
    if (opts.host === "www.example-shop.test") {
      return { status: ownStatus, json: ownStatus >= 300 ? { error: "upload failed" } : ownReply.json, text: ownReply.text };
    }
    if (opts.host === "graph.facebook.com") {
      const parsed = (() => { try { return JSON.parse(String(opts.body || "{}")); } catch { return {}; } })();
      if (String(opts.path || "").endsWith("/media") && opts.method === "POST") {
        return { status: 200, json: { id: parsed.is_carousel_item ? `child-${calls.length}` : `container-${calls.length}` }, text: "" };
      }
      if (String(opts.path || "").includes("fields=status_code")) return { status: 200, json: { status_code: "FINISHED" }, text: "" };
      if (String(opts.path || "").endsWith("/media_publish")) return { status: 200, json: { id: "ig-post-1" }, text: "" };
    }
    throw new Error(`unexpected https call ${opts.host}${opts.path}`);
  };

  // ── own website ─────────────────────────────────────────────────────────

  test("เว็บของเราเอง: multipart ช่อง file + Bearer token แล้วอ่าน URL กลับมา", async () => {
    rt.saveConnectors(clientId, {
      connectors: { imageHost: { provider: "own", ownUrl: "https://www.example-shop.test/luke-upload.php", ownToken: "own-secret-token" } },
    });
    calls = [];
    const out = await rt._publicHostUpload(getClient(), { buffer: PNG, filename: "ai.png" });
    assert.strictEqual(out.host, "own");
    assert.strictEqual(out.url, "https://www.example-shop.test/uploads/photo.jpg");
    assert.strictEqual(calls.length, 1, "one request: our own endpoint");
    assert.strictEqual(calls[0].host, "www.example-shop.test");
    assert.strictEqual(calls[0].urlPath, "/luke-upload.php");
    assert.strictEqual(calls[0].headers.Authorization, "Bearer own-secret-token");
    assert.match(String(calls[0].headers["Content-Type"]), /^multipart\/form-data; boundary=/);
    assert.match(calls[0].body.toString("latin1"), /name="file"; filename="ai\.png"/, "the file goes in a field called file");
    assert.ok(calls[0].body.includes(PNG), "the bytes are the image itself");
  });

  test("เว็บของเราเองตอบเป็นข้อความ URL เปล่า ๆ ก็ใช้ได้", async () => {
    ownReply = { status: 200, json: null, text: "https://www.example-shop.test/uploads/plain.png\n" };
    calls = [];
    try {
      const out = await rt._publicHostUpload(getClient(), { buffer: PNG, filename: "ai.png" });
      assert.strictEqual(out.url, "https://www.example-shop.test/uploads/plain.png");
    } finally {
      ownReply = { status: 200, json: { url: "https://www.example-shop.test/uploads/photo.jpg" }, text: "" };
    }
  });

  test("เว็บของเราเองล่ม → ข้อความบอกสาเหตุและไม่คืน URL ปลอม", async () => {
    ownStatus = 500;
    calls = [];
    try {
      await assert.rejects(
        () => rt._publicHostUpload(getClient(), { buffer: PNG, filename: "ai.png" }),
        /ที่พักสาธารณะ[\s\S]*own: upload failed/,
      );
    } finally {
      ownStatus = 200;
    }
  });

  test("บันทึกที่อยู่เว็บที่ไม่มี https ถูกปฏิเสธ", () => {
    assert.throws(
      () => rt.saveConnectors(clientId, { connectors: { imageHost: { provider: "own", ownUrl: "http://www.example-shop.test/up.php" } } }),
      /https/,
    );
  });

  // ── imgbb (kept, now optional) ──────────────────────────────────────────

  test("imgbb ยังใช้ได้เหมือนเดิมเมื่อมี key (ไม่ต้องมีเว็บตัวเอง)", async () => {
    rt.saveConnectors(clientId, { connectors: { instagram: { imgbbApiKey: "fake-imgbb-key" }, imageHost: { provider: "imgbb", ownUrl: "" } } });
    calls = [];
    const out = await rt._publicHostUpload(getClient(), { buffer: PNG, filename: "ai.png" });
    assert.strictEqual(out.host, "imgbb");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].host, "api.imgbb.com");
    assert.match(calls[0].body.toString("latin1"), /name="key"[\s\S]*fake-imgbb-key/, "the key is sent as before");
  });

  // ── keyless hosts ───────────────────────────────────────────────────────

  test("ไม่มี key และไม่มีเว็บ → ใช้ catbox.moe (ไม่ต้องมี key)", async () => {
    rt.saveConnectors(clientId, { connectors: { instagram: { imgbbApiKey: "" }, imageHost: { provider: "auto", ownUrl: "" } } });
    calls = [];
    const out = await rt._publicHostUpload(getClient(), { buffer: PNG, filename: "product.png" });
    assert.strictEqual(out.host, "catbox");
    assert.strictEqual(out.url, "https://files.catbox.moe/abc.png");
    assert.strictEqual(calls[0].host, "catbox.moe");
    assert.strictEqual(calls[0].urlPath, "/user/api.php");
    const text = calls[0].body.toString("latin1");
    assert.match(text, /name="reqtype"[\s\S]*fileupload/, "reqtype=fileupload");
    assert.match(text, /name="fileToUpload"; filename="product\.png"/, "the documented field name");
  });

  test("catbox ล่ม → ถอยไป litterbox (72 ชม.) และบอกว่าใช้ตัวไหน", async () => {
    calls = [];
    catboxReply = "blocked by cloudflare";
    try {
      const out = await rt._publicHostUpload(getClient(), { buffer: PNG, filename: "product.png" });
      assert.strictEqual(out.host, "litterbox", "second keyless host picked up the upload");
      assert.strictEqual(out.url, "https://litter.catbox.moe/def.png");
      const last = calls[calls.length - 1];
      assert.strictEqual(last.host, "litterbox.catbox.moe");
      assert.match(last.body.toString("latin1"), /name="time"[\s\S]*72h/, "temporary host asks for a retention window");
    } finally {
      catboxReply = "https://files.catbox.moe/abc.png";
    }
  });

  test("ทุกเจ้าล่ม → ข้อความบอกทุกเจ้าที่ลอง และสิ่งที่ต้องแก้", async () => {
    catboxReply = "";
    litterboxReply = "error";
    try {
      await assert.rejects(
        () => rt._publicHostUpload(getClient(), { buffer: PNG, filename: "product.png" }),
        (err) => {
          assert.match(err.message, /ที่พักสาธารณะ/, "names the concept the operator must configure");
          assert.match(err.message, /catbox/, "lists catbox");
          assert.match(err.message, /litterbox/, "lists litterbox");
          assert.match(err.message, /Connectors/, "points at the screen to fix it");
          return true;
        },
      );
    } finally {
      catboxReply = "https://files.catbox.moe/abc.png";
      litterboxReply = "https://litter.catbox.moe/def.png";
    }
  });

  test("auto: ใช้เว็บตัวเองก่อนเมื่อตั้งค่าไว้ (imgbb ไม่ถูกเรียก)", async () => {
    rt.saveConnectors(clientId, { connectors: { instagram: { imgbbApiKey: "fake-imgbb-key" }, imageHost: { provider: "auto", ownUrl: "https://www.example-shop.test/luke-upload.php" } } });
    calls = [];
    const out = await rt._publicHostUpload(getClient(), { buffer: PNG, filename: "ai.png" });
    assert.strictEqual(out.host, "own", "own website wins when configured");
    assert.ok(!calls.some((c) => c.host === "api.imgbb.com"), "imgbb is not touched");
  });

  test("auto: เว็บตัวเองล่ม → ถอยไป imgbb แทนที่จะหยุด", async () => {
    ownStatus = 503;
    calls = [];
    try {
      const out = await rt._publicHostUpload(getClient(), { buffer: PNG, filename: "ai.png" });
      assert.strictEqual(out.host, "imgbb", "falls through to the next configured provider");
      assert.ok(calls.some((c) => c.host === "api.imgbb.com"));
    } finally {
      ownStatus = 200;
    }
  });

  // ── no needless upload ──────────────────────────────────────────────────

  test("รูปที่มี publicUrl อยู่แล้วไม่ถูกอัปโหลดซ้ำ", async () => {
    calls = [];
    const out = await rt._publicImageUpload(getClient(), { image: { publicUrl: "https://cdn.example.com/ai.jpg", path: "/does/not/exist.png" } });
    assert.strictEqual(out.host, "publicUrl");
    assert.strictEqual(out.url, "https://cdn.example.com/ai.jpg");
    assert.strictEqual(calls.length, 0, "nothing leaves the machine");
  });

  // ── the test button ─────────────────────────────────────────────────────

  test("ทดสอบอัปโหลดใช้รูปสินค้าจริงและคืน URL (ไม่บันทึกค่า)", async () => {
    const photoDir = path.join(root, "app", "outputs", "sa-products", clientId);
    fs.mkdirSync(photoDir, { recursive: true });
    fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG);
    fs.writeFileSync(path.join(photoDir, `${sku}.ref500.jpg`), REF500);
    const st = rt._read();
    st.clients.find((c) => c.id === clientId).products.find((p) => p.sku === sku).image = `/sa-products/${clientId}/${sku}.png`;
    rt._write(st);
    calls = [];
    const result = await rt.testImageHost(clientId, { provider: "catbox" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.host, "catbox");
    assert.match(result.source, new RegExp(sku), "used the real product photo");
    assert.strictEqual(calls[0].host, "catbox.moe");
    assert.match(calls[0].body.toString("latin1"), new RegExp(`filename="${sku}\\.png"`), "the product photo was uploaded");
    const view = rt.getConnectorsView(clientId);
    assert.strictEqual(view.imageHost.provider, "auto", "the trial value was not saved");
  });

  test("ทดสอบอัปโหลดที่ทำไม่ได้ → ok:false พร้อมเหตุผล (ไม่โยน error ใส่ UI)", async () => {
    const result = await rt.testImageHost(clientId, { provider: "own", ownUrl: "" });
    assert.strictEqual(result.ok, false);
    assert.match(result.message, /own: ยังไม่ได้ใส่ที่อยู่เว็บอัปโหลด/);
  });

  // ── view / secrets ──────────────────────────────────────────────────────

  test("มุมมอง Connectors บอกที่พักรูปที่ใช้จริง และไม่คืน token ดิบ", () => {
    rt.saveConnectors(clientId, { connectors: { imageHost: { provider: "own", ownUrl: "https://www.example-shop.test/luke-upload.php", ownToken: "super-secret-token-1234" } } });
    const view = rt.getConnectorsView(clientId);
    assert.strictEqual(view.imageHost.provider, "own");
    assert.strictEqual(view.imageHost.ownUrl, "https://www.example-shop.test/luke-upload.php");
    assert.strictEqual(view.imageHost.hasOwnToken, true);
    assert.strictEqual(view.imageHost.ownToken, "••••1234", "masked, never the raw token");
    assert.ok(!JSON.stringify(view).includes("super-secret-token-1234"), "the token never reaches the view");
    assert.deepStrictEqual(view.imageHost.directUploadPlatforms, ["facebook", "linkedin"], "these two never need a host");
    assert.deepStrictEqual(view.imageHost.needsUrlPlatforms, ["instagram", "line"], "these two always do");
    // saving again with the masked echo must keep the stored token
    rt.saveConnectors(clientId, { connectors: { imageHost: { ownToken: "••••1234" } } });
    assert.strictEqual(rt._getSecrets(clientId).imagehost.ownToken, "super-secret-token-1234");
  });

  test("auto เลือกเจ้าที่พร้อมใช้จริงตามลำดับ", () => {
    rt.saveConnectors(clientId, { connectors: { instagram: { imgbbApiKey: "" }, imageHost: { provider: "auto", ownUrl: "" } } });
    assert.strictEqual(rt.getConnectorsView(clientId).imageHost.active, "catbox", "keyless host is the active one");
    rt.saveConnectors(clientId, { connectors: { instagram: { imgbbApiKey: "fake-imgbb-key" } } });
    assert.strictEqual(rt.getConnectorsView(clientId).imageHost.active, "imgbb", "a key beats the free host");
  });

  // ── Instagram uses the chain end to end ─────────────────────────────────

  test("Instagram: carousel 2 รูปผ่านที่พักรูปที่ตั้งไว้ (ไม่มี imgbb key เลย)", async () => {
    rt.saveConnectors(clientId, {
      connectors: { instagram: { igUserId: "1784", accessToken: "fake-ig-token", imgbbApiKey: "", dryRun: false } },
      settings: { imageHost: { provider: "own", ownUrl: "https://www.example-shop.test/luke-upload.php" } },
    });
    const st = rt._read();
    const c = st.clients.find((x) => x.id === clientId);
    if (!c.connectors) c.connectors = {};
    c.connectors.instagram = { ...(c.connectors.instagram || {}), dryRun: false, apiVersion: "v25.0" };
    const aiFile = path.join(root, "ai-ig.png");
    fs.writeFileSync(aiFile, PNG);
    const entry = rt.createCalendarEntry(clientId, { entry: { date: "2027-03-11", time: "09:00", platform: "instagram", sku, angle: "เปิดตัวสินค้า" } });
    rt.updateCalendarEntry(clientId, entry.id, { caption: "กระเป๋ารุ่นใหม่ พร้อมส่งเลยค่ะ", status: "needs_review" });
    const st2 = rt._read();
    const e = st2.clients.find((x) => x.id === clientId).calendar.find((x) => x.id === entry.id);
    e.image = { path: aiFile, filename: "ai-ig.png" };
    rt._write(st2);
    rt.reviewEntryImage(clientId, entry.id, { confirmed: true });
    calls = [];
    const out = await rt._publishEntry(getClient(), rt._read().clients.find((x) => x.id === clientId).calendar.find((x) => x.id === entry.id), { trigger: "approve" });
    assert.strictEqual(out.mode, "live");
    assert.strictEqual(out.mediaKind, "carousel", "two pictures, no imgbb key anywhere");
    assert.deepStrictEqual(out.imageHost, ["own", "own"], "both pictures came from our own website");
    assert.strictEqual(calls.filter((x) => x.host === "www.example-shop.test").length, 2, "AI image + product photo uploaded");
    assert.ok(!calls.some((x) => x.host === "api.imgbb.com"), "imgbb never called");
  });

  // ── UI sources ──────────────────────────────────────────────────────────

  test("Connectors มีหัวข้อ “ที่พักรูปสาธารณะ” พร้อมปุ่มทดสอบ และไม่มีข้อความบังคับใช้ imgbb แล้ว", () => {
    const drawers = read("app", "frontend", "src", "social-agency", "drawers.jsx");
    assert.match(drawers, /ที่พักรูปสาธารณะ \(Instagram \/ LINE\)/);
    assert.match(drawers, /<option value="own">/, "own website option");
    assert.match(drawers, /<option value="catbox">/, "keyless option");
    assert.match(drawers, /ทดสอบอัปโหลด/);
    assert.match(drawers, /runTest\("imagehost"\)/);
    assert.match(drawers, /imageHost: \{ provider: connectors\?\.imageHost\?\.provider/);
    const runtimeSrc = read("scripts", "server", "social-agency-runtime.cjs");
    assert.doesNotMatch(runtimeSrc, /ต้องมี imgbb API key เพื่ออัปโหลดรูปสินค้าคู่/, "the hard imgbb requirement is gone");
    assert.match(runtimeSrc, /const AUTO_IMAGE_HOST_ORDER = \["own", "imgbb", \.\.\.FREE_IMAGE_HOSTS\]/);
  });

  for (const [name, fn] of tests) {
    try {
      await fn();
      passedHolder.n += 1;
      console.log(`  ok - ${name}`);
    } catch (err) {
      console.error(`  FAIL - ${name}\n${err.stack || err}`);
      process.exitCode = 1;
      break;
    }
  }
  SocialAgencyRuntime._https = realHttps;
  if (!process.exitCode) console.log(`PASS: ${passedHolder.n} public image host checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
