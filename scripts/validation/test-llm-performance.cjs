"use strict";

/**
 * Speed work, proved rather than promised.
 *
 * - the runtime planner picks sane thread/batch counts from the machine
 * - speculative decoding is only offered when the draft model fits
 * - a model on an external disk is copied to the internal one and loaded from
 *   there, and a model the user replaced is re-copied instead of served stale
 * - the system prompt is byte-stable, so llama.cpp can reuse its prompt cache
 *
 * Run: node scripts/validation/test-llm-performance.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const {
  planRuntimeSettings,
  planDraftSettings,
  draftArgs,
} = require(path.join(root, "scripts", "server", "llm-performance.cjs"));
const modelCache = require(path.join(root, "scripts", "server", "model-cache.cjs"));

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  console.log("LLM performance validation");

  // ── 1. Runtime settings from the machine ────────────────────────────────
  section("1. Threads and batches are chosen for the machine, not guessed");
  const m3Pro = planRuntimeSettings({ cpuCores: 12, appleSilicon: true, isGpuMode: true, systemRamGb: 18, modelSizeGb: 7.5 });
  check("an M3 Pro stops spawning 12 threads", m3Pro.threads === 6, `got ${m3Pro.threads}`);
  check("it uses large prompt batches on 18 GB", m3Pro.batchSize === 1024, `got ${m3Pro.batchSize}`);
  check("it explains itself", /performance cores/.test(m3Pro.reason.threads) && m3Pro.reason.batchSize.length > 10);

  const cpuOnly = planRuntimeSettings({ cpuCores: 8, isGpuMode: false, systemRamGb: 16, modelSizeGb: 4 });
  check("CPU-only inference uses every core", cpuOnly.threads === 8, `got ${cpuOnly.threads}`);
  check("CPU-only does not claim flash attention", cpuOnly.flashAttn === false);

  const small = planRuntimeSettings({ cpuCores: 4, appleSilicon: true, isGpuMode: true, systemRamGb: 8, modelSizeGb: 6 });
  check("a model that fills most of a small machine is not given big batches", small.batchSize === 512, `got ${small.batchSize}`);
  check("and it says why", small.reason.batchSize.includes("most of the memory"));
  const tiny = planRuntimeSettings({ cpuCores: 4, appleSilicon: true, isGpuMode: true, systemRamGb: 6, modelSizeGb: 3 });
  check("a machine with very little memory drops to small batches", tiny.batchSize === 256, `got ${tiny.batchSize}`);

  const workstation = planRuntimeSettings({ cpuCores: 24, isGpuMode: true, systemRamGb: 64, modelSizeGb: 20 });
  check("a big machine is not given 24 threads", workstation.threads <= 8, `got ${workstation.threads}`);
  check("a big machine uses the largest batches", workstation.batchSize === 2048, `got ${workstation.batchSize}`);

  // ── 2. Speculative decoding only when it fits ────────────────────────────
  section("2. A draft model is only offered when it fits");
  const kvBytesPerToken = (0.3 * 1024 ** 3) / 4096;
  const fits = planDraftSettings({
    systemRamGb: 18, modelSizeGb: 7.5, draftModelSizeGb: 0.6,
    contextTokens: 8192, kvBytesPerToken, isGpuMode: true,
  });
  check("a 0.6 GB draft fits next to a 7.5 GB model on 18 GB", fits.fits === true, JSON.stringify(fits));

  const tight = planDraftSettings({
    systemRamGb: 8, modelSizeGb: 7.5, draftModelSizeGb: 1.5,
    contextTokens: 8192, kvBytesPerToken, isGpuMode: true,
  });
  check("it refuses when there is no room", tight.fits === false, JSON.stringify(tight));
  check("it says why", /would need about/.test(tight.reason));

  check("no draft model means no extra arguments", draftArgs({ draftModelPath: "" }).length === 0);
  const draftOn = draftArgs({ draftModelPath: "/models/draft.gguf", isGpuMode: true });
  check("the draft model is passed to llama.cpp", draftOn.includes("--model-draft") && draftOn.includes("/models/draft.gguf"));
  check("the draft model is offloaded too", draftOn.includes("--n-gpu-layers-draft"));
  check("a GPU-less machine does not ask for GPU layers", !draftArgs({ draftModelPath: "/models/draft.gguf", isGpuMode: false }).includes("--n-gpu-layers-draft"));

  // ── 3. Model cache: never leaves the disk the user chose ─────────────────
  section("3. The model cache respects the disk the app lives on");
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-model-cache-"));
  const source = path.join(sandbox, "model.gguf");
  fs.writeFileSync(source, "weights ".repeat(1024));

  const defaultPlan = await modelCache.cachePlan(source);
  check("the default cache sits inside the app folder", modelCache.cacheRoot().includes(path.join("app", "runtime-state", "model-cache")));
  check("the internal disk is a separate, opt-in place", modelCache.internalCacheRoot() !== modelCache.cacheRoot());
  check("nothing is copied onto the same disk", defaultPlan.shouldCache === false, JSON.stringify(defaultPlan.reason));
  let refused = null;
  try {
    await modelCache.primeCache(source);
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  check("copying onto the same disk is refused outright", Boolean(refused) && /nothing to gain|same disk/.test(String(refused)), String(refused));

  // A different disk, which is the only case worth copying for.
  const otherDisk = path.join(sandbox, "cache-disk");
  const planThere = await modelCache.cachePlan(source, { cacheDir: otherDisk, allowSameDisk: true });
  check("a cache on another volume is worth using", planThere.shouldCache === true);
  const primed = await modelCache.primeCache(source, { cacheDir: otherDisk, allowSameDisk: true });
  check("copying reports the new path", Boolean(primed.path) && fs.existsSync(primed.path));
  check("the copy is the same bytes", fs.readFileSync(primed.path, "utf8") === fs.readFileSync(source, "utf8"));
  check("the plan now says it is cached", (await modelCache.cachePlan(source, { cacheDir: otherDisk, allowSameDisk: true })).cached === true);
  check("loading resolves to the cached copy", (await modelCache.resolveModelPath(source, { cacheDir: otherDisk, allowSameDisk: true })) === primed.path);
  check("caching the same model twice is a no-op", (await modelCache.primeCache(source, { cacheDir: otherDisk, allowSameDisk: true })).alreadyCached === true);
  check("the original model is still where the user put it", fs.existsSync(source));

  fs.writeFileSync(source, "replaced weights ".repeat(1024));
  check("a model the user replaced is recognised as stale", (await modelCache.cachePlan(source, { cacheDir: otherDisk, allowSameDisk: true })).cached === false);
  check("so it loads from the original path again", (await modelCache.resolveModelPath(source, { cacheDir: otherDisk, allowSameDisk: true })) === source);
  check("caching can be switched off", (await modelCache.resolveModelPath(source, { useCache: false, cacheDir: otherDisk })) === source);

  const status = await modelCache.cacheStatus([source], { cacheDir: otherDisk, allowSameDisk: true });
  check("the status reports the cache folder", status.cacheDir === path.resolve(otherDisk));
  await modelCache.clearCache({ cacheDir: otherDisk, allowSameDisk: true });
  check("clearing the cache empties it", (await modelCache.cacheStatus([source], { cacheDir: otherDisk, allowSameDisk: true })).cachedBytes === 0);
  check("clearing never touches the model itself", fs.existsSync(source));
  fs.rmSync(sandbox, { recursive: true, force: true });

  // ── 4. The system prompt must not change every turn ─────────────────────
  section("4. The prompt cache stays usable");
  const chat = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "TextChat.jsx"), "utf8");
  const systemBlock = chat.slice(
    chat.indexOf("const combinedSystemPrompt = ["),
    chat.indexOf("].filter(Boolean)", chat.indexOf("const combinedSystemPrompt = [")),
  );
  check("the system prompt exists", systemBlock.length > 0);
  check("the round counter is not in the system prompt", !systemBlock.includes("tool round"), systemBlock.slice(0, 200));
  check("the task list is not in the system prompt", !systemBlock.includes("workTasks"));
  check("the image instruction is not in the system prompt", !systemBlock.includes("visionInstruction"));
  check("project memory is not in the system prompt", !systemBlock.includes("getProjectMemory"));
  check("the system prompt keeps the stable instructions", ["systemPrompt.trim()", "workInstruction", "chatFolderInstruction", "approvalInstruction"].every((part) => systemBlock.includes(part)));
  check("volatile context is built separately", chat.includes("const volatileContext = ["));
  check("volatile context rides on the user message", chat.includes("      wrappedVolatileContext,\n"));
  check("the round counter moved there", /volatileContext[\s\S]{0,900}tool round/.test(chat));
  check("the plan moved there too", /volatileContext[\s\S]{0,900}workTasks/.test(chat));
  check("the reason is written down for the next person", chat.includes("reuses the KV cache"));
  check("the round context is fenced, so it is not read as the user's message",
    chat.includes("[Round context — instructions about this turn") && chat.includes("[/Round context]"));
  check("and says outright that it is never to be repeated",
    /Never repeat these lines, and never write their headings, in your reply\./.test(chat));
  check("the same rule is in the stable system prompt, where it costs no cache",
    /Never copy the round context into your reply/.test(chat));

  // ── 5. The endpoints ────────────────────────────────────────────────────
  section("5. The endpoints answer");
  const serverSource = fs.readFileSync(serverFile, "utf8");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.status === 200) ready = true;
      } catch {}
      if (!ready) await delay(150);
    }
    if (!ready) throw new Error(`Application server did not become ready.\n${log}`);

    const call = async (endpoint, payload, method = "POST") => {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { "content-type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      let data = null;
      try {
        data = await response.json();
      } catch {}
      return { status: response.status, data };
    };

    const planResponse = await call("/api/llm/performance-plan", { isGpuMode: true });
    check("the plan endpoint answers", planResponse.status === 200 && planResponse.data?.ok === true, `status ${planResponse.status}`);
    check("the original model benchmark endpoint is untouched", /req\.url === "\/api\/llm\/benchmark"/.test(serverSource));
    check("it recommends a thread count", Number(planResponse.data?.recommended?.threads) > 0);
    check("it reports the hardware it looked at", Boolean(planResponse.data?.hardware?.ramGb));

    const noModel = await call("/api/llm/measure", {});
    check("measuring without a loaded model is refused, not crashed", noModel.status === 409, `status ${noModel.status} ${String(noModel.data?.error || "").slice(0, 160)}`);

    const cacheStatus = await call("/api/model-cache/status", null, "GET");
    check("the cache status answers", cacheStatus.status === 200 && Array.isArray(cacheStatus.data?.result?.plans));

    const bogus = await call("/api/model-cache/prime", { model: "../../etc/passwd" });
    check("priming refuses a path outside the model folder", bogus.status === 400, `status ${bogus.status}`);
    const outside = await call("/api/model-cache/prime", { model: "/etc/hosts" });
    check("priming refuses an absolute path", outside.status === 400, `status ${outside.status}`);

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGKILL");
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
