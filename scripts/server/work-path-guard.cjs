"use strict";

/**
 * The one place that decides whether a path is allowed.
 *
 * Every endpoint the model can reach (Work tools and the approved chat folder)
 * funnels through this module, so "the AI may only touch the folder it was
 * given" is enforced once instead of being re-implemented — and re-forgotten —
 * in each handler.
 *
 * Rules:
 *   1. the root is canonicalised first (realpath), so aliases cannot widen it
 *   2. an absolute target or one that walks up with ".." is refused outright
 *   3. a target that resolves through a symlink to somewhere else is refused,
 *      including a brand new file whose parent directory is a symlink out
 */

const fs = require("node:fs/promises");
const path = require("node:path");

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = statusCode === 403 ? "PATH_OUTSIDE_GRANTED_FOLDER" : "INVALID_PATH";
  return error;
}

function isInsideRoot(realRoot, realTarget) {
  return realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
}

async function canonicaliseRoot(root) {
  if (!root || typeof root !== "string") {
    throw createHttpError("A granted folder is required.", 400);
  }
  try {
    return await fs.realpath(path.resolve(root));
  } catch {
    throw createHttpError("The granted folder could not be opened.", 400);
  }
}

/**
 * Resolve `targetPath` against `root` and prove the result stays inside it.
 * Returns { realRoot, targetPath, relativePath }.
 * `allowMissing` also accepts paths that do not exist yet (for writes) by
 * proving the closest existing ancestor is inside the root.
 */
async function resolveInsideRoot({ root, targetPath = "", allowMissing = false }) {
  const realRoot = await canonicaliseRoot(root);

  if (typeof targetPath !== "string") {
    throw createHttpError("A path is required.", 400);
  }
  if (targetPath.includes("\0")) {
    throw createHttpError("Invalid path.", 400);
  }
  // A leading "~" or an absolute path can never be a relative project path.
  if (path.isAbsolute(targetPath) || targetPath.startsWith("~")) {
    throw createHttpError("Path traversal outside the granted folder is forbidden.", 400);
  }

  const normalized = path.normalize(targetPath);
  if (normalized === ".." || normalized.startsWith(".." + path.sep)) {
    throw createHttpError("Path traversal outside the granted folder is forbidden.", 400);
  }

  const resolved = path.resolve(realRoot, normalized);
  const relativePath = path.relative(realRoot, resolved);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw createHttpError("Path traversal outside the granted folder is forbidden.", 400);
  }

  await assertStaysInsideRoot(realRoot, resolved, { allowMissing });
  return { realRoot, targetPath: resolved, relativePath };
}

/**
 * realpath check with support for paths that do not exist yet: walk up to the
 * closest ancestor that does exist and prove THAT one is inside the root. A
 * symlinked directory inside the folder (link -> /somewhere-else) therefore
 * cannot be used as a tunnel, even when the file being written is new.
 */
async function assertStaysInsideRoot(realRoot, targetPath, { allowMissing = false } = {}) {
  let probe = targetPath;
  let isTarget = true;
  for (;;) {
    try {
      const realProbe = await fs.realpath(probe);
      if (!isInsideRoot(realRoot, realProbe)) {
        throw createHttpError("That path leaves the granted folder through a link.", 403);
      }
      return realProbe;
    } catch (error) {
      if (error && error.statusCode) throw error;
      if (!error || error.code !== "ENOENT") throw error;
      if (!allowMissing && isTarget) {
        throw createHttpError("File not found.", 404);
      }
      if (!allowMissing) throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw createHttpError("Path traversal outside the granted folder is forbidden.", 400);
      probe = parent;
      isTarget = false;
    }
  }
}

module.exports = {
  assertStaysInsideRoot,
  canonicaliseRoot,
  createHttpError,
  isInsideRoot,
  resolveInsideRoot,
};
