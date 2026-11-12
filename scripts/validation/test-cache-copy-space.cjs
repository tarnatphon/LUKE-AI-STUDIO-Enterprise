#!/usr/bin/env node
"use strict";

/**
 * "Cache it once" has to fit.
 *
 * Caching a 6.9 GB model means writing 6.9 GB to the internal disk, and the
 * internal disk of a laptop that keeps its models on an external drive is often
 * the small one. A copy that runs out of room fails four minutes in — after the
 * user has paid the whole read, with a half-written `.partial` behind it — and
 * says something about ENOSPC that no one asked for.
 *
 * The check is one syscall. It belongs before the copy, and the answer belongs
 * on the button: how much the copy needs, how much the disk has, and what to do
 * about it.
 *
 * Run: node scripts/validation/test-cache-copy-space.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const modelCache = require(path.join(root, "scripts", "server", "model-cache.cjs"));

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const GB = 1024 ** 3;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-cache-space-"));

async function main() {
  console.log("\n  the disk can be asked how much room it has");

  const free = modelCache.freeBytesFor(temp);
  check(Number.isFinite(free) && free > 0, "a real folder reports its free space", String(free));
  const missing = modelCache.freeBytesFor(path.join(temp, "not", "created", "yet"));
  check(Number.isFinite(missing) && missing > 0,
    "a folder that does not exist yet is answered from the one above it, because the copy creates it", String(missing));
  check(modelCache.freeBytesFor("") !== undefined, "and an empty path is not a crash");

  console.log("\n  a plan says whether the copy would fit");

  const source = path.join(temp, "model.gguf");
  fs.writeFileSync(source, Buffer.alloc(4 * 1024 * 1024, 7));
  const cacheDir = path.join(temp, "cache");
  const plan = await modelCache.cachePlan(source, { cacheDir, allowSameDisk: true });
  check(plan.neededBytes === 4 * 1024 * 1024 + modelCache.CACHE_COPY_MARGIN_BYTES,
    "the requirement is the file plus the margin", `${plan.neededBytes}`);
  check(plan.fits === true, "and this machine has room for 4 MB");
  check(Number.isFinite(plan.freeGb) && plan.freeGb > 0, "free space is reported in GB for the screen", String(plan.freeGb));
  check(modelCache.CACHE_COPY_MARGIN_BYTES === 512 * 1024 ** 2,
    "the margin is the copy's own headroom, not the storage planner's 10 GB reserve for kept data");
  check(!/storage-capacity-manager/.test(read("scripts", "server", "model-cache.cjs")),
    "so it does not borrow a rule sized for something else");

  const tight = await modelCache.cachePlan(source, { cacheDir, allowSameDisk: true, freeBytes: 1024 * 1024 });
  check(tight.fits === false, "a disk with 1 MB free cannot take a 4 MB copy");

  console.log("\n  and the copy refuses before it starts, not four minutes in");

  let refusal = null;
  try {
    await modelCache.primeCache(source, { cacheDir, allowSameDisk: true, freeBytes: 1024 * 1024 });
  } catch (error) {
    refusal = error;
  }
  check(Boolean(refusal), "the copy is refused");
  check(refusal.statusCode === 400, "as a request that cannot be met, not a server failure", String(refusal?.statusCode));
  check(/needs about .* GB of free space/.test(refusal.message), "with what it needs", refusal.message);
  check(/has .* GB/.test(refusal.message), "and what the disk has", refusal.message);
  check(/the disk the cache is on|the internal disk/.test(refusal.message), "naming the disk that is short", refusal.message);
  check(/Delete a cached model, or free some space/.test(refusal.message), "and what to do about it", refusal.message);
  check(!fs.existsSync(cacheDir) || fs.readdirSync(cacheDir).length === 0,
    "and nothing was written — no half-copied model left behind",
    fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).join(",") : "no folder");

  console.log("\n  while a copy that does fit still runs");

  const copied = await modelCache.primeCache(source, { cacheDir, allowSameDisk: true });
  check(Boolean(copied?.path) && fs.existsSync(copied.path), "a copy with room is made");

  console.log("\n  and the screens say so before the click");

  const manager = read("app", "frontend", "src", "components", "ModelManager.jsx");
  const panel = read("app", "frontend", "src", "components", "PerformancePanel.jsx");

  check(/cachePlanForActive && cachePlanForActive\.fits === false/.test(manager),
    "the model card checks whether the copy fits");
  check(/The internal disk has \{cachePlanForActive\.freeGb\} GB free and this copy needs about/.test(manager),
    "and says both numbers when it does not", "the card must not start a copy it knows will fail");
  check(/Delete a cached/.test(manager) && /the internal disk/.test(manager), "with the way out");
  check(/getModelCacheStatus\(true\)/.test(manager), "asking about the internal disk, which is where the copy goes");

  check(/entry\.fits === false/.test(panel), "the Performance card checks the same thing per model");
  check(/disabled=\{copying === entry\.source \|\| entry\.fits === false\}/.test(panel),
    "and will not start a copy that cannot fit");
  check(/Needs about .* GB free; this disk has \{entry\.freeGb\} GB/.test(panel), "showing the numbers", "");
  check(/GB free/.test(panel), "and how much there is when the copy does fit");

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`\nPASS: ${checks} checks — a copy that cannot fit is refused in a syscall, with the numbers to fix it.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
