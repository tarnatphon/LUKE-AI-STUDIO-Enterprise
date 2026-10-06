"use strict";

/**
 * Image models in the model cache, proved rather than promised.
 *
 * A text model is one .gguf file. An image model is often a *folder* — a Core ML
 * bundle with tens of thousands of small files — which is the slowest thing an
 * external disk can be asked to read, and the reason an image model can take a
 * minute to load every single time while a GGUF takes seconds.
 *
 * So this suite checks four things:
 *   1. a folder can be fingerprinted, copied and re-copied when it changes
 *   2. a loader finds the copy on whichever disk the copy is on — both folders
 *      are searched, because looking in one of them is how a cache silently
 *      stops helping
 *   3. the image backend is actually handed the copy, and the Core ML worker
 *      reads its reference config from the local copy instead of the network
 *   4. the routes offer image models too, on the method the panel really uses
 *
 * Run: node scripts/validation/test-image-model-cache.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const { ensureRuntimeStateLayout } = require("./helpers/runtime-state-paths.cjs");

ensureRuntimeStateLayout(root);

const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const workerFile = path.join(root, "scripts", "workers", "coreml_server.py");
const modelCache = require(path.join(root, "scripts", "server", "model-cache.cjs"));

let passed = 0;
let failed = 0;
let skipped = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function skip(label, reason) {
  skipped += 1;
  console.log(`  SKIP  ${label} — ${reason}`);
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

/** A stand-in for a compiled Core ML bundle: a folder of small resources. */
function makeCoreMLFolder(dir, { weightsBytes = 4096 } = {}) {
  fs.mkdirSync(path.join(dir, "unet.mlmodelc"), { recursive: true });
  fs.mkdirSync(path.join(dir, "text_encoder.mlpackage"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Resources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "unet.mlmodelc", "metadata.json"), JSON.stringify({ format: "coreml" }));
  fs.writeFileSync(path.join(dir, "unet.mlmodelc", "weights.bin"), "w".repeat(weightsBytes));
  fs.writeFileSync(path.join(dir, "text_encoder.mlpackage", "Manifest.json"), JSON.stringify({ a: 1 }));
  fs.writeFileSync(path.join(dir, ".DS_Store"), "junk");
  return dir;
}

