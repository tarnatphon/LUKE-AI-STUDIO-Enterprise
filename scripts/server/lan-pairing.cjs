"use strict";

/**
 * LAN pairing — the server already binds 0.0.0.0, so "online" needs a door.
 *
 * Default-deny: a request that is not from this computer gets 403 until the
 * owner opens Settings on the machine itself and pairs the device. Loopback is
 * always trusted, which is why every existing validation suite (all of which
 * talk to 127.0.0.1) keeps working unchanged. Static assets and the pairing
 * handshake stay reachable so a phone can load the UI and present its token.
 *
 * The token is generated once, returned once, and never readable again.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_FILE = path.join(ROOT, "app", "runtime-state", "lan", "pairing.json");
const HANDSHAKE_PATHS = new Set([
  "/api/health",
  "/api/online-surfaces/status",
  "/api/lan/status",
  "/api/lan/pair",
]);

function pairingFile() {
  const override = String(process.env.LUKE_LAN_PAIRING_FILE || "").trim();
  return override || DEFAULT_FILE;
}

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(pairingFile(), "utf8"));
    return {
      enabled: parsed?.enabled === true,
      token: typeof parsed?.token === "string" ? parsed.token : "",
      pairedAt: typeof parsed?.pairedAt === "string" ? parsed.pairedAt : "",
    };
  } catch {
    return { enabled: false, token: "", pairedAt: "" };
  }
}

function write(state) {
  const file = pairingFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

/** Turn LAN access on and hand back a fresh token exactly once. */
function pair() {
  const state = {
    enabled: true,
    token: crypto.randomBytes(24).toString("hex"),
    pairedAt: new Date().toISOString(),
  };
  write(state);
  return { enabled: true, token: state.token, pairedAt: state.pairedAt };
}

function revoke() {
  write({ enabled: false, token: "", pairedAt: "" });
  return { enabled: false };
}

function status() {
  const state = read();
  return {
    enabled: state.enabled,
    pairedAt: state.pairedAt || null,
    tokenHint: state.token ? `…${state.token.slice(-6)}` : "",
    file: path.relative(ROOT, pairingFile()),
    note: "The pairing token is shown once when you pair; it is never returned again.",
  };
}

function isLoopback(req) {
  const remote = String(req?.socket?.remoteAddress || "");
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1" ||
    remote.startsWith("127.")
  );
}

function suppliedToken(req, pathname) {
  const header = String(req?.headers?.["x-luke-pair"] || "").trim();
  if (header) return header;
  try {
    const url = new URL(String(req?.url || pathname), "http://localhost");
    return String(url.searchParams.get("pair") || "").trim();
  } catch {
    return "";
  }
}

/** Constant-time compare that tolerates different lengths. */
function safeEqual(expected, supplied) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorize(req, pathname) {
  if (isLoopback(req)) return { allowed: true, reason: "this computer" };
  if (req?.method === "OPTIONS") return { allowed: true, reason: "preflight" };
  if (!String(pathname || "").startsWith("/api/")) {
    return { allowed: true, reason: "static asset" };
  }
  if (HANDSHAKE_PATHS.has(pathname)) {
    return { allowed: true, reason: "pairing handshake" };
  }

  const state = read();
  if (!state.enabled) {
    return {
      allowed: false,
      reason: "This device is not paired. Open LUKE on the host computer, go to Settings > Online surfaces, and turn on 'Allow other devices'.",
    };
  }

  const supplied = suppliedToken(req, pathname);
  if (!supplied || !state.token || !safeEqual(state.token, supplied)) {
    return {
      allowed: false,
      reason: "This device is not paired, or its pairing token is wrong. Pair it again from the host computer.",
    };
  }

  return { allowed: true, reason: "paired device" };
}

module.exports = {
  pairingFile,
  read,
  pair,
  revoke,
  status,
  isLoopback,
  safeEqual,
  authorize,
  HANDSHAKE_PATHS,
};
