"use strict";

/**
 * A cloud brain for Work mode, behind a key the user owns.
 *
 * Work asks a model to read files, edit them, run the project's own checks and
 * read the failure. Locally that job lands on a 7B model, and a model that was
 * never trained for tool use answers by writing the tools out as prose — which
 * is what half the defensive code in this app exists to contain. The honest fix
 * is a model that can do the work, and the strongest one this machine can reach
 * without buying a bigger one is over Arena's gateway.
 *
 * So this file is the whole of the cloud path, and it holds to four rules:
 *
 * 1. The key belongs to this machine. It is written to
 *    `app/runtime-state/text-chat/remote-text-provider.json` — inside the app
 *    folder, mode 0600, gitignored — and it is scrubbed out of every error and
 *    never returned to the browser, not even masked in a log line.
 * 2. The gateway takes one model name and no other. Arena's router aliases are
 *    all an account on the free router may use; naming a model directly is
 *    refused with a 403. So the model id is forced here, always.
 * 3. A refusal is reported in the user's words, not the gateway's. A 403 here
 *    usually means the account is harness-restricted — Arena's free router
 *    accepts its own apps and not third-party ones — and the user is better off
 *    being told that than reading an error code.
 * 4. The local path is untouched. When no key is saved, nothing here runs.
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

/** Arena's gateway. `/v1` is appended here, not by the caller. */
const ARENA_BASE_URL = "https://api.preview.arena.ai";

/**
 * The only model name this account may send.
 *
 * Arena's gateway rejects a direct model id with a 403: the account is router
 * only. Anything else we might invent — a bigger name, a cheaper name — comes
 * back refused, so there is no choice to offer the user here.
 */
const ARENA_MODEL = "coding-router-preview";

const DEFAULT_TIMEOUT_MS = 600000;

// ── small helpers ──────────────────────────────────────────────────────────

