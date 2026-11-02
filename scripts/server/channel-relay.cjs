"use strict";

/**
 * Channel relay — use LUKE from Telegram, Discord or LINE without moving the
 * studio off this machine.
 *
 * Webhook mode, not a long-running poller: the platform calls LUKE, LUKE
 * answers through the same platform API. Nothing listens on a socket in the
 * background, nothing calls out when the surface is off, and tokens live in a
 * 0600 file that is never returned to the browser.
 *
 * `transport` and `recordEgress` are injectable so the whole module can be
 * exercised against a stand-in with no network access at all.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_FILE = path.join(ROOT, "app", "runtime-state", "channels", "config.json");

const PLATFORMS = Object.freeze({
  telegram: {
    id: "telegram",
    label: "Telegram",
    host: "https://api.telegram.org",
    docs: "BotFather → /setwebhook with a secret token",
  },
  discord: {
    id: "discord",
    label: "Discord",
    host: "https://discord.com",
    docs: "Discord Developer Portal → Interactions Endpoint",
  },
  line: {
    id: "line",
    label: "LINE",
    host: "https://api.line.me",
    docs: "LINE Developers Console → Messaging API webhook",
  },
});

function configFile() {
  const override = String(process.env.LUKE_CHANNEL_RELAY_FILE || "").trim();
  return override || DEFAULT_FILE;
}

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    const platforms = {};
    for (const id of Object.keys(PLATFORMS)) {
      const entry = parsed?.platforms?.[id];
      if (entry && typeof entry === "object") {
        platforms[id] = {
          token: typeof entry.token === "string" ? entry.token : "",
          webhookSecret: typeof entry.webhookSecret === "string" ? entry.webhookSecret : "",
        };
      } else {
        platforms[id] = { token: "", webhookSecret: "" };
      }
    }
    return { enabled: parsed?.enabled === true, platforms };
  } catch {
    const platforms = {};
    for (const id of Object.keys(PLATFORMS)) platforms[id] = { token: "", webhookSecret: "" };
    return { enabled: false, platforms };
  }
}

function write(state) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function status() {
  const state = read();
  return {
    enabled: state.enabled,
    platforms: Object.values(PLATFORMS).map((platform) => ({
      id: platform.id,
      label: platform.label,
      docs: platform.docs,
      configured: Boolean(state.platforms[platform.id]?.token),
      hasWebhookSecret: Boolean(state.platforms[platform.id]?.webhookSecret),
    })),
    file: path.relative(ROOT, configFile()),
  };
}

function configure(patch = {}) {
  const state = read();
  const platformId = String(patch.platform || "").trim();

  if (platformId && !PLATFORMS[platformId]) {
    const error = new Error(`Unknown channel: ${platformId}. Use telegram, discord or line.`);
    error.statusCode = 400;
    throw error;
  }
  if (typeof patch.enabled === "boolean") state.enabled = patch.enabled;

  if (platformId) {
    const entry = state.platforms[platformId];
    if (patch.token !== undefined) entry.token = String(patch.token || "").trim();
    if (patch.webhookSecret !== undefined) {
      entry.webhookSecret = String(patch.webhookSecret || "").trim();
    }
    if (patch.disconnect === true) {
      entry.token = "";
      entry.webhookSecret = "";
    }
  }

  write(state);
  return status();
}

function safeEqual(expected, supplied) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  if (a.length !== b.length || !a.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Verify an inbound webhook before any message is acted on. */
function verifyWebhook(platformId, body, headers = {}) {
  const platform = PLATFORMS[String(platformId || "").trim()];
  if (!platform) return { ok: false, reason: "Unknown channel." };

  const state = read();
  if (!state.enabled) return { ok: false, reason: "Channel relay is switched off." };

  const expected = state.platforms[platform.id]?.webhookSecret || "";
  if (!expected) return { ok: true, reason: "No webhook secret is configured." };

  const supplied =
    String(headers["x-telegram-bot-api-secret-token"] || "") ||
    String(headers["x-luke-channel-secret"] || "");

  if (platform.id === "line") {
    const raw = typeof body === "string" ? body : JSON.stringify(body || {});
    const digest = crypto.createHmac("sha256", expected).update(raw).digest("base64");
    return safeEqual(digest, String(headers["x-line-signature"] || ""))
      ? { ok: true, reason: "LINE signature verified" }
      : { ok: false, reason: "LINE signature did not match." };
  }

  if (platform.id === "discord") {
    const signature = String(headers["x-signature-ed25519"] || "");
    return signature
      ? { ok: true, reason: "Discord signature header present" }
      : { ok: false, reason: "Discord signature header is missing." };
  }

  return safeEqual(expected, supplied)
    ? { ok: true, reason: "Telegram secret token verified" }
    : { ok: false, reason: "Webhook secret did not match." };
}

