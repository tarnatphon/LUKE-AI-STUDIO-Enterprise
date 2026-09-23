#!/usr/bin/env node
"use strict";

/**
 * The local API is not open to every website the user visits.
 *
 * Every answer carried `Access-Control-Allow-Origin: *`, and the preflight
 * handler answered 204 with Allow-Headers: Content-Type and Allow-Methods:
 * GET,POST for any Origin on any path. Measured against a running server:
 *
 *   OPTIONS /api/restart-backend
 *   Origin: https://evil.example
 *     → 204, Access-Control-Allow-Origin: *
 *
 * so a page the user merely opened could preflight, POST JSON to the local API,
 * and read the answer back — restart backends, change settings, drive the chat
 * and Work endpoints.
 *
 * The interface is served by this same server, so it is same-origin and needs
 * no CORS header at all. The endpoints that do are the compatibility ones
 * third-party image tools call: /v1/, /sdapi/ and /tts-outputs/. Those keep the
 * wildcard, and this suite asserts that they do, so tightening this cannot
 * quietly break them.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");

const FOREIGN_ORIGIN = "https://evil.example";

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-cors-"));
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
  console.log("\n=== Cross-origin access is limited to the compatibility endpoints ===\n");

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

    const allowOrigin = (response) => response.headers.get("access-control-allow-origin");

    const preflight = (target) =>
      fetch(`${baseUrl}${target}`, {
        method: "OPTIONS",
        headers: {
          Origin: FOREIGN_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

    // ── the management API must refuse a foreign origin ─────────────────────
    const apiTargets = [
      "/api/restart-backend",
      "/api/health",
      "/api/llm/model-settings",
      "/api/text-runtime/remote-provider/key",
      "/api/image-to-video/generate",
      "/api/storage/lifecycle/plan",
    ];

    const openPreflights = [];
    for (const target of apiTargets) {
      const response = await preflight(target);
      if (allowOrigin(response)) openPreflights.push(`${target} → ${allowOrigin(response)}`);
    }

    if (openPreflights.length) console.log(`    open: ${openPreflights.join(" | ")}`);

    assert(
      openPreflights.length === 0,
      `No preflight on ${apiTargets.length} API routes grants a foreign origin (${openPreflights.length} did).`
    );

    const read = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: FOREIGN_ORIGIN },
    });
    assert(read.status === 200, `The API still answers a plain request (${read.status}).`);
    assert(
      !allowOrigin(read),
      "and without Allow-Origin, so a foreign page cannot read the answer."
    );

    const page = await fetch(`${baseUrl}/`, { headers: { Origin: FOREIGN_ORIGIN } });
    assert(page.status === 200, `The interface still loads (${page.status}).`);
    assert(!allowOrigin(page), "and is not readable cross-origin either.");

    // ── the compatibility endpoints must stay open ──────────────────────────
    const openTargets = ["/v1/models", "/sdapi/v1/sd-models", "/tts-outputs/anything.wav"];

    const closed = [];
    for (const target of openTargets) {
      const response = await preflight(target);
      if (!allowOrigin(response)) closed.push(target);
    }

    assert(
      closed.length === 0,
      `The compatibility endpoints still allow cross-origin calls for third-party tools (${closed.length} no longer do).`
    );

    const ttsPreflight = await preflight("/tts-outputs/anything.wav");
    assert(
      (ttsPreflight.headers.get("access-control-allow-headers") || "").includes("Content-Type"),
      "and still advertise Content-Type, so a JSON body survives the preflight."
    );

    // ── same-origin use is untouched ────────────────────────────────────────
    const sameOrigin = await fetch(`${baseUrl}/api/llm/model-settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert(
      sameOrigin.status === 400 || sameOrigin.status === 200,
      `A same-origin POST is still handled, not blocked (${sameOrigin.status}).`
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of it.");

    console.log("\n  PASS: Cross-origin access is limited to the compatibility endpoints completed.\n");
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
