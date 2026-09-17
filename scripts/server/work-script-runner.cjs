"use strict";

/**
 * A script the user pasted, run without a shell.
 *
 * The Work Terminal takes one command at a time, so a pasted script used to be
 * met with a paragraph explaining where else to put it — which is no answer at
 * all when what the user wants is to see the thing run.
 *
 * So it runs: written into the granted folder, executed by one of the same
 * programs the terminal already allows, and deleted afterwards. Three things
 * stay true while it does:
 *
 * - No shell. The interpreter is given one argument — the file — so nothing in
 *   the script is ever re-read as command syntax.
 * - The file lives inside the granted folder, resolved by the same guard every
 *   other Work path goes through. It is created, run and removed; leaving it
 *   behind would quietly add files to the user's project.
 * - It asks first. A script runs with the user's access, which reaches further
 *   than the granted folder, so nothing runs until they say so.
 *
 * Scripts that belong in the project — a new file, a change to an existing one
 * — still belong with Work Chat, which keeps a backup the user can undo.
 */

const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { canonicaliseRoot, resolveInsideRoot, createHttpError } = require("./work-path-guard.cjs");
const { sanitisedEnv, trimOutput } = require("./work-command-runner.cjs");

const execFileAsync = promisify(execFile);

/** Where a script waits out its own execution, inside the granted folder. */
const SCRIPT_FOLDER = ".luke-run";
const MAX_SCRIPT_CHARS = 200000;
const DEFAULT_TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 600000;
const PREVIEW_LINES = 8;

/**
 * The interpreters a pasted script may run under. Deliberately a subset of the
 * programs the terminal already allows: no shell, and nothing that reads its
 * instructions from a string.
 */
const SCRIPT_INTERPRETERS = {
  node: { file: "node", extension: "js", label: "node" },
  python3: { file: "python3", extension: "py", label: "python3" },
  python: { file: "python", extension: "py", label: "python" },
  bun: { file: "bun", extension: "js", label: "bun" },
  deno: { file: "deno", extension: "ts", label: "deno" },
};

function reject(message, statusCode = 400) {
  return createHttpError(message, statusCode);
}

/**
 * Which interpreter to use: the one asked for, else the one the script names,
 * else the language it is written in.
 */
