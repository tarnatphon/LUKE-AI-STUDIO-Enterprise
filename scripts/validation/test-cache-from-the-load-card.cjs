#!/usr/bin/env node
"use strict";

/**
 * "Cache it once" next to the number that says why you should.
 *
 * A slow load now reports its own cause — 6.9 GB read from the AI volume at
 * 31 MB/s, about 3 min 45 s, every launch — and the sentence ends with "cache
 * it once (Settings > Performance)". Acting on that means leaving the screen the
 * message is on, finding Settings, flipping a toggle, and finding the same file
 * in a list. The model card already knows which model just took four minutes, so
 * the copy belongs there.
 *
 * Three things have to hold for that button to be honest:
 *   1. the card knows whether the last load read a cache copy or the model's own
 *      volume, or it would keep offering to cache something already cached
 *   2. starting the copy reports progress, because a 6.9 GB copy is four minutes
 *      of silence otherwise — the job is published on the cache status route
 *   3. the estimate beside the button is the same measurement the load printed,
 *      not a second guess
 *
 * Run: node scripts/validation/test-cache-from-the-load-card.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serveFile = path.join(root, "scripts", "server", "serve.cjs");
const modelCache = require(path.join(root, "scripts", "server", "model-cache.cjs"));

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const serve = read("scripts", "server", "serve.cjs");
const api = read("app", "frontend", "src", "services", "api.js");
const manager = read("app", "frontend", "src", "components", "ModelManager.jsx");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-cache-card-"));

async function main() {
console.log("\n  the card knows whether the last load used the copy");

check(/let lastLlmLoadCached = false;/.test(serve), "there is one flag for it");
check(/lastLlmLoadCached = loadPath !== modelPath;/.test(serve),
  "set where the load decides which file to read — the copy or the original");
check(/llmLoadOutlookPrinted = false;\n\s*lastLlmLoadCached = false;/.test(serve),
  "and cleared when a new load starts, so it never describes the previous one");
check(/cached: lastLlmLoadCached,/.test(serve), "the completion report carries it to /api/llm/status");

console.log("\n  starting the copy reports progress");

check(/let cacheCopyJob = null;/.test(serve), "the copy in flight is kept beside the other load state");
check(/status\.copy = cacheCopyJob;/.test(serve), "and published on the cache status route, which the card already polls");
check(/const speed = loadOutlook\.volumeSpeed\(found\.path\);/.test(serve),
  "the estimate comes from the same measurement the load printed");
check(/estimatedSeconds: speed && sizeBytes \? Math\.round\(sizeBytes \/ speed\.bytesPerSecond\) : null,/.test(serve),
  "as a duration for the copy itself: the same bytes at the same speed");
check(/onProgress: \(progress\) => \{/.test(serve) && /if \(copied > cacheCopyJob\.copiedBytes\) cacheCopyJob\.copiedBytes = copied;/.test(serve),
  "progress is recorded as the copy moves, and only forward");
check(/done: true,\n\s*finishedAt: Date\.now\(\),/.test(serve), "a finished copy is marked done with a time");
check(/error: error\.message \|\| String\(error\),/.test(serve), "and a failed one keeps the reason instead of vanishing");
check(/cacheCopyJob\.model === filename/.test(serve) && /is already being copied/.test(serve),
  "a second copy of the same model is refused with how far the first one got");
check(/cacheCopyJob = \{\n\s*\.\.\.job,/.test(serve), "the job's identity survives its own completion");

console.log("\n  and the button is where the number is");

check(/export async function getModelCacheStatus\(useInternalDisk = false\)/.test(api), "the frontend can read the cache status");
check(/export async function primeModelCache\(model, \{ scope = "text", useInternalDisk = true \} = \{\}\)/.test(api),
  "and start a copy, defaulting to the internal disk — the only copy that helps");
check(/^  getModelCacheStatus,$/m.test(manager) && /^  primeModelCache,$/m.test(manager), "ModelManager imports both");
check(/const copyModelToInternalDisk = async \(modelId, scope = "text"\) => \{/.test(manager), "the card has the action");
check(/await primeModelCache\(modelId, \{ scope, useInternalDisk: true \}\)/.test(manager),
  "which asks for the internal disk explicitly, never the default folder on the same volume");
check(/^function CacheCopyOffer\(\{ estimateSeconds, plan, copy, onCopy \}\)/m.test(manager),
  "and it is one offer, shared by both model cards");
check((manager.match(/\n\s+Cache it once\n/g) || []).length === 1, "written once, not once per card",
  String((manager.match(/\n\s+Cache it once\n/g) || []).length));
check(/const cacheCopyRunning = Boolean\(cacheCopy && !cacheCopy\.done\);/.test(manager), "the card polls only while a copy is in flight");
check(/const job = status\?\.result\?\.copy \|\| status\?\.copy \|\| null;/.test(manager), "and takes the job from the status route");
check(/!backendInfo\.llmLastLoad\?\.cached && backendInfo\.llmLoadOutlook\?\.level === "warn"/.test(manager),
  "the offer appears only for a load that was slow AND did not read a copy");
check(/Cache it once/.test(manager), "the button says what it costs: one read");
check(/estimateSeconds \? ` \(about \$\{formatCopyDuration\(estimateSeconds\)\}\)`/.test(manager),
  "with the measured duration, the same one the load printed");
check(/Copying to the internal disk — /.test(manager), "and shows progress while the copy runs");
check(/the next load reads it from there/.test(manager), "then says what changed");
check(/the copy slows the current model while it runs/.test(manager), "without pretending it is free I/O");

console.log("\n  and image models get the same offer, where they are loaded");

check(/const canOfferImageCache = Boolean\(imageCachePlan && imageCachePlan\.external !== false && !imageCachePlan\.cached\)/.test(manager),
  "an image model on an external disk and not yet cached is offered the copy");
check(/entry\?\.kind === "image" && String\(entry\?\.source \|\| ""\)\.split\("\/"\)\.pop\(\) === activeModel/.test(manager),
  "matched against the image model that is actually loaded");
check(/onCopy=\{\(\) => copyModelToInternalDisk\(activeModel, "image"\)\}/.test(manager),
  "and the copy is started with the image scope, so the route finds the right folder");
check(/onCopy=\{\(\) => copyModelToInternalDisk\(activeLlmModel, "text"\)\}/.test(manager),
  "while the text card asks for the text scope");
check(/estimateSeconds=\{null\}/.test(manager),
  "no invented duration for a folder: an image model is thousands of files, not one measurable file");

console.log("\n  the copy itself reports byte progress");

const source = path.join(temp, "model.bin");
const cacheDir = path.join(temp, "cache");
// The copier reports every 16 MB, so this file is big enough to produce
// intermediate reports — a one-line progress bar is the thing being checked.
fs.writeFileSync(source, Buffer.alloc(40 * 1024 * 1024, 5));
const seen = [];
const result = await new Promise((resolve, reject) => {
  modelCache
    .primeCache(source, {
      cacheDir,
      allowSameDisk: true,
      onProgress: (progress) => seen.push(progress.copiedBytes),
    })
    .then(resolve, reject);
});
check(Boolean(result?.path), "a copy lands on disk");
check(seen.length > 1, "progress is reported more than once while it copies", String(seen.length));
check(seen[seen.length - 1] === 40 * 1024 * 1024, "the last report is the whole file");
check(seen.every((value, index) => index === 0 || value >= seen[index - 1]), "and never runs backwards");
fs.rmSync(temp, { recursive: true, force: true });

console.log("\n  and the route answers a live server");

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const modelsDir = path.join(root, "app", "llm-models");
const created = path.join(modelsDir, "cache-card-test.gguf");
fs.mkdirSync(modelsDir, { recursive: true });
fs.writeFileSync(created, Buffer.alloc(1024 * 1024, 9));

const port = await freePort();
const child = spawn(process.execPath, [serveFile], {
  cwd: root,
  env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/model-cache/status`);
      ready = response.status === 200;
    } catch (_) {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  check(ready, "the server came up");

  const before = await (await fetch(`http://127.0.0.1:${port}/api/model-cache/status`)).json();
  check(before.result && Object.prototype.hasOwnProperty.call(before.result, "copy"),
    "the status always answers with a copy field, even when nothing is copying",
    Object.keys(before.result || {}).join(","));
  check(before.result.copy === null, "which is null until something copies", JSON.stringify(before.result.copy));

  // The switch on the Performance card decides where a *new* copy goes. The
  // loader looks on the internal disk first whichever way it sits, so a copy
  // made while it was on is still used after it is turned off — which means the
  // card can only describe the next load honestly if the route tells it about a
  // copy it is not looking at.
  check(Array.isArray(before.result?.internalDiskCache?.sources),
    "the internal-disk cache is reported even though this request did not ask for it",
    JSON.stringify(before.result?.internalDiskCache));
  check(typeof before.result?.internalDiskCache?.cachedGb === "number",
    "with the size of it, so the card can say how much is already there",
    JSON.stringify(before.result?.internalDiskCache?.cachedGb));
  const internalOnly = await (await fetch(`http://127.0.0.1:${port}/api/model-cache/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ useInternalDisk: true }),
  })).json();
  check(internalOnly.result?.onInternalDisk === true && Array.isArray(internalOnly.result?.internalDiskCache?.sources),
    "and the same field answers when the switch is on, so one shape covers both");

  // This sandbox has no external volume, so the copy is refused for the honest
  // reason — and the failure still has to be visible on the card.
  const refused = await fetch(`http://127.0.0.1:${port}/api/model-cache/prime`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "cache-card-test.gguf", scope: "text", useInternalDisk: true }),
  });
  const refusedBody = await refused.json();
  check(refused.status === 400 && /gain nothing|could not be found/.test(refusedBody.error || ""),
    "a copy that cannot help is refused with a reason", JSON.stringify(refusedBody));

  const after = await (await fetch(`http://127.0.0.1:${port}/api/model-cache/status`)).json();
  const job = after.result?.copy;
  check(job && job.model === "cache-card-test.gguf", "the attempt is on the status, named", JSON.stringify(job));
  check(job && job.done === true, "finished, not left running forever");
  check(job && typeof job.error === "string" && job.error.length > 0, "with the reason it could not copy", job?.error);
  check(after.result?.internalDiskCache && typeof after.result.internalDiskCache.cachedGb === "number",
    "the internal-disk block is still there after a copy attempt, not only on a clean start");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  fs.rmSync(created, { force: true });
}

// #136/#139 put the button on the model card. The wait, though, happens in the
// chat: the screen that just reported four minutes dropped straight back to the
// conversation, so acting on the number meant changing tab and finding the file
// again. The offer now appears next to the number that justifies it.
console.log("\n  and the offer is made where the wait happened");

const chat = read("app", "frontend", "src", "components", "TextChat.jsx");
check(/const LOAD_WORTH_CACHING_MS = 60000;/.test(chat),
  "a fast load is not offered a multi-gigabyte copy");
check(/Number\(lastLoad\?\.elapsedMs\) >= LOAD_WORTH_CACHING_MS && lastLoad\?\.cached !== true/.test(chat),
  "the offer depends on how long this load took and whether it already came from the copy");
check(/String\(entry\.source\)\.split\("\/"\)\.pop\(\) === filename/.test(chat),
  "the plan is matched to the model that was just loaded, not to whatever is first in the list");
check(/plan\.external !== false && !plan\.cached/.test(chat),
  "and only when there is something to copy");
check(/\{cacheOffer\.plan\?\.sizeGb \? `Cache it once \(\$\{cacheOffer\.plan\.sizeGb\} GB\)` : "Cache it once"\}/.test(chat),
  "the button names what it will cost");
check(/body: JSON\.stringify\(\{ model: cacheOffer\.source, scope: "text", useInternalDisk: true \}\)/.test(chat),
  "and starts the same server-side copy the model card starts");
check(/if \(copy\?\.done\) setCacheStarted\(false\);/.test(chat),
  "progress is polled until the copy finishes, then the polling stops");
check(/Copying \$\{gb\(copied\)\} of \$\{gb\(total\)\} GB/.test(chat),
  "a 6.9 GB copy is not silent while it runs");
check(/cacheOffer\.plan\?\.fits === false/.test(chat),
  "a copy with no room is explained instead of attempted");
check(/setCacheError\(error instanceof Error \? error\.message : String\(error\)\)/.test(chat),
  "and a refusal from the server is shown in its own words");
check(/setLastLoadNote\(null\);\s*\n\s*setCacheOffer\(null\);/.test(chat),
  "dismissing the sentence dismisses the offer too");

console.log(`\nPASS: ${checks} checks — the number and the button that acts on it are on the same card.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
