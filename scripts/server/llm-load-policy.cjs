"use strict";

function cpuIsolationArgs({ platform, gpuLayers, help = "" }) {
  if (platform !== "darwin" || gpuLayers !== 0) return [];
  const flags = ["--device", "--no-kv-offload", "--no-op-offload"];
  const missing = flags.filter(flag => !new RegExp(`${flag}\\b`).test(help));
  if (missing.length) throw new Error(`CPU isolation requires a newer llama.cpp backend (missing ${missing.join(", ")}). Update the text backend; -ngl 0 alone does not disable Metal.`);
  return ["--device", "none", "--no-kv-offload", "--no-op-offload"];
}

function safeProfile(contextSize) {
  return { name: "safe-cpu", contextSize: Math.min(4096, contextSize), gpuLayers: 0, flashAttn: false,
    cacheTypeK: "f16", cacheTypeV: "f16", batchSize: 64, ubatchSize: 64, enableThinking: false };
}

// A wall-clock deadline, not "number of polls * assumed interval". A health
// request can itself take a second, so the old attempt counter was misleading.
async function waitForReady({ isAlive, checkReady, markReady, timeoutMs, deadline = Infinity,
  getError = () => "", getTail = () => "", now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const started = now();
  const end = Math.min(started + timeoutMs, deadline);
  while (now() < end) {
    if (!isAlive()) throw new Error(getError() || "llama.cpp exited during startup.");
    if (await checkReady()) {
      if (!isAlive()) throw new Error(getError() || "llama.cpp exited during startup.");
      markReady(); return;
    }
    if (now() < end) await sleep(Math.min(500, end - now()));
  }
  const tail = String(getTail() || getError() || "").trim().slice(-1200);
  throw new Error(`llama.cpp readiness timed out after ${Math.round((now() - started) / 1000)} seconds.${tail ? ` Last backend output:\n${tail}` : " No backend output was captured."}`);
}
function restoreSettings(settings = {}) {
  return Object.fromEntries(["model", "contextSize", "gpuLayers", "threads", "flashAttn", "cacheTypeK", "cacheTypeV", "batchSize", "ubatchSize", "enableThinking", "mmap", "mlock", "cachePrompt", "preferredBackend"].filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
}
function delayGovernorRestore(snapshot, pressure, now = Date.now()) {
  return snapshot?.releasedBy === "governor" && (now - Number(snapshot.releasedAt || 0) < 30000 || pressure?.level === "critical");
}
module.exports = { cpuIsolationArgs, safeProfile, waitForReady, restoreSettings, delayGovernorRestore };
