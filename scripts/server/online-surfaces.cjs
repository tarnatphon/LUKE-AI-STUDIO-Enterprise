"use strict";

/**
 * Online surfaces — the single switchboard for the free-cloud policy.
 *
 * One small, owner-only config file decides whether Chat may borrow a free
 * brain, whether the "no filter" lane overrides everything, and whether the
 * LAN / MCP / channel surfaces are open. The no-filter and air-gap lanes are
 * off until the owner turns them on; online-first Chat is on because the owner
 * asked for it explicitly.
 *
 * No-pay is NOT a setting. Every provider that billed, needed a card, was
 * prepaid, or was a card-backed trial credit was removed from the catalogue
 * and from the transport registry outright. The external media subsystem was
 * deleted too: images, video and audio are generated locally. There is no
 * `freeOnly` switch to turn off, so a stale key or a hand-edited config cannot
 * buy anything.
 *
 * `airGapMode` is the hard stop: with it on, no cloud turn is attempted at all
 * and every would-be departure is recorded as blocked, which is what makes the
 * Egress Ledger's attestation meaningful rather than aspirational.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_FILE = path.join(ROOT, "app", "runtime-state", "online-surfaces", "config.json");

const aiCatalog = require("./ai-provider-catalog.cjs");
const egressLedger = require("./egress-ledger.cjs");
const lanPairing = require("./lan-pairing.cjs");

/** Exported so tests and the UI can state the invariant without a switch. */
const NO_PAY = true;

const DEFAULTS = Object.freeze({
  cloudForChat: true,
  uncensoredMode: false,
  airGapMode: false,
  gatewayEnabled: true,
  mcpEnabled: true,
  channelsEnabled: false,
  rateLimitRetry: 0,
});

function configFile() {
  const override = String(process.env.LUKE_ONLINE_SURFACES_FILE || "").trim();
  return override || DEFAULT_FILE;
}

function getConfig() {
  let stored = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    if (parsed && typeof parsed === "object") stored = parsed;
  } catch {}

  const config = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof stored[key] === "boolean") config[key] = stored[key];
  }
  if (Number.isInteger(stored.rateLimitRetry)) {
    config.rateLimitRetry = Math.min(3, Math.max(0, stored.rateLimitRetry));
  }
  return config;
}

function setConfig(patch = {}) {
  const config = getConfig();
  const changed = [];

  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] === undefined) continue;
    if (key === "rateLimitRetry") {
      const value = Number(patch[key]);
      if (!Number.isFinite(value)) {
        const error = new Error("rateLimitRetry must be a number between 0 and 3.");
        error.statusCode = 400;
        throw error;
      }
      config[key] = Math.min(3, Math.max(0, Math.floor(value)));
    } else {
      if (typeof patch[key] !== "boolean") {
        const error = new Error(`${key} must be true or false.`);
        error.statusCode = 400;
        throw error;
      }
      config[key] = patch[key];
    }
    changed.push(key);
  }

  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ ...config, savedAt: new Date().toISOString() }, null, 2)}\n`, {
    mode: 0o600,
  });
  try { fs.chmodSync(file, 0o600); } catch {}

  return { config, changed };
}

/** The policy the live chat route and the chain both read. */
function policy() {
  return getConfig();
}

/** Is a cloud turn allowed at all for this request? */
function cloudDecision(assistantMode) {
  const config = getConfig();
  const mode = assistantMode === "work" ? "work" : "chat";

  if (config.airGapMode === true) {
    return { allowed: false, mode, reason: "Air-gap mode is on: no cloud turn is attempted." };
  }
  if (config.uncensoredMode === true) {
    return { allowed: false, mode, reason: "No-filter lane is on: this turn stays on the local GGUF model." };
  }
  if (mode === "chat" && config.cloudForChat !== true) {
    return { allowed: false, mode, reason: "Online-first Chat is switched off in Settings." };
  }
  return { allowed: true, mode, reason: "Work turn" };
}

function badge() {
  const config = getConfig();
  const egress = egressLedger.stats();

  if (config.airGapMode) return { id: "air-gap", label: "Air-gap", tone: "safe" };
  if (config.uncensoredMode) return { id: "local-only", label: "No-filter local", tone: "safe" };
  if (egress.allowed > 0 && egress.paidCalls === 0) {
    return { id: "free-cloud", label: "Free cloud", tone: "online" };
  }
  if (config.cloudForChat) return { id: "online-ready", label: "Online-ready", tone: "online" };
  return { id: "offline", label: "Offline by default", tone: "safe" };
}

function status() {
  const catalog = aiCatalog.summary();
  return {
    config: getConfig(),
    defaults: { ...DEFAULTS },
    noPay: NO_PAY,
    badge: badge(),
    catalog: {
      verifiedAt: catalog.verifiedAt,
      file: catalog.file,
      count: catalog.count,
      freeCount: catalog.freeCount,
      transportCount: catalog.transportCount,
    },
    egress: egressLedger.stats(),
    lan: lanPairing.status(),
    file: path.relative(ROOT, configFile()),
  };
}

module.exports = {
  DEFAULTS,
  NO_PAY,
  configFile,
  getConfig,
  setConfig,
  policy,
  cloudDecision,
  badge,
  status,
  DEFAULT_FILE,
};
