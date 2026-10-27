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

/**
 * Where does this address live, and may we call it?
 *
 * Self-hosted forums are the reason this is not a boolean. A company Discourse
 * on 192.168.1.20 is a legitimate target when the owner says so; the cloud
 * metadata service on 169.254.169.254 never is. So addresses are classified
 * first, and the caller's policy decides afterwards:
 *
 *   loopback  127.0.0.0/8, ::1   — a server on this machine
 *   private   10/8, 172.16/12, 192.168/16, fc00::/7 — a server on this LAN
 *   linklocal 169.254/16, fe80::/10 — includes the metadata endpoint: NEVER
 *   cgnat     100.64/10          — carrier NAT, not your network: never
 *   reserved  0/8, 224+/4, ::    — not a real host: never
 *   public    everything else
 */
function classifyIpv4(ip) {
  const parts = String(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "reserved";
  const [a, b] = parts;
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "linklocal";
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  if (a === 0 || a >= 224) return "reserved";
  return "public";
}

function classifyIpv6(ip) {
  const value = String(ip).toLowerCase().replace(/^\[(.+)\]$/, "$1");
  if (value === "::1") return "loopback";
  if (value === "::") return "reserved";
  if (value.startsWith("fe80")) return "linklocal";
  if (value.startsWith("fc") || value.startsWith("fd")) return "private";
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyIpv4(mapped[1]);
  return "public";
}

function classifyAddress(address) {
  const family = net.isIP(String(address));
  if (family === 4) return classifyIpv4(address);
  if (family === 6) return classifyIpv6(address);
  return "reserved";
}

// `isPrivateIpv4`/`isPrivateIpv6` are the older, blunter question ("not public")
// that tests and callers use; the classifier above is the one the guard needs.
function isPrivateIpv4(ip) {
  return classifyIpv4(ip) !== "public";
}

function isPrivateIpv6(ip) {
  return classifyIpv6(ip) !== "public";
}

/**
 * Turn the caller's options into something answerable.
 *   (nothing)               public only
 *   allowLocalDev           + loopback, + http (a server on this machine)
 *   allowLocalNetwork       + loopback, + private LAN, + http (a forum you run)
 * link-local, CGNAT and reserved space are refused under every policy.
 */
function networkPolicy(options = {}) {
  if (options.allowLocalNetwork) return { name: "local", allowHttp: true, loopback: true, private: true };
  if (options.allowLocalDev) return { name: "loopback", allowHttp: true, loopback: true, private: false };
  return { name: "public", allowHttp: false, loopback: false, private: false };
}

function addressAllowed(kind, policy) {
  if (kind === "public") return true;
  if (kind === "loopback") return policy.loopback;
  if (kind === "private") return policy.private;
  // linklocal (cloud metadata), cgnat and reserved are never a legitimate
  // publishing target, so no policy opens them.
  return false;
}

/**
 * Validate an outbound URL. Throws with a readable reason; returns the parsed
 * URL on success. Exported because the tests (and the UI preview) need exactly
 * the same rule the request will use.
 */
function assertSafeOutboundUrl(rawUrl, options = {}) {
  const policy = networkPolicy(options);
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("URL ปลายทางไม่ถูกต้อง");
  }
  if (url.username || url.password) throw new Error("URL ต้องไม่ฝัง username/password");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && policy.allowHttp)) {
    throw new Error(
      policy.allowHttp
        ? "ปลายทางต้องเป็น http:// หรือ https://"
        : "ปลายทางต้องเป็น https:// (เปิด “เซิร์ฟเวอร์นี้อยู่ในเครื่อง/ในบ้าน” เฉพาะตอนที่มันเป็นเซิร์ฟเวอร์ของคุณเอง)"
    );
  }
  // URL keeps the brackets on IPv6 literals ("[::1]"); strip them so the
  // classifier sees the address the socket will actually use.
  const host = url.hostname.toLowerCase().replace(/^\[(.+)\]$/, "$1");
  if (!host) throw new Error("URL ไม่มีชื่อโฮสต์");

  const family = net.isIP(host);
  if (family) {
    const kind = classifyAddress(host);
    if (!addressAllowed(kind, policy)) throw blockMessage(kind, host, policy);
  } else if (host === "localhost") {
    if (!policy.loopback) throw blockMessage("loopback", host, policy);
  } else if (host.endsWith(".local") || host.endsWith(".internal")) {
    // mDNS/.internal names resolve on the local network only; they are never a
    // public publishing target, so they need the same opt-in as a LAN address.
    if (!policy.private) throw blockMessage("private", host, policy);
  }

  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("พอร์ตปลายทางไม่ถูกต้อง");
  }
  return url;
}

