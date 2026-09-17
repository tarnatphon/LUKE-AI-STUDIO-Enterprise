"use strict";

/**
 * The verify half of the Work agent loop.
 *
 * Codex became useful when it stopped guessing and started checking: write the
 * change, run the project's own test/lint/build command, read the failure, fix,
 * repeat. This module supplies that step.
 *
 * The model never chooses a command. It can only ask for one of the commands
 * this module detected from the project's own files, and every one of them is
 * executed as a parsed argv array — no shell, so no pipes, no redirection, no
 * chaining — with the working directory pinned to the granted folder.
 *
 * The Work Terminal sends the commands the user types to the same place. A
 * terminal that cannot run `npm install` or `node app.js` cannot finish the
 * loop — write code, run it, read what broke — so instead of a shell there is
 * a bounded runner: a fixed list of programs, a parsed argv, an approval
 * before anything can change a file, and the same pinned working directory.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { canonicaliseRoot, resolveInsideRoot, createHttpError } = require("./work-path-guard.cjs");

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 600000;
const MAX_OUTPUT_CHARS = 12000;
const HEAD_CHARS = 8000;
const TAIL_CHARS = 4000;

function reject(message, statusCode = 400) {
  return createHttpError(message, statusCode);
}

/**
 * Environment handed to the child process. Anything that lets a project file
 * inject code into the runtime is removed.
 */
function sanitisedEnv() {
  const blocked = new Set([
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "NODE_OPTIONS",
    "PYTHONSTARTUP",
    "PYTHONPATH",
    "BASH_ENV",
    "ENV",
    "IFS",
  ]);
  const keep = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "USER",
    "LOGNAME",
    "SystemRoot",
    "ComSpec",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramFiles",
    "CARGO_HOME",
    "GOPATH",
    "GOROOT",
    "RUSTUP_HOME",
    "SSL_CERT_FILE",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const env = {};
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (blocked.has(key)) continue;
    if (keep.includes(key)) continue;
    // Everything else the project genuinely needs (API_URL, CI, RAILS_ENV …)
    // is passed through, minus the variables that can load foreign code.
    if (/^(?:npm_|NODE_|PYTHON|LD_|DYLD_|BASH)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

async function readSmallFile(filePath, limit = 256 * 1024) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > limit) return null;
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function npmScripts(root) {
  const raw = fs.existsSync(path.join(root, "package.json"))
    ? readSmallFileSync(path.join(root, "package.json"))
    : null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      scripts: parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {},
      packageManager: typeof parsed?.packageManager === "string" ? parsed.packageManager : "",
    };
  } catch {
    return { scripts: {}, packageManager: "" };
  }
}

function readSmallFileSync(filePath, limit = 256 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > limit) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function hasAny(root, names) {
  return names.some((name) => fs.existsSync(path.join(root, name)));
}

function makefileHasTarget(root, target) {
  const raw = readSmallFileSync(path.join(root, "Makefile"), 128 * 1024);
  if (!raw) return false;
  return new RegExp(`^${target}\\s*:`, "m").test(raw);
}

/**
 * Look at the project's own files and work out which verification commands it
 * already has. Nothing here is guessed from the model: the commands come from
 * package.json scripts, a Makefile target, or a language marker file.
 */
