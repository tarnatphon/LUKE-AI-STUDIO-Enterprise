"use strict";

/**
 * The numbers the resource governor acts on, and one place that validates them.
 *
 * The governor itself is a set of pure decisions (`assessMemoryPressure`,
 * `planRelease`) fed by a policy. Until now that policy could only be changed by
 * hand-editing `app/runtime-state/resource-governor.json` — a file nobody knows
 * about until a model vanishes in the middle of their work and the log line is
 * the only clue.
 *
 * So the same validation the timer needs is written here once, and both the API
 * route and the Performance panel go through it. Two rules matter more than the
 * rest:
 *
 *   * a threshold that is not a number is not saved — a typo must not turn into
 *     "the governor releases everything, always";
 *   * an override is only what the user changed. The tier defaults stay the
 *     starting point, so a machine can be reset without guessing what the
 *     shipped values were.
 *
 * Reads and writes take the file path as an argument, so this can be tested
 * against a temporary directory instead of the user's runtime state.
 */

const fs = require("node:fs");
const path = require("node:path");
const { TIER_POLICIES, policyFor } = require("./resource-governor.cjs");

/**
 * Every key the governor reads, with the limits that keep a hand-typed value
 * sane. `group` is what the panel uses to lay them out.
 */
const EDITABLE_FIELDS = [
  {
    key: "enabled",
    kind: "boolean",
    label: "Governor on",
    group: "general",
    help: "When a model has to go to keep the machine alive, the governor takes it. Off means nothing is ever released automatically.",
  },
  {
    key: "idleMinutes",
    kind: "number",
    label: "Wait before releasing an idle model",
    unit: "min",
    min: 0,
    max: 1440,
    step: 5,
    group: "general",
    help: "Only matters under memory pressure: an engine used more recently than this is left alone. 0 switches the timer off, so only a critical machine releases anything.",
  },
  {
    key: "minimumReleaseGb",
    kind: "number",
    label: "Smallest release worth doing",
    unit: "GB",
    min: 0,
    max: 64,
    step: 0.1,
    group: "general",
    help: "Releasing a small engine costs a reload and gives back almost nothing.",
  },
  {
    key: "criticalSwapGb",
    kind: "number",
    label: "Swap · critical",
    unit: "GB",
    min: 0,
    max: 256,
    step: 0.5,
    group: "swap",
    help: "Swap in use above this releases a model even if it was used a second ago. macOS keeps swap allocated long after a spike, so raising this makes the governor less eager.",
  },
  {
    key: "tightSwapGb",
    kind: "number",
    label: "Swap · tight",
    unit: "GB",
    min: 0,
    max: 256,
    step: 0.25,
    group: "swap",
    help: "On its own this only confirms pressure from another signal — swap outlives the spike that caused it.",
  },
  {
    key: "criticalCompressorGb",
    kind: "number",
    label: "Compressed memory · critical",
    unit: "GB",
    min: 0,
    max: 256,
    step: 0.5,
    group: "memory",
    help: "The compressor holding this much means the machine is short right now. This is the signal that actually fires on a Mac.",
  },
  {
    key: "tightCompressorGb",
    kind: "number",
    label: "Compressed memory · tight",
    unit: "GB",
    min: 0,
    max: 256,
    step: 0.5,
    group: "memory",
    help: "With the idle timer, this is enough to release a model nobody is using.",
  },
  {
    key: "availableRatioTight",
    kind: "number",
    label: "Free RAM · tight",
    unit: "ratio",
    min: 0,
    max: 1,
    step: 0.01,
    group: "memory",
    help: "Fraction of RAM still available. Linux and Windows use this; macOS relies on swap and the compressor.",
  },
  {
    key: "availableRatioCritical",
    kind: "number",
    label: "Free RAM · critical",
    unit: "ratio",
    min: 0,
    max: 1,
    step: 0.01,
    group: "memory",
    help: "Below this fraction the machine is treated as critical.",
  },
  {
    key: "sweepMs",
    kind: "number",
    label: "How often to look",
    unit: "ms",
    min: 15000,
    max: 3600000,
    step: 5000,
    group: "general",
    help: "A sweep costs two small commands on macOS. Takes effect the next time the app starts.",
  },
];

const FIELD_BY_KEY = new Map(EDITABLE_FIELDS.map((field) => [field.key, field]));

/** Pairs that only make sense in one order. */
const ORDERED_PAIRS = [
  ["criticalSwapGb", "tightSwapGb"],
  ["criticalCompressorGb", "tightCompressorGb"],
];

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function defaultFile(root) {
  return path.join(root, "app", "runtime-state", "resource-governor.json");
}

