"use strict";

/**
 * The runtime-state folders the validation suites write into.
 *
 * Fourteen suites drop state files under app/runtime-state and none of them
 * created the directory first. On a working checkout that is invisible, because
 * whichever suite runs earlier has already made the folder — so the scan passes
 * or fails depending on alphabetical order rather than on the code. On a fresh
 * clone, where app/runtime-state does not exist at all, three of them died with
 *
 *   ENOENT: no such file or directory, open
 *   '.../app/runtime-state/text-models/installed-models.json'
 *
 * from writeFileSync, not from a read. Call this once before touching any of
 * those paths and the ordering stops mattering.
 */

const fs = require("node:fs");
const path = require("node:path");

const RUNTIME_STATE_SUBDIRS = [
  "",
  "text-chat",
  "text-chat/history",
  "text-models",
  "model-cache",
  "memory",
];

function ensureRuntimeStateLayout(root) {
  const base = path.join(path.resolve(root), "app", "runtime-state");

  for (const subdirectory of RUNTIME_STATE_SUBDIRS) {
    fs.mkdirSync(path.join(base, subdirectory), { recursive: true });
  }

  return base;
}

module.exports = {
  RUNTIME_STATE_SUBDIRS,
  ensureRuntimeStateLayout,
};
