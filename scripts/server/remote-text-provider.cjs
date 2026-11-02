"use strict";

/**
 * A chain of cloud brains for Work, with this machine as the last link.
 *
 * Work asks a model to read files, edit them, run the project's own checks and
 * read the failure. Locally that lands on a 7B model, which answers by writing
 * the tools out as prose — the thing half the defensive code in this app exists
 * to contain. The cloud fixes it, but no free cloud tier is unlimited: every
 * one of them caps requests per minute, per day, or both, and several died
 * outright this year (Cerebras, GitHub Models, SambaNova).
 *
 * So this is not one provider. It is a chain: each provider is tried in order,
 * a refusal or a rate limit moves to the next, and when the whole chain is
 * spent the local model takes the turn. Nothing the user asked for is lost to
 * somebody else's quota.
 *
 * The chain can also start with a bridge that runs on this machine: Free Claude
 * Code (FCC) is a local proxy that owns the provider catalogue, the keys and
 * its own fallback list. It speaks Anthropic Messages, not Chat Completions,
 * and needs no API key of its own, so it is an opt-in link with its own small
 * transport. Everything below still applies: it is tried first only when the
 * user connects it, and the local model is still the last link.
 *
 * Four rules hold everywhere in this file:
 *
 * 1. The keys belong to this machine. They are written to
 *    `app/runtime-state/text-chat/remote-text-provider.json` — inside the app
 *    folder, mode 0600, gitignored — scrubbed out of every error, and never
 *    returned to the browser, not even masked.
 * 2. Only usable free usage is registered. "เสียตังค์" means having to pay to
 *    KEEP USING, so a recurring free tier or a free trial grant is fine (the
 *    card, where needed, is bound on the provider's site, never here). Anything
 *    prepaid or paid from the first call — the Arena router, OpenAI, xAI, the
 *    paid-only clouds — is deleted, not gated. A 402 is a refusal, not an upsell.
 * 3. A refusal is reported in the user's words. `403
 *    free_router_harness_restricted` means a free router answers only its own
 *    harnesses; `402` means a provider that used to be free now charges — and
 *    LUKE walks to the next free link or the local model, never to a bill.
 * 4. The local path is untouched. With no key saved, nothing here runs.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Where the keys live.
 *
 * The default is inside the app folder — on the external disk with everything
 * else this app keeps, mode 0600, gitignored. The override exists so a test can
 * point the module at a throwaway file instead of writing to the one holding
 * the user's real key. A suite that has to back that file up in memory and
 * restore it in a `finally` is one interrupted run away from destroying it.
 */
const PROVIDER_FILE = process.env.LUKE_REMOTE_PROVIDER_FILE
  ? path.resolve(process.env.LUKE_REMOTE_PROVIDER_FILE)
  : path.join(ROOT, "app", "runtime-state", "text-chat", "remote-text-provider.json");

const DEFAULT_TIMEOUT_MS = 600000;
const PROBE_TIMEOUT_MS = 60000;

/** The local bridge is opt-in: nobody is sent to a socket until it is connected. */
const LOCAL_BRIDGE_ID = "fcc";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// The researched catalogue is the one place that says which links are free,
// which bill, and what each one can read. Everything else in this file obeys
// it; a transport provider missing from the catalogue fails closed (not free).
const aiCatalog = require("./ai-provider-catalog.cjs");
const { normalizeContentParts, textOf, mergeContent } = require("./content-parts.cjs");
const onlineSurfaces = require("./online-surfaces.cjs");

/**
 * A URL written into Settings must not become a way to make this server call
 * an arbitrary host. A local bridge is only ever allowed to point at this
 * machine; a cloud provider only ever points at the https URL in its entry.
 */
function parseBaseUrl(value, { requireLoopback = false } = {}) {
  const raw = String(value == null ? "" : value).trim().replace(/\/+$/, "");
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (requireLoopback && !LOOPBACK_HOSTS.has(host)) return null;

  // FCC serves its API under /v1; accept a bare host and add it for them.
  const path = !parsed.pathname || parsed.pathname === "/"
    ? "/v1"
    : parsed.pathname.replace(/\/+$/, "");

  return `${parsed.protocol}//${parsed.host}${path}`;
}

function localBaseUrlOrThrow(value) {
  const parsed = parseBaseUrl(value, { requireLoopback: true });
  if (!parsed) {
    throw httpError(
      "The local bridge URL must be http://127.0.0.1:<port>/v1 (or localhost / ::1), with no remote host, credentials, query or fragment.",
    );
  }
  return parsed;
}

/**
 * The providers Work can call, in the order they are tried.
 *
 * `model` is a starting point, not a commandment: every one of these catalogues
 * rotates, and a name that exists today may be gone next month. The field is
 * editable in Settings for exactly that reason.
 */
