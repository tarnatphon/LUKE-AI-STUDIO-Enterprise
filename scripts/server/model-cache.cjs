"use strict";

/**
 * Loading a 7 GB model from a spinning external disk takes tens of seconds
 * every single time; from the internal SSD it takes a couple of seconds.
 *
 * By default this does nothing at all, because everything this app owns stays
 * on the disk the user chose — the cache sits inside the app folder, on the
 * same volume as the models, and copying a file onto its own disk is pointless.
 *
 * `allowSameDisk` exists for callers that know better than the volume check
 * (the validation suite, and a cache folder the app cannot classify); without
 * it, copying a file onto its own disk is refused.
 *
 * If the user asks for it, a disposable copy goes on the internal disk and is
 * loaded from there; the model the user manages stays exactly where they put
 * it. Either way the cache is verified against the source (size and
 * modification time), so a model the user replaced is re-copied rather than
 * served stale, and clearing it never touches the original.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const MANIFEST_NAME = "manifest.json";

const APP_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Everything this app owns lives on the disk the user chose — for this project
 * that is an external volume. So the default cache sits inside the app folder,
 * next to the models, and never on the machine's internal disk.
 */
function cacheRoot() {
  return path.join(APP_ROOT, "app", "runtime-state", "model-cache");
}

/**
 * The internal disk is only used when the user explicitly asks for it, and it
 * holds a disposable copy: the real model stays where the user put it and the
 * cache can be deleted at any time without losing anything.
 */
function internalCacheRoot() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "LUKE AI STUDIO", "model-cache");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "LUKE AI STUDIO", "model-cache");
  }
  return path.join(os.homedir(), ".cache", "luke-ai-studio", "model-cache");
}

/** Which volume a path lives on, so we never copy a file onto the same disk. */
function volumeOf(filePath) {
  const value = path.resolve(String(filePath || ""));
  if (process.platform === "darwin") {
    const match = value.match(/^\/Volumes\/([^/]+)/);
    return match ? match[1] : "boot";
  }
  if (process.platform === "linux") {
    const match = value.match(/^\/(?:media|mnt|run\/media)\/([^/]+)/);
    return match ? match[1] : "boot";
  }
  return (value.match(/^([A-Za-z]:)/) || [, "boot"])[1];
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
function pickDir({ useInternalDisk = false, cacheDir = null, allowSameDisk = false } = {}) {
  if (cacheDir) return path.resolve(String(cacheDir));
  return useInternalDisk ? internalCacheRoot() : cacheRoot();
}

/** What we know about one model: is it worth caching, and is it cached. */
async function cachePlan(modelPath, options = {}) {
  const { useInternalDisk = false } = options;
  const source = path.resolve(String(modelPath || ""));
  const stat = await statOrNull(source);
  if (!stat || !stat.isFile()) {
    return { source, shouldCache: false, cached: false, reason: "the model file could not be found" };
  }
  const dir = pickDir(options);
  const differentVolume = options.allowSameDisk === true || volumeOf(source) !== volumeOf(dir);
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
    onInternalDisk: useInternalDisk,
    // Copying a file onto the same disk it is already on buys nothing.
    shouldCache: differentVolume,
    cached: fresh,
    cachedPath: fresh ? cachedPath : null,
    cacheDir: dir,
    reason: fresh
      ? (useInternalDisk ? "a copy is already on the internal disk" : "a copy is already cached")
      : differentVolume
        ? (useInternalDisk
          ? "copying it to the internal disk makes loading much faster; the original stays on your external disk"
          : "the cache and the model are on different volumes")
        : "the model is already on the same disk as the cache, so there is nothing to gain",
  };
}

/** The path to load: the cached copy when it is fresh, otherwise the original. */
async function resolveModelPath(modelPath, { useCache = true, ...options } = {}) {
  if (!modelPath) return modelPath;
  if (!useCache) return modelPath;
  const plan = await cachePlan(modelPath, options);
  return plan.cached ? plan.cachedPath : modelPath;
}

/**
 * Copy the model onto the internal disk. Progress is reported in bytes so the
 * UI can show something honest while several gigabytes move.
 */
async function primeCache(modelPath, { onProgress = null, ...options } = {}) {
  const useInternalDisk = options.useInternalDisk === true;
  const plan = await cachePlan(modelPath, options);
  if (!plan.shouldCache && !plan.cached) {
    throw new Error("The model is already on the same disk as the cache, so copying it would gain nothing.");
  }
  if (!plan.source || plan.reason === "the model file could not be found") {
    throw new Error("That model file could not be found.");
  }
  if (plan.cached) {
    return { alreadyCached: true, path: plan.cachedPath, sizeBytes: plan.sizeBytes };
  }
  const dir = pickDir(options);
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
    onInternalDisk: useInternalDisk,
    sizeBytes: stat.size,
    savedFrom: useInternalDisk ? "the internal disk, as a disposable cache" : "the app's own cache folder",
  };
}

async function cacheStatus(modelPaths = [], options = {}) {
  const useInternalDisk = options.useInternalDisk === true;
  const dir = pickDir(options);
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
    plans.push(await cachePlan(modelPath, options));
  }
  return {
    cacheDir: dir,
    onInternalDisk: useInternalDisk,
    entries,
    cachedBytes,
    cachedGb: Number((cachedBytes / 1024 ** 3).toFixed(2)),
    plans,
  };
}

async function clearCache(options = {}) {
  const dir = pickDir(options);
  await fsp.rm(dir, { recursive: true, force: true });
  return { cleared: true, cacheDir: dir };
}

module.exports = {
  cachePlan,
  cacheRoot,
  cacheStatus,
  clearCache,
  internalCacheRoot,
  isOnExternalVolume,
  primeCache,
  resolveModelPath,
  volumeOf,
};
