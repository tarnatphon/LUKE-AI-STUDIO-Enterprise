"use strict";

/**
 * How big the context window may be for the model that is about to start.
 *
 * Two mistakes made this number wrong on an 18 GB Mac:
 *   1. an image backend that was merely *waiting* (no model loaded) was counted
 *      as resident, so the window was cut to 8192 for no reason;
 *   2. the KV cache cost was guessed with a very pessimistic table, so with
 *      nothing else loaded the same model was offered 20000.
 *
 * The planner therefore works from the memory that is really free, and it
 * learns the true KV cost from llama.cpp's own start-up line
 * ("KV self size = 604.00 MiB") after the model has run once.
 */

const fs = require("node:fs");
const path = require("node:path");

// Auto-selection stops at 16384: it is the largest window that stays
// comfortable next to the compute buffers. Anything bigger is a deliberate
// choice the user makes in the model settings.
const LADDER = [16384, 12288, 8192, 4096, 2048];
// llama.cpp words this differently per build:
//   llama_kv_cache:   CUDA0 KV buffer size =   604.00 MiB
//   llama_kv_cache:      CPU KV self size  =   604.00 MiB, K (f16):  302.00 MiB
const KV_SELF_SIZE_RE = /\bKV\s+(?:self|buffer|cache)\s+size\s*=\s*([\d.,]+)\s*MiB/i;

/** Pessimistic guess, only used until llama.cpp tells us the real number. */
function fallbackKvGbPer4096(modelSizeGb) {
  if (modelSizeGb >= 5.5) return 1.05;
  if (modelSizeGb >= 4.0) return 0.85;
  return 0.55;
}

function planContextSize(input = {}) {
  const modelSizeGb = Number(input.modelSizeGb) || 4;
  const projectorSizeGb = Number(input.projectorSizeGb) || 0;
  const residentGb = Math.max(0, Number(input.residentGb) || 0);
  const isGpu = input.isGpu === true;
  const vramGb = Number(input.vramGb) || 0;
  const systemRamGb = Number(input.systemRamGb) || 8;
  const workingSetGb = Number(input.workingSetGb) || 0;

  // The pool everything has to fit in: total RAM, limited by the GPU and by the
  // working set Metal actually allows (14.3 GB on an 18 GB M3 Pro).
  let poolGb = systemRamGb;
  if (isGpu && vramGb > 0) poolGb = Math.min(poolGb, vramGb);
  if (workingSetGb > 0) poolGb = Math.min(poolGb, workingSetGb);

  const bufferGb = isGpu && vramGb > 0 ? 1.5 : 2.5;
  const freeGb = Math.max(0.25, poolGb - modelSizeGb - projectorSizeGb - bufferGb - residentGb);

  // The KV cache shares the free memory with compute buffers and framework
  // overhead, so it only gets most of it — never all of it.
  const kvBudgetGb = Math.max(0.25, freeGb * 0.85);

  const kvGbPerToken = Number(input.kvGbPerToken) || 0;
  const per4096 = kvGbPerToken > 0 ? kvGbPerToken * 4096 : fallbackKvGbPer4096(modelSizeGb);
  const ceiling = Math.floor((kvBudgetGb / per4096) * 4096);

  let contextSize = LADDER.find((limit) => limit <= ceiling) || 2048;
  if (input.isVision) contextSize = Math.min(contextSize, freeGb >= 2.5 ? 8192 : 4096);

  return {
    contextSize,
    poolGb: Number(poolGb.toFixed(2)),
    freeGb: Number(freeGb.toFixed(2)),
    kvBudgetGb: Number(kvBudgetGb.toFixed(2)),
    kvGbPer4096: Number(per4096.toFixed(4)),
    ceiling,
    usedLearnedKv: kvGbPerToken > 0,
  };
}

/** "llama_kv_cache: … KV self size  =  604.00 MiB" → 604 */
function parseKvSelfSizeMib(text) {
  const match = String(text || "").match(KV_SELF_SIZE_RE);
  if (!match) return 0;
  const value = Number.parseFloat(String(match[1]).replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function kvProfileFile(stateDir) {
  return path.join(stateDir, "text-chat", "llm-kv-profile.json");
}

function readKvProfile(stateDir, modelName) {
  if (!stateDir || !modelName) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(kvProfileFile(stateDir), "utf8"));
    const entry = parsed?.models?.[String(modelName)];
    const kvMib = Number(entry?.kvMib) || 0;
    const ctx = Number(entry?.contextSize) || 0;
    if (!kvMib || !ctx) return 0;
    return kvMib / 1024 / ctx; // GB per token
  } catch (_) {
    return 0;
  }
}

function recordKvProfile(stateDir, modelName, { contextSize, kvMib }) {
  if (!stateDir || !modelName || !contextSize || !kvMib) return false;
  try {
    const file = kvProfileFile(stateDir);
    let parsed = { models: {} };
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || !parsed.models) parsed = { models: {} };
    } catch (_) {}
    parsed.models[String(modelName)] = {
      kvMib: Number(kvMib.toFixed(2)),
      contextSize: Number(contextSize),
      gbPer4096: Number(((kvMib / 1024 / contextSize) * 4096).toFixed(4)),
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(parsed, null, 2));
    fs.renameSync(temp, file);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  LADDER,
  fallbackKvGbPer4096,
  kvProfileFile,
  parseKvSelfSizeMib,
  planContextSize,
  readKvProfile,
  recordKvProfile,
};