const PROVIDERS = {
  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    // Checked against the provider's own /v1/models list, which needs no key:
    // kimi-k2.5 is not there, kimi-k3 is. A name that does not exist costs a
    // 404 and a wasted link every single turn.
    // 2.8T parameters, 1M context, built for long-horizon agentic work. The
    // same weights cost $1.50-$12.95 per 1M tokens on every OpenRouter endpoint
    // that sells them; NVIDIA serves them for free at 40 requests a minute with
    // no daily quota. That is the best free thing here, which is why it is
    // first, and why the scarce OpenRouter quota is the reserve behind it and
    // not the primary.
    model: "moonshotai/kimi-k3",
    docs: "build.nvidia.com → any model → Get API key",
    note: "The only free catalogue with no daily quota — 40 requests a minute, and that is the whole limit.",
  },
  zai: {
    id: "zai",
    label: "Z.ai (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    // Listed at $0 for input, cached input and output on Z.ai's own pricing
    // page, with 203K of context. The suffix no longer implies free —
    // GLM-5.3-Flash costs money — so the name matters.
    model: "glm-4.7-flash",
    docs: "z.ai → API keys",
    note: "GLM-4.7-Flash is priced at zero per token, not handed out as trial credit. 203K context.",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    // From openrouter.ai/api/v1/models?max_price=0&supported_parameters=tools,
    // read 2026-09-22: 19 models, every one priced "0" for prompt and
    // completion, all tool-capable. Ranked by OpenRouter's own
    // artificial_analysis indices (intelligence / coding / agentic), among the
    // ones carrying no expiration_date:
    //
    //   poolside/laguna-s-2.1:free    62.3 / 68.2 / 43.9   262K ctx
    //   qwen/qwen3.8-27b:free         44.7 / 68.1 / 45.8   262K ctx
    //   thinkingmachines/inkling:free 28.1 / 72.9 / 33.7     1M ctx
    //
    // The two nex-agi models scored higher still (66.0 / 71.0 / 66.6) but carry
    // an expiration_date of 2026-09-25 — free for three more days is not free.
    // The :free suffix is what makes the price zero; the same model without it
    // bills, which is why the suffix is asserted rather than assumed.
    model: "poolside/laguna-s-2.1:free",
    // OpenRouter's free lineup rotates under you — Qwen3 Coder 480B stopped
    // being free on 2026-07-21 — so the best free tier cannot hang on one id.
    // These are tried under the same key, in order, when the model itself is
    // the thing that failed. A model the user picked in Settings is never
    // second-guessed.
    fallbackModels: ["qwen/qwen3.8-27b:free", "thinkingmachines/inkling:free"],
    docs: "openrouter.ai → Keys",
    note: "Free models cost nothing per token, no card needed. The catch is a request count, not a bill: about 50 a day until you have ever bought $10 of credit, then 1,000.",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini (free tier)",
    // The OpenAI-compatible surface Gemini publishes; the native
    // generateContent endpoint would need its own adapter. This one takes the
    // same chat-completions body as the other cloud links, including inline
    // image_url parts, which is why it is the multimodal link of the chain.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    docs: "aistudio.google.com → API keys",
    note: "Free tier with no card. Reads text, images, audio, video and PDFs in one request. Google may use free-tier prompts to improve its products outside the EEA/UK/CH.",
  },
  mistral: {
    id: "mistral",
    label: "Mistral AI (Free mode)",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    docs: "console.mistral.ai → API keys → Limits",
    note: "Free mode with no card. Exact allowance and vision support are shown in the account's Limits page, so probe before relying on them.",
  },
  // Groq has a reported free plan for open models. "เสียตังค์" means having to
  // pay to KEEP USING, not "this vendor also sells a paid plan", so the free
  // plan is usable free usage. It is deliberately NOT in DEFAULT_ORDER: the
  // owner must connect a key and verify the live rate-limit page first. The
  // instant Groq answers 402 it is classified now_paid, recorded as blocked,
  // and the chain moves to the next free link or the local GGUF model. LUKE
  // never upgrades it to a paid plan.
  groq: {
    id: "groq",
    label: "Groq (free plan for open models)",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    docs: "console.groq.com → API Keys / Rate limits",
    note: "Free plan for open models, contested in 2026 sources. Connect a key only after checking the live rate-limit page; a 402 means the free tier is gone and LUKE falls back to local instead of paying.",
  },
  // The Arena coding router was prepaid — payment was required from the first
  // call — so it stays deleted. A stale legacy `key` cannot revive it.
  // Free Claude Code — a proxy on this machine, not another cloud account.
  // It owns the provider catalogue, the free keys, the retries and the
  // fallback list; this app only speaks one protocol to one local socket.
  // It answers Anthropic Messages (/v1/messages), not Chat Completions, so it
  // carries its own request shape and stream reader below.
  fcc: {
    id: "fcc",
    label: "Free Claude Code (this machine)",
    // FCC's own defaults, read from src/free_claude_code/config/settings.py
    // (HOST=0.0.0.0, PORT=8082) and from its README install instructions.
    baseUrl: "http://127.0.0.1:8082/v1",
    endpoint: "/messages",
    apiFormat: "anthropic-messages",
    // Its /v1/models defaults to Claude tier names; the "messages" view lists
    // the routable provider/model ids actually configured in FCC Admin.
    modelsQuery: "?view=messages",
    // A Claude tier name routes through whatever MODEL / MODEL_SONNET the user
    // picked in FCC Admin, including FCC's own fallback list. A direct
    // `<provider>/<model>` ref also resolves, if they want to force one.
    model: "claude-sonnet-4-20250514",
    docs: "fcc-server → Admin UI → Providers / Model Config",
    note: "Free Claude Code runs on this machine and fronts its own free providers, retries and fallbacks. No API key needed unless Proxy Authentication is on. Normal Chat never uses it.",
    local: true,
    keyless: true,
  },
};

/**
 * Tried in this order; local is the last link, after all of them.
 *
 * Every provider here is free in the sense that matters — nothing is billed per
 * token. NVIDIA has no daily quota at all, OpenRouter's :free models are priced
 * at zero, Z.ai's Flash models are priced at zero. Groq is registered but NOT
 * in the default order: it joins only when the owner connects a key, and a 402
 * sends the turn to the next free link or the local model. No prepaid provider
 * is registered in PROVIDERS at all.
 */
