#!/usr/bin/env node
"use strict";

/*
 * Social Agency — Facebook 2-photo live post readiness checker (handoff item D).
 *
 * Verifies every gate that must pass before a Facebook calendar entry goes out
 * as a real 2-photo post ([1] the AI image + [2] the real product photo scaled
 * to ≤500px on its long edge as <sku>.ref500.jpg):
 *
 *   1. state              app/runtime-state/social-agency/state.json & client
 *   2. connector          Page ID + Page Access Token + dryRun=false + 5m cooldown
 *   3. setting_two_photo  client.settings.productRefInPost !== false
 *   4. product_photo      local /sa-products/<client>/<sku>.<ext> + <sku>.ref500.jpg
 *   5. entry_media        Facebook entry, not video/published, readable AI image
 *   6. image_gate         human image review ("ตรวจภาพแล้ว") matches file fingerprint
 *   7. caption_trigger    caption length/evidence + manualEarly future-time trap
 *   8. online_graph       (opt-in via --online) /<pageId>, /me, and /debug_token
 *
 * Read-only by design: never writes state.json, connectors.json, or product
 * files, and never prints raw tokens or app secrets.
 *
 * Usage
 *   node scripts/verify-fb-post-readiness.cjs
 *   node scripts/verify-fb-post-readiness.cjs --sku WLB-006
 *   node scripts/verify-fb-post-readiness.cjs --client thai-modern-bags --entry cal-123
 *   node scripts/verify-fb-post-readiness.cjs --sku WLB-006 --strict
 *   node scripts/verify-fb-post-readiness.cjs --sku WLB-006 --online
 *   node scripts/verify-fb-post-readiness.cjs --sku WLB-006 --online --app-id ID --app-secret SECRET
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { SocialAgencyRuntime } = require("./server/social-agency-runtime.cjs");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const FB_MIN_INTERVAL_MS = 5 * 60 * 1000;
const PRODUCT_REF_POST_EDGE = 500;
const HTTP_TIMEOUT_MS = 15000;
const NEEDED_SCOPES = ["pages_manage_posts"];

const BOOLEAN_FLAGS = new Set(["help", "json", "strict", "online", "live"]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`ต้องการค่าสำหรับ --${key}`);
      out[key] = next;
      i += 1;
    } else out._.push(arg);
  }
  if (out.live) out.online = true;
  return out;
}

const HELP = `
Social Agency — ตรวจความพร้อมก่อนโพสต์ Facebook จริง 2 รูป (handoff item D)

  --sku <SKU>                  ระบุ SKU สินค้าที่ต้องการตรวจ (เช่น --sku WLB-006)
  --entry <entryId>            ระบุรายการในปฏิทินโดยตรง (เช่น --entry cal-xxxx)
  --client <clientId>          ระบุลูกค้า (ค่าเริ่มต้น: ลูกค้าที่เลือกอยู่ในแอป)
  --trigger <approve|manual>   ปุ่มที่จะกดส่ง ("approve" = อนุมัติและเผยแพร่, "manual" = รันเลยตอนนี้)
  --strict                     ต้องมีไฟล์ <sku>.ref500.jpg พร้อมแล้วและไม่มีคำเตือนใด ๆ (exit 1 ถ้าตกไปใช้รูปต้นฉบับ)
  --online                     ยิง Graph API แบบอ่านอย่างเดียวเพื่อตรวจ Page ID และชนิด token (/me)
  --app-id <id>                ใช้คู่กับ --online เพื่อตรวจ /debug_token (expires_at=0, scopes)
  --app-secret <secret>        App Secret สำหรับ /debug_token (หรือ env LUKE_FB_APP_SECRET)
  --root <path>                พาธรากของโปรเจกต์ (ค่าเริ่มต้น: โฟลเดอร์ repo นี้)
  --json                       แสดงผลเป็น JSON (token ถูกปิดบังเสมอ)
  -h, --help                   แสดงวิธีใช้งานนี้

สคริปต์นี้อ่านอย่างเดียว — ไม่แก้ไขไฟล์สถานะ ไม่เริ่มเวิร์กโฟลว์ และไม่โพสต์จริง

ตัวอย่าง
  node scripts/verify-fb-post-readiness.cjs --sku WLB-006
  node scripts/verify-fb-post-readiness.cjs --sku WLB-006 --strict
  node scripts/verify-fb-post-readiness.cjs --sku WLB-006 --online
`;

function mask(token) {
  const v = String(token || "");
  if (!v) return "(ไม่มี)";
  if (v.length <= 10) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-6)}`;
}

function redact(text, secrets = []) {
  let out = String(text == null ? "" : text);
  for (const secret of secrets.filter((s) => typeof s === "string" && s.length >= 12)) {
    out = out.split(secret).join("‹redacted›");
  }
  return out.replace(/\b(EA[A-Za-z0-9\-_]{20,}|AAAA[A-Za-z0-9\-_]{20,})\b/g, "‹redacted›");
}

function bangkokToUtcMs(dateStr, timeStr) {
  const time = String(timeStr || "18:30").slice(0, 5);
  const ms = Date.parse(`${dateStr}T${time}:00+07:00`);
  return Number.isFinite(ms) ? ms : NaN;
}

// Pure-JS binary header reader for PNG, JPEG, GIF, and WebP dimensions.
function readImageDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 10) return null;
  // PNG: 8-byte signature + IHDR chunk
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf.length >= 24) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { format: "png", width, height };
  }
  // GIF: GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf.length >= 10) {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    if (width > 0 && height > 0) return { format: "gif", width, height };
  }
  // WebP: RIFF....WEBP
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP" && buf.length >= 30) {
    const chunk = buf.slice(12, 16).toString("latin1");
    if (chunk === "VP8 " && buf.length >= 30) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { format: "webp", width, height };
    }
    if (chunk === "VP8L" && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) return { format: "webp", width, height };
    }
    if (chunk === "VP8X" && buf.length >= 30) {
      const width = buf.readUIntLE(24, 3) + 1;
      const height = buf.readUIntLE(27, 3) + 1;
      if (width > 0 && height > 0) return { format: "webp", width, height };
    }
  }
  // JPEG: scan markers until SOFn
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      while (i < buf.length && buf[i] === 0xff) i += 1;
      if (i >= buf.length) break;
      const marker = buf[i];
      i += 1;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (i + 1 >= buf.length) break;
      const segLen = buf.readUInt16BE(i);
      if (segLen < 2 || i + segLen > buf.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && segLen >= 7) {
        const height = buf.readUInt16BE(i + 3);
        const width = buf.readUInt16BE(i + 5);
        if (width > 0 && height > 0) return { format: "jpg", width, height };
      }
      i += segLen;
    }
    return { format: "jpg", width: null, height: null };
  }
  return null;
}

function graphRequest(method, urlPath) {
  const host = process.env.LUKE_FB_GRAPH_HOST || "graph.facebook.com";
  const port = process.env.LUKE_FB_GRAPH_PORT ? Number(process.env.LUKE_FB_GRAPH_PORT) : undefined;
  const useTls = process.env.LUKE_FB_GRAPH_TLS !== "0";
  const lib = useTls ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { host, port, method, path: urlPath, headers: { Accept: "application/json" }, timeout: HTTP_TIMEOUT_MS },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode || 0, json, text });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`หมดเวลารอ ${host} (${HTTP_TIMEOUT_MS / 1000} วินาที)`)));
    req.on("error", (err) => reject(new Error(`ติดต่อ ${host} ไม่สำเร็จ: ${err.message}`)));
    req.end();
  });
}

function pickCandidateEntry(client, { entryId, sku }) {
  const calendar = Array.isArray(client?.calendar) ? client.calendar : [];
  if (entryId) {
    return calendar.find((e) => e.id === entryId) || null;
  }
  const rankStatus = (s) => {
    if (s === "needs_review") return 0;
    if (s === "ready") return 1;
    if (s === "planned") return 2;
    if (s === "failed" || s === "missed" || s === "rejected") return 3;
    return 4;
  };
  const candidates = calendar
    .filter((e) => e && !e.abTestSource && (!sku || e.sku === sku))
    .sort((a, b) => {
      const fbA = a.platform === "facebook" ? 0 : 1;
      const fbB = b.platform === "facebook" ? 0 : 1;
      if (fbA !== fbB) return fbA - fbB;
      if (!sku) {
        const wlbA = a.sku === "WLB-006" ? 0 : 1;
        const wlbB = b.sku === "WLB-006" ? 0 : 1;
        if (wlbA !== wlbB) return wlbA - wlbB;
      }
      const imgA = a.image?.path ? 0 : 1;
      const imgB = b.image?.path ? 0 : 1;
      if (imgA !== imgB) return imgA - imgB;
      return rankStatus(a.status) - rankStatus(b.status);
    });
  return candidates[0] || null;
}

async function inspectFbPostReadiness(options = {}) {
  const root = path.resolve(options.root || process.env.LUKE_SA_ROOT || DEFAULT_ROOT);
  const stateDir = path.join(root, "app", "runtime-state", "social-agency");
  const stateFile = path.join(stateDir, "thai-modern-bags.json");
  const checks = [];
  const blockers = [];
  const warnings = [];
  const nextSteps = [];

  const addCheck = (key, label, status, detail, fix = "") => {
    checks.push({ key, label, status, detail, ...(fix ? { fix } : {}) });
    if (status === "fail") {
      blockers.push(`${label}: ${detail}`);
      if (fix) nextSteps.push(fix);
    } else if (status === "warn") {
      warnings.push(`${label}: ${detail}`);
      if (fix) nextSteps.push(fix);
    }
  };

  // 1. State file (read-only: never create thai-modern-bags.json if it doesn't exist)
  if (!fs.existsSync(stateFile)) {
    addCheck(
      "state",
      "ไฟล์สถานะ Social Agency",
      "fail",
      `ยังไม่มีไฟล์ ${path.relative(root, stateFile) || stateFile}`,
      "เปิดแอป LUKE AI STUDIO แล้วเข้าแท็บ Social Agency อย่างน้อย 1 ครั้งเพื่อให้ระบบสร้างสถานะเริ่มต้น"
    );
    return {
      ok: false,
      readyForLiveTwoPhoto: false,
      usingRef500: false,
      willAttachSecondPhoto: false,
      root,
      clientId: options.clientId || null,
      entryId: options.entryId || null,
      sku: options.sku || null,
      checks,
      blockers,
      warnings,
      nextSteps,
    };
  }

  let rawState = null;
  try {
    rawState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (err) {
    addCheck(
      "state",
      "ไฟล์สถานะ Social Agency",
      "fail",
      `อ่านไฟล์สถานะไม่สำเร็จ: ${err.message}`,
      "ตรวจไฟล์ app/runtime-state/social-agency/thai-modern-bags.json หรือกู้คืนจากโฟลเดอร์ backups/"
    );
    return {
      ok: false,
      readyForLiveTwoPhoto: false,
      usingRef500: false,
      willAttachSecondPhoto: false,
      root,
      clientId: options.clientId || null,
      entryId: options.entryId || null,
      sku: options.sku || null,
      checks,
      blockers,
      warnings,
      nextSteps,
    };
  }

  const rt = new SocialAgencyRuntime({ root });
  const clients = Array.isArray(rawState?.clients) ? rawState.clients : [];
  const targetClientId = options.clientId || rawState?.activeClientId || clients[0]?.id || "";
  const client = clients.find((c) => c.id === targetClientId);
  if (!client) {
    const known = clients.map((c) => `${c.id} (${c.name})`).join(", ") || "(ไม่มี)";
    addCheck(
      "state",
      "ไฟล์สถานะ Social Agency",
      "fail",
      `ไม่พบลูกค้า "${targetClientId}" — ลูกค้าที่มี: ${known}`,
      "ระบุ --client <clientId> ให้ตรงกับลูกค้าในระบบ"
    );
    return {
      ok: false,
      readyForLiveTwoPhoto: false,
      usingRef500: false,
      willAttachSecondPhoto: false,
      root,
      clientId: targetClientId,
      entryId: options.entryId || null,
      sku: options.sku || null,
      checks,
      blockers,
      warnings,
      nextSteps,
    };
  }
  rt._ensureClientShapes(rawState);
  addCheck("state", "ไฟล์สถานะ Social Agency", "pass", `ลูกค้า "${client.name}" (${client.id})`);

  // 2. Connector & Dry-Run & 5-minute cooldown
  const secrets = rt._getSecrets(client.id);
  const fbSecret = secrets.facebook || {};
  const fbMeta = (client.connectors || {}).facebook || {};
  const pageId = String(fbSecret.pageId || "").trim();
  const accessToken = String(fbSecret.accessToken || "").trim();
  const configured = rt._connectorConfigured("facebook", fbSecret);
  let apiVersion = fbMeta.apiVersion || "v25.0";
  let versionProblem = "";
  try {
    apiVersion = SocialAgencyRuntime._graphVersion(fbMeta.apiVersion);
  } catch (err) {
    versionProblem = err.message || String(err);
  }

  if (!configured) {
    const missing = [!pageId && "Page ID", !accessToken && "Page Access Token"].filter(Boolean).join(" และ ");
    addCheck(
      "connector",
      "Facebook Page Connector",
      "fail",
      `ยังไม่ได้ตั้งค่า ${missing} สำหรับลูกค้า ${client.id}`,
      "รัน node scripts/social-agency-fb-token.cjs --prompt เพื่อออก Page token แบบไม่มีวันหมดอายุ แล้วนำไปวางใน Social Agency → Connectors → Facebook Page"
    );
  } else if ( !/^\d{5,}$/.test(pageId)) {
    addCheck(
      "connector",
      "Facebook Page Connector",
      "fail",
      `Page ID "${pageId}" ไม่ใช่ตัวเลขล้วน — น่าจะวางค่าผิดช่อง`,
      "ตรวจช่อง Page ID ใน Social Agency → Connectors → Facebook Page ให้เป็นตัวเลข Page ID จริง"
    );
  } else if (versionProblem) {
    addCheck(
      "connector",
      "Facebook Page Connector",
      "fail",
      `Graph API version ใช้ไม่ได้: ${versionProblem}`,
      "เปลี่ยน Graph API version ใน Connectors เป็น v25.0"
    );
  } else if (fbMeta.dryRun !== false) {
    addCheck(
      "connector",
      "Facebook Page Connector",
      "fail",
      `Page ID ${pageId} · token ${mask(accessToken)} · แต่ยังเปิดโหมดทดลอง (dry-run = true) อยู่`,
      "ไปที่ Social Agency → Connectors → Facebook Page แล้วปิดสวิตช์ dry-run (โหมดทดลอง) ก่อนโพสต์จริง"
    );
  } else {
    const sinceLastMs = fbMeta.lastPublishAt ? Date.now() - Date.parse(fbMeta.lastPublishAt) : Infinity;
    if (Number.isFinite(sinceLastMs) && sinceLastMs >= 0 && sinceLastMs < FB_MIN_INTERVAL_MS) {
      const waitSec = Math.ceil((FB_MIN_INTERVAL_MS - sinceLastMs) / 1000);
      addCheck(
        "connector",
        "Facebook Page Connector",
        "fail",
        `เพิ่งโพสต์บนเพจ ${pageId} เมื่อ ${Math.floor(sinceLastMs / 1000)} วินาทีก่อน — ต้องเว้นจังหวะอย่างน้อย 5 นาที (รออีก ${waitSec} วินาที)`,
        `รออีกประมาณ ${waitSec} วินาทีแล้วค่อยกดโพสต์จริง`
      );
    } else {
      addCheck(
        "connector",
        "Facebook Page Connector",
        "pass",
        `Page ID ${pageId} · token ${mask(accessToken)} · Graph ${apiVersion} · ปิด dry-run แล้ว (พร้อมส่งจริง)`
      );
    }
  }

  // 3. Two-photo setting (client.settings.productRefInPost)
  const productRefInPost = client.settings?.productRefInPost !== false;
  if (!productRefInPost) {
    addCheck(
      "setting_two_photo",
      "ตั้งค่าโพสต์ Facebook 2 รูป (productRefInPost)",
      "fail",
      "ปิดอยู่ (settings.productRefInPost = false) — ระบบจะโพสต์เฉพาะภาพ AI รูปเดียว ไม่แนบรูปสินค้าจริง",
      "เปิดสวิตช์ \"แนบรูปสินค้าจริง (ย่อด้านยาว 500px…)\" ใน Social Agency → Connectors"
    );
  } else {
    addCheck(
      "setting_two_photo",
      "ตั้งค่าโพสต์ Facebook 2 รูป (productRefInPost)",
      "pass",
      "เปิดอยู่ — ภาพ AI เป็นรูปที่ 1 และรูปสินค้าจริง (ย่อด้านยาว 500px) เป็นรูปที่ 2"
    );
  }

  // Pick entry & SKU
  const entry = pickCandidateEntry(client, { entryId: options.entryId, sku: options.sku });
  const sku = options.sku || entry?.sku || (client.products || []).find((p) => p.sku === "WLB-006")?.sku || client.products?.[0]?.sku || "";
  const product = (client.products || []).find((p) => p.sku === sku) || null;

  // 4. Product photo & <sku>.ref500.jpg
  let willAttachSecondPhoto = false;
  let usingRef500 = false;
  let productPhotoMeta = null;

  if (!product) {
    const knownSkus = (client.products || []).map((p) => p.sku).slice(0, 12).join(", ") || "(ไม่มีสินค้า)";
    addCheck(
      "product_photo",
      "รูปสินค้าจริง (รูปที่ 2)",
      "fail",
      `ไม่พบสินค้า SKU "${sku || "(ไม่ได้ระบุ)"}" ในลูกค้า ${client.id} (ที่มี: ${knownSkus})`,
      "ตรวจสอบรหัส SKU ด้วย --sku <SKU> หรือเพิ่มสินค้าในแท็บ สินค้า"
    );
  } else {
    const imgField = String(product.image || "").trim();
    if (!imgField) {
      addCheck(
        "product_photo",
        "รูปสินค้าจริง (รูปที่ 2)",
        "fail",
        `สินค้า ${product.sku} (${product.name}) ยังไม่มีรูปในระบบ — โพสต์จะออกแค่รูปเดียว`,
        `ไปที่แท็บ สินค้า → คลิกที่รูปของ ${product.sku} → กด "อัปโหลดรูป" หรือ "ดึงรูปจากเว็บ (ตาม SKU)"`
      );
    } else if (!imgField.startsWith("/sa-products/")) {
      const isRemote = /^https?:\/\//i.test(imgField);
      addCheck(
        "product_photo",
        "รูปสินค้าจริง (รูปที่ 2)",
        "fail",
        isRemote
          ? `รูปของ ${product.sku} ยังเป็นลิงก์ภายนอก (${imgField.slice(0, 60)}${imgField.length > 60 ? "…" : ""}) — โพสต์จะออกแค่รูปเดียว เพราะแนบรูปที่ 2 จากลิงก์ภายนอกไม่ได้`
          : `พาธรูปของ ${product.sku} ไม่ใช่ไฟล์ในเครื่อง (${imgField})`,
        `ไปที่แท็บ สินค้า → คลิกที่รูปของ ${product.sku} → กด "ดึงรูปจากเว็บ (ตาม SKU)" หรือ "อัปโหลดรูป" เพื่อเก็บรูปเข้าเครื่อง`
      );
    } else {
      const ref = rt._resolveProductRefPostFile(client, product);
      if (ref.error || !ref.original) {
        addCheck(
          "product_photo",
          "รูปสินค้าจริง (รูปที่ 2)",
          "fail",
          `ไฟล์รูปสินค้าของ ${product.sku} ใช้ไม่ได้: ${ref.error || "ไม่พบไฟล์ต้นฉบับ"}`,
          `ไปที่แท็บ สินค้า → อัปโหลดรูปของ ${product.sku} ใหม่อีกครั้ง`
        );
      } else {
        const origBuf = fs.readFileSync(ref.original);
        const origDims = readImageDimensions(origBuf);
        const origDimStr = origDims?.width && origDims?.height ? `${origDims.width}×${origDims.height}px` : "อ่านขนาดไม่ได้";
        willAttachSecondPhoto = productRefInPost;

        if (ref.ref500) {
          const refBuf = fs.readFileSync(ref.ref500);
          const refDims = readImageDimensions(refBuf);
          const longEdge = refDims?.width && refDims?.height ? Math.max(refDims.width, refDims.height) : null;
          const refDimStr = refDims?.width && refDims?.height ? `${refDims.width}×${refDims.height}px` : `${refBuf.length} bytes`;
          productPhotoMeta = {
            sku: product.sku,
            originalPath: path.relative(root, ref.original),
            originalDims: origDims,
            ref500Path: path.relative(root, ref.ref500),
            ref500Dims: refDims,
            ref500Bytes: refBuf.length,
          };
          if (!refDims || refDims.format !== "jpg") {
            addCheck(
              "product_photo",
              "รูปสินค้าจริง (รูปที่ 2)",
              "fail",
              `ไฟล์ ${product.sku}.ref500.jpg ไม่ใช่ JPEG ที่ถูกต้อง`,
              `ลบไฟล์ ${path.relative(root, ref.ref500)} แล้วเปิดหน้าโพสต์ของ ${product.sku} ในแอป 1 ครั้งเพื่อสร้างใหม่`
            );
          } else if (longEdge && longEdge > PRODUCT_REF_POST_EDGE) {
            addCheck(
              "product_photo",
              "รูปสินค้าจริง (รูปที่ 2)",
              "warn",
              `พบ ${product.sku}.ref500.jpg (${refDimStr}) แต่ด้านยาวสุดเกิน ${PRODUCT_REF_POST_EDGE}px`,
              `เปิดหน้าโพสต์ของ ${product.sku} ใหม่หลังลบไฟล์ .ref500.jpg เพื่อให้ย่อเหลือ ≤${PRODUCT_REF_POST_EDGE}px`
            );
            usingRef500 = true;
          } else {
            usingRef500 = true;
            addCheck(
              "product_photo",
              "รูปสินค้าจริง (รูปที่ 2)",
              "pass",
              `พร้อม — ต้นฉบับ ${path.basename(ref.original)} (${origDimStr}) + ไฟล์ย่อ ${product.sku}.ref500.jpg (${refDimStr}, ${Math.max(1, Math.round(refBuf.length / 1024))} KB)`
            );
          }
        } else {
          productPhotoMeta = {
            sku: product.sku,
            originalPath: path.relative(root, ref.original),
            originalDims: origDims,
            ref500Path: null,
            staleRef500: Boolean(ref.staleRef500),
          };
          const whyMissing = ref.staleRef500
            ? `ไฟล์ ${product.sku}.ref500.jpg เก่ากว่ารูปสินค้าต้นฉบับ`
            : `ยังไม่มีไฟล์ ${product.sku}.ref500.jpg`;
          addCheck(
            "product_photo",
            "รูปสินค้าจริง (รูปที่ 2)",
            options.strict ? "fail" : "warn",
            `${whyMissing} — ตอนนี้ถ้าโพสต์เลยระบบจะแนบรูปต้นฉบับ ${path.basename(ref.original)} (${origDimStr}) แทนพร้อมหมายเหตุแจ้งเตือน`,
            `เปิดหน้าโพสต์ของ ${product.sku} ในแอป 1 ครั้ง (หรืออัปโหลด/ดึงรูปในแท็บ สินค้า) เพื่อให้เบราว์เซอร์สร้างไฟล์ ${product.sku}.ref500.jpg`
          );
        }
      }
    }
  }

  // 5. Calendar entry & AI image (photo #1)
  const expectedSize = rt._clientImageSize(client);
  let entryMeta = null;
  if (!entry) {
    addCheck(
      "entry_media",
      "รายการโพสต์และภาพ AI (รูปที่ 1)",
      "fail",
      options.entryId
        ? `ไม่พบรายการปฏิทิน ID "${options.entryId}"`
        : `ไม่พบรายการโพสต์ในปฏิทินสำหรับ SKU "${sku || "(ใด ๆ)"}"`,
      "สร้างรายการโพสต์ Facebook ในแท็บ ปฏิทิน แล้วสร้างภาพ AI และกดตรวจภาพก่อน"
    );
  } else {
    if (options.sku && entry.sku !== options.sku) {
      addCheck(
        "entry_media",
        "รายการโพสต์และภาพ AI (รูปที่ 1)",
        "fail",
        `รายการ ${entry.id} เป็นของสินค้า ${entry.sku} ไม่ตรงกับ --sku ${options.sku}`,
        `เลือกรายการของ ${options.sku} ด้วย --entry <id> หรือสร้างรายการใหม่สำหรับ ${options.sku}`
      );
    } else if (entry.platform !== "facebook") {
      addCheck(
        "entry_media",
        "รายการโพสต์และภาพ AI (รูปที่ 1)",
        "fail",
        `รายการ ${entry.id} (${entry.sku}) ตั้งแพลตฟอร์มเป็น "${entry.platform}" ไม่ใช่ "facebook"`,
        "เลือกรายการที่มีแพลตฟอร์มเป็น Facebook (--entry <id>)"
      );
    } else if (entry.inFlight || entry.status === "publishing" || entry.status === "published") {
      addCheck(
        "entry_media",
        "รายการโพสต์และภาพ AI (รูปที่ 1)",
        "fail",
        `รายการ ${entry.id} มีสถานะ "${entry.status}"${entry.postId ? ` (postId: ${entry.postId})` : ""} — เผยแพร่ไปแล้วหรือกำลังส่งอยู่ รันซ้ำไม่ได้`,
        "เลือกรายการอื่นที่ยังไม่เผยแพร่ หรือสร้างรายการใหม่ในปฏิทิน"
      );
    } else if (rt._selectPublishMedia(entry) === "video") {
      addCheck(
        "entry_media",
        "รายการโพสต์และภาพ AI (รูปที่ 1)",
        "fail",
        `รายการ ${entry.id} มีวิดีโอแนบอยู่ — Facebook จะส่งเป็นโพสต์วิดีโอเดี่ยว ไม่ใช่โพสต์รูป 2 รูป`,
        "ใช้รายการที่เป็นโพสต์ภาพ (ไม่มีไฟล์วิดีโอแนบ) สำหรับการทดสอบโพสต์ 2 รูป"
      );
    } else if (!entry.image || !entry.image.path) {
      addCheck(
        "entry_media",
        "รายการโพสต์และภาพ AI (รูปที่ 1)",
        "fail",
        `รายการ ${entry.id} (${entry.sku}) ยังไม่มีไฟล์ภาพ AI แนบอยู่`,
        "เปิดหน้ารายการในปฏิทินแล้วกด \"สร้างภาพ\" เพื่อให้ระบบสร้างภาพ AI รูปที่ 1"
      );
    } else if (!fs.existsSync(entry.image.path)) {
      addCheck(
        "entry_media",
        "รายการโพสต์และภาพ AI (รูปที่ 1)",
        "fail",
        `ไม่พบไฟล์ภาพ AI บนดิสก์ (${entry.image.path})`,
        "กด \"สร้างภาพใหม่\" ในหน้ารายการโพสต์"
      );
    } else {
      const aiBuf = fs.readFileSync(entry.image.path);
      const aiDims = readImageDimensions(aiBuf);
      const aiDimStr = aiDims?.width && aiDims?.height ? `${aiDims.width}×${aiDims.height}px` : `${aiBuf.length} bytes`;
      const job = entry.imageJob || {};
      entryMeta = {
        entryId: entry.id,
        sku: entry.sku,
        date: entry.date,
        time: entry.time,
        status: entry.status,
        aiImagePath: path.relative(root, entry.image.path),
        aiImageDims: aiDims,
        expectedSize,
        imageJob: {
          refMode: job.refMode || null,
          usedProductRef: Boolean(job.usedProductRef),
          width: job.width || null,
          height: job.height || null,
          steps: job.steps || null,
          stepsSent: job.stepsSent || null,
          warning: job.warning || "",
        },
      };
      if (job.warning) {
        addCheck(
          "entry_media",
          "รายการโพสต์และภาพ AI (รูปที่ 1)",
          "warn",
          `มีภาพ AI (${aiDimStr}) แต่ตอนสร้างภาพมีคำเตือน: ${job.warning}`,
          "กด \"สร้างภาพใหม่\" หลังตรวจว่า Image backend รองรับ img2img และมีรูปสินค้าในเครื่อง"
        );
      } else {
        addCheck(
          "entry_media",
          "รายการโพสต์และภาพ AI (รูปที่ 1)",
          "pass",
          `รายการ ${entry.id} (${entry.sku}) · ภาพ AI ${path.basename(entry.image.path)} (${aiDimStr}${job.refMode ? ` · refMode=${job.refMode}` : ""})`
        );
      }
    }
  }

  // 6. Image review gate
  if (entry && entry.platform === "facebook") {
    const gate = rt._imageGateInfo(entry);
    if (!gate.ok) {
      addCheck(
        "image_gate",
        "ด่านตรวจภาพ (Image Review Gate)",
        "fail",
        `สถานะ "${gate.status}" — ${gate.reason}`,
        gate.status === "rejected"
          ? "รูปนี้ถูกกดปฏิเสธไว้ (\"ไม่ใช่ — ห้ามใช้รูปนี้\") ต้องกด \"สร้างภาพใหม่\" แล้วติ๊กยืนยัน + กด \"ตรวจภาพแล้ว\""
          : "เปิดหน้ารายการโพสต์ ตรวจภาพ AI เทียบรูปสินค้าจริง ติ๊กช่องยืนยัน แล้วกดปุ่ม \"ตรวจภาพแล้ว\""
      );
    } else {
      addCheck(
        "image_gate",
        "ด่านตรวจภาพ (Image Review Gate)",
        "pass",
        `ตรวจภาพผ่านแล้ว (${gate.status}${gate.reviewedAt ? ` เมื่อ ${gate.reviewedAt}` : ""}) — fingerprint ตรงกับไฟล์ปัจจุบัน`
      );
    }
  }

  // 7. Caption & trigger timing (manualEarly trap)
  if (entry && entry.platform === "facebook") {
    const rawCaption = String(entry.caption || "").trim();
    const taggedCaption = rawCaption ? SocialAgencyRuntime._tagCaptionLinks(rawCaption, client.id, "facebook", entry.id) : "";
    const evidenceIssues = rawCaption && product ? rt._localEvidenceIssues(rawCaption, product) : [];
    const dueMs = bangkokToUtcMs(entry.date, entry.time);
    const isFuture = Number.isFinite(dueMs) && dueMs > Date.now();
    const wantTrigger = options.trigger || "";

    if (!rawCaption) {
      addCheck(
        "caption_and_trigger",
        "แคปชันและจังหวะการกดส่ง",
        "warn",
        `รายการ ${entry.id} ยังไม่มีแคปชัน — เมื่อกดรันระบบจะสร้างแคปชันให้อัตโนมัติ แต่ถ้าคะแนน AI Check/ไวรัลไม่ถึงเกณฑ์ (${client.settings?.threshold ?? 80}/${client.settings?.viralThreshold ?? 60}) จะหยุดรอให้กดอนุมัติอีกครั้ง`,
        "เลือกตัวอย่างแคปชันสำเร็จรูปในหน้ารายการ หรือรันเวิร์กโฟลว์ 1 รอบก่อนแล้วกด \"อนุมัติและเผยแพร่\""
      );
    } else if (taggedCaption.length > 2000) {
      addCheck(
        "caption_and_trigger",
        "แคปชันและจังหวะการกดส่ง",
        "fail",
        `แคปชันหลังติด UTM ยาว ${taggedCaption.length} ตัวอักษร (เกินเพดาน Facebook 2,000 ตัวอักษร)`,
        "ย่อแคปชันในหน้ารายการโพสต์ให้สั้นลง"
      );
    } else if (evidenceIssues.length > 0) {
      addCheck(
        "caption_and_trigger",
        "แคปชันและจังหวะการกดส่ง",
        "warn",
        `พบข้อสังเกตจากด่านหลักฐานสินค้า: ${evidenceIssues.join(" · ")}`,
        "แก้แคปชันให้ตรงกับข้อมูลสินค้า หรือใช้ปุ่ม \"อนุมัติและเผยแพร่\" เพื่อยืนยันโดยคน"
      );
    } else if (isFuture && wantTrigger === "manual") {
      addCheck(
        "caption_and_trigger",
        "แคปชันและจังหวะการกดส่ง",
        "fail",
        `เวลานัดโพสต์ (${entry.date} ${entry.time} เวลาไทย) ยังมาไม่ถึง — การกดปุ่ม "รันเลยตอนนี้" (--trigger manual) บนโพสต์อนาคตจะบังคับเข้าโหมดทดลอง (dry-run) อัตโนมัติ`,
        `หากต้องการส่งจริงทันที: เลื่อนวัน/เวลาโพสต์ของ ${entry.id} ให้ไม่เกินเวลาปัจจุบัน หรือถ้ารายการอยู่สถานะ needs_review ให้กดปุ่ม "อนุมัติและเผยแพร่"`
      );
    } else if (isFuture) {
      addCheck(
        "caption_and_trigger",
        "แคปชันและจังหวะการกดส่ง",
        "warn",
        `แคปชันพร้อม (${taggedCaption.length} ตัวอักษร) · แต่เวลานัดโพสต์ (${entry.date} ${entry.time} เวลาไทย) ยังอยู่ในอนาคต — ถ้ากด "รันเลยตอนนี้" ระบบจะซ้อมเป็น dry-run (ต้องกด "อนุมัติและเผยแพร่" หรือเลื่อนเวลาให้ไม่เกินปัจจุบันจึงจะส่งจริง)`,
        `ก่อนกด "รันเลยตอนนี้" เพื่อโพสต์จริง ให้เลื่อนเวลาโพสต์ของ ${entry.id} มาเป็นเวลาปัจจุบัน/อดีต หรือใช้ปุ่ม "อนุมัติและเผยแพร่"`
      );
    } else {
      addCheck(
        "caption_and_trigger",
        "แคปชันและจังหวะการกดส่ง",
        "pass",
        `แคปชันพร้อม (${taggedCaption.length} ตัวอักษร, UTM พร้อม) · เวลานัดโพสต์ (${entry.date} ${entry.time}) ถึงกำหนดแล้ว กดส่งจริงได้ทั้ง "รันเลยตอนนี้" และ "อนุมัติและเผยแพร่"`
      );
    }
  }

  // 8. Optional read-only online Graph API verification (--online / --live)
  if (options.online && configured && !versionProblem) {
    const appId = String(options.appId || process.env.LUKE_FB_APP_ID || "").trim();
    const appSecret = String(options.appSecret || process.env.LUKE_FB_APP_SECRET || "").trim();
    const secretsToRedact = [accessToken, appSecret].filter(Boolean);
    try {
      const pageRes = await graphRequest(
        "GET",
        `/${apiVersion}/${encodeURIComponent(pageId)}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`
      );
      if (pageRes.status >= 400 || pageRes.json?.error) {
        const msg = pageRes.json?.error?.message || `HTTP ${pageRes.status}`;
        throw new Error(redact(msg, secretsToRedact));
      }
      const meRes = await graphRequest(
        "GET",
        `/${apiVersion}/me?fields=id,name,category&access_token=${encodeURIComponent(accessToken)}`
      );
      if (meRes.status >= 400 || meRes.json?.error) {
        const msg = meRes.json?.error?.message || `HTTP ${meRes.status}`;
        throw new Error(redact(msg, secretsToRedact));
      }
      const meId = String(meRes.json?.id || "");
      const pageName = pageRes.json?.name || meRes.json?.name || pageId;
      if (meId && meId !== pageId) {
        addCheck(
          "online_graph",
          "ตรวจ Token กับ Graph API (--online)",
          "fail",
          `token ใน Connectors เป็นของ "${meRes.json?.name || meId}" (id=${meId}) ไม่ใช่ Page token ของเพจ ${pageId} — น่าจะวาง User Access Token หรือ token ผิดเพจ (ปุ่มทดสอบผ่านได้แต่โพสต์จริงจะล้ม)`,
          `รัน node scripts/social-agency-fb-token.cjs --page ${pageId} --prompt เพื่อแลก Page Access Token ของเพจนี้โดยตรง`
        );
      } else if (appId && appSecret) {
        const dbgRes = await graphRequest(
          "GET",
          `/${apiVersion}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
        );
        if (dbgRes.status >= 400 || dbgRes.json?.error) {
          const msg = dbgRes.json?.error?.message || `HTTP ${dbgRes.status}`;
          throw new Error(redact(msg, secretsToRedact));
        }
        const d = dbgRes.json?.data || {};
        const scopes = Array.isArray(d.scopes) ? d.scopes : [];
        const missingScopes = NEEDED_SCOPES.filter((s) => !scopes.includes(s));
        const Problems = [];
        if (!d.valid) Problems.push("valid=false");
        if (d.type && d.type !== "PAGE") Problems.push(`type=${d.type} (ไม่ใช่ PAGE)`);
        if (d.expires_at && Number(d.expires_at) !== 0) {
          const expIso = new Date(Number(d.expires_at) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
          Problems.push(`token มีวันหมดอายุ (${expIso})`);
        }
        if (missingScopes.length) Problems.push(`ขาดสิทธิ์ ${missingScopes.join(", ")}`);
        if (Problems.length) {
          addCheck(
            "online_graph",
            "ตรวจ Token กับ Graph API (--online)",
            "fail",
            `เพจ "${pageName}" (${pageId}) — ${Problems.join(" · ")}`,
            `รัน node scripts/social-agency-fb-token.cjs --page ${pageId} --prompt เพื่อออก Page token ใหม่ที่ expires_at=0 และมีสิทธิ์ครบ`
          );
        } else {
          addCheck(
            "online_graph",
            "ตรวจ Token กับ Graph API (--online)",
            "pass",
            `ยืนยันกับ Meta แล้ว — เพจ "${pageName}" (${pageId}) · type=PAGE · expires=never · สิทธิ์ pages_manage_posts ครบ`
          );
        }
      } else {
        addCheck(
          "online_graph",
          "ตรวจ Token กับ Graph API (--online)",
          "pass",
          `เชื่อมต่อเพจ "${pageName}" (${pageId}) สำเร็จ และ /me ยืนยันว่าเป็น token ของเพจนี้ตรงกัน (ใส่ --app-id และ --app-secret เพิ่มได้หากต้องการตรวจ expires_at/scopes ผ่าน /debug_token)`
        );
      }
    } catch (err) {
      addCheck(
        "online_graph",
        "ตรวจ Token กับ Graph API (--online)",
        "fail",
        redact(err.message || String(err), secretsToRedact),
        "ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต หรือออก Page Access Token ใหม่ด้วย node scripts/social-agency-fb-token.cjs --prompt"
      );
    }
  }

  const hasBlocker = blockers.length > 0;
  const readyForLiveTwoPhoto = !hasBlocker && willAttachSecondPhoto && (!options.strict || (usingRef500 && warnings.length === 0));

  return {
    ok: readyForLiveTwoPhoto,
    readyForLiveTwoPhoto,
    usingRef500,
    willAttachSecondPhoto,
    root,
    clientId: client.id,
    clientName: client.name,
    entryId: entry?.id || null,
    sku: sku || null,
    productPhoto: productPhotoMeta,
    entry: entryMeta,
    checks,
    blockers,
    warnings,
    nextSteps: [...new Set(nextSteps)],
  };
}

function formatHumanReport(report, opts = {}) {
  const lines = [];
  lines.push("══ ตรวจความพร้อมโพสต์ Facebook จริง 2 รูป (handoff item D) ══════════");
  lines.push(`  ลูกค้า: ${report.clientName ? `${report.clientName} (${report.clientId})` : report.clientId || "(ไม่พบ)"}`);
  lines.push(`  สินค้า (SKU): ${report.sku || "(ไม่พบ)"} · รายการปฏิทิน: ${report.entryId || "(ไม่พบ)"}`);
  lines.push("");
  for (const c of report.checks) {
    const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✗";
    lines.push(`  ${icon} [${c.key}] ${c.label}`);
    lines.push(`      ${c.detail}`);
    if (c.fix && c.status !== "pass") {
      lines.push(`      → วิธีแก้: ${c.fix}`);
    }
  }
  lines.push("");
  if (report.readyForLiveTwoPhoto) {
    lines.push(
      report.usingRef500
        ? "✅ พร้อมโพสต์ Facebook จริง 2 รูป (ภาพ AI รูปแรก + รูปสินค้า 500px รูปที่สอง)"
        : "✅ พร้อมโพสต์ Facebook จริง 2 รูป (แนบรูปสินค้าต้นฉบับเป็นรูปที่สอง — เปิดหน้าโพสต์ 1 ครั้งเพื่อให้สร้างไฟล์ .ref500.jpg)"
    );
  } else {
    lines.push(
      `❌ ยังไม่พร้อมโพสต์ Facebook จริง 2 รูป (${report.blockers.length} ข้อติดขัด${opts.strict && report.warnings.length ? ` · ${report.warnings.length} คำเตือนในโหมด --strict` : ""})`
    );
  }
  lines.push("══════════════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const report = await inspectFbPostReadiness({
    root: args.root,
    clientId: args.client,
    sku: args.sku,
    entryId: args.entry,
    trigger: args.trigger,
    strict: Boolean(args.strict),
    online: Boolean(args.online),
    appId: args["app-id"],
    appSecret: args["app-secret"],
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHumanReport(report, { strict: Boolean(args.strict) })}\n`);
  }
  return report.readyForLiveTwoPhoto ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code ?? 0; }).catch((err) => {
    process.stderr.write(`✗ ${err.message || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  readImageDimensions,
  inspectFbPostReadiness,
  formatHumanReport,
  mask,
  redact,
};
