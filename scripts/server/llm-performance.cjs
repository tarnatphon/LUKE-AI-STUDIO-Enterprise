"use strict";

/**
 * Runtime tuning the user should never have to guess.
 *
 * Two different problems live here:
 *
 *  - planRuntimeSettings() picks thread and batch counts from the machine it
 *    is actually running on. The wrong numbers are not neutral: on Apple
 *    silicon with the model offloaded to the GPU, spawning one thread per core
 *    drags the efficiency cores into work the GPU is already doing.
 *
 *  - benchmarkRunningLlm() measures the running server, so recommendations are
 *    checked against reality instead of assumed.
 */

const DEFAULT_DRAFT_MAX = 16;
const DEFAULT_DRAFT_MIN = 4;

/**
 * Threads and batch sizes for this machine.
 *
 * On GPU/Metal the model weights live in unified memory and the GPU does the
 * matrix work; the CPU threads only feed it and sample. Keeping them to the
 * performance cores (roughly half of an Apple silicon core count) avoids the
 * efficiency cores stealing bandwidth. In pure CPU mode every core counts.
 */
function planRuntimeSettings({
  cpuCores = 4,
  appleSilicon = false,
  isGpuMode = false,
  systemRamGb = 8,
  modelSizeGb = 0,
} = {}) {
  const cores = Math.max(1, Number(cpuCores) || 4);
  const ram = Math.max(1, Number(systemRamGb) || 8);

  let threads;
  let threadsNote;
  if (isGpuMode) {
    // Half the cores on a big machine (performance cores only), but never
    // below 4 and never more than 8 — sampling does not scale past that.
    threads = cores <= 8 ? Math.max(2, cores - 1) : Math.max(4, Math.min(8, Math.round(cores / 2)));
    threadsNote = appleSilicon
      ? "the GPU runs the model, so the CPU only feeds it — using the performance cores instead of every core"
      : "the GPU runs the model, so a handful of threads is faster than one per core";
  } else {
    threads = Math.max(1, Math.min(16, cores));
    threadsNote = "CPU inference uses every core that is available";
  }

  let batchSize = 512;
  let batchNote = "the safe default";
  if (isGpuMode && ram >= 24) {
    batchSize = 2048;
    batchNote = "there is plenty of memory for large prompt batches";
  } else if (isGpuMode && ram >= 16) {
    batchSize = 1024;
    batchNote = "enough memory to process long chats in fewer passes";
  } else if (ram < 8) {
    batchSize = 256;
    batchNote = "this machine has little memory to spare";
  }
  // A model that already fills most of memory cannot also hold big batches.
  if (modelSizeGb && modelSizeGb > ram * 0.6) {
    batchSize = Math.min(batchSize, 512);
    batchNote = "the model itself already uses most of the memory";
  }

  return {
    threads,
    batchSize,
    ubatchSize: batchSize,
    flashAttn: Boolean(isGpuMode),
    reason: {
      threads: threadsNote,
      batchSize: batchNote,
    },
  };
}

/**
 * Does a draft model fit? Speculative decoding trades memory for speed: the
 * draft model, its own KV cache and the main model all have to be resident.
 */
function planDraftSettings({
  systemRamGb = 8,
  modelSizeGb = 0,
  draftModelSizeGb = 0,
  contextTokens = 0,
  kvBytesPerToken = 0,
  isGpuMode = false,
} = {}) {
  const ram = Math.max(1, Number(systemRamGb) || 8);
  const kvGb = (Number(contextTokens) || 0) * (Number(kvBytesPerToken) || 0) / (1024 ** 3);
  const osHeadroomGb = ram >= 32 ? 3 : ram >= 16 ? 2 : 1.25;
  const neededGb = (Number(modelSizeGb) || 0) + (Number(draftModelSizeGb) || 0) + kvGb + osHeadroomGb;
  const budgetGb = isGpuMode ? ram * 0.92 : ram * 0.85;
  const fits = neededGb <= budgetGb;
  return {
    fits,
    neededGb: Number(neededGb.toFixed(2)),
    budgetGb: Number(budgetGb.toFixed(2)),
    headroomGb: Number((budgetGb - neededGb).toFixed(2)),
    draftMax: DEFAULT_DRAFT_MAX,
    draftMin: DEFAULT_DRAFT_MIN,
    reason: fits
      ? "a draft model fits in the memory that is left"
      : `a draft model would need about ${neededGb.toFixed(1)} GB and only ${budgetGb.toFixed(1)} GB is available`,
  };
}

/** The extra arguments llama.cpp needs for speculative decoding. */
function draftArgs({ draftModelPath, isGpuMode = false, draftMax = DEFAULT_DRAFT_MAX, draftMin = DEFAULT_DRAFT_MIN }) {
  if (!draftModelPath) return [];
  const args = ["--model-draft", draftModelPath, "--draft-max", String(Math.max(1, Number(draftMax) || DEFAULT_DRAFT_MAX))];
  if (Number(draftMin) > 0) args.push("--draft-min", String(Math.max(0, Number(draftMin) || 0)));
  if (isGpuMode) args.push("--n-gpu-layers-draft", "-1");
  return args;
}

/**
 * Measure the running server: how fast it eats a prompt and how fast it
 * writes tokens. Numbers, not guesses.
 */
async function benchmarkRunningLlm({ port, timeoutMs = 60000 } = {}) {
  const url = `http://127.0.0.1:${Number(port)}/completion`;
  const prompt = "The quick brown fox jumps over the lazy dog. Continue the story in three short sentences:";
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5000, Number(timeoutMs) || 60000));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        n_predict: 64,
        temperature: 0,
        cache_prompt: false,
        stream: false,
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    const timings = data?.timings || {};
    return {
      ok: response.ok,
      measuredAt: new Date().toISOString(),
      totalMs: Date.now() - startedAt,
      promptTokensPerSecond: Number(timings.prompt_per_second) || 0,
      tokensPerSecond: Number(timings.predicted_per_second) || 0,
      promptTokens: Number(timings.prompt_n) || 0,
      predictedTokens: Number(timings.predicted_n) || 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      measuredAt: new Date().toISOString(),
      totalMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_DRAFT_MAX,
  DEFAULT_DRAFT_MIN,
  benchmarkRunningLlm,
  draftArgs,
  planDraftSettings,
  planRuntimeSettings,
};