function endpointFor(platformId, entry, payload) {
  const token = String(entry?.token || "").trim();
  if (!token) return null;

  if (platformId === "telegram") {
    return { url: `${PLATFORMS.telegram.host}/bot${token}/sendMessage`, body: { chat_id: payload.chatId, text: payload.text } };
  }
  if (platformId === "discord") {
    return { url: `${PLATFORMS.discord.host}/api/v10/channels/${encodeURIComponent(String(payload.channelId || ""))}/messages`, body: { content: payload.text } };
  }
  return { url: `${PLATFORMS.line.host}/v2/bot/message/push`, body: { to: payload.userId, messages: [{ type: "text", text: payload.text }] } };
}

/**
 * Send one reply. Returns a plan when `dryRun` is set, and never touches the
 * network when the surface is off or the channel has no token.
 */
async function send(platformId, payload = {}, options = {}) {
  const platform = PLATFORMS[String(platformId || "").trim()];
  if (!platform) {
    const error = new Error(`Unknown channel: ${platformId}.`);
    error.statusCode = 400;
    throw error;
  }

  const state = read();
  const text = String(payload.text || "").trim();
  if (!text) {
    const error = new Error("A reply needs text.");
    error.statusCode = 400;
    throw error;
  }
  if (!state.enabled) {
    const error = new Error("Channel relay is switched off in Settings > Online surfaces.");
    error.statusCode = 403;
    throw error;
  }

  const target = endpointFor(platform.id, state.platforms[platform.id], payload);
  if (!target) {
    const error = new Error(`${platform.label} is not configured yet. Save its bot token first.`);
    error.statusCode = 400;
    throw error;
  }

  const recordEgress = typeof options.recordEgress === "function" ? options.recordEgress : () => {};
  const bytes = Buffer.byteLength(JSON.stringify(target.body));

  if (payload.dryRun === true) {
    recordEgress({
      surface: "channel-relay",
      provider: platform.id,
      // Only the host is handed to the ledger. Telegram's endpoint carries the
      // bot token in the path; that must never leave this module, not even in
      // an injected recorder used by a test.
      url: platform.host,
      method: "POST",
      bytes,
      decision: "blocked",
      reason: "dry run",
    });
    return { ok: true, dryRun: true, provider: platform.id, host: platform.host, bytes };
  }

  const transport = typeof options.transport === "function"
    ? options.transport
    : async (url, init) => {
      const response = await fetch(url, init);
      return { status: response.status, body: await response.text() };
    };

  recordEgress({
    surface: "channel-relay",
    provider: platform.id,
    url: platform.host,
    method: "POST",
    bytes,
    reason: "channel reply",
  });

  const result = await transport(target.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(target.body),
  });

  return { ok: true, dryRun: false, provider: platform.id, host: platform.host, bytes, upstream: result };
}

module.exports = {
  PLATFORMS,
  configFile,
  read,
  status,
  configure,
  verifyWebhook,
  send,
  DEFAULT_FILE,
};
