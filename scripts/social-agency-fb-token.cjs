#!/usr/bin/env node
"use strict";

/*
 * Social Agency — Facebook Page token helper.
 *
 * Turns the three-token ladder Meta forces on you into one command:
 *
 *   short-lived user token  (Graph API Explorer, ~1-2h)
 *        ↓  GET /oauth/access_token  grant_type=fb_exchange_token
 *   long-lived user token   (~60 days)
 *        ↓  GET /me/accounts
 *   Page token with no expiration date  → paste into Connectors
 *
 * The last step is the one people skip, and it is the whole difference between
 * a Page token that works and one that dies 24 hours later: a Page token minted
 * from a *short-lived* user token inherits that expiry. So this script refuses
 * to hand you a token it cannot confirm — every Page token is run through
 * /debug_token and checked for `expires_at = 0`, `type = PAGE`, and the scopes
 * the publisher in scripts/server/social-agency-runtime.cjs actually needs
 * (pages_manage_posts for /feed, /photos and /videos).
 *
 * Nothing here talks to the app's state files. It only reads from Meta and
 * prints what to paste; connectors.json stays the app's business, and the token
 * never lands in your shell history when you use --prompt.
 *
 * Usage
 *   node scripts/social-agency-fb-token.cjs --prompt            (asks for everything)
 *   node scripts/social-agency-fb-token.cjs --page PAGE_ID --prompt
 *   node scripts/social-agency-fb-token.cjs --app-id ID --app-secret SECRET --token SHORT
 *   node scripts/social-agency-fb-token.cjs --page PAGE_ID --prompt
 *   node scripts/social-agency-fb-token.cjs --check --prompt
 *   node scripts/social-agency-fb-token.cjs --curl --app-id ID --app-secret SECRET --token SHORT
 *
 * Test-only escape hatch (used by the offline smoke test; Meta is the only sane
 * value in production): LUKE_FB_GRAPH_HOST / LUKE_FB_GRAPH_PORT / LUKE_FB_GRAPH_TLS=0.
 */

const https = require("node:https");
const http = require("node:http");

const DEFAULT_GRAPH_VERSION = "v25.0";
// Kept in sync with GRAPH_VERSION_EXPIRY in scripts/server/social-agency-runtime.cjs.
const KNOWN_GRAPH_VERSIONS = new Set(["v21.0", "v22.0", "v23.0", "v24.0", "v25.0", "v26.0"]);
const NEEDED_SCOPES = ["pages_manage_posts"];
const USEFUL_SCOPES = ["pages_read_engagement", "pages_manage_engagement", "read_insights"];
const HTTP_TIMEOUT_MS = 20000;

// ── args ─────────────────────────────────────────────────────────────────────
const BOOLEAN_FLAGS = new Set(["help", "prompt", "curl", "json", "reveal", "strict", "check"]);

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
Social Agency — Facebook Page token helper

  --prompt                     ถามหา App ID / App Secret / token ตอนรัน (ไม่บันทึกลง shell history)
  --app-id <id>                App ID จาก App Dashboard → Settings → Basic
  --app-secret <secret>        App Secret (ถ้าไม่ใส่จะใช้วิธีถาม หรือ env LUKE_FB_APP_SECRET)
  --token <short-lived>        User Access Token จาก Graph API Explorer (หรือ env LUKE_FB_USER_TOKEN)
  --page <pageId>              ขอ token ของเพจนี้เพจเดียว แล้วพิมพ์เต็มให้คัดลอก
  --check                      ไม่ exchange อะไรเลย — แค่ตรวจ token ที่ให้มาใน --token ผ่าน /debug_token
  --version <v25.0>            Graph API version (ค่าเริ่มต้น ${DEFAULT_GRAPH_VERSION})
  --json                       ผลเป็น JSON สำหรับ pipe ต่อ
  --reveal                     แสดง token เต็มทุกตัวในตาราง (ปกติปิดบัง 6 ตัวท้าย)
  --strict                     ถ้า token หมดอายุ/สิทธิ์ไม่ครบ ให้ exit code ผิด (ใช้กับ CI)
  --curl                       ไม่ต่อเน็ต — พิมพ์คำสั่ง curl เทียบเท่าให้ไปรันเอง

ค่าที่ได้เอาไปวางใน Social Agency → Connectors → Facebook Page
(ช่อง "Page ID" และ "Page Access Token (long-lived)")

env: LUKE_FB_APP_ID, LUKE_FB_APP_SECRET, LUKE_FB_USER_TOKEN

