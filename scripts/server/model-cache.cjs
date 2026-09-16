"use strict";

/**
 * Loading a 7 GB model from a spinning external disk takes tens of seconds
 * every single time. From the internal SSD it takes a couple of seconds.
 *
 * This keeps a copy of the model on the machine's internal disk and loads from
 * there, while the file the user manages stays exactly where they put it. A
 * copy is only made when the model really is on a removable/slow volume, and
 * the cache is verified against the source (size and modification time) so a
 * model the user replaced is re-copied rather than served stale.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const MANIFEST_NAME = "manifest.json";

function cacheRoot() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "LUKE AI STUDIO", "model-cache");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "LUKE AI STUDIO", "model-cache");
  }
  return path.join(os.homedir(), ".cache", "luke-ai-studio", "model-cache");
}

/**
 * Is this file on a volume that is not the internal disk? On macOS anything
 * under /Volumes is another drive; on Linux the removable mounts live under
 * /media, /mnt and /run/media.
 */
function isOnExternalVolume(filePath) {
  const value = path.resolve(String(filePath || ""));
  if (process.platform === "darwin") {
    return value.startsWith("/Volumes/");
  }
  if (process.platform === "linux") {
    return /^\/(media|mnt|run\/media)\//.test(value);
  }
  return false;
}

function cacheFileName(sourcePath) {
  const hash = crypto.createHash("sha1").update(path.resolve(sourcePath)).digest("hex").slice(0, 12);
  const base = path.basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${hash}-${base}`;
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, MANIFEST_NAME), "utf8"));
  } catch {
    return { entries: {} };
  }
}

async function writeManifest(dir, manifest) {
  await fsp.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `${MANIFEST_NAME}.${process.pid}.tmp`);
  await fsp.writeFile(temp, JSON.stringify(manifest, null, 2), "utf8");
  await fsp.rename(temp, path.join(dir, MANIFEST_NAME));
}

async function statOrNull(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

/** What we know about one model: is it worth caching, and is it cached. */
async function cachePlan(modelPath) {
  const source = path.resolve(String(modelPath || ""));
  const stat = await statOrNull(source);
  if (!stat || !stat.isFile()) {
    return { source, shouldCache: false, cached: false, reason: "the model file could not be found" };
  }
  const dir = cacheRoot();
  const cachedPath = path.join(dir, cacheFileName(source));
  const manifest = await readManifest(dir);
  const entry = manifest.entries?.[source];
  const cachedStat = await statOrNull(cachedPath);
  const fresh = Boolean(
    entry && cachedStat && entry.sizeBytes === stat.size && Math.floor(entry.mtimeMs) === Math.floor(stat.mtimeMs),
  );
  return {
    source,
    sizeBytes: stat.size,
    sizeGb: Number((stat.size / 1024 ** 3).toFixed(2)),
    external: isOnExternalVolume(source),
    shouldCache: isOnExternalVolume(source),
    cached: fresh,
    cachedPath: fresh ? cachedPath : null,
    cacheDir: dir,
    reason: isOnExternalVolume(source)
      ? fresh
        ? "a copy is already on the internal disk"
        : "the model is on an external volume, so loading from the internal disk is much faster"
      : "the model is already on an internal disk",
  };
}

/** The path to load: the cached copy when it is fresh, otherwise the original. */
async function resolveModelPath(modelPath, { useCache = true } = {}) {
  if (!modelPath) return modelPath;
  if (!useCache) return modelPath;
  const plan = await cachePlan(modelPath);
  return plan.cached ? plan.cachedPath : modelPath;
}

/**
 * Copy the model onto the internal disk. Progress is reported in bytes so the
 * UI can show something honest while several gigabytes move.
 */
async function primeCache(modelPath, { onProgress = null } = {}) {
  const plan = await cachePlan(modelPath);
  if (!plan.source || plan.reason === "the model file could not be found") {
    throw new Error("That model file could not be found.");
  }
  if (plan.cached) {
    return { alreadyCached: true, path: plan.cachedPath, sizeBytes: plan.sizeBytes };
  }
  const dir = cacheRoot();
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, cacheFileName(plan.source));
  const temp = `${target}.partial`;

  const stat = await fsp.stat(plan.source);
  const source = fs.createReadStream(plan.source);
  const sink = fs.createWriteStream(temp);
  let copied = 0;
  let lastReport = 0;
  await new Promise((resolve, reject) => {
    source.on("data", (chunk) => {
      copied += chunk.length;
      if (typeof onProgress === "function" && copied - lastReport > 16 * 1024 * 1024) {
        lastReport = copied;
        onProgress({ copiedBytes: copied, totalBytes: stat.size });
      }
    });
    source.on("error", reject);
    sink.on("error", reject);
    sink.on("finish", resolve);
    source.pipe(sink);
  });
  await fsp.rename(temp, target);

  const manifest = await readManifest(dir);
  manifest.entries = manifest.entries || {};
  manifest.entries[plan.source] = {
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    cachedAt: new Date().toISOString(),
    cachedFile: path.basename(target),
  };
  await writeManifest(dir, manifest);
  if (typeof onProgress === "function") onProgress({ copiedBytes: stat.size, totalBytes: stat.size });

  return {
    alreadyCached: false,
    path: target,
    sizeBytes: stat.size,
    savedFrom: isOnExternalVolume(plan.source) ? "an external volume" : "its original location",
  };
}

async function cacheStatus(modelPaths = []) {
  const dir = cacheRoot();
  const manifest = await readManifest(dir);
  const entries = [];
  for (const [source, entry] of Object.entries(manifest.entries || {})) {
    const cachedStat = await statOrNull(path.join(dir, entry.cachedFile || ""));
    entries.push({
      source,
      sizeBytes: entry.sizeBytes,
      cachedAt: entry.cachedAt,
      present: Boolean(cachedStat),
    });
  }
  let cachedBytes = 0;
  for (const entry of entries) {
    if (entry.present) cachedBytes += entry.sizeBytes || 0;
  }
  const plans = [];
  for (const modelPath of modelPaths.filter(Boolean)) {
    plans.push(await cachePlan(modelPath));
  }
  return {
    cacheDir: dir,
    entries,
    cachedBytes,
    cachedGb: Number((cachedBytes / 1024 ** 3).toFixed(2)),
    plans,
  };
}

async function clearCache() {
  const dir = cacheRoot();
  await fsp.rm(dir, { recursive: true, force: true });
  return { cleared: true, cacheDir: dir };
}

module.exports = {
  cachePlan,
  cacheRoot,
  cacheStatus,
  clearCache,
  isOnExternalVolume,
  primeCache,
  resolveModelPath,
};
