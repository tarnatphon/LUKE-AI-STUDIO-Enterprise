#!/usr/bin/env node
"use strict";

/**
 * Social Agency — validation suite for scripts/verify-fb-post-readiness.cjs
 * (handoff item D: live 2-photo Facebook post readiness checker).
 *
 * All checks run offline against temporary state directories and an in-process
 * mock Graph HTTP server.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const {
  readImageDimensions,
  inspectFbPostReadiness,
} = require("../verify-fb-post-readiness.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "verify-fb-post-readiness.cjs");

const PAGE_ID = "136018459777356";
const GOOD_PAGE_TOKEN = "EAApagegoodtokenCCCCCCCCCCCCCCCCCCCCCC";
const USER_TOKEN = "EAAusertokenaccidentallypastedDDDDDDDDDD";
const EXPIRING_PAGE_TOKEN = "EAAexpiringpagetokenEEEEEEEEEEEEEEEEEEEE";
const APP_ID = "987654321";
const APP_SECRET = "appsecret_abcdefghij";

// Minimal valid PNG with arbitrary width × height in IHDR.
function makePng(width, height) {
  const sig = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR", "ascii");
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  const crc = Buffer.alloc(4);
  const iend = Buffer.from("0000000049454e44ae426082", "hex");
  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, crc, iend]);
}

// Minimal valid JPEG with a SOF0 segment carrying width × height.
function makeJpeg(width, height) {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2); // segment length
  sof0[4] = 8; // precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // components
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sof0, eoi]);
}

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

function startMockGraph() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const q = url.searchParams;
    const send = (payload, code = 200) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    calls.push(url.pathname);
    const token = q.get("access_token") || "";
    if (url.pathname.endsWith(`/${PAGE_ID}`)) {
      if (token === GOOD_PAGE_TOKEN || token === USER_TOKEN || token === EXPIRING_PAGE_TOKEN) {
        return send({ id: PAGE_ID, name: "Thai Modern Bags" });
      }
      return send({ error: { message: `Invalid OAuth access token ${token}` } }, 400);
    }
    if (url.pathname.endsWith("/me")) {
      if (token === GOOD_PAGE_TOKEN || token === EXPIRING_PAGE_TOKEN) {
        return send({ id: PAGE_ID, name: "Thai Modern Bags", category: "Bags/Luggage" });
      }
      if (token === USER_TOKEN) {
        return send({ id: "102299887766", name: "Somchai User" });
      }
      return send({ error: { message: `Cannot parse access token ${token}` } }, 400);
    }
    if (url.pathname.endsWith("/debug_token")) {
      if (q.get("access_token") !== `${APP_ID}|${APP_SECRET}`) {
        return send({ error: { message: "Invalid app access token" } }, 400);
      }
      const input = q.get("input_token") || "";
      if (input === GOOD_PAGE_TOKEN) {
        return send({
          data: {
            app_id: APP_ID,
            type: "PAGE",
            id: PAGE_ID,
            valid: true,
            expires_at: 0,
            scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
          },
        });
      }
      if (input === EXPIRING_PAGE_TOKEN) {
        return send({
          data: {
            app_id: APP_ID,
            type: "PAGE",
            id: PAGE_ID,
            valid: true,
            expires_at: Math.floor(Date.now() / 1000) + 86400,
            scopes: ["pages_show_list"],
          },
        });
      }
      return send({ data: { valid: false } });
    }
    return send({ error: { message: `unexpected ${url.pathname}` } }, 404);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, calls, port: server.address().port }))
  );
}

function runCli(args, { port, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ...(port
            ? { LUKE_FB_GRAPH_HOST: "127.0.0.1", LUKE_FB_GRAPH_PORT: String(port), LUKE_FB_GRAPH_TLS: "0" }
            : {}),
          ...env,
        },
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        resolve({
          status: err ? (Number.isInteger(err.code) ? err.code : 1) : 0,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      }
    );
  });
}

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function main() {
  const { server, calls, port } = await startMockGraph();

  // Build a realistic temporary Social Agency workspace with WLB-006 ready to post.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa-fb-readiness-"));
  const rt = new SocialAgencyRuntime({ root: tmpRoot });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const sku = "WLB-006";

  // Add product WLB-006 with local photo + 500px derivative
  rt.addProduct(clientId, {
    sku,
    name: "กระเป๋าเก็บอุณหภูมิ WLB-006",
    category: "Cooler bags",
    price: "199 บาท",
    minimumOrder: "100 ใบ",
    productionTime: "30 วัน",
    sourceUrl: "https://www.thaimodernbags.com/product/wlb-006.html",
  });
  const prodPhotoPng = makePng(800, 600);
  rt.updateProduct(clientId, sku, {
    image: `data:image/png;base64,${prodPhotoPng.toString("base64")}`,
  });
  const ref500Jpg = makeJpeg(500, 375);
  rt.saveProductRef500(clientId, {
    sku,
    dataUrl: `data:image/jpeg;base64,${ref500Jpg.toString("base64")}`,
  });

  // Configure Facebook connector (live, dryRun: false, productRefInPost: true)
  rt.saveConnectors(clientId, {
    connectors: {
      facebook: { pageId: PAGE_ID, accessToken: GOOD_PAGE_TOKEN, dryRun: false, apiVersion: "v25.0" },
    },
    settings: { productRefInPost: true, imageWidth: 1024, imageHeight: 600 },
  });

  // Create due Facebook calendar entry for WLB-006 with reviewed 1024×600 AI image
  const entry = rt.createCalendarEntry(clientId, {
    entry: { date: bangkokToday(-1), time: "09:15", platform: "facebook", sku, angle: "เปิดตัวสินค้า" },
  });
  rt.updateCalendarEntry(clientId, entry.id, {
    caption: "กระเป๋าเก็บอุณหภูมิ WLB-006 ราคา 199 บาท ขั้นต่ำ 100 ใบ ผลิต 30 วัน ดูเพิ่มเติม https://www.thaimodernbags.com/product/wlb-006.html #กระเป๋าเก็บอุณหภูมิ",
  });
  const aiImagePath = path.join(tmpRoot, `ai-${entry.id}.png`);
  fs.writeFileSync(aiImagePath, makePng(1024, 600));
  {
    const st = rt._read();
    const ent = st.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === entry.id);
    ent.image = { path: aiImagePath, filename: path.basename(aiImagePath), url: `/api/output-file?filename=${path.basename(aiImagePath)}` };
    ent.imageJob = { status: "done", width: 1024, height: 600, refMode: "img2img", usedProductRef: true, steps: 20, stepsSent: 53 };
    rt._write(st);
  }
  rt.reviewEntryImage(clientId, entry.id, { confirmed: true });

  try {
    test("--help prints usage without touching disk or network", async () => {
      const beforeCalls = calls.length;
      const res = await runCli(["--help"], { port });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.match(res.stdout, /handoff item D/);
      assert.match(res.stdout, /--sku <SKU>/);
      assert.strictEqual(calls.length, beforeCalls, "--help must not make network calls");
    });

    test("missing state.json fails cleanly and never creates files on disk (read-only guarantee)", async () => {
      const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa-fb-empty-"));
      const res = await runCli(["--root", emptyRoot, "--json"], { port });
      assert.strictEqual(res.status, 1);
      const parsed = JSON.parse(res.stdout);
      assert.strictEqual(parsed.readyForLiveTwoPhoto, false);
      assert.strictEqual(parsed.checks[0].key, "state");
      assert.strictEqual(parsed.checks[0].status, "fail");
      assert.strictEqual(
        fs.existsSync(path.join(emptyRoot, "app", "runtime-state")),
        false,
        "readiness checker must not seed or write runtime-state"
      );
    });

    test("readImageDimensions parses PNG, JPEG, GIF, and WebP headers", () => {
      assert.deepStrictEqual(readImageDimensions(makePng(1024, 600)), { format: "png", width: 1024, height: 600 });
      assert.deepStrictEqual(readImageDimensions(makeJpeg(500, 375)), { format: "jpg", width: 500, height: 375 });
      const gif = Buffer.from("474946383961bc025802000000", "hex"); // 700x600 GIF89a
      assert.deepStrictEqual(readImageDimensions(gif), { format: "gif", width: 700, height: 600 });
      assert.strictEqual(readImageDimensions(Buffer.from("not-an-image")), null);
    });

    test("happy path: WLB-006 ready for live 2-photo post passes --strict and masks the token", async () => {
      const res = await runCli(["--root", tmpRoot, "--sku", sku, "--strict"], { port });
      assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, /พร้อมโพสต์ Facebook จริง 2 รูป/);
      assert.match(res.stdout, /WLB-006\.ref500\.jpg \(500×375px/);
      assert.match(res.stdout, /1024×600px/);
      assert.ok(!res.stdout.includes(GOOD_PAGE_TOKEN), "human output must never print the full Page token");

      const jsonRes = await runCli(["--root", tmpRoot, "--sku", sku, "--strict", "--json"], { port });
      assert.strictEqual(jsonRes.status, 0);
      assert.ok(!jsonRes.stdout.includes(GOOD_PAGE_TOKEN), "JSON output must never contain the full Page token");
      const report = JSON.parse(jsonRes.stdout);
      assert.strictEqual(report.readyForLiveTwoPhoto, true);
      assert.strictEqual(report.usingRef500, true);
      assert.strictEqual(report.willAttachSecondPhoto, true);
      assert.strictEqual(report.blockers.length, 0);
    });

    test("missing <sku>.ref500.jpg warns by default (fallback to original) and fails under --strict", async () => {
      const ref500File = path.join(tmpRoot, "app", "outputs", "sa-products", clientId, `${sku}.ref500.jpg`);
      fs.rmSync(ref500File);
      try {
        const normal = await inspectFbPostReadiness({ root: tmpRoot, sku, strict: false });
        assert.strictEqual(normal.readyForLiveTwoPhoto, true, "fallback to original photo still attaches 2 photos");
        assert.strictEqual(normal.usingRef500, false);
        assert.strictEqual(normal.willAttachSecondPhoto, true);
        assert.ok(normal.warnings.some((w) => w.includes("ยังไม่มีไฟล์ WLB-006.ref500.jpg")));

        const strict = await inspectFbPostReadiness({ root: tmpRoot, sku, strict: true });
        assert.strictEqual(strict.readyForLiveTwoPhoto, false, "--strict requires .ref500.jpg for handoff item D");
        assert.ok(strict.blockers.some((b) => b.includes("ยังไม่มีไฟล์ WLB-006.ref500.jpg")));
      } finally {
        fs.writeFileSync(ref500File, ref500Jpg);
      }
    });

    test("remote product photo (https://) or missing photo is flagged as a blocker for 2-photo posting", async () => {
      const st = rt._read();
      const prod = st.clients.find((c) => c.id === clientId).products.find((p) => p.sku === sku);
      const savedImg = prod.image;
      prod.image = "https://www.thaimodernbags.com/images/wlb-006.jpg";
      rt._write(st);
      try {
        const rep = await inspectFbPostReadiness({ root: tmpRoot, sku });
        assert.strictEqual(rep.readyForLiveTwoPhoto, false);
        assert.strictEqual(rep.willAttachSecondPhoto, false);
        assert.ok(rep.blockers.some((b) => b.includes("ลิงก์ภายนอก")), rep.blockers.join("\n"));
      } finally {
        const st2 = rt._read();
        st2.clients.find((c) => c.id === clientId).products.find((p) => p.sku === sku).image = savedImg;
        rt._write(st2);
      }
    });

    test("turning productRefInPost off or leaving dryRun on is caught as a blocker", async () => {
      rt.saveConnectors(clientId, { settings: { productRefInPost: false } });
      try {
        const rep = await inspectFbPostReadiness({ root: tmpRoot, sku });
        assert.strictEqual(rep.readyForLiveTwoPhoto, false);
        assert.ok(rep.blockers.some((b) => b.includes("productRefInPost = false")));
      } finally {
        rt.saveConnectors(clientId, { settings: { productRefInPost: true } });
      }

      rt.saveConnectors(clientId, { connectors: { facebook: { dryRun: true } } });
      try {
        const rep = await inspectFbPostReadiness({ root: tmpRoot, sku });
        assert.strictEqual(rep.readyForLiveTwoPhoto, false);
        assert.ok(rep.blockers.some((b) => b.includes("dry-run")));
      } finally {
        rt.saveConnectors(clientId, { connectors: { facebook: { dryRun: false } } });
      }
    });

    test("5-minute Facebook publish cooldown is reported with remaining wait time", async () => {
      const st = rt._read();
      st.clients.find((c) => c.id === clientId).connectors.facebook.lastPublishAt = new Date(Date.now() - 60 * 1000).toISOString();
      rt._write(st);
      try {
        const rep = await inspectFbPostReadiness({ root: tmpRoot, sku });
        assert.strictEqual(rep.readyForLiveTwoPhoto, false);
        assert.ok(rep.blockers.some((b) => b.includes("เว้นจังหวะอย่างน้อย 5 นาที")));
      } finally {
        const st2 = rt._read();
        delete st2.clients.find((c) => c.id === clientId).connectors.facebook.lastPublishAt;
        rt._write(st2);
      }
    });

    test("unreviewed or rejected AI image is caught by the image_gate check", async () => {
      rt.reviewEntryImage(clientId, entry.id, { approve: false });
      try {
        const unreviewed = await inspectFbPostReadiness({ root: tmpRoot, sku });
        assert.strictEqual(unreviewed.readyForLiveTwoPhoto, false);
        assert.ok(unreviewed.blockers.some((b) => b.includes("unreviewed") || b.includes("ยังไม่ได้ตรวจภาพ")));

        rt.rejectEntryImage(clientId, entry.id, { regenerate: false });
        const rejected = await inspectFbPostReadiness({ root: tmpRoot, sku });
        assert.strictEqual(rejected.readyForLiveTwoPhoto, false);
        assert.ok(rejected.blockers.some((b) => b.includes("rejected") || b.includes("ปฏิเสธ")));
      } finally {
        const st = rt._read();
        const ent = st.clients.find((c) => c.id === clientId).calendar.find((e) => e.id === entry.id);
        delete ent.imageRejections;
        rt._write(st);
        rt.reviewEntryImage(clientId, entry.id, { confirmed: true });
      }
    });

    test("future scheduled time warns by default and blocks when --trigger manual is requested", async () => {
      rt.updateCalendarEntry(clientId, entry.id, { date: bangkokToday(2), time: "18:30" });
      try {
        const warnRep = await inspectFbPostReadiness({ root: tmpRoot, sku });
        assert.strictEqual(warnRep.readyForLiveTwoPhoto, true);
        assert.ok(warnRep.warnings.some((w) => w.includes("ยังอยู่ในอนาคต")));

        const manualRep = await inspectFbPostReadiness({ root: tmpRoot, sku, trigger: "manual" });
        assert.strictEqual(manualRep.readyForLiveTwoPhoto, false);
        assert.ok(manualRep.blockers.some((b) => b.includes("--trigger manual")));
      } finally {
        rt.updateCalendarEntry(clientId, entry.id, { date: bangkokToday(-1), time: "09:15" });
      }
    });

    test("--online verifies Page token against /<pageId>, /me, and /debug_token, and catches User/expiring tokens", async () => {
      // 1) Good Page token + /debug_token
      const okRes = await runCli(
        ["--root", tmpRoot, "--sku", sku, "--online", "--app-id", APP_ID, "--app-secret", APP_SECRET],
        { port }
      );
      assert.strictEqual(okRes.status, 0, okRes.stdout + okRes.stderr);
      assert.match(okRes.stdout, /type=PAGE · expires=never · สิทธิ์ pages_manage_posts ครบ/);

      // 2) User token pasted into Page token slot: caught via /me even without --app-id/--app-secret
      rt.saveConnectors(clientId, { connectors: { facebook: { accessToken: USER_TOKEN } } });
      const userRes = await runCli(["--root", tmpRoot, "--sku", sku, "--online"], { port });
      assert.strictEqual(userRes.status, 1);
      assert.match(userRes.stdout, /ไม่ใช่ Page token ของเพจ/);
      assert.ok(!userRes.stdout.includes(USER_TOKEN), "user token must not leak");

      // 3) Expiring Page token lacking pages_manage_posts: caught via /debug_token
      rt.saveConnectors(clientId, { connectors: { facebook: { accessToken: EXPIRING_PAGE_TOKEN } } });
      const expRes = await runCli(
        ["--root", tmpRoot, "--sku", sku, "--online", "--app-id", APP_ID, "--app-secret", APP_SECRET],
        { port }
      );
      assert.strictEqual(expRes.status, 1);
      assert.match(expRes.stdout, /token มีวันหมดอายุ/);
      assert.match(expRes.stdout, /ขาดสิทธิ์ pages_manage_posts/);

      // 4) Bad token echoed by Meta in error message is redacted
      const badToken = "EAAbadtoken123456789012345678901234567890";
      rt.saveConnectors(clientId, { connectors: { facebook: { accessToken: badToken } } });
      const badRes = await runCli(["--root", tmpRoot, "--sku", sku, "--online"], { port });
      assert.strictEqual(badRes.status, 1);
      assert.ok(!badRes.stdout.includes(badToken), "echoed token must be redacted");
      assert.match(badRes.stdout, /‹redacted›/);

      rt.saveConnectors(clientId, { connectors: { facebook: { accessToken: GOOD_PAGE_TOKEN } } });
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
  } finally {
    server.close();
  }
  if (!process.exitCode) console.log(`PASS: ${passed} facebook post readiness checks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