const DEFAULT_ORDER = ["nvidia", "openrouter", "zai"];

// Attach the researched free/modality facts to every transport provider.
// `free` is an invariant enforced by the catalogue, not a user setting.
for (const transportProvider of Object.values(PROVIDERS)) {
  Object.assign(
    transportProvider,
    aiCatalog.transportPolicy(transportProvider.id, {
      free: false,
      paid: true,
      modalities: transportProvider.modalities || ["text"],
      uncensored: false,
    }),
  );
}

// ── small helpers ──────────────────────────────────────────────────────────

/**
 * A link is connected either by a saved key or, for a local bridge, by an
 * explicit "connect" with no key at all. Keeping this in one place matters:
 * the live route, the Settings panel and the chain must agree on what counts
 * as connected or Work would silently stay on the local model.
 */
function isConnected(config, providerId) {
  if (config?.keys?.[providerId]) return true;
  return PROVIDERS[providerId]?.keyless === true && config?.enabled?.[providerId] === true;
}

function hasCloudBrain(config) {
  return (config?.order || []).some((providerId) => isConnected(config, providerId));
}

/** A connected local bridge is tried first — it already has its own fallbacks. */
function ensureOrder(order, providerId) {
  const next = (Array.isArray(order) ? order : [...DEFAULT_ORDER])
    .filter((id) => PROVIDERS[id]);

  if (!next.includes(providerId)) next.push(providerId);
  if (PROVIDERS[providerId]?.local) return [providerId, ...next.filter((id) => id !== providerId)];

  return next;
}

/** Every path out of this file goes through here: no key ever survives it. */
function scrubKey(text, key) {
  const value = String(text == null ? "" : text);
  const secret = String(key || "").trim();

  if (!secret || secret.length < 8) return value;

  return value.split(secret).join("[key hidden]");
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function providerOrThrow(providerId) {
  const provider = PROVIDERS[String(providerId || "").trim()];

  if (!provider) {
    throw httpError(`There is no provider called "${providerId}".`);
  }

  return provider;
}

// ── the request ────────────────────────────────────────────────────────────

/**
 * The body sent upstream.
 *
 * For a router account the model is forced: letting a caller choose produces a
 * 403 the user cannot act on.
 */
function buildRemotePayload({
  messages = [],
  providerId = "nvidia",
  model = "",
  temperature = undefined,
  topP = undefined,
  maxTokens = undefined,
  stream = true,
} = {}) {
  const provider = providerOrThrow(providerId);
  const apiFormat = provider.apiFormat || "openai-chat";
  const partOptions = { allowedModalities: provider.modalities || ["text"] };

  // The three roles that exist in a conversation. `system` is not a detail:
  // the restore prompt carries the contract Work writes its answers under, and
  // demoting it to a user turn is how a model ends up writing tool names out as
  // prose. Anything else is a tool result or a stray, and is dropped.
  //
  // `content` may be a string or an array of content parts: TextChat stores
  // attachments that way. Filtering on `typeof content === "string"` used to
  // delete an attached image without a word, so the parts are translated for
  // the wire format instead, with a text placeholder on text-only links.
  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (
      typeof message.content === "string" || Array.isArray(message.content)
    ))
    .filter((message) => ["system", "user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: normalizeContentParts(message.content, apiFormat, partOptions),
    }));

  const chosenModel = provider.forceModel ? provider.model : String(model || "").trim() || provider.model;
  const numericTemperature = Number(temperature);
  const numericTopP = Number(topP);
  const numericMaxTokens = Number(maxTokens);

  // FCC answers Anthropic Messages, where the system prompt is a top-level
  // field, turns must alternate, and max_tokens is required. Sending the
  // OpenAI-shaped body to /v1/messages is the one thing that makes a direct
  // "paste the proxy URL into Settings" integration fail.
  if (apiFormat === "anthropic-messages") {
    const system = normalizedMessages
      .filter((message) => message.role === "system")
      .map((message) => textOf(message.content))
      .join("\n\n")
      .trim();

    const turns = [];
    for (const message of normalizedMessages) {
      if (message.role === "system") continue;
      const previous = turns[turns.length - 1];
      if (previous && previous.role === message.role) {
        previous.content = mergeContent(previous.content, message.content, apiFormat, partOptions);
      } else {
        turns.push({ role: message.role, content: message.content });
      }
    }

    const payload = {
      model: chosenModel,
      messages: turns,
      max_tokens: Number.isFinite(numericMaxTokens) && numericMaxTokens > 0
        ? Math.floor(numericMaxTokens)
        : ANTHROPIC_DEFAULT_MAX_TOKENS,
      stream: stream === true,
    };

    if (system) payload.system = system;
    if (Number.isFinite(numericTemperature) && numericTemperature > 0) {
      payload.temperature = numericTemperature;
    }
    if (Number.isFinite(numericTopP) && numericTopP > 0 && numericTopP <= 1) {
      payload.top_p = numericTopP;
    }

    return payload;
  }

  const payload = {
    model: chosenModel,
    messages: normalizedMessages,
    stream: stream === true,
  };

  if (Number.isFinite(numericTemperature) && numericTemperature > 0) {
    payload.temperature = numericTemperature;
  }

  if (Number.isFinite(numericTopP) && numericTopP > 0 && numericTopP <= 1) {
    payload.top_p = numericTopP;
  }

  if (Number.isFinite(numericMaxTokens) && numericMaxTokens > 0) {
    payload.max_tokens = Math.floor(numericMaxTokens);
  }

  return payload;
}

