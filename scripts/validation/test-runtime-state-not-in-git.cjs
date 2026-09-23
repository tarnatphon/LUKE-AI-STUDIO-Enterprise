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

// A fresh clone has no app/runtime-state at all, and whether an earlier suite
// happened to create the folder is not something a scan should depend on.
const { ensureRuntimeStateLayout } = require("./helpers/runtime-state-paths.cjs");

ensureRuntimeStateLayout(root);
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const policyFile = path.join(root, "app", "config", "text-chat", "model-arena-policy.json");
const overridesFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-chat",
  "model-arena-policy.overrides.json"
);
const modelSettingsSeed = path.join(root, "app", "config", "llm-model-settings.json");
const modelSettingsState = path.join(root, "app", "runtime-state", "llm-model-settings.json");

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
  // The whole repository, not just the folders that have offended so far.
  // Two separate bugs lived in two separate directories - app/runtime-state and
  // app/config - and a check scoped to the one already found is a check that
  // waits to be surprised again. Comparing before and after is what keeps
  // unrelated work in progress from failing this.
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: root, encoding: "utf8" },
  );
  return new Set(
    String(result.stdout || "")
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean),
  );
}

/**
 * Every path git is tracking under a directory.
 *
 * The copies under releases/ are frozen snapshots of past builds, so this is
 * scoped to the live app folder: an anchored `app/runtime-state/` ignore rule
 * does not reach them, and they are meant to stay in git.
 */
function gitTrackedUnder(directory) {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("git", ["ls-files", "--", directory], {
    cwd: root,
    encoding: "utf8",
  });
  return String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main() {
  console.log("Runtime state isolation validation");

  const dirtBefore = gitTrackedDirt();
  const beforeHash = sha256(policyFile);
  const hadOverrides = fs.existsSync(overridesFile);
  const previousOverrides = hadOverrides ? fs.readFileSync(overridesFile, "utf8") : null;
  const hadSettingsState = fs.existsSync(modelSettingsState);
  const previousSettingsState = hadSettingsState
    ? fs.readFileSync(modelSettingsState, "utf8")
    : null;
  const seedBefore = sha256(modelSettingsSeed);

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

    // Saving a model setting used to write app/config/llm-model-settings.json,
    // which is tracked - the same failure one folder over, and the reason the
    // committed copy carries one machine's preferredBackend. This is the
    // request that proves it now writes somewhere git ignores.
    const savedSettings = await fetch(`${baseUrl}/api/llm/model-settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "guard-probe.gguf", preferredBackend: "cpu" }),
    }).then((response) => response.json());

    assert(savedSettings.ok === true, "a model setting can be saved");
    assert(
      sha256(modelSettingsSeed) === seedBefore,
      "the tracked seed in app/config is not written while the app is used",
    );
    assert(
      fs.existsSync(modelSettingsState),
      "it lands in app/runtime-state, which git ignores",
    );
    assert(
      gitIgnored(modelSettingsState),
      "and that file is ignored, so saving a setting cannot break a pull",
    );
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
      "running the app leaves no tracked file modified anywhere in the repository",
    );
    if (newlyDirty.length > 0) console.log(`     newly dirty: ${newlyDirty.join(", ")}`);

    // Not a list of known offenders — the invariant itself. Any file git
    // tracks under app/runtime-state is a file the app can rewrite, and so a
    // future update that git will refuse to apply on the user's machine.
    const trackedState = gitTrackedUnder("app/runtime-state");

    assert(
      trackedState.length === 0,
      "git tracks nothing under app/runtime-state",
    );
    if (trackedState.length > 0) {
      console.log(
        `     tracked: ${trackedState.slice(0, 5).join(", ")}` +
          (trackedState.length > 5 ? `, and ${trackedState.length - 5} more` : ""),
      );
    }

    assert(
      gitIgnored(path.join(root, "app/runtime-state/text-chat/conversations.json")),
      "the whole directory is ignored, so the app writing it cannot break a pull",
    );

    // The frozen build snapshots are the deliberate exception.
    assert(
      gitTrackedUnder("releases").some((entry) => entry.includes("app/runtime-state/")),
      "the release snapshots under releases/ still carry their state, as intended",
    );

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

    if (previousSettingsState === null) fs.rmSync(modelSettingsState, { force: true });
    else fs.writeFileSync(modelSettingsState, previousSettingsState);
  }

  console.log("\nPASS: runtime state isolation validation completed.");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
