"use strict";

/**
 * Is this model file loadable at all?
 *
 * Why this exists
 * ---------------
 * A "heretic" fine-tune was downloaded, offered in the model list, and loaded.
 * llama.cpp died 0.29 s in:
 *
 *   error loading model: missing tensor 'blk.32.attn_norm.weight'
 *
 * The file's metadata claimed 33 blocks and its tensor table held 32. Nothing
 * could have loaded that file, and nothing in the app said so — the model looked
 * exactly like a good one until somebody waited through a load. The same is true
 * of a download cut off at 90%: right size class, right name, no last layers.
 *
 * Both are visible in the header alone, in milliseconds, without reading a
 * weight. So every model the folder offers is checked, and a file that cannot
 * load says why — before it is loaded, and before it is blamed on the backend,
 * the memory or the app.
 *
 * What it does not do
 * -------------------
 * It does not judge quality, quantisation, or whether the machine has room. It
 * answers one question: does this file contain what it says it contains?
 */

const fs = require("fs");

const { GgufError, dataExtent, loadHeader } = require("./gguf-header.cjs");

/** Files this size or larger are models, not the small fake files tests write. */
const MIN_PLAUSIBLE_BYTES = 1024;

const CACHE_LIMIT = 200;
const cache = new Map();

function cacheKey(stats) {
  return `${stats.size}:${Math.round(stats.mtimeMs)}`;
}

/** A model with no file behind it, or a directory, is not checkable here. */
function skip(reason) {
  return { ok: true, checked: false, code: "skipped", reason };
}

function fail(code, reason, detail = {}) {
  return { ok: false, checked: true, code, reason, ...detail };
}

/**
 * Check one file.
 *
 * @param {string} file  absolute path
 * @param {{refresh?: boolean}} [options]
 * @returns {{ok: boolean, checked: boolean, code: string, reason: string, issues?: string[]}}
 */
function checkModel(file, { refresh = false } = {}) {
  let stats;
  try {
    stats = fs.statSync(file);
  } catch {
    return skip("the file is not there");
  }
  if (!stats.isFile()) return skip("this is a folder, not a model file");
  if (stats.size < MIN_PLAUSIBLE_BYTES) return skip("too small to be a model");

  const key = `${file}|${cacheKey(stats)}`;
  if (!refresh && cache.has(key)) return cache.get(key);

  const result = inspect(file, stats.size);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

function inspect(file, fileSize) {
  let header;
  try {
    header = loadHeader(file);
  } catch (error) {
    if (error instanceof GgufError) {
      if (error.code === "not-a-gguf") {
        return fail("not-a-gguf", "This file is not a GGUF model. Download it again.");
      }
      if (error.code === "past-end") {
        return fail("truncated", `The file ends before its header does — it is truncated. ${error.message}`);
      }
      return fail("unreadable", `The file's header could not be read: ${error.message}`);
    }
    return fail("unreadable", `The file's header could not be read: ${error.message || error}`);
  }

  const architecture = header.metadata?.["general.architecture"];
  if (!architecture) {
    return fail("no-architecture", "The file does not say what architecture it is, so no backend can load it.");
  }

  // ── every block the metadata promises has to be in the tensor table ───────
  const blockCountKey = Object.keys(header.metadata).find((key) => /\.block_count$/.test(key));
  const blockCount = blockCountKey ? Number(header.metadata[blockCountKey]) : null;
  const layers = new Set();
  for (const tensor of header.tensors) {
    const match = /^blk\.(\d+)\./.exec(tensor.name);
    if (match) layers.add(Number(match[1]));
  }
  if (Number.isFinite(blockCount) && blockCount > 0) {
    const missing = [];
    for (let index = 0; index < blockCount; index += 1) {
      if (!layers.has(index)) missing.push(index);
    }
    if (layers.size === 0) {
      return fail(
        "missing-blocks",
        `The file says it has ${blockCount} blocks but holds none of them — this is not a model file, or it is the weights of something else.`,
        { issues: ["no blk.* tensors"] },
      );
    }
    if (missing.length > 0) {
      const highest = Math.max(...layers);
      return fail(
        "missing-blocks",
        `The file says it has ${blockCount} blocks (0…${blockCount - 1}) but only holds ${layers.size} ` +
          `(highest blk.${highest}), so ${missing.length === 1 ? `blk.${missing[0]} is` : `blk.${missing.slice(0, 4).join(", blk.")}${missing.length > 4 ? " and others are" : " are"}`} ` +
          "missing. That is a bad conversion inside the file, not the backend and not memory — download it again or pick another quant.",
        { issues: missing.map((index) => `missing blk.${index}`).slice(0, 12) },
      );
    }
  }

  // ── the file has to be long enough for the weights it lists ───────────────
  const extent = dataExtent(header);
  if (extent && extent.dataEnd !== null && extent.dataEnd > fileSize) {
    const shortBy = extent.dataEnd - fileSize;
    return fail(
      "truncated",
      `The file is ${(shortBy / 1024 ** 3).toFixed(2)} GB shorter than the weights it lists — the download did not finish. ` +
        "Delete it and download it again.",
      { issues: [`needs ${(extent.dataEnd / 1024 ** 3).toFixed(2)} GB, has ${(fileSize / 1024 ** 3).toFixed(2)} GB`] },
    );
  }

  return {
    ok: true,
    checked: true,
    code: "ok",
    reason: "",
    architecture: String(architecture),
    blocks: Number.isFinite(blockCount) ? blockCount : null,
    tensors: header.tensorCount,
  };
}

/**
 * Check many files at once, keyed by filename.
 *
 * @param {Record<string, string>} byName  filename -> absolute path
 */
function checkModels(byName) {
  const results = {};
  for (const [name, file] of Object.entries(byName)) {
    results[name] = checkModel(file);
  }
  return results;
}

module.exports = {
  MIN_PLAUSIBLE_BYTES,
  checkModel,
  checkModels,
};