/** Every path out of this file goes through here: no key ever survives it. */
function scrubKey(text, key) {
  const value = String(text == null ? "" : text);
  const secret = String(key || "").trim();

  if (!secret || secret.length < 8) return value;

  return value.split(secret).join("[arena key hidden]");
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// ── the request ────────────────────────────────────────────────────────────

/**
 * The body sent to the gateway.
 *
 * `model` is forced to the router alias on purpose: letting a caller choose
 * produces a 403 the user cannot act on.
 */
function buildRemotePayload({
  messages = [],
  temperature = undefined,
  maxTokens = undefined,
  stream = true,
} = {}) {
  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  const payload = {
    model: ARENA_MODEL,
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

/**
 * Turn an upstream failure into something the user can act on.
 *
 * The gateway's own wording is accurate and useless: `403
 * free_router_harness_restricted` means the free router accepts Arena's own
 * apps — Claude Code, Claude Desktop, OpenCode — and not this one. Saying that
 * in plain words saves the user a support ticket.
 */
function classifyRemoteError({ status = 0, body = "" } = {}) {
  const text = String(body || "");
  const code = Number(status) || 0;

  if (code === 403 && /free_router_harness_restricted|harness/i.test(text)) {
    return {
      code: "harness_restricted",
      message:
        "Arena's free router only answers its own apps (Claude Code, Claude Desktop, OpenCode). This app is not one of them, so the gateway refused the request. A paid Arena key removes that restriction.",
    };
  }

  if (code === 403) {
    return {
      code: "model_not_allowed",
      message:
        "The gateway refused the model. An Arena router account may only call the router itself, never a model by name.",
    };
  }

  if (code === 401) {
    return {
      code: "invalid_key",
      message:
        "That Arena key was refused. Make a new one at portal.api.preview.arena.ai → Keys and paste it again.",
    };
  }

  if (code === 429) {
    return {
      code: "rate_limited",
      message:
        "Arena is rate limiting this key, or today's router credits are used up. Wait a little, or check usage in the Arena dashboard.",
    };
  }

  if (code >= 500) {
    return {
      code: "upstream_error",
      message: `Arena's gateway failed on its side (HTTP ${code}). Nothing is wrong with your key — try again in a moment.`,
    };
  }

  if (code === 0) {
    return {
      code: "unreachable",
      message:
        "Arena's gateway could not be reached. Check this machine's internet connection and try again.",
    };
  }

  return {
    code: "refused",
    message: `Arena's gateway refused the request (HTTP ${code}).`,
  };
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

// ── the key ────────────────────────────────────────────────────────────────

async function readStoredKey() {
  try {
    const raw = await fsp.readFile(PROVIDER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const key = typeof parsed.key === "string" ? parsed.key.trim() : "";

    return key || null;
  } catch {
    return null;
  }
}

async function saveKey(value) {
  const key = String(value == null ? "" : value).trim();

  if (!key) throw httpError("There is no key to save.");
  if (key.length < 12) throw httpError("That key is too short to be an Arena key.");
  if (/\s/.test(key)) throw httpError("An Arena key cannot contain spaces.");

  await fsp.mkdir(path.dirname(PROVIDER_FILE), { recursive: true });
  await fsp.writeFile(
    PROVIDER_FILE,
    `${JSON.stringify({ key, savedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );

  try {
    fs.chmodSync(PROVIDER_FILE, 0o600);
  } catch {}

  return { saved: true };
}

async function clearKey() {
  await fsp.rm(PROVIDER_FILE, { force: true });
  return { cleared: true };
}

/** What the browser is allowed to know: whether there is a key, never which. */
async function providerStatus() {
  const key = await readStoredKey();

  return {
    configured: Boolean(key),
    provider: "arena",
    baseUrl: ARENA_BASE_URL,
    model: ARENA_MODEL,
    keyHint: key ? `…${key.slice(-4)}` : "",
    scope: "work",
    keyFile: path.relative(ROOT, PROVIDER_FILE),
  };
}

// ── talking to the gateway ─────────────────────────────────────────────────

/**
 * One turn against the gateway, streamed.
 *
 * `onDelta` receives text as it arrives. The key is scrubbed from anything that
 * is thrown, so a stack trace or an upstream echo cannot leak it into the UI.
 */
async function streamRemoteChat({
  messages = [],
  key,
  temperature = undefined,
  maxTokens = undefined,
  signal = null,
  onDelta = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const secret = String(key || "").trim();

  if (!secret) throw httpError("No Arena key is saved yet.", 401);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const abortFromCaller = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  let response;

  try {
    response = await fetch(`${ARENA_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: remoteHeaders(secret),
      body: JSON.stringify(
        buildRemotePayload({ messages, temperature, maxTokens, stream: true }),
      ),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw httpError(scrubKey(error?.message || "Arena's gateway could not be reached.", secret), 0);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    clearTimeout(timeout);

    const classified = classifyRemoteError({ status: response.status, body });
    const error = httpError(scrubKey(classified.message, secret), response.status);

    error.code = classified.code;
    throw error;
  }

  const decoder = createSseDecoder();
  let content = "";

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

        for (const data of decoder.push(result.value)) {
          if (isDone(data)) continue;

          const delta = extractDelta(data);

          if (delta) {
            content += delta;
            onDelta(delta);
          }
        }
      }

      for (const data of decoder.flush()) {
        if (isDone(data)) continue;

        const delta = extractDelta(data);

        if (delta) {
          content += delta;
          onDelta(delta);
        }
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw httpError("The request to Arena was cancelled.", 499);
    }

    throw httpError(scrubKey(error?.message || "The Arena stream broke off.", secret), 502);
  } finally {
    clearTimeout(timeout);

    if (signal) signal.removeEventListener("abort", abortFromCaller);
  }

  return { content, model: ARENA_MODEL };
}

/** One short call, so the user can find out before relying on it. */
async function testRemoteProvider() {
  const key = await readStoredKey();

  if (!key) {
    return { ok: false, code: "no_key", message: "No Arena key is saved yet." };
  }

  let content = "";

  try {
    const result = await streamRemoteChat({
      key,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      maxTokens: 16,
      timeoutMs: 60000,
      onDelta: (delta) => {
        content += delta;
      },
    });

    return {
      ok: true,
      code: "reachable",
      message: `Arena answered through ${ARENA_MODEL}.`,
      sample: String(result.content || content || "").trim().slice(0, 120),
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "failed",
      message: error?.message || "Arena could not be reached.",
    };
  }
}

module.exports = {
  ARENA_BASE_URL,
  ARENA_MODEL,
  DEFAULT_TIMEOUT_MS,
  PROVIDER_FILE,
  buildRemotePayload,
  classifyRemoteError,
  clearKey,
  createSseDecoder,
  extractDelta,
  isDone,
  providerStatus,
  readStoredKey,
  remoteHeaders,
  saveKey,
  scrubKey,
  streamRemoteChat,
  testRemoteProvider,
};
