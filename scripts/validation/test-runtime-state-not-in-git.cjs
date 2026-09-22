#!/usr/bin/env node
"use strict";

/**
 * Runtime state must never be written to tracked files.
 *
 * LUKE AI STUDIO runs from a git checkout on the user's own disk. Anything the
 * app writes while it is being used (arena settings, memory calibration, job
 * state…) has to land in an ignored runtime-state folder, otherwise every
 * `git pull` on that machine fails with
 *
 *   error: Your local changes to the following files would be overwritten by
 *   merge: app/config/text-chat/model-arena-policy.json
 *
 * This validation proves the split: the shipped config is read-only for the
 * app, user choices live outside of git, and the browser always receives the
 * current frontend.
 * app, user choices are stored outside of git, and both are merged at runtime.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const policyFile = path.join(root, "app", "config", "text-chat", "model-arena-policy.json");
const overridesFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-chat",
  "model-arena-policy.overrides.json"
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error || !port ? reject(error || new Error("no port")) : resolve(port)));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function gitIgnored(filePath) {
  const result = spawnSyncGit(["check-ignore", "-q", path.relative(root, filePath)]);
  return result.status === 0;
}

function spawnSyncGit(args) {
  const { spawnSync } = require("node:child_process");
  return spawnSync("git", args, { cwd: root, stdio: "ignore" });
}

/**
 * Every tracked file the working tree currently disagrees with.
 *
 * The app runs from a git checkout on the user's own disk, so a tracked file it
 * rewrites is a `git pull` that refuses to run. Comparing this set before and
 * after a run catches any state file that finds its way back into git, without
 * the check failing merely because unrelated work is in progress.
 */
function gitTrackedDirt() {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no", "--", "app/runtime-state"],
    { cwd: root, encoding: "utf8" },
  );
  return new Set(
    String(result.stdout || "")
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean),
  );
}

/** Machine state the app rewrites on every boot, and must never track. */
const REWRITTEN_ON_BOOT = [
  "app/runtime-state/storage/storage-availability-watcher.json",
  "app/runtime-state/storage/storage-destination-state.json",
  "app/runtime-state/storage/storage-provider-state.json",
  "app/runtime-state/social-agency/thai-modern-bags.json",
  "app/runtime-state/text-chat/runtime-supervisor.json",
];

async function main() {
  console.log("Runtime state isolation validation");

  const dirtBefore = gitTrackedDirt();
  const beforeHash = sha256(policyFile);
  const hadOverrides = fs.existsSync(overridesFile);
  const previousOverrides = hadOverrides ? fs.readFileSync(overridesFile, "utf8") : null;

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
      try {
        const response = await fetch(`${baseUrl}/api/llm/arena/policy`);
        if (response.status === 200) ready = true;
      } catch (_) {}
      if (!ready) await delay(150);
    }
    if (!ready) throw new Error(`Application server did not become ready.\n${log}`);

    const updated = await fetch(`${baseUrl}/api/llm/arena/policy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: { maximumModels: 4 }, judge: { enabled: false } }),
    }).then((response) => response.json());

    assert(updated.ok === true, "the arena settings endpoint accepts the user's choice");
    assert(
      Number(updated.policy.selection.maximumModels) === 4,
      "the merged policy reports the user's choice (4 models)"
    );
    assert(updated.policy.judge.enabled === false, "the merged policy reports the judge being switched off");
    assert(
      sha256(policyFile) === beforeHash,
      "the shipped config file in git is not modified while the app is used"
    );
    assert(fs.existsSync(overridesFile), "the user's choice is stored in runtime-state instead");
    assert(gitIgnored(overridesFile), "that runtime-state file is ignored by git, so pulls never collide");

    // A fresh read must still see the choice after the merge.
    const reread = await fetch(`${baseUrl}/api/llm/arena/policy`).then((response) => response.json());
    assert(
      Number(reread.policy.selection.maximumModels) === 4 && reread.policy.judge.enabled === false,
      "a later read still returns the user's choice"
    );

    // A stale bundle in the browser cache is the classic reason a shipped
    // feature "does not exist" for the user, so the headers are part of the
    // contract: index.html is revalidated, hashed assets are immutable.
    const indexResponse = await fetch(`${baseUrl}/`);
    assert(
      (indexResponse.headers.get("cache-control") || "").includes("no-cache"),
      "index.html is always revalidated, so an update reaches the browser"
    );

    const assetResponse = await fetch(`${baseUrl}/assets/does-not-exist.js`);
    assert(
      (assetResponse.headers.get("cache-control") || "").includes("max-age=31536000"),
      "fingerprinted bundles are cached immutably (fast reloads)"
    );

    // One boot of the app, plus ordinary reads, must not touch a single
    // tracked file. This is the invariant the header comment describes; until
    // it was asserted, four files under app/runtime-state were tracked and the
    // app rewrote all four on every start, so the user's own `git pull` broke
    // the first time anybody committed a change to one of them.
    const dirtAfter = gitTrackedDirt();
    const newlyDirty = [...dirtAfter].filter((entry) => !dirtBefore.has(entry));

    assert(
      newlyDirty.length === 0,
      "running the app leaves no tracked runtime-state file modified",
    );
    if (newlyDirty.length > 0) console.log(`     newly dirty: ${newlyDirty.join(", ")}`);

    for (const relative of REWRITTEN_ON_BOOT) {
      assert(
        gitIgnored(path.join(root, relative)),
        `${path.basename(relative)} is ignored, so the app rewriting it cannot break a pull`,
      );
    }

    const shipped = JSON.parse(fs.readFileSync(policyFile, "utf8"));
    assert(
      Number(shipped.selection.maximumModels) === 3,
      "the shipped defaults stay at 3 models so updates can still change them"
    );
  } finally {
    child.kill("SIGTERM");
    await delay(300);
    if (child.exitCode === null) child.kill("SIGKILL");
    if (previousOverrides === null) fs.rmSync(overridesFile, { force: true });
    else fs.writeFileSync(overridesFile, previousOverrides);
  }

  console.log("\nPASS: runtime state isolation validation completed.");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
