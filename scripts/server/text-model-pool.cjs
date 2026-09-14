"use strict";

/**
 * Text Model Pool — keeps several llama.cpp text models resident at the same
 * time so LUKE AI STUDIO can run a Model Arena round (multiple chat models
 * answering one prompt in parallel).
 *
 * The legacy single-model runtime (`/api/llm/*`, one llama-server instance)
 * keeps working unchanged. This pool owns its own child processes and ports.
 *
 * Everything external is injected (spawn, fetch, ports, backend resolution)
 * so the pool can be validated without real model weights.
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const DEFAULT_POLICY = {
  runtime: {
    portRange: { start: 28200, end: 28240 },
    contextSize: 4096,
    threads: 4,
    gpuLayers: -1,
    parallelSlots: 1,
    cachePrompt: true,
    flashAttn: true,
    mlock: false,
    mmap: true,
    startupTimeoutMs: 240000,
    generationTimeoutMs: 300000,
    readinessPollMs: 500,
    idleUnloadMinutes: 45,
    idleSweepEnabled: true,
  },
  generation: {
    stream: true,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    minP: 0.05,
    repeatPenalty: 1.1,
    maxTokens: 1024,
  },
  memory: {
    warnOnly: true,
    systemReserveGb: 2,
    contextOverheadRatio: 0.25,
    vramSafetyMarginGb: 0.8,
  },
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function formatGb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function findProjector(modelsDir, filename) {
  const lower = String(filename || "").toLowerCase();
  if (!/vision|llava|vl\b/.test(lower)) return null;
  try {
    const files = fs.readdirSync(modelsDir);
    return (
      files.find((file) => {
        const fileLower = file.toLowerCase();
        return fileLower.endsWith(".gguf") && fileLower.includes("mmproj");
      }) || null
    );
  } catch (_) {
    return null;
  }
}

class TextModelPool {
  constructor(options = {}) {
    this.root = options.root || process.cwd();
    this.modelsDir = options.modelsDir || path.join(this.root, "app", "llm-models");
    this.policyPath =
      options.policyPath ||
      path.join(this.root, "app", "config", "text-chat", "model-arena-policy.json");
    this.statePath =
      options.statePath ||
      path.join(this.root, "app", "runtime-state", "text-chat", "model-arena.json");

    this.spawnImpl = options.spawnImpl || spawn;
    this.resolveBackend = options.resolveBackend || (async () => null);
    this.allocatePort =
      options.allocatePort ||
      (async () => this.defaultAllocatePort());
    this.listModels =
      options.listModels ||
      (() => this.defaultListModels());
    this.getGpuInfo = options.getGpuInfo || (() => null);
    this.logger = options.logger || {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.now = options.now || (() => Date.now());

    /** @type {Map<string, object>} */
    this.instances = new Map();
    this.state = safeReadJson(this.statePath, {
      schemaVersion: 1,
      updatedAt: null,
      feedback: {},
      runs: [],
    });
  }

  // ── policy & state ────────────────────────────────────────────────────────

  readPolicy() {
    const stored = safeReadJson(this.policyPath, null);
    return {
      ...DEFAULT_POLICY,
      ...(stored || {}),
      runtime: { ...DEFAULT_POLICY.runtime, ...(stored?.runtime || {}) },
      generation: { ...DEFAULT_POLICY.generation, ...(stored?.generation || {}) },
      memory: { ...DEFAULT_POLICY.memory, ...(stored?.memory || {}) },
      selection: { maximumModels: 3, minimumModels: 2, ...(stored?.selection || {}) },
    };
  }

  persistState() {
    this.state.updatedAt = new Date().toISOString();
    try {
      writeJsonAtomic(this.statePath, this.state);
    } catch (error) {
      this.logger.warn(`[arena] unable to persist state: ${error.message}`);
    }
  }

  recordRun(entry) {
    const maximumRuns = Number(this.readPolicy().history?.maximumRuns || 30);
    this.state.runs = [entry, ...(this.state.runs || [])].slice(0, maximumRuns);
    this.persistState();
  }

  recordFeedback(modelId, { chosen = false, rating = null } = {}) {
    if (!modelId) return this.getFeedback();
    const bucket = this.state.feedback[modelId] || { positive: 0, negative: 0, chosen: 0, total: 0 };
    bucket.total = Number(bucket.total || 0) + 1;
    if (chosen) {
      bucket.positive = Number(bucket.positive || 0) + 1;
      bucket.chosen = Number(bucket.chosen || 0) + 1;
    }
    if (rating === "up") bucket.positive = Number(bucket.positive || 0) + 1;
    if (rating === "down") bucket.negative = Number(bucket.negative || 0) + 1;
    this.state.feedback[modelId] = bucket;
    this.persistState();
    return this.getFeedback();
  }

  getFeedback() {
    return this.state.feedback || {};
  }

  // ── discovery ─────────────────────────────────────────────────────────────

  defaultListModels() {
    try {
      return fs
        .readdirSync(this.modelsDir)
        .filter((filename) => filename.toLowerCase().endsWith(".gguf"))
        .filter((filename) => !filename.toLowerCase().includes("mmproj"))
        .map((filename) => {
          const stats = fs.statSync(path.join(this.modelsDir, filename));
          return {
            filename,
            name: filename,
            sizeBytes: stats.size,
            size: formatGb(stats.size),
          };
        })
        .sort((left, right) => left.filename.localeCompare(right.filename));
    } catch (_) {
      return [];
    }
  }

  resolveModelPath(modelId) {
    const filename = path.basename(String(modelId || ""));
    const modelPath = path.join(this.modelsDir, filename);
    if (!filename.toLowerCase().endsWith(".gguf")) return null;
    if (!modelPath.startsWith(path.resolve(this.modelsDir) + path.sep)) return null;
    if (!fs.existsSync(modelPath)) return null;
    return modelPath;
  }

  async defaultAllocatePort() {
    const { start = 28200, end = 28240 } = this.readPolicy().runtime.portRange || {};
    for (let port = Number(start); port <= Number(end); port += 1) {
      if (this.usedPorts().has(port)) continue;
      const available = await this.isPortFree(port);
      if (available) return port;
    }
    throw new Error("No free port is available for another arena model.");
  }

  usedPorts() {
    return new Set(Array.from(this.instances.values()).map((instance) => instance.port));
  }

  isPortFree(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen({ host: "127.0.0.1", port });
    });
  }

  // ── capacity advisories (never block) ─────────────────────────────────────

  estimateCapacity(modelIds = []) {
    const policy = this.readPolicy();
    const memory = policy.memory || {};
    const reserveGb = Number(memory.systemReserveGb ?? 2);
    const overheadRatio = Number(memory.contextOverheadRatio ?? 0.25);

    const residentBytes = Array.from(this.instances.values()).reduce(
      (sum, instance) => sum + (Number(instance.sizeBytes) || 0),
      0
    );
    const requestedBytes = modelIds.reduce((sum, modelId) => {
      const found = this.listModels().find((model) => model.filename === modelId);
      return sum + (Number(found?.sizeBytes) || 0);
    }, 0);

    const distinctBytes =
      residentBytes +
      modelIds.reduce((sum, modelId) => {
        if (this.instances.has(modelId)) return sum;
        const found = this.listModels().find((model) => model.filename === modelId);
        return sum + (Number(found?.sizeBytes) || 0);
      }, 0);

    const totalRamGb = os.totalmem() / 1024 ** 3;
    const freeRamGb = os.freemem() / 1024 ** 3;
    const estimatedGb = (distinctBytes / 1024 ** 3) * (1 + overheadRatio) + reserveGb;

    const warnings = [];
    if (estimatedGb > freeRamGb) {
      warnings.push({
        code: "SYSTEM_MEMORY",
        severity: "warning",
        message:
          `These models need about ${estimatedGb.toFixed(1)} GB but only ` +
          `${freeRamGb.toFixed(1)} GB of system memory is free. Generation may be slow ` +
          `or fail; unload another model if it stalls.`,
      });
    }

    const gpu = this.getGpuInfo();
    if (gpu && Number(gpu.vram_gb) > 0 && Number(policy.runtime.gpuLayers) !== 0) {
      const vramGb = Number(gpu.vram_gb);
      const margin = Number(memory.vramSafetyMarginGb ?? 0.8);
      const gpuResident = Array.from(this.instances.values())
        .filter((instance) => instance.gpuLayers !== 0)
        .reduce((sum, instance) => sum + (Number(instance.sizeBytes) || 0), 0);
      const gpuRequested =
        gpuResident +
        modelIds.reduce((sum, modelId) => {
          if (this.instances.has(modelId)) return sum;
          const found = this.listModels().find((model) => model.filename === modelId);
          return sum + (Number(found?.sizeBytes) || 0);
        }, 0);
      const gpuEstimate = gpuRequested / 1024 ** 3 + margin;
      if (gpuEstimate > vramGb) {
        warnings.push({
          code: "GPU_MEMORY",
          severity: "warning",
          message:
            `GPU offloading for these models needs about ${gpuEstimate.toFixed(1)} GB ` +
            `but ${gpu.name || "the GPU"} reports ${vramGb.toFixed(1)} GB. Reduce GPU layers ` +
            `or load fewer models at once if a model fails to start.`,
        });
      }
    }

    return {
      warnOnly: memory.warnOnly !== false,
      totalRamGb: Number(totalRamGb.toFixed(2)),
      freeRamGb: Number(freeRamGb.toFixed(2)),
      estimatedRequiredGb: Number(estimatedGb.toFixed(2)),
      requestedBytes,
      warnings,
    };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  getStatus({ sweep = true } = {}) {
    if (sweep) this.sweepIdle();
    const policy = this.readPolicy();
    return {
      ok: true,
      enabled: policy.enabled !== false,
      maximumModels: Number(policy.selection?.maximumModels || 3),
      minimumModels: Number(policy.selection?.minimumModels || 2),
      installed: this.listModels(),
      capacity: this.estimateCapacity([]),
      feedback: this.getFeedback(),
      instances: Array.from(this.instances.values()).map((instance) => ({
        modelId: instance.modelId,
        status: instance.status,
        port: instance.port,
        backendMode: instance.backendMode || "",
        backendBinary: instance.backendBinary || "",
        contextSize: instance.contextSize,
        threads: instance.threads,
        gpuLayers: instance.gpuLayers,
        pid: instance.pid || null,
        error: instance.error || null,
        startedAt: instance.startedAt,
        readyAt: instance.readyAt || null,
        lastUsedAt: instance.lastUsedAt || null,
        loadMs: instance.loadMs || null,
      })),
    };
  }

  sweepIdle() {
    const policy = this.readPolicy();
    if (policy.runtime.idleSweepEnabled === false) return;
    const idleMinutes = Number(policy.runtime.idleUnloadMinutes || 45);
    if (idleMinutes <= 0) return;
    const threshold = idleMinutes * 60 * 1000;
    for (const instance of Array.from(this.instances.values())) {
      const lastUsed = instance.lastUsedAt || instance.readyAt || instance.startedAt;
      if (!lastUsed) continue;
      if (this.now() - new Date(lastUsed).getTime() < threshold) continue;
      this.logger.info(`[arena] unloading idle model ${instance.modelId}`);
      this.unloadModel(instance.modelId).catch((error) => {
        this.logger.warn(`[arena] idle unload failed for ${instance.modelId}: ${error.message}`);
      });
    }
  }

  async ensureLoaded(modelIds = [], options = {}) {
    const policy = this.readPolicy();
    const maximum = Number(policy.selection?.maximumModels || 3);
    const wanted = Array.from(new Set(modelIds.map((id) => path.basename(String(id || ""))))).filter(Boolean);
    if (wanted.length === 0) {
      return { instances: [], warnings: [] };
    }
    if (wanted.length > maximum) {
      throw Object.assign(
        new Error(`Select at most ${maximum} models for one arena round.`),
        { statusCode: 400 }
      );
    }

    const warnings = this.estimateCapacity(wanted).warnings;
    const results = await Promise.all(
      wanted.map(async (modelId) => {
        try {
          const instance = await this.loadModel(modelId, options);
          return { modelId, ok: true, instance };
        } catch (error) {
          return { modelId, ok: false, error: error.message || String(error) };
        }
      })
    );

    const failures = results.filter((result) => !result.ok);
    if (failures.length > 0 && failures.length === results.length) {
      const error = new Error(
        failures.map((failure) => `${failure.modelId}: ${failure.error}`).join("\n")
      );
      error.statusCode = 500;
      throw error;
    }

    return {
      instances: results.filter((result) => result.ok).map((result) => result.instance),
      failures,
      warnings,
    };
  }

  async loadModel(modelId, options = {}) {
    const filename = path.basename(String(modelId || ""));
    const existing = this.instances.get(filename);
    if (existing && (existing.status === "ready" || existing.status === "loading")) {
      if (existing.status === "loading") {
        await existing.readyPromise;
      }
      const current = this.instances.get(filename);
      if (current && current.status === "ready") {
        current.lastUsedAt = new Date().toISOString();
        return this.publicInstance(current);
      }
    }
    if (existing) {
      await this.unloadModel(filename);
    }

    const policy = this.readPolicy();
    const modelPath = this.resolveModelPath(filename);
    if (!modelPath) {
      throw new Error(`Text model "${filename}" was not found in the local model folder.`);
    }

    const backend = await this.resolveBackend();
    if (!backend || !backend.path) {
      throw new Error(
        "llama.cpp is not installed. Run the platform setup script to install the text backend."
      );
    }

    const port = await this.allocatePort();
    const stats = fs.statSync(modelPath);
    const projector = findProjector(this.modelsDir, filename);
    const settings = {
      contextSize: Number(options.contextSize ?? policy.runtime.contextSize),
      threads: Number(options.threads ?? policy.runtime.threads),
      gpuLayers: Number(options.gpuLayers ?? policy.runtime.gpuLayers),
      parallelSlots: Number(options.parallelSlots ?? policy.runtime.parallelSlots),
      cachePrompt: options.cachePrompt ?? policy.runtime.cachePrompt,
      flashAttn: options.flashAttn ?? policy.runtime.flashAttn,
      mlock: options.mlock ?? policy.runtime.mlock,
      mmap: options.mmap ?? policy.runtime.mmap,
    };

    const args = [
      "--model",
      modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--ctx-size",
      String(settings.contextSize),
      "--threads",
      String(settings.threads),
      "--n-gpu-layers",
      String(settings.gpuLayers),
      "--parallel",
      String(settings.parallelSlots),
    ];
    if (settings.cachePrompt !== false) args.push("--cache-prompt");
    if (settings.flashAttn === true) args.push("--flash-attn", "on");
    if (settings.mlock === true) args.push("--mlock");
    if (settings.mmap !== false) args.push("--mmap");
    if (projector) {
      args.push("--mmproj", path.join(this.modelsDir, projector));
    }

    const spawnEnv = { ...process.env };
    const backendDir = path.dirname(backend.path);
    if (process.platform === "linux") {
      const existing = spawnEnv.LD_LIBRARY_PATH || "";
      spawnEnv.LD_LIBRARY_PATH = backendDir + (existing ? `:${existing}` : "");
    } else if (process.platform === "darwin") {
      const existing = spawnEnv.DYLD_LIBRARY_PATH || "";
      spawnEnv.DYLD_LIBRARY_PATH = backendDir + (existing ? `:${existing}` : "");
    }
    if (options.env && typeof options.env === "object") {
      Object.assign(spawnEnv, options.env);
    }

    this.logger.info(`[arena] loading ${filename} on port ${port} (${backend.mode || "llama.cpp"})`);

    const child = this.spawnImpl(backend.path, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv,
    });

    const instance = {
      modelId: filename,
      modelPath,
      sizeBytes: stats.size,
      port,
      status: "loading",
      backendMode: backend.mode || "",
      backendBinary: path.basename(backend.path),
      contextSize: settings.contextSize,
      threads: settings.threads,
      gpuLayers: settings.gpuLayers,
      startedAt: new Date().toISOString(),
      readyAt: null,
      lastUsedAt: new Date().toISOString(),
      error: null,
      stderrTail: "",
      child,
    };
    this.instances.set(filename, instance);

    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        instance.stderrTail = `${instance.stderrTail}${chunk}`.slice(-2000);
      });
    }
    if (child.stdout) {
      child.stdout.on("data", () => {});
    }
    child.on("exit", (code) => {
      if (this.instances.get(filename) !== instance) return;
      this.instances.delete(filename);
      if (instance.status === "loading" && !instance.error) {
        instance.error = `llama.cpp exited with code ${code}.`;
      }
    });

    instance.readyPromise = this.waitUntilReady(instance, filename);
    await instance.readyPromise;

    instance.status = "ready";
    instance.readyAt = new Date().toISOString();
    instance.loadMs = new Date(instance.readyAt).getTime() - new Date(instance.startedAt).getTime();
    return this.publicInstance(instance);
  }

  async waitUntilReady(instance, expectedModel) {
    const policy = this.readPolicy();
    const timeoutMs = Number(policy.runtime.startupTimeoutMs || 240000);
    const pollMs = Number(policy.runtime.readinessPollMs || 500);
    const deadline = this.now() + timeoutMs;

    while (this.now() < deadline) {
      if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
        const detail = (instance.stderrTail || "").trim().slice(-400);
        this.instances.delete(instance.modelId);
        throw new Error(
          `llama.cpp exited while loading "${expectedModel}".${detail ? ` ${detail}` : ""}`
        );
      }
      const ready = await this.pingModel(instance.port, expectedModel);
      if (ready) return;
      await delay(pollMs);
    }

    this.instances.delete(instance.modelId);
    try {
      instance.child.kill("SIGTERM");
    } catch (_) {}
    throw new Error(
      `"${expectedModel}" did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`
    );
  }

  pingModel(port, expectedModel = "") {
    return new Promise((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/v1/models", timeout: 1500 },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            if (res.statusCode < 200 || res.statusCode >= 500) {
              resolve(false);
              return;
            }
            if (!expectedModel) {
              resolve(true);
              return;
            }
            try {
              const parsed = JSON.parse(body || "{}");
              const ids = Array.isArray(parsed.data)
                ? parsed.data.map((item) => String(item.id || item.model || ""))
                : [];
              const expected = path.basename(expectedModel).toLowerCase();
              resolve(ids.some((id) => id.toLowerCase().includes(expected)));
            } catch (_) {
              resolve(false);
            }
          });
        }
      );
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => resolve(false));
    });
  }

  async unloadModel(modelId) {
    const filename = path.basename(String(modelId || ""));
    const instance = this.instances.get(filename);
    if (!instance) return { modelId: filename, unloaded: false };
    this.instances.delete(filename);

    const child = instance.child;
    const exited = await this.terminate(child);
    if (!exited && child) {
      try {
        child.kill("SIGKILL");
      } catch (_) {}
    }
    return { modelId: filename, unloaded: true };
  }

  async terminate(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return true;
    try {
      child.kill("SIGTERM");
    } catch (_) {}
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 2500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    return exited;
  }

  async unloadAll() {
    const modelIds = Array.from(this.instances.keys());
    await Promise.all(modelIds.map((modelId) => this.unloadModel(modelId)));
    return { unloaded: modelIds };
  }

  publicInstance(instance) {
    return {
      modelId: instance.modelId,
      status: instance.status,
      port: instance.port,
      backendMode: instance.backendMode,
      backendBinary: instance.backendBinary,
      contextSize: instance.contextSize,
      threads: instance.threads,
      gpuLayers: instance.gpuLayers,
      sizeBytes: instance.sizeBytes,
      pid: instance.child?.pid || null,
      startedAt: instance.startedAt,
      readyAt: instance.readyAt,
      lastUsedAt: instance.lastUsedAt,
      loadMs: instance.loadMs || null,
    };
  }

  getInstance(modelId) {
    return this.instances.get(path.basename(String(modelId || ""))) || null;
  }

  // ── generation ────────────────────────────────────────────────────────────

  buildPayload({ modelId, messages, options = {} }) {
    const policy = this.readPolicy();
    const generation = policy.generation || {};
    return {
      model: modelId,
      messages: Array.isArray(messages) ? messages : [],
      stream: true,
      temperature: Number.isFinite(Number(options.temperature))
        ? Number(options.temperature)
        : Number(generation.temperature ?? 0.7),
      top_p: Number.isFinite(Number(options.topP))
        ? Number(options.topP)
        : Number(generation.topP ?? 0.9),
      top_k: Number.isFinite(Number(options.topK))
        ? Number(options.topK)
        : Number(generation.topK ?? 40),
      min_p: Number.isFinite(Number(options.minP))
        ? Number(options.minP)
        : Number(generation.minP ?? 0.05),
      repeat_penalty: Number.isFinite(Number(options.repeatPenalty))
        ? Number(options.repeatPenalty)
        : Number(generation.repeatPenalty ?? 1.1),
      max_tokens: Math.max(
        1,
        Math.min(8192, Number(options.maxTokens) || Number(generation.maxTokens) || 1024)
      ),
    };
  }

  /**
   * Streams one model answer.
   * @returns {Promise<{content: string, reasoningContent: string, usage: object|null, timings: object|null, finishReason: string|null, truncated: boolean, durationMs: number}>}
   */
  async generate({ modelId, messages, options = {}, onDelta = () => {}, signal = null }) {
    const instance = this.getInstance(modelId);
    if (!instance || instance.status !== "ready") {
      throw new Error(`Model "${modelId}" is not loaded in the arena pool.`);
    }
    instance.lastUsedAt = new Date().toISOString();

    const payload = this.buildPayload({ modelId: instance.modelId, messages, options });
    const timeoutMs = Number(
      options.timeoutMs || this.readPolicy().runtime.generationTimeoutMs || 300000
    );
    const startedAt = Date.now();

    const { content, reasoningContent, usage, timings, finishReason } = await this.streamChat(
      instance,
      payload,
      {
        onDelta,
        signal,
        timeoutMs,
      }
    );

    return {
      modelId: instance.modelId,
      content,
      reasoningContent,
      usage,
      timings,
      finishReason,
      truncated: finishReason === "length",
      durationMs: Date.now() - startedAt,
    };
  }

  streamChat(instance, payload, { onDelta, signal, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      let settled = false;
      let buffer = "";
      let content = "";
      let reasoningContent = "";
      let usage = null;
      let timings = null;
      let finishReason = null;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
        if (error) {
          reject(error);
          return;
        }
        resolve({ content, reasoningContent, usage, timings, finishReason });
      };

      const onAbort = () => {
        try {
          req.destroy();
        } catch (_) {}
        const error = new Error("Arena generation was stopped.");
        error.name = "AbortError";
        finish(error);
      };

      const req = http.request(
        {
          host: "127.0.0.1",
          port: instance.port,
          path: "/v1/chat/completions",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            accept: "text/event-stream",
          },
        },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let errorBody = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              errorBody += chunk;
            });
            res.on("end", () => {
              let message = `Model ${instance.modelId} returned HTTP ${res.statusCode}`;
              try {
                message = JSON.parse(errorBody || "{}").error?.message || message;
              } catch (_) {}
              finish(new Error(message));
            });
            return;
          }

          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            if (signal?.aborted) return;
            buffer += chunk;
            const frames = buffer.split("\n\n");
            buffer = frames.pop() || "";
            for (const frame of frames) {
              for (const line of frame.split(/\r?\n/)) {
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                let parsed = null;
                try {
                  parsed = JSON.parse(data);
                } catch (_) {
                  continue;
                }
                const choice = parsed.choices?.[0] || {};
                const delta = choice.delta || {};
                if (typeof delta.content === "string" && delta.content) {
                  content += delta.content;
                  onDelta(delta.content, instance.modelId);
                }
                if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
                  reasoningContent += delta.reasoning_content;
                }
                if (choice.finish_reason) finishReason = choice.finish_reason;
                if (parsed.usage) usage = parsed.usage;
                if (parsed.timings) timings = parsed.timings;
              }
            }
          });
          res.on("end", () => finish(null));
          res.on("error", (error) => finish(error));
        }
      );

      const timer = setTimeout(() => {
        try {
          req.destroy();
        } catch (_) {}
        const error = new Error(`Model ${instance.modelId} did not answer within ${Math.round(timeoutMs / 1000)}s.`);
        error.name = "TimeoutError";
        finish(error);
      }, timeoutMs);

      req.on("error", (error) => finish(error));
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        if (typeof signal.addEventListener === "function") {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
      req.write(body);
      req.end();
    });
  }
}

function createTextModelPool(options = {}) {
  return new TextModelPool(options);
}

module.exports = {
  TextModelPool,
  createTextModelPool,
  DEFAULT_POLICY,
  formatGb,
  findProjector,
};
