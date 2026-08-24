"use strict";

// LUKE_AI_WORK_ACTION_RUNNER_V2
//
// Typed, parsed, read-only Work actions. Nothing in this module ever invokes
// a shell: every subprocess is spawned with shell: false against a fixed argv
// whitelist, and typed terminal commands are parsed token-by-token with a
// strict metacharacter blocklist.

const fs = require("node:fs");
const path = require("node:path");
const {
  execFile,
  spawn,
} = require("node:child_process");
const {
  promisify,
} = require("node:util");

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const MAX_TYPED_COMMAND_CHARS = 512;

// Fixed read-only command palette. The UI sends a commandId; the argv
// entries below are the only argv values that will ever execute.
const READ_ONLY_COMMANDS = Object.freeze({
  "git-status": Object.freeze({
    description: "Show git status",
    argv: Object.freeze(["status", "--porcelain=v1", "--branch"]),
  }),
  "git-log": Object.freeze({
    description: "Show recent commits",
    argv: Object.freeze(["log", "--oneline", "-n", "20"]),
  }),
  "git-diff": Object.freeze({
    description: "Summarize uncommitted changes",
    argv: Object.freeze(["diff", "--stat"]),
  }),
});

// Pipes, redirection, substitutions, and every other shell operator are
// rejected from typed terminal commands before any token is parsed.
const TYPED_COMMAND_METACHARACTERS = /[|&;<>()$`\\'"!*?~\n\r\0]/;

const OPEN_TARGETS = Object.freeze({
  files: "Open the project folder in the file manager",
  terminal: "Open a terminal in the project folder",
  vscode: "Open the project in VS Code",
  browser: "Open a URL in the default browser",
});

function createStatusError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}

function resolveRealRoot(root) {
  const candidate = String(root || "");
  if (!candidate) {
    throw createStatusError("Project root is required.", 400);
  }
  return fs.existsSync(candidate)
    ? fs.realpathSync(candidate)
    : path.resolve(candidate);
}

// Resolve a path that is guaranteed to stay inside the canonical project
// root (macOS /private/var safe: the root is canonicalized via realpath).
function resolveInsideRoot(root, relativePath) {
  const realRoot = resolveRealRoot(root);
  const requested = String(relativePath || "");
  const targetPath = path.resolve(realRoot, requested);
  const rel = path.relative(realRoot, targetPath);

  if (
    rel === ".." ||
    rel.startsWith(`..${path.sep}`)
  ) {
    throw createStatusError(
      "Path escapes the project root.",
      400
    );
  }

  const realTarget = fs.existsSync(targetPath)
    ? fs.realpathSync(targetPath)
    : targetPath;

  if (
    realTarget !== realRoot &&
    !realTarget.startsWith(realRoot + path.sep)
  ) {
    throw createStatusError(
      "Target escapes the project root.",
      403
    );
  }

  return {
    realRoot,
    realTarget,
    rel,
  };
}

function parseLineCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10000) {
    throw createStatusError(
      `Invalid line count: ${value}`,
      400
    );
  }
  return parsed;
}

async function getWorkTerminalSession(options = {}) {
  const realRoot = resolveRealRoot(
    options.root || options.projectRoot
  );

  return {
    cwd: realRoot,
    prompt: "project >",
    changeDirectoryCommand: `cd "${realRoot}"`,
    readOnly: true,
  };
}

async function runReadOnlyWorkCommand(options = {}) {
  const commandId = String(options.commandId || "");
  const entry = READ_ONLY_COMMANDS[commandId];

  if (!entry) {
    const allowed = Object.keys(READ_ONLY_COMMANDS).join(", ");
    throw createStatusError(
      `Unknown read-only command "${commandId}". Allowed: ${allowed}.`,
      400
    );
  }

  const realRoot = resolveRealRoot(options.root);

  try {
    const {
      stdout,
      stderr,
    } = await execFileAsync("git", entry.argv, {
      cwd: realRoot,
      shell: false,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });

    const combined = [
      String(stdout || "").trim(),
      String(stderr || "").trim(),
    ].filter(Boolean).join("\n");

    return {
      commandId,
      description: entry.description,
      output: combined || "(no output)",
    };
  } catch (error) {
    return {
      commandId,
      description: entry.description,
      output: String(error?.stderr || error?.message || "").trim() || "(no output)",
      warning: "Git is unavailable or the folder is not a git repository.",
    };
  }
}

async function runTypedWorkCommand(options = {}) {
  const command = String(options.command || "").trim();

  if (!command) {
    throw createStatusError("Command is empty.", 400);
  }

  if (command.length > MAX_TYPED_COMMAND_CHARS) {
    throw createStatusError("Command is too long.", 400);
  }

  if (TYPED_COMMAND_METACHARACTERS.test(command)) {
    throw createStatusError(
      "Pipes, redirection, substitutions, and other shell operators are not permitted.",
      400
    );
  }

  const tokens = command.split(/\s+/);
  // The typed command name. Kept under the name "file" so the read-only
  // whitelist (cat, head, tail, pwd) stays greppable in code review.
  const file = tokens[0].toLowerCase();
  const {
    realRoot,
  } = resolveRealRoot(options.root);

  const readFileLines = (relativePath) => {
    const {
      realTarget,
    } = resolveInsideRoot(options.root, relativePath);

    if (!fs.existsSync(realTarget) || !fs.statSync(realTarget).isFile()) {
      throw createStatusError(
        `File not found: ${relativePath}`,
        404
      );
    }

    const buffer = fs.readFileSync(realTarget);

    if (buffer.includes(0)) {
      throw createStatusError(
        "Binary files are not supported for text commands.",
        415
      );
    }

    const content = buffer.toString("utf8");
    return {
      content,
      lines: content.split("\n"),
    };
  };

  if (file === "pwd") {
    return {
      command,
      output: realRoot,
    };
  }

  if (file === "cat") {
    const [targetFile] = tokens.slice(1);

    if (!targetFile) {
      throw createStatusError("Usage: cat <file>", 400);
    }

    return {
      command,
      output: readFileLines(targetFile).content,
    };
  }

  if (file === "head" || file === "tail") {
    let count = 10;
    let targetFile = null;

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === "-n" && index + 1 < tokens.length) {
        count = parseLineCount(tokens[index + 1]);
        index += 1;
        continue;
      }

      if (/^-\d+$/.test(token)) {
        count = parseLineCount(token.slice(1));
        continue;
      }

      if (!token.startsWith("-")) {
        targetFile = token;
      }
    }

    if (!targetFile) {
      throw createStatusError(
        `Usage: ${file} [-n <lines>] <file>`,
        400
      );
    }

    const {
      lines,
    } = readFileLines(targetFile);
    const selected =
      file === "head"
        ? lines.slice(0, count)
        : lines.slice(-count);

    return {
      command,
      output: selected.join("\n"),
    };
  }

  throw createStatusError(
    `Unknown typed command: ${file}. Use cat, head, tail, or pwd.`,
    400
  );
}

async function runWorkFileDiff(options = {}) {
  const {
    realRoot,
    realTarget,
    rel,
  } = resolveInsideRoot(options.root, options.filePath);

  if (!fs.existsSync(realTarget) || !fs.statSync(realTarget).isFile()) {
    throw createStatusError(
      `File not found: ${options.filePath}`,
      404
    );
  }

  const runGit = async (args) => {
    try {
      const {
        stdout,
      } = await execFileAsync(
        "git",
        ["-c", "color.ui=never", ...args],
        {
          cwd: realRoot,
          shell: false,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
        }
      );
      return String(stdout || "").trim();
    } catch (error) {
      return String(error?.stderr || error?.message || "").trim();
    }
  };

  const [staged, unstaged] = await Promise.all([
    runGit(["diff", "--no-color", "--cached", "--", rel]),
    runGit(["diff", "--no-color", "--", rel]),
  ]);

  return {
    output: [
      `# Staged changes: ${rel}`,
      staged || "(no staged changes)",
      "",
      `# Unstaged changes: ${rel}`,
      unstaged || "(no unstaged changes)",
    ].join("\n"),
  };
}