async function detectProjectCommands(rootValue) {
  const root = await canonicaliseRoot(rootValue);
  const found = [];
  const seen = new Set();
  const add = (id, label, file, args, hint) => {
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ id, label, file, args: args.filter(Boolean), category: "check", hint });
  };

  const pkg = npmScripts(root);
  if (pkg) {
    const runner = pkg.packageManager.startsWith("pnpm")
      ? "pnpm"
      : pkg.packageManager.startsWith("yarn")
        ? "yarn"
        : "npm";
    const runArgs = (script) => (runner === "npm" ? ["run", script] : [script]);
    if (pkg.scripts.test) add("npm-test", `${runner} test`, runner, runner === "npm" ? ["test"] : ["test"], "Project test script");
    if (pkg.scripts.lint) add("npm-lint", `${runner} run lint`, runner, runArgs("lint"), "Project lint script");
    if (pkg.scripts.typecheck) add("npm-typecheck", `${runner} run typecheck`, runner, runArgs("typecheck"), "Project type check");
    if (pkg.scripts["type-check"]) add("npm-typecheck", `${runner} run type-check`, runner, runArgs("type-check"), "Project type check");
    if (pkg.scripts.build) add("npm-build", `${runner} run build`, runner, runArgs("build"), "Project build script");
    if (pkg.scripts["test:unit"]) add("npm-test-unit", `${runner} run test:unit`, runner, runArgs("test:unit"), "Unit tests only");
    if (fs.existsSync(path.join(root, "tsconfig.json")) && !pkg.scripts.typecheck && !pkg.scripts["type-check"]) {
      add("tsc-noemit", "npx tsc --noEmit", "npx", ["tsc", "--noEmit"], "TypeScript type check");
    }
  }

  if (hasAny(root, ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"])) {
    const python = process.platform === "win32" ? "python" : "python3";
    if (hasAny(root, ["tests"]) || hasAny(root, ["test"]) || fs.existsSync(path.join(root, "pytest.ini")) || (readSmallFileSync(path.join(root, "pyproject.toml")) || "").includes("[tool.pytest")) {
      add("pytest", `${python} -m pytest -q`, python, ["-m", "pytest", "-q"], "Python test suite");
    }
    if (fs.existsSync(path.join(root, "ruff.toml")) || (readSmallFileSync(path.join(root, "pyproject.toml")) || "").includes("[tool.ruff")) {
      add("ruff", `${python} -m ruff check .`, python, ["-m", "ruff", "check", "."], "Python lint");
    }
  }

  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    add("cargo-test", "cargo test", "cargo", ["test"], "Rust test suite");
    add("cargo-check", "cargo check", "cargo", ["check"], "Rust type check");
  }
  if (fs.existsSync(path.join(root, "go.mod"))) {
    add("go-test", "go test ./...", "go", ["test", "./..."], "Go test suite");
    add("go-vet", "go vet ./...", "go", ["vet", "./..."], "Go static analysis");
  }
  if (fs.existsSync(path.join(root, "pom.xml"))) add("mvn-test", "mvn -q test", "mvn", ["-q", "test"], "Maven tests");
  if (hasAny(root, ["build.gradle", "build.gradle.kts"])) add("gradle-test", "gradle test", "gradle", ["test"], "Gradle tests");
  if (fs.existsSync(path.join(root, "Makefile"))) {
    if (makefileHasTarget(root, "test")) add("make-test", "make test", "make", ["test"], "Makefile test target");
    if (makefileHasTarget(root, "lint")) add("make-lint", "make lint", "make", ["lint"], "Makefile lint target");
    if (makefileHasTarget(root, "build")) add("make-build", "make build", "make", ["build"], "Makefile build target");
  }
  if (fs.existsSync(path.join(root, "composer.json"))) {
    const scripts = readSmallFileSync(path.join(root, "composer.json"));
    if (scripts && /"test"/.test(scripts)) add("composer-test", "composer test", "composer", ["test"], "PHP test script");
  }

  return { root, commands: found };
}

async function findCommand(rootValue, commandId) {
  const { root, commands } = await detectProjectCommands(rootValue);
  const command = commands.find((entry) => entry.id === String(commandId || "").trim());
  if (!command) {
    throw reject(
      `Unknown verification command. Available: ${commands.map((entry) => entry.id).join(", ") || "none detected for this project"}.`,
      404,
    );
  }
  return { root, command, commands };
}

function trimOutput(text) {
  const value = String(text || "");
  if (value.length <= MAX_OUTPUT_CHARS) return { output: value, truncated: false };
  const head = value.slice(0, HEAD_CHARS);
  const tail = value.slice(-TAIL_CHARS);
  return {
    output: `${head}\n\n… [${value.length - HEAD_CHARS - TAIL_CHARS} characters omitted] …\n\n${tail}`,
    truncated: true,
  };
}

