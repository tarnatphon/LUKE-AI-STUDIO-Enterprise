#!/usr/bin/env node
"use strict";

/**
 * The process survives a throw that nothing caught.
 *
 * Node ends the process on an uncaught exception or an unhandled rejection. One
 * route that threw where no handler caught it — POST /api/assets, with a body it
 * did not recognise — was enough to close LUKE AI STUDIO down entirely, for
 * every open conversation. The request handler has its own catch now, but a
 * stray throw in a five-second poller or a stream callback reaches none of it,
 * so serve.cjs installs a net at process level too.
 *
 * This proves that net against the real server, not a model of it: the server is
 * started with `--require` of a probe that fires an unhandled rejection and then
 * an uncaught exception into the same process once it is up. If the handlers are
 * there, the app keeps answering. If they are removed, the process is gone and
 * the health check fails — which is the mutation this suite exists to catch.
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Loaded into the server's own process before serve.cjs runs, and fires later,
 * so by then the handlers under test are installed. Nothing here touches the
 * application's state: the point is only that the throw reaches Node uncaught.
 */
const PROBE_SOURCE = `
"use strict";
setTimeout(() => {
  Promise.reject(new Error("LUKE-PROBE-UNHANDLED-REJECTION"));
}, 1200);
setTimeout(() => {
  setTimeout(() => {
    throw new Error("LUKE-PROBE-UNCAUGHT-EXCEPTION");
  });
}, 2600);
`;

async function health(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
    return response.status;
  } catch {
    return 0;
  }
}

async function main() {
  console.log("\n=== Process crash resilience ===\n");

  // No assertion here that merely greps serve.cjs for `process.on(`. Whether
  // the string is in the file says nothing about whether Node is stopped; only
  // throwing into the running process does.

  const probeFile = path.join(os.tmpdir(), `luke-crash-probe-${process.pid}.cjs`);
  fs.writeFileSync(probeFile, PROBE_SOURCE);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ["--require", probeFile, serverFile], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      LUKE_AI_HOST: "127.0.0.1",
      LUKE_AI_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString("utf8");
  });

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  try {
    let before = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      before = await health(baseUrl);
      if (before === 200) break;
      await delay(150);
    }

    assert(before === 200, "The server answers /api/health before the probe fires.");
    assert(exited === null, "The process is alive before the probe fires.");

    // Let both probe timers run: the rejection at 1.2s, the exception at 2.6s.
    await delay(5000);

    // Each is asserted against the guard's own wording, not just against the
    // probe's message: Node prints an unhandled rejection on its way out too,
    // so the message appearing proves nothing on its own.
    assert(
      /\[fatal-guard\] Unhandled rejection[\s\S]*LUKE-PROBE-UNHANDLED-REJECTION/.test(log),
      "The unhandled rejection was caught by the guard, not by Node on its way out."
    );
    assert(
      /\[fatal-guard\] Uncaught exception[\s\S]*LUKE-PROBE-UNCAUGHT-EXCEPTION/.test(log),
      "The uncaught exception was caught by the guard, not by Node on its way out."
    );
    assert(
      exited === null,
      `The process is still running after both (exit: ${exited ? JSON.stringify(exited) : "none"}).`
    );

    const after = await health(baseUrl);
    assert(after === 200, `The server still answers /api/health afterwards (got ${after}).`);

    // And it can still do real work, not just answer a liveness probe.
    const response = await fetch(`${baseUrl}/api/runtime/dependencies`, {
      signal: AbortSignal.timeout(8000),
    });
    assert(
      response.status === 200,
      `A real endpoint still works after the throws (got ${response.status}).`
    );

    console.log("\n  PASS: Process crash resilience completed.\n");
  } finally {
    child.kill("SIGKILL");
    await delay(300);
    fs.rmSync(probeFile, { force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
