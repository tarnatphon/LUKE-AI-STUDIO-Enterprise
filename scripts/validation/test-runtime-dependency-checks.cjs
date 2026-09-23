#!/usr/bin/env node
"use strict";

/**
 * The runtime dependency checker, and the three holes in it.
 *
 * GET /api/runtime/dependencies answers from app/config/runtime-dependencies.json.
 * Three things were wrong with how it answered:
 *
 *   1. `python-module` checks were never run. The code returned a hardcoded
 *      {status:"not-probed", ok:false}, and since a dependency counts as
 *      installed only when every check passes, video-runtime could never be
 *      ready — even on a machine with torch, diffusers and transformers all
 *      installed.
 *
 *   2. `dependency.platforms` was copied into the response and never read.
 *      Every entry in the shipped catalog says darwin-arm64, so on any other
 *      machine the three required entries were reported missing and the whole
 *      endpoint answered ok:false, permanently, for runtimes that were never
 *      meant to exist there.
 *
 *   3. `status` existed only on python-module checks. A client reading
 *      check.status got a real value from one kind of check and undefined from
 *      the other four.
 *
 * The catalog is rewritten inside a throwaway copy of the repository, so the
 * shipped one is never touched — and the last assertion proves that.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const catalogFile = path.join(root, "app", "config", "runtime-dependencies.json");

const PLATFORM = `${process.platform}-${process.arch}`;
const OTHER_PLATFORM = PLATFORM === "darwin-arm64" ? "linux-x64" : "darwin-arm64";

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const net = require("node:net");
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** A throwaway checkout, so the test catalog never lands in the real one. */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-runtime-deps-"));
  const destination = path.join(temp, "repo");

  fs.mkdirSync(path.join(destination, "scripts", "server"), { recursive: true });
  fs.mkdirSync(path.join(destination, "app"), { recursive: true });

  const sources = spawnSync("find", ["scripts", "-type", "f", "-not", "-path", "*/node_modules/*"], {
    cwd: root,
    encoding: "utf8",
  }).stdout
    .split("\n")
    .filter(Boolean);

  for (const file of sources) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }

  const dependencies = path.join(root, "scripts", "server", "node_modules");
  if (fs.existsSync(dependencies)) {
    fs.symlinkSync(dependencies, path.join(destination, "scripts", "server", "node_modules"), "dir");
  }

  for (const folder of ["config", "dist"]) {
    const source = path.join(root, "app", folder);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(destination, "app", folder), { recursive: true });
    }
  }

  return { temp, destination };
}

/** Which python this machine can be asked through, if any. */
function findPython() {
  for (const candidate of process.platform === "win32" ? ["python"] : ["python3", "python"]) {
    const run = spawnSync(candidate, ["-c", "print(1)"], { encoding: "utf8", timeout: 8000 });
    if (!run.error && run.status === 0) return candidate;
  }
  return null;
}

function writeCatalog(destination, { python, extra }) {
  const catalog = {
    schemaVersion: 1,
    product: "LUKE AI STUDIO",
    catalogVersion: "test",
    defaultDownloadDirectory: "/tmp/luke-test-downloads",
    fallbackDownloadDirectory: "~/Downloads/LUKE-AI-STUDIO",
    dependencies: [
      {
        id: "python-present",
        name: { en: "Python module that exists", th: "โมดูลที่มีอยู่" },
        category: "ai-runtime",
        required: false,
        platforms: [PLATFORM],
        checks: [{ type: "python-module", module: "json", ...(python ? { python } : {}) }],
        install: {},
      },
      {
        id: "python-absent",
        name: { en: "Python module that does not exist", th: "โมดูลที่ไม่มี" },
        category: "ai-runtime",
        required: false,
        platforms: [PLATFORM],
        checks: [
          {
            type: "python-module",
            module: "luke_definitely_not_installed_xyz",
            ...(python ? { python } : {}),
          },
        ],
        install: {},
      },
      {
        id: "python-nameless",
        name: { en: "Python check with no module", th: "check ที่ไม่มีชื่อโมดูล" },
        category: "ai-runtime",
        required: false,
        platforms: [PLATFORM],
        checks: [{ type: "python-module", ...(python ? { python } : {}) }],
        install: {},
      },
      {
        id: "required-elsewhere",
        name: { en: "Required, but not on this machine", th: "จำเป็น แต่ไม่ใช่เครื่องนี้" },
        category: "core-runtime",
        // The whole point: required, and for a platform that is not this one.
        required: true,
        platforms: [OTHER_PLATFORM],
        checks: [{ type: "executable", path: "app/tools/node-mac/bin/node", versionArgument: "--version" }],
        install: {},
      },
      {
        id: "filesystem-here",
        name: { en: "A directory on this machine", th: "โฟลเดอร์บนเครื่องนี้" },
        category: "core-runtime",
        required: true,
        platforms: [PLATFORM],
        checks: [{ type: "directory", path: "app" }],
        install: {},
      },
      ...(extra || []),
    ],
    storagePolicy: {},
  };

  fs.writeFileSync(
    path.join(destination, "app", "config", "runtime-dependencies.json"),
    `${JSON.stringify(catalog, null, 2)}\n`
  );
}

