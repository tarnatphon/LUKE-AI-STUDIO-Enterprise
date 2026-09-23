#!/usr/bin/env node
"use strict";

/**
 * Every URL the frontend calls must be a URL the server handles.
 *
 * This is the check that catches a feature which is fully built, fully tested
 * and unreachable — a renamed route, a typo, a path that only ever existed on
 * one side. It is deliberately independent of the route extractor in
 * test-api-route-methods.cjs: the input is the list of URLs the frontend
 * actually asks for, not the list the server declares, so an extractor that
 * cannot see a route cannot hide it here either. That matters because the
 * extractor has now been found narrower than the route surface three times.
 *
 * The oracle is the router's own fallback. Anything no route handles ends at
 *
 *   return json(res, 404, { ok: false, error: "Unknown API endpoint" })
 *
 * so "the server does not serve this" is an exact string, not a guess. A route
 * that exists and rejects the request for its own reasons — 400, 403, 404 with
 * its own message, 503 because a runtime is missing — is still a route that
 * exists, and passes.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const frontendSrc = path.join(root, "app", "frontend", "src");

const FALLBACK = "Unknown API endpoint";
const METHODS = ["POST", "GET", "PATCH", "DELETE"];

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Replace ${...} with a placeholder, counting braces so a nested block inside
 * the interpolation does not end it early. An interpolation that follows a path
 * character rather than a slash is a suffix — almost always the query string —
 * so the path stops there instead of gaining an invented segment.
 */
function resolveTemplate(raw) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "$" && raw[i + 1] === "{") {
      let depth = 0;
      let j = i + 1;
      for (; j < raw.length; j += 1) {
        if (raw[j] === "{") depth += 1;
        else if (raw[j] === "}") {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      if (!out.endsWith("/")) return out;
      out += "probe-id";
      i = j;
    } else {
      out += raw[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Every URL the frontend asks for, with the candidate action words from the file
 * that asks for it. Those words are how a URL ending in a runtime-chosen segment
 * — `/batches/${id}/${action}` — gets resolved without consulting the server.
 */
function calledUrls() {
  const found = new Map();
  const prefix = "(?:api|v1|sdapi|tts-outputs)";

  for (const file of walk(frontendSrc)) {
    const text = fs.readFileSync(file, "utf8");

    const collect = (raw) => {
      const url = resolveTemplate(raw.split("?")[0]).replace(/\/+$/, "");
      if (!url.startsWith("/")) return;
      if (found.has(url)) return;

      const words = [
        ...new Set(
          (text.match(/"[a-z][a-z0-9-]{1,24}"/g) || []).map((word) => word.slice(1, -1))
        ),
      ];
      found.set(url, words);
    };

    const plain = new RegExp(`"(\\/${prefix}\\/[^"$]*)\"`, "g");
    let match;
    while ((match = plain.exec(text)) !== null) collect(match[1]);

    const template = new RegExp("`(/" + prefix + "\\/[^`]*)`", "g");
    while ((match = template.exec(text)) !== null) collect(match[1]);
  }

  return [...found.keys()].sort().map((url) => ({ url, actions: found.get(url) }));
}

/** A throwaway checkout, so booting the server cannot touch the real one. */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-contract-"));
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
  console.log("\n=== Frontend API contract ===\n");

  const entries = calledUrls();
  const urls = entries.map((entry) => entry.url);

  assert(urls.length > 250, `The frontend calls ${urls.length} distinct URLs, more than 250.`);
  assert(
    urls.every((url) => !/\$\{|`|\s/.test(url)),
    "Every one resolved to a concrete path, with no interpolation left in it."
  );
  assert(
    urls.filter((url) => url.includes("probe-id")).length > 10,
    `${urls.filter((url) => url.includes("probe-id")).length} of them came from template literals.`
  );

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
        LUKE_AI_TEST_TOTAL_RAM_BYTES: String(32 * 1024 ** 3),
        LUKE_AI_TEST_AVAILABLE_RAM_BYTES: String(24 * 1024 ** 3),
        LUKE_AI_TEST_FREE_STORAGE_BYTES: String(200 * 1024 ** 3),
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

    const isServed = async (target) => {
      for (const method of METHODS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch(`${baseUrl}${target}`, {
            method,
            signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: method === "GET" ? undefined : "{}",
          });
          if (!(await response.text()).includes(FALLBACK)) return true;
        } catch {
          // A timeout or a reset connection is not "no such route"; the sweep in
          // test-api-route-methods.cjs is where those are judged.
        } finally {
          clearTimeout(timer);
        }
      }
      return false;
    };

    const unserved = [];
    const served = new Set();
    const viaAction = [];

    for (const { url, actions } of entries) {
      let handled = await isServed(url);

      // A URL whose last segment is an action the caller picks at runtime —
      // `/download-queue/${id}/${action}`, `/batches/${id}/${action}`,
      // `/scheduler/${running ? "stop" : "start"}` — cannot be resolved
      // statically, and "probe-id" is not a word any route accepts. The accepted
      // words are recovered from the calling file rather than from the server,
      // and the URL counts as served if any of them is.
      if (!handled && url.endsWith("/probe-id") && actions?.length) {
        const base = url.slice(0, -"/probe-id".length);
        for (const action of actions) {
          if (await isServed(`${base}/${action}`)) {
            handled = true;
            viaAction.push(`${url}  →  ${base}/${action}`);
            break;
          }
        }
      }

      if (handled) served.add(url);
      else unserved.push(url);
    }

    console.log(
      `  called: ${urls.length} · served: ${served.size} · unserved: ${unserved.length}`
    );
    if (viaAction.length) {
      console.log(`  ${viaAction.length} needed a runtime action word taken from the caller:`);
      viaAction.forEach((line) => console.log(`    ${line}`));
    }
    if (unserved.length) console.log(`  not served: ${unserved.join(", ")}`);

    assert(
      unserved.length === 0,
      `Every URL the frontend calls reaches a route (${unserved.length} fall through to "${FALLBACK}").`
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of them were called.");

    console.log("\n  PASS: Frontend API contract completed.\n");
  } finally {
    // The server spawns python workers that outlive it and keep writing into the
    // throwaway checkout, so kill the whole group or the removal races them.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await delay(800);

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
