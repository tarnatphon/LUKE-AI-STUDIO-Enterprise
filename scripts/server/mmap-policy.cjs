"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Which filesystems make llama.cpp's `--mmap` a trap, and what to do about it.
 *
 * Measured on a real install: a 9 GB Q4 model on an exFAT volume, loaded with
 * `--mmap`, spent three minutes and still had 1 GB resident with the process at
 * 0.3% CPU. llama.cpp never became ready, the wait timed out, and the app fell
 * back to CPU inference — the whole loop repeated on every launch, because the
 * mmap preference is reset at boot. The same file with `--no-mmap` loaded in 33
 * seconds. `dd` on that volume read 219 MB/s, so the disk was never the problem:
 * exFAT serves mmap page faults one small read at a time, and a 9 GB sequential
 * model read is the worst possible shape for it.
 *
 * So the filesystem of the model directory decides, not the default. The mount
 * table is the portable answer — `mount` prints it on macOS and Linux alike,
 * and reading it costs one process per boot (cached), instead of parsing
 * diskutil output.
 */

// exFAT and friends: no page-cache coherence worth relying on, no journal, and
// page-in throughput measured in single-digit MB/s. Network filesystems belong
// here for the same reason — mmap over SMB is a latency generator.
const HOSTILE_FILESYSTEMS = new Set([
  "exfat",
  "msdos",
  "vfat",
  "fat",
  "fat32",
  "ntfs",
  "ntfs3",
  "smbfs",
  "afpfs",
  "webdav",
]);

/**
 * Parse the output of `mount` (macOS and Linux) into mount points.
 *
 * macOS:  /dev/disk6s2 on /Volumes/AI (exfat, local, nodev, nosuid, noowners)
 * Linux:  /dev/sda1 on /mnt/models type exfat (rw,relatime,fmask=0022)
 */
function parseMountTable(text) {
  const entries = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const mac = /^(.+?) on (.+?) \(([^,)]+)/.exec(trimmed);
    if (mac && !/ type /.test(trimmed)) {
      entries.push({ source: mac[1], mountPoint: mac[2], type: mac[3].trim().toLowerCase() });
      continue;
    }

    const linux = /^(.+?) on (.+?) type (\S+)/.exec(trimmed);
    if (linux) {
      entries.push({ source: linux[1], mountPoint: linux[2], type: linux[3].trim().toLowerCase() });
    }
  }
  return entries;
}

/**
 * The filesystem a path lives on: the longest mount point that is a prefix of
 * it. "" when nothing matches, which the caller must treat as "unknown", not as
 * "safe" — but also not as proof of exFAT.
 */
function filesystemTypeForPath(mountText, target) {
  const path_ = String(target || "").replace(/\/+$/, "");
  if (!path_) return "";
  let best = null;
  for (const entry of parseMountTable(mountText)) {
    // "/" strips to an empty string; keep it, or the root volume never matches
    // and every path outside a mounted volume reads as unknown.
    const mountPoint = entry.mountPoint.replace(/\/+$/, "") || "/";
    const matches = mountPoint === "/" ? path_.startsWith("/") : (path_ === mountPoint || path_.startsWith(`${mountPoint}/`));
    if (!matches) continue;
    if (!best || mountPoint.length > best.mountPoint.replace(/\/+$/, "").length) best = entry;
  }
  return best ? best.type : "";
}

function blocksMmap(filesystem) {
  const type = String(filesystem || "").toLowerCase();
  if (!type) return false;
  if (HOSTILE_FILESYSTEMS.has(type)) return true;
  // fuse.ntfs, fuse.exfat, sshfs, and anything else behind FUSE
  return type.startsWith("fuse");
}

/**
 * What `--mmap` should be for a model at `modelPath`, given what the user asked
 * for and what the mount table says.
 *
 * Returns the decision plus the sentence to log when the filesystem overruled
 * the request — a silent downgrade is how the original bug hid for weeks.
 */
function decideMmap(requestedMmap, filesystem) {
  const requested = requestedMmap !== false;
  if (!requested) return { mmap: false, reason: "" };
  if (!blocksMmap(filesystem)) return { mmap: true, reason: "" };
  return {
    mmap: false,
    reason:
      `models are on ${filesystem}, where mmap reads a 9 GB checkpoint one page fault at a time — `
      + "using --no-mmap instead (slower to start, minutes faster to finish). "
      + "Move the models to an internal APFS disk to get mmap back.",
  };
}

/**
 * The mmap choice the user made last time, kept in runtime-state.
 *
 * This exists because the preference used to live only in the running process:
 * every boot reset it to true, so a user who had switched mmap off (or had it
 * switched off for them by the filesystem rule above) got the slow path again
 * after every restart, with nothing on screen to explain it.
 */
const PREFS_FILENAME = "llm-prefs.json";

function readPrefs(directory) {
  try {
    const raw = fs.readFileSync(path.join(directory, PREFS_FILENAME), "utf8");
    const parsed = JSON.parse(raw);
    const prefs = {};
    if (typeof parsed?.mmap === "boolean") prefs.mmap = parsed.mmap;
    if (typeof parsed?.mlock === "boolean") prefs.mlock = parsed.mlock;
    return prefs;
  } catch {
    return {};
  }
}

function writePrefs(directory, patch) {
  const known = {};
  for (const key of ["mmap", "mlock"]) {
    if (typeof patch?.[key] === "boolean") known[key] = patch[key];
  }
  if (Object.keys(known).length === 0) return readPrefs(directory);
  const merged = { ...readPrefs(directory), ...known };
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, PREFS_FILENAME), `${JSON.stringify(merged, null, 2)}\n`);
  } catch {
    // A read-only checkout must not stop a model from loading.
  }
  return merged;
}

module.exports = {
  HOSTILE_FILESYSTEMS,
  PREFS_FILENAME,
  parseMountTable,
  filesystemTypeForPath,
  blocksMmap,
  decideMmap,
  readPrefs,
  writePrefs,
};
