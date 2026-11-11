"use strict";

/**
 * What this machine's text backend has already proved it cannot load.
 *
 * llama.cpp says which architecture it does not know only when a load fails:
 *
 *     llama_model_loader: - kv 0: general.architecture str = qwen3vl
 *     error loading model: unknown model architecture: 'qwen3vl'
 *
 * The app explained that properly (llm-error-log.cjs), but only *after* the
 * attempt: pick a model, wait for a backend to start, watch it die, read the
 * message. The next time the same model appears in the list there is still
 * nothing on the row, because the thing that learned the fact threw it away
 * with the error string.
 *
 * So: keep the fact. When every backend fails with "unknown model architecture",
 * the architecture is recorded against the exact binaries that refused it —
 * their path, size and mtime. The model list then carries a warning *before* the
 * Load button is pressed:
 *
 *     This backend does not know the 'qwen3vl' architecture — it is older than
 *     the model. Update it (scripts/setup/setup-llama.sh with a newer
 *     LLAMA_RELEASE), then restart LUKE.
 *
 * Why size+mtime rather than a version number: the app cannot ask a binary what
 * architectures it understands, and it should not invent a build→architecture
 * table that will be wrong the moment llama.cpp ships something new. A failed
 * load is evidence about *that file*; replacing the file (an upgrade changes its
 * size or its mtime) retires the evidence by itself. A load that succeeds
 * retires it too, in the other direction: success is the strongest evidence
 * there is.
 *
 * Nothing here decides anything. It cannot refuse a load — an old record, a
 * second backend, a different quant or an upgraded binary may all make the next
 * attempt work, and a warning that blocks is worse than no warning. It is a
 * sentence next to a model name.
 *
 * State: app/runtime-state/backend-architecture-limits.json (gitignored, this
 * machine only). LUKE_BACKEND_ARCH_LIMITS_FILE aims it at a throwaway file.
 */

const fs = require("node:fs");
const path = require("node:path");
const { readJson, writeJsonAtomic } = require("./json-store.cjs");

const STATE_VERSION = 1;

function statePath() {
  const override = String(process.env.LUKE_BACKEND_ARCH_LIMITS_FILE || "").trim();
  if (override) return path.resolve(override);
  return path.join(__dirname, "..", "..", "app", "runtime-state", "backend-architecture-limits.json");
}

/**
 * The identity of a backend binary: enough to tell "the same file" from "the
 * file an upgrade replaced", without asking it anything.
 */
function identify(binaryPath) {
  if (!binaryPath) return null;
  try {
    const stats = fs.statSync(String(binaryPath));
    if (!stats.isFile()) return null;
    return { path: path.resolve(String(binaryPath)), sizeBytes: stats.size, mtimeMs: Math.round(stats.mtimeMs) };
  } catch {
    return null;
  }
}

function emptyState() {
  return { version: STATE_VERSION, limits: [] };
}

function readState() {
  try {
    const parsed = readJson(statePath());
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.limits)) return emptyState();
    return {
      version: STATE_VERSION,
      limits: parsed.limits.filter((entry) => entry && typeof entry.architecture === "string" && entry.architecture),
    };
  } catch {
    // Missing, half-written, or hand-edited into nonsense: an empty ledger, not
    // a failed model list.
    return emptyState();
  }
}

function writeState(state) {
  // skipIfUnchanged: pruning on every model-list read must not touch the file
  // when nothing was actually stale.
  writeJsonAtomic(statePath(), state, { skipIfUnchanged: true });
}

/**
 * Is the entry still about the binaries that are installed now?
 *
 * Every binary it was recorded against must still be the same file. A missing
 * binary, or one whose size or mtime moved, means an upgrade happened and the
 * record describes a backend that is no longer here.
 */
function stillCurrent(entry) {
  const backends = Array.isArray(entry.backends) ? entry.backends : [];
  if (backends.length === 0) return false;
  for (const recorded of backends) {
    const now = identify(recorded && recorded.path);
    if (!now) return false;
    if (now.sizeBytes !== recorded.sizeBytes || now.mtimeMs !== recorded.mtimeMs) return false;
  }
  return true;
}

/**
 * Record that these binaries do not know `architecture`.
 *
 * Refuses without at least one identifiable binary: an entry that can never be
 * checked would warn forever, including after the upgrade that fixes it.
 */
function record({ architecture, backends = [], model = "", now = new Date() } = {}) {
  const name = String(architecture || "").trim();
  if (!name) return null;

  const identities = (Array.isArray(backends) ? backends : [])
    .map((binary) => identify(binary && binary.path ? binary.path : binary))
    .filter(Boolean);
  if (identities.length === 0) return null;

  const state = readState();
  const entry = {
    architecture: name,
    model: String(model || ""),
    seenAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    backends: identities,
  };
  state.limits = state.limits.filter((existing) => existing.architecture !== name);
  state.limits.push(entry);
  writeState(state);
  return entry;
}

/** Forget one architecture — a successful load of it is proof enough. */
function clear(architecture) {
  const name = String(architecture || "").trim();
  if (!name) return false;
  const state = readState();
  const kept = state.limits.filter((entry) => entry.architecture !== name);
  if (kept.length === state.limits.length) return false;
  state.limits = kept;
  writeState(state);
  return true;
}

/**
 * The limits that still describe the installed binaries. Stale entries are
 * pruned on the way past, so an upgrade is not punished for a record written
 * about the binary it replaced.
 */
function activeLimits() {
  const state = readState();
  const current = state.limits.filter(stillCurrent);
  if (current.length !== state.limits.length) {
    try {
      writeState({ version: STATE_VERSION, limits: current });
    } catch {
      // A read-only runtime-state must not break the model list.
    }
  }
  return current;
}

/** The entry for one architecture, or null. */
function forArchitecture(architecture) {
  const name = String(architecture || "").trim();
  if (!name) return null;
  return activeLimits().find((entry) => entry.architecture === name) || null;
}

/** The sentence shown on the model row. */
function describe(entry) {
  if (!entry || !entry.architecture) return "";
  const when = String(entry.seenAt || "").slice(0, 10);
  const seen = when ? ` (seen ${when}${entry.model ? ` on ${entry.model}` : ""})` : "";
  return (
    `The text backend reported that it does not know the '${entry.architecture}' architecture${seen}, ` +
    "so this build of llama.cpp is older than the model. Update the text backend with " +
    "scripts/setup/setup-llama.sh and LLAMA_RELEASE set to a newer build, then restart LUKE — " +
    "or pick a model whose architecture this backend knows."
  );
}

module.exports = {
  statePath,
  identify,
  record,
  clear,
  activeLimits,
  forArchitecture,
  describe,
};
