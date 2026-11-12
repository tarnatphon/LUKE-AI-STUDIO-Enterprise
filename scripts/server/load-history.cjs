"use strict";

/**
 * What loads have actually cost, kept across restarts.
 *
 * The completion line ("loaded in 4 min 1 s — 6.9 GB (28 MB/s of the 31 MB/s
 * this volume measured)") lives in memory and dies with the server, so every
 * restart starts the story over: the app can never say "this used to take four
 * minutes and now it takes nine seconds", which is the only evidence that the
 * internal-disk copy was worth its 7 GB. It also means the advice on the model
 * card is a prediction about a machine whose history the app has forgotten.
 *
 * So: keep the last `MAX_ENTRIES` loads on disk, next to the KV profile and the
 * model settings — a few hundred bytes, rewritten atomically, newest first. The
 * card prints the average for each kind of load, because a cached load and an
 * external-disk load are not the same quantity and averaging them together
 * would hide exactly the difference worth knowing.
 */

const path = require("node:path");

const { readJsonOr, writeJsonAtomic } = require("./json-store.cjs");
const { secondsText } = require("./model-load-outlook.cjs");

const MAX_ENTRIES = 20;

/** `app/runtime-state/text-chat/llm-load-history.json` */
function historyFile(stateDir) {
  return path.join(String(stateDir || ""), "text-chat", "llm-load-history.json");
}

function sanitize(entry) {
  const filename = String(entry?.filename || "").trim();
  const elapsedMs = Number(entry?.elapsedMs) || 0;
  if (!filename || elapsedMs <= 0) return null;
  return {
    filename: path.basename(filename),
    sizeBytes: Number(entry.sizeBytes) || 0,
    elapsedMs: Math.round(elapsedMs),
    bytesPerSecond: Math.max(0, Number(entry.bytesPerSecond) || 0),
    predictedSeconds: Number.isFinite(Number(entry.predictedSeconds)) ? Number(entry.predictedSeconds) : null,
    cached: entry.cached === true,
    backend: String(entry.backend || ""),
    at: Number(entry.at) || Date.now(),
  };
}

/** Newest first. Anything unreadable is treated as "no history yet". */
function read(stateDir) {
  const parsed = readJsonOr(historyFile(stateDir), { entries: [] });
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return entries.map(sanitize).filter(Boolean).slice(0, MAX_ENTRIES);
}

/**
 * Append one load and return the whole list, newest first.
 *
 * A read-only runtime-state must not turn a successful load into a failure, so
 * the write is best effort and the entry is still returned.
 */
function record(stateDir, entry) {
  const clean = sanitize(entry);
  if (!clean) return read(stateDir);
  const entries = [clean, ...read(stateDir)].slice(0, MAX_ENTRIES);
  try {
    writeJsonAtomic(historyFile(stateDir), { version: 1, entries });
  } catch {
    // Keeping history is nice; reporting the load is not optional.
  }
  return entries;
}

/**
 * The two averages, in one sentence the card can print.
 *
 * `external` is what the model's own volume costs; `cached` is what the copy
 * costs. Both are reported when both exist, because the difference is the whole
 * argument for copying.
 */
function summarize(entries = []) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const external = list.filter((entry) => entry.cached !== true);
  const cached = list.filter((entry) => entry.cached === true);
  const average = (rows) => (rows.length
    ? Math.round(rows.reduce((sum, row) => sum + (Number(row.elapsedMs) || 0), 0) / rows.length / 1000)
    : 0);
  const externalSeconds = average(external);
  const cachedSeconds = average(cached);
  const parts = [];
  if (external.length) {
    parts.push(`${external.length} load${external.length === 1 ? "" : "s"} from the model's own disk averaged ${secondsText(externalSeconds)}`);
  }
  if (cached.length) {
    parts.push(`${cached.length} load${cached.length === 1 ? "" : "s"} from the internal copy averaged ${secondsText(cachedSeconds)}`);
  }
  let message = parts.join("; ");
  if (message) message = `${message.charAt(0).toUpperCase()}${message.slice(1)}.`;
  if (external.length && cached.length && externalSeconds > cachedSeconds) {
    message += ` The copy saves about ${secondsText(externalSeconds - cachedSeconds)} on every load.`;
  }
  return {
    count: list.length,
    externalCount: external.length,
    cachedCount: cached.length,
    externalSeconds,
    cachedSeconds,
    savedSeconds: external.length && cached.length ? Math.max(0, externalSeconds - cachedSeconds) : 0,
    message,
  };
}

module.exports = {
  MAX_ENTRIES,
  historyFile,
  read,
  record,
  summarize,
};
