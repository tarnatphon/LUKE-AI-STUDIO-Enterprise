"use strict";

/**
 * Free-credit media generation — "use the free usage, then fall back to local".
 *
 * The owner's definition of "เสียตังค์" (costing money) is *having to pay in
 * order to keep using something*. It is not "this vendor also sells a paid
 * plan". So a no-card daily allowance AND a card-backed trial grant are both
 * usable free usage: LUKE spends the grant, and when it is gone it stops. It
 * never tops up, never upgrades, never reads or stores card data, and hands
 * the job straight to the local Stable Diffusion / Whisper / Kokoro /
 * image-to-video engines.
 *
 * The card, where one is required, is bound by the owner on the provider's own
 * site. LUKE only ever sees a credit balance. Passing a card number, a CVV, a
 * billing object, or an "auto top up" flag to this module is a 400.
 *
 * Gates on every single job:
 *   - the surface must be switched on by the owner in Settings;
 *   - the provider must be one of the declared free-credit providers;
 *   - the quoted credits must fit inside the grant minus what was spent;
 *   - explicitConsent AND creditConfirmed must be sent on THIS request;
 *   - and even then the default is a dry run. `live: true` is a separate flag.
 *
 * An exhausted grant, or a 402 / "insufficient credits" from upstream, is a
 * REFUSAL with `fallback: "local"` — never a prompt to pay.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SPEND_FILE = path.join(ROOT, "app", "runtime-state", "online-media", "spend.json");

/**
 * `requiresCard` is informational only: it says the owner had to bind a card
 * on the provider's site to receive the grant. It never means LUKE holds card
 * data, and it never gates a request (there is no `cardConfirmed` path).
 */
const PROVIDERS = Object.freeze({
  fal_trial: {
    id: "fal_trial",
    label: "Fal.ai trial credit",
    kind: "video",
    grantedCredits: 20,
    requiresCard: true,
    cardBoundOnProviderSite: true,
    freeWhileCreditsLast: true,
    paid: false,
    allowance: "one-time",
    exhaustion: "local",
    host: "https://fal.ai",
    note: "Reported ~$20 of starting credit. Free to use until it is spent; verify the current offer on the provider's pricing page before confirming.",
  },
  veo_gcp_trial: {
    id: "veo_gcp_trial",
    label: "Google Veo via GCP trial credit",
    kind: "video",
    grantedCredits: 300,
    requiresCard: true,
    cardBoundOnProviderSite: true,
    freeWhileCreditsLast: true,
    paid: false,
    allowance: "one-time",
    exhaustion: "local",
    host: "https://cloud.google.com",
    note: "$300 cloud trial, card bound on the provider's site. Free to use until it is spent, never a recurring tier.",
  },
  stability_trial: {
    id: "stability_trial",
    label: "Stability AI trial credit",
    kind: "image",
    grantedCredits: 25,
    requiresCard: true,
    cardBoundOnProviderSite: true,
    freeWhileCreditsLast: true,
    paid: false,
    allowance: "one-time",
    exhaustion: "local",
    host: "https://stability.ai",
    note: "One-time trial credit for image/video generation. Free to use until it is spent.",
  },
  kling_free: {
    id: "kling_free",
    label: "Kling free daily allowance (no card)",
    kind: "video",
    grantedCredits: 6,
    requiresCard: false,
    cardBoundOnProviderSite: false,
    freeWhileCreditsLast: true,
    paid: false,
    allowance: "daily",
    exhaustion: "local",
    host: "https://klingai.com",
    note: "A small recurring daily allowance reported in 2026. It starts over each UTC day; probe availability before use.",
  },
});

const COSTS = Object.freeze({ image: 1, video: 4, audio: 1 });