/** The second argument defaults to the original cloud gateway, for callers
 * that have only ever known one protocol. */
function remoteHeaders(key, providerId = "nvidia") {
  const provider = providerOrThrow(providerId);
  const secret = String(key || "").trim();

  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream, application/json",
  };

  if (provider.apiFormat === "anthropic-messages") {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    // FCC reads either `authorization: Bearer` or `x-api-key` when its own
    // Proxy Authentication is on. With no token saved, neither is sent.
    if (secret) headers["x-api-key"] = secret;
    return headers;
  }

  headers.authorization = `Bearer ${secret}`;
  return headers;
}

/** The saved base URLs, read synchronously because the request path is sync. */
function readBasesSync() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROVIDER_FILE, "utf8"));
    return parsed?.bases && typeof parsed.bases === "object" ? parsed.bases : {};
  } catch {
    return {};
  }
}

/**
 * The base URL a provider is reached at.
 *
 * Overridable so the chain can be driven against a local stand-in instead of
 * the internet. Every assertion in the companion suite that only reads this
 * file's source proves what the code says; pointing it at a real socket proves
 * what the code does. A local bridge additionally accepts its own loopback URL
 * from Settings or LUKE_FCC_BASE_URL, and refuses anything off this machine.
 */
function baseUrlFor(providerId) {
  const provider = providerOrThrow(providerId);

  // A provider-specific address wins over the global test override, so a
  // local stand-in can be exercised without redirecting every cloud link.
  if (provider.local) {
    const candidate =
      String(process.env.LUKE_FCC_BASE_URL || "").trim() ||
      readBasesSync()[providerId];

    const parsed = parseBaseUrl(candidate, { requireLoopback: true });
    if (parsed) return parsed;
  }

  const override = String(process.env.LUKE_REMOTE_PROVIDER_BASE_URL || "").trim();

  return (override || provider.baseUrl).replace(/\/+$/, "");
}

function remoteEndpoint(providerId) {
  const provider = providerOrThrow(providerId);
  return `${baseUrlFor(providerId)}${provider.endpoint || "/chat/completions"}`;
}

/**
 * Turn an upstream failure into something the user can act on.
 *
 * The gateways' own wording is accurate and useless: `403
 * free_router_harness_restricted` means a free router accepts only its own
 * apps; `402` means a model that was free last month is behind a card now.
 * Both are worth saying in plain words, and neither is an invitation to pay.
 */
function classifyRemoteError({ status = 0, body = "", providerId = "" } = {}) {
  const text = String(body || "");
  const code = Number(status) || 0;
  const label = PROVIDERS[providerId]?.label || "The provider";

  // A local bridge is not a cloud account. Its 401 is a proxy token mismatch
  // in FCC Admin, its 404 is a model FCC does not route, and a dead socket is
  // a program that is simply not running on this machine.
  if (PROVIDERS[providerId]?.local) {
    if (code === 401) {
      return {
        code: "local_bridge_auth",
        message: `${label} refused the proxy token. If Proxy Authentication is on in FCC's Admin UI, paste that token into Settings; otherwise turn it off (FCC only listens on this machine).`,
      };
    }
    if (code === 403 || code === 404) {
      return {
        code: "unknown_model",
        message: `${label} does not route that model. Pick one from its model list, or leave a Claude tier name so FCC chooses its configured MODEL.`,
      };
    }
    if (code === 0) {
      return {
        code: "unreachable",
        message: `${label} is not running on this machine. Start fcc-server (or open the Free Claude Code app), then try again.`,
      };
    }
  }

  if (code === 403 && /free_router_harness_restricted|harness/i.test(text)) {
    return {
      code: "harness_restricted",
      message:
        "This free router only answers its own harnesses (Claude Code, Claude Desktop, OpenCode). LUKE is not one of them, so the chain moves to the next free provider or the local model — there is no paid upgrade here.",
    };
  }

  if (code === 403) {
    return {
      code: "model_not_allowed",
      message:
        "The provider refused that model. Pick an id from its current model list in Settings — free catalogues rotate, and an old id costs a wasted link.",
    };
  }

  if (code === 402) {
    return {
      code: "now_paid",
      message: `${label} now charges for this model — the free tier is gone. Pick another model, another provider, or let LUKE fall back to the local model.`,
    };
  }

  if (code === 404) {
    return {
      code: "unknown_model",
      message: `${label} does not have a model by that name any more. Open ${PROVIDERS[providerId]?.docs || "the provider"} and copy a current model id into Settings.`,
    };
  }

  if (code === 401) {
    return {
      code: "invalid_key",
      message: `${label} refused that key. Make a new one at ${PROVIDERS[providerId]?.docs || "the provider"} and paste it again.`,
    };
  }

  if (code === 429) {
    return {
      code: "rate_limited",
      message: `${label} is rate limiting this key, or today's quota is used up.`,
    };
  }

  if (code >= 500) {
    return {
      code: "upstream_error",
      message: `${label} failed on its side (HTTP ${code}). Nothing is wrong with your key.`,
    };
  }

  if (code === 0) {
    return {
      code: "unreachable",
      message: `${label} could not be reached. Check this machine's internet connection.`,
    };
  }

  return {
    code: "refused",
    message: `${label} refused the request (HTTP ${code}).`,
  };
}

/**
 * Is this failure worth trying the next provider for?
 *
 * A bad key is not: the next provider has nothing to do with it, and saying so
 * three times in a row helps nobody. A full quota is exactly the case the chain
 * exists for.
 */
