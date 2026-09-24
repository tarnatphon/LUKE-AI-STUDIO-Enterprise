#!/usr/bin/env node
"use strict";

/**
 * The storage transfer queue actually moves files, and it does not spin.
 *
 * Two defects were found here, both measured on this machine:
 *
 * 1. The local-fallback provider's root is written in the config as
 *    "~/Library/Application Support/LUKE AI STUDIO/downloads". The queue used
 *    it raw in path.join, which produced a path with no leading slash — so a
 *    transfer wrote its file into a literal folder named "~" under the
 *    server's working directory. The measured artifact was a copy of
 *    /etc/passwd at ./~/Library/Application Support/LUKE AI STUDIO/downloads/.
 *
 * 2. processJob changed the job object it was handed, but persisted state
 *    through freshly-read snapshots — a different copy of the job. The job on
 *    disk never left "queued", the loop picked it up again on every pass, and
 *    the server sat at 100% CPU with the job stuck at attempts 0 while the
 *    error repeated. A job that cannot find a provider failed forever instead
 *    of failing once.
 *
 * This suite runs the queue for real: a job with no provider available must
 * fail once, with the reason recorded; a job with a provider must complete,
 * and the file must land under the expanded home, not in a literal "~"
 * folder.
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-queuecheck-"));
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
  console.log("\n=== The transfer queue moves files and does not spin ===\n");

  // The persistence fix is structural before it is behavioural: the loop must
  // hand the job's own snapshot to processJob, and every final write must
  // merge the job back into the state it persists.
  const queue = fs.readFileSync(
    path.join(root, "scripts", "server", "unified-storage-transfer-queue.cjs"),
    "utf8"
  );
  assert(
    queue.includes("async processJob(job, state)"),
    "processJob receives the snapshot its job came from."
  );
  assert(
    /await this\.processJob\(\s*nextJob,\s*state\s*\)/.test(queue),
    "and the loop passes it."
  );
  assert(
    (queue.match(/this\.syncJobIntoState\(/g) || []).length >= 3,
    "Every final write merges the job into the state it persists."
  );
  assert(
    queue.includes('expandHome(\n            provider.settings'),
    "The provider root is expanded before the local write."
  );

  // The fallback root, the way the config writes it.
  const configPolicy = JSON.parse(
    fs.readFileSync(
      path.join(root, "app", "config", "storage", "storage-providers.json"),
      "utf8"
    )
  );
  const fallback = configPolicy.providers.find((item) => item.id === "local-fallback");
  assert(fallback && fallback.settings.rootPath.startsWith("~/"), "The config really does carry a ~ path.");

  const { temp, destination } = buildTempRoot();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const stateFile = path.join(
    destination,
    "app",
    "runtime-state",
    "storage",
    "unified-transfer-queue.json"
  );

  // A home directory of its own, so the suite never reads or writes the
  // machine's real one. os.homedir() follows HOME on both supported platforms.
  const home = path.join(temp, "home");
  fs.mkdirSync(home, { recursive: true });
  const homeRoot = path.join(
    home,
    "Library",
    "Application Support",
    "LUKE AI STUDIO",
    "downloads"
  );
  const probeName = `queue-suite-probe-${process.pid}.txt`;

  const child = spawn(
    process.execPath,
    [path.join(destination, "scripts", "server", "serve.cjs")],
    {
      cwd: destination,
      env: {
        ...process.env,
        HOME: home,
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

    const requestArchive = async (name, content) => {
      const source = path.join(destination, "app", name);
      fs.writeFileSync(source, content, "utf8");
      const response = await fetch(`${baseUrl}/api/storage/archive/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePath: source }),
      });
      const body = await response.json();
      return { status: response.status, body, source, content };
    };

    const jobById = (id) => {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return state.jobs.find((item) => item.id === id);
    };

    const waitForJob = async (id, statuses, timeoutMs = 20000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const job = jobById(id);
        if (job && statuses.includes(job.status)) return job;
        await delay(200);
      }
      return jobById(id);
    };

    // ── A: no provider can serve the job ───────────────────────────────────
    // The external drive is absent on this machine and the fallback folder
    // has not been created, so nothing is available. The job must fail once,
    // with the reason, and stay failed — not retry the same impossible
    // request until the CPU is pinned.
    const a = await requestArchive(probeName, "a job with no provider");
    assert(a.status === 200, "The request is accepted and queued.");
    const jobA = await waitForJob(a.body.archive.transferJobId, ["failed", "completed"], 20000);
    assert(jobA, "The job appears in the queue state.");
    assert(
      jobA.status === "failed",
      `With no provider available the job fails (${jobA.status}).`
    );
    assert(
      /provider/i.test(jobA.error || ""),
      `and the failure says why (${(jobA.error || "").slice(0, 70)}).`
    );
    assert(jobA.attempts === 1, `It was attempted once (attempts: ${jobA.attempts}).`);

    // Give a spinning loop a chance to show itself: a stuck loop re-reads
    // the state file on every pass, and its attempts counter would climb
    // while the CPU sits at 100%.
    await delay(2500);
    const jobAgain = jobById(a.body.archive.transferJobId);
    assert(
      jobAgain.status === "failed" && jobAgain.attempts === 1,
      "Two seconds later it is still failed, attempted once — nothing is retrying it in a loop."
    );

    // ── B: a provider is available ─────────────────────────────────────────
    fs.mkdirSync(homeRoot, { recursive: true });

    const b = await requestArchive(probeName, "a job with a provider");
    const jobB = await waitForJob(b.body.archive.transferJobId, ["completed", "failed"], 20000);
    assert(jobB && jobB.status === "completed", `With a provider the job completes (${jobB && jobB.status}).`);
    assert(
      jobB && jobB.destinationProviderId === "local-fallback",
      `It was served by the local fallback (${jobB && jobB.destinationProviderId}).`
    );

    const written = path.join(homeRoot, probeName);
    assert(fs.existsSync(written), "The file landed under the fallback root.");
    assert(
      fs.existsSync(written) && fs.readFileSync(written, "utf8") === b.content,
      "and its contents are the source file's."
    );
    assert(
      written.startsWith(home + path.sep),
      "The root was expanded to the home directory, not left as a relative ~ path."
    );

    const literal = path.join(destination, "~");
    assert(
      !fs.existsSync(literal),
      "No literal ~ folder was created under the server's working directory."
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of it.");

    // ── cleanup ────────────────────────────────────────────────────────────
    try {
      fs.rmSync(written, { force: true });
    } catch {}

    console.log("\n  PASS: The transfer queue moves files and does not spin completed.\n");
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
