"use strict";

/**
 * Memory calibration — teaches LUKE AI STUDIO the *real* memory ceiling of the
 * machine it is running on.
 *
 * Why this exists
 * ---------------
 * `os.totalmem()` and the reported VRAM size are not the number that matters.
 * On Apple Silicon the GPU shares RAM with the CPU but Metal only lets a device
 * address a fraction of it. stable-diffusion.cpp / llama.cpp print the value
 * during start-up:
 *
 *   ggml_metal_device_init: recommendedMaxWorkingSetSize  = 14302.25 MB
 *
 * That number (~14.3 GB on an 18 GB M3 Pro) — not the 18 GB total — is the
 * budget the models have to share. Using the total is what makes a "small"
 * machine look like it has room and then crash with
 * `Insufficient Memory (kIOGPUCommandBufferCallbackErrorOutOfMemory)`.
 *
 * The module also records out-of-memory incidents so the budget can be
 * tightened automatically after a crash instead of repeating it.
 */

const fs = require("node:fs");
const path = require("node:path");

const WORKING_SET_RE = /recommendedMaxWorkingSetSize\s*=\s*([\d.,]+)\s*MB/i;
const OOM_RE =
  /(Insufficient Memory|OutOfMemory|out of memory|failed to decode|failed to compute graph|backend is in error state|kIOGPUCommandBufferCallbackErrorOutOfMemory)/i;

const DEFAULT_INCIDENT_TTL_MINUTES = 24 * 60;

function delay() {}

function safeReadJson(filePath, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temp, filePath);
  } catch (_) {
    /* calibration is best effort: never break a model load because of it */
  }
}

function parseNumber(raw) {
  const normalized = String(raw || "").replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

class MemoryCalibration {
  constructor(options = {}) {
    this.stateDir = options.stateDir || path.join(__dirname, "..", "..", "app", "runtime-state", "memory");
    this.workingSetPath = options.workingSetPath || path.join(this.stateDir, "gpu-working-set.json");
    this.incidentsPath = options.incidentsPath || path.join(this.stateDir, "memory-incidents.json");
    this.logger = options.logger || console;
    this.now = options.now || (() => Date.now());
    this.maxIncidents = Number(options.maxIncidents) || 20;
    this.cache = null;
  }

  /**
   * Scans one chunk of backend output (stable-diffusion.cpp, llama-server, …).
   * Call this from every stderr/stdout hook. Cheap: two regexes per chunk.
   */
  scan(text) {
    const chunk = String(text || "");
    if (!chunk) return { learnedWorkingSet: false, sawOutOfMemory: false };

    let learnedWorkingSet = false;
    const match = chunk.match(WORKING_SET_RE);
    if (match) {
      const gb = parseNumber(match[1]) / 1024;
      if (gb > 0) learnedWorkingSet = this.recordWorkingSet(gb, chunk);
    }

    const sawOutOfMemory = OOM_RE.test(chunk);
    if (sawOutOfMemory) this.recordIncident(chunk);

    return { learnedWorkingSet, sawOutOfMemory };
  }

  recordWorkingSet(gb, sourceText = "") {
    const current = this.readWorkingSet();
    const previous = Number(current?.workingSetGb) || 0;
    // Devices can report different values per process; keep the smallest
    // trustworthy measurement so the budget stays on the safe side.
    if (previous > 0 && Math.abs(previous - gb) < 0.05) return false;
    if (previous > 0 && previous < gb) return false;
    const entry = {
      schemaVersion: 1,
      workingSetGb: Number(gb.toFixed(2)),
      previousWorkingSetGb: previous || null,
      device: (sourceText.match(/GPU name:\s*([^\n\r]+)/i) || [])[1]?.trim() || null,
      source: "ggml_metal_device_init",
      updatedAt: new Date(this.now()).toISOString(),
    };
    writeJsonAtomic(this.workingSetPath, entry);
    this.cache = entry;
    this.logger.log?.(
      `  [memory] learned GPU working set: ${entry.workingSetGb} GB (this is the real budget, not the total RAM).`
    );
    return true;
  }

  readWorkingSet() {
    if (this.cache) return this.cache;
    this.cache = safeReadJson(this.workingSetPath, null);
    return this.cache;
  }

  workingSetGb() {
    const entry = this.readWorkingSet();
    const gb = Number(entry?.workingSetGb) || 0;
    return gb > 0 ? gb : 0;
  }

  recordIncident(text = "") {
    const state = safeReadJson(this.incidentsPath, { incidents: [] });
    const incidents = Array.isArray(state.incidents) ? state.incidents : [];
    const last = incidents[incidents.length - 1];
    const now = this.now();
    // Collapse the flood of ggml errors that follow a single crash.
    if (last && now - Date.parse(last.at || 0) < 10000) return incidents.length;
    incidents.push({
      at: new Date(now).toISOString(),
      detail: String(text).replace(/\s+/g, " ").trim().slice(0, 200),
    });
    writeJsonAtomic(this.incidentsPath, {
      schemaVersion: 1,
      updatedAt: new Date(now).toISOString(),
      incidents: incidents.slice(-this.maxIncidents),
    });
    return incidents.length;
  }

  recentIncidents(ttlMinutes = DEFAULT_INCIDENT_TTL_MINUTES) {
    const state = safeReadJson(this.incidentsPath, { incidents: [] });
    const list = Array.isArray(state.incidents) ? state.incidents : [];
    const cutoff = this.now() - ttlMinutes * 60 * 1000;
    return list.filter((entry) => {
      const at = Date.parse(entry?.at || 0);
      return Number.isFinite(at) && at >= cutoff;
    });
  }

  /**
   * Extra safety margin learned from crashes: every out-of-memory incident
   * shrinks the usable pool a little, so the machine stops repeating the same
   * crash instead of relying on the user to guess the right settings.
   */
  penaltyGb(config = {}) {
    if (config.enabled === false) return 0;
    const perIncident = Number(config.penaltyPerIncidentGb ?? 0.5);
    const maxPenalty = Number(config.maxPenaltyGb ?? 2);
    const ttlMinutes = Number(config.incidentTtlMinutes ?? DEFAULT_INCIDENT_TTL_MINUTES);
    const count = this.recentIncidents(ttlMinutes).length;
    if (count <= 0) return 0;
    return Number(Math.min(maxPenalty, count * perIncident).toFixed(2));
  }

  status() {
    const incidents = this.recentIncidents();
    return {
      workingSetGb: this.workingSetGb(),
      recentIncidents: incidents.length,
      lastIncidentAt: incidents.length ? incidents[incidents.length - 1].at : null,
    };
  }
}

module.exports = {
  MemoryCalibration,
  WORKING_SET_RE,
  OOM_RE,
  delay,
};