function isRetryable(code) {
  return ["rate_limited", "now_paid", "unknown_model", "upstream_error", "unreachable", "harness_restricted", "local_bridge_auth"].includes(code);
}

/**
 * The refusals that are about the model rather than the provider.
 *
 * A free lineup rotates: a `:free` id that worked last month answers 404 today,
 * or starts answering 402 because it stopped being free. Neither says anything
 * about the other free models on the same account, so they are worth one more
 * attempt against the alternates before abandoning a provider that still works.
 * Everything else — a rate limit, an outage, a refused key — fails the same way
 * against every model the provider has.
 *
 * Both of these arrive as a response status, so they land before a single delta
 * is read: retrying cannot splice a second answer onto the first.
 */
const MODEL_LEVEL_FAILURES = new Set(["unknown_model", "now_paid"]);

// ── reading the stream ─────────────────────────────────────────────────────

/**
 * Server-sent events arrive in arbitrary chunks, so a `data:` line can be split
 * across two reads. This keeps the partial line and only publishes complete
 * ones — the same reason the local path buffers before it parses.
 */
function createSseDecoder() {
  let buffer = "";

  // The stream arrives as bytes. String() on a Uint8Array produces
  // "100,97,116,97,58" — comma separated byte values — which starts no `data:`
  // line, so every frame is silently dropped and a streamed answer comes back
  // empty. TextDecoder in streaming mode also holds an incomplete multi-byte
  // character across reads, which matters here: a Thai syllable is three bytes
  // and a chunk boundary can land in the middle of one.
  const bytes = new TextDecoder("utf-8");

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : bytes.decode(chunk, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      const payloads = [];

      for (const frame of frames) {
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trim();
          if (data) payloads.push(data);
        }
      }

      return payloads;
    },

    flush() {
      buffer += bytes.decode();

      const rest = buffer;
      buffer = "";

      if (!rest.trim()) return [];

      return rest
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
    },
  };
}

/** The text in one streamed chunk, or "" when the chunk carries none. */
function extractDelta(data) {
  if (!data || data === "[DONE]") return "";

  try {
    const parsed = JSON.parse(data);
    const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : null;
    const content = choice?.delta?.content;

    if (typeof content === "string") return content;

    // Anthropic Messages SSE, which is what FCC streams:
    //   {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
    // A `content_block_start` may carry the first piece of text eagerly.
    if (parsed?.type === "content_block_delta" && typeof parsed?.delta?.text === "string") {
      return parsed.delta.text;
    }
    if (parsed?.type === "content_block_start" && typeof parsed?.content_block?.text === "string") {
      return parsed.content_block.text;
    }

    return "";
  } catch {
    return "";
  }
}

/** FCC reports a stream that died after HTTP 200 as an SSE `error` frame. */
function extractStreamError(data) {
  if (!data || data === "[DONE]") return "";

  try {
    const parsed = JSON.parse(data);
    if (parsed?.type !== "error") return "";

    const message = parsed?.error?.message || parsed?.message;
    return typeof message === "string" && message.trim()
      ? message.trim()
      : "The provider stream stopped with an error.";
  } catch {
    return "";
  }
}

function isDone(data) {
  return String(data || "").trim() === "[DONE]";
}

// ── the keys ───────────────────────────────────────────────────────────────

async function readConfig() {
  try {
    const raw = await fsp.readFile(PROVIDER_FILE, "utf8");
    const parsed = JSON.parse(raw);

    const keys = {};

    // The file used to hold a single Arena router key. That provider was
    // removed because it was prepaid, so the legacy `key` field is deliberately
    // NOT loaded: an old config file must never revive a paid link. It stays
    // untouched on disk; only free providers registered in PROVIDERS are read.

    if (parsed.keys && typeof parsed.keys === "object") {
      for (const [providerId, value] of Object.entries(parsed.keys)) {
        if (PROVIDERS[providerId] && typeof value === "string" && value.trim()) {
          keys[providerId] = value.trim();
        }
      }
    }

    // Only a declared keyless bridge can be on without a key. Anything else
    // in this file is ignored, so a stale or hand-edited entry cannot invent a
    // provider or silently turn one on.
    const enabled = {};
    if (parsed.enabled && typeof parsed.enabled === "object") {
      for (const [providerId, value] of Object.entries(parsed.enabled)) {
        if (PROVIDERS[providerId]?.keyless && value === true) enabled[providerId] = true;
      }
    }

    const bases = {};
    if (parsed.bases && typeof parsed.bases === "object") {
      for (const [providerId, value] of Object.entries(parsed.bases)) {
        if (PROVIDERS[providerId]?.local && typeof value === "string" && value.trim()) {
          bases[providerId] = value.trim();
        }
      }
    }

    const storedOrder = Array.isArray(parsed.order)
      ? parsed.order.filter((providerId) => PROVIDERS[providerId])
      : [];
    const order = storedOrder.length ? storedOrder : [...DEFAULT_ORDER];

    // Files written before the local bridge existed have no `fcc` in `order`.
    // An enabled bridge still has to be reachable by the chain.
    for (const providerId of Object.keys(enabled)) {
      if (!order.includes(providerId)) order.unshift(providerId);
    }

    const models = parsed.models && typeof parsed.models === "object" ? parsed.models : {};

    return {
      keys,
      enabled,
      bases,
      order,
      models,
      useLocalFallback: parsed.useLocalFallback !== false,
    };
  } catch {
    return {
      keys: {},
      enabled: {},
      bases: {},
      order: [...DEFAULT_ORDER],
      models: {},
      useLocalFallback: true,
    };
  }
}

