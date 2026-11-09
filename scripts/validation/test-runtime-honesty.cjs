#!/usr/bin/env node
"use strict";

/**
 * "It failed and said something unhelpful."
 *
 * Two payloads existed but kept their most useful sentence to themselves:
 *
 *  - /api/llm/status described the mmap *preference*, so Settings could show a
 *    switch that no longer described the process — an exFAT volume forces
 *    --no-mmap while the preference stays true.
 *  - a refused model load reported "not enough memory" and nothing about why
 *    the governor could not free anything, so the useful half of that sentence
 *    only ever reached the server's terminal.
 *
 * This suite pins both: what the app asked for, what it actually did, and why.
 *
 * Run: node scripts/validation/test-runtime-honesty.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const serveSource = fs.readFileSync(serverFile, "utf8");
const panelSource = fs.readFileSync(
  path.join(root, "app", "frontend", "src", "components", "PerformancePanel.jsx"),
  "utf8",
);
const governorCardSource = fs.readFileSync(
  path.join(root, "app", "frontend", "src", "components", "GovernorSettingsCard.jsx"),
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
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return child;
    } catch {
      // not listening yet
    }
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error("The server never answered.");
}

async function main() {
  console.log("=== the app says what it did, and why ===\n");

  const port = await freePort();
  const child = await startServer(port);
  try {
    // ── the mmap outcome, not the mmap preference ─────────────────────────
    const status = await (await fetch(`http://127.0.0.1:${port}/api/llm/status`)).json();
    const mmap = status.mmap;
    assert(Boolean(mmap), "/api/llm/status carries an mmap block");
    for (const key of ["requested", "effective", "reason", "filesystem", "loaded"]) {
      assert(Object.prototype.hasOwnProperty.call(mmap, key), `and it has "${key}"`);
    }
    assert(typeof mmap.requested === "boolean" && typeof mmap.effective === "boolean",
      "requested and effective are booleans, not prose");
    assert(mmap.loaded === false || mmap.requested === mmap.effective,
      "a loaded model's effective value is the one it was launched with");

    // ── the refusal explains itself ───────────────────────────────────────
    const governor = await (await fetch(`http://127.0.0.1:${port}/api/resource-governor`)).json();
    const governorStatus = governor.result?.status || {};
    assert(Object.prototype.hasOwnProperty.call(governorStatus, "lastRefusal"),
      "/api/resource-governor publishes lastRefusal, even when it is null");

    assert(/Nothing could be freed: \$\{governorReason\}/.test(serveSource),
      "a refused load says what the governor tried, not only how much memory was missing");
    assert(/resourceGovernorStatus\.lastRefusal = refusal/.test(serveSource),
      "and the refusal is remembered for the Settings card");
    assert(/error\.governor = refusal/.test(serveSource),
      "and travels with the error, so a caller does not have to parse the sentence");
    assert(/lastMmapDecision = \{/.test(serveSource),
      "the launched mmap decision is recorded rather than re-derived");

    // ── both surfaces show it ─────────────────────────────────────────────
    assert(/fetch\("\/api\/llm\/status"\)/.test(panelSource),
      "the performance panel reads the runtime status");
    assert(/mmapStatus\?\.requested/.test(panelSource) && /mmapOverridden/.test(panelSource),
      "and says when the volume overruled the preference");
    assert(/status\.refusal &&/.test(governorCardSource) && /lastRefusal/.test(governorCardSource),
      "the governor card shows the last refusal with its reason");
  } finally {
    child.kill("SIGKILL");
  }

  console.log(`\nPASS: ${checks} checks — the app reports what it did, and why.`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
