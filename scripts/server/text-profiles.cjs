"use strict";

/**
 * Two text-model slots: Chat and Work.
 *
 * Before this, one GGUF was "the model": you picked a 30B coder to make Work
 * usable, and then Chat was answered by a coder — dry, terse, and at
 * temperature 0.2. Pick a chat model instead and Work stops calling tools. One
 * slot cannot be good at both jobs, so there are two, each with its own model
 * and its own sampling, and only one of them is resident at a time (an 18 GB
 * Mac cannot hold two GGUFs, and pretending otherwise is how swap storms start).
 *
 * What this module owns:
 *   - the defaults (app/config/text-profiles.json, versioned)
 *   - the saved choice (app/runtime-state/text-profiles.json, gitignored)
 *   - validation, so a path or a nonsense value never reaches llama.cpp
 *   - the warnings that encode what actually makes Work work: a coding agent
 *     needs tool calling, a low temperature, and a 16K+ window
 *
 * What it does not own: starting the engine. serve.cjs does that
 * (`POST /api/text-profiles/activate`), because only it knows the backend, the
 * port and the load budget.
 */

const fs = require("node:fs");
const path = require("node:path");
const { readJsonOr: safeReadJson } = require("./json-store.cjs");

const ROOT = path.join(__dirname, "..", "..");
const DEFAULTS_PATH = path.join(ROOT, "app", "config", "text-profiles.json");
const IDS = ["chat", "work"];

function statePath() {
  return process.env.LUKE_TEXT_PROFILES_FILE
    || path.join(ROOT, "app", "runtime-state", "text-profiles.json");
}
function readDefaults() {
  const parsed = safeReadJson(DEFAULTS_PATH, null);
  const profiles = parsed && parsed.profiles ? parsed.profiles : {};
  const result = {};
  for (const id of IDS) {
    result[id] = { ...(profiles[id] || {}), id };
  }
  return result;
}

function readState() {
  const parsed = safeReadJson(statePath(), null);
  const profiles = parsed && parsed.profiles ? parsed.profiles : {};
  const result = {};
  for (const id of IDS) {
    result[id] = profiles[id] && typeof profiles[id] === "object" ? { ...profiles[id] } : {};
  }
  return result;
}

/** Defaults <- saved, so an upgrade that changes a default still reaches users. */
function readProfiles() {
  const defaults = readDefaults();
  const saved = readState();
  const merged = {};
  for (const id of IDS) {
    merged[id] = { ...defaults[id], ...saved[id], id };
    merged[id].model = normalizeModel(merged[id].model);
    merged[id].contextSize = clampInt(merged[id].contextSize, 512, 262144, defaults[id].contextSize);
    merged[id].temperature = clampNumber(merged[id].temperature, 0, 2, defaults[id].temperature);
    merged[id].topP = clampNumber(merged[id].topP, 0.01, 1, defaults[id].topP);
  }
  return merged;
}

function normalizeModel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // A model is a file name in app/llm-models, never a path: this is the one
  // place a value from the browser becomes a file the server opens.
  const base = path.basename(raw);
  if (!/\.gguf$/i.test(base)) return "";
  return base;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/**
 * What is wrong with this profile as configured — not fatal, but the reasons
 * Work will disappoint. Encoded here so the API, the CLI and the UI agree.
 */
function warningsFor(id, profile) {
  const warnings = [];
  if (!profile.model) {
    warnings.push({
      code: "no-model",
      message: `${id} has no model yet — pick one, or activation will refuse.`,
    });
    return warnings;
  }
  if (id === "work") {
    if (Number(profile.contextSize) < Number(profile.minContextTokens || 16384)) {
      warnings.push({
        code: "small-context",
        message: `Work is set to ${profile.contextSize} tokens. A coding agent's own system prompt and tool schemas need ${profile.minContextTokens || 16384}+; raise it or expect truncated edits.`,
      });
    }
    if (Number(profile.temperature) > Number(profile.maxTemperature || 0.6)) {
      warnings.push({
        code: "warm-sampling",
        message: `Work is at temperature ${profile.temperature}. Tool calls degrade above ${profile.maxTemperature || 0.6}; a coding agent wants 0.1–0.3.`,
      });
    }
    if (profile.requiresToolCalling && profile.toolCalling === false) {
      warnings.push({
        code: "no-tool-calling",
        message: "The loaded backend did not start with tool calling (--jinja), so Work can read but never call a tool.",
      });
    }
  }
  return warnings;
}

/**
 * Save one slot. Unknown ids and non-GGUF names are rejected instead of
 * silently ignored — a typo that saves nothing looks like the app forgetting.
 */
function saveProfile(id, patch = {}) {
  if (!IDS.includes(id)) {
    const error = new Error(`Unknown profile "${id}". Use chat or work.`);
    error.statusCode = 400;
    throw error;
  }
  const defaults = readDefaults()[id];
  const state = readState();

  const next = { ...(state[id] || {}) };
  if (patch.model !== undefined) {
    const model = normalizeModel(patch.model);
    if (String(patch.model || "").trim() && !model) {
      const error = new Error("A model must be a .gguf file name, not a path.");
      error.statusCode = 400;
      throw error;
    }
    next.model = model;
  }
  if (patch.contextSize !== undefined) next.contextSize = clampInt(patch.contextSize, 512, 262144, defaults.contextSize);
  if (patch.temperature !== undefined) next.temperature = clampNumber(patch.temperature, 0, 2, defaults.temperature);
  if (patch.topP !== undefined) next.topP = clampNumber(patch.topP, 0.01, 1, defaults.topP);

  state[id] = next;
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify({ schemaVersion: 1, profiles: state }, null, 2)}\n`, "utf8");
  fs.renameSync(temp, target);

  const profiles = readProfiles();
  return { profile: profiles[id], profiles, warnings: warningsFor(id, profiles[id]) };
}

/** The args startLlm already understands, built from a profile. */
function settingsFor(id, overrides = {}) {
  const profile = readProfiles()[id];
  if (!profile || !profile.model) {
    const error = new Error(`No model is set for the ${id} profile. Pick one in Chat and Work settings.`);
    error.statusCode = 409;
    error.code = "NO_PROFILE_MODEL";
    throw error;
  }
  return {
    model: profile.model,
    contextSize: profile.contextSize,
    temperature: profile.temperature,
    topP: profile.topP,
    ...overrides,
  };
}

/** Which slot does a resident model file belong to? ("both" if one model serves both.) */
function classify(model, profiles = readProfiles()) {
  const needle = normalizeModel(model);
  if (!needle) return null;
  const chat = profiles.chat.model === needle;
  const work = profiles.work.model === needle;
  if (chat && work) return "both";
  if (work) return "work";
  if (chat) return "chat";
  return null;
}

function describe({ resident = null } = {}) {
  const profiles = readProfiles();
  return {
    profiles,
    resident,
    activeProfile: resident ? classify(resident.model, profiles) : null,
    warnings: {
      chat: warningsFor("chat", profiles.chat),
      work: warningsFor("work", profiles.work),
    },
  };
}

module.exports = {
  IDS,
  DEFAULTS_PATH,
  statePath,
  readDefaults,
  readProfiles,
  saveProfile,
  settingsFor,
  warningsFor,
  classify,
  describe,
  normalizeModel,
};
