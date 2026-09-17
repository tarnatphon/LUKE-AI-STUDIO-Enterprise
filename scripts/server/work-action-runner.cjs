"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { resolveInsideRoot, createHttpError } = require("./work-path-guard.cjs");

const execFileAsync = promisify(execFile);

// Palette of commands the typed work terminal may run. Every entry is parsed
// in-process (no shell) and strictly read-only: file reads and diffs only.
const READ_ONLY_COMMANDS = ["cat", "head", "tail", "git", "ls", "dir", "pwd"];

// The words the Work Terminal itself offers on its buttons. They are turned
// into fixed argv arrays here, so what the user types selects a command and
// never becomes one.
const GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "branch"]);
const MAX_LOG_LINES = 200;

function gitArgs(tokens) {
  const sub = tokens[0];
  if (!GIT_SUBCOMMANDS.has(sub)) {
    throw reject(
      "Only git status, git diff, git log and git branch can run here, and only to read.",
      400,
    );
  }
  if (sub === "status") {
    const short = tokens.some((token) => token === "--short" || token === "-s" || token === "-sb");
    const branch = tokens.some((token) => token === "-b" || token === "-sb");
    return ["status", ...(short ? ["--short"] : []), ...(branch && !short ? ["-b"] : [])];
  }
  if (sub === "diff") {
    const stat = tokens.includes("--stat");
    const cached = tokens.includes("--cached") || tokens.includes("--staged");
    return ["diff", ...(stat ? ["--stat"] : []), ...(cached ? ["--cached"] : [])];
  }
  if (sub === "log") {
    let lines = 20;
    let oneline = false;
    let graph = false;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === "--oneline") oneline = true;
      else if (token === "--graph") graph = true;
      else if (token === "-n" && i + 1 < tokens.length) lines = parseInt(tokens[i + 1], 10) || lines;
      else if (/^-\d+$/.test(token)) lines = parseInt(token.slice(1), 10) || lines;
    }
    lines = Math.min(Math.max(lines, 1), MAX_LOG_LINES);
    return ["log", ...(oneline ? ["--oneline"] : []), ...(graph ? ["--graph"] : []), "-n", String(lines)];
  }
  return [sub, ...(tokens.includes("-a") || tokens.includes("--all") ? ["-a"] : [])];
}

