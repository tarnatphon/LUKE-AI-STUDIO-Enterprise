"use strict";

/**
 * Why a suite could not test anything.
 *
 * The full sweep reported "25 failed" on a fresh checkout, and every one of them
 * was the checkout, not the code: `vite` was not installed, `app/dist` was never
 * built, Python's video runtime was missing. Each was a real failure to *run*,
 * and none was a failure of the thing being tested — but the summary said
 * "failed", so the next person reads a list of green code as broken code and
 * starts hunting a regression that does not exist.
 *
 * A blocked suite is different from a failing one in a way that matters: it has
 * no opinion about the code. So it gets its own word, its own count, and the one
 * command that would let it speak.
 *
 * Two ways in:
 *   1. The suite says so itself by exiting 3 and printing `BLOCKED: <reason>`
 *      (and optionally `REMEDY: <command>`).
 *   2. The failure is textually a missing prerequisite — a module that is
 *      genuinely absent from disk, a build artifact that is not there. Checked
 *      against the filesystem, never guessed: `Cannot find module './typo.cjs'`
 *      stays a real failure, because a typo in our own relative import is a bug.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const FRONTEND = path.join(ROOT, "app", "frontend");
const SERVER = path.join(ROOT, "scripts", "server");

/** A suite that could not run its check exits with this, not 0 and not 1. */
const BLOCKED_EXIT = 3;

function barePackageName(specifier) {
  const value = String(specifier || "");
  if (!value || value.startsWith(".") || value.startsWith("/") || value.startsWith("node:")) return null;
  const parts = value.split("/");
  return value.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isInstalled(name) {
  for (const from of [FRONTEND, SERVER, ROOT]) {
    try {
      require.resolve(name, { paths: [from] });
      return true;
    } catch {
      // try the next root
    }
  }
  return false;
}

function declaringManifests(name) {
  const dirs = [];
  for (const dir of [FRONTEND, SERVER]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (all[name]) dirs.push(dir);
    } catch {
      // no manifest, no claim
    }
  }
  return dirs;
}

/**
 * The command that would install `name`.
 *
 * Some packages are declared in both manifests (jszip is used by the interface
 * and by the server). Naming only one of them would leave the other half still
 * missing, so every manifest that claims it gets its own install command.
 */
function remedyForModule(name) {
  const dirs = declaringManifests(name);
  const commands = dirs.map((dir) => (dir === FRONTEND ? "npm ci --prefix app/frontend" : "npm ci --prefix scripts/server"));
  if (commands.length) return commands.join(" && ");

  // Nothing declares it, which usually means it arrives transitively — and a
  // whole tree that was never installed is a better explanation than a package
  // nobody asked for. Say the tree, because that is what is actually absent.
  const missingTrees = [];
  if (!fs.existsSync(path.join(FRONTEND, "node_modules"))) missingTrees.push("npm ci --prefix app/frontend");
  if (!fs.existsSync(path.join(SERVER, "node_modules"))) missingTrees.push("npm ci --prefix scripts/server");
  if (missingTrees.length) return missingTrees.join(" && ");

  return `npm install ${name}`;
}

/**
 * The prerequisite this output is missing, or null if the failure is about the
 * code. Callers pass stdout and stderr together.
 */
function missingPrerequisite(output) {
  const text = String(output || "");
  if (!text.trim()) return null;

  const declared = /^BLOCKED:\s*(.+)$/m.exec(text);
  if (declared) {
    const remedy = /^REMEDY:\s*(.+)$/m.exec(text);
    return { reason: declared[1].trim(), remedy: remedy ? remedy[1].trim() : "", declared: true };
  }

  const moduleMatch =
    /Cannot find module '([^']+)'/.exec(text) || /Cannot find module "([^"]+)"/.exec(text)
    || /ERR_MODULE_NOT_FOUND[^\n]*?package '([^']+)'/.exec(text);
  if (moduleMatch) {
    const bare = barePackageName(moduleMatch[1]);
    // Absence is checked, not assumed: an installed module that still fails to
    // load is a different problem and keeps its own name.
    if (bare && !isInstalled(bare)) {
      return { reason: `${bare} is not installed`, remedy: remedyForModule(bare), declared: false };
    }
  }

  if (/ENOENT[^\n]*app[\/\\]dist/.test(text)) {
    return { reason: "the interface has not been built (app/dist is missing)", remedy: "npm --prefix app/frontend run build", declared: false };
  }

  if (/imageio_ffmpeg/.test(text)) {
    return { reason: "the Python video runtime (imageio_ffmpeg) is not installed", remedy: "python3 -m pip install imageio-ffmpeg", declared: false };
  }

  return null;
}

/** Blocked suites grouped by the command that would unblock them. */
function groupByRemedy(blocked) {
  const groups = new Map();
  for (const entry of blocked) {
    const remedy = entry.blocked?.remedy || "(no remedy given)";
    if (!groups.has(remedy)) groups.set(remedy, []);
    groups.get(remedy).push(entry.name);
  }
  return [...groups.entries()].map(([remedy, names]) => ({ remedy, names }));
}

module.exports = {
  BLOCKED_EXIT,
  barePackageName,
  isInstalled,
  remedyForModule,
  missingPrerequisite,
  groupByRemedy,
};
