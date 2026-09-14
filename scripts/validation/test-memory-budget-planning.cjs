#!/usr/bin/env node
"use strict";

/**
 * Memory budget planning validation.
 *
 * Proves two architectural properties that keep a "small" machine alive:
 *
 *   1. the app learns the REAL GPU budget from backend output
 *      (Metal: recommendedMaxWorkingSetSize) instead of trusting os.totalmem()
 *   2. out-of-memory crashes tighten the budget automatically, so the same
 *      crash does not repeat
 *
 * The second part boots the real server with a recorded working set of
 * 14.3 GB (an 18 GB M3 Pro) and checks that the pool reported to the UI is
 * that number — not the total RAM.
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { MemoryCalibration } = require("../server/memory-calibration.cjs");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const memoryStateDir = path.join(root, "app", "runtime-state", "memory");
const workingSetFile = path.join(memoryStateDir, "gpu-working-set.json");

const METAL_LOG = [
  "ggml_metal_device_init: GPU name:   MTL0 (Apple M3 Pro)",
  "ggml_metal_device_init: has unified memory    = true",
  "ggml_metal_device_init: recommendedMaxWorkingSetSize  = 14302.25 MB",
].join("\n");

const OOM_LOG = [
  "ggml_metal_synchronize: error: command buffer 0 failed with status 5",
  "error: Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)",
  "llama_decode: failed to decode, ret = -3",
].join("\n");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error || !port ? reject(error || new Error("no port")) : resolve(port)));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-memory-"));
}

function unitTestCalibration() {
  const dir = makeTempDir();
  let clock = Date.parse("2026-09-14T09:00:00Z");
  const logs = [];
  const calibration = new MemoryCalibration({
    stateDir: dir,
    logger: { log: (line) => logs.push(line) },
    now: () => clock,
  });

  assert(calibration.workingSetGb() === 0, "no working set is assumed before the backend reports one");

  const first = calibration.scan(METAL_LOG);
  assert(first.learnedWorkingSet === true, "the Metal working set is learned from backend output");
  assert(
    Math.abs(calibration.workingSetGb() - 13.96) < 0.1,
    `14302 MB is recorded as ${calibration.workingSetGb()} GB, not as the total RAM`
  );

  calibration.scan(METAL_LOG);
  assert(calibration.scan(METAL_LOG).learnedWorkingSet === false, "repeated reports do not rewrite the value");

  assert(calibration.penaltyGb({}) === 0, "no penalty before any out-of-memory crash");

  calibration.scan(OOM_LOG);
  calibration.scan(OOM_LOG); // flood from the same crash
  assert(
    calibration.recentIncidents().length === 1,
    "the ggml error flood from one crash counts as one incident"
  );
  assert(
    Math.abs(calibration.penaltyGb({}) - 0.5) < 0.001,
    `one crash shrinks the pool by ${calibration.penaltyGb({})} GB`
  );

  clock += 60 * 60 * 1000;
  calibration.scan(OOM_LOG);
  assert(
    Math.abs(calibration.penaltyGb({}) - 1.0) < 0.001,
    `a second crash shrinks the pool by ${calibration.penaltyGb({})} GB`
  );

  for (let index = 0; index < 6; index += 1) {
    clock += 60 * 60 * 1000;
    calibration.scan(OOM_LOG);
  }
  assert(
    calibration.penaltyGb({}) === 2,
    `the penalty is capped at ${calibration.penaltyGb({})} GB so the machine stays usable`
  );

  clock += 25 * 60 * 60 * 1000;
  assert(calibration.recentIncidents().length === 0, "old incidents expire and give the memory back");

  assert(
    calibration.penaltyGb({ enabled: false }) === 0,
    "calibration can be switched off in the config"
  );

  fs.rmSync(dir, { recursive: true, force: true });
}

async function integrationTestServerPool() {
  fs.mkdirSync(memoryStateDir, { recursive: true });
  const previous = fs.existsSync(workingSetFile) ? fs.readFileSync(workingSetFile, "utf8") : null;
  fs.writeFileSync(
    workingSetFile,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        workingSetGb: 14.3,
        device: "MTL0 (Apple M3 Pro)",
        source: "ggml_metal_device_init",
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      LUKE_AI_HOST: "127.0.0.1",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
      try {
        const response = await fetch(`${baseUrl}/api/backend-status`);
        if (response.status === 200) ready = true;
      } catch (_) {}
      if (!ready) await delay(150);
    }
    if (!ready) throw new Error(`Application server did not become ready.\n${log}`);

    const status = await (await fetch(`${baseUrl}/api/backend-status`)).json();
    const budget = status.memoryBudget;

    assert(
      Math.abs(budget.workingSetGb - 14.3) < 0.01,
      `the pool uses the measured working set (${budget.workingSetGb} GB)`
    );
    assert(
      Math.abs(budget.poolGb - 14.3) < 0.01,
      `models share ${budget.poolGb} GB even though the machine reports ${budget.totalRamGb} GB of RAM`
    );
    assert(budget.unifiedMemory === true, "a measured unified working set marks the memory as shared");
    assert(
      Math.abs(budget.availableGb - budget.poolGb) < 0.01,
      "with nothing loaded the whole pool is available"
    );
    assert(
      budget.maxModelGb > 11 && budget.maxModelGb < 12,
      `the largest loadable model is about ${budget.maxModelGb} GB (weights + context + per-process overhead)`
    );
    assert(budget.ok === true, "a status query never blocks a load on its own");
  } finally {
    child.kill("SIGTERM");
    await delay(300);
    if (child.exitCode === null) child.kill("SIGKILL");
    if (previous === null) fs.rmSync(workingSetFile, { force: true });
    else fs.writeFileSync(workingSetFile, previous);
  }
}

const MOCK_BACKEND_SOURCE = `#!/usr/bin/env node
"use strict";
const http = require("node:http");
const argv = process.argv.slice(2);
const modelIndex = argv.indexOf("--model");
const portIndex = argv.indexOf("--port");
const port = Number(portIndex >= 0 ? argv[portIndex + 1] : 0) || 0;
const modelId = String(modelIndex >= 0 ? argv[modelIndex + 1] : "mock").split(/[\\/]/).pop();
const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: modelId, object: "model" }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, "127.0.0.1", () => {});
`;

function writeMockBackend(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, MOCK_BACKEND_SOURCE, "utf8");
  fs.chmodSync(filePath, 0o755);
}

async function withWorkingSet(workingSetGb, fn) {
  fs.mkdirSync(memoryStateDir, { recursive: true });
  fs.writeFileSync(
    workingSetFile,
    `${JSON.stringify(
      { schemaVersion: 1, workingSetGb, source: "ggml_metal_device_init", updatedAt: new Date().toISOString() },
      null,
      2
    )}\n`
  );
  try {
    return await fn();
  } finally {
    fs.rmSync(workingSetFile, { force: true });
  }
}

async function startServer(extraEnv = {}) {
  const port = await getFreePort();
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
    try {
      const response = await fetch(`${baseUrl}/api/backend-status`);
      if (response.status === 200) ready = true;
    } catch (_) {}
    if (!ready) await delay(150);
  }
  if (!ready) throw new Error(`Application server did not become ready.\n${log}`);
  return {
    baseUrl,
    stop: async () => {
      child.kill("SIGTERM");
      await delay(300);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

/**
 * The arena planner: three models are requested, the pool can only hold two.
 * The old code loaded all three and the GPU ran out of memory half way
 * through; the planner now drops the biggest model and says why.
 */
