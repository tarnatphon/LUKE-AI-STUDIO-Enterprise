"use strict";

/**
 * Online media generation — phase 4, with every billable path removed.
 *
 * Frontier image/video generation has no recurring free tier in 2026. The
 * card-backed trial-credit offers (Fal.ai, Veo via GCP, Stability AI) were
 * removed outright at the owner's request: anything that costs money or needs
 * a payment card is not registered here at all. Only a no-card free daily
 * allowance remains.
 *
 * What is left is still not automatic:
 *
 *   - the surface must be switched on by the owner in Settings;
 *   - the provider must be the declared no-card free allowance;
 *   - the quoted allowance must fit inside what is left for today;
 *   - the owner must send explicitConsent AND budgetConfirmed on THIS request;
 *   - and even then the default is a dry run. `live: true` is a separate,
 *     deliberate flag.
 *
 * A missing consent is a 400, not a silent dispatch. No paid provider exists
 * in this module, and it never reads a key from the chat chain.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SPEND_FILE = path.join(ROOT, "app", "runtime-state", "online-media", "spend.json");

// Fal.ai ($20 card-backed trial), Veo via GCP ($300 card-backed trial) and
// Stability AI (card-backed trial) used to be here. All three needed a payment
// card, so all three were deleted — not hidden behind a consent checkbox.
const PROVIDERS = Object.freeze({
  kling_free: {
    id: "kling_free",
    label: "Kling free daily allowance (no card)",
    kind: "video",
    grantedCredits: 6,
    noCard: true,
    freeAllowance: true,
    host: "https://klingai.com",
    note: "A small recurring free daily allowance reported in 2026. When it is spent LUKE falls back to the local image/video engines; there is no paid upgrade registered.",
  },
});

const COSTS = Object.freeze({ image: 1, video: 4, audio: 1 });

function spendFile() {
  const override = String(process.env.LUKE_ONLINE_MEDIA_SPEND_FILE || "").trim();
  return override || DEFAULT_SPEND_FILE;
}

function readSpend() {
  try {
    const parsed = JSON.parse(fs.readFileSync(spendFile(), "utf8"));
    const spent = {};
    for (const id of Object.keys(PROVIDERS)) {
      const value = Number(parsed?.spent?.[id]);
      spent[id] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    return spent;
  } catch {
    const spent = {};
    for (const id of Object.keys(PROVIDERS)) spent[id] = 0;
    return spent;
  }
}

function writeSpend(spent) {
  const file = spendFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ spent, savedAt: new Date().toISOString() }, null, 2)}\n`, {
    mode: 0o600,
  });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function providers() {
  const spent = readSpend();
  return Object.values(PROVIDERS).map((provider) => ({
    ...provider,
    spent: spent[provider.id],
    remaining: Math.max(0, provider.grantedCredits - spent[provider.id]),
  }));
}

function quote(providerId, kind = "image") {
  const provider = PROVIDERS[String(providerId || "").trim()];
  if (!provider) {
    const error = new Error(`Unknown media provider: ${providerId}.`);
    error.statusCode = 400;
    throw error;
  }
  const credits = COSTS[String(kind)] || COSTS.image;
  const spent = readSpend()[provider.id];
  const remaining = Math.max(0, provider.grantedCredits - spent);
  const reasons = [];

  if (!provider.freeAllowance || provider.noCard !== true) {
    reasons.push("This provider is not a registered no-card free allowance.");
  }
  if (credits > remaining) reasons.push("Today's free allowance is spent.");

  return {
    providerId: provider.id,
    label: provider.label,
    kind: String(kind),
    credits,
    grantedCredits: provider.grantedCredits,
    spent,
    remaining,
    noCard: provider.noCard === true,
    eligible: reasons.length === 0,
    reasons,
  };
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Consent is checked before anything is written to the ledger and before any
 * transport is called. `options.transport(url, init)` is injectable.
 */
async function generate(request = {}, options = {}) {
  const providerId = String(request.providerId || "").trim();
  const kind = String(request.kind || "image");
  const prompt = String(request.prompt || "").trim();
  const quoted = quote(providerId, kind);

  if (!prompt) throw httpError("A prompt is required.");
  if (!quoted.eligible) throw httpError(quoted.reasons.join(" "));
  if (request.explicitConsent !== true) {
    throw httpError("This needs explicitConsent: true on this request. LUKE never starts an online media job by itself.");
  }
  if (request.budgetConfirmed !== true) {
    throw httpError("Confirm the quoted free allowance with budgetConfirmed: true.");
  }

  const recordEgress = typeof options.recordEgress === "function" ? options.recordEgress : () => {};
  const dryRun = request.live !== true;
  const bytes = Buffer.byteLength(prompt);

  recordEgress({
    surface: "online-media",
    provider: providerId,
    url: PROVIDERS[providerId].host,
    method: "POST",
    bytes,
    decision: dryRun ? "blocked" : "allowed",
    reason: dryRun ? "consented dry run" : "consented free-allowance dispatch",
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      providerId,
      quote: quoted,
      message: "Consent recorded. Nothing was sent; repeat with live: true to dispatch.",
    };
  }

  const transport = typeof options.transport === "function"
    ? options.transport
    : async (url, init) => {
      const response = await fetch(url, init);
      return { status: response.status, body: await response.text() };
    };

  const upstream = await transport(`${PROVIDERS[providerId].host}/v1/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, prompt, credits: quoted.credits }),
  });

  const spent = readSpend();
  spent[providerId] += quoted.credits;
  writeSpend(spent);

  return {
    ok: true,
    dryRun: false,
    providerId,
    quote: quoted,
    spent: spent[providerId],
    upstream,
  };
}

function resetSpend() {
  const spent = {};
  for (const id of Object.keys(PROVIDERS)) spent[id] = 0;
  writeSpend(spent);
  return spent;
}

module.exports = {
  PROVIDERS,
  COSTS,
  spendFile,
  providers,
  quote,
  generate,
  resetSpend,
  DEFAULT_SPEND_FILE,
};
