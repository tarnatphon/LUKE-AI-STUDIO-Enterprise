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
 *
 * Image models are cached the same way, with one difference that matters: a
 * Core ML image model is a folder, not a file, so the cache fingerprints a tree
 * (file count + total bytes + newest mtime) and copies it through a temporary
 * name, so a bundle that is only half on disk is never offered as a cache.
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

/**
 * A text model is one .gguf file; an image model is usually a folder — a Core ML
 * bundle full of .mlmodelc/.mlpackage resources, or a .safetensors checkpoint
 * that arrived unpacked. Both are cached the same way, so the cache needs one
 * fingerprint that works for either: how many files, how many bytes, and how
 * recently any of them changed. Nothing is trusted by name alone.
 */
const MAX_TREE_ENTRIES = 50000;

function countTreeBytes(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function treeFingerprint(rootPath) {
  const value = path.resolve(String(rootPath || ""));
  const top = await statOrNull(value);
  if (!top) return { error: "missing" };
  if (top.isFile()) {
    return {
      kind: "file",
      fileCount: 1,
      totalBytes: top.size,
      mtimeMs: top.mtimeMs,
      newestMtimeMs: Math.floor(top.mtimeMs),
    };
  }
  if (!top.isDirectory()) return { error: "missing" };

  let fileCount = 0;
  let totalBytes = 0;
  let newestMtimeMs = Math.floor(top.mtimeMs);
  let visited = 0;
  const pending = [value];
  while (pending.length > 0) {
    const dir = pending.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name.endsWith(".partial")) continue;
      visited += 1;
      if (visited > MAX_TREE_ENTRIES) return { error: "too-large" };
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      // A symlink inside a model folder points at the model's own weights
      // (Hugging Face snapshots are built that way), so the copy follows it and
      // stores the bytes rather than the link — a dangling link in the cache
      // would load as a broken model.
      let stat = null;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      if (!stat || !stat.isFile()) continue;
      fileCount += 1;
      totalBytes += stat.size;
      newestMtimeMs = Math.max(newestMtimeMs, Math.floor(stat.mtimeMs));
    }
  }
  return { kind: "directory", fileCount, totalBytes, mtimeMs: top.mtimeMs, newestMtimeMs };
}

/**
 * Is the cached copy still the same model? A replaced or re-downloaded model has
 * a different size or a newer file in it, and a stale copy is worse than none:
 * the user would be generating images with weights they deleted. Any mismatch
 * means the model is re-copied.
 */
function fingerprintMatches(entry, fingerprint) {
  if (!entry || !fingerprint || fingerprint.error) return false;
  const kind = entry.kind || "file";
  if (kind !== fingerprint.kind) return false;
  if (Number(entry.sizeBytes) !== fingerprint.totalBytes) return false;
  if (fingerprint.kind === "file") return Math.floor(Number(entry.mtimeMs)) === fingerprint.newestMtimeMs;
  return Number(entry.fileCount) === fingerprint.fileCount
    && Math.floor(Number(entry.newestMtimeMs)) === fingerprint.newestMtimeMs;
}

