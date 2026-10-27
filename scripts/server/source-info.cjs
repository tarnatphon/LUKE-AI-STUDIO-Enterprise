"use strict";

/**
 * What source tree is this process actually running from?
 *
 * The frontend and the backend can disagree about which commit they are on, and
 * that disagreement is invisible: the browser serves a bundle built last week,
 * the server runs this morning's code, and every screen looks plausible. The
 * user then reports "I rebuilt and the new feature is still not there".
 *
 * So both sides publish a stamp and the UI compares them:
 *   - the bundle carries the commit it was built from (see vite.config.js),
 *   - the server reports the commit of the checkout it is serving (here),
 *   - app/dist/build-info.json records the commit the served files came from.
 *
 * Everything here is best-effort. A source tarball, a shallow clone or a
 * machine without git must keep working — the stamp just says "unknown".
 */

const { execFileSync } = require("node:child_process");

const UNKNOWN = Object.freeze({
  available: false,
  commit: "",
  shortCommit: "",
  branch: "",
  dirty: false,
  commitDate: "",
});

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 4000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Read the checkout's commit. Never throws: this runs on every health request
 * and a repository problem must not look like a hardware problem.
 */
function readSourceInfo(root) {
  if (!root) return { ...UNKNOWN };
  let commit;
  try {
    commit = git(root, ["rev-parse", "HEAD"]);
  } catch {
    return { ...UNKNOWN };
  }
  if (!commit) return { ...UNKNOWN };

  const optional = (args, fallback = "") => {
    try {
      return git(root, args) || fallback;
    } catch {
      return fallback;
    }
  };

  return {
    available: true,
    commit,
    shortCommit: commit.slice(0, 7),
    branch: optional(["rev-parse", "--abbrev-ref", "HEAD"]),
    // Uncommitted edits mean the running code is not exactly `commit`.
    dirty: optional(["status", "--porcelain"]).length > 0,
    commitDate: optional(["show", "-s", "--format=%cI", "HEAD"]),
  };
}

/**
 * A cached wrapper. Health is polled, and `git status` on a big working tree is
 * not something to run several times a second — but the value still has to
 * follow a `git pull` that happens while the server is up, so it expires.
 */
function createSourceInfoReader(root, ttlMs = 15000) {
  let cached = null;
  let readAt = 0;
  const read = () => {
    const now = Date.now();
    if (cached && now - readAt < ttlMs) return cached;
    cached = readSourceInfo(root);
    readAt = now;
    return cached;
  };
  read.invalidate = () => {
    cached = null;
    readAt = 0;
  };
  return read;
}

module.exports = { readSourceInfo, createSourceInfoReader, UNKNOWN };