ตัวอย่าง
  node scripts/social-agency-fb-token.cjs --prompt
  node scripts/social-agency-fb-token.cjs --page 1784123456789 --prompt
  node scripts/social-agency-fb-token.cjs --check --prompt
`;

// ── tiny io ──────────────────────────────────────────────────────────────────
function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

let warnedOffHost = false;
function graphRequest(method, urlPath) {
  const host = process.env.LUKE_FB_GRAPH_HOST || "graph.facebook.com";
  if (!warnedOffHost && host !== "graph.facebook.com" && !isLoopback(host)) {
    warnedOffHost = true;
    process.stderr.write(`! LUKE_FB_GRAPH_HOST=${host} เป็นค่าสำหรับทดสอบเท่านั้น — App Secret และ token กำลังถูกส่งไปยังโฮสต์นี้\n`);
  }
  const port = process.env.LUKE_FB_GRAPH_PORT ? Number(process.env.LUKE_FB_GRAPH_PORT) : undefined;
  const useTls = process.env.LUKE_FB_GRAPH_TLS !== "0";
  const lib = useTls ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({ host, port, method, path: urlPath, headers: { Accept: "application/json" }, timeout: HTTP_TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode || 0, json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`หมดเวลารอ ${host} (${HTTP_TIMEOUT_MS / 1000} วินาที) — เช็คเน็ต/VPN แล้วลองใหม่`)));
    req.on("error", (err) => reject(new Error(`ติดต่อ ${host} ไม่สำเร็จ: ${err.message}`)));
    req.end();
  });
}

// Meta likes to echo the input token back inside its error text; scrub anything
// token-shaped before it reaches the terminal (and therefore a scrollback file).
// Only real-looking secrets are string-replaced — a 1-char arg must not eat every
// occurrence of that letter out of the message.
function redact(text, secrets = []) {
  let out = String(text == null ? "" : text);
  for (const secret of secrets.filter((s) => typeof s === "string" && s.length >= 12)) out = out.split(secret).join("‹redacted›");
  return out.replace(/\b(EA[A-Za-z0-9\-_]{20,}|AAAA[A-Za-z0-9\-_]{20,})\b/g, "‹redacted›");
}

function mask(token) {
  const v = String(token || "");
  if (!v) return "(ไม่มี)";
  if (v.length <= 10) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-6)}`;
}

let stdinQueue = null;
async function collectPipedLines() {
  if (stdinQueue) return stdinQueue;
  let buf = "";
  if (process.stdin.readable && !process.stdin.readableEnded) {
    process.stdin.setEncoding("utf8");
    await new Promise((resolve) => {
      process.stdin.on("data", (chunk) => { buf += chunk; });
      process.stdin.once("end", resolve);
      process.stdin.once("close", resolve);
      process.stdin.resume();
    });
    process.stdin.pause();
  }
  stdinQueue = buf.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return stdinQueue;
}

async function promptHidden(question) {
  if (!process.stdin.isTTY) {
    // Piped in (e.g. `printf '%s\n%s\n' TOKEN SECRET | ... --prompt`): consume one
    // line per prompt, so several prompts work and nothing echoes to a terminal.
    const lines = await collectPipedLines();
    const next = lines.shift();
    if (!next) throw new Error("ป้อนค่าไม่ครบ — stdin หมดก่อน (ต้องมี 1 บรรทัดต่อค่าที่ถาม) หรือใส่ --app-id/--app-secret/--token แทน");
    return next;
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let line = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    process.stdout.write(question);
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(line);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\nยกเลิกแล้ว\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          line = line.slice(0, -1);
          continue;
        }
        if (ch >= " ") line += ch; // ignore escapes/ctrl; typed chars only
      }
    };
    stdin.on("data", onData);
    stdin.once("error", reject);
  });
}

function ask(label, preset) {
  if (preset) return Promise.resolve(String(preset).trim());
  return promptHidden(`${label}: `);
}

const qs = (params) => Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const table = (rows) => {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join("  ").trimEnd()).join("\n");
};

