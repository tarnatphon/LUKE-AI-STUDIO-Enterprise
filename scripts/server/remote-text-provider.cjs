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
 * Four rules hold everywhere in this file:
 *
 * 1. The keys belong to this machine. They are written to
 *    `app/runtime-state/text-chat/remote-text-provider.json` — inside the app
 *    folder, mode 0600, gitignored — scrubbed out of every error, and never
 *    returned to the browser, not even masked.
 * 2. A router account takes the router's name and no other. Arena rejects a
 *    direct model id with a 403, so for that provider the model is forced.
 * 3. A refusal is reported in the user's words. `403
 *    free_router_harness_restricted` means the free router answers Arena's own
 *    apps and not this one; `402` means a provider that used to be free now
 *    charges. Both are worth saying plainly.
 * 4. The local path is untouched. With no key saved, nothing here runs.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const PROVIDER_FILE = path.join(
  ROOT,
  "app",
  "runtime-state",
  "text-chat",
  "remote-text-provider.json",
);

const DEFAULT_TIMEOUT_MS = 600000;
const PROBE_TIMEOUT_MS = 60000;

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
    model: "moonshotai/kimi-k2.5",
    docs: "build.nvidia.com → any model → Get API key",
    note: "The only free catalogue with no daily quota — 40 requests a minute, and that is the whole limit.",
  },
  zai: {
    id: "zai",
    label: "Z.ai (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    model: "glm-4.7-flash",
    docs: "z.ai → API keys",
    note: "Flash models are priced at zero per token, not handed out as trial credit.",
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    docs: "console.groq.com → API Keys",
    note: "The most generous daily request cap of the free tiers; tokens per minute is the real ceiling.",
  },
  arena: {
    id: "arena",
    label: "Arena",
    baseUrl: "https://api.preview.arena.ai/v1",
    model: "coding-router-preview",
    docs: "portal.api.preview.arena.ai → Keys",
    note: "A router account may call the router only, so the model name is forced.",
    // Naming a model directly is refused with a 403 the user cannot act on.
    forceModel: true,
  },
};

/** Tried in this order; local is the last link, after all of them. */
const DEFAULT_ORDER = ["nvidia", "zai", "groq"];

// ── small helpers ──────────────────────────────────────────────────────────

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
  maxTokens = undefined,
  stream = true,
} = {}) {
  const provider = providerOrThrow(providerId);

  // The three roles that exist in a conversation. `system` is not a detail:
  // the restore prompt carries the contract Work writes its answers under, and
  // demoting it to a user turn is how a model ends up writing tool names out as
  // prose. Anything else is a tool result or a stray, and is dropped.
  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message.content === "string")
    .filter((message) => ["system", "user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const payload = {
    model: provider.forceModel ? provider.model : String(model || "").trim() || provider.model,
    messages: normalizedMessages,
    stream: stream === true,
  };

  const numericTemperature = Number(temperature);
  if (Number.isFinite(numericTemperature) && numericTemperature > 0) {
    payload.temperature = numericTemperature;
  }

  const numericMaxTokens = Number(maxTokens);
  if (Number.isFinite(numericMaxTokens) && numericMaxTokens > 0) {
    payload.max_tokens = Math.floor(numericMaxTokens);
  }

  return payload;
}

function remoteHeaders(key) {
  return {
    "content-type": "application/json",
    accept: "text/event-stream, application/json",
    authorization: `Bearer ${String(key || "").trim()}`,
  };
}

function remoteEndpoint(providerId) {
  return `${providerOrThrow(providerId).baseUrl}/chat/completions`;
}

/**
 * Turn an upstream failure into something the user can act on.
 *
 * The gateways' own wording is accurate and useless: `403
 * free_router_harness_restricted` means the free router accepts Arena's own
 * apps and not this one; `402` means a model that was free last month is
 * behind a card now. Both are worth saying in plain words.
 */
function classifyRemoteError({ status = 0, body = "", providerId = "" } = {}) {
  const text = String(body || "");
  const code = Number(status) || 0;
  const label = PROVIDERS[providerId]?.label || "The provider";

  if (code === 403 && /free_router_harness_restricted|harness/i.test(text)) {
    return {
      code: "harness_restricted",
      message:
        "Arena's free router only answers its own apps (Claude Code, Claude Desktop, OpenCode). This app is not one of them. A paid Arena key removes that restriction.",
    };
  }

  if (code === 403) {
    return {
      code: "model_not_allowed",
      message:
        "The provider refused the model. An Arena router account may only call the router itself, never a model by name.",
    };
  }

  if (code === 402) {
    return {
      code: "now_paid",
      message: `${label} now charges for this model — the free tier is gone. Pick another model, another provider, or let Work fall back to the local model.`,
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
  return ["rate_limited", "now_paid", "unknown_model", "upstream_error", "unreachable", "harness_restricted"].includes(code);
}

// ── reading the stream ─────────────────────────────────────────────────────

/**
 * Server-sent events arrive in arbitrary chunks, so a `data:` line can be split
 * across two reads. This keeps the partial line and only publishes complete
 * ones — the same reason the local path buffers before it parses.
 */
function createSseDecoder() {
  let buffer = "";

  return {
    push(chunk) {
      buffer += String(chunk || "");

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

    return typeof content === "string" ? content : "";
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

    // The file used to hold a single Arena key. Read that as what it became.
    if (typeof parsed.key === "string" && parsed.key.trim()) {
      keys.arena = parsed.key.trim();
    }

    if (parsed.keys && typeof parsed.keys === "object") {
      for (const [providerId, value] of Object.entries(parsed.keys)) {
        if (PROVIDERS[providerId] && typeof value === "string" && value.trim()) {
          keys[providerId] = value.trim();
        }
      }
    }

    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((providerId) => PROVIDERS[providerId])
      : DEFAULT_ORDER;

    const models = parsed.models && typeof parsed.models === "object" ? parsed.models : {};

    return {
      keys,
      order: order.length ? order : DEFAULT_ORDER,
      models,
      useLocalFallback: parsed.useLocalFallback !== false,
    };
  } catch {
    return { keys: {}, order: [...DEFAULT_ORDER], models: {}, useLocalFallback: true };
  }
}

async function writeConfig(config) {
  await fsp.mkdir(path.dirname(PROVIDER_FILE), { recursive: true });
  await fsp.writeFile(PROVIDER_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  try {
    fs.chmodSync(PROVIDER_FILE, 0o600);
  } catch {}
}

async function readStoredKey(providerId = "arena") {
  const config = await readConfig();
  return config.keys[providerId] || null;
}

async function saveKey(providerId, value) {
  const provider = providerOrThrow(providerId);
  const key = String(value == null ? "" : value).trim();

  if (!key) throw httpError("There is no key to save.");
  if (key.length < 12) throw httpError(`That is too short to be a ${provider.label} key.`);
  if (/\s/.test(key)) throw httpError("A key cannot contain spaces.");

  const config = await readConfig();

  config.keys[providerId] = key;

  if (!config.order.includes(providerId)) config.order.push(providerId);

  await writeConfig({ ...config, savedAt: new Date().toISOString() });

  return { saved: true, providerId };
}

async function clearKey(providerId) {
  providerOrThrow(providerId);

  const config = await readConfig();

  delete config.keys[providerId];

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
    configured: Boolean(config.keys[provider.id]),
    keyHint: config.keys[provider.id] ? `…${config.keys[provider.id].slice(-4)}` : "",
  }));

  return {
    providers,
    order: config.order,
    localFallback: config.useLocalFallback,
    chain: config.order.filter((providerId) => config.keys[providerId]),
    keyFile: path.relative(ROOT, PROVIDER_FILE),
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
  maxTokens = undefined,
  signal = null,
  onDelta = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const provider = providerOrThrow(providerId);
  const secret = String(key || "").trim();

  if (!secret) throw httpError(`No ${provider.label} key is saved yet.`, 401);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const abortFromCaller = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  let response;

  try {
    response = await fetch(remoteEndpoint(providerId), {
      method: "POST",
      headers: remoteHeaders(secret),
      body: JSON.stringify(
        buildRemotePayload({ messages, providerId, model, temperature, maxTokens, stream: true }),
      ),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw httpError(scrubKey(error?.message || `${provider.label} could not be reached.`, secret), 0);
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
  maxTokens = undefined,
  signal = null,
  onDelta = () => {},
  onProvider = () => {},
  onFailure = () => {},
} = {}) {
  const config = await readConfig();

  const queue = config.order
    .filter((providerId) => config.keys[providerId])
    .map((providerId) => ({
      provider: PROVIDERS[providerId],
      key: config.keys[providerId],
      model: config.models[providerId] || PROVIDERS[providerId].model,
    }));

  const failures = [];

  for (const link of queue) {
    onProvider(link.provider.id, link.model);

    let content = "";

    try {
      const result = await streamRemoteChat({
        providerId: link.provider.id,
        key: link.key,
        messages,
        model: link.model,
        temperature,
        maxTokens,
        signal,
        onDelta,
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
        code: error?.code || "failed",
        status: error?.statusCode || 0,
        message: error?.message || `${link.provider.label} could not be reached.`,
      };

      failures.push(failure);
      onFailure(failure);

      // A key the provider refuses is about this key, not about the chain:
      // stop and say so, rather than trying the same thing three more times.
      if (!isRetryable(failure.code) && failure.code !== "rate_limited") break;
    }
  }

  return { content: "", providerId: null, model: "", failures, exhausted: true };
}

/** One short call to one provider, so the user can find out before relying. */
async function testRemoteProvider(providerId) {
  const provider = providerOrThrow(providerId);
  const config = await readConfig();
  const key = config.keys[providerId];

  if (!key) {
    return { ok: false, code: "no_key", message: `No ${provider.label} key is saved yet.` };
  }

  try {
    const result = await streamRemoteChat({
      providerId,
      key,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      maxTokens: 16,
      timeoutMs: PROBE_TIMEOUT_MS,
    });

    return {
      ok: true,
      code: "reachable",
      message: `${provider.label} answered through ${result.model}.`,
      sample: String(result.content || "").trim().slice(0, 120),
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "failed",
      message: error?.message || `${provider.label} could not be reached.`,
    };
  }
}

module.exports = {
  DEFAULT_ORDER,
  DEFAULT_TIMEOUT_MS,
  PROVIDERS,
  PROVIDER_FILE,
  buildRemotePayload,
  classifyRemoteError,
  clearKey,
  createSseDecoder,
  extractDelta,
  isDone,
  isRetryable,
  providerStatus,
  readConfig,
  readStoredKey,
  remoteEndpoint,
  remoteHeaders,
  saveKey,
  scrubKey,
  setModel,
  streamRemoteChain,
  streamRemoteChat,
  testRemoteProvider,
  writeConfig,
};