async function integrationTestArenaPlanning() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "luke-plan-"));
  const mockBackend = path.join(temporaryDir, "mock-llama-server");
  writeMockBackend(mockBackend);

  const modelsDir = path.join(root, "app", "llm-models");
  fs.mkdirSync(modelsDir, { recursive: true });
  // Sparse files: they report a size without using the disk.
  const fixtures = [
    ["plan-large.gguf", 900],
    ["plan-medium.gguf", 800],
    ["plan-small.gguf", 200],
  ];
  for (const [filename, sizeMb] of fixtures) {
    const target = path.join(modelsDir, filename);
    const handle = fs.openSync(target, "w");
    fs.ftruncateSync(handle, sizeMb * 1024 * 1024);
    fs.closeSync(handle);
  }

  try {
    await withWorkingSet(2.8, async () => {
      const server = await startServer({ LUKE_AI_ARENA_LLAMA_SERVER: mockBackend });
      try {
        const response = await fetch(`${server.baseUrl}/api/llm/arena/load`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ modelIds: ["plan-large.gguf", "plan-medium.gguf", "plan-small.gguf"] }),
        });
        const payload = await response.json();
        assert(response.status === 200, "an arena round that fits the pool is allowed");
        assert(
          payload.modelIds.length === 2,
          `the round keeps ${payload.modelIds.length} models instead of loading all three`
        );
        assert(
          payload.dropped.length === 1 && payload.dropped[0].modelId === "plan-large.gguf",
          "the biggest model is dropped first and reported back to the user"
        );
        assert(
          /Removed plan-large\.gguf/.test(payload.dropped[0].message),
          "the drop message names the model and the missing memory"
        );
        await fetch(`${server.baseUrl}/api/llm/arena/unload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ modelIds: payload.modelIds }),
        });
      } finally {
        await server.stop();
      }
    });

    await withWorkingSet(1.5, async () => {
      const server = await startServer({ LUKE_AI_ARENA_LLAMA_SERVER: mockBackend });
      try {
        const response = await fetch(`${server.baseUrl}/api/llm/arena/load`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ modelIds: ["plan-large.gguf", "plan-medium.gguf", "plan-small.gguf"] }),
        });
        const payload = await response.json();
        assert(response.status === 507, "a round that cannot fit the minimum number of models is refused");
        assert(
          payload.code === "ARENA_NEEDS_MORE_MEMORY",
          "the refusal explains that the arena itself needs more memory"
        );
        assert(/Unload a model in AI Library/.test(payload.error), "the refusal tells the user what to do");
      } finally {
        await server.stop();
      }
    });
  } finally {
    for (const [filename] of fixtures) {
      fs.rmSync(path.join(modelsDir, filename), { force: true });
    }
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

(async () => {
  console.log("Memory budget planning validation");
  unitTestCalibration();
  await integrationTestServerPool();
  await integrationTestArenaPlanning();
  console.log("\nPASS: memory budget planning validation completed.");
})().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
