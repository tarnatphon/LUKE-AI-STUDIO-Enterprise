#!/usr/bin/env node
"use strict";

/**
 * "Why are there two llama-server processes, and which one is stale?"
 *
 * That question cost two rounds of this project's own debugging: an orphan
 * carrying --mmap on an exFAT volume sat next to a new process carrying
 * --no-mmap, `ps` showed both, and the fix looked broken. Three things spawn a
 * backend — the chat runtime, the arena pool, and a previous run that was killed
 * without its children — and only the first two can ever clean up after
 * themselves.
 *
 * /api/llm/processes answers it as data: what this process owns, with the flags
 * each was launched with, and what is running with no owner at all.
 *
 * Run: node scripts/validation/test-backend-inventory.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const inventoryModule = require(path.join(root, "scripts", "server", "llm-backend-inventory.cjs"));
const panelSource = fs.readFileSync(
  path.join(root, "app", "frontend", "src", "components", "PerformancePanel.jsx"),
  "utf8",
);

let checks = 0;
function assert(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(port) {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child;
    } catch {
      // not listening yet
    }
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error("The server never answered.");
}

async function main() {
  console.log("=== every llama-server on this machine, and whose it is ===\n");

  // ── reading a command line ────────────────────────────────────────────────
  const apfs = inventoryModule.parseBackendCommandLine(
    "/Volumes/ai/app/llm-backend/mac/arm64/llama-server --model /Users/ekky/models/qwen2.5-coder-14b.gguf "
    + "--port 10086 --ctx-size 20000 --n-gpu-layers -1 --mmap",
  );
  assert(apfs.model === "qwen2.5-coder-14b.gguf", "the model name is read from --model");
  assert(apfs.port === 10086, "the port is read");
  assert(apfs.contextSize === 20000 && apfs.gpuLayers === -1, "and the sizes, negative layer counts included");
  assert(apfs.mmapFlag === "--mmap", "an explicit --mmap is reported as such");

  const exfat = inventoryModule.parseBackendCommandLine("llama-server -m /Volumes/AI/x.gguf --no-mmap");
  assert(exfat.mmapFlag === "--no-mmap", "so is --no-mmap, and -m is understood as --model");

  const silent = inventoryModule.parseBackendCommandLine("llama-server --model /x/y.gguf --port 28201");
  assert(silent.mmapFlag === null, "a command line that says nothing about mmap reports null, not false");
  assert(inventoryModule.parseBackendCommandLine("").model === "", "an empty command line does not throw");

  // ── whose backend is whose ────────────────────────────────────────────────
  const merged = inventoryModule.inventory({
    tracked: [{ pid: 111, owner: "chat", model: "qwen.gguf", mmapFlag: "--no-mmap", alive: true }],
    system: [
      { pid: 111, command: "llama-server --model /x/qwen.gguf --no-mmap" },
      { pid: 222, command: "llama-server --model /x/gemma.gguf --port 28201 --mmap" },
    ],
  });
  assert(merged.processes.length === 1 && merged.processes[0].orphan === false, "a tracked backend is listed as owned");
  assert(merged.orphans.length === 1 && merged.orphans[0].pid === 222, "an untracked one is listed as an orphan");
  assert(merged.orphans[0].mmapFlag === "--mmap" && merged.orphans[0].port === 28201,
    "and the orphan is described by its own command line");
  assert(merged.count === 2, "the count covers both");
  assert(inventoryModule.inventory({ tracked: [], system: [] }).count === 0, "an idle machine is empty, not undefined");

  // ── the endpoint ─────────────────────────────────────────────────────────
  const port = await freePort();
  const child = await startServer(port);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/llm/processes`);
    const data = await response.json();
    assert(response.status === 200 && data.ok === true, "/api/llm/processes answers");
    assert(Array.isArray(data.processes) && Array.isArray(data.orphans), "with both lists, always arrays");
    assert(typeof data.count === "number", "and a count");
    // A real process whose argv[0] is llama-server must be seen, not inferred
    // from bookkeeping: that is the whole point of asking the operating system.
    if (process.platform !== "win32") {
      const fake = spawn("bash", ["-c", 'exec -a llama-server sleep 25']);
      try {
        await delay(600);
        const live = await (await fetch(`http://127.0.0.1:${port}/api/llm/processes`)).json();
        const seen = (live.orphans || []).find((orphan) => Number(orphan.pid) === Number(fake.pid));
        assert(Boolean(seen), "a process named llama-server that nobody owns shows up as an orphan",
          `pid ${fake.pid} not in ${JSON.stringify((live.orphans || []).map((o) => o.pid))}`);
        assert(seen?.owner === "orphan" && seen?.orphan === true, "and is labelled as one");
      } finally {
        fake.kill("SIGKILL");
      }
    }
  } finally {
    child.kill("SIGKILL");
  }

  // ── the panel shows it ───────────────────────────────────────────────────
  assert(/fetch\("\/api\/llm\/processes"\)/.test(panelSource), "the performance panel asks for the inventory");
  assert(/backends\?\.orphans\?\.length > 0/.test(panelSource), "and says when something was left behind");
  assert(panelSource.includes("pkill -f llama-server"), "with the command that fixes it");

  console.log(`\nPASS: ${checks} checks — every backend has an owner, or is called stale.`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
