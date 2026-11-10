"use strict";

/**
 * Storage locations — the app-side view of the owner's "choose where each
 * folder lives" setting.
 *
 * Nothing here moves data. serve.cjs keeps reading app/<id>; the launcher
 * (mac.sh / linux.sh) runs scripts/setup/storage-layout.sh --apply before the
 * server starts, which moves the data once and replaces the directory with a
 * symlink. This module only reads/writes the machine-local choice and reports
 * the truth about the current filesystem, so a pending choice is never shown
 * as if it were already applied.
 *
 * The shared truth is scripts/config/storage-folders.json (committed registry)
 * and storage-layout.conf (gitignored, machine-local choices).
 */

const fs = require("node:fs");
const path = require("node:path");

function rootDir() {
  return path.resolve(String(process.env.LUKE_STORAGE_ROOT || "").trim() || path.join(__dirname, "..", ".."));
}
function foldersFile() {
  return String(process.env.LUKE_STORAGE_FOLDERS_FILE || "").trim()
    || path.join(rootDir(), "scripts", "config", "storage-folders.json");
}
function layoutFile() {
  return String(process.env.LUKE_STORAGE_LAYOUT_FILE || "").trim()
    || path.join(rootDir(), "storage-layout.conf");
}
function appDir() {
  return path.join(rootDir(), "app");
}
function platform() {
  const override = String(process.env.LUKE_STORAGE_PLATFORM || "").trim();
  if (override) return override;
  return process.platform === "darwin" ? "Darwin" : process.platform === "linux" ? "Linux" : "Other";
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readFolders() {
  const parsed = JSON.parse(fs.readFileSync(foldersFile(), "utf8"));
  if (!Array.isArray(parsed)) throw httpError("storage-folders.json must be an array", 500);
  return parsed.map((entry) => ({
    id: String(entry.id),
    label: String(entry.label || entry.id),
    recommended: entry.recommended === "internal" ? "internal" : "external",
    note: String(entry.note || ""),
  }));
}

/** `key=absolute path`, `#` comments, unknown ids ignored on purpose so a
 *  hand-edited file cannot invent a folder the app does not know about. */
function readLayout(folders) {
  const file = layoutFile();
  const known = new Set(folders.map((f) => f.id));
  const entries = {};
  if (!fs.existsSync(file)) return entries;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.split("#")[0];
    const match = /^\s*([a-z0-9-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    if (!known.has(match[1])) continue;
    entries[match[1]] = match[2].replace(/\/+$/, "");
  }
  return entries;
}

function writeLayout(folders, entries) {
  const file = layoutFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Keep the owner's comments, replace only the assignment lines, then write
  // the managed ones back in registry order so the file stays readable.
  const kept = [];
  if (fs.existsSync(file)) {
    for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
      if (/^\s*[a-z0-9-]+\s*=/.test(raw)) continue;
      if (raw.trim()) kept.push(raw);
    }
  }
  const lines = [
    "# LUKE AI STUDIO — machine-local storage choices. Restart to apply.",
    ...kept.filter((line) => !/LUKE AI STUDIO — machine-local storage choices/.test(line)),
  ];
  for (const folder of folders) {
    if (entries[folder.id]) lines.push(`${folder.id}=${entries[folder.id]}`);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${lines.join("\n")}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

function validate(folders, id, rawTarget) {
  if (!folders.some((f) => f.id === id)) throw httpError(`Unknown storage folder '${id}'.`);
  const target = String(rawTarget || "").trim().replace(/\/+$/, "");
  const root = rootDir();
  const app = appDir();
  if (!target || !path.isAbsolute(target)) throw httpError("Choose an absolute folder path.");
  if (target === path.parse(target).root) throw httpError("Refusing a filesystem root as a storage location.");
  if (target === root || root.startsWith(`${target}${path.sep}`)) {
    throw httpError("Refusing the checkout root (or one of its parents) as a storage location.");
  }
  if (target === path.join(root, ".git") || target.startsWith(`${path.join(root, ".git")}${path.sep}`)) {
    throw httpError("Refusing a path inside .git.");
  }
  const frontend = path.join(app, "frontend");
  if (target === frontend || target.startsWith(`${frontend}${path.sep}`)) {
    throw httpError("Refusing a path inside app/frontend.");
  }
  const own = path.join(app, id);
  if (target === own || target.startsWith(`${own}${path.sep}`)) {
    throw httpError(`Refusing a path inside ${id} itself.`);
  }
  for (const folder of folders) {
    if (folder.id === id) continue;
    const other = path.join(app, folder.id);
    if (target === other || target.startsWith(`${other}${path.sep}`)) {
      throw httpError(`Refusing a path inside another managed folder '${folder.id}'.`);
    }
  }
  // Two folders cannot share one directory: whichever is copied first would be
  // mixed into the same place, and the launcher refuses to apply it anyway.
  // scripts/setup/storage-layout.sh has always refused this, but this route did
  // not — so the folder picker could write `runtime-state=` and `dist=` on the
  // same path, and the next launch printed four contradictory lines about it
  // while happily starting with neither applied.
  const entries = readLayout(folders);
  for (const folder of folders) {
    if (folder.id === id) continue;
    const otherTarget = String(entries[folder.id] || "").replace(/\/+$/, "");
    if (otherTarget && otherTarget === target) {
      throw httpError(`${folder.id} is already configured to use ${target} — each folder needs its own directory.`);
    }
  }
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
    throw httpError(`${target} is a file, not a folder.`);
  }
  return target;
}

/** Path heuristic + a real device comparison. An external SSD that is mounted
 *  at /Volumes (macOS) or /media (Linux) is "external"; anything on a different
 *  device from the checkout is reported separately so a second internal disk
 *  is not mislabelled. */
function volumeOf(target) {
  const os = platform();
  let kind = "unknown";
  let hint = "unknown volume";
  if (os === "Darwin") {
    kind = /^\/Volumes\//.test(target) ? "external" : "internal";
    hint = /^\/Volumes\//.test(target)
      ? `volume ${String(target).split("/")[2] || ""}`.trim()
      : "internal / boot volume";
  } else if (os === "Linux") {
    kind = /^\/(media|mnt|run\/media)\//.test(target) ? "external" : "internal";
    hint = kind === "external" ? "removable / mounted volume" : "internal / boot volume";
  }
  let sameVolumeAsCheckout = null;
  try {
    sameVolumeAsCheckout = fs.statSync(rootDir()).dev === fs.statSync(target).dev;
  } catch {}
  return { kind, hint, sameVolumeAsCheckout };
}

function describe(folder, entries) {
  const logical = path.join(appDir(), folder.id);
  const target = entries[folder.id] || null;
  let stat = null;
  try { stat = fs.lstatSync(logical); } catch {}
  const isSymlink = Boolean(stat?.isSymbolicLink());
  let link = null;
  if (isSymlink) {
    try { link = fs.readlinkSync(logical); } catch {}
  }
  const currentPath = isSymlink && link ? link : logical;
  const exists = fs.existsSync(logical);
  const applied = target
    ? isSymlink && link === target
    : !isSymlink;
  const conflictWith = target
    ? Object.keys(entries).filter((other) => other !== folder.id && entries[other] === target)
    : [];
  let state;
  if (applied) state = target ? "applied" : "in-checkout";
  else if (conflictWith.length) state = "conflict";
  else if (!target) state = "pending-reset";
  else if (isSymlink) state = "pending-move";
  else state = "pending-restart";
  return {
    id: folder.id,
    label: folder.label,
    recommended: folder.recommended,
    note: folder.note,
    logicalPath: `app/${folder.id}`,
    currentPath,
    target,
    applied,
    isSymlink,
    exists,
    state,
    conflictWith,
    requiresRestart: !applied,
    volume: volumeOf(currentPath),
  };
}

function list() {
  const folders = readFolders();
  const entries = readLayout(folders);
  return folders.map((folder) => describe(folder, entries));
}

function setTarget(id, rawTarget) {
  const folders = readFolders();
  const target = validate(folders, id, rawTarget);
  const entries = readLayout(folders);
  entries[id] = target;
  writeLayout(folders, entries);
  return { ok: true, requiresRestart: true, folder: describe(folders.find((f) => f.id === id), entries) };
}

function resetTarget(id) {
  const folders = readFolders();
  if (!folders.some((f) => f.id === id)) throw httpError(`Unknown storage folder '${id}'.`);
  const entries = readLayout(folders);
  delete entries[id];
  writeLayout(folders, entries);
  return { ok: true, requiresRestart: true, folder: describe(folders.find((f) => f.id === id), entries) };
}

module.exports = {
  rootDir,
  foldersFile,
  layoutFile,
  appDir,
  platform,
  readFolders,
  readLayout,
  validate,
  volumeOf,
  describe,
  list,
  setTarget,
  resetTarget,
};