function openProcessLauncher(platform) {
  if (platform === "darwin") {
    return {
      files: (root) => ["open", [root]],
      terminal: (root) => ["open", ["-a", "Terminal", root]],
      vscode: (root) => ["code", [root]],
      browser: (url) => ["open", [url]],
    };
  }

  if (platform === "win32") {
    return {
      files: (root) => ["explorer", [root]],
      terminal: (root) => ["explorer", [root]],
      vscode: (root) => ["code", [root]],
      browser: (url) => ["explorer", [url]],
    };
  }

  return {
    files: (root) => ["xdg-open", [root]],
    terminal: (root) => ["x-terminal-emulator", [root]],
    vscode: (root) => ["code", [root]],
    browser: (url) => ["xdg-open", [url]],
  };
}

function launchDetached(binary, args, cwd) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn(binary, args, {
        cwd,
        shell: false,
        stdio: "ignore",
        detached: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.on("error", (error) => {
      reject(error);
    });

    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openWorkTarget(options = {}) {
  // Opening anything external always requires explicit user approval.
  if (options.approvalGranted !== true) {
    throw createStatusError(
      "Opening external targets requires explicit user approval.",
      403
    );
  }

  const target = String(options.target || "");

  if (!OPEN_TARGETS[target]) {
    throw createStatusError(
      `Unknown open target "${target}". Allowed: files, terminal, vscode, browser.`,
      400
    );
  }

  const realRoot = resolveRealRoot(options.root);

  let url;

  if (target === "browser") {
    url = String(options.url || "").trim();

    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) {
      throw createStatusError(
        "Only http(s) URLs can be opened in the browser.",
        400
      );
    }
  }

  const launcher = openProcessLauncher(process.platform);
  const [binary, args] =
    target === "browser"
      ? launcher.browser(url)
      : launcher[target](realRoot);

  try {
    await launchDetached(binary, args, realRoot);
  } catch (error) {
    throw createStatusError(
      `Could not open ${target} on this system (${error?.code || error?.message || "unknown error"}).`,
      503
    );
  }

  return {
    target,
    description: OPEN_TARGETS[target],
    opened: binary,
    path: target === "browser" ? undefined : realRoot,
    url: target === "browser" ? url : undefined,
  };
}

module.exports = {
  READ_ONLY_COMMANDS,
  getWorkTerminalSession,
  openWorkTarget,
  runReadOnlyWorkCommand,
  runTypedWorkCommand,
  runWorkFileDiff,
};