async function main() {
  console.log("\n=== Runtime dependency checks ===\n");

  const shippedSha = sha256(catalogFile);
  const shipped = JSON.parse(fs.readFileSync(catalogFile, "utf8"));

  const python = findPython();
  console.log(`  this machine: ${PLATFORM} · python: ${python || "none found"}`);

  const { temp, destination } = buildTempRoot();

  // A module that leaves a marker if it is ever imported. find_spec must
  // answer without importing, or a status check drags torch and Metal up on
  // an endpoint the dashboard polls.
  const canary = path.join(destination, "luke_probe_canary.py");
  const marker = path.join(temp, "canary-imported");
  fs.writeFileSync(
    canary,
    `with open(${JSON.stringify(marker)}, "w") as handle:\n    handle.write("imported\\n")\n`
  );

  writeCatalog(destination, {
    python,
    extra: [
      {
        id: "canary",
        name: { en: "Import canary", th: "ตัวตรวจจับการ import" },
        category: "ai-runtime",
        required: false,
        platforms: [PLATFORM],
        checks: [{ type: "python-module", module: "luke_probe_canary", ...(python ? { python } : {}) }],
        install: {},
      },
    ],
  });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(destination, "scripts", "server", "serve.cjs")], {
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
  });

  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

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

    assert(ready, "The server starts against the rewritten catalog.");

    const response = await fetch(`${baseUrl}/api/runtime/dependencies`);
    assert(response.status === 200, `GET /api/runtime/dependencies answered ${response.status}.`);

    const data = await response.json();
    const byId = Object.fromEntries((data.dependencies || []).map((entry) => [entry.id, entry]));

    assert(data.platform === PLATFORM, `It reports this machine as ${data.platform}.`);
    assert(
      data.summary.total === data.dependencies.length,
      "summary.total still counts every catalog entry, applicable or not."
    );

    // ── 3. every check carries a status ────────────────────────────────────
    const checks = (data.dependencies || []).flatMap((entry) => entry.checks || []);
    assert(checks.length > 0, `${checks.length} checks were actually run.`);
    assert(
      checks.every((check) => typeof check.status === "string" && check.status.length > 0),
      "Every check carries a status, not just the python ones."
    );

    const directory = byId["filesystem-here"];
    assert(
      directory.applicable === true && directory.state === "ready",
      "A directory check on this machine is probed and comes back ready."
    );
    assert(
      directory.checks[0].status === "ready" && directory.checks[0].ok === true,
      "A file-system check reports status ready, which it never used to report at all."
    );

    // ── 2. platforms is honoured ───────────────────────────────────────────
    const elsewhere = byId["required-elsewhere"];
    assert(
      elsewhere.applicable === false && elsewhere.state === "not-applicable",
      `A required runtime declared for ${OTHER_PLATFORM} is marked not applicable here.`
    );
    assert(
      elsewhere.checks.length === 0,
      "It is not probed at all — checking a darwin path on this machine proves nothing."
    );
    assert(
      data.summary.requiredMissing === 0,
      `requiredMissing is ${data.summary.requiredMissing}, so a runtime for another machine is no longer counted against this one.`
    );
    assert(
      data.ok === true,
      "ok is true: nothing that is required *here* is missing."
    );
    assert(
      data.summary.notApplicable === 1,
      `summary.notApplicable is ${data.summary.notApplicable}, and total is still ${data.summary.total}.`
    );

    // ── 1. python-module is really probed ──────────────────────────────────
    if (python) {
      const present = byId["python-present"];
      assert(
        present.checks[0].status === "ready" && present.checks[0].ok === true,
        "A module that is installed comes back ready — this check used to be hardcoded to fail."
      );
      assert(
        present.checks[0].python === python,
        "It reports which interpreter it asked."
      );

      const absent = byId["python-absent"];
      assert(
        absent.checks[0].status === "missing" && absent.checks[0].ok === false,
        "A module that is not installed comes back missing, not not-probed."
      );

      const nameless = byId["python-nameless"];
      assert(
        nameless.checks[0].status === "invalid" && nameless.checks[0].ok === false,
        "A check with no module name says so instead of probing an empty string."
      );

      const canaryCheck = byId["canary"];
      assert(
        canaryCheck.checks[0].status === "ready",
        "The canary module was found."
      );
      assert(
        !fs.existsSync(marker),
        "The canary was never imported — find_spec answers without loading the module."
      );
    } else {
      assert(
        byId["python-present"].checks[0].status === "no-python",
        "With no interpreter on this machine the check says no-python rather than guessing."
      );
    }

    // ── the shipped catalog survived ───────────────────────────────────────
    assert(
      sha256(catalogFile) === shippedSha,
      "The shipped runtime-dependencies.json was not touched."
    );
    assert(
      shipped.dependencies.every((entry) => (entry.platforms || []).includes("darwin-arm64")),
      "It still declares darwin-arm64, which is what the product ships."
    );

    console.log("\n  PASS: Runtime dependency checks completed.\n");
  } finally {
    child.kill("SIGKILL");
    await delay(300);

    const linked = path.join(destination, "scripts", "server", "node_modules");
    try {
      if (fs.lstatSync(linked).isSymbolicLink()) fs.unlinkSync(linked);
    } catch {}

    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
