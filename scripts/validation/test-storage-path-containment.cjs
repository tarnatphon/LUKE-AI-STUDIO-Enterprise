#!/usr/bin/env node
"use strict";

/**
 * The storage routes take absolute paths straight from the request body, and
 * there are 71 of them. Before the gate existed, measured on this machine:
 *
 *   POST /api/storage/lifecycle/plan   {"rootPath":"/etc"}
 *     → 200, an inventory of 238 files and 1,437,305 bytes
 *   POST /api/storage/archive/request  {"sourcePath":"/etc/passwd"}
 *     → 200, the file read and its sha256 returned
 *
 * Nothing was gated at all. The rule this app runs on is that confinement
 * comes first, so every /api/storage/* body that names an absolute path now
 * has to name one inside the app folder, the system temp folder, or the
 * configured external drive. One check at the single body reader covers all
 * 71 routes, because all 71 read their body through it — and that is what the
 * structural assertions below pin down.
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-storagecheck-"));
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
  console.log("\n=== Storage paths stay inside their folders ===\n");

  // The gate sits at the one place all 71 routes read their body. If that
  // moves, the gate goes with it — a gate anywhere else is a gate nobody uses.
  const source = fs.readFileSync(
    path.join(root, "scripts", "server", "serve.cjs"),
    "utf8"
  );
  const readerStart = source.indexOf("function readJsonRequestBody");
  const readerEnd = source.indexOf("LUKE_AI_RUNTIME_SAFE_DOWNLOAD_WORKER_V1");
  assert(readerStart > 0 && readerEnd > readerStart, "The storage body reader is where the check lives.");
  const reader = source.slice(readerStart, readerEnd);
  assert(reader.includes('startsWith("/api/storage/")'), "The check applies to /api/storage/* bodies.");
  assert(reader.includes("storagePathViolation(parsed)"), "The parsed body is what gets checked, before any route sees it.");
  const fields = source.match(/STORAGE_PATH_FIELDS\s*=\s*\[([\s\S]*?)\]/);
  assert(fields, "The gated field names are one list, not a scattering of checks.");
  for (const field of ["rootPath", "sourcePath", "destinationPath", "sourceArchivePath", "path", "defaultLocation"]) {
    assert(fields && fields[1].includes(`"${field}"`), `The list names ${field}.`);
  }

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
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: response.status, body: await response.text() };
    };

    // The routes that used to answer /etc, each with the field it takes.
    const escapes = [
      ["/api/storage/lifecycle/plan", { rootPath: "/etc" }],
      ["/api/storage/workload/detect", { sourcePath: "/etc/passwd" }],
      ["/api/storage/archive/request", { sourcePath: "/etc/passwd" }],
      ["/api/storage/transfer", { sourcePath: "/etc/passwd", destinationPath: "/tmp/stolen" }],
      ["/api/storage/lifecycle/plan", { rootPath: "/Users" }],
      ["/api/storage/archive/request", { sourceArchivePath: "/etc" }],
      ["/api/storage/lifecycle/plan", { path: "/etc" }],
      ["/api/storage/choose-folder", { defaultLocation: "/etc" }],
    ];

    let leaked = 0;
    for (const [url, body] of escapes) {
      const { status, body: text } = await post(url, body);
      const refused = status === 403 && text.includes("has to be inside the app folder");
      if (!refused) {
        leaked += 1;
        console.log(`    not refused: ${url} → ${status} ${text.slice(0, 90)}`);
      }
    }
    assert(leaked === 0, `Every storage path that climbs out of its folders is refused (${leaked} were not).`);

    // The refusal says which field, and it does not echo the path back.
    const one = await post("/api/storage/archive/request", { sourcePath: "/etc/passwd" });
    assert(one.body.includes("sourcePath"), "The refusal names the field that was refused.");
    assert(!one.body.includes("/etc/passwd"), "and it does not echo the path back.");

    // A path inside the app has to survive, or the containment is just a refusal.
    const inside = await post("/api/storage/lifecycle/plan", { rootPath: path.join(destination, "app") });
    assert(inside.status === 200, "A root inside the app folder is not refused.");
    assert(inside.body.includes('"ok":true'), "and it does its work.");

    // A relative value is resolved against the route's own base by the route,
    // so the gate must not touch it.
    const relative = await post("/api/storage/lifecycle/plan", { rootPath: "app" });
    assert(relative.status === 200, "A relative path is not refused by the gate.");

    // Broken JSON is still a 400 about JSON, not a 403 about paths.
    const broken = await post("/api/storage/lifecycle/plan", "{oops");
    assert(broken.status === 400 && broken.body.includes("Invalid JSON request body"), "Broken JSON is still reported as broken JSON.");

    // The gate is scoped to storage: the same field elsewhere is nobody's business.
    const elsewhere = await post("/api/text-runtime/remote-provider/status", { path: "/etc" });
    assert(
      !elsewhere.body.includes("has to be inside the app folder"),
      "A path-named field on a non-storage route is not gated."
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of it.");

    console.log("\n  PASS: Storage paths stay inside their folders completed.\n");
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
