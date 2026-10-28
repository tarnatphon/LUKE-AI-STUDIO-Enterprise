#!/usr/bin/env node
"use strict";

/*
 * Social Agency — LinkedIn member token helper.
 *
 * Facebook has a dashboard where you can click "generate token"; LinkedIn does
 * not. You have to register an app, add the "Share on LinkedIn" + "Sign In with
 * LinkedIn using OpenID Connect" products, then run an OAuth 2.0 authorization
 * code flow to get a member token with `w_member_social`. That flow is the step
 * everybody gets stuck on, so this script does it:
 *
 *   1. builds the authorization URL (with a random `state`) and opens the browser
 *   2. takes back the redirect URL your browser lands on (paste it, or --callback)
 *   3. exchanges the code at /oauth/v2/accessToken
 *   4. calls /v2/userinfo to learn WHICH member the token belongs to
 *   5. prints the token + `urn:li:person:…` to paste in Connectors, or writes
 *      them straight into connectors.json with --save
 *
 * The token lives ~60 days and LinkedIn has no refresh flow for member tokens,
 * so the script prints the exact expiry date and (with --save) records the day it
 * was stored, which is what scripts/verify-linkedin-post-readiness.cjs uses to
 * warn you before the calendar hits a 401.
 *
 * The redirect URL does NOT need a running server: LinkedIn requires the URL to
 * be registered in your app, and the page will usually fail to load — the code is
 * in the address bar, which is all we need. (That is why there is no --listen
 * flag: a local http server only works when LinkedIn accepts http, which it
 * usually does not.)
 *
 * Usage
 *   node scripts/social-agency-linkedin-token.cjs --prompt
 *   node scripts/social-agency-linkedin-token.cjs --prompt --save --client thai-modern-bags
 *   node scripts/social-agency-linkedin-token.cjs --client-id ID --client-secret SECRET \
 *        --redirect https://example.com/callback --code AQS...
 *   node scripts/social-agency-linkedin-token.cjs --check --save
 *   node scripts/social-agency-linkedin-token.cjs --curl
 *
 * Test-only escape hatch (used by the offline suite; LinkedIn is the only sane
 * value in production): LUKE_LI_OAUTH_HOST / _PORT / _TLS and LUKE_LI_HOST /
 * _PORT / _TLS.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { execFile } = require("node:child_process");
const {
  promptHidden,
  sanitizeHiddenLine,
  describeValue,
} = require("./social-agency-fb-token.cjs");

const DEFAULT_OAUTH_HOST = "www.linkedin.com";
const DEFAULT_API_HOST = "api.linkedin.com";
const AUTHORIZE_PATH = "/oauth/v2/authorization";
const TOKEN_PATH = "/oauth/v2/accessToken";
const USERINFO_PATH = "/v2/userinfo";
// w_member_social = create posts as the member · openid profile = /v2/userinfo
const SCOPES = ["openid", "profile", "w_member_social"];
const HTTP_TIMEOUT_MS = 20000;
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const TOKEN_LIFETIME_DAYS = 60;

const BOOLEAN_FLAGS = new Set(["help", "prompt", "save", "check", "curl", "json", "reveal"]);

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
  return out;
}

const HELP = `
Social Agency — LinkedIn member token helper (OAuth 2.0 แบบ authorization code)

  --prompt                     ถาม Client ID / Client Secret / Redirect URL ตอนรัน (ไม่ลง shell history)
  --client-id ID               Client ID จาก developer.linkedin.com (หรือ env LUKE_LI_CLIENT_ID)
  --client-secret SECRET       Client Secret (หรือ env LUKE_LI_CLIENT_SECRET)
  --redirect URL               Redirect URL ที่ลงทะเบียนไว้ในแอป LinkedIn ต้องตรงทุกตัวอักษร (หรือ env LUKE_LI_REDIRECT)
  --callback URL               วาง URL ที่เบราว์เซอร์เด้งไปหลังกดอนุญาต (มี ?code=…&state=…) — ไม่ต้องมีเซิร์ฟเวอร์รัน
  --state STATE                ใช้ state ที่กำหนดเอง (ปกติสคริปต์สุ่มให้ และต้องตรงกับที่อยู่ใน --callback)
  --code CODE                  ใส่เฉพาะ code ก็ได้ (ใช้คู่กับ --redirect) — ไม่ต้องมี URL และไม่ตรวจ state
  --save                       เขียน token + Author URN ลง connectors.json ให้เลย (ไม่พิมพ์ token ออกจอ)
  --client CLIENT_ID           ลูกค้าในแอปที่จะบันทึกด้วย (ใช้กับ --save / --check)
  --check                      ตรวจ token ที่บันทึกไว้อยู่แล้ว (ไม่ต้องทำ OAuth ใหม่)
  --curl                       ไม่ต่อเน็ต — พิมพ์คำสั่ง curl เทียบเท่าให้ไปรันเอง
  --json                       ผลเป็น JSON (token ถูกปิดบัง เว้นแต่ใส่ --reveal)
  --reveal                     พิมพ์ token เต็ม (ค่าเริ่มต้นพิมพ์เต็มเฉพาะตอนไม่ได้ใช้ --save)
  --root PATH                  พาธรากของโปรเจกต์ (ค่าเริ่มต้น: โฟลเดอร์ repo นี้)

สิทธิ์ที่ขอ: ${SCOPES.join(" ")}
  · w_member_social = สร้างโพสต์ในนามโปรไฟล์ส่วนตัว
  · openid profile  = อ่าน /v2/userinfo เพื่อรู้ว่า token เป็นของใคร (เอา URN ไปใช้)

ขั้นตอน (ทำครั้งเดียว ใช้ได้ ~60 วัน)
  1) developer.linkedin.com → Create app → เพิ่มผลิตภัณฑ์ "Share on LinkedIn"
     และ "Sign In with LinkedIn using OpenID Connect" (ต้องเห็นทั้งคู่ในแท็บ Products)
  2) ใส่ Redirect URL ในช่อง Authorized redirect URLs ของแอป ต้องเป็น https และตรงทุกตัวอักษร
     แนะนำ URL ที่ "ไม่เด้งไปหน้าอื่น" (เช่นไฟล์นิ่งที่มีอยู่จริงบนเว็บคุณ) เพราะถ้าเว็บเด้ง
     ต่อไปหน้าแรก query code= จะหายไปก่อนคุณก๊อป
  3) node scripts/social-agency-linkedin-token.cjs --prompt --save --client CLIENT_ID
     กด Allow แล้ววางได้ทั้ง URL เต็ม หรือเฉพาะค่าที่อยู่หลัง code= (วางผิดได้ 3 ครั้ง
     ระบบจะบอกว่าได้รับอะไรมาบ้างแล้วถามซ้ำ ไม่ตัดจบ)
  4) เปิดแอป → Connectors → LinkedIn → กด "ทดสอบและดึง URN" → ปิด dry-run

env: LUKE_LI_CLIENT_ID, LUKE_LI_CLIENT_SECRET, LUKE_LI_REDIRECT

ตัวอย่าง
  node scripts/social-agency-linkedin-token.cjs --prompt
  node scripts/social-agency-linkedin-token.cjs --save --client thai-modern-bags
  node scripts/social-agency-linkedin-token.cjs --check --client thai-modern-bags
  node scripts/social-agency-linkedin-token.cjs --curl
`;

// ── tiny io ──────────────────────────────────────────────────────────────────
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

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

let warnedOffHost = false;
function request({ method = "GET", host, path: urlPath, headers = {}, body = null, timeoutMs = HTTP_TIMEOUT_MS }) {
  if (!warnedOffHost && !isLoopback(host) && !host.endsWith("linkedin.com")) {
    warnedOffHost = true;
    process.stderr.write(`! กำลังส่ง Client Secret/token ไปยังโฮสต์ ${host} — ค่านี้ควรใช้เฉพาะตอนทดสอบ\n`);
  }
  const tls = process.env.LUKE_LI_TLS !== "0";
  const lib = tls ? https : http;
  const port = process.env.LUKE_LI_PORT ? Number(process.env.LUKE_LI_PORT) : undefined;
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(body, "utf8");
    const req = lib.request({
      host,
      port,
      method,
      path: urlPath,
      headers: { Accept: "application/json", ...(data ? { "Content-Length": data.length } : {}), ...headers },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* form or empty */ }
        resolve({ status: res.statusCode || 0, json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`หมดเวลารอ ${host} (${timeoutMs / 1000} วินาที) — เช็คเน็ต/VPN แล้วลองใหม่`)));
    req.on("error", (err) => reject(new Error(`ติดต่อ ${host} ไม่สำเร็จ: ${err.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

const oauthHost = () => process.env.LUKE_LI_OAUTH_HOST || DEFAULT_OAUTH_HOST;
const apiHost = () => process.env.LUKE_LI_HOST || DEFAULT_API_HOST;

// ── OAuth plumbing (pure, so the offline suite can assert every branch) ──────
function buildAuthorizeUrl({ clientId, redirect, state, host = DEFAULT_OAUTH_HOST }) {
  if (!clientId) throw new Error("ต้องมี Client ID (--client-id หรือ LUKE_LI_CLIENT_ID)");
  if (!redirect) throw new Error("ต้องมี Redirect URL (--redirect หรือ LUKE_LI_REDIRECT) ที่ลงทะเบียนไว้ในแอป LinkedIn");
  let target;
  try {
    target = new URL(redirect);
  } catch {
    throw new Error(`Redirect URL ไม่ถูกต้อง: ${redirect}`);
  }
  if (!/^https?:$/.test(target.protocol)) throw new Error("Redirect URL ต้องขึ้นต้นด้วย https:// (หรือ http:// สำหรับเครื่องตัวเอง)");
  const url = new URL(`https://${host}${AUTHORIZE_PATH}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  // LinkedIn documents scope as a space-separated list; URLSearchParams encodes
  // the space as %20, which is what the endpoint accepts.
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

function newState() {
  return crypto.randomBytes(16).toString("hex");
}

// "code=" anywhere in the text, with or without a well-formed URL around it.
// Browsers and WordPress both mangle this in ways URLSearchParams never sees:
// `#?code=…`, a query that arrived percent-encoded (%3Fcode%3D…), or the value
// pasted on its own.
const CODE_PATTERN = /code=([^&\s#]+)/;

function salvageCode(input) {
  const text = String(input || "");
  if (!text) return "";
  let decoded = "";
  try {
    decoded = decodeURIComponent(text);
  } catch {
    decoded = "";
  }
  for (const candidate of [text, decoded]) {
    if (!candidate) continue;
    const match = CODE_PATTERN.exec(candidate);
    if (match && match[1]) return match[1].trim();
  }
  return "";
}

// What we actually received, in a form that is safe to print: host + path + the
// names of the parameters, never the values (a code is a credential).
function describeReceived(input) {
  const raw = String(input || "");
  if (!raw.trim()) return "(ว่าง — ไม่มีอะไรถูกวางเข้ามา)";
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }
  if (parsed) {
    const keys = [...new Set(parsed.searchParams.keys())];
    return `${parsed.host}${parsed.pathname}${keys.length ? ` · พารามิเตอร์: ${keys.join(", ")}` : " · ไม่มีพารามิเตอร์"} · ยาว ${raw.length} ตัวอักษร`;
  }
  const head = raw.slice(0, 32);
  return `${head}${raw.length > 32 ? "…" : ""} (ยาว ${raw.length} ตัวอักษร)`;
}

// Pull `code` (and the state we sent) out of whatever the browser landed on:
// a full URL, a bare query string, or the code pasted on its own. Every failure
// names what was received, because "URL นี้ไม่มี code" alone cannot be acted on.
function extractCode(input, { state } = {}) {
  const raw = sanitizeHiddenLine(input || "");
  if (!raw) throw new Error("ไม่มีข้อมูลให้อ่าน — วาง URL ที่เบราว์เซอร์เด้งไปหลังกดอนุญาต หรือเฉพาะค่าหลัง code=");
  let params = null;
  try {
    params = new URL(raw).searchParams;
  } catch {
    const qs = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
    if (/code=|error=|state=/.test(qs)) params = new URLSearchParams(qs);
  }
  if (!params) {
    // A query that arrived percent-encoded is not a well-formed URL, but the
    // code inside it is still there once the text is decoded.
    const salvaged = salvageCode(raw);
    if (salvaged) return { code: salvaged, state: null };
    // a bare code: LinkedIn codes are long, opaque and contain no spaces.
    // Anything still carrying %XX is an encoded URL, not a code.
    if (raw.length >= 20 && !/\s/.test(raw) && !/%[0-9A-Fa-f]{2}/.test(raw)) return { code: raw, state: null };
    throw new Error(`อ่าน URL ไม่ได้: ${describeReceived(raw)} — ต้องเป็น URL ที่มี code= หรือเฉพาะค่าหลัง code=`);
  }
  const error = params.get("error");
  if (error) {
    const desc = params.get("error_description") || "";
    const cancelled = error === "user_cancelled_login" || error === "user_cancelled_authorize";
    throw new Error([
      `LinkedIn ปฏิเสธการอนุญาต: ${error}${desc ? ` — ${desc}` : ""}${cancelled ? " (กดยกเลิกในหน้า LinkedIn)" : ""}`,
      cancelled ? "" : "มักเป็นเพราะแอปยังไม่ได้เพิ่มผลิตภัณฑ์ Share on LinkedIn / Sign In with LinkedIn using OpenID Connect หรือ Redirect URL ไม่ตรงกับที่ลงทะเบียนไว้",
    ].filter(Boolean).join("\n   "));
  }
  const gotState = params.get("state");
  const code = params.get("code") || salvageCode(raw);
  if (!code) {
    const looksAuthorize = /response_type=code/.test(raw) && /client_id=/.test(raw);
    // The browser that was opened is not signed in to LinkedIn, so LinkedIn
    // serves its login wall instead of the Allow page and nothing redirects.
    // That URL carries session_redirect/trk, never a code — worth naming.
    const looksLogin = /linkedin\.com\/(uas\/)?(login|checkpoint)/.test(raw)
      || (params.has("session_redirect") && params.has("trk"));
    throw new Error([
      `URL ที่วางมาไม่มี code — ได้รับ: ${describeReceived(raw)}`,
      looksLogin
        ? "หน้านี้คือหน้า “เข้าสู่ระบบ” ของ LinkedIn — เบราว์เซอร์ที่เปิดลิงก์ยังไม่ได้ล็อกอิน จึงยังไม่ถึงหน้า Allow ให้ล็อกอินให้เสร็จ แล้วระบบจะพาไปหน้า Allow เอง กด Allow แล้วค่อยก๊อป URL ที่มี code="
        : looksAuthorize
          ? "หน้านี้คือหน้า “ขออนุญาต” ของ LinkedIn ไม่ใช่หน้าที่เด้งกลับ — ต้องกด Allow ให้จบก่อน ถ้าหน้าไม่เด้งกลับ มักเป็นเพราะแอปยังไม่มีผลิตภัณฑ์ Share on LinkedIn / Sign In with LinkedIn using OpenID Connect หรือ Redirect URL ไม่ตรงกับที่ลงทะเบียน"
          : "ถ้าเว็บปลายทางเด้งต่อไปหน้าอื่นจน query หาย ให้ลงทะเบียน Redirect URL ที่ไม่เด้ง (ไฟล์นิ่งที่มีอยู่จริงบนเว็บคุณ) แล้วเริ่มใหม่ — หรือวางเฉพาะค่าที่อยู่หลัง code= ก็ได้",
    ].join("\n   "));
  }
  if (state && gotState && gotState !== state) {
    throw new Error(`state ไม่ตรง (ได้ ${gotState.slice(0, 8)}… ไม่ใช่ ${state.slice(0, 8)}…) — URL นี้มาจากการเข้าสู่ระบบครั้งก่อน ให้เริ่มใหม่ด้วยการรันสคริปต์อีกครั้ง`);
  }
  return { code, state: gotState || null };
}

// The paste step is where people get stuck, so a bad paste is a question, not an
// exit: say what arrived, then ask again.
const writeLine = (line = "") => process.stdout.write(`${line}\n`);

async function readCallback({
  state,
  askFn = () => promptHidden("วาง URL ที่ได้: "),
  tries = 3,
  sayFn = writeLine,
} = {}) {
  if (typeof askFn !== "function") throw new Error("readCallback ต้องได้ฟังก์ชัน askFn สำหรับถามค่า (หรือปล่อยว่างเพื่ออ่านจากคีย์บอร์ด)");
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const pasted = await askFn({ attempt, tries });
    try {
      return extractCode(pasted, { state });
    } catch (err) {
      last = err;
      sayFn(`✗ ${err.message}`);
      if (attempt < tries) sayFn(`  ลองอีกครั้งได้ (${attempt}/${tries}) — วาง URL ที่มี code= หรือเฉพาะค่าหลัง code=`);
    }
  }
  throw last;
}

async function exchangeCode({ clientId, clientSecret, redirect, code, host = DEFAULT_OAUTH_HOST }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();
  const res = await request({
    method: "POST",
    host,
    path: TOKEN_PATH,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const described = res.json?.error_description || res.json?.error || (res.text ? res.text.slice(0, 160) : `HTTP ${res.status}`);
  if (res.status >= 300 || !res.json?.access_token) {
    throw new Error(redact(`แลก code เป็น token ไม่สำเร็จ: ${described}`, [clientSecret, code]));
  }
  return {
    accessToken: res.json.access_token,
    expiresIn: Number(res.json.expires_in) || null,
    scope: res.json.scope || SCOPES.join(" "),
  };
}

async function fetchMember({ accessToken, host = DEFAULT_API_HOST }) {
  const res = await request({
    host,
    path: USERINFO_PATH,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error("token ถูกปฏิเสธ (401) — อาจขาดสิทธิ์ openid profile หรือ token หมดอายุแล้ว");
  if (res.status >= 300 || !res.json?.sub) {
    const msg = res.json?.message || res.json?.error || (res.text ? res.text.slice(0, 160) : `HTTP ${res.status}`);
    throw new Error(redact(`อ่านโปรไฟล์จาก LinkedIn ไม่สำเร็จ: ${msg}`, [accessToken]));
  }
  return {
    sub: String(res.json.sub),
    urn: `urn:li:person:${res.json.sub}`,
    name: String(res.json.name || res.json.given_name || "").trim(),
  };
}

function expiryDate(expiresIn, now = Date.now()) {
  if (!expiresIn || !Number.isFinite(expiresIn)) return null;
  return new Date(now + expiresIn * 1000).toISOString().slice(0, 10);
}

// ── the app side ─────────────────────────────────────────────────────────────
function saveToApp({ root, clientId, accessToken, authorUrn, dryRun }) {
  const { SocialAgencyRuntime } = require("./server/social-agency-runtime.cjs");
  const rt = new SocialAgencyRuntime({ root });
  const state = rt._read();
  const id = clientId || state.activeClientId || state.clients?.[0]?.id;
  if (!id) throw new Error("ยังไม่มีลูกค้าในแอป — สร้างลูกค้าในแท็บ Social Agency ก่อน");
  const client = state.clients.find((c) => c.id === id);
  if (!client) throw new Error(`ไม่พบลูกค้า "${id}" — ดูรายชื่อได้จาก node scripts/verify-linkedin-post-readiness.cjs --list`);
  const patch = { linkedin: { accessToken, authorUrn } };
  if (typeof dryRun === "boolean") patch.linkedin.dryRun = dryRun;
  const view = rt.saveConnectors(id, { connectors: patch });
  return { clientId: id, clientName: client.name, view: view?.linkedin || {} };
}

function readStoredToken({ root, clientId }) {
  const { SocialAgencyRuntime } = require("./server/social-agency-runtime.cjs");
  const rt = new SocialAgencyRuntime({ root });
  const state = rt._read();
  const id = clientId || state.activeClientId || state.clients?.[0]?.id;
  if (!id) throw new Error("ยังไม่มีลูกค้าในแอป");
  const client = state.clients.find((c) => c.id === id);
  if (!client) throw new Error(`ไม่พบลูกค้า "${id}"`);
  const secret = (rt._getSecrets(id).linkedin) || {};
  return {
    clientId: id,
    clientName: client.name,
    accessToken: secret.accessToken || "",
    authorUrn: secret.authorUrn || "",
    dryRun: client.connectors?.linkedin?.dryRun !== false,
    tokenSavedAt: client.connectors?.linkedin?.tokenSavedAt || null,
  };
}

function pasteBlock({ token, urn, member, expiresAt }) {
  const lines = [];
  lines.push("── คัดลอกไปวางใน Social Agency → Connectors → LinkedIn ─────────");
  lines.push(`  Member Access Token : ${token}`);
  lines.push(`  Author URN          : ${urn}`);
  lines.push(`  บัญชี LinkedIn      : ${member || "(ไม่ทราบชื่อ)"}`);
  if (expiresAt) lines.push(`  หมดอายุประมาณ      : ${expiresAt} (อีก ~${TOKEN_LIFETIME_DAYS} วัน)`);
  lines.push("────────────────────────────────────────────────────────────────");
  return lines.join("\n");
}

function curlSnippet({ clientId, clientSecret, redirect, code, token }) {
  const oauth = oauthHost();
  const api = apiHost();
  const lines = ["# 1) แลก code เป็น token", `curl -X POST https://${oauth}${TOKEN_PATH} \\`];
  lines.push(`  -H 'Content-Type: application/x-www-form-urlencoded' \\`);
  lines.push(`  -d 'grant_type=authorization_code' \\`);
  lines.push(`  -d 'code=${code || "CODE_FROM_REDIRECT_URL"}' \\`);
  lines.push(`  -d 'redirect_uri=${redirect || "REDIRECT_URL"}' \\`);
  lines.push(`  -d 'client_id=${clientId || "CLIENT_ID"}' \\`);
  lines.push(`  -d 'client_secret=${clientSecret || "CLIENT_SECRET"}'`);
  lines.push("");
  lines.push("# 2) ดูว่า token เป็นของใคร (ได้ sub → urn:li:person:sub)");
  lines.push(`curl -s https://${api}${USERINFO_PATH} -H 'Authorization: Bearer ${token ? mask(token) : "ACCESS_TOKEN"}'`);
  return lines.join("\n");
}

async function main(args = parseArgs(process.argv.slice(2))) {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  const root = path.resolve(args.root || process.env.LUKE_SA_ROOT || DEFAULT_ROOT);

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args.curl) {
    say(curlSnippet({
      clientId: args["client-id"] || process.env.LUKE_LI_CLIENT_ID,
      clientSecret: args["client-secret"] ? "‹redacted›" : process.env.LUKE_LI_CLIENT_SECRET ? "‹redacted›" : "",
      redirect: args.redirect || process.env.LUKE_LI_REDIRECT,
      code: args.code,
    }));
    return 0;
  }

  // ── --check: verify what is already stored, no OAuth round trip ──────────
  if (args.check) {
    const stored = readStoredToken({ root, clientId: args.client });
    say(`ลูกค้า: ${stored.clientName} (${stored.clientId})`);
    if (!stored.accessToken) {
      say("✗ ยังไม่มี token ของ LinkedIn ใน Connectors");
      say(`  วิธีได้มา: node scripts/social-agency-linkedin-token.cjs --prompt --save --client ${stored.clientId}`);
      return 1;
    }
    const member = await fetchMember({ accessToken: stored.accessToken, host: apiHost() });
    const match = member.urn === stored.authorUrn;
    say(`✓ token ใช้ได้ — บัญชี ${member.name || "(ไม่ทราบชื่อ)"} (${member.urn})`);
    say(match
      ? `✓ Author URN ในแอปตรงกับ token (${stored.authorUrn})`
      : `✗ Author URN ในแอปคือ ${stored.authorUrn || "(ว่าง)"} ไม่ตรงกับ token — กด "ทดสอบและดึง URN" หรือใช้ --save เพื่อแก้`);
    if (stored.dryRun) say("! dry-run ของ LinkedIn ยังเปิดอยู่ — โพสต์จริงจะไม่ถูกส่งจนกว่าจะปิดใน Connectors");
    if (stored.tokenSavedAt) {
      const age = Math.floor((Date.now() - Date.parse(stored.tokenSavedAt)) / 86400000);
      say(`  บันทึก token ไว้เมื่อ ${stored.tokenSavedAt.slice(0, 10)} (${age} วันก่อน) — อายุราว ${TOKEN_LIFETIME_DAYS} วัน`);
    } else {
      say("  ไม่รู้ว่า token นี้วางเมื่อไร — ใช้ --save อีกครั้งเพื่อเริ่มนับอายุให้ตัวตรวจความพร้อม");
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        ok: match,
        clientId: stored.clientId,
        member: { name: member.name, urn: member.urn },
        authorUrn: stored.authorUrn,
        dryRun: stored.dryRun,
        tokenSavedAt: stored.tokenSavedAt,
      }, null, 2)}\n`);
    }
    return match ? 0 : 1;
  }

  // ── collect inputs ──────────────────────────────────────────────────────
  let clientId = sanitizeHiddenLine(args["client-id"] || process.env.LUKE_LI_CLIENT_ID || "");
  let clientSecret = sanitizeHiddenLine(args["client-secret"] || process.env.LUKE_LI_CLIENT_SECRET || "");
  let redirect = sanitizeHiddenLine(args.redirect || process.env.LUKE_LI_REDIRECT || "");
  // The state is a CSRF guard: it must be the one that went into the authorize
  // URL. It is random by default; --state exists for scripted runs where the
  // authorize step happened somewhere else.
  const state = sanitizeHiddenLine(args.state || "") || newState();

  if (args.prompt) {
    say("กด Enter เพื่อใช้ค่าจาก env (ถ้ามี) หรือพิมพ์ค่าใหม่ (ค่าที่เป็นความลับจะไม่แสดงบนจอ)");
    if (!clientId) {
      clientId = await promptHidden("Client ID: ");
      say(`  = ${clientId ? describeValue(clientId, { secret: false }) : "(ว่าง)"}`);
    }
    if (!clientSecret) {
      clientSecret = await promptHidden("Client Secret: ");
      say(`  = ${describeValue(clientSecret)}`);
    }
    if (!redirect) {
      redirect = await promptHidden("Redirect URL (ที่ลงทะเบียนในแอป): ");
      say(`  = ${redirect || "(ว่าง)"}`);
    }
  }
  // Hidden prompts give no feedback, so the Client ID lands in the Client Secret
  // box sooner or later; without this it only surfaces as a 401 from LinkedIn.
  if (clientId && clientSecret && clientSecret === clientId) {
    throw new Error("ช่อง Client Secret ได้ Client ID มา (ค่าเดียวกัน) — Client Secret คืออีกค่าหนึ่งในหน้า Auth ของแอป (มักขึ้นต้น WPL_) ไม่ใช่ Client ID");
  }
  if (!clientId) throw new Error("ต้องมี Client ID — ใส่ --client-id หรือรันด้วย --prompt");
  if (!clientSecret) throw new Error("ต้องมี Client Secret — ใส่ --client-secret หรือรันด้วย --prompt");
  if (!redirect) throw new Error("ต้องมี Redirect URL — ใส่ --redirect หรือรันด้วย --prompt");

  let code = args.code ? sanitizeHiddenLine(args.code) : "";
  let callbackState = null;
  if (!code && args.callback) {
    const parsed = extractCode(args.callback, { state });
    code = parsed.code;
    callbackState = parsed.state;
  }

  if (!code) {
    const authorizeUrl = buildAuthorizeUrl({ clientId, redirect, state, host: oauthHost() });
    say("");
    say("1) เปิดลิงก์นี้ในเบราว์เซอร์ (หรือกดเปิดให้อัตโนมัติ) แล้วกด Allow");
    say("");
    say(authorizeUrl);
    say("");
    if (process.platform === "darwin") {
      execFile("open", [authorizeUrl], () => {});
      say("   (เปิดเบราว์เซอร์ให้แล้ว)");
    } else if (process.platform === "linux") {
      execFile("xdg-open", [authorizeUrl], () => {});
    }
    say("2) เบราว์เซอร์จะเด้งไปที่ Redirect URL ของคุณ — หน้านั้นอาจขึ้น error ก็ไม่เป็นไร");
    say("   ก๊อป URL จากแถบที่อยู่ทั้งบรรทัด (มี ?code=…&state=…) มาวางด้านล่าง");
    const parsed = await readCallback({ state, sayFn: say });
    code = parsed.code;
    callbackState = parsed.state;
  }
  if (args.code && !args.callback) {
    say("หมายเหตุ: ใส่ --code ตรง ๆ จึงไม่ได้ตรวจ state — ถ้าเป็นไปได้ใช้ --callback เพื่อตรวจว่าลิงก์มาจากการเข้าสู่ระบบครั้งนี้จริง");
  }
  if (!path.isAbsolute(root) && !fs.existsSync(root)) throw new Error(`ไม่พบโฟลเดอร์โปรเจกต์: ${root}`);

  // ── exchange + identify ─────────────────────────────────────────────────
  const exchanged = await exchangeCode({ clientId, clientSecret, redirect, code, host: oauthHost() });
  const member = await fetchMember({ accessToken: exchanged.accessToken, host: apiHost() });
  const expiresAt = expiryDate(exchanged.expiresIn);

  say("");
  say(`✓ ได้ token ของ ${member.name || "(ไม่ทราบชื่อ)"} (${member.urn})`);
  if (expiresAt) say(`  หมดอายุประมาณ ${expiresAt} — LinkedIn ไม่มี refresh token สำหรับ member token`);
  say(`  สิทธิ์ที่ได้: ${exchanged.scope}`);

  let saved = null;
  if (args.save) {
    saved = saveToApp({ root, clientId: args.client, accessToken: exchanged.accessToken, authorUrn: member.urn });
    say("");
    say(`✓ บันทึกลง connectors.json แล้ว — ลูกค้า ${saved.clientName} (${saved.clientId})`);
    say(`  token ${mask(exchanged.accessToken)} · Author URN ${member.urn}`);
    say("  ขั้นถัดไป: เปิดแอป → Connectors → LinkedIn → ปิด dry-run → ทดสอบการเชื่อมต่อ");
    say(`  ตรวจซ้ำได้ด้วย: node scripts/social-agency-linkedin-token.cjs --check --client ${saved.clientId}`);
  } else {
    say("");
    say(pasteBlock({ token: exchanged.accessToken, urn: member.urn, member: member.name, expiresAt }));
    say("(หรือบันทึกอัตโนมัติด้วย --save --client CLIENT_ID)");
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      member: { name: member.name, urn: member.urn, sub: member.sub },
      scope: exchanged.scope,
      expiresIn: exchanged.expiresIn,
      expiresAt,
      saved: saved ? { clientId: saved.clientId, clientName: saved.clientName } : null,
      token: args.save && !args.reveal ? undefined : exchanged.accessToken,
    }, null, 2)}\n`);
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code ?? 0; }).catch((err) => {
    process.stderr.write(`✗ ${err.message || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  buildAuthorizeUrl,
  extractCode,
  salvageCode,
  describeReceived,
  readCallback,
  exchangeCode,
  fetchMember,
  expiryDate,
  newState,
  mask,
  redact,
  saveToApp,
  readStoredToken,
  curlSnippet,
  main,
  SCOPES,
};
