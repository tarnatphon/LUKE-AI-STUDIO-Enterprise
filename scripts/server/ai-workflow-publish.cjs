"use strict";

/**
 * Luke AI Workflow — the posting relay.
 *
 * The workflow runs in the browser, but a browser cannot POST to dev.to,
 * telegra.ph, Telegram or a WordPress site: those hosts do not answer CORS
 * preflights for arbitrary origins, so the request dies before it leaves. The
 * local server is the right place for it, and this module is the only place in
 * the app that makes an outbound request chosen by the user.
 *
 * Two rules keep that honest:
 *   1. **Only known channels.** `send()` takes a channel id and builds the
 *      request from `social-publish-channels.cjs`. A workflow cannot invent a
 *      URL for `discord` — the webhook URL is the only per-channel free input,
 *      and it is host-checked below.
 *   2. **Never the local machine or the LAN.** Every outbound URL must be
 *      https (or http to an explicitly allowed dev host), must not resolve to
 *      loopback/private/link-local space, and must not carry credentials in the
 *      URL. This is what stops a pasted "webhook" from being a request to the
 *      app's own admin API or a router page.
 *
 * No retries, no redirects followed, 20 s timeout, response clipped to 64 KB —
 * a workflow step should fail fast and visibly, never hang the run.
 */

const net = require("node:net");
const dns = require("node:dns").promises;

const TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 200 * 1024;

// Hosts that are allowed even without https (local development of a WordPress
// or Mastodon instance you run yourself). Everything else must be https.
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIpv6(ip) {
  const value = ip.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/**
 * Validate an outbound URL. Throws with a readable reason; returns the parsed
 * URL on success. Exported because the tests (and the UI preview) need exactly
 * the same rule the request will use.
 */
function assertSafeOutboundUrl(rawUrl, { allowLocalDev = false } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("URL ปลายทางไม่ถูกต้อง");
  }
  if (url.username || url.password) throw new Error("URL ต้องไม่ฝัง username/password");
  // URL keeps the brackets on IPv6 literals ("[::1]"); strip them so the IP
  // checks below see the address the socket will actually use.
  const host = url.hostname.toLowerCase().replace(/^\[(.+)\]$/, "$1");
  const localHost = LOCAL_DEV_HOSTS.has(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowLocalDev && localHost)) {
    throw new Error("ปลายทางต้องเป็น https:// (หรือ http://localhost สำหรับเซิร์ฟเวอร์ที่รันเองในเครื่อง)");
  }
  if (!host) throw new Error("URL ไม่มีชื่อโฮสต์");
  // IP literal: check directly. Hostname: it is checked after DNS resolution in
  // resolveAndCheck(), because a public name can point at 127.0.0.1.
  const family = net.isIP(host);
  if (family) {
    // Pick the checker by family: running the IPv4 parser on an IPv6 literal
    // would flag every public address as private.
    const isPrivate = family === 4 ? isPrivateIpv4(host) : isPrivateIpv6(host);
    // The deliberate exception is loopback only (a WordPress/Mastodon install on
    // this machine), and only when the caller asks for it. LAN ranges and the
    // cloud metadata address stay blocked even then.
    const loopback = localHost && allowLocalDev;
    if (isPrivate && !loopback) throw new Error("ไม่อนุญาตให้ยิงไปยัง IP ภายใน/เครื่องนี้");
  } else if (/^localhost$/.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    if (!(allowLocalDev && localHost)) throw new Error("ไม่อนุญาตให้ยิงไปยังที่อยู่ในเครื่อง/เครือข่ายภายใน");
  }
  if (url.port && !(allowLocalDev && localHost)) {
    // A non-standard port on a public host is allowed (some self-hosted
    // WordPress/Mastodon setups use one), but never together with a private IP —
    // that combination is already rejected above or below.
    const port = Number(url.port);
    if (port < 1 || port > 65535) throw new Error("พอร์ตปลายทางไม่ถูกต้อง");
  }
  return url;
}

async function resolveAndCheck(url, { allowLocalDev = false } = {}) {
  const host = url.hostname;
  if (net.isIP(host)) return; // already checked
  if (allowLocalDev && LOCAL_DEV_HOSTS.has(host.toLowerCase())) return;
  let addresses = [];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (error) {
    throw new Error(`หาโดเมน ${host} ไม่พบ (${error.code || error.message})`);
  }
  if (!addresses.length) throw new Error(`หาโดเมน ${host} ไม่พบ`);
  for (const entry of addresses) {
    if (entry.family === 4 && isPrivateIpv4(entry.address)) {
      throw new Error(`โดเมน ${host} ชี้ไปยัง IP ภายใน (${entry.address}) — ไม่อนุญาต`);
    }
    if (entry.family === 6 && isPrivateIpv6(entry.address)) {
      throw new Error(`โดเมน ${host} ชี้ไปยัง IP ภายใน (${entry.address}) — ไม่อนุญาต`);
    }
  }
}

