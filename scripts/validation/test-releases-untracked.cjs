#!/usr/bin/env node
"use strict";

/**
 * `releases/` is build output, and stopping tracking it must not cost the user
 * the copies on their machine.
 *
 * The folder held 1,148 tracked files and 42 MB, including five stale copies of
 * serve.cjs — three of them 25,965 lines against the 29,256 in scripts/server.
 * The release scripts that produce it already pass --exclude "releases/" when
 * packaging, and nothing reads the folder at runtime. So it is untracked and
 * ignored.
 *
 * That has a consequence: an update which stops tracking a path deletes it from
 * the working tree, so the first `bash sync.sh` after this change would have
 * removed every release on the user's disk. sync.sh now copies the folder aside
 * and puts back anything the update removed. This runs that for real — a user
 * checkout one commit behind, an origin that untracks the folder, the script
 * executed — because a deletion that happens only on the user's machine is not
 * something to reason about.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function main() {
  console.log("\n=== releases/ is output, and sync keeps the local copies ===\n");

  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);

  // ── the repository no longer carries it ───────────────────────────────────
  const tracked = git(root, ["ls-files", "releases"]).split("\n").filter(Boolean);
  assert(tracked.length === 0, `Nothing under releases/ is tracked (${tracked.length} were).`);

  const ignored = spawnSync("git", ["check-ignore", "-q", "releases/anything"], {
    cwd: root,
  }).status === 0;
  assert(ignored, "git ignores the folder, so it cannot be added back by accident.");

  const onDisk = fs.existsSync(path.join(root, "releases"));
  assert(onDisk, "The folder is still on disk here — untracking is not deleting.");

  // ── and an update that removes it does not take the user's copies ─────────
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-releases-"));
  const origin = path.join(temp, "origin");
  const user = path.join(temp, "user");

  try {
    execFileSync(
      "git",
      ["clone", "--quiet", "--branch", branch, "--single-branch", root, origin],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    git(origin, ["config", "user.email", "releases-test@example.invalid"]);
    git(origin, ["config", "user.name", "releases test"]);

    execFileSync(
      "git",
      ["clone", "--quiet", "--branch", branch, "--single-branch", origin, user],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    git(user, ["config", "user.email", "user@example.invalid"]);
    git(user, ["config", "user.name", "user"]);

    // Track a release snapshot in the origin, so the update being tested
    // really does remove something from under the user. Built here rather than
    // borrowed from the repository's committed state, which stops tracking the
    // folder as soon as this change lands.
    fs.mkdirSync(path.join(origin, "releases", "kept"), { recursive: true });
    fs.writeFileSync(
      path.join(origin, "releases", "kept", "snapshot.txt"),
      "a build artifact the user made\n"
    );
    git(origin, ["add", "-f", "releases/kept/snapshot.txt"]);
    git(origin, ["commit", "--quiet", "-m", "a release the user built"]);

    execFileSync(
      "git",
      ["fetch", "--quiet", "origin"],
      { cwd: user, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    git(user, ["merge", "--quiet", "--ff-only", "origin/" + branch]);

    const trackedInClone = git(user, ["ls-files", "releases"]).split("\n").filter(Boolean);
    assert(
      trackedInClone.includes("releases/kept/snapshot.txt"),
      `The user's checkout tracks the release (${trackedInClone.length} files under releases/).`
    );

    const watched = "releases/kept/snapshot.txt";
    const watchedBefore = fs.readFileSync(path.join(user, watched), "utf8");

    // The clone carries the committed sync.sh; the working-tree one is what is
    // being judged.
    fs.copyFileSync(path.join(root, "sync.sh"), path.join(user, "sync.sh"));

    // Move the origin to the state that stops tracking the folder.
    git(origin, ["rm", "-r", "--quiet", "--cached", "releases"]);
    fs.appendFileSync(path.join(origin, ".gitignore"), "\nreleases/\n");
    git(origin, ["add", ".gitignore"]);
    git(origin, ["commit", "--quiet", "-m", "stop tracking releases/"]);

    const result = spawnSync("bash", ["sync.sh"], { cwd: user, encoding: "utf8" });

    assert(result.status === 0, `sync.sh exits 0 (got ${result.status}: ${(result.stderr || "").slice(0, 200)}).`);

    const head = git(user, ["rev-parse", "HEAD"]);
    const originHead = git(origin, ["rev-parse", "HEAD"]);
    assert(head === originHead, "The checkout fast-forwarded to the origin.");

    const nowTracked = git(user, ["ls-files", "releases"]).split("\n").filter(Boolean);
    assert(
      nowTracked.length === 0,
      "and releases/ is no longer tracked there either."
    );

    const survived = fs.existsSync(path.join(user, watched));
    const sameContent =
      survived && fs.readFileSync(path.join(user, watched), "utf8") === watchedBefore;

    assert(
      survived,
      `The update did not delete ${watched} from the user's disk.`
    );
    assert(sameContent, "and its contents are unchanged.");

    const survivingCount = spawnSync(
      "find",
      [path.join(user, "releases"), "-type", "f"],
      { encoding: "utf8" }
    ).stdout
      .split("\n")
      .filter(Boolean).length;

    assert(
      survivingCount >= trackedInClone.length,
      `All ${trackedInClone.length} of them are still there (${survivingCount} found).`
    );

    const second = spawnSync("bash", ["sync.sh"], { cwd: user, encoding: "utf8" });
    assert(
      second.status === 0 && fs.existsSync(path.join(user, watched)),
      "Running it again is still clean and still leaves the folder alone."
    );

    console.log("\n  PASS: releases/ is output, and sync keeps the local copies completed.\n");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
