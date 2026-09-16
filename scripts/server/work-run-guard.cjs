"use strict";

/**
 * The safety net under every autonomous Work run.
 *
 * Codex isolates work in a git worktree and hands back a diff for review; the
 * human decides what survives. Locally we do the same thing without moving the
 * user's repo: before the agent touches a file, the original is copied into a
 * run-scoped shadow store, and when the run ends the user reviews one unified
 * diff and can revert the whole thing in a click.
 *
 * Undo always comes from the shadow copy, so it works in projects that are not
 * git repositories too. Git, when it is present, is only read (status, diff,
 * log) to give the review panel more context — never committed, never pushed,
 * never cleaned.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { canonicaliseRoot, resolveInsideRoot, createHttpError } = require("./work-path-guard.cjs");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..", "..");
const RUNS_DIR = path.join(ROOT, "app", "runtime-state", "work-runs");
const MAX_KEPT_RUNS = 25;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const DIFF_CONTEXT = 3;
const MAX_DIFF_CELLS = 640000;
const MAX_DIFF_LINES = 4000;

function reject(message, statusCode = 400) {
  return createHttpError(message, statusCode);
}

function runDir(runId) {
  return path.join(RUNS_DIR, runId);
}

function safeId(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function validRunId(runId) {
  return typeof runId === "string" && /^[a-z0-9_-]{6,64}$/i.test(runId);
}

async function ensureRunsDir() {
  await fsp.mkdir(RUNS_DIR, { recursive: true });
}

async function readManifest(runId) {
  if (!validRunId(runId)) throw reject("That Work run id is not valid.", 400);
  const file = path.join(runDir(runId), "manifest.json");
  let raw = null;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    throw reject("That Work run no longer exists.", 404);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw reject("That Work run's record is unreadable.", 500);
  }
}

async function writeManifest(runId, manifest) {
  await fsp.mkdir(runDir(runId), { recursive: true });
  const temp = path.join(runDir(runId), `manifest.${process.pid}.tmp`);
  await fsp.writeFile(temp, JSON.stringify(manifest, null, 2), "utf8");
  await fsp.rename(temp, path.join(runDir(runId), "manifest.json"));
}

/** Keep the store small: the oldest finished runs are dropped first. */
async function pruneOldRuns() {
  try {
    const entries = await fsp.readdir(RUNS_DIR, { withFileTypes: true });
    const runs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let stat = null;
      try {
        stat = await fsp.stat(path.join(RUNS_DIR, entry.name, "manifest.json"));
      } catch {
        continue;
      }
      runs.push({ name: entry.name, mtimeMs: stat.mtimeMs });
    }
    runs.sort((a, b) => a.mtimeMs - b.mtimeMs);
    while (runs.length > MAX_KEPT_RUNS) {
      const oldest = runs.shift();
      await fsp.rm(path.join(RUNS_DIR, oldest.name), { recursive: true, force: true });
    }
  } catch {}
}