async function listDirectory(root, { recursive = false } = {}) {
  const canonicalRoot = await fs.realpath(root).catch(() => path.resolve(root));
  if (!recursive) {
    const dirents = await fs.readdir(canonicalRoot, { withFileTypes: true }).catch(() => []);
    const lines = dirents
      .filter((entry) => entry.name !== ".git")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    return { output: lines.join("\n") || "(empty)" };
  }
  const entries = [];
  const queue = [""];
  while (queue.length && entries.length < 200) {
    const directory = queue.shift();
    const dirents = await fs.readdir(path.join(canonicalRoot, directory), { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (entries.length >= 200) break;
      const relative = directory ? `${directory}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (![".git", "node_modules", "dist", "build", ".cache"].includes(dirent.name)) queue.push(relative);
        continue;
      }
      if (dirent.isFile()) entries.push(relative);
    }
  }
  return { output: entries.sort().join("\n") || "(empty)" };
}

// The only command ids the Work terminal palette can ask for. They are fixed
// argv arrays executed without a shell, so the model can never inject text.
const READ_ONLY_COMMAND_IDS = {
  "git-status": { file: "git", args: ["status", "--short"] },
  "git-diff": { file: "git", args: ["diff", "--stat"] },
  "git-log": { file: "git", args: ["log", "--oneline", "-n", "20"] },
};

// Targets the Work panel may reveal. Anything else is refused, and every one
// of them stays inside the granted folder.
const OPEN_TARGETS = new Set(["files", "terminal", "vscode", "browser"]);

function reject(message, statusCode = 400) {
  return createHttpError(message, statusCode);
}

/**
 * Resolve a relative path against the granted folder. Uses the shared guard, so
 * an absolute path, a ".." walk, a "~" home shortcut and a symlink that points
 * out of the folder are all refused the same way as a normal file read.
 */
async function resolveSafePath(root, targetPath) {
  if (!root || !targetPath) {
    throw reject("Root directory and file path are required.", 400);
  }
  const { targetPath: resolved } = await resolveInsideRoot({
    root,
    targetPath,
    allowMissing: false,
  });
  return resolved;
}

async function getWorkTerminalSession({ root }) {
  if (!root) {
    throw reject("Project root is required.", 400);
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
    throw reject("Root directory and command string are required.", 400);
  }

  const trimmed = command.trim();
  if (/[|;&`<>$]/.test(trimmed)) {
    throw reject("Pipes, redirection, substitutions, and chaining are not permitted.", 400);
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw reject("Empty command.", 400);
  }

  const [file, ...args] = tokens;
  const canonicalRoot = await fs.realpath(root).catch(() => path.resolve(root));

  // "list files" is how the Work Terminal labels the button.
  if (file === "list" && args[0] === "files") {
    return listDirectory(root, { recursive: false });
  }

  if (!READ_ONLY_COMMANDS.includes(file)) {
    throw reject(`Unsupported command: ${file}. Only parsed read-only commands (${READ_ONLY_COMMANDS.join(", ")}) are allowed.`, 400);
  }

  if (file === "pwd") {
    return { output: canonicalRoot };
  }

  if (file === "ls" || file === "dir") {
    const recursive = args.some((token) => token === "-R" || token === "--recursive" || token === "-r");
    return listDirectory(root, { recursive });
  }

  if (file === "git") {
    if (args.length === 0) throw reject("Tell git what to do: status, diff, log or branch.", 400);
    const gitCommand = gitArgs(args);
    try {
      const { stdout } = await execFileAsync("git", gitCommand, {
        cwd: canonicalRoot,
        shell: false,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      });
      return { output: stdout || "(no output)" };
    } catch (err) {
      if (err.statusCode) throw err;
      const detail = String(err.stderr || err.message || "").trim().slice(0, 200);
      return { output: detail ? `git ${args[0]} could not run here: ${detail}` : `git ${args[0]} produced no output.` };
    }
  }

  if (file === "cat") {
    if (args.length === 0) {
      throw reject("cat requires a file path.", 400);
    }
    const targetFile = await resolveSafePath(root, args[0]);
    try {
      const content = await fs.readFile(targetFile, "utf8");
      return { output: content };
    } catch (err) {
      if (err.statusCode) throw err;
      throw reject(`Failed to read file: ${err.message}`, 400);
    }
  }

  if (file === "head" || file === "tail") {
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
      throw reject(`${file} requires a file path.`, 400);
    }

    const targetFile = await resolveSafePath(root, targetPath);
    try {
      const content = await fs.readFile(targetFile, "utf8");
      // A file that ends with a newline has no last line after it, so the
      // trailing empty entry is dropped: tail -n 1 has to show "}" and not a
      // blank line.
      const lines = content.replace(/\n$/, "").split("\n");
      let selected;
      if (file === "head") {
        selected = lines.slice(0, lineCount);
      } else {
        selected = lines.slice(-lineCount);
      }
      return { output: selected.join("\n") };
    } catch (err) {
      if (err.statusCode) throw err;
      throw reject(`Failed to read file: ${err.message}`, 400);
    }
  }

  throw reject(`No handler implemented for read-only command: ${file}.`, 500);
}

/**
 * Fixed palette commands (git status / diff / log, list files). The id selects
 * a hard-coded argv array — there is no way for a caller to inject arguments —
 * and every process runs in the granted folder without a shell.
 */