/** Everything that looks like a failure line, so the model sees the signal. */
function extractFailureSignals(text) {
  const lines = String(text || "").split(/\r?\n/);
  const signals = [];
  const patterns = [
    /\bFAIL(?:ED)?\b/i,
    /\bERROR\b/i,
    /\bError:/i,
    /\bE\s{2,}/,
    /\bAssertionError\b/,
    /\bpanic:/i,
    /\berror\[E\d+\]/,
    /\bTests? failed\b/i,
    /\bfailing\b/i,
    /\b✕|\b✖|\b×/,
    /error TS\d+/,
  ];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (patterns.some((pattern) => pattern.test(trimmed))) {
      signals.push(trimmed.slice(0, 300));
      if (signals.length >= 25) break;
    }
  }
  return signals;
}

/**
 * Run one detected command with the working directory pinned to the granted
 * folder. No shell is involved, so the command string can never be extended.
 */
async function runProjectCheck({ root: rootValue, commandId, timeoutMs }) {
  const { root, command } = await findCommand(rootValue, commandId);
  const timeout = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let signal = null;
  let timedOut = false;

  try {
    const result = await execFileAsync(command.file, command.args, {
      cwd: root,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      env: sanitisedEnv(),
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    stdout = String(result.stdout || "");
    stderr = String(result.stderr || "");
    exitCode = 0;
  } catch (error) {
    stdout = String(error?.stdout || "");
    stderr = String(error?.stderr || "");
    exitCode = typeof error?.code === "number" ? error.code : 1;
    signal = error?.signal || null;
    timedOut = error?.killed === true || /ETIMEDOUT/.test(String(error?.code || "")) || signal === "SIGKILL";
    if (error?.code === "ENOENT") {
      throw reject(`"${command.file}" is not installed on this machine, so "${command.label}" cannot run.`, 400);
    }
  }

  const combined = [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : "");
  const trimmed = trimOutput(combined);
  return {
    commandId: command.id,
    label: command.label,
    command: [command.file, ...command.args].join(" "),
    cwd: root,
    passed: exitCode === 0,
    exitCode,
    signal,
    timedOut,
    durationMs: Date.now() - startedAt,
    output: trimmed.output,
    truncated: trimmed.truncated,
    failureSignals: exitCode === 0 ? [] : extractFailureSignals(combined),
  };
}


/**
 * The programs Work will run from the terminal, and what running one means.
 *
 * Deliberately short. There is no shell behind this terminal, so anything not
 * listed here is refused rather than passed through; and every entry can write
 * files or reach the network, which is why all of them ask first. Read-only
 * commands (cat, head, tail, git status/diff/log, ls, pwd) are handled
 * elsewhere and never need approval.
 */
const RUNNABLE_PROGRAMS = {
  node: { file: "node", note: "runs JavaScript with the same access you have" },
  npm: { file: "npm", note: "installs packages and runs project scripts; writes files and uses the network" },
  npx: { file: "npx", note: "downloads and runs a package; writes files and uses the network" },
  yarn: { file: "yarn", note: "installs packages and runs project scripts; writes files and uses the network" },
  pnpm: { file: "pnpm", note: "installs packages and runs project scripts; writes files and uses the network" },
  bun: { file: "bun", note: "runs JavaScript and installs packages; writes files and uses the network" },
  deno: { file: "deno", note: "runs JavaScript and TypeScript; writes files and uses the network" },
  python3: { file: "python3", note: "runs Python with the same access you have" },
  python: { file: "python", note: "runs Python with the same access you have" },
  make: { file: "make", note: "runs a target the project's own Makefile declares" },
};

/**
 * What cannot appear outside quotes. Shell operators only: with execFile there
 * is no shell to act on them, so most of what a shell would interpret is
 * already inert — but refusing them keeps a stray `;` from ever being read as
 * intent. Parentheses, braces and globs stay available, because
 * `node -e "console.log(1)"` is an ordinary thing to run.
 */
const SHELL_OPERATORS = /[\n\r|;&`<>]/;

/**
 * Split a typed command into an argv array. Quotes are honoured so
 * `node -e "console.log('hi')"` survives; anything the shell would have acted
 * on is refused, because there is no shell here to act on it.
 */
function parseCommandLine(line) {
  const text = String(line == null ? "" : line).trim();
  if (!text) throw reject("Empty command.", 400);
  // Substitution is refused anywhere it appears, quoted or not. Nothing here
  // would expand it, but a string that only makes sense to a shell has no
  // business reaching a program the user is about to approve.
  if (text.includes("$(")) throw reject("Command substitution is not permitted.", 400);
  // A model leaves placeholders behind ("npm install <missing-dependency>"),
  // and < > are also redirection — so this used to be refused as if the user
  // had tried to pipe something. Name what is actually wrong.
  const placeholder = text.match(/<[^<>]{1,80}>/);
  if (placeholder) {
    throw reject(
      `"${placeholder[0]}" is a placeholder, not a name. Replace it with the real one before running — for example: npm install lodash.`,
      400,
    );
  }
  const tokens = [];
  let current = "";
  let started = false;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    // Only outside quotes does a shell operator mean anything; inside them it
    // is just part of an argument.
    if (SHELL_OPERATORS.test(character)) {
      throw reject("Pipes, redirection, substitutions and chaining are not permitted.", 400);
    }
    if (character === "$" && text[index + 1] === "(") {
      throw reject("Command substitution is not permitted.", 400);
    }
    if (character === "\"" || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += character;
    started = true;
  }
  if (quote) throw reject("That command has an unfinished quote.", 400);
  if (started) tokens.push(current);
  if (!tokens.length) throw reject("Empty command.", 400);
  return tokens;
}

/**
 * A path in a command has to stay where every other Work path stays. Checked
 * before approval, so a command that reaches outside is refused outright
 * rather than politely offered to the user.
 */
async function assertArgInsideRoot(root, arg) {
  const looksLikePath = arg.includes("/") || arg.includes("\\") || arg.startsWith(".");
  if (!looksLikePath) return;
  try {
    await resolveInsideRoot({ root, targetPath: arg, allowMissing: true });
  } catch {
    throw reject(`"${arg}" points outside the granted folder, so the command was not run.`, 400);
  }
}

/**
 * Run a command the user typed, inside the granted folder, with their say-so.
 *
 * Called twice: once to be told what would happen (403 with a preview), and
 * once more with approvalGranted to actually do it.
 */
async function runApprovedWorkCommand({ root: rootValue, command, approvalGranted, timeoutMs }) {
  const root = await canonicaliseRoot(rootValue);
  const tokens = parseCommandLine(command);
  const [program, ...args] = tokens;
  const entry = RUNNABLE_PROGRAMS[String(program || "").toLowerCase()];
  if (!entry) {
    throw reject(
      `"${program}" is not one of the programs Work can run. Allowed: ${Object.keys(RUNNABLE_PROGRAMS).join(", ")}. Read-only commands (cat, head, tail, git status/diff/log, ls, pwd) are always allowed.`,
      400,
    );
  }
  for (const arg of args) await assertArgInsideRoot(root, arg);

  if (approvalGranted !== true) {
    const error = reject(`Running "${tokens.join(" ")}" in ${root} needs your approval first. Nothing was run.`, 403);
    error.requiresApproval = true;
    error.preview = { tool: entry.file, args, cwd: root, note: entry.note, command: tokens.join(" ") };
    throw error;
  }

  const timeout = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let timedOut = false;

  try {
    const result = await execFileAsync(entry.file, args, {
      cwd: root,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      env: sanitisedEnv(),
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    stdout = String(result.stdout || "");
    stderr = String(result.stderr || "");
    exitCode = 0;
  } catch (error) {
    stdout = String(error?.stdout || "");
    stderr = String(error?.stderr || "");
    exitCode = typeof error?.code === "number" ? error.code : 1;
    timedOut = error?.killed === true || /ETIMEDOUT/.test(String(error?.code || ""));
    if (error?.code === "ENOENT") {
      throw reject(`"${entry.file}" is not installed on this machine, so that command cannot run.`, 400);
    }
  }

  const combined = [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : "");
  const trimmed = trimOutput(combined);
  return {
    command: tokens.join(" "),
    cwd: root,
    output: trimmed.output,
    truncated: trimmed.truncated,
    exitCode,
    timedOut,
    durationMs: Date.now() - startedAt,
    failureSignals: exitCode === 0 ? [] : extractFailureSignals(combined),
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  RUNNABLE_PROGRAMS,
  detectProjectCommands,
  runProjectCheck,
  runApprovedWorkCommand,
  parseCommandLine,
  sanitisedEnv,
  trimOutput,
};
