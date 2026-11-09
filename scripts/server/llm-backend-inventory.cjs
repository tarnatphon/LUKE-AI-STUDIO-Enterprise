"use strict";

/**
 * Every llama-server on this machine, and which of them only this process knows
 * about.
 *
 * Three independent things spawn a backend: the chat runtime, the arena pool,
 * and — historically — whatever was left behind when the server was killed
 * without its children. The third kind is the one that ruins an afternoon: an
 * orphan carrying `--mmap` on an exFAT volume sits next to a new process
 * carrying `--no-mmap`, `ps` shows both, and the fix looks broken.
 *
 * So the inventory is deliberately two lists, not one: what this process is
 * running (with the flags it was launched with) and what is running without an
 * owner. A stale backend is then a fact with a pid, not a suspicion.
 */

const path = require("node:path");

/**
 * What a llama-server command line says about itself.
 *
 * `mmapFlag` is the flag as typed, not a boolean: `null` means the command line
 * said nothing, and llama.cpp's own default is mmap *on*. Collapsing that to
 * `false` would blame the user for a default they never chose.
 */
function parseBackendCommandLine(command) {
  const tokens = String(command || "").split(/\s+/).filter(Boolean);
  const valueOf = (...flags) => {
    for (const flag of flags) {
      const index = tokens.indexOf(flag);
      if (index >= 0 && tokens[index + 1] !== undefined) return tokens[index + 1];
    }
    return null;
  };
  const number = (value) => {
    const parsed = Number(value);
    return value === null || value === "" || !Number.isFinite(parsed) ? null : parsed;
  };
  const modelPath = valueOf("--model", "-m");
  return {
    model: modelPath ? path.basename(modelPath) : "",
    port: number(valueOf("--port")),
    contextSize: number(valueOf("--ctx-size", "-c")),
    gpuLayers: number(valueOf("--n-gpu-layers", "-ngl")),
    mmapFlag: tokens.includes("--no-mmap") ? "--no-mmap" : tokens.includes("--mmap") ? "--mmap" : null,
  };
}

/**
 * Merge what this process tracks with what the operating system reports.
 *
 * A tracked pid is never an orphan, even before the OS list catches up; an
 * untracked one always is, because nothing in this process will ever clean it
 * up.
 */
function inventory({ tracked = [], system = [] } = {}) {
  const processes = tracked.map((entry) => ({ orphan: false, ...entry }));
  const trackedPids = new Set(
    processes.map((entry) => Number(entry.pid)).filter((pid) => Number.isFinite(pid) && pid > 0),
  );
  const orphans = [];
  for (const entry of system) {
    const pid = Number(entry.pid);
    if (!pid || trackedPids.has(pid)) continue;
    orphans.push({
      pid,
      owner: "orphan",
      orphan: true,
      alive: true,
      ...parseBackendCommandLine(entry.command),
      command: String(entry.command || "").slice(0, 400),
    });
  }
  return { processes, orphans, count: processes.length + orphans.length };
}

module.exports = { parseBackendCommandLine, inventory };
