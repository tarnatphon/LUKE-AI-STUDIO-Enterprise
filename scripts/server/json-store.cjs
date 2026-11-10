"use strict";

/**
 * Reading and writing a JSON file, in one place.
 *
 * This module exists because the same twenty lines were pasted 22 times across
 * scripts/server: every storage manager, the text runtime, the model pool. They
 * were not quite identical — one swallowed errors so a model load could never
 * die on a calibration file, two skipped the write when the content had not
 * changed so a tracked config would not show as dirty, three took a fallback on
 * a missing file and eighteen threw. Nothing wrong with any of those choices;
 * everything wrong with them being invisible to each other.
 *
 * And every copy — all 22 — left its `.tmp-<pid>-<time>` file behind when the
 * rename failed. A crash, a full disk, a file locked by a virus scanner: the
 * next attempt writes a fresh temp, and the old one stays forever.
 *
 * So: one implementation, three explicit options, and the temp file cleaned up
 * whether the write succeeds or not.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Parse a JSON file. Throws when the file is missing or malformed — the
 * contract 18 of the copies had, and the one a caller can see coming.
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Parse a JSON file, or answer `fallback` for anything that goes wrong.
 *
 * `requireObject` (default true) rejects a bare number or string, which is what
 * the calibration and profile readers relied on. `rejectArrays` additionally
 * rejects an array, which is what the governor settings reader relied on.
 * `requireObject: false` returns whatever parsed — the model pool's contract.
 */
function readJsonOr(filePath, fallback = null, options = {}) {
  const requireObject = options.requireObject !== false;
  const rejectArrays = options.rejectArrays === true;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!requireObject) return parsed;
    if (!parsed || typeof parsed !== "object") return fallback;
    if (rejectArrays && Array.isArray(parsed)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

/**
 * Write JSON so that a reader never sees half a file.
 *
 * The bytes are byte-identical to what the copies wrote: two-space indent and a
 * trailing newline, so a tracked config stays a fixed point.
 *
 * Options:
 *   bestEffort      — swallow write errors (a calibration file must never break
 *                     a model load)
 *   skipIfUnchanged — do not touch a file whose content already matches, so
 *                     saving an unchanged policy never dirties the checkout
 *
 * Returns true when the file was written, false when it was skipped.
 */
function writeJsonAtomic(filePath, value, options = {}) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  const attempt = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (options.skipIfUnchanged) {
      try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === serialized) return false;
      } catch {
        // unreadable existing file: rewrite it
      }
    }

    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(temporaryPath, serialized, "utf8");
      fs.renameSync(temporaryPath, filePath);
      return true;
    } catch (error) {
      // The copy that forgot this is how a state directory fills with orphans.
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // nothing to clean up
      }
      throw error;
    }
  };

  if (!options.bestEffort) return attempt();
  try {
    return attempt();
  } catch {
    return false;
  }
}

module.exports = { readJson, readJsonOr, writeJsonAtomic };