/** Copy one file, reporting bytes as they move. */
async function copyFileWithProgress(source, target, sizeBytes, onProgress) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.partial`;
  const reader = fs.createReadStream(source);
  const sink = fs.createWriteStream(temp);
  let copied = 0;
  let lastReport = 0;
  await new Promise((resolve, reject) => {
    reader.on("data", (chunk) => {
      copied += chunk.length;
      if (typeof onProgress === "function" && copied - lastReport > 16 * 1024 * 1024) {
        lastReport = copied;
        onProgress({ copiedBytes: copied, totalBytes: sizeBytes });
      }
    });
    reader.on("error", reject);
    sink.on("error", reject);
    sink.on("finish", resolve);
    reader.pipe(sink);
  });
  await fsp.rename(temp, target);
}

/**
 * Copy a whole model folder into a temporary name first and only then put it in
 * place, so an interrupted copy (disk full, app closed mid-copy) leaves the
 * previous cache alone instead of a half-written bundle the loader will trip on.
 */
async function copyTreeWithProgress(source, target, totalBytes, onProgress) {
  const temp = `${target}.partial`;
  await fsp.rm(temp, { recursive: true, force: true });
  await fsp.mkdir(temp, { recursive: true });
  let copied = 0;
  let lastReport = 0;
  const pending = [[source, temp]];
  while (pending.length > 0) {
    const [fromDir, toDir] = pending.pop();
    const entries = await fsp.readdir(fromDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const from = path.join(fromDir, entry.name);
      const to = path.join(toDir, entry.name);
      if (entry.isDirectory()) {
        await fsp.mkdir(to, { recursive: true });
        pending.push([from, to]);
        continue;
      }
      let stat = null;
      try {
        stat = await fsp.stat(from);
      } catch {
        continue;
      }
      if (!stat || !stat.isFile()) continue;
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(from, to);
      try {
        await fsp.utimes(to, stat.atime, stat.mtime);
      } catch {}
      copied += stat.size;
      if (typeof onProgress === "function" && (copied - lastReport > 64 * 1024 * 1024 || copied >= totalBytes)) {
        lastReport = copied;
        onProgress({ copiedBytes: copied, totalBytes });
      }
    }
  }
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.rename(temp, target);
}

function pickDir({ useInternalDisk = false, cacheDir = null, allowSameDisk = false } = {}) {
  if (cacheDir) return path.resolve(String(cacheDir));
  return useInternalDisk ? internalCacheRoot() : cacheRoot();
}

/** What we know about one model: is it worth caching, and is it cached. */
async function cachePlan(modelPath, options = {}) {
  const { useInternalDisk = false } = options;
  const source = path.resolve(String(modelPath || ""));
  const fingerprint = await treeFingerprint(source);
  if (fingerprint.error === "missing") {
    return { source, shouldCache: false, cached: false, reason: "the model file could not be found" };
  }
  if (fingerprint.error === "too-large") {
    return { source, shouldCache: false, cached: false, reason: "this model folder has too many files to copy safely" };
  }
  const dir = pickDir(options);
  const differentVolume = options.allowSameDisk === true || volumeOf(source) !== volumeOf(dir);
  const cachedPath = path.join(dir, cacheFileName(source));
  const manifest = await readManifest(dir);
  const entry = manifest.entries?.[source];
  const cachedStat = await statOrNull(cachedPath);
  const fresh = Boolean(entry && cachedStat && fingerprintMatches(entry, fingerprint));
  const isDirectory = fingerprint.kind === "directory";
  return {
    source,
    kind: fingerprint.kind,
    isDirectory,
    fileCount: fingerprint.fileCount,
    sizeBytes: fingerprint.totalBytes,
    sizeGb: Number((fingerprint.totalBytes / 1024 ** 3).toFixed(2)),
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

/**
 * The copy worth loading, whichever disk it happens to sit on.
 *
 * A copy is only ever *made* in one place at a time (the app's own cache folder,
 * or the internal disk when the user asked for it), but a loader cannot know
 * which one the user chose months ago, and looking in the wrong folder is how a
 * cache silently stops helping: the copy is there, and the model still loads off
 * the slow disk. So both are checked, internal disk first, and each candidate is
 * verified against the model before it is trusted.
 */
async function cachedCopyFor(modelPath, options = {}) {
  const source = path.resolve(String(modelPath || ""));
  const internalDir = internalCacheRoot();
  // An explicit folder means exactly one place is being asked about (the
  // validation suites, and any caller that has already chosen); with none, both
  // candidate folders are searched, internal disk first.
  const candidates = options.cacheDir
    ? [{ cacheDir: path.resolve(String(options.cacheDir)) }]
    : Array.isArray(options.cacheDirs) && options.cacheDirs.length > 0
      ? options.cacheDirs.map((dir) => ({ cacheDir: path.resolve(String(dir)) }))
      : [{ cacheDir: internalDir }, { cacheDir: cacheRoot() }];
  let fallback = null;
  for (const candidate of candidates) {
    const plan = await cachePlan(source, { ...options, cacheDir: candidate.cacheDir });
    if (plan.cached) {
      const onInternalDisk = candidate.cacheDir === internalDir;
      return {
        ...plan,
        cacheDir: candidate.cacheDir,
        onInternalDisk,
        reason: onInternalDisk ? "a copy is already on the internal disk" : plan.reason,
      };
    }
    if (!fallback && plan.sizeBytes) fallback = plan;
  }
  return {
    source,
    cached: false,
    cachedPath: null,
    sizeBytes: fallback?.sizeBytes || 0,
    sizeGb: fallback?.sizeGb || 0,
    isDirectory: Boolean(fallback?.isDirectory),
    fileCount: fallback?.fileCount || 0,
    shouldCache: Boolean(fallback?.shouldCache),
    reason: fallback?.reason || "the model file could not be found",
  };
}

/** The path to load: the cached copy when it is fresh, otherwise the original. */
async function resolveModelPath(modelPath, { useCache = true, ...options } = {}) {
  if (!modelPath) return modelPath;
  if (!useCache) return modelPath;
  const copy = await cachedCopyFor(modelPath, options);
  return copy.cached ? copy.cachedPath : modelPath;
}

/**
 * Copy the model onto the internal disk. Progress is reported in bytes so the
 * UI can show something honest while several gigabytes move.
 */
async function primeCache(modelPath, { onProgress = null, ...options } = {}) {
  const useInternalDisk = options.useInternalDisk === true;
  const plan = await cachePlan(modelPath, options);
  if (!plan.shouldCache && !plan.cached) {
    // The user asked for a copy that would gain nothing. That is a refusal with
    // a reason, not a server failure, and the routes answer it as 400 so the
    // panel can show the sentence instead of "something went wrong".
    const nothingToGain = new Error("The model is already on the same disk as the cache, so copying it would gain nothing.");
    nothingToGain.statusCode = 400;
    throw nothingToGain;
  }
  if (!plan.source || plan.reason === "the model file could not be found") {
    const notFound = new Error("That model file could not be found.");
    notFound.statusCode = 400;
    throw notFound;
  }
  if (plan.cached) {
    return { alreadyCached: true, path: plan.cachedPath, sizeBytes: plan.sizeBytes };
  }
  const dir = pickDir(options);
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, cacheFileName(plan.source));
  const fingerprint = await treeFingerprint(plan.source);
  if (fingerprint.error) {
    const missing = new Error("That model file could not be found.");
    missing.statusCode = 400;
    throw missing;
  }

  if (fingerprint.kind === "file") {
    await copyFileWithProgress(plan.source, target, fingerprint.totalBytes, onProgress);
  } else {
    await copyTreeWithProgress(plan.source, target, fingerprint.totalBytes, onProgress);
  }

  // Verify against the source before the manifest ever mentions it, so a copy
  // that came up short is not treated as a usable cache of that model.
  const copy = await treeFingerprint(target);
  if (copy.error || copy.totalBytes !== fingerprint.totalBytes || copy.fileCount !== fingerprint.fileCount) {
    await fsp.rm(target, { recursive: true, force: true });
    throw new Error(`The cached copy did not match the model (${countTreeBytes(fingerprint.totalBytes)} expected), so nothing was saved.`);
  }

  const manifest = await readManifest(dir);
  manifest.entries = manifest.entries || {};
  manifest.entries[plan.source] = {
    kind: fingerprint.kind,
    sizeBytes: fingerprint.totalBytes,
    mtimeMs: fingerprint.mtimeMs,
    fileCount: fingerprint.fileCount,
    newestMtimeMs: fingerprint.newestMtimeMs,
    cachedAt: new Date().toISOString(),
    cachedFile: path.basename(target),
  };
  await writeManifest(dir, manifest);
  if (typeof onProgress === "function") onProgress({ copiedBytes: fingerprint.totalBytes, totalBytes: fingerprint.totalBytes });

  return {
    alreadyCached: false,
    path: target,
    kind: fingerprint.kind,
    fileCount: fingerprint.fileCount,
    onInternalDisk: useInternalDisk,
    sizeBytes: fingerprint.totalBytes,
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
      kind: entry.kind || "file",
      fileCount: Number(entry.fileCount) || 1,
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
  cachedCopyFor,
  clearCache,
  fingerprintMatches,
  internalCacheRoot,
  isOnExternalVolume,
  primeCache,
  resolveModelPath,
  treeFingerprint,
  volumeOf,
};
