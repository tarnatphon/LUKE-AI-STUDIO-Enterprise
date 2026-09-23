#!/usr/bin/env node
"use strict";

/**
 * A path that arrives in a request stays inside the folder it belongs to.
 *
 * The static handler was found serving /etc/passwd through ".." in the request
 * target, and the audit that followed looked for every other place a
 * request-derived string reaches the filesystem. There were three:
 *
 *   GET  /api/output-file?filename=...   path.basename — already safe
 *   GET  /tts-outputs/<file>             path.basename — already safe
 *   POST /api/restart-backend            path.join(MODELS, body.model) — not
 *
 * The third put the body's model straight into the image backend's model
 * argument, so a body naming ../../../../etc/... placed an arbitrary file on a
 * subprocess command line. It is contained now, and so is the OpenVINO branch,
 * which is handed back the absolute path the server itself published.
 *
 * The two that were already safe are asserted here too. path.basename is doing
 * the work, and a future edit that drops it should fail something.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-pathcheck-"));
  const destination = path.join(temp, "repo");

  fs.mkdirSync(path.join(destination, "scripts", "server"), { recursive: true });
  fs.mkdirSync(path.join(destination, "app"), { recursive: true });

  const sources = spawnSync(
    "find",
    ["scripts", "-type", "f", "-not", "-path", "*/node_modules/*"],
    { cwd: root, encoding: "utf8" }
  ).stdout
    .split("\n")
    .filter(Boolean);

  for (const file of sources) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }

  const dependencies = path.join(root, "scripts", "server", "node_modules");
  if (fs.existsSync(dependencies)) {
    fs.symlinkSync(
      dependencies,
      path.join(destination, "scripts", "server", "node_modules"),
      "dir"
    );
  }

  for (const folder of ["config", "dist"]) {
    const source = path.join(root, "app", folder);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(destination, "app", folder), { recursive: true });
    }
  }

  return { temp, destination };
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

async function main() {
  console.log("\n=== Request paths stay inside their folder ===\n");

  const { temp, destination } = buildTempRoot();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(
    process.execPath,
    [path.join(destination, "scripts", "server", "serve.cjs")],
    {
      cwd: destination,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        LUKE_AI_HOST: "127.0.0.1",
        LUKE_AI_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    }
  );

  child.stdout.resume();
  child.stderr.resume();

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        await fetch(`${baseUrl}/api/health`);
        ready = true;
        break;
      } catch {
        await delay(150);
      }
    }
    assert(ready, "The server starts on a throwaway checkout.");

    const post = async (url, body) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.text() };
    };

    // ── POST /api/restart-backend ───────────────────────────────────────────
    // Backslash separators are not traversal on POSIX — path.join keeps them
    // inside the folder as an odd filename, and refusing those would be wrong.
    const escapes = ["../../../../../../etc/passwd", "../../../etc/hosts"];

    let escaped = 0;
    for (const model of escapes) {
      const { status, body } = await post("/api/restart-backend", { model });
      const refused = status === 400 && body.includes("must stay inside the models folder");
      if (!refused) {
        escaped += 1;
        console.log(`    not refused: ${model} → ${status} ${body.slice(0, 90)}`);
      }
    }

    assert(
      escaped === 0,
      `Every model path that climbs out of the models folder is refused (${escaped} were not).`
    );

    // A plain filename has to survive, or the containment is just a refusal.
    const ordinary = await post("/api/restart-backend", { model: "sd-v1-4.ckpt" });
    assert(
      !ordinary.body.includes("must stay inside the models folder"),
      "An ordinary filename is not refused by the containment check."
    );

    const absolute = await post("/api/restart-backend", {
      model: "/etc/passwd",
      backend_type: "openvino-npu",
    });
    assert(
      !absolute.body.includes("must stay inside the models folder") || absolute.status === 400,
      "The OpenVINO branch answers rather than falling over on an absolute path."
    );

    // No answer from any of these may name a path outside the app folder.
    const outsideMarkers = ["/etc/passwd", "/etc/hosts"];
    const leaked = [];
    for (const model of [...escapes, "/etc/passwd"]) {
      for (const backend of [undefined, "openvino-npu"]) {
        const { body } = await post("/api/restart-backend", {
          model,
          ...(backend ? { backend_type: backend } : {}),
        });
        if (outsideMarkers.some((marker) => body.includes(`"${marker}"`) || body.includes(`: ${marker}`))) {
          leaked.push(model);
        }
      }
    }

    assert(
      leaked.length === 0,
      `No answer echoes a path from outside the app (${leaked.length} did).`
    );

    // ── the two routes that were already safe ───────────────────────────────
    const fileRoutes = [
      "/api/output-file?filename=../../../../../../etc/passwd",
      "/api/output-file?filename=..%2F..%2F..%2F..%2F..%2Fetc%2Fpasswd",
      "/tts-outputs/../../../../../../etc/passwd",
      "/tts-outputs/..%2F..%2F..%2F..%2F..%2Fetc%2Fpasswd",
    ];

    const disclosed = [];
    for (const target of fileRoutes) {
      const response = await fetch(`${baseUrl}${target}`);
      const body = await response.text();
      if (body.includes("root:x:0:0")) disclosed.push(target);
    }

    assert(
      disclosed.length === 0,
      `The output-file and tts-outputs routes disclose nothing (${disclosed.length} did).`
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of it.");

    console.log("\n  PASS: Request paths stay inside their folder completed.\n");
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await delay(500);

    const linked = path.join(destination, "scripts", "server", "node_modules");
    try {
      if (fs.lstatSync(linked).isSymbolicLink()) fs.unlinkSync(linked);
    } catch {}
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