async function writeConfig(config) {
  await fsp.mkdir(path.dirname(PROVIDER_FILE), { recursive: true });
  await fsp.writeFile(PROVIDER_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  try {
    fs.chmodSync(PROVIDER_FILE, 0o600);
  } catch {}
}

async function readStoredKey(providerId = "nvidia") {
  const config = await readConfig();
  return config.keys[providerId] || null;
}

async function saveKey(providerId, value) {
  const provider = providerOrThrow(providerId);
  const key = String(value == null ? "" : value).trim();

  if (!key) throw httpError("There is no key to save.");
  // A cloud API key has a recognisable minimum length; FCC's own proxy token
  // defaults to "freecc", so holding it to twelve characters would make the
  // documented setting impossible to save.
  if (!provider.keyless && key.length < 12) {
    throw httpError(`That is too short to be a ${provider.label} key.`);
  }
  if (/\s/.test(key)) throw httpError("A key cannot contain spaces.");

  const config = await readConfig();

  config.keys[providerId] = key;
  if (provider.keyless) config.enabled[providerId] = true;
  config.order = ensureOrder(config.order, providerId);

  await writeConfig({ ...config, savedAt: new Date().toISOString() });

  return { saved: true, providerId };
}

/**
 * Connect or forget a local bridge, and remember which loopback socket it is
 * on. `token` is optional: it is FCC's own Proxy Authentication token, not a
 * provider API key, and it is stored with the other secrets (mode 0600).
 */
async function setLocalProvider({
  providerId = LOCAL_BRIDGE_ID,
  enabled = true,
  baseUrl = undefined,
  token = undefined,
} = {}) {
  const provider = providerOrThrow(providerId);
  if (!provider.keyless) throw httpError(`${provider.label} is not a local bridge.`);

  const config = await readConfig();
  const url = baseUrl === undefined
    ? config.bases[providerId] || provider.baseUrl
    : localBaseUrlOrThrow(baseUrl);

  config.bases[providerId] = url;

  if (token !== undefined) {
    const value = String(token || "").trim();
    if (value) {
      if (/\s/.test(value)) throw httpError("A proxy token cannot contain spaces.");
      config.keys[providerId] = value;
    } else {
      delete config.keys[providerId];
    }
  }

  if (enabled) {
    config.enabled[providerId] = true;
    config.order = ensureOrder(config.order, providerId);
  } else {
    delete config.enabled[providerId];
    delete config.keys[providerId];
  }

  await writeConfig({ ...config, savedAt: new Date().toISOString() });

  return { saved: true, providerId, enabled: enabled === true, baseUrl: url };
}

async function clearKey(providerId) {
  const provider = providerOrThrow(providerId);

  const config = await readConfig();

  delete config.keys[providerId];
  // For a keyless bridge, forgetting the token means disconnecting it too —
  // otherwise the chain would keep calling a socket the user just cleared.
  if (provider.keyless) delete config.enabled[providerId];

  await writeConfig({ ...config, savedAt: new Date().toISOString() });

  return { cleared: true, providerId };
}

async function setModel(providerId, model) {
  const provider = providerOrThrow(providerId);
  const value = String(model == null ? "" : model).trim();

  if (!value) throw httpError("Give the model a name.");
  if (/\s/.test(value)) throw httpError("A model id cannot contain spaces.");
  if (provider.forceModel) throw httpError(`${provider.label} decides the model itself; this one cannot be changed.`);

  const config = await readConfig();

  config.models[providerId] = value;

  await writeConfig({ ...config, savedAt: new Date().toISOString() });

  return { saved: true, providerId, model: value };
}

/** What the browser is allowed to know: whether there is a key, never which. */
async function providerStatus() {
  const config = await readConfig();

  const providers = Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    docs: provider.docs,
    note: provider.note,
    model: provider.forceModel ? provider.model : config.models[provider.id] || provider.model,
    modelLocked: provider.forceModel === true,
    keyless: provider.keyless === true,
    local: provider.local === true,
    apiFormat: provider.apiFormat || "openai-chat",
    free: provider.free === true,
    paid: provider.paid === true,
    modalities: Array.isArray(provider.modalities) ? provider.modalities : ["text"],
    verifiedAt: String(provider.verifiedAt || ""),
    baseUrl: baseUrlFor(provider.id),
    configured: isConnected(config, provider.id),
    keyHint: config.keys[provider.id] ? `…${config.keys[provider.id].slice(-4)}` : "",
  }));

  return {
    providers,
    order: config.order,
    localFallback: config.useLocalFallback,
    chain: config.order.filter((providerId) => isConnected(config, providerId)),
    keyFile: path.relative(ROOT, PROVIDER_FILE),
    // The online-surface policy travels with the same status the Settings
    // panel already fetches, so the UI never has to guess whether Chat is
    // allowed online. No paid link can be tried: none is registered.
    policy: onlineSurfaces.policy(),
    catalogVerifiedAt: aiCatalog.readCatalog().verifiedAt,
  };
}

// ── talking to one provider ────────────────────────────────────────────────

/**
 * One turn against one provider, streamed.
 *
 * `onDelta` receives text as it arrives. The key is scrubbed from anything that
 * is thrown, so a stack trace or an upstream echo cannot leak it into the UI.
 */