/** Any of these in a request is an attempt to make LUKE pay. Refuse it. */
const PAYMENT_FIELDS = Object.freeze([
  "cardNumber", "card_number", "card", "cvv", "cvc", "expiry", "billing",
  "payment", "paymentMethod", "payment_method", "autoTopUp", "topUp",
  "topup", "allowPaid", "paidPlan", "upgrade", "subscription", "checkout",
  "cardConfirmed", "budget", "invoice",
]);

/** LUKE never spends money. This is a fact about the code, not a switch. */
const NEVER_PAYS = true;

function spendFile() {
  const override = String(process.env.LUKE_ONLINE_MEDIA_SPEND_FILE || "").trim();
  return override || DEFAULT_SPEND_FILE;
}

/** UTC calendar day — deterministic, and the only clock this module reads. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

function blankSpend() {
  const spent = {};
  for (const id of Object.keys(PROVIDERS)) spent[id] = 0;
  return spent;
}

/**
 * The spend file stores a credit counter and nothing else: no card, no key,
 * no prompt, no upstream body. `allowance: "daily"` grants start over on a new
 * day; one-time trials never reset, because that would be inventing credit.
 */
function readSpend() {
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(spendFile(), "utf8")); } catch { /* no file yet */ }
  const day = today();
  const spent = blankSpend();
  for (const provider of Object.values(PROVIDERS)) {
    const value = Number(parsed?.spent?.[provider.id]);
    let used = Number.isFinite(value) && value >= 0 ? value : 0;
    if (provider.allowance === "daily" && String(parsed?.day || "") !== day) used = 0;
    spent[provider.id] = used;
  }
  return { spent, day };
}