function fmtExpiry(expiresAt) {
  if (!expiresAt || Number(expiresAt) === 0) return "never";
  return new Date(Number(expiresAt) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// ── graph calls ──────────────────────────────────────────────────────────────
async function graphGet(version, urlPath, secrets) {
  const res = await graphRequest("GET", `/${version}${urlPath}`);
  if (res.status >= 400 || res.json?.error) {
    const msg = res.json?.error?.message || `Meta ตอบ HTTP ${res.status}${res.text ? `: ${res.text.slice(0, 200)}` : ""}`;
    throw new Error(redact(msg, secrets));
  }
  if (!res.json) throw new Error(redact(`Meta ตอบกลับมาไม่ใช่ JSON (${res.text.slice(0, 120)})`, secrets));
  return res.json;
}

async function exchangeLongLivedUserToken({ appId, appSecret, userToken, version }) {
  const body = await graphGet(version, `/oauth/access_token?${qs({
    grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken,
  })}`, [appSecret, userToken]);
  if (!body.access_token) throw new Error("Meta ไม่คืน access_token — ตรวจว่า App ID/App Secret ตรงกัน และ token ยังไม่หมดอายุ");
  return { token: body.access_token, expiresIn: Number(body.expires_in || 0) };
}

async function fetchPages({ longLivedUserToken, version }) {
  // Only fields that are always readable for a page you manage: asking for
  // `engagement`/`website` on a token without the matching permission makes Meta
  // fail the whole call with (#100) instead of omitting the field.
  const body = await graphGet(version, `/me/accounts?${qs({
    fields: "id,name,access_token,category", access_token: longLivedUserToken,
  })}`, [longLivedUserToken]);
  return Array.isArray(body.data) ? body.data : [];
}

async function debugToken({ inputToken, appId, appSecret, version }) {
  const body = await graphGet(version, `/debug_token?${qs({ input_token: inputToken, access_token: `${appId}|${appSecret}` })}`, [appSecret, inputToken]);
  const d = body.data || {};
  return {
    id: d.id || null,
    appId: d.app_id || null,
    type: d.type || null,
    valid: Boolean(d.valid),
    issuedAt: d.issued_at || null,
    expiresAt: d.expires_at ?? null,
    scopes: Array.isArray(d.scopes) ? d.scopes : [],
  };
}

// ── verdicts ─────────────────────────────────────────────────────────────────
function judge(page, info) {
  const problems = [];
  const notes = [];
  if (!info.valid) problems.push("Meta ไม่รับ token นี้ (valid=false)");
  if (info.type && info.type !== "PAGE") problems.push(`type = ${info.type} — ไม่ใช่ Page token อย่าเอาไปใส่ช่องนี้`);
  if (info.expiresAt) problems.push(`หมดอายุ ${fmtExpiry(info.expiresAt)} — นี่คือ short-lived-derived token ต้องเริ่มที่ long-lived user token ใหม่ (ขั้นที่ 4 → 5)`);
  const missing = NEEDED_SCOPES.filter((s) => !info.scopes.includes(s));
  if (missing.length) problems.push(`สิทธิ์ ${missing.join(", ")} หายไป — โพสต์จะถูกปฏิเสธด้วย (#200) ต้องติ๊กใน Graph API Explorer แล้วออก token ใหม่`);
  const useful = USEFUL_SCOPES.filter((s) => info.scopes.includes(s));
  if (useful.length) notes.push(useful.join(", "));
  if (info.appId && page.checkedAppId && String(info.appId) !== String(page.checkedAppId)) {
    notes.push(`token นี้ออกให้แอป ${info.appId} ซึ่งไม่ตรงกับ App ID ที่กรอก — เช็คว่าเลือกแอปถูกตัว`);
  }
  return { ok: problems.length === 0, problems, notes };
}

function pasteBlock(page, token) {
  return [
    "── วางใน Social Agency → Connectors → Facebook Page ─────────────",
    `  Page ID                     ${page.id}`,
    `  Page Access Token (long-lived)  ${token}`,
    `  เพจ                         ${page.name || "(ไม่ทราบชื่อ)"}`,
    "  เก็บไว้ใน app/runtime-state/social-agency/connectors.json (gitignored)",
    "  อย่า git add, อย่าแคป, อย่าวางในแชท/กลุ่ม",
    "────────────────────────────────────────────────────────────────",
  ].join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return 0; }

  const version = args.version || DEFAULT_GRAPH_VERSION;
  // Validate with the app's own gate first, so a version the connector would
  // reject (unlisted, or past Meta's sunset date) fails here too and the two
  // never disagree. If the runtime can't be loaded, fall back to a shape check.
  let checkedByApp = true;
  try {
    // eslint-disable-next-line global-require
    const { SocialAgencyRuntime } = require("./server/social-agency-runtime.cjs");
    SocialAgencyRuntime._graphVersion(version);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/ไม่รองรับ|หมดอายุ/.test(msg)) throw new Error(`Graph API version "${version}" — ${msg}`);
    checkedByApp = false;
  }
  if (!checkedByApp && !KNOWN_GRAPH_VERSIONS.has(version)) {
    throw new Error(`Graph API version "${version}" ไม่อยู่ในรายการที่แอปนี้รองรับ (${[...KNOWN_GRAPH_VERSIONS].join(", ")})`);
  }

  let appId = args["app-id"] || process.env.LUKE_FB_APP_ID || "";
  let appSecret = args["app-secret"] || process.env.LUKE_FB_APP_SECRET || "";
  let userToken = args.token || process.env.LUKE_FB_USER_TOKEN || "";

  // --curl: no secrets needed, no network — just show what would run.
  if (args.curl) {
    const a = appId || "APP_ID", s = appSecret || "APP_SECRET", t = userToken || "SHORT_LIVED_USER_TOKEN";
    process.stdout.write(`# 1) short-lived user token → long-lived user token (~60 วัน) — รันฝั่งเซิร์ฟเวอร์เท่านั้น เพราะมี App Secret
curl -sG "https://graph.facebook.com/${version}/oauth/access_token" \\
  -d grant_type=fb_exchange_token -d client_id=${a} -d client_secret=${s} \\
  -d fb_exchange_token=${t}

# 2) long-lived user token → Page token (ไม่มีวันหมดอายุ)
curl -sG "https://graph.facebook.com/${version}/me/accounts" \\
  -d fields=id,name,access_token,category -d access_token=LONG_LIVED_USER_TOKEN

# 3) ตรวจว่า "หมดอายุ: ไม่เคย" จริง
curl -sG "https://graph.facebook.com/${version}/debug_token" \\
  -d input_token=PAGE_ACCESS_TOKEN -d access_token="${a}|${s}"
`);
    return 0;
  }

  const mode = args.check ? "check" : "mint";

  // --prompt asks for whatever is still missing, including the App ID, so the
  // whole setup can be one command with no secret on the visible command line.
  if (args.prompt) {
    if (!appId) appId = await ask("  App ID (App Dashboard → Settings → Basic)");
    if (!userToken) {
      if (mode === "mint") process.stdout.write("User Access Token (สั้น) จาก Graph API Explorer — ใช้แค่แลกตัวจริง แล้วทิ้งได้\n");
      userToken = await ask(mode === "check" ? "  token ที่ต้องการตรวจ" : "  short-lived user token");
    }
    if (!appSecret) appSecret = await ask("  App Secret");
  }
  if (!appId) throw new Error("ขาด --app-id (ดูใน App Dashboard → Settings → Basic) หรือ env LUKE_FB_APP_ID — หรือใส่ --prompt ให้ถาม");
  if (!userToken) throw new Error(mode === "check"
    ? "ขาด --token สำหรับ --check (หรือใส่ --prompt ให้ถาม)"
    : "ขาด --token (User Access Token จาก Graph API Explorer) หรือ env LUKE_FB_USER_TOKEN — ถ้าไม่ต้องการพิมพ์ในคำสั่งใส่ --prompt");
  if (!appSecret) throw new Error("ขาด --app-secret หรือ env LUKE_FB_APP_SECRET — หรือใส่ --prompt ให้ถาม");

  const wantPage = mode === "mint" && args.page ? String(args.page).trim() : null;
  if (mode === "check" && args.page) process.stderr.write("! --check ตรวจ token ที่กรอกมาโดยตรง — --page ไม่มีผลในโหมดนี้\n");
  const say = (s) => { if (!args.json) process.stdout.write(`${s}\n`); };

  say(`Graph API ${version} · app ${appId}`);

  let pages = [];
  let usedUserToken = userToken;

  if (mode === "mint") {
    say("→ แลก long-lived user token (60 วัน) …");
    const exchanged = await exchangeLongLivedUserToken({ appId, appSecret, userToken, version });
    usedUserToken = exchanged.token;
    say(`  ✓ ได้ long-lived user token (${exchanged.expiresIn ? `อยู่ได้ ${Math.round(exchanged.expiresIn / 86400)} วัน` : "ไม่ระบุอายุ"}) — token นี้เป็นความลับเช่นกัน แต่ไม่ต้องเอาไปวางที่ไหน`);
    say("→ อ่าน /me/accounts …");
    pages = await fetchPages({ longLivedUserToken: exchanged.token, version });
    if (!pages.length) {
      say("  ✗ บัญชีนี้ไม่มีเพจใน /me/accounts — คุณต้องเป็น admin ของเพจ และต้องติ๊กสิทธิ์ pages_show_list + เลือกเพจในหน้าต่างอนุญาตของ Graph API Explorer");
      return 2;
    }
    say(`  ✓ พบ ${pages.length} เพจ`);
  } else {
    say("→ ไม่ exchange อะไร (--check) — ตรวจ token ที่ให้มาโดยตรง");
    pages = [{ id: null, name: "(token ที่กรอกเอง)", access_token: userToken }];
  }

  const selected = wantPage ? pages.filter((p) => String(p.id) === wantPage) : pages;
  if (wantPage && !selected.length) {
    say(`  ✗ ไม่พบเพจ ${wantPage} ในรายการเพจของคุณ — ID ที่ให้มาเป็น Page ID จริงหรือยัง?`);
    say(`    เพจที่มี: ${pages.map((p) => `${p.name || "?"} (${p.id})`).join(", ")}`);
    return 2;
  }

  const rows = [["PAGE ID", "NAME", "EXPIRES", "TYPE", "VALID", "SCOPES", "TOKEN"]];
  const results = [];
  for (const page of selected) {
    const info = await debugToken({ inputToken: page.access_token, appId, appSecret, version });
    const verdict = judge({ ...page, checkedAppId: appId }, info);
    const pageId = page.id || info.id || null;
    const revealThis = Boolean(args.reveal || wantPage || mode === "check");
    rows.push([
      pageId || "—",
      (page.name || "—").slice(0, 28),
      fmtExpiry(info.expiresAt),
      info.type || "—",
      info.valid ? "yes" : "NO",
      verdict.ok ? "ครบ" : "ขาดสิทธิ์",
      revealThis ? page.access_token : mask(page.access_token),
    ]);
    results.push({ pageId, name: page.name, token: page.access_token, debug: info, ok: verdict.ok, problems: verdict.problems, notes: verdict.notes });
    for (const problem of verdict.problems) say(`  ✗ ${page.name || pageId || "token"}: ${problem}`);
  }
  say("");
  say(table(rows));
  say("");

  const good = results.filter((r) => r.ok);
  if (!good.length) {
    say(args.check
      ? "token นี้ยังไม่พร้อมใช้กับ Social Agency — แก้ตามข้อ ✗ ข้างบนแล้วตรวจใหม่"
      : "ยังไม่มีเพจไหนที่ผ่าน — แก้ตามข้อ ✗ ข้างบนแล้วรันใหม่");
    return args.strict ? 1 : 0;
  }

  if (wantPage || mode === "check") {
    const hit = good[0];
    say(pasteBlock({ id: hit.pageId, name: mode === "check" ? null : hit.name }, hit.token));
  } else {
    say("เลือกเพจที่จะโพสต์ แล้วรันซ้ำด้วย --page เพื่อรับ token เต็มสำหรับวาง:");
    say(`  node scripts/social-agency-fb-token.cjs --page ${good[0].pageId} --prompt`);
    say("(หรือดูทั้งหมดทันทีด้วย --reveal — ระวังคนมองจอ/scrollback)");
  }
  const first = good[0];
  if (first.notes?.length) say(`หมายเหตุสิทธิ์ที่พบ: ${first.notes.join(" · ")}`);
  say("ขั้นถัดไป: วางใน Connectors → กด ทดสอบการเชื่อมต่อ ให้ขึ้น \"เชื่อมต่อสำเร็จ — หน้า …\" แล้วปิด dry-run");
  if (mode === "mint") {
    say("จำไว้: 'never' = ไม่มีนาฬิกานับถอยหลัง ไม่ใช่ไม่มีวันตาย — เปลี่ยนรหัสผ่านfb / ถอดแอป / เสียสิทธิ์เพจ = error 190 แล้วต้องทำใหม่");
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      version, appId, pages: results.map((r) => ({
        pageId: r.pageId, name: r.name, ok: r.ok, problems: r.problems, notes: r.notes,
        expiresAt: r.debug.expiresAt, type: r.debug.type, scopes: r.debug.scopes,
        token: (args.reveal || wantPage || mode === "check") ? r.token : undefined,
      })),
    }, null, 2)}\n`);
  }
  return 0;
}

main().then((code) => { process.exitCode = code ?? 0; }).catch((err) => {
  process.stderr.write(`✗ ${err.message || err}\n`);
  process.exitCode = 1;
});