async function streamRemoteChat({
  providerId,
  key,
  messages = [],
  model = "",
  temperature = undefined,
  topP = undefined,
  maxTokens = undefined,
  signal = null,
  onDelta = () => {},
  onEgress = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const provider = providerOrThrow(providerId);
  const secret = String(key || "").trim();

  // A local bridge is deliberately keyless; its optional proxy token is the
  // same field, but an empty one is a valid configuration.
  if (!secret && !provider.keyless) throw httpError(`No ${provider.label} key is saved yet.`, 401);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const abortFromCaller = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  const endpoint = remoteEndpoint(providerId);
  const requestBody = JSON.stringify(
    buildRemotePayload({ messages, providerId, model, temperature, topP, maxTokens, stream: true }),
  );

  // The ledger sees the shape of the departure, never the prompt or the key.
  onEgress({
    surface: "cloud-chain",
    provider: provider.id,
    url: endpoint,
    method: "POST",
    bytes: Buffer.byteLength(requestBody),
    decision: "allowed",
    reason: "free cloud turn",
    model,
    paid: provider.paid === true,
  });

  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: remoteHeaders(secret, providerId),
      body: requestBody,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);

    // A bridge that is not running is the commonest FCC failure, and "fetch
    // failed" is no help. It is also a retryable failure: the cloud links
    // behind it should still get their turn.
    const message = provider.local
      ? `${provider.label} is not running at ${baseUrlFor(providerId)}. Start fcc-server (or open the Free Claude Code app), then try again.`
      : scrubKey(error?.message || `${provider.label} could not be reached.`, secret);

    const failure = httpError(message, 0);
    failure.code = "unreachable";
    throw failure;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    clearTimeout(timeout);

    const classified = classifyRemoteError({ status: response.status, body, providerId });
    const error = httpError(scrubKey(classified.message, secret), response.status);

    error.code = classified.code;
    throw error;
  }

  const decoder = createSseDecoder();
  let content = "";

  const consume = (data) => {
    if (isDone(data)) return;

    // FCC can report an upstream outage *inside* a 200 stream. Before any
    // token has gone out, that is a failed link and the chain should move on;
    // after tokens are out, splicing a second answer onto the first would be
    // worse than keeping the partial one.
    const streamError = extractStreamError(data);
    if (streamError) {
      if (content) return;

      const failure = httpError(scrubKey(`${provider.label}: ${streamError}`, secret), 502);
      failure.code = "upstream_error";
      throw failure;
    }

    const delta = extractDelta(data);

    if (delta) {
      content += delta;
      onDelta(delta);
    }
  };

  try {
    const reader = response.body?.getReader ? response.body.getReader() : null;

    if (!reader) {
      const text = await response.text();
      content = text;
      if (content) onDelta(content);
    } else {
      while (true) {
        const result = await reader.read();

        if (result.done) break;

        for (const data of decoder.push(result.value)) consume(data);
      }

      for (const data of decoder.flush()) consume(data);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw httpError(`The request to ${provider.label} was cancelled.`, 499);
    }

    // A classified SSE error already carries the code the chain needs.
    if (error?.code === "upstream_error") throw error;

    throw httpError(scrubKey(error?.message || `The ${provider.label} stream broke off.`, secret), 502);
  } finally {
    clearTimeout(timeout);

    if (signal) signal.removeEventListener("abort", abortFromCaller);
  }

  return { content, providerId, model: provider.forceModel ? provider.model : model || provider.model };
}

/**
 * The whole chain, in order, until one answers.
 *
 * `onProvider` is told which link is being tried, so the UI can say so. Each
 * failure is collected and handed back: when the chain is spent, the user sees
 * what each one said rather than a single anonymous error.
 */
async function streamRemoteChain({
  messages = [],
  temperature = undefined,
  topP = undefined,
  maxTokens = undefined,
  signal = null,
  onDelta = () => {},
  onProvider = () => {},
  onFailure = () => {},
  onEgress = () => {},
  policy = {},
  cooldownMs = 1500,
} = {}) {
  const config = await readConfig();
  const maxRateRetries = Math.min(3, Math.max(0, Number(policy.rateLimitRetry) || 0));

  // No-pay is an invariant, not a setting. Every registered transport has
  // free=true from the catalogue; anything else (a stale hand-edited config, an
  // injected test provider, a future mistake) is refused and recorded. There
  // is deliberately no `freeOnly: false` path anymore.
  const queue = config.order
    .filter((providerId) => isConnected(config, providerId))
    .filter((providerId) => {
      const provider = PROVIDERS[providerId];
      if (provider?.free !== true) {
        onEgress({
          surface: "cloud-chain",
          provider: providerId,
          url: provider?.baseUrl || "",
          method: "POST",
          bytes: 0,
          decision: "blocked",
          reason: "no-pay invariant: this provider is not a registered free tier",
          paid: true,
        });
        return false;
      }
      return true;
    })
    .map((providerId) => {
      const provider = PROVIDERS[providerId];
      const chosen = String(config.models[providerId] || "").trim();
      return {
        provider,
        key: config.keys[providerId],
        // A model the user picked is the model they get. The alternates exist
        // only to survive a free lineup rotating a default out from under the
        // chain, and second-guessing a deliberate choice is not that.
        models: chosen ? [chosen] : [provider.model, ...(provider.fallbackModels || [])].filter(Boolean),
      };
    });

  const failures = [];

  for (const link of queue) {
    let abandon = false;

    for (const model of link.models) {
      onProvider(link.provider.id, model);

      let content = "";
      let rateRetries = 0;
      let stopModels = false;

      // A bounded retry is how "use the free quota fully" is honoured: a 429
      // on NVIDIA is often a per-minute ceiling, not an exhausted day. Default
      // is zero so an opt-in switch in Settings controls it.
      for (;;) {
        try {
          const result = await streamRemoteChat({
            providerId: link.provider.id,
            key: link.key,
            messages,
            model,
            temperature,
            topP,
            maxTokens,
            signal,
            onDelta,
            onEgress,
          });

          return {
            content: result.content || content,
            providerId: link.provider.id,
            model: result.model,
            failures,
          };
        } catch (error) {
          const failure = {
            providerId: link.provider.id,
            label: link.provider.label,
            model,
            code: error?.code || "failed",
            status: error?.statusCode || 0,
            message: error?.message || `${link.provider.label} could not be reached.`,
          };

          failures.push(failure);
          onFailure(failure);

          if (failure.code === "rate_limited" && rateRetries < maxRateRetries) {
            rateRetries += 1;
            onEgress({
              surface: "cloud-chain",
              provider: link.provider.id,
              url: link.provider.baseUrl || "",
              method: "POST",
              bytes: 0,
              decision: "blocked",
              reason: `bounded rate-limit retry ${rateRetries}`,
              model,
            });
            if (cooldownMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, cooldownMs));
            }
            continue;
          }

          // The model is the problem, not the provider — try the next free one
          // under the same key before giving up on an account that still works.
          if (MODEL_LEVEL_FAILURES.has(failure.code)) break;

          // A key the provider refuses is about this key, not about the chain:
          // stop and say so, rather than trying the same thing three more times.
          if (!isRetryable(failure.code) && failure.code !== "rate_limited") abandon = true;
          stopModels = true;
          break;
        }
      }

      if (stopModels || abandon) break;
    }

    if (abandon) break;
  }

  return { content: "", providerId: null, model: "", failures, exhausted: true };
}

