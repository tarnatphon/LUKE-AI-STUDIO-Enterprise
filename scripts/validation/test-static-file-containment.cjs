#!/usr/bin/env node
"use strict";

/**
 * The static file handler serves the built frontend and nothing else.
 *
 * `req.url` is the raw request target. The handler passed it straight to
 * path.join against the dist folder, and path.resolve walks ".." out of it, so
 *
 *   GET /../../../../../etc/passwd
 *
 * answered 200 with the machine's password file. A canary written outside the
 * build came back verbatim through the same route. Neither is theoretical: both
 * were measured against a running server before the containment check was added.
 * On a local desktop app that still hands any process on the machine — and
 * anything that can reach the port — a read primitive over the whole disk.
 *
 * This also covers static serving generally, which nothing did: the entry point,
 * the fingerprinted bundles with their MIME types, and the single-page fallback.
 * If any of those break the user gets a blank window and no error.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A throwaway checkout, so booting the server cannot touch the real one. */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-static-"));
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
  console.log("\n=== Static files stay inside the build ===\n");

  const { temp, destination } = buildTempRoot();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  // A secret outside the served tree, with a marker that cannot occur in the
  // frontend by accident.
  const secret = "LUKE-STATIC-CONTAINMENT-CANARY";
  const outside = path.join(temp, "outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "canary.txt"), `${secret}\n`);

  // Enough ".." to climb out of <repo>/app/dist to the filesystem root, and then
  // some; extra segments at the root change nothing.
  const escape = "../".repeat(path.resolve(destination, "app", "dist").split(path.sep).length + 2);

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

    const attempts = [
      `/${escape}${path.relative("/", path.join(outside, "canary.txt")).split(path.sep).join("/")}`,
      `/${escape}etc/passwd`,
      `/${escape}etc/hosts`,
      `/..%2f..%2f..%2f..%2f..%2f..%2fetc/passwd`,
      `/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd`,
    ];

    // Not fetch: the WHATWG URL parser resolves ".." before the request is
    // sent, so a fetch-based check never reaches the server with the escape
    // still in it and passes against a vulnerable server. http.request with an
    // explicit path sends it verbatim, which is what curl --path-as-is does.
    const rawGet = (target) =>
      new Promise((resolve) => {
        const request = http.request(
          { host: "127.0.0.1", port, path: target, method: "GET" },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () => resolve({ status: response.statusCode, body }));
          }
        );
        request.on("error", () => resolve({ status: 0, body: "" }));
        request.end();
      });

    const leaked = [];
    for (const target of attempts) {
      const { status, body } = await rawGet(target);
      if (body.includes(secret) || body.includes("root:x:0:0")) {
        leaked.push(`${target} → ${status}`);
      }
    }

    if (leaked.length) console.log(`  leaked: ${leaked.join(" | ")}`);

    assert(
      leaked.length === 0,
      `None of ${attempts.length} escapes out of the build served a file from outside it.`
    );

    // ── what static serving has to keep doing ───────────────────────────────
    const index = await fetch(`${baseUrl}/`);
    const indexBody = await index.text();

    assert(index.status === 200, `GET / answers 200 (got ${index.status}).`);
    assert(
      (index.headers.get("content-type") || "").includes("text/html"),
      `and calls it HTML (${index.headers.get("content-type")}).`
    );
    assert(
      indexBody.includes("<div id=\"root\"") || indexBody.includes("<!doctype html"),
      "and the body is the built page, not the fallback for a missing file."
    );

    const bundle = (indexBody.match(/assets\/[A-Za-z0-9._-]+\.js/) || [])[0];
    const sheet = (indexBody.match(/assets\/[A-Za-z0-9._-]+\.css/) || [])[0];

    assert(Boolean(bundle) && Boolean(sheet), "index.html names a script bundle and a stylesheet.");

    const js = await fetch(`${baseUrl}/${bundle}`);
    assert(js.status === 200, `The entry bundle loads (${js.status}).`);
    assert(
      (js.headers.get("content-type") || "").includes("javascript"),
      `as JavaScript, so the browser runs it (${js.headers.get("content-type")}).`
    );
    assert(
      (js.headers.get("cache-control") || "").includes("immutable"),
      "and fingerprinted bundles are cacheable forever."
    );

    const css = await fetch(`${baseUrl}/${sheet}`);
    assert(css.status === 200, `The stylesheet loads (${css.status}).`);
    assert(
      (css.headers.get("content-type") || "").includes("text/css"),
      `as CSS (${css.headers.get("content-type")}).`
    );

    const deep = await fetch(`${baseUrl}/settings/something/deep`);
    assert(
      deep.status === 200 && (await deep.text()).includes("<!doctype html"),
      "An unknown path inside the app falls back to the page, so client routes work."
    );

    const health = await fetch(`${baseUrl}/api/health`);
    assert(health.status === 200, `The API still answers underneath it (${health.status}).`);

    console.log("\n  PASS: Static files stay inside the build completed.\n");
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