// Only headers a publishing API actually needs. Anything cookie-ish, and any
// header that could rewrite the request (Host, Content-Length, X-HTTP-Method…),
// is dropped before sending.
const ALLOWED_HEADERS = new Set(["content-type", "authorization", "accept", "user-agent"]);

function sanitizeHeaders(headers) {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = String(rawKey).toLowerCase().trim();
    if (!ALLOWED_HEADERS.has(key)) continue;
    const value = String(rawValue ?? "").replace(/[\r\n]+/g, " ").slice(0, 2000);
    if (value) out[key] = value;
  }
  return out;
}

// `fetch` hands back a web stream, not a node stream — read it with a reader and
// stop as soon as the cap is reached, so a misbehaving host cannot fill memory.
async function readBodyWithLimit(response) {
  if (!response.body || typeof response.body.getReader !== "function") return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.byteLength;
        chunks.push(Buffer.from(value));
        if (size > MAX_RESPONSE_BYTES) break;
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already done */ }
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, MAX_RESPONSE_BYTES);
}

/**
 * Perform one request. Never follows redirects (a redirect target would not have
 * been checked), always resolves to a small result object.
 */
async function sendRequest({ method = "POST", url, headers = {}, body = "" }, options = {}) {
  const parsed = assertSafeOutboundUrl(url, options);
  await resolveAndCheck(parsed, options);
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) throw new Error("เนื้อหาที่จะส่งใหญ่เกินไป");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(parsed, {
      method: String(method || "POST").toUpperCase(),
      headers: { "user-agent": "LukeAIStudio/1.0 (+local)", ...sanitizeHeaders(headers) },
      body: ["GET", "HEAD"].includes(String(method).toUpperCase()) ? undefined : payload,
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await readBodyWithLimit(response);
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text: json ? "" : text.slice(0, 2000),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`ปลายทางไม่ตอบภายใน ${TIMEOUT_MS / 1000} วินาที`);
    throw new Error(`ส่งไม่สำเร็จ: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Fill `{{name}}` from values captured by an earlier request in the same plan
// (Telegraph's access token) and from the step's own credentials.
function fillPlaceholders(value, variables) {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([\w.-]+)\s*\}\}$/);
    if (whole) return variables[whole[1]] ?? "";
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => String(variables[key] ?? ""));
  }
  if (Array.isArray(value)) return value.map((entry) => fillPlaceholders(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fillPlaceholders(entry, variables)]));
  }
  return value;
}

function pickPath(json, path) {
  return String(path || "").split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), json);
}

/**
 * Run a channel's whole plan, in order, carrying saved values forward.
 * Returns every step's outcome so the run history can show what actually
 * happened (and so a half-published post is visible, not silent).
 */
async function runPlan(plan, { variables = {}, allowLocalDev = false } = {}) {
  const results = [];
  const vars = { ...variables };
  for (const request of plan) {
    const filled = {
      ...request,
      url: fillPlaceholders(request.url, vars),
      headers: fillPlaceholders(request.headers || {}, vars),
      body: fillPlaceholders(request.body, vars),
    };
    const bodyText = typeof filled.body === "string" ? filled.body : JSON.stringify(filled.body);
    const response = await sendRequest({ method: filled.method, url: filled.url, headers: filled.headers, body: bodyText }, { allowLocalDev });
    results.push({ url: filled.url, method: filled.method || "POST", status: response.status, ok: response.ok, json: response.json, text: response.text });
    if (!response.ok) {
      const detail = response.json?.error?.message || response.json?.error || response.json?.message || response.text || "";
      throw new Error(`ปลายทางตอบ ${response.status}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
    }
    if (request.save && response.json) {
      for (const [key, path] of Object.entries(request.save)) {
        const value = pickPath(response.json, path);
        if (value != null) vars[key] = value;
      }
    }
  }
  return { results, variables: vars };
}

module.exports = {
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  TIMEOUT_MS,
  assertSafeOutboundUrl,
  fillPlaceholders,
  isPrivateIpv4,
  isPrivateIpv6,
  resolveAndCheck,
  runPlan,
  sanitizeHeaders,
  sendRequest,
};