/**
 * The models a provider actually serves right now.
 *
 * Catalogues rotate — a model that was free last month is behind a card this
 * one — so the name in Settings is offered from the provider's own list rather
 * than from whatever this file happened to say when it was written.
 */
async function listRemoteModels(providerId) {
  const provider = providerOrThrow(providerId);
  const config = await readConfig();
  const key = config.keys[providerId] || "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  const headers = { accept: "application/json" };
  if (key) Object.assign(headers, remoteHeaders(key, providerId));
  else if (provider.apiFormat === "anthropic-messages") {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
  }

  try {
    const response = await fetch(
      `${baseUrlFor(providerId)}/models${provider.modelsQuery || ""}`,
      { headers, signal: controller.signal },
    );

    const text = await response.text();

    if (!response.ok) {
      const classified = classifyRemoteError({ status: response.status, body: text, providerId });

      return { ok: false, code: classified.code, message: classified.message, models: [] };
    }

    let parsed = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        code: "unexpected_shape",
        message: `${provider.label} answered, but not with a model list.`,
        models: [],
      };
    }

    const models = (Array.isArray(parsed?.data) ? parsed.data : [])
      .map((entry) => (typeof entry === "string" ? entry : entry?.id))
      .filter((id) => typeof id === "string" && id.trim())
      .sort();

    return { ok: true, code: "listed", message: `${provider.label} serves ${models.length} models.`, models };
  } catch (error) {
    return {
      ok: false,
      code: "unreachable",
      message: scrubKey(error?.message || `${provider.label} could not be reached.`, key),
      models: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** One short call to one provider, so the user can find out before relying. */
async function testRemoteProvider(providerId) {
  const provider = providerOrThrow(providerId);
  const config = await readConfig();
  const key = config.keys[providerId] || "";

  if (!isConnected(config, providerId)) {
    return {
      ok: false,
      code: "no_key",
      message: provider.keyless
        ? `${provider.label} is not connected yet. Press Connect in Settings first.`
        : `No ${provider.label} key is saved yet.`,
    };
  }

  // Test the model the user actually chose, resolved the same way the chain
  // resolves it. This used to send no model at all, so buildRemotePayload fell
  // back to the built-in default — the Test button said "ok" for an account
  // whose *selected* model was gone, and then every real turn 404'd on a
  // provider the panel had just declared healthy.
  const chosen = String(config.models[providerId] || "").trim();
  const model = chosen || provider.model;

  try {
    const result = await streamRemoteChat({
      providerId,
      key,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      model,
      maxTokens: 16,
      timeoutMs: PROBE_TIMEOUT_MS,
    });

    return {
      ok: true,
      code: "reachable",
      model: result.model,
      message: `${provider.label} answered through ${result.model}.`,
      sample: String(result.content || "").trim().slice(0, 120),
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "failed",
      model,
      message: error?.message || `${provider.label} could not be reached.`,
    };
  }
}

module.exports = {
  ANTHROPIC_VERSION,
  DEFAULT_ORDER,
  baseUrlFor,
  DEFAULT_TIMEOUT_MS,
  LOCAL_BRIDGE_ID,
  PROVIDERS,
  PROVIDER_FILE,
  buildRemotePayload,
  classifyRemoteError,
  clearKey,
  createSseDecoder,
  ensureOrder,
  extractDelta,
  extractStreamError,
  hasCloudBrain,
  isConnected,
  isDone,
  isRetryable,
  listRemoteModels,
  localBaseUrlOrThrow,
  parseBaseUrl,
  providerStatus,
  readConfig,
  readStoredKey,
  remoteEndpoint,
  remoteHeaders,
  saveKey,
  scrubKey,
  setLocalProvider,
  setModel,
  streamRemoteChain,
  streamRemoteChat,
  testRemoteProvider,
  writeConfig,
};
