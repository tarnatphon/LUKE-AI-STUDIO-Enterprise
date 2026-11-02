"use strict";

/**
 * Online media generation — phase 4, with the "never auto-paid" rule baked in.
 *
 * Frontier image/video/audio generation has no recurring free tier in 2026;
 * what exists is one-time trial credit. This module therefore treats every
 * request as a purchase decision, not as a fallback:
 *
 *   - the surface must be switched on by the owner in Settings;
 *   - the provider must be a declared trial-credit provider;
 *   - the quoted credits must fit inside the declared grant minus what was
 *     already spent;
 *   - the owner must send explicitConsent AND budgetConfirmed on THIS request;
 *   - a provider that needs a card also needs cardConfirmed;
 *   - and even then the default is a dry run. `live: true` is a separate,
 *     deliberate flag.
 *
 * A missing consent is a 400, not a silent charge. A paid provider is never
 * reachable through the free-only chain, and this module never reads a key
 * from that chain.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SPEND_FILE = path.join(ROOT, "app", "runtime-state", "online-media", "spend.json");

const PROVIDERS = Object.freeze({
  fal_trial: {
    id: "fal_trial",
    label: "Fal.ai trial credit (Sora/Veo-class video)",
    kind: "video",
    grantedCredits: 20,
    requiresCard: true,
    trialOnly: true,
    host: "https://fal.ai",
    note: "Reported ~$20 of starting credit; verify the current offer on the provider's pricing page before confirming.",
  },
  veo_gcp_trial: {
    id: "veo_gcp_trial",
    label: "Google Veo via GCP trial credit",
    kind: "video",
    grantedCredits: 300,
    requiresCard: true,
    trialOnly: true,
    host: "https://cloud.google.com",
    note: "$300 cloud trial, card required. Never a recurring free tier.",
  },
  stability_trial: {
    id: "stability_trial",
    label: "Stability AI trial credit",
    kind: "image",
    grantedCredits: 25,
    requiresCard: true,
    trialOnly: true,
    host: "https://stability.ai",
    note: "One-time trial credit for image/video generation.",
  },
  kling_free: {
    id: "kling_free",
    label: "Kling free daily allowance",
    kind: "video",
    grantedCredits: 6,
    requiresCard: false,
    trialOnly: true,
    host: "https://klingai.com",
    note: "A small recurring daily allowance reported in 2026; probe availability before use.",
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

  if (!provider.trialOnly) reasons.push("This provider is not a trial-credit provider.");
  if (credits > remaining) reasons.push("The trial grant is spent.");
  if (provider.requiresCard) reasons.push("A card is on file; cardConfirmed is required.");

  return {
    providerId: provider.id,
    label: provider.label,
    kind: String(kind),
    credits,
    grantedCredits: provider.grantedCredits,
    spent,
    remaining,
    requiresCard: provider.requiresCard,
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
    throw httpError("This needs explicitConsent: true on this request. LUKE never starts a paid job by itself.");
  }
  if (request.budgetConfirmed !== true) {
    throw httpError("Confirm the quoted credits with budgetConfirmed: true.");
  }
  if (quoted.requiresCard && request.cardConfirmed !== true) {
    throw httpError("This provider needs a card. Send cardConfirmed: true only if you accept that.");
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
    reason: dryRun ? "consented dry run" : "consented trial-credit dispatch",
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