function writeSpend(spent) {
  const file = spendFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ spent, day: today(), savedAt: new Date().toISOString() }, null, 2)}\n`, {
    mode: 0o600,
  });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function providers() {
  const { spent } = readSpend();
  return Object.values(PROVIDERS).map((provider) => {
    const used = spent[provider.id];
    const remaining = Math.max(0, provider.grantedCredits - used);
    return {
      ...provider,
      spent: used,
      remaining,
      eligible: remaining > 0,
      exhausted: remaining === 0,
      localFallbackOnExhaustion: true,
    };
  });
}

function quote(providerId, kind = "image") {
  const provider = PROVIDERS[String(providerId || "").trim()];
  if (!provider) {
    const error = new Error(`Unknown media provider: ${providerId}.`);
    error.statusCode = 400;
    error.code = "unknown_provider";
    throw error;
  }
  const credits = COSTS[String(kind)] ?? COSTS.image;
  const { spent } = readSpend();
  const used = spent[provider.id];
  const remaining = Math.max(0, provider.grantedCredits - used);
  const reasons = [];

  if (!provider.freeWhileCreditsLast) reasons.push("This provider is not a registered free-credit provider.");
  if (provider.paid !== false) reasons.push("This provider is billable and is not registered.");
  if (credits > remaining) {
    reasons.push("The free credit is spent. LUKE will not top up or pay; use the local engine instead.");
  }

  return {
    providerId: provider.id,
    label: provider.label,
    kind: String(kind),
    credits,
    grantedCredits: provider.grantedCredits,
    spent: used,
    remaining,
    requiresCard: provider.requiresCard,
    cardBoundOnProviderSite: provider.cardBoundOnProviderSite,
    allowance: provider.allowance,
    eligible: reasons.length === 0,
    exhausted: credits > remaining,
    reasons,
    fallback: "local",
    neverPays: NEVER_PAYS,
  };
}

function httpError(message, statusCode = 400, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function assertNoPaymentFields(request) {
  const found = PAYMENT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(request, field));
  if (found.length > 0 || request.paid === true) {
    throw httpError(
      `LUKE never stores card data, tops up credit or pays. Remove: ${found.concat(request.paid === true ? ["paid"] : []).join(", ")}.`,
      400,
      { code: "payment_field_rejected", fallback: "local" },
    );
  }
}

/**
 * Consent is checked before anything is written to the ledger and before any
 * transport is called. `options.transport(url, init)` is injectable so the
 * validation suites never touch the network.
 */
async function generate(request = {}, options = {}) {
  const providerId = String(request.providerId || "").trim();
  const kind = String(request.kind || "image");
  const prompt = String(request.prompt || "").trim();
  const recordEgress = typeof options.recordEgress === "function" ? options.recordEgress : () => {};

  assertNoPaymentFields(request);
  const quoted = quote(providerId, kind);

  if (!prompt) throw httpError("A prompt is required.", 400, { code: "prompt_required" });

  if (!quoted.eligible) {
    recordEgress({
      surface: "online-media",
      provider: providerId,
      url: PROVIDERS[providerId].host,
      method: "POST",
      bytes: Buffer.byteLength(prompt),
      decision: "blocked",
      reason: "free credit exhausted; no top-up, no payment, falling back to local engine",
    });
    throw httpError(quoted.reasons.join(" "), 409, {
      code: "free_credit_exhausted",
      exhausted: true,
      fallback: "local",
    });
  }

  if (request.explicitConsent !== true) {
    throw httpError("This needs explicitConsent: true on this request. LUKE never starts an online media job by itself.", 400, { code: "consent_required" });
  }
  if (request.creditConfirmed !== true) {
    throw httpError("Confirm the quoted free credit with creditConfirmed: true.", 400, { code: "credit_confirmation_required" });
  }

  const dryRun = request.live !== true;
  const bytes = Buffer.byteLength(prompt);

  recordEgress({
    surface: "online-media",
    provider: providerId,
    url: PROVIDERS[providerId].host,
    method: "POST",
    bytes,
    decision: dryRun ? "blocked" : "allowed",
    reason: dryRun ? "consented dry run (no credit spent)" : "consented free-credit dispatch (no payment)",
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      providerId,
      quote: quoted,
      neverPaid: true,
      message: "Consent recorded. Nothing was sent; repeat with live: true to spend free credit.",
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

  // A 402, a quota error or a billing notice means the free grant is gone.
  // Mark it spent once, record the refusal, and never try again with money.
  const bodyText = String(upstream?.body ?? "");
  const startedCharging = upstream?.status === 402
    || upstream?.status === 403 && /payment|billing|insufficient|credit/i.test(bodyText)
    || /payment required|insufficient[_ -]?credits|quota exceeded|billing/i.test(bodyText);

  const state = readSpend();
  if (startedCharging) {
    state.spent[providerId] = PROVIDERS[providerId].grantedCredits;
    writeSpend(state.spent);
    recordEgress({
      surface: "online-media",
      provider: providerId,
      url: PROVIDERS[providerId].host,
      method: "POST",
      bytes,
      decision: "blocked",
      reason: "provider started charging; grant marked spent, no payment attempted, falling back to local",
      paid: true,
    });
    throw httpError("The free grant is gone and the provider started charging. LUKE will not pay; use the local engine.", 402, {
      code: "now_paid",
      exhausted: true,
      fallback: "local",
    });
  }

  state.spent[providerId] += quoted.credits;
  writeSpend(state.spent);

  return {
    ok: true,
    dryRun: false,
    providerId,
    quote: quoted,
    spent: state.spent[providerId],
    remaining: Math.max(0, PROVIDERS[providerId].grantedCredits - state.spent[providerId]),
    exhausted: state.spent[providerId] >= PROVIDERS[providerId].grantedCredits,
    fallback: "local",
    neverPaid: true,
    upstream,
  };
}

function resetSpend() {
  const spent = blankSpend();
  writeSpend(spent);
  return spent;
}

module.exports = {
  PROVIDERS,
  COSTS,
  PAYMENT_FIELDS,
  NEVER_PAYS,
  spendFile,
  providers,
  quote,
  generate,
  resetSpend,
  readSpend,
  DEFAULT_SPEND_FILE,
};