async function beginRun({ root: rootValue, projectId, label }) {
  const root = await canonicaliseRoot(rootValue);
  await ensureRunsDir();
  const runId = `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const manifest = {
    runId,
    root,
    projectId: String(projectId || ""),
    label: String(label || "").slice(0, 200),
    startedAt: new Date().toISOString(),
    files: {},
  };
  await writeManifest(runId, manifest);
  await pruneOldRuns();
  return { runId, root, projectId: manifest.projectId, startedAt: manifest.startedAt };
}

/**
 * Copy the original bytes of a file into the run's shadow store. Called before
 * every write; the first copy wins, so "revert" always restores what the file
 * looked like when the run started.
 */
async function snapshotFile({ root: rootValue, runId, filePath }) {
  if (!validRunId(runId)) throw reject("That Work run id is not valid.", 400);
  if (!filePath) return { snapshot: false, reason: "no path" };
  const { realRoot, targetPath } = await resolveInsideRoot({ root: rootValue, targetPath: filePath, allowMissing: true });
  const manifest = await readManifest(runId);
  if (manifest.root !== realRoot) throw reject("That Work run belongs to a different folder.", 403);
  if (manifest.files[filePath]) return { snapshot: false, reason: "already recorded", path: filePath };

  let stat = null;
  try {
    stat = await fsp.stat(targetPath);
  } catch {
    stat = null;
  }
  const entry = {
    path: filePath,
    existed: Boolean(stat),
    bytes: stat ? stat.size : 0,
    modifiedAt: stat ? stat.mtime.toISOString() : null,
    storedAt: new Date().toISOString(),
    backup: stat ? safeId(filePath) + ".orig" : null,
  };
  if (stat) {
    if (stat.size > MAX_SNAPSHOT_BYTES) {
      entry.backup = null;
      entry.tooLargeToUndo = true;
    } else {
      await fsp.mkdir(path.join(runDir(runId), "files"), { recursive: true });
      await fsp.copyFile(targetPath, path.join(runDir(runId), "files", entry.backup));
    }
  }
  manifest.files[filePath] = entry;
  await writeManifest(runId, manifest);
  return { snapshot: true, path: filePath, existed: entry.existed, undoable: Boolean(entry.backup) || !entry.existed };
}

function lcsDiff(midA, midB) {
  const rows = midA.length + 1;
  const columns = midB.length + 1;
  const table = new Uint32Array(rows * columns);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] = midA[i] === midB[j]
        ? table[(i + 1) * columns + (j + 1)] + 1
        : Math.max(table[(i + 1) * columns + j], table[i * columns + (j + 1)]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      ops.push({ type: "same", text: midA[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * columns + j] >= table[i * columns + (j + 1)]) {
      ops.push({ type: "remove", text: midA[i] });
      i += 1;
    } else {
      ops.push({ type: "add", text: midB[j] });
      j += 1;
    }
  }
  while (i < midA.length) {
    ops.push({ type: "remove", text: midA[i] });
    i += 1;
  }
  while (j < midB.length) {
    ops.push({ type: "add", text: midB[j] });
    j += 1;
  }
  return ops;
}

/** Unified diff with context, capped so a big rewrite cannot flood the review. */
function diffText(before, after, filePath) {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const header = `--- a/${filePath}\n+++ b/${filePath}`;
  if (midA.length === 0 && midB.length === 0) return { diff: "", additions: 0, deletions: 0 };

  if (midA.length * midB.length > MAX_DIFF_CELLS || midA.length + midB.length > MAX_DIFF_LINES) {
    const summary = [];
    summary.push(`@@ large change: ${midA.length} line(s) replaced by ${midB.length} line(s) @@`);
    for (const line of midA.slice(0, 15)) summary.push(`-${line.slice(0, 200)}`);
    if (midA.length > 15) summary.push(`-… ${midA.length - 15} more removed line(s)`);
    for (const line of midB.slice(0, 15)) summary.push(`+${line.slice(0, 200)}`);
    if (midB.length > 15) summary.push(`+… ${midB.length - 15} more added line(s)`);
    return { diff: `${header}\n${summary.join("\n")}`, additions: midB.length, deletions: midA.length };
  }

  const ops = lcsDiff(midA, midB);
  const hunks = [];
  let additions = 0;
  let deletions = 0;
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "same") {
      index += 1;
      continue;
    }
    const hunkStart = Math.max(0, index - DIFF_CONTEXT);
    let hunkEnd = index;
    let idle = 0;
    while (hunkEnd < ops.length) {
      if (ops[hunkEnd].type === "same") {
        idle += 1;
        if (idle > DIFF_CONTEXT * 2) break;
      } else {
        idle = 0;
      }
      hunkEnd += 1;
    }
    const slice = ops.slice(hunkStart, hunkEnd);
    let oldLine = start + hunkStart + 1;
    let newLine = start + hunkStart + 1;
    const lines = [];
    for (const op of slice) {
      if (op.type === "same") {
        lines.push(` ${op.text.slice(0, 300)}`);
        oldLine += 1;
        newLine += 1;
      } else if (op.type === "remove") {
        lines.push(`-${op.text.slice(0, 300)}`);
        oldLine += 1;
        deletions += 1;
      } else {
        lines.push(`+${op.text.slice(0, 300)}`);
        newLine += 1;
        additions += 1;
      }
    }
    hunks.push(`@@ -${start + hunkStart + 1},${slice.filter((op) => op.type !== "add").length} +${start + hunkStart + 1},${slice.filter((op) => op.type !== "remove").length} @@\n${lines.join("\n")}`);
    index = hunkEnd;
  }
  return { diff: `${header}\n${hunks.join("\n")}`, additions, deletions };
}

/** What the agent changed in this run, as one reviewable diff per file. */
async function reviewRun({ root: rootValue, runId }) {
  const root = await canonicaliseRoot(rootValue);
  const manifest = await readManifest(runId);
  if (manifest.root !== root) throw reject("That Work run belongs to a different folder.", 403);
  const entries = [];
  let additions = 0;
  let deletions = 0;

  for (const entry of Object.values(manifest.files)) {
    const { targetPath } = await resolveInsideRoot({ root, targetPath: entry.path, allowMissing: true });
    let current = null;
    try {
      current = await fsp.readFile(targetPath, "utf8");
    } catch {
      current = null;
    }
    let before = "";
    if (entry.backup) {
      try {
        before = await fsp.readFile(path.join(runDir(runId), "files", entry.backup), "utf8");
      } catch {
        before = "";
      }
    }
    let status = "unchanged";
    if (!entry.existed && current !== null) status = "added";
    else if (entry.existed && current === null) status = "deleted";
    else if (before !== (current || "")) status = "modified";

    if (status === "unchanged") continue;
    const { diff, additions: added, deletions: removed } = diffText(before || "", current || "", entry.path);
    additions += added;
    deletions += removed;
    entries.push({
      path: entry.path,
      status,
      additions: added,
      deletions: removed,
      undoable: Boolean(entry.backup) || !entry.existed,
      diff,
    });
  }

  return {
    runId,
    root,
    startedAt: manifest.startedAt,
    label: manifest.label,
    filesTouched: Object.keys(manifest.files).length,
    changes: entries,
    totals: { additions, deletions, files: entries.length },
    git: await gitSummary(root),
  };
}

/** Put every file of the run back the way it was. */
async function revertRun({ root: rootValue, runId, paths = null }) {
  const root = await canonicaliseRoot(rootValue);
  const manifest = await readManifest(runId);
  if (manifest.root !== root) throw reject("That Work run belongs to a different folder.", 403);
  const targets = Array.isArray(paths) && paths.length
    ? paths.map(String)
    : Object.keys(manifest.files);
  const restored = [];
  const skipped = [];

  for (const filePath of targets) {
    const entry = manifest.files[filePath];
    if (!entry) {
      skipped.push({ path: filePath, reason: "not part of this run" });
      continue;
    }
    const { targetPath } = await resolveInsideRoot({ root, targetPath: filePath, allowMissing: true });
    if (!entry.existed) {
      await fsp.rm(targetPath, { force: true });
      restored.push({ path: filePath, action: "removed" });
      continue;
    }
    if (!entry.backup) {
      skipped.push({ path: filePath, reason: entry.tooLargeToUndo ? "file was too large to back up" : "no backup was stored" });
      continue;
    }
    const backupPath = path.join(runDir(runId), "files", entry.backup);
    try {
      await fsp.access(backupPath);
    } catch {
      skipped.push({ path: filePath, reason: "backup is missing" });
      continue;
    }
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(backupPath, targetPath);
    restored.push({ path: filePath, action: "restored" });
  }
  return { runId, restored, skipped };
}

/** Read-only git context, only when the granted folder is a repository. */
async function gitSummary(root) {
  const isRepo = fs.existsSync(path.join(root, ".git"));
  if (!isRepo) return { isRepo: false };
  const runGit = async (args) => {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd: root,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      });
      return String(stdout || "").trim();
    } catch {
      return "";
    }
  };
  const [branch, status, stat, lastCommit, rootPath] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(["status", "--porcelain"]),
    runGit(["diff", "--stat"]),
    runGit(["log", "-1", "--oneline"]),
    runGit(["rev-parse", "--show-toplevel"]),
  ]);
  return {
    isRepo: true,
    branch: branch || null,
    lastCommit: lastCommit || null,
    dirtyFiles: status ? status.split("\n").filter(Boolean).slice(0, 100) : [],
    diffStat: stat || null,
    // The review panel may only offer git actions when the granted folder is
    // the repository root; otherwise a "revert" could touch files outside it.
    isRepoRoot: Boolean(rootPath) && path.resolve(rootPath) === path.resolve(root),
  };
}

async function listRuns(rootValue) {
  const root = await canonicaliseRoot(rootValue);
  await ensureRunsDir();
  const entries = await fsp.readdir(RUNS_DIR, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await fsp.readFile(path.join(RUNS_DIR, entry.name, "manifest.json"), "utf8"));
      if (manifest.root !== root) continue;
      runs.push({
        runId: manifest.runId,
        label: manifest.label,
        startedAt: manifest.startedAt,
        files: Object.keys(manifest.files || {}).length,
      });
    } catch {}
  }
  return runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 10);
}

module.exports = {
  RUNS_DIR,
  beginRun,
  diffText,
  gitSummary,
  listRuns,
  reviewRun,
  revertRun,
  snapshotFile,
};
