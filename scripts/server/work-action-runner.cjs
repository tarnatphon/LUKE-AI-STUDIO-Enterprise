"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { readWorkFile } = require("./work-file-manager.cjs");

const execFileAsync = promisify(execFile);
const READ_ONLY_COMMANDS = {
  "git-status": { file: "git", args: ["status", "--short", "--branch"] },
  "git-diff": { file: "git", args: ["diff", "--stat"] },
  "git-log": { file: "git", args: ["log", "--oneline", "--decorate", "-20"] },
};

function parseCommandLine(value) {
  const input = String(value || "").trim();
  if (!input) return [];
  if (/[;&|><`$\r\n]/.test(input)) {
    const error = new Error("Pipes, redirection, substitutions, and command chaining are not allowed in read-only Work Terminal.");
    error.statusCode = 400;
    throw error;
  }
  const tokens = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = pattern.exec(input))) tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["\\])/g, "$1"));
  return tokens;
}

function validateGitArguments(tokens) {
  const [subcommand, ...args] = tokens;
  const allowed = {
    status: new Set(["--short", "--branch", "-s", "-b"]),
    diff: new Set(["--stat", "--cached", "--staged", "--name-only", "--name-status"]),
    log: new Set(["--oneline", "--decorate", "--all", "--graph"]),
    show: new Set(["--stat", "--oneline", "--decorate"]),
    branch: new Set(["--show-current", "-a", "-vv"]),
    "rev-parse": new Set(["--show-toplevel", "--show-prefix", "--is-inside-work-tree"]),
  };
  if (!allowed[subcommand]) return false;
  return args.every((arg) => allowed[subcommand].has(arg) || ((subcommand === "log" || subcommand === "show") && /^-[1-9]\d{0,2}$/.test(arg)) || (subcommand === "show" && /^[a-f0-9]{4,40}$/i.test(arg)));
}

async function validatedRoot(value) {
  if (!value || !path.isAbsolute(String(value))) {
    const error = new Error("Work action root must be an absolute path.");
    error.statusCode = 400;
    throw error;
  }
  const requestedRoot = path.resolve(String(value));
  const root = await fs.realpath(requestedRoot).catch(() => null);
  const stats = root ? await fs.stat(root).catch(() => null) : null;
  if (!stats?.isDirectory()) {
    const error = new Error("Work action root is not an available directory.");
    error.statusCode = 400;
    throw error;
  }
  return root;
}

async function runReadOnlyWorkCommand({ root, commandId }) {
  const cwd = await validatedRoot(root);
  if (commandId === "list-files") {
    const entries = await fs.readdir(cwd);
    return { commandId, output: entries.slice(0, 300).join("\n"), exitCode: 0 };
  }
  const command = READ_ONLY_COMMANDS[commandId];
  if (!command) {
    const error = new Error("This Work terminal command is not allowed.");
    error.statusCode = 400;
    throw error;
  }
  try {
    const result = await execFileAsync(command.file, command.args, {
      cwd,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
      encoding: "utf8",
    });
    return { commandId, output: String(result.stdout || result.stderr || "No output."), exitCode: 0 };
  } catch (error) {
    return {
      commandId,
      output: String(error.stdout || error.stderr || error.message || "Command failed."),
      exitCode: Number(error.code) || 1,
    };
  }
}

async function runTypedWorkCommand({ root, command }) {
  const cwd = await validatedRoot(root);
  const tokens = parseCommandLine(command);
  if (tokens.length === 0) return { command, output: "", exitCode: 0 };
  const [file, ...args] = tokens;

  if (file === "pwd") return { command, output: cwd, exitCode: 0 };
  if (file === "ls" && args.every((arg) => ["-l", "-a", "-la", "-al"].includes(arg))) {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    const showHidden = args.some((arg) => arg.includes("a"));
    const output = entries.filter((entry) => showHidden || !entry.name.startsWith(".")).map((entry) => `${entry.isDirectory() ? "d" : "-"} ${entry.name}`).join("\n");
    return { command, output, exitCode: 0 };
  }
  if (file === "cat" && args.length === 1) {
    const opened = await readWorkFile({ root: cwd, filePath: args[0] });
    return { command, output: opened.content, exitCode: 0 };
  }
  if ((file === "head" || file === "tail") && args.length >= 1) {
    let count = 20;
    let filePath = args[args.length - 1];
    if (args.length === 3 && args[0] === "-n" && /^(?:[1-9]|[1-9]\d|1\d\d|200)$/.test(args[1])) count = Number(args[1]);
    else if (args.length !== 1) throw Object.assign(new Error(`Usage: ${file} [-n 1-200] <project-file>`), { statusCode: 400 });
    const opened = await readWorkFile({ root: cwd, filePath });
    const lines = opened.content.split(/\r?\n/);
    return { command, output: (file === "head" ? lines.slice(0, count) : lines.slice(-count)).join("\n"), exitCode: 0 };
  }
  if (file !== "git" || !validateGitArguments(args)) {
    const error = new Error("Command not allowed. Available: pwd, ls [-la], cat <file>, head/tail [-n 1-200] <file>, git status/diff/log/show/branch/rev-parse with read-only options.");
    error.statusCode = 400;
    throw error;
  }

  try {
    const result = await execFileAsync("git", args, { cwd, timeout: 15000, maxBuffer: 2 * 1024 * 1024, shell: false, encoding: "utf8" });
    return { command, output: String(result.stdout || result.stderr || "No output."), exitCode: 0 };
  } catch (error) {
    return { command, output: String(error.stdout || error.stderr || error.message || "Command failed."), exitCode: Number(error.code) || 1 };
  }
}

async function getWorkTerminalSession({ root }) {
  const cwd = await validatedRoot(root);
  const username = String(os.userInfo().username || "user");
  const hostname = String(os.hostname() || "computer").replace(/\.local$/i, "");
  const folderName = path.basename(cwd) || cwd;
  const promptSymbol = process.platform === "win32" ? ">" : process.platform === "darwin" ? "%" : "$";
  const displayPath = process.platform === "win32" ? cwd : cwd.replace(/([\\\s'"`$&;|<>()[\]{}*?!#~])/g, "\\$1");
  return {
    cwd,
    folderName,
    username,
    hostname,
    promptSymbol,
    prompt: process.platform === "win32" ? `${cwd}>` : `${username}@${hostname} ${folderName} ${promptSymbol}`,
    changeDirectoryCommand: process.platform === "win32" ? `cd /d ${cwd}` : `cd ${displayPath}`,
  };
}

async function runWorkFileDiff({ root, filePath }) {
  const cwd = await validatedRoot(root);
  const relativePath = String(filePath || "").replace(/\\/g, "/");
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split("/").includes("..") || relativePath.includes("\0")) {
    const error = new Error("Work Review file path must stay inside the project root.");
    error.statusCode = 400;
    throw error;
  }
  const options = { cwd, timeout: 15000, maxBuffer: 2 * 1024 * 1024, shell: false, encoding: "utf8" };
  const collect = async (args) => {
    try {
      const result = await execFileAsync("git", args, options);
      return String(result.stdout || result.stderr || "");
    } catch (error) {
      if (Number(error.code) === 1) return String(error.stdout || error.stderr || "");
      throw error;
    }
  };
  const [unstaged, staged] = await Promise.all([
    collect(["diff", "--no-ext-diff", "--no-color", "--", relativePath]),
    collect(["diff", "--cached", "--no-ext-diff", "--no-color", "--", relativePath]),
  ]);
  const output = [`# Unstaged\n${unstaged || "No unstaged diff."}`, `# Staged\n${staged || "No staged diff."}`].join("\n\n");
  const maxChars = 300000;
  return { path: relativePath, output: output.length > maxChars ? `${output.slice(0, maxChars)}\n\n… Diff truncated at 300,000 characters.` : output, truncated: output.length > maxChars };
}

function launch(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openWorkTarget({ root, target, url, approvalGranted }) {
  if (approvalGranted !== true) {
    const error = new Error("Explicit approval is required before opening an external Work target.");
    error.statusCode = 403;
    throw error;
  }
  const cwd = await validatedRoot(root);
  const supported = new Set(["files", "terminal", "vscode", "browser"]);
  if (!supported.has(target)) {
    const error = new Error("Unsupported Work open target.");
    error.statusCode = 400;
    throw error;
  }

  if (target === "browser") {
    const address = new URL(String(url || "https://www.google.com"));
    if (!["http:", "https:"].includes(address.protocol)) {
      const error = new Error("Only HTTP and HTTPS browser URLs are allowed.");
      error.statusCode = 400;
      throw error;
    }
    if (process.platform === "darwin") await launch("/usr/bin/open", [address.href]);
    else if (process.platform === "win32") await launch("rundll32.exe", ["url.dll,FileProtocolHandler", address.href]);
    else await launch("xdg-open", [address.href]);
    return { opened: target, value: address.href };
  }

  if (process.platform === "darwin") {
    if (target === "files") await launch("/usr/bin/open", [cwd]);
    if (target === "terminal") await launch("/usr/bin/open", ["-a", "Terminal", cwd]);
    if (target === "vscode") await launch("/usr/bin/open", ["-a", "Visual Studio Code", cwd]);
  } else if (process.platform === "win32") {
    if (target === "files") await launch("explorer.exe", [cwd]);
    if (target === "terminal") await launch("wt.exe", ["-d", cwd]);
    if (target === "vscode") await launch("code.cmd", [cwd]);
  } else {
    if (target === "files") await launch("xdg-open", [cwd]);
    if (target === "terminal") await launch("x-terminal-emulator", ["--working-directory", cwd]);
    if (target === "vscode") await launch("code", [cwd]);
  }
  return { opened: target, value: cwd };
}

module.exports = { getWorkTerminalSession, openWorkTarget, runReadOnlyWorkCommand, runTypedWorkCommand, runWorkFileDiff };