/** The overrides as they sit on disk — only keys the governor understands. */
function readOverrides(file) {
  const stored = readJson(file, {});
  const overrides = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!FIELD_BY_KEY.has(key)) continue;
    overrides[key] = value;
  }
  return overrides;
}

/**
 * Accept, clamp or reject each key. A rejected key is reported rather than
 * silently dropped, because "I saved it and nothing changed" is the worst
 * possible answer for a setting.
 */
function normalizeOverrides(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const overrides = {};
  const rejected = [];

  for (const [key, raw] of Object.entries(source)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) {
      rejected.push({ key, reason: "ไม่ใช่ค่าที่ governor ใช้" });
      continue;
    }
    if (field.kind === "boolean") {
      if (raw === true || raw === false) {
        overrides[key] = raw;
        continue;
      }
      const text = String(raw).trim().toLowerCase();
      if (text === "true" || text === "false") {
        overrides[key] = text === "true";
        continue;
      }
      rejected.push({ key, reason: "ต้องเป็น true หรือ false" });
      continue;
    }

    const value = raw === null || raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(value)) {
      rejected.push({ key, reason: "ต้องเป็นตัวเลข" });
      continue;
    }
    if (value < field.min || value > field.max) {
      rejected.push({ key, reason: `ต้องอยู่ระหว่าง ${field.min} ถึง ${field.max}` });
      continue;
    }
    overrides[key] = value;
  }

  // Ordering: a critical threshold below its tight partner can never fire, and
  // would make the governor look broken rather than strict.
  for (const [criticalKey, tightKey] of ORDERED_PAIRS) {
    if (criticalKey === tightKey) continue;
    const critical = overrides[criticalKey];
    const tight = overrides[tightKey];
    if (Number.isFinite(critical) && Number.isFinite(tight) && critical < tight) {
      rejected.push({
        key: criticalKey,
        reason: `ต้องไม่ต่ำกว่า ${tightKey} (${tight})`,
      });
      delete overrides[criticalKey];
    }
  }
  if (
    Number.isFinite(overrides.availableRatioCritical) &&
    Number.isFinite(overrides.availableRatioTight) &&
    overrides.availableRatioCritical > overrides.availableRatioTight
  ) {
    rejected.push({
      key: "availableRatioCritical",
      reason: "ต้องไม่มากกว่า availableRatioTight",
    });
    delete overrides.availableRatioCritical;
  }

  return { overrides, rejected };
}

/**
 * The whole picture for the panel: the tier's shipped defaults, the user's
 * overrides, and the policy that is actually in force.
 */
function describeGovernorSettings({ tier = "mid", overrides = null, status = null, file = null } = {}) {
  const stored = overrides && typeof overrides === "object" ? overrides : {};
  const policy = policyFor({ tier, overrides: stored });
  return {
    tier,
    file: file ? String(file) : null,
    fields: EDITABLE_FIELDS,
    defaults: { ...(TIER_POLICIES[tier] || TIER_POLICIES.mid) },
    overrides: { ...stored },
    policy,
    status: status || null,
  };
}

/** Writes only when there is something to write; an empty set removes the file. */
function writeOverrides(file, overrides) {
  const cleaned = { ...(overrides || {}) };
  if (!Object.keys(cleaned).length) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* nothing to remove */
    }
    return { file: String(file), overrides: {} };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cleaned, null, 2)}\n`, "utf8");
  return { file: String(file), overrides: cleaned };
}

/**
 * Merge a request into what is on disk. `reset: true` clears everything; a key
 * set to null clears just that one, so the panel can hand a single field back
 * to the tier default without wiping the rest.
 */
function saveOverrides({ file, input = {}, merge = true } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const existing = merge ? readOverrides(file) : {};
  const requested = { ...(body.overrides || {}) };
  const cleared = [];

  if (body.reset === true) {
    writeOverrides(file, {});
    return { overrides: {}, cleared: Object.keys(existing), rejected: [] };
  }

  for (const [key, value] of Object.entries(requested)) {
    if (value === null) {
      delete requested[key];
      if (key in existing) {
        delete existing[key];
        cleared.push(key);
      }
    }
  }

  const { overrides, rejected } = normalizeOverrides({ ...existing, ...requested });
  writeOverrides(file, overrides);
  return { overrides, cleared, rejected };
}

module.exports = {
  EDITABLE_FIELDS,
  defaultFile,
  describeGovernorSettings,
  normalizeOverrides,
  readOverrides,
  saveOverrides,
  writeOverrides,
};