function blockMessage(kind, host, policy) {
  const where = {
    loopback: "เครื่องนี้ (loopback)",
    private: "เครือข่ายภายใน (LAN)",
    linklocal: "ที่อยู่ link-local / cloud metadata",
    cgnat: "ช่วง CGNAT ของผู้ให้บริการ",
    reserved: "ที่อยู่สงวน",
  }[kind] || "ที่อยู่ภายใน";
  const hint = kind === "private" && !policy.private
    ? " — ถ้าเป็นฟอรัมของคุณเอง ให้เปิด “เซิร์ฟเวอร์นี้อยู่ในเครื่อง/ในบ้าน” ในช่องทางนั้น"
    : "";
  return new Error(`ไม่อนุญาตให้ยิงไปยัง${where} (${host})${hint}`);
}

async function resolveAndCheck(url, options = {}) {
  const policy = networkPolicy(options);
  const host = url.hostname.toLowerCase().replace(/^\[(.+)\]$/, "$1");
  if (net.isIP(host)) return; // already checked
  // A literal name for this machine, or a LAN-only name, was decided above.
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return;
  let addresses = [];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (error) {
    throw new Error(`หาโดเมน ${host} ไม่พบ (${error.code || error.message})`);
  }
  if (!addresses.length) throw new Error(`หาโดเมน ${host} ไม่พบ`);
  // A public name can point at 127.0.0.1 or at the metadata endpoint: the answer
  // is checked with the same policy as a literal address.
  for (const entry of addresses) {
    const kind = entry.family === 4 ? classifyIpv4(entry.address) : classifyIpv6(entry.address);
    if (!addressAllowed(kind, policy)) throw blockMessage(kind, `${host} → ${entry.address}`, policy);
  }
}

// Only headers a publishing API actually needs. Anything cookie-ish, and any
// header that could rewrite the request (Host, Content-Length, X-HTTP-Method…),
// is dropped before sending.
//
// The forum entries are not decoration: Discourse authenticates with
// `Api-Key`/`Api-Username`, XenForo with `XF-Api-Key` (+ `XF-Api-User` for a
// super-user key), and the phpBB extension with `X-API-Key`. Without them a
// forum post is sent unauthenticated and comes back 401, which reads as "the
// forum does not allow posting" instead of "the key header was dropped".
//
// The list stays static on purpose. Letting a channel declare its own extra
// headers would turn this from an allowlist into a pass-through the first time
// someone added a plan that needed one.
const ALLOWED_HEADERS = new Set([
  "content-type",
  "authorization",
  "accept",
  "user-agent",
  "api-key",
  "api-username",
  "xf-api-key",
  "xf-api-user",
  "x-api-key",
]);

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
async function runPlan(plan, { variables = {}, allowLocalDev = false, allowLocalNetwork = false } = {}) {
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
    const response = await sendRequest(
      { method: filled.method, url: filled.url, headers: filled.headers, body: bodyText },
      { allowLocalDev, allowLocalNetwork },
    );
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
  ALLOWED_HEADERS,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  TIMEOUT_MS,
  addressAllowed,
  assertSafeOutboundUrl,
  classifyAddress,
  classifyIpv4,
  classifyIpv6,
  fillPlaceholders,
  isPrivateIpv4,
  isPrivateIpv6,
  networkPolicy,
  resolveAndCheck,
  runPlan,
  sanitizeHeaders,
  sendRequest,
};