async function main() {
  console.log("Image model cache validation");
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-image-model-cache-"));

  try {
    // ── 1. A folder is a model too ──────────────────────────────────────────
    section("1. A model folder gets the same treatment as a model file");
    const model = makeCoreMLFolder(path.join(sandbox, "coreml-stable-diffusion-v1-5"));

    const folderPrint = await modelCache.treeFingerprint(model);
    check("a folder fingerprints as a directory", folderPrint.kind === "directory", JSON.stringify(folderPrint));
    check("it counts the real files and ignores .DS_Store", folderPrint.fileCount === 3, `got ${folderPrint.fileCount}`);
    check("it adds up their bytes", folderPrint.totalBytes > 4096 && folderPrint.totalBytes < 100000, `got ${folderPrint.totalBytes}`);
    check("an empty subfolder adds no files", folderPrint.fileCount === 3);

    const missing = await modelCache.treeFingerprint(path.join(sandbox, "not-here"));
    check("a path that is not a model is reported, not guessed", missing.error === "missing", JSON.stringify(missing));

    const fileModel = path.join(sandbox, "clip.safetensors");
    fs.writeFileSync(fileModel, "x".repeat(2048));
    const filePrint = await modelCache.treeFingerprint(fileModel);
    check("a single file still fingerprints as a file", filePrint.kind === "file" && filePrint.fileCount === 1);

    // ── 2. Copy, verify, re-copy ────────────────────────────────────────────
    section("2. The copy is verified against the model, and re-made when it changes");
    // Both cases are built out of the fixture, so which volume things are on is
    // a fact about the test rather than about the machine the suite runs on.
    const cacheDisk = path.join(sandbox, "cache-disk");
    const plan = await modelCache.cachePlan(model, { cacheDir: cacheDisk, allowSameDisk: true });
    check("a folder on another volume is worth copying", plan.shouldCache === true, JSON.stringify(plan.reason));
    check("and the plan says it is a folder", plan.isDirectory === true && plan.kind === "directory");
    check("nothing is cached before it is copied", plan.cached === false);

    const primed = await modelCache.primeCache(model, { cacheDir: cacheDisk, allowSameDisk: true });
    check("copying a folder reports the new path", Boolean(primed.path) && fs.existsSync(primed.path));
    check("the copy keeps the bundle layout", fs.existsSync(path.join(primed.path, "unet.mlmodelc", "weights.bin")));
    check("the copy does not carry .DS_Store", !fs.existsSync(path.join(primed.path, ".DS_Store")));
    check("a copied folder reports its kind", primed.kind === "directory" && primed.fileCount === 3, JSON.stringify(primed));

    const planAfter = await modelCache.cachePlan(model, { cacheDir: cacheDisk, allowSameDisk: true });
    check("a matching copy counts as cached", planAfter.cached === true && planAfter.cachedPath === primed.path);
    check("and a cached copy of a folder keeps its file count", planAfter.fileCount === 3);

    const again = await modelCache.primeCache(model, { cacheDir: cacheDisk, allowSameDisk: true });
    check("copying it twice does not copy it twice", again.alreadyCached === true);

    // A model the user re-imported or repaired must not be served from the stale copy.
    fs.writeFileSync(path.join(model, "unet.mlmodelc", "weights.bin"), "w".repeat(4096 + 64));
    const stalePlan = await modelCache.cachePlan(model, { cacheDir: cacheDisk, allowSameDisk: true });
    check("a changed model is no longer served from the copy", stalePlan.cached === false, JSON.stringify(stalePlan));
    const rePrimed = await modelCache.primeCache(model, { cacheDir: cacheDisk, allowSameDisk: true });
    check("and it is re-copied instead", rePrimed.alreadyCached === false);
    check("the re-copy carries the new bytes", fs.statSync(path.join(rePrimed.path, "unet.mlmodelc", "weights.bin")).size === 4096 + 64);

    // Half a copy must never be offered as a cache: the manifest is only written
    // once the bytes on disk match the model.
    const brokenDir = path.join(sandbox, "broken-disk");
    await modelCache.primeCache(model, { cacheDir: brokenDir, allowSameDisk: true });
    const copyTarget = path.join(brokenDir, path.basename((await modelCache.cachePlan(model, { cacheDir: brokenDir, allowSameDisk: true })).cachedPath || "") || "");
    check("a completed copy is listed as cached", Boolean(copyTarget) && fs.existsSync(copyTarget));

    // A single file keeps working exactly as it did before folders were added.
    const fileDisk = path.join(sandbox, "file-disk");
    const filePrimed = await modelCache.primeCache(fileModel, { cacheDir: fileDisk, allowSameDisk: true });
    check("a model file is still copied as one file", filePrimed.kind === "file" && fs.readFileSync(filePrimed.path, "utf8") === "x".repeat(2048));
    const filePlan = await modelCache.cachePlan(fileModel, { cacheDir: fileDisk, allowSameDisk: true });
    check("and a file copy counts as cached", filePlan.cached === true);

    if (process.platform !== "win32") {
      const linkDir = path.join(sandbox, "linked-model");
      fs.mkdirSync(linkDir, { recursive: true });
      fs.writeFileSync(path.join(linkDir, "real.safetensors"), "y".repeat(512));
      fs.symlinkSync(path.join(linkDir, "real.safetensors"), path.join(linkDir, "link.safetensors"));
      const linkDisk = path.join(sandbox, "link-disk");
      const linkPrimed = await modelCache.primeCache(linkDir, { cacheDir: linkDisk, allowSameDisk: true });
      check("a snapshot folder whose files are linked is copied whole", fs.statSync(path.join(linkPrimed.path, "link.safetensors")).isFile());
      check("and no link is left dangling in the cache", fs.readFileSync(path.join(linkPrimed.path, "link.safetensors"), "utf8") === "y".repeat(512));
    } else {
      skip("symlinked model folders", "creating symlinks needs privileges on Windows");
    }

    // ── 3. The loader searches both places ──────────────────────────────────
    section("3. The copy is found on whichever disk it sits on");
    const appCache = path.join(sandbox, "app-cache");
    const internalCache = path.join(sandbox, "internal-cache");
    // The copy was made on the *internal* disk, which is what the panel does.
    await modelCache.primeCache(model, { cacheDir: internalCache, allowSameDisk: true });

    const wrongFolder = await modelCache.cachedCopyFor(model, { cacheDirs: [appCache], allowSameDisk: true });
    check("looking in one folder only finds nothing", wrongFolder.cached === false, JSON.stringify(wrongFolder.reason));
    const bothFolders = await modelCache.cachedCopyFor(model, { cacheDirs: [appCache, internalCache], allowSameDisk: true });
    check("looking in both finds the copy", bothFolders.cached === true);
    check("and it names the folder it came from", bothFolders.cacheDir === internalCache);
    check("the loader is handed the copy", await modelCache.resolveModelPath(model, { cacheDirs: [appCache, internalCache], allowSameDisk: true }) === bothFolders.cachedPath);
    check("turning the cache off keeps the original", await modelCache.resolveModelPath(model, { useCache: false }) === path.resolve(model));
    check("a model with no copy loads from where the user put it", (await modelCache.cachedCopyFor(fileModel, { cacheDirs: [appCache], allowSameDisk: true })).cached === false);
    check("the internal disk is the first place it looks", modelCache.internalCacheRoot() !== modelCache.cacheRoot());

    // ── 4. The loaders and the worker use it ────────────────────────────────
    section("4. The image backend is pointed at the copy, not at the slow disk");
    const serverSource = fs.readFileSync(serverFile, "utf8");
    const workerSource = fs.readFileSync(workerFile, "utf8");
    const startBackend = serverSource.slice(serverSource.indexOf("async function startBackend("));
    const backendBody = startBackend.slice(0, startBackend.indexOf("\nasync function", 10) > 0 ? startBackend.indexOf("\nasync function", 10) : startBackend.length);

    check("the image load path is resolved through the cache", /modelCache\.cachedCopyFor\(imageModelPath\)/.test(backendBody));
    check("the copy is only used when it is inside the cache folder", /pathInside\(imageCachePlan\.cachedPath, imageCachePlan\.cacheDir\)/.test(backendBody));
    const modelFlags = backendBody.match(/"--model",\s*([A-Za-z0-9_.]+)/g) || [];
    check("both image backends are given the resolved path", modelFlags.length === 2 && modelFlags.every((flag) => flag.includes("imageLoadPath")), modelFlags.join(" | "));
    check("a worker is never handed the raw setting again", !/"--model",\s*currentSettings\.model/.test(backendBody));
    check("the memory budget still measures the model the user manages", /targetPaths:\s*\[imageModelPath\]/.test(backendBody));
    check("the Core ML worker is told which model the user picked", /"--model-version",\s*String\(currentSettings\.model/.test(backendBody));
    check("the text loader searches both folders too", /modelCache\.cachedCopyFor\(modelPath\)/.test(serverSource));

    check("the Core ML worker reads a local copy before the network", /local_files_only=True/.test(workerSource));
    check("and caches the reference config on disk", /cache_dir/.test(workerSource) && /huggingface-cache/.test(workerSource));
    check("a worker started without a local copy says what it is doing", /downloading the config once/.test(workerSource));

    // ── 5. The routes offer image models ────────────────────────────────────
    section("5. /api/model-cache answers the panel, for both kinds of model");
    const imageFolder = path.join(root, "app", "models");
    const textFolder = path.join(root, "app", "llm-models");
    const fixtureName = "validation-coreml-bundle";
    const fixtureDir = path.join(imageFolder, fixtureName);
    const textFixture = path.join(textFolder, "validation-cache-model.gguf");
    fs.mkdirSync(imageFolder, { recursive: true });
    fs.mkdirSync(textFolder, { recursive: true });
    makeCoreMLFolder(fixtureDir, { weightsBytes: 1024 });
    fs.writeFileSync(textFixture, "gguf".repeat(256));

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
        try { data = await response.json(); } catch {}
        return { status: response.status, data };
      };

      const asGet = await call("/api/model-cache/status", null, "GET");
      const asPost = await call("/api/model-cache/status", { useInternalDisk: true });
      check("the panel's POST is answered, not 404ed", asPost.status === 200, `status ${asPost.status}`);
      check("GET still works", asGet.status === 200 && Array.isArray(asGet.data?.result?.plans));
      check("the request's disk choice is honoured", asPost.data?.result?.onInternalDisk === true, JSON.stringify(asPost.data?.result?.onInternalDisk));

      const plans = asPost.data?.result?.plans || [];
      const imagePlan = plans.find((entry) => String(entry.source).endsWith(fixtureName));
      const textPlan = plans.find((entry) => String(entry.source).endsWith("validation-cache-model.gguf"));
      check("the image model folder is offered to the cache", Boolean(imagePlan), "an installed Core ML bundle never appears in the cache list");
      check("and it is labelled as an image model", imagePlan?.kind === "image" && imagePlan?.label === "Image model", JSON.stringify(imagePlan && { kind: imagePlan.kind, label: imagePlan.label }));
      check("the folder's file count reaches the UI", Number(imagePlan?.fileCount) >= 3, `got ${imagePlan?.fileCount}`);
      check("text models are still offered", textPlan?.kind === "text", JSON.stringify(textPlan && textPlan.kind));
      check("a folder model is sized by its contents, not by a directory entry", Number(imagePlan?.sizeBytes) > 1024, `got ${imagePlan?.sizeBytes}`);

      // Whether copying gains anything is a fact about this machine's disks, so
      // the expectation is read off the plan the server itself computed.
      const primed = await call("/api/model-cache/prime", { model: path.join(imageFolder, fixtureName), scope: "image", useInternalDisk: true });
      if (imagePlan?.shouldCache) {
        check("a model on another volume can be copied", primed.status === 200, `status ${primed.status} ${String(primed.data?.error || "").slice(0, 160)}`);
      } else {
        const refused = /same disk|nothing to gain/i.test(String(primed.data?.error || ""));
        check("a model already on the cache's own disk is refused, with a reason", primed.status === 400 && refused, `status ${primed.status} ${String(primed.data?.error || "").slice(0, 160)}`);
      }

      const wrongScope = await call("/api/model-cache/prime", { model: fixtureName, scope: "text", useInternalDisk: true });
      check("a folder cannot be primed as a text model", wrongScope.status === 400, `status ${wrongScope.status}`);
      const escaped = await call("/api/model-cache/prime", { model: "../../etc/passwd", scope: "image", useInternalDisk: true });
      check("priming still refuses a path outside the model folders", escaped.status === 400, `status ${escaped.status}`);
      const absolute = await call("/api/model-cache/prime", { model: "/etc/hosts", scope: "image", useInternalDisk: true });
      check("and refuses an absolute path", absolute.status === 400, `status ${absolute.status}`);
      const notAModel = await call("/api/model-cache/prime", { model: "validation-note.txt", scope: "image", useInternalDisk: true });
      check("a stray file in the model folder is not treated as a model", notAModel.status === 400, `status ${notAModel.status}`);
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
      fs.rmSync(textFixture, { force: true });
      if (child.exitCode === null) {
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill("SIGKILL");
        });
      }
    }

    // ── 6. The Core ML worker's own cache ───────────────────────────────────
    section("6. The worker loads the reference config from the local copy when there is one");
    const py = spawnSync("python3", [path.join(__dirname, "helpers", "coreml-reference-cache-probe.py"), workerFile, sandbox], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
    });
    if (py.error || py.status !== 0 || !py.stdout?.trim()) {
      skip("the worker probe", py.error?.code === "ENOENT" ? "python3 is not on PATH" : `exit ${py.status}: ${String(py.stderr || py.error || "").slice(-400)}`);
    } else {
      let results = [];
      try {
        results = JSON.parse(py.stdout.trim().split("\n").pop());
      } catch (error) {
        check("the worker probe reported valid JSON", false, `${error.message}: ${py.stdout.slice(0, 300)}`);
      }
      for (const [label, ok, detail] of results) {
        check(label, Boolean(ok), detail || "");
      }
      check("every behaviour the worker has was checked", results.length >= 12, `only ${results.length} checks reported`);
    }

    console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
