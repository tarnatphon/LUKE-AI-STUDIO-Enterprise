"use strict";

const { exec, execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function resolveSafePath(root, targetPath) {
  if (!root || !targetPath) {
    throw createHttpError("Root directory and file path are required.", 400);
  }
  const normalized = path.normalize(targetPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw createHttpError("Path traversal outside project root is forbidden.", 400);
  }
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createHttpError("Path traversal outside project root is forbidden.", 400);
  }
  return resolved;
}

async function getWorkTerminalSession({ root }) {
  if (!root) {
    throw createHttpError("Project root is required.", 400);
  }
  let canonicalCwd;
  try {
    canonicalCwd = await fs.realpath(root);
  } catch {
    canonicalCwd = path.resolve(root);
  }
  const baseName = path.basename(canonicalCwd) || "project";
  return {
    cwd: canonicalCwd,
    prompt: `${baseName} $`,
    changeDirectoryCommand: `cd "${canonicalCwd}"`
  };
}

async function runTypedWorkCommand({ root, command }) {
  if (!root || !command || typeof command !== "string") {
    throw createHttpError("Root directory and command string are required.", 400);
  }

  const trimmed = command.trim();
  if (/[|;&`<>$]/.test(trimmed)) {
    throw createHttpError("Shell operators, pipes, and chaining are not permitted.", 400);
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw createHttpError("Empty command.", 400);
  }

  const [cmd, ...args] = tokens;

  if (cmd === "cat") {
    if (args.length === 0) {
      throw createHttpError("cat requires a file path.", 400);
    }
    const targetFile = resolveSafePath(root, args[0]);
    try {
      const content = await fs.readFile(targetFile, "utf8");
      return { output: content };
    } catch (err) {
      if (err.statusCode) throw err;
      throw createHttpError(`Failed to read file: ${err.message}`, 400);
    }
  }

  if (cmd === "head" || cmd === "tail") {
    let lineCount = 10;
    let targetPath = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-n" && i + 1 < args.length) {
        lineCount = parseInt(args[i + 1], 10) || 10;
        i++;
      } else if (args[i].startsWith("-n") && args[i].length > 2) {
        lineCount = parseInt(args[i].slice(2), 10) || 10;
      } else if (/^-\d+$/.test(args[i])) {
        lineCount = parseInt(args[i].slice(1), 10) || 10;
      } else if (!targetPath) {
        targetPath = args[i];
      }
    }

    if (!targetPath) {
      throw createHttpError(`${cmd} requires a file path.`, 400);
    }

    const targetFile = resolveSafePath(root, targetPath);
    try {
      const content = await fs.readFile(targetFile, "utf8");
      const lines = content.split("\n");
      let selected;
      if (cmd === "head") {
        selected = lines.slice(0, lineCount);
      } else {
        selected = lines.slice(-lineCount);
      }
      return { output: selected.join("\n") };
    } catch (err) {
      if (err.statusCode) throw err;
      throw createHttpError(`Failed to read file: ${err.message}`, 400);
    }
  }

  throw createHttpError(`Unsupported command: ${cmd}. Only parsed read-only commands (cat, head, tail) are allowed.`, 400);
}

async function runWorkFileDiff({ root, filePath }) {
  if (!root || !filePath) {
    throw createHttpError("Project root and file path are required.", 400);
  }
  const targetFile = resolveSafePath(root, filePath);
  const relativePath = path.relative(root, targetFile);

  try {
    const { stdout } = await execFileAsync("git", ["diff", "--", relativePath], { cwd: root });
    const output = `# Unstaged\n${stdout || "(no changes)"}`;
    return {
      output,
      hasChanges: Boolean(stdout && stdout.trim().length > 0)
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw createHttpError(`Failed to execute diff: ${err.message}`, 400);
  }
}

class WorkActionRunner {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async executeCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      const blocked = ["rm -rf /", ":(){ :|:& };:"];
      if (blocked.some((b) => command.includes(b))) {
        return reject(new Error("Command blocked for safety reasons."));
      }

      exec(command, { cwd: options.cwd || this.projectRoot, timeout: 60000 }, (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout ? stdout.trim() : "",
          stderr: stderr ? stderr.trim() : "",
          exitCode: error ? error.code : 0
        });
      });
    });
  }

  async listProjectFiles(subDir = "") {
    const targetDir = path.join(this.projectRoot, subDir);
    const files = await fs.readdir(targetDir, { withFileTypes: true });
    return files.map((f) => ({
      name: f.name,
      isDirectory: f.isDirectory(),
      path: path.relative(this.projectRoot, path.join(targetDir, f.name))
    }));
  }

  async runWorkFileDiff(oldContent, newContent) {
    const linesOld = (oldContent || "").split("\n");
    const linesNew = (newContent || "").split("\n");
    return {
      totalOldLines: linesOld.length,
      totalNewLines: linesNew.length,
      hasChanges: oldContent !== newContent
    };
  }
}

module.exports = {
  WorkActionRunner,
  getWorkTerminalSession,
  runTypedWorkCommand,
  runWorkFileDiff
};
