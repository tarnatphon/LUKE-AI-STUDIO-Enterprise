"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const GIT_OPTIONS = {
  encoding: "utf8",
  timeout: 10000,
  maxBuffer: 2 * 1024 * 1024,
  shell: false,
};

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function resolveFolder(folderPath) {
  if (!folderPath || !path.isAbsolute(String(folderPath))) {
    throw inputError("Work source folder must be an absolute path.");
  }
  const resolved = path.resolve(String(folderPath));
  const stats = await fs.stat(resolved).catch(() => null);
  if (!stats?.isDirectory()) throw inputError("Work source folder does not exist or is not a directory.");
  return resolved;
}

async function runGit(root, args) {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], GIT_OPTIONS);
    return String(result.stdout || "").trim();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === 128) return "";
    throw error;
  }
}

function parseStatus(output) {
  const lines = String(output || "").split(/\r?\n/).filter(Boolean);
  const branchLine = lines[0]?.startsWith("## ") ? lines.shift().slice(3) : "";
  const changedFiles = lines.slice(0, 200).map((line) => ({
    status: line.slice(0, 2),
    path: line.slice(3),
  }));
  return { branchLine, changedFiles };
}

async function listFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name !== ".git" && !entry.name.startsWith("."))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 200)
    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "folder" : "file" }));
}

async function inspectWorkEnvironment({ sourceFolders = [], activeRoot: requestedRoot = "" } = {}) {
  if (!Array.isArray(sourceFolders) || sourceFolders.length === 0) {
    return { sourceFolders: [], activeRoot: null, repository: null, files: [] };
  }

  const folders = [];
  for (const folder of sourceFolders.slice(0, 20)) folders.push(await resolveFolder(folder));
  const requested = requestedRoot ? path.resolve(String(requestedRoot)) : "";
  const activeRoot = folders.includes(requested) ? requested : folders[0];
  const repositoryRoot = await runGit(activeRoot, ["rev-parse", "--show-toplevel"]);
  let repository = null;

  if (repositoryRoot) {
    const status = parseStatus(await runGit(repositoryRoot, ["status", "--porcelain=v1", "--branch"]));
    const branch = await runGit(repositoryRoot, ["branch", "--show-current"]);
    const head = await runGit(repositoryRoot, ["log", "-1", "--pretty=format:%h %s"]);
    const aheadBehind = await runGit(repositoryRoot, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    const [behind = "0", ahead = "0"] = aheadBehind.split(/\s+/);
    repository = {
      root: repositoryRoot,
      branch: branch || status.branchLine || "detached",
      head,
      ahead: Number(ahead) || 0,
      behind: Number(behind) || 0,
      changedFiles: status.changedFiles,
      changeCount: status.changedFiles.length,
    };
  }

  return {
    sourceFolders: folders,
    activeRoot,
    repository,
    files: await listFiles(activeRoot),
  };
}

module.exports = { inspectWorkEnvironment };