async function runReadOnlyWorkCommand({ root, commandId }) {
  if (!root) throw reject("Project root is required.", 400);
  const canonicalRoot = await fs.realpath(root).catch(() => path.resolve(root));

  if (commandId === "list-files") {
    const entries = [];
    const queue = [""];
    while (queue.length && entries.length < 200) {
      const directory = queue.shift();
      const dirents = await fs.readdir(path.join(canonicalRoot, directory), { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents) {
        if (entries.length >= 200) break;
        const relative = directory ? `${directory}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          if (![".git", "node_modules", "dist", "build", ".cache"].includes(dirent.name)) queue.push(relative);
          continue;
        }
        if (dirent.isFile()) entries.push(relative);
      }
    }
    return { output: entries.sort().join("\n") || "(empty)" };
  }

  const command = READ_ONLY_COMMAND_IDS[String(commandId || "")];
  if (!command) {
    throw reject(`Unsupported command: ${commandId}. The palette only offers ${Object.keys(READ_ONLY_COMMAND_IDS).join(", ")} and list-files.`, 400);
  }

  try {
    const { stdout } = await execFileAsync(command.file, command.args, {
      cwd: canonicalRoot,
      shell: false,
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    });
    return { output: stdout || "(no output)" };
  } catch (err) {
    if (err.statusCode) throw err;
    throw reject(`Command failed: ${err.message}`, 400);
  }
}

function revealCommand(target, canonicalRoot, url) {
  if (process.platform === "darwin") {
    if (target === "terminal") return { file: "open", args: ["-a", "Terminal", canonicalRoot] };
    if (target === "vscode") return { file: "code", args: [canonicalRoot] };
    if (target === "browser") return { file: "open", args: [url] };
    return { file: "open", args: [canonicalRoot] };
  }
  if (process.platform === "win32") {
    if (target === "terminal") return { file: "cmd", args: ["/c", "start", "cmd", "/k", `cd /d "${canonicalRoot}"`] };
    if (target === "vscode") return { file: "code", args: [canonicalRoot] };
    if (target === "browser") return { file: "cmd", args: ["/c", "start", "", url] };
    return { file: "explorer", args: [canonicalRoot] };
  }
  if (target === "terminal") return { file: "x-terminal-emulator", args: ["--working-directory", canonicalRoot] };
  if (target === "vscode") return { file: "code", args: [canonicalRoot] };
  if (target === "browser") return { file: "xdg-open", args: [url] };
  return { file: "xdg-open", args: [canonicalRoot] };
}

/**
 * Revealing something on the user's machine is a real action, so it needs an
 * explicit approval flag and a target from the fixed list. A folder target is
 * always the granted folder itself; only an http(s) URL may open the browser.
 */
async function openWorkTarget({ root, target, url, approvalGranted }) {
  if (approvalGranted !== true) {
    throw reject("Opening anything on this computer requires explicit approval.", 403);
  }
  if (!root) throw reject("Project root is required.", 400);
  if (!OPEN_TARGETS.has(String(target || ""))) {
    throw reject(`Unsupported open target: ${target}.`, 400);
  }

  const canonicalRoot = await fs.realpath(root).catch(() => path.resolve(root));

  if (target === "browser") {
    const raw = String(url || "").trim();
    if (!raw) throw reject("A website address is required.", 400);
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw reject("That is not a valid website address.", 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw reject("Only http and https addresses can be opened.", 400);
    }
  }

  const command = revealCommand(target, canonicalRoot, String(url || ""));
  try {
    await execFileAsync(command.file, command.args, { shell: false, timeout: 15000 });
  } catch (err) {
    throw reject(`Could not open ${target}: ${err.message}`, 400);
  }
  return { opened: true, target };
}

async function runWorkFileDiff({ root, filePath }) {
  if (!root || !filePath) {
    throw reject("Project root and file path are required.", 400);
  }
  const targetFile = await resolveSafePath(root, filePath);
  const canonicalRoot = await fs.realpath(root).catch(() => path.resolve(root));
  const relativePath = path.relative(canonicalRoot, targetFile);

  try {
    const { stdout } = await execFileAsync("git", ["diff", "--", relativePath], { cwd: canonicalRoot, shell: false, timeout: 20000 });
    const output = `# Unstaged\n${stdout || "(no changes)"}`;
    return {
      output,
      hasChanges: Boolean(stdout && stdout.trim().length > 0)
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw reject(`Failed to execute diff: ${err.message}`, 400);
  }
}

/**
 * Kept for backwards compatibility with older callers. Arbitrary shell strings
 * are no longer executed anywhere: Work Mode runs the typed read-only palette
 * and the fixed command ids instead, both without a shell.
 */
class WorkActionRunner {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async executeCommand(command, options = {}) {
    if (options.approvalGranted !== true) {
      throw new Error("Command execution requires explicit user approval (approvalGranted).");
    }
    void command;
    throw new Error("Free-form commands were removed. Use the read-only command palette instead.");
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
  openWorkTarget,
  runReadOnlyWorkCommand,
  runTypedWorkCommand,
  runWorkFileDiff
};