function chooseInterpreter(requested, code) {
  const asked = String(requested || "").trim().toLowerCase();
  if (asked && asked !== "auto") {
    if (!SCRIPT_INTERPRETERS[asked]) {
      throw reject(
        `"${asked}" cannot run a script here. Allowed: ${Object.keys(SCRIPT_INTERPRETERS).join(", ")}.`,
        400,
      );
    }
    return asked;
  }

  const firstLine = String(code || "").split(/\r?\n/, 1)[0] || "";
  const shebang = firstLine.match(/^#!\s*(?:\/usr\/bin\/env\s+)?([\w.-]+)/);
  const named = shebang ? path.basename(shebang[1]).toLowerCase() : "";
  if (SCRIPT_INTERPRETERS[named]) return named;

  const python = (String(code).match(/^\s*(?:def |class |import \w|from \w+ import |print\()/gm) || []).length
    + (/\b(?:elif|None|True|False|self)\b/.test(code) ? 1 : 0);
  const javascript = (String(code).match(/\b(?:const|let|var|function|require\(|module\.exports|=>|console\.(?:log|error|warn))\b/g) || []).length;
  if (python > javascript) return "python3";
  return "node";
}

/**
 * A program, or notes about one?
 *
 * The server is what would run this, so it makes the final call. The model
 * writes "# Update tasks" above a tool call and lists plans as markdown; both
 * arrive in a ```code block, and handing either to node is a syntax error —
 * an answer that tells the user nothing they can act on.
 */
function looksLikeCode(script) {
  const lines = String(script == null ? "" : script)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
  if (lines.length === 0) return false;
  const body = lines.join("\n");

  // A tool call is data: it may look like an object, and node would still
  // refuse it as a program.
  try {
    JSON.parse(body);
    return false;
  } catch {}

  // Headings, bullets and checkbox lists: a plan, not a program.
  if (lines.every((line) => /^(?:#{1,6}\s|[-*+]\s|\[[ xX]\]|\d+[.)]\s|>\s)/.test(line))) return false;

  return /[=;(){}[\]]/.test(body)
    || /^\s*(?:const|let|var|function|return|if|for|while|class|def|print|import|from|export|module|require|console|async|await)\b/m.test(body);
}

async function runWorkScript({ root: rootValue, code, interpreter, approvalGranted, timeoutMs }) {
  const script = String(code == null ? "" : code).replace(/\s+$/, "");
  if (!script.trim()) throw reject("There is nothing to run.", 400);
  if (script.length > MAX_SCRIPT_CHARS) {
    throw reject(`That script is ${script.length} characters; the most this will run is ${MAX_SCRIPT_CHARS}.`, 400);
  }
  // Checked before anything is offered or written: a block of notes is not a
  // failed script, it is not a script at all.
  if (!looksLikeCode(script)) {
    throw reject("There is no program in that block — it reads like notes. Nothing was run.", 400);
  }

  const chosen = chooseInterpreter(interpreter, script);
  const entry = SCRIPT_INTERPRETERS[chosen];
  const fileName = `luke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${entry.extension}`;
  const relative = `${SCRIPT_FOLDER}/${fileName}`;
  // The one path this module writes goes through the same guard as every other
  // Work path, so a script cannot be aimed at a folder the user never granted.
  const resolved = await resolveInsideRoot({ root: rootValue, targetPath: relative, allowMissing: true });
  const root = resolved.realRoot;
  const scriptPath = resolved.targetPath;
  const lines = script.split(/\r?\n/).length;

  if (approvalGranted !== true) {
    const error = reject(`Running this script (${lines} lines, ${chosen}) in ${root} needs your approval first. Nothing was run.`, 403);
    error.requiresApproval = true;
    error.preview = {
      tool: entry.file,
      args: [scriptPath],
      cwd: root,
      note: "a script runs with your access, so it can change files outside this folder too",
      command: `${entry.file} ${relative}`,
      interpreter: chosen,
      lines,
      script: script.split(/\r?\n/).slice(0, PREVIEW_LINES).join("\n"),
    };
    throw error;
  }

  await fsp.mkdir(path.dirname(scriptPath), { recursive: true });
  await fsp.writeFile(scriptPath, `${script}\n`, "utf8");

  const timeout = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let timedOut = false;

  try {
    const result = await execFileAsync(entry.file, [scriptPath], {
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
      throw reject(`"${entry.file}" is not installed on this machine, so the script cannot run.`, 400);
    }
  } finally {
    // The file was only ever a way to run the code. Leaving it behind would
    // quietly add files to the user's project.
    await fsp.rm(scriptPath, { force: true }).catch(() => {});
    await fsp.rmdir(path.dirname(scriptPath)).catch(() => {});
  }

  const combined = [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : "");
  const trimmed = trimOutput(combined);
  return {
    command: `${entry.file} ${relative}`,
    interpreter: chosen,
    cwd: root,
    output: trimmed.output || "(no output)",
    truncated: trimmed.truncated,
    exitCode,
    timedOut,
    durationMs: Date.now() - startedAt,
    failureSignals: exitCode === 0 ? [] : combined.split(/\r?\n/).filter((line) => /\b(?:Error|error|FAIL|failed|Traceback)\b/.test(line)).slice(0, 25).map((line) => line.trim().slice(0, 300)),
  };
}

module.exports = {
  MAX_SCRIPT_CHARS,
  SCRIPT_FOLDER,
  SCRIPT_INTERPRETERS,
  chooseInterpreter,
  looksLikeCode,
  runWorkScript,
};
