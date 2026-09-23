#!/usr/bin/env node
"use strict";

/**
 * `bash sync.sh` actually updates a checkout and keeps the user's own files.
 *
 * This is the command the user is told to run after every change, and until now
 * it had never been executed by anything — its correctness was a matter of
 * reading it and believing it. So this builds a throwaway origin from the real
 * repository, clones a user checkout one commit behind, writes chat history into
 * it the way the app would, moves the origin forward, and runs the script for
 * real.
 *
 * What has to hold:
 *   the checkout fast-forwards to the origin
 *   the script exits 0
 *   the user's chat history is byte-identical afterwards
 *   running it a second time reports "already up to date" and changes nothing
 *   run somewhere that is not a checkout, it says so and exits 1
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

function git(cwd, args, options = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", ...options }).trim();
}

function run(cwd, command, args) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function main() {
  console.log("\n=== sync.sh updates a checkout ===\n");

  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  assert(
    branch && branch !== "HEAD",
    `The repository is on a branch (${branch}), which the script requires.`
  );

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-sync-"));
  const origin = path.join(temp, "origin");
  const user = path.join(temp, "user");

  try {
    // A throwaway origin cloned from the real repository, so the script is
    // exercised against the actual tree, .gitignore and paths — not a model of
    // them. Cloning locally needs no network.
    execFileSync(
      "git",
      ["clone", "--quiet", "--branch", branch, "--single-branch", root, origin],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    git(origin, ["config", "user.email", "sync-test@example.invalid"]);
    git(origin, ["config", "user.name", "sync test"]);

    execFileSync(
      "git",
      ["clone", "--quiet", "--branch", branch, "--single-branch", origin, user],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    git(user, ["config", "user.email", "user@example.invalid"]);
    git(user, ["config", "user.name", "user"]);

    // One commit behind, which is the ordinary state of a machine that has been
    // used since the last update.
    git(user, ["reset", "--hard", "--quiet", "HEAD~1"]);
    const behind = git(user, ["rev-parse", "--short", "HEAD"]);

    // The clone carries the committed sync.sh, and the reset above would
    // overwrite it, so this comes after. It has to test the file that is
    // actually on disk, including edits that have not been committed yet —
    // otherwise the suite keeps passing no matter what is done to the script it
    // claims to be checking.
    fs.copyFileSync(path.join(root, "sync.sh"), path.join(user, "sync.sh"));

    // Chat history the way the app writes it. Untracked, like the real thing.
    const historyFile = path.join(
      user,
      "app",
      "runtime-state",
      "text-chat",
      "conversations.json"
    );
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    const history = JSON.stringify({
      conversations: [{ id: "c1", title: "สิ่งที่ต้องรอดจากการอัปเดต" }],
    });
    fs.writeFileSync(historyFile, history);

    // Machine state the app also writes, which the update is free to discard.
    fs.writeFileSync(
      path.join(user, "app", "runtime-state", "machine-state.json"),
      '{"rewritten":"on boot"}\n'
    );

    // Move the origin forward.
    const marker = path.join(origin, "AI-LIBRARY-CHANGELOG.md");
    fs.appendFileSync(marker, "\nsync.sh test marker\n");
    git(origin, ["add", "AI-LIBRARY-CHANGELOG.md"]);
    git(origin, ["commit", "--quiet", "-m", "simulated upstream commit"]);
    const ahead = git(origin, ["rev-parse", "--short", "HEAD"]);

    assert(behind !== ahead, `The user checkout starts behind the origin (${behind} vs ${ahead}).`);

    const first = run(user, "bash", ["sync.sh"]);

    console.log(
      first.stdout
        .split("\n")
        .filter((line) => line.includes("[sync]"))
        .map((line) => `    ${line.trim()}`)
        .join("\n")
    );

    assert(first.status === 0, `The script exits 0 (got ${first.status}).`);
    assert(
      git(user, ["rev-parse", "--short", "HEAD"]) === ahead,
      `The checkout fast-forwarded to the origin (${ahead}).`
    );
    assert(
      git(user, ["status", "--porcelain", "AI-LIBRARY-CHANGELOG.md"]) === "",
      "The updated file arrived and is not left modified."
    );
    assert(
      fs.readFileSync(historyFile, "utf8") === history,
      "The user's chat history is byte-identical afterwards."
    );

    const second = run(user, "bash", ["sync.sh"]);
    assert(second.status === 0, `Running it again exits 0 (got ${second.status}).`);
    assert(
      second.stdout.includes("already up to date"),
      "and reports that there is nothing to do."
    );
    assert(
      git(user, ["rev-parse", "--short", "HEAD"]) === ahead,
      "and leaves the checkout where it was."
    );
    assert(
      fs.readFileSync(historyFile, "utf8") === history,
      "and still has not touched the chat history."
    );

    // Run somewhere that is not a checkout at all.
    const nowhere = path.join(temp, "nowhere");
    fs.mkdirSync(nowhere, { recursive: true });
    fs.copyFileSync(path.join(root, "sync.sh"), path.join(nowhere, "sync.sh"));
    const refused = run(nowhere, "bash", ["sync.sh"]);

    assert(refused.status === 1, `Outside a checkout it exits 1 (got ${refused.status}).`);
    assert(
      (refused.stderr + refused.stdout).includes("not a git checkout"),
      "and says why rather than failing silently."
    );

    console.log("\n  PASS: sync.sh updates a checkout completed.\n");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
