"use strict";

/**
 * The llama.cpp builds an upgrade left behind.
 *
 * setup-llama.sh installs into `<dest>.new` and moves the previous build to
 * `<dest>.bak`; older versions of the same script wrote `<dest>.old`. Nothing
 * removes them afterwards, and they are not small: on macOS a backend folder
 * holds `llama-server` with its Metal shaders, which is the largest file in the
 * install. Two upgrades on one machine means two complete llama.cpp builds the
 * app will never load, in a folder nobody opens.
 *
 * This lists them. It does not delete anything — they are offered as cleanup
 * candidates, with their size, and the user decides. A `.bak` that turns out to
 * matter is one `mv` away, and every one of them can be downloaded again.
 *
 * Two levels are scanned because both layouts exist:
 *
 *   app/llm-backend/mac/arm64.bak        (the installer's backup of a whole mode)
 *   app/llm-backend/mac/arm64/arm64.old  (older scripts, nested)
 */

const fs = require("node:fs");
const path = require("node:path");

const LEFTOVER = /\.(old|bak|new)$/i;

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} backendRoot  app/llm-backend
 * @returns {string[]} absolute paths, deepest-first is not promised; sorted for
 *                     a stable answer
 */
function findBackendLeftovers(backendRoot) {
  const found = [];
  if (!backendRoot || !isDirectory(backendRoot)) return found;

  let osDirs = [];
  try {
    osDirs = fs.readdirSync(backendRoot);
  } catch {
    return found;
  }

  for (const osDir of osDirs) {
    const osPath = path.join(backendRoot, osDir);
    if (!isDirectory(osPath)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(osPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(osPath, entry);
      if (LEFTOVER.test(entry)) {
        found.push(entryPath);
        continue;
      }
      // mac/arm64, linux/cuda, win/cpu — the mode folder may itself hold the
      // leftovers of an older installer.
      if (!isDirectory(entryPath)) continue;
      let children = [];
      try {
        children = fs.readdirSync(entryPath);
      } catch {
        continue;
      }
      for (const child of children) {
        if (LEFTOVER.test(child)) found.push(path.join(entryPath, child));
      }
    }
  }

  return found.sort();
}

module.exports = { findBackendLeftovers, LEFTOVER };
