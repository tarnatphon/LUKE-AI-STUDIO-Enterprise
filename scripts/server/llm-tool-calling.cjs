"use strict";

/**
 * One llama.cpp flag decides whether an offline coding agent works at all.
 *
 * Claude Code, OpenCode and every other agent in this class edit files by
 * *calling tools*. llama-server only honours the `tools` array when it renders
 * the prompt with the model's own chat template — that is what `--jinja` turns
 * on. Without the flag the request is accepted and answered in prose: the agent
 * can read, it can talk, it just never calls a tool, so it never writes a file.
 * The failure looks like a weak model, not a missing flag.
 *
 * Passing the flag unconditionally is not safe either. Trimmed or older backend
 * builds reject unknown arguments and exit before loading the model, which
 * would leave the whole Text workspace dead. So the build is asked first:
 * `llama-server --help` lists every parameter it understands, and `--jinja`
 * only goes on the command line when it is in that list.
 *
 * The answer is cached per binary path (the probe costs one short process), and
 * `LUKE_LLM_NO_JINJA=1` turns it off for a model whose template misbehaves.
 *
 * See docs/beta7/offline-coding-agents.md.
 */

const { spawnSync } = require("node:child_process");

/** binaryPath -> the help text it printed (or "" when it could not be read). */
const helpCache = new Map();

function readHelp(binaryPath) {
  if (!binaryPath) return "";
  try {
    const result = spawnSync(binaryPath, ["--help"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    // llama.cpp prints usage on stdout on some builds, stderr on others.
    return `${result.stdout || ""}${result.stderr || ""}`;
  } catch (_) {
    return "";
  }
}

function helpFor(binaryPath) {
  if (!binaryPath) return "";
  if (!helpCache.has(binaryPath)) helpCache.set(binaryPath, readHelp(binaryPath));
  return helpCache.get(binaryPath);
}

/** True when this build advertises the flag. `helpText` lets tests skip the spawn. */
function supportsJinja(binaryPath, helpText) {
  const text = typeof helpText === "string" ? helpText : helpFor(binaryPath);
  return /--jinja\b/.test(text);
}

/**
 * Arguments to append to llama-server's command line.
 *
 * @param {{binaryPath?: string, helpText?: string, enabled?: boolean}} options
 * @returns {string[]} `["--jinja"]`, or `[]` when the build or the user says no.
 */
function toolCallingArgs(options = {}) {
  const { binaryPath = "", helpText, enabled = true } = options;
  if (!enabled) return [];
  if (process.env.LUKE_LLM_NO_JINJA === "1") return [];
  return supportsJinja(binaryPath, helpText) ? ["--jinja"] : [];
}

function clearCache() {
  helpCache.clear();
}

module.exports = {
  supportsJinja,
  toolCallingArgs,
  clearCache,
};
