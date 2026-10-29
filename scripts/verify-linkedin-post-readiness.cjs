#!/usr/bin/env node
"use strict";

/*
 * Social Agency — LinkedIn live-post readiness checker.
 *
 * Companion to scripts/verify-fb-post-readiness.cjs. Answers one question
 * without touching the calendar: "ถ้ารายการนี้ถึงเวลาโพสต์จริง จะผ่านทุกด่านไหม"
 *
 *   1. state           app/runtime-state/social-agency/state.json + client
 *   2. connector       Member Access Token + dryRun=false (a token on its own is not enough)
 *   3. version         Linkedin-Version is supported and not sunset
 *   4. author_urn      urn:li:person:… (a company URN cannot be posted to with this app)
 *   5. token_age       warn ~60 days after the token was pasted (LinkedIn's lifetime)
 *   6. product_photo   the real product photo (picture 2 of the pair) is on disk
 *   7. entry_media     LinkedIn entry, readable AI image, not published / in flight / video
 *   8. image_gate      human image review matches the current file
 *   9. caption         escaped length ≤ 3000, hashtag cap, little-text trap preview
 *  10. trigger         "รันเลยตอนนี้" on a future entry silently runs as dry-run
 *  11. online_graph    (opt-in --online) /v2/userinfo + image initializeUpload probe
 *
 * Read-only by design: never writes state.json or connectors.json, never posts,
 * and never prints a raw token (it is masked, and echoed tokens are redacted).
 *
 * Usage
 *   node scripts/verify-linkedin-post-readiness.cjs
 *   node scripts/verify-linkedin-post-readiness.cjs --sku WLB-006
 *   node scripts/verify-linkedin-post-readiness.cjs --entry cal-123 --trigger manual
 *   node scripts/verify-linkedin-post-readiness.cjs --sku WLB-006 --online
 *   node scripts/verify-linkedin-post-readiness.cjs --json
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { SocialAgencyRuntime, linkedInCommentary, LINKEDIN_API_VERSION } = require("./server/social-agency-runtime.cjs");
const { formatPostCaption } = require("./server/social-agency-post-copy.cjs");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const HTTP_TIMEOUT_MS = 15000;
const LINKEDIN_MAX_CHARS = 3000;
const LINKEDIN_MAX_HASHTAGS = 5;
const TOKEN_LIFETIME_DAYS = 60;
const DEFAULT_API_HOST = "api.linkedin.com";
const NEEDED_SCOPES = ["w_member_social"];

const BOOLEAN_FLAGS = new Set(["help", "json", "strict", "online", "live", "probe-images", "list"]);

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
  if (out.online) out["probe-images"] = out["probe-images"] !== false;
  return out;
}

const HELP = `
Social Agency — ตรวจความพร้อมก่อนโพสต์ LinkedIn จริง

  --list                   แสดงสินค้าและรายการ LinkedIn ที่มีอยู่ (ไม่มีคำตัดสิน ไม่มี exit 1)
  --sku SKU                ระบุ SKU สินค้าที่ต้องการตรวจ (เช่น --sku SSB-009)
  --entry ENTRY_ID         ระบุรายการในปฏิทินโดยตรง (เอา ID จริงจาก --list)
  --client CLIENT_ID       ระบุลูกค้า (ค่าเริ่มต้น: ลูกค้าที่เลือกอยู่ในแอป)
  --trigger approve|manual ปุ่มที่จะกดส่ง ("approve" = อนุมัติและเผยแพร่, "manual" = รันเลยตอนนี้)
  --strict                 คำเตือนใด ๆ ก็นับเป็นไม่พร้อม (exit 1)
  --online                 ยิง LinkedIn แบบอ่านอย่างเดียว: /v2/userinfo + ทดสอบ initializeUpload ของรูป
  --no-probe-images        ใช้คู่กับ --online เพื่อข้ามการทดสอบ initializeUpload
  --host HOST              เปลี่ยนโฮสต์ LinkedIn (สำหรับทดสอบกับ mock server)
  --root PATH              พาธรากของโปรเจกต์ (ค่าเริ่มต้น: โฟลเดอร์ repo นี้)
  --json                   แสดงผลเป็น JSON (token ถูกปิดบังเสมอ)
  -h, --help               แสดงวิธีใช้งานนี้

คำพิมพ์ใหญ่ (SKU, ENTRY_ID, CLIENT_ID) คือช่องที่ต้องแทนด้วยค่าจริง — ไม่ต้องใส่ < >
เพราะ shell (zsh) จะอ่าน < เป็นการ redirect แล้วขึ้นว่า no such file or directory

สคริปต์นี้อ่านอย่างเดียว — ไม่แก้ไขไฟล์สถานะ ไม่เริ่มเวิร์กโฟลว์ และไม่โพสต์จริง
(initializeUpload จองสิทธิ์อัปโหลดเท่านั้น ไม่อัปโหลดไบต์และไม่สร้างโพสต์)

ตัวอย่าง
  node scripts/verify-linkedin-post-readiness.cjs --list
  node scripts/verify-linkedin-post-readiness.cjs --sku SSB-009
  node scripts/verify-linkedin-post-readiness.cjs --sku SSB-009 --online
  node scripts/verify-linkedin-post-readiness.cjs --entry ENTRY_ID --trigger manual --json
  (ENTRY_ID = ค่าจริงจากคอลัมน์ --entry ในผลของ --list)
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
  return out;
}

function bangkokToUtcMs(dateStr, timeStr) {
  const time = String(timeStr || "18:30").slice(0, 5);
  const ms = Date.parse(`${dateStr}T${time}:00+07:00`);
  return Number.isFinite(ms) ? ms : NaN;
}

function daysBetween(fromMs, toMs = Date.now()) {
  return Math.floor((toMs - fromMs) / 86400000);
}

// Plain read of the same directory the app uses, so a missing file is a clear
// failure instead of an empty state being created behind the operator's back.
// The app has always stored its single state file under this legacy name.
function stateFileFor(root) {
  return path.join(root, "app", "runtime-state", "social-agency", "thai-modern-bags.json");
}

// Text that was copied out of an example rather than out of --list. The ellipsis
// matters: "cal-…" is what a person retypes from a chat message, and before this
// it produced "ไม่พบรายการปฏิทิน ID cal-…" — true, but it does not tell them the
// value was never a real id in the first place.
const PLACEHOLDER_PATTERNS = [
  /^cal-?x+$/i, // cal-xxxx
  /^cal-?…$/, // cal-… (U+2026)
  /^cal-\.{3}$/, // cal-...
  /^cal-?\*+$/,
  /^cal-?\$?\{?entry_?id\}?$/i, // cal-ENTRY_ID / cal-${ENTRY_ID}
  /^entry_?id$/i,
  /^<\(cal\).*>$|^<.*>$/, // <cal-1234> from an older help text
  /…|\.\.\./, // any remaining ellipsis
];

function looksLikePlaceholder(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(v));
}

function pickCandidateEntry(client, { entryId, sku }) {
  const calendar = Array.isArray(client?.calendar) ? client.calendar : [];
  if (entryId) return calendar.find((e) => e.id === entryId) || null;
  const rank = (s) => {
    if (s === "needs_review") return 0;
    if (s === "ready") return 1;
    if (s === "planned") return 2;
    return 3;
  };
  return (
    calendar
      .filter((e) => e && e.platform === "linkedin" && !e.abTestSource && (!sku || e.sku === sku))
      .sort((a, b) => {
        const imgA = a.image?.path ? 0 : 1;
        const imgB = b.image?.path ? 0 : 1;
        return imgA - imgB || rank(a.status) - rank(b.status);
      })[0] || null
  );
}

function linkedinRequest({ method = "GET", apiPath, token, version, body = null, host, port, useTls }) {
  const target = host || process.env.LUKE_LI_HOST || DEFAULT_API_HOST;
  const targetPort = port ?? (process.env.LUKE_LI_PORT ? Number(process.env.LUKE_LI_PORT) : undefined);
  const tls = useTls ?? process.env.LUKE_LI_TLS !== "0";
  const lib = tls ? https : http;
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Linkedin-Version": version,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
    };
    const req = lib.request({ host: target, port: targetPort, method, path: apiPath, headers, timeout: HTTP_TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* plain text or empty */ }
        resolve({ status: res.statusCode || 0, json, text, headers: res.headers || {} });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`หมดเวลารอ ${target} (${HTTP_TIMEOUT_MS / 1000} วินาที)`)));
    req.on("error", (err) => reject(new Error(`ติดต่อ ${target} ไม่สำเร็จ: ${err.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

function emptyReport(extra = {}) {
  return {
    ok: false,
    readyForLiveLinkedIn: false,
    published: false,
    publishedPostId: null,
    root: null,
    clientId: null,
    entryId: null,
    sku: null,
    checks: [],
    blockers: [],
    warnings: [],
    nextSteps: [],
    ...extra,
  };
}

// What can be passed to --sku / --entry. Without this an operator only finds out
// that "cal-xxxx" (the placeholder from the help text) does not exist, which is
// exactly what a first run looks like.
function buildInventory(root, { clientId } = {}) {
  const stateFile = stateFileFor(root);
  if (!fs.existsSync(stateFile)) {
    return { ok: false, root, error: `ยังไม่มีไฟล์ ${path.relative(root, stateFile) || stateFile}`, clients: [] };
  }
  let rawState;
  try {
    rawState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (err) {
    return { ok: false, root, error: `อ่านไฟล์สถานะไม่สำเร็จ: ${err.message}`, clients: [] };
  }
  const rt = new SocialAgencyRuntime({ root });
  rt._ensureClientShapes(rawState);
  const clients = (rawState.clients || []).filter((c) => !clientId || c.id === clientId);
  return {
    ok: true,
    root,
    activeClientId: rawState.activeClientId || null,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      linkedin: {
        configured: Boolean((c.connectors || {}).linkedin && rt._connectorConfigured("linkedin", rt._getSecrets(c.id).linkedin || {})),
        dryRun: (c.connectors || {}).linkedin?.dryRun !== false,
        authorUrn: rt._getSecrets(c.id).linkedin?.authorUrn || "",
        version: (c.connectors || {}).linkedin?.apiVersion || null,
      },
      products: (c.products || []).map((p) => {
        const ref = rt._resolveProductImageFile(c, p);
        return { sku: p.sku, name: p.name, hasPhoto: !ref.error, photoFile: ref.error ? null : path.basename(ref.file) };
      }),
      entries: (c.calendar || [])
        .filter((e) => e.platform === "linkedin")
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)))
        .map((e) => ({
          id: e.id,
          date: e.date,
          time: e.time,
          sku: e.sku,
          status: e.status,
          hasImage: Boolean(e.image && (e.image.path || e.image.buffer || e.image.publicUrl)),
          reviewed: (() => {
            try { return rt._imageGateInfo(e).ok; } catch { return false; }
          })(),
        })),
    })),
  };
}

function formatInventory(inv) {
  const lines = [];
  const SCRIPT = "node scripts/verify-linkedin-post-readiness.cjs";
  lines.push("══ รายการที่มีให้ตรวจ (LinkedIn) ═════════════════════════════════");
  if (!inv.ok) {
    lines.push(`  ✗ ${inv.error}`);
    return lines.join("\n");
  }
  if (!inv.clients.length) {
    lines.push("  (ไม่พบลูกค้า — ระบุ --client CLIENT_ID โดยใช้ id ในวงเล็บของแต่ละลูกค้า)");
    return lines.join("\n");
  }
  let commands = 0;
  let explainedEmpty = false;
  for (const c of inv.clients) {
    const li = c.linkedin;
    const withPhoto = c.products.filter((p) => p.hasPhoto).length;
    // A non-active client needs --client, otherwise the checker would look at
    // whichever client the app happens to have open.
    const clientArg = inv.activeClientId === c.id ? "" : ` --client ${c.id}`;
    lines.push(`  ลูกค้า: ${c.name} (${c.id})${inv.activeClientId === c.id ? " · กำลังใช้งาน" : ""}`);
    const liState = li.configured
      ? `ตั้งค่าแล้ว · ${li.authorUrn || "(ยังไม่มี URN)"} · ${li.dryRun ? "dry-run เปิดอยู่" : "dry-run ปิด (ส่งจริงได้)"}`
      : "ยังไม่ได้ตั้งค่า token/URN — ขอได้ด้วย node scripts/social-agency-linkedin-token.cjs --prompt --save";
    lines.push(`  LinkedIn: ${liState}`);
    lines.push(`  สินค้า (${c.products.length}${c.products.length ? ` · มีรูปในเครื่อง ${withPhoto}` : ""}):`);
    for (const p of c.products.slice(0, 20)) {
      lines.push(`    - ${p.sku} · ${p.name} · ${p.hasPhoto ? `มีรูป (${p.photoFile})` : "ยังไม่มีรูปในเครื่อง"}`);
    }
    if (c.products.length > 20) lines.push(`    … อีก ${c.products.length - 20} รายการ (ดูได้ในแท็บ สินค้า)`);
    lines.push(`  รายการ LinkedIn ในปฏิทิน (${c.entries.length}):`);
    if (!c.entries.length) {
      // Explain the path once; repeating it for every empty client is noise.
      if (!explainedEmpty) {
        explainedEmpty = true;
        lines.push("    ยังไม่มีรายการ — สร้างก่อนแล้วค่อยกลับมาตรวจ:");
        lines.push("    1) เปิดแอป → แท็บ ปฏิทิน → เลือกเดือน");
        lines.push("    2) กด “วางแผนอัตโนมัติทั้งเดือน” (LinkedIn ติ๊กไว้แล้ว) หรือกด “เพิ่มโพสต์” แล้วเลือกแพลตฟอร์ม LinkedIn");
        lines.push("    3) สร้างภาพ AI แล้วกด “ตรวจภาพแล้ว” ในหน้ารายการ");
        lines.push(`    4) กลับมารัน: ${SCRIPT} --list`);
      } else {
        lines.push("    ยังไม่มีรายการ LinkedIn (วิธีสร้างดูด้านบน)");
      }
    } else {
      for (const e of c.entries) {
        lines.push(`    - ${e.id} · ${e.date} ${e.time} · ${e.sku} · ${e.status} · ${e.hasImage ? (e.reviewed ? "มีภาพ (ตรวจแล้ว)" : "มีภาพ (ยังไม่ตรวจ)") : "ยังไม่มีภาพ"}`);
        lines.push(`      → ${SCRIPT}${clientArg} --entry ${e.id}`);
        commands += 1;
      }
    }
    lines.push("");
  }
  if (commands) {
    lines.push("คัดลอกบรรทัด “→” ไปรันได้เลย (ใส่ --online ต่อท้ายถ้าต้องการตรวจกับ LinkedIn จริง)");
  } else {
    lines.push(`ตรวจรายการใดรายการหนึ่ง (หลังสร้างเสร็จ): ${SCRIPT} --entry ENTRY_ID`);
  }
  lines.push("══════════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

async function inspectLinkedInPostReadiness(options = {}) {
  const root = path.resolve(options.root || process.env.LUKE_SA_ROOT || DEFAULT_ROOT);
  const stateFile = stateFileFor(root);
  const checks = [];
  const blockers = [];
  const warnings = [];
  const nextSteps = [];
  // status: pass | warn | fail | skip
  // "skip" means the gate was deliberately not run (e.g. --online without a
  // token). It is reported so nobody mistakes silence for a pass, but it never
  // counts as a blocker or a warning.
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

  if (!fs.existsSync(stateFile)) {
    addCheck(
      "state",
      "ไฟล์สถานะ Social Agency",
      "fail",
      `ยังไม่มีไฟล์ ${path.relative(root, stateFile) || stateFile}`,
      "เปิดแอป LUKE AI STUDIO แล้วเข้าแท็บ Social Agency อย่างน้อย 1 ครั้งเพื่อให้ระบบสร้างสถานะเริ่มต้น",
    );
    return emptyReport({ root, clientId: options.clientId || null, entryId: options.entryId || null, sku: options.sku || null, checks, blockers, warnings, nextSteps });
  }

  let rawState;
  try {
    rawState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (err) {
    addCheck("state", "ไฟล์สถานะ Social Agency", "fail", `อ่านไฟล์สถานะไม่สำเร็จ: ${err.message}`, "ตรวจไฟล์ app/runtime-state/social-agency/thai-modern-bags.json หรือกู้คืนจากโฟลเดอร์ backups/");
    return emptyReport({ root, clientId: options.clientId || null, entryId: options.entryId || null, sku: options.sku || null, checks, blockers, warnings, nextSteps });
  }

  const rt = new SocialAgencyRuntime({ root });
  const clients = Array.isArray(rawState?.clients) ? rawState.clients : [];
  const targetClientId = options.clientId || rawState?.activeClientId || clients[0]?.id || "";
  const client = clients.find((c) => c.id === targetClientId);
  if (!client) {
    const known = clients.map((c) => `${c.id} (${c.name})`).join(", ") || "(ไม่มี)";
    addCheck("state", "ไฟล์สถานะ Social Agency", "fail", `ไม่พบลูกค้า "${targetClientId}" — ลูกค้าที่มี: ${known}`, "ระบุ --client CLIENT_ID ให้ตรงกับ id ที่แสดงใน --list");
    return emptyReport({ root, clientId: targetClientId, entryId: options.entryId || null, sku: options.sku || null, checks, blockers, warnings, nextSteps });
  }
  rt._ensureClientShapes(rawState);
  addCheck("state", "ไฟล์สถานะ Social Agency", "pass", `ลูกค้า "${client.name}" (${client.id})`);

  // ── 2. connector ────────────────────────────────────────────────────────
  const secrets = rt._getSecrets(client.id);
  const liSecret = secrets.linkedin || {};
  const meta = (client.connectors || {}).linkedin || {};
  const accessToken = String(liSecret.accessToken || "").trim();
  const authorUrn = String(liSecret.authorUrn || "").trim();
  const configured = rt._connectorConfigured("linkedin", liSecret);
  if (!configured) {
    const missing = [!accessToken && "Member Access Token", !authorUrn && "Author URN"].filter(Boolean).join(" และ ");
    addCheck(
      "connector",
      "LinkedIn connector",
      "fail",
      `ยังไม่ได้ตั้งค่า ${missing} สำหรับลูกค้า ${client.id}`,
      "ขอ token ด้วยคำสั่งเดียว: node scripts/social-agency-linkedin-token.cjs --prompt --save (หรือ Social Agency → Connectors → LinkedIn: ใส่ Member Access Token แล้วกด “ทดสอบและดึง URN”)",
    );
  } else if (meta.dryRun !== false) {
    addCheck(
      "connector",
      "LinkedIn connector",
      "fail",
      `token ${mask(accessToken)} · author ${authorUrn} · แต่ยังเปิดโหมดทดลอง (dry-run = true) อยู่`,
      "ปิดสวิตช์ “โหมดทดลอง (dry-run)” ของ LinkedIn ใน Connectors ก่อนโพสต์จริง",
    );
  } else {
    addCheck("connector", "LinkedIn connector", "pass", `token ${mask(accessToken)} · author ${authorUrn} · ปิด dry-run แล้ว (พร้อมส่งจริง)`);
  }

  // ── 3. version ──────────────────────────────────────────────────────────
  const version = meta.apiVersion || LINKEDIN_API_VERSION;
  let versionOk = false;
  try {
    SocialAgencyRuntime._linkedInVersion(version);
    versionOk = true;
  } catch (err) {
    addCheck("version", "Linkedin-Version", "fail", String(err.message || err), "เปลี่ยน Linkedin-Version ใน Connectors เป็น 202601 / 202604 / 202609");
  }
  if (versionOk) {
    const view = rt.getConnectorsView(client.id);
    const expiresAt = view?.linkedin?.versionExpiresAt || "";
    const daysLeft = expiresAt ? Math.ceil((Date.parse(`${expiresAt}T00:00:00Z`) - Date.now()) / 86400000) : null;
    if (daysLeft !== null && daysLeft <= 0) {
      addCheck("version", "Linkedin-Version", "fail", `${version} หมดอายุแล้ว (${expiresAt}) — LinkedIn จะปฏิเสธทุกคำขอ`, "เปลี่ยน Linkedin-Version เป็นเวอร์ชันใหม่ใน Connectors");
    } else if (daysLeft !== null && daysLeft <= 45) {
      addCheck("version", "Linkedin-Version", "warn", `${version} จะหมดอายุใน ${daysLeft} วัน (${expiresAt})`, `เปลี่ยน Linkedin-Version ก่อน ${expiresAt}`);
    } else {
      addCheck("version", "Linkedin-Version", "pass", `${version}${expiresAt ? ` · ใช้ได้ถึง ${expiresAt}` : ""}`);
    }
  }

  // ── 4. author URN ───────────────────────────────────────────────────────
  if (authorUrn) {
    if (/^urn:li:person:[A-Za-z0-9_-]{3,}$/.test(authorUrn)) {
      addCheck("author_urn", "Author URN", "pass", `${authorUrn} (โปรไฟล์ส่วนตัว)`);
    } else if (/^urn:li:organization:/.test(authorUrn)) {
      addCheck(
        "author_urn",
        "Author URN",
        "fail",
        `${authorUrn} เป็น URN ของเพจบริษัท — แอปนี้โพสต์ได้เฉพาะโปรไฟล์ส่วนตัว เพราะเพจต้องใช้ผลิตภัณฑ์ Community Management ที่Meta/LinkedIn ต้องอนุมัติรายแอป`,
        "ใส่ Author URN ของโปรไฟล์ส่วนตัว (urn:li:person:…) แล้วใช้ปุ่มแชร์ของ LinkedIn เองสำหรับเพจบริษัท",
      );
    } else {
      addCheck("author_urn", "Author URN", "fail", `"${authorUrn}" ไม่ใช่รูปแบบ urn:li:person:…`, "กด “ทดสอบและดึง URN” ใน Connectors เพื่อให้ระบบเติม Author URN ให้");
    }
  }

  // ── 5. token age ────────────────────────────────────────────────────────
  const savedAt = meta.tokenSavedAt || "";
  const savedMs = savedAt ? Date.parse(savedAt) : NaN;
  if (accessToken) {
    if (!Number.isFinite(savedMs)) {
      addCheck(
        "token_age",
        "อายุ token",
        "warn",
        "ไม่รู้ว่า token นี้ถูกวางเมื่อไร (บันทึกไว้ตั้งแต่ก่อนมีตัวตรวจนี้) — LinkedIn ให้ token อายุ 60 วัน และ API ไม่บอกวันหมดอายุ",
        "วาง token เดิมซ้ำใน Connectors 1 ครั้ง (หรือขอใหม่) เพื่อให้ระบบเริ่มนับอายุให้ จากนั้นตัวตรวจนี้จะเตือนล่วงหน้า",
      );
    } else {
      const age = daysBetween(savedMs);
      const left = TOKEN_LIFETIME_DAYS - age;
      if (left <= 0) {
        addCheck("token_age", "อายุ token", "fail", `token ถูกวางเมื่อ ${age} วันก่อน — เกินอายุ 60 วันของ LinkedIn แล้ว น่าจะถูกปฏิเสธ (401)`, "ขอ Member Access Token ใหม่แล้ววางใน Connectors");
      } else if (left <= 10) {
        addCheck("token_age", "อายุ token", "warn", `token ถูกวางเมื่อ ${age} วันก่อน — เหลือประมาณ ${left} วันตามอายุ 60 วันของ LinkedIn`, "ขอ token ใหม่ก่อนถึงวันโพสต์");
      } else {
        addCheck("token_age", "อายุ token", "pass", `วางเมื่อ ${age} วันก่อน — เหลือประมาณ ${left} วัน (ประมาณการจากอายุ 60 วัน)`);
      }
    }
  }

  // ── 6. product photo (picture 2) ────────────────────────────────────────
  const entry = pickCandidateEntry(client, { entryId: options.entryId, sku: options.sku });
  const sku = options.sku || entry?.sku || client.products?.[0]?.sku || "";
  const product = (client.products || []).find((p) => p.sku === sku) || null;
  const pairOn = client.settings?.productRefInPost !== false;
  const entryAlreadyPublished = Boolean(entry && entry.status === "published");
  let willAttachSecondPhoto = false;
  if (entryAlreadyPublished) {
    // Nothing left to send, so the second picture cannot block anything. Still
    // reported (as a skip) so the list of checks stays predictable.
    addCheck(
      "product_photo",
      "รูปสินค้าจริง (รูปที่ 2)",
      "skip",
      "โพสต์นี้เผยแพร่แล้ว — ด่านรูปสินค้ามีผลกับโพสต์ที่ยังไม่ส่งเท่านั้น",
      "ถ้าจะโพสต์สินค้านี้ซ้ำ ตรวจรูปคู่ก่อนส่งรายการถัดไป",
    );
  } else if (!pairOn) {
    addCheck(
      "product_photo",
      "รูปสินค้าจริง (รูปที่ 2)",
      "warn",
      "ปิด “แนบรูปสินค้าจริงในโพสต์” อยู่ — โพสต์จะออกเป็นรูปเดียว (ภาพ AI) ไม่ใช่รูปคู่",
      "ถ้าต้องการรูปคู่เหมือน Facebook ให้เปิดสวิตช์ “แนบรูปสินค้าจริง” ใน Connectors",
    );
  } else if (!product) {
    const knownSkus = (client.products || []).map((p) => p.sku).slice(0, 12) || [];
    addCheck(
      "product_photo",
      "รูปสินค้าจริง (รูปที่ 2)",
      "fail",
      `ไม่พบสินค้า SKU "${sku || "(ไม่ได้ระบุ)"}" ของลูกค้านี้ — SKU ที่มี: ${knownSkus.join(", ") || "(ยังไม่มีสินค้า)"}`,
      `ระบุ --sku ด้วย SKU ที่มีจริง (หรือรัน --list เพื่อดูรายการทั้งหมด)`,
    );
  } else {
    const ref = rt._fbProductRefAttach(client, entry || { sku: product.sku });
    if (ref.buffer) {
      willAttachSecondPhoto = true;
      addCheck(
        "product_photo",
        "รูปสินค้าจริง (รูปที่ 2)",
        "pass",
        `${product.sku} · ${ref.filename} (${Math.max(1, Math.round(ref.buffer.length / 1024))} KB)${ref.note ? ` · ${ref.note}` : ""}`,
      );
    } else {
      addCheck(
        "product_photo",
        "รูปสินค้าจริง (รูปที่ 2)",
        "fail",
        `สินค้า ${product.sku} ยังไม่มีรูปที่ใช้แนบได้${ref.note ? ` (${ref.note})` : ""} — โพสต์รูปคู่จะถูกปฏิเสธก่อนส่ง`,
        `ไปที่แท็บ สินค้า → ${product.sku} → “อัปโหลดรูป” หรือ “ดึงรูปจากเว็บ (ตาม SKU)” แล้วเปิดหน้าโพสต์ 1 ครั้งเพื่อสร้างไฟล์ 500px`,
      );
    }
  }

  // ── 7. entry + AI image ─────────────────────────────────────────────────
  let entryMeta = null;
  if (!entry) {
    const linkedinEntries = (client.calendar || []).filter((e) => e.platform === "linkedin").slice(0, 8);
    const inventory = linkedinEntries
      .map((e) => `${e.id} (${e.date} ${e.time} · ${e.sku} · ${e.status})`)
      .join(" · ");
    const placeholder = options.entryId && looksLikePlaceholder(options.entryId);
    // A runnable next step beats a list to copy from by hand: the id comes from
    // the state, so it can never be another placeholder.
    const suggested = linkedinEntries.slice(0, 3)
      .map((e) => `${e.id} (${e.date} ${e.time} · ${e.sku} · ${e.status})`)
      .join("\n   ");
    addCheck(
      "entry_media",
      "รายการโพสต์และภาพ AI (รูปที่ 1)",
      "fail",
      options.entryId
        ? `ไม่พบรายการปฏิทิน ID "${options.entryId}"${placeholder ? " — ค่านี้เป็นตัวอย่างจากวิธีใช้งาน ไม่ใช่ ID จริง (ตัวจริงดูได้จาก --list)" : ""}${inventory ? ` · รายการ LinkedIn ที่มี: ${inventory}` : " · ยังไม่มีรายการ LinkedIn ในปฏิทินเลย"}`
        : `ไม่พบรายการโพสต์ LinkedIn ในปฏิทิน${sku ? ` ของ SKU ${sku}` : ""}${inventory ? ` · รายการ LinkedIn ที่มี: ${inventory}` : " · ยังไม่มีรายการ LinkedIn ในปฏิทินเลย"}`,
      linkedinEntries.length
        ? `คัดลอก ID จริงจากรายการนี้:\n   ${suggested}\n   แล้วรัน: node scripts/verify-linkedin-post-readiness.cjs --entry ${linkedinEntries[0].id} --online`
        : "สร้างรายการโพสต์ LinkedIn ในแท็บ ปฏิทิน (หรือกด “วางแผนอัตโนมัติทั้งเดือน” ที่มี LinkedIn อยู่แล้ว) แล้วสร้างภาพ AI · รัน --list เพื่อดู ID/รายการที่มี",
    );
  } else if (options.sku && entry.sku !== options.sku) {
    addCheck("entry_media", "รายการโพสต์และภาพ AI (รูปที่ 1)", "fail", `รายการ ${entry.id} เป็นของสินค้า ${entry.sku} ไม่ตรงกับ --sku ${options.sku}`, `ระบุ --entry ENTRY_ID ของ ${options.sku} (ดูได้จาก --list)`);
  } else if (entry.platform !== "linkedin") {
    addCheck("entry_media", "รายการโพสต์และภาพ AI (รูปที่ 1)", "fail", `รายการ ${entry.id} ตั้งแพลตฟอร์มเป็น "${entry.platform}" ไม่ใช่ "linkedin"`, "เลือกรายการที่เป็น LinkedIn ด้วย --entry ENTRY_ID (ดูได้จาก --list)");
  } else if (entry.status === "published") {
    // Nothing left to send. Reporting this as a blocker made a successful post
    // look broken: "❌ ยังไม่พร้อมโพสต์ LinkedIn จริง" right after it went live.
    addCheck(
      "entry_media",
      "รายการโพสต์และภาพ AI (รูปที่ 1)",
      "pass",
      `โพสต์นี้เผยแพร่แล้ว${entry.postId ? ` (postId: ${entry.postId})` : ""}${entry.publishedAt ? ` เมื่อ ${entry.publishedAt}` : ""} — ไม่มีอะไรต้องส่งอีก`,
    );
  } else if (entry.inFlight || entry.status === "publishing") {
    addCheck(
      "entry_media",
      "รายการโพสต์และภาพ AI (รูปที่ 1)",
      "skip",
      `รายการ ${entry.id} สถานะ "${entry.status}"${entry.postId ? ` (postId: ${entry.postId})` : ""} — กำลังส่งอยู่ รอให้จบก่อนแล้วค่อยตรวจซ้ำ`,
      "รอสักครู่แล้วรันตัวตรวจอีกครั้ง",
    );
  } else if (entry.video && (entry.video.path || entry.video.publicUrl)) {
    addCheck(
      "entry_media",
      "รายการโพสต์และภาพ AI (รูปที่ 1)",
      "fail",
      `รายการ ${entry.id} มีวิดีโอแนบ — LinkedIn ผ่าน API ในแอปนี้รองรับข้อความและรูปเท่านั้น (จะถูกปฏิเสธตอนส่ง)`,
      "ลบวิดีโอออกจากรายการ หรืออัปโหลดวิดีโอบน LinkedIn เอง",
    );
  } else {
    const hasImage = Boolean(entry.image && (entry.image.path || entry.image.buffer || entry.image.publicUrl));
    if (!hasImage) {
      addCheck(
        "entry_media",
        "รายการโพสต์และภาพ AI (รูปที่ 1)",
        "warn",
        `รายการ ${entry.id} ยังไม่มีภาพ AI — จะโพสต์เป็นข้อความเท่านั้น (LinkedIn รับข้อความล้วนได้)`,
        "ถ้าต้องการโพสต์รูป ให้กด “สร้างภาพ” ในหน้ารายการ",
      );
    } else if (entry.image.path && !fs.existsSync(entry.image.path)) {
      addCheck("entry_media", "รายการโพสต์และภาพ AI (รูปที่ 1)", "fail", `ไม่พบไฟล์ภาพ AI บนดิสก์ (${entry.image.path})`, "กด “สร้างภาพใหม่” ในหน้ารายการโพสต์");
    } else {
      const bytes = entry.image.buffer?.length || (entry.image.path ? fs.statSync(entry.image.path).size : 0);
      entryMeta = {
        entryId: entry.id,
        sku: entry.sku,
        date: entry.date,
        time: entry.time,
        status: entry.status,
        aiImagePath: entry.image.path ? path.relative(root, entry.image.path) : "(in-memory)",
        aiImageBytes: bytes,
        hasPublicUrl: Boolean(entry.image.publicUrl),
      };
      addCheck("entry_media", "รายการโพสต์และภาพ AI (รูปที่ 1)", "pass", `รายการ ${entry.id} (${entry.sku}) · ภาพ AI ${path.basename(entry.image.path || "buffer")} (${Math.max(1, Math.round(bytes / 1024))} KB)`);
    }
  }

  // ── 8. image review gate ────────────────────────────────────────────────
  if (entry && entry.platform === "linkedin") {
    const gate = rt._imageGateInfo(entry);
    if (!gate.ok) {
      addCheck(
        "image_gate",
        "ด่านตรวจภาพ (Image Review Gate)",
        "fail",
        `สถานะ "${gate.status}" — ${gate.reason}`,
        gate.status === "rejected"
          ? "รูปนี้ถูกกดปฏิเสธไว้ — กด “สร้างภาพใหม่” แล้วยืนยัน + “ตรวจภาพแล้ว”"
          : "เปิดหน้ารายการโพสต์ ติ๊กยืนยัน แล้วกด “ตรวจภาพแล้ว”",
      );
    } else if (gate.required) {
      addCheck("image_gate", "ด่านตรวจภาพ (Image Review Gate)", "pass", `ตรวจภาพผ่านแล้ว (${gate.status}${gate.reviewedAt ? ` เมื่อ ${gate.reviewedAt}` : ""})`);
    } else {
      addCheck("image_gate", "ด่านตรวจภาพ (Image Review Gate)", "pass", "รายการนี้ไม่มีรูปที่ต้องตรวจ");
    }
  }

  // ── 9. caption ──────────────────────────────────────────────────────────
  if (entry && entry.platform === "linkedin") {
    const rawCaption = String(entry.caption || "").trim();
    const published = rawCaption
      ? SocialAgencyRuntime._tagCaptionLinks(formatPostCaption(client, "linkedin", rawCaption), client.id, "linkedin", entry.id)
      : "";
    const commentary = published ? linkedInCommentary(published) : "";
    const hashtags = (published.match(/#[^\s#]+/g) || []).length;
    const preview = commentary.length > 180 ? `${commentary.slice(0, 180)}…` : commentary;
    if (!rawCaption) {
      addCheck(
        "caption",
        "แคปชัน LinkedIn",
        "warn",
        `รายการ ${entry.id} ยังไม่มีแคปชัน — ระบบจะสร้างให้ตอนรัน และอาจหยุดรออนุมัติถ้าคะแนนไม่ถึงเกณฑ์`,
        "เลือกตัวอย่างแคปชันหรือเขียนเองในหน้ารายการ เพื่อให้ตัวตรวจนี้ยืนยันได้จริง",
      );
    } else if (published.length > LINKEDIN_MAX_CHARS) {
      addCheck("caption", "แคปชัน LinkedIn", "fail", `ยาว ${published.length} ตัวอักษร เกินเพดาน ${LINKEDIN_MAX_CHARS}`, "ย่อแคปชันในหน้ารายการ");
    } else if (hashtags > LINKEDIN_MAX_HASHTAGS) {
      addCheck(
        "caption",
        "แคปชัน LinkedIn",
        "warn",
        `มี ${hashtags} แฮชแท็ก (แนะนำ ≤ ${LINKEDIN_MAX_HASHTAGS})`,
        entryAlreadyPublished
          ? "โพสต์นี้ส่งไปแล้ว — คำเตือนนี้ใช้กับการโพสต์ครั้งถัดไป (ตัดเหลือ ≤5 ก่อนอนุมัติ)"
          : "ลดแฮชแท็กในแคปชัน",
      );
    } else {
      addCheck(
        "caption",
        "แคปชัน LinkedIn",
        "pass",
        `${published.length}/${LINKEDIN_MAX_CHARS} ตัวอักษร · ${hashtags} แฮชแท็ก · ข้อความที่จะส่งจริง (little text): ${preview}`,
      );
    }
  }

  // ── 10. trigger timing ──────────────────────────────────────────────────
  if (entry && entry.platform === "linkedin") {
    const dueMs = bangkokToUtcMs(entry.date, entry.time);
    const isFuture = Number.isFinite(dueMs) && dueMs > Date.now();
    if (entry.status === "published") {
      // Checked first: a post that already went out has nothing to press, no
      // matter what its scheduled time says.
      addCheck("trigger", "จังหวะการกดส่ง", "skip", "โพสต์นี้ส่งไปแล้ว — ไม่มีอะไรต้องกดอีก (ใช้ --list เพื่อดูรายการที่ยังรอ)");
    } else if (isFuture && options.trigger === "manual") {
      addCheck(
        "trigger",
        "จังหวะการกดส่ง",
        "fail",
        `เวลานัดโพสต์ (${entry.date} ${entry.time} เวลาไทย) ยังมาไม่ถึง — ปุ่ม “รันเลยตอนนี้” จะบังคับเป็น dry-run`,
        `ถ้าต้องการส่งจริงตอนนี้: เลื่อนวัน/เวลาให้ไม่เกินปัจจุบัน หรือใช้ปุ่ม “อนุมัติและเผยแพร่”`,
      );
    } else if (isFuture) {
      addCheck(
        "trigger",
        "จังหวะการกดส่ง",
        "pass",
        `เวลานัดโพสต์ ${entry.date} ${entry.time} (เวลาไทย) — “อนุมัติและเผยแพร่” ส่งได้เลย ส่วน “รันเลยตอนนี้” จะเป็น dry-run`,
      );
    } else {
      addCheck("trigger", "จังหวะการกดส่ง", "pass", `เวลานัดโพสต์ ${entry.date} ${entry.time} ถึงกำหนดแล้ว — กดส่งจริงได้`);
    }
  }

  // ── 11. online (read-only) ──────────────────────────────────────────────
  if (options.online && (!accessToken || !authorUrn)) {
    addCheck(
      "online_graph",
      "ตรวจ token กับ LinkedIn (--online)",
      "skip",
      "ข้ามการตรวจออนไลน์ — ยังไม่มี Member Access Token / Author URN ใน Connectors (ด่านอื่นตรวจให้แล้ว)",
      "ใส่ token ใน Connectors แล้วรันซ้ำด้วย --online เพื่อยืนยันว่า token เป็นของบัญชีเดียวกับ Author URN",
    );
  } else if (options.online && accessToken && authorUrn) {
    const secretsToRedact = [accessToken];
    const apiHost = options.host || process.env.LUKE_LI_HOST || DEFAULT_API_HOST;
    const apiPort = options.port ?? (process.env.LUKE_LI_PORT ? Number(process.env.LUKE_LI_PORT) : undefined);
    const apiTls = options.tls ?? process.env.LUKE_LI_TLS !== "0";
    let versionForProbe = version;
    try {
      SocialAgencyRuntime._linkedInVersion(version);
    } catch {
      versionForProbe = LINKEDIN_API_VERSION;
    }
    try {
      const info = await linkedinRequest({ apiPath: "/v2/userinfo", token: accessToken, version: versionForProbe, host: apiHost, port: apiPort, useTls: apiTls });
      if (info.status === 401 || info.json?.status === 401) {
        throw new Error(`token ถูกปฏิเสธ (401) — หมดอายุ/ถูกเพิกถอน หรือขาดสิทธิ์ ${NEEDED_SCOPES.join(", ")}`);
      }
      if (info.status >= 400) throw new Error(info.json?.message || `HTTP ${info.status}`);
      const sub = String(info.json?.sub || "");
      const name = info.json?.name || info.json?.given_name || "";
      const tokenUrn = sub ? `urn:li:person:${sub}` : "";
      if (tokenUrn && tokenUrn !== authorUrn) {
        addCheck(
          "online_graph",
          "ตรวจ token กับ LinkedIn (--online)",
          "fail",
          `token นี้เป็นของ "${name || sub}" (${tokenUrn}) ไม่ตรงกับ Author URN ที่ตั้งไว้ (${authorUrn}) — โพสต์จะไปขึ้นผิดโปรไฟล์`,
          "กด “ทดสอบและดึง URN” ใน Connectors เพื่อเขียน Author URN ให้ตรงกับ token นี้",
        );
      } else {
        addCheck(
          "online_graph",
          "ตรวจ token กับ LinkedIn (--online)",
          "pass",
          `ยืนยันกับ LinkedIn แล้ว — ${name ? `"${name}" ` : ""}${tokenUrn || authorUrn} ตรงกับ Author URN`,
        );
      }
    } catch (err) {
      addCheck("online_graph", "ตรวจ token กับ LinkedIn (--online)", "fail", redact(err.message || String(err), secretsToRedact), "ออก Member Access Token ใหม่ (w_member_social + openid profile) แล้ววางใน Connectors");
    }

    // initializeUpload reserves a slot only: no bytes are sent and no post is created.
    if (options["probe-images"] !== false && !blockers.some((b) => b.startsWith("ตรวจ token"))) {
      try {
        const probe = await linkedinRequest({
          method: "POST",
          apiPath: "/rest/images?action=initializeUpload",
          token: accessToken,
          version: versionForProbe,
          host: apiHost,
          port: apiPort,
          useTls: apiTls,
          body: { initializeUploadRequest: { owner: authorUrn } },
        });
        const uploadUrl = probe.json?.value?.uploadUrl;
        const imageUrn = probe.json?.value?.image;
        if (probe.status >= 300 || !uploadUrl || !imageUrn) {
          const reason = probe.status === 426
            ? "เวอร์ชัน API ถูกปฏิเสธ (HTTP 426) — เปลี่ยน Linkedin-Version"
            : probe.status === 401 || probe.status === 403
              ? `ไม่ได้สิทธิ์อัปโหลดรูป (HTTP ${probe.status}) — token ต้องมี w_member_social`
              : probe.json?.message || `HTTP ${probe.status}`;
          addCheck("online_images", "ทดสอบอัปโหลดรูป (initializeUpload)", "fail", redact(reason, secretsToRedact), "ตรวจสิทธิ์ w_member_social ของ token และเวอร์ชัน Linkedin-Version");
        } else {
          addCheck(
            "online_images",
            "ทดสอบอัปโหลดรูป (initializeUpload)",
            "pass",
            `LinkedIn อนุมัติการอัปโหลดแล้ว (${imageUrn}) · โฮสต์ปลายทาง ${new URL(uploadUrl).hostname} · ไม่อัปโหลดไบต์และไม่สร้างโพสต์`,
          );
        }
      } catch (err) {
        addCheck("online_images", "ทดสอบอัปโหลดรูป (initializeUpload)", "fail", redact(err.message || String(err), secretsToRedact), "ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่");
      }
    }
  }

  const published = Boolean(entry && entry.status === "published");
  const readyForLiveLinkedIn = blockers.length === 0 && (!options.strict || warnings.length === 0);
  return {
    ok: readyForLiveLinkedIn,
    readyForLiveLinkedIn,
    published,
    publishedPostId: published ? entry.postId || null : null,
    root,
    clientId: client.id,
    clientName: client.name,
    entryId: entry?.id || null,
    sku: sku || null,
    version,
    authorUrn: authorUrn || null,
    tokenMasked: mask(accessToken),
    willAttachSecondPhoto,
    mediaKind: !entry ? null : entry.image ? (willAttachSecondPhoto ? "carousel" : "image") : "post",
    entry: entryMeta,
    checks,
    blockers,
    warnings,
    nextSteps: [...new Set(nextSteps)],
  };
}

function formatHumanReport(report, opts = {}) {
  const lines = [];
  lines.push("══ ตรวจความพร้อมโพสต์ LinkedIn จริง ══════════════════════════════");
  lines.push(`  ลูกค้า: ${report.clientName ? `${report.clientName} (${report.clientId})` : report.clientId || "(ไม่พบ)"}`);
  lines.push(`  สินค้า (SKU): ${report.sku || "(ไม่พบ)"} · รายการปฏิทิน: ${report.entryId || "(ไม่พบ)"}`);
  lines.push(`  รูปแบบที่จะส่ง: ${report.mediaKind === null ? "(ยังไม่มีรายการให้ตรวจ)" : report.mediaKind === "carousel" ? "รูปคู่ (ภาพ AI + รูปสินค้าจริง)" : report.mediaKind === "image" ? "รูปเดียว" : "ข้อความเท่านั้น"}`);
  lines.push("");
  for (const c of report.checks) {
    const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "!" : c.status === "skip" ? "–" : "✗";
    lines.push(`  ${icon} [${c.key}] ${c.label}`);
    lines.push(`      ${c.detail}`);
    if (c.fix && c.status !== "pass") lines.push(`      → วิธีแก้: ${c.fix}`);
  }
  lines.push("");
  if (report.published) {
    lines.push(`✅ โพสต์นี้เผยแพร่บน LinkedIn แล้ว${report.publishedPostId ? ` (postId: ${report.publishedPostId})` : ""} — ไม่มีอะไรต้องทำต่อ`);
    if (report.warnings.length) lines.push("   (คำเตือนด้านบนใช้กับการโพสต์ครั้งถัดไป เช่นจำนวนแฮชแท็ก)");
  } else if (report.readyForLiveLinkedIn) {
    lines.push("✅ พร้อมโพสต์ LinkedIn จริง" + (report.warnings.length ? ` (มี ${report.warnings.length} คำเตือนที่ไม่บล็อก)` : ""));
  } else {
    lines.push(`❌ ยังไม่พร้อมโพสต์ LinkedIn จริง (${report.blockers.length} ข้อติดขัด${opts.strict && report.warnings.length ? ` · ${report.warnings.length} คำเตือนในโหมด --strict` : ""})`);
  }
  lines.push("══════════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.list) {
    const inventory = buildInventory(path.resolve(args.root || process.env.LUKE_SA_ROOT || DEFAULT_ROOT), { clientId: args.client });
    if (args.json) process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    else process.stdout.write(`${formatInventory(inventory)}\n`);
    return 0;
  }
  const report = await inspectLinkedInPostReadiness({
    root: args.root,
    clientId: args.client,
    sku: args.sku,
    entryId: args.entry,
    trigger: args.trigger,
    strict: Boolean(args.strict),
    online: Boolean(args.online),
    host: args.host,
    "probe-images": args["no-probe-images"] ? false : undefined,
  });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${formatHumanReport(report, { strict: Boolean(args.strict) })}\n`);
  // A post that is already live has nothing left to fail: --strict should not
  // turn "the caption has 8 hashtags" into a red exit for a published entry.
  if (report.published) return 0;
  return report.readyForLiveLinkedIn ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code ?? 0; }).catch((err) => {
    process.stderr.write(`✗ ${err.message || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  looksLikePlaceholder,
  buildInventory,
  formatInventory,
  inspectLinkedInPostReadiness,
  formatHumanReport,
  mask,
  redact,
  stateFileFor,
  TOKEN_LIFETIME_DAYS,
};
