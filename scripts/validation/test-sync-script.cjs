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
 *   an update that stops tracking a protected file deletes it from the
 *     working tree and the script puts the user's copy back
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

  // The fixture branch is named here rather than read out of the checkout this
  // suite happens to run in: actions/checkout leaves GitHub Actions on a
  // detached HEAD, and "HEAD" is not a name anybody can clone. Every clone
  // below is put on the branch at whatever commit this checkout is on, which
  // is the state the script requires — a named branch, not a detached one.
  const branch = "fixture";

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-sync-"));
  const origin = path.join(temp, "origin");
  const user = path.join(temp, "user");

  try {
    // A throwaway origin cloned from the real repository, so the script is
    // exercised against the actual tree, .gitignore and paths — not a model of
    // them. Cloning locally needs no network.
    execFileSync(
      "git",
      ["clone", "--quiet", root, origin],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    // A clone of a detached HEAD is detached as well, so the branch the clones
    // below ask for is created here rather than inherited.
    git(origin, ["checkout", "-B", branch]);
    assert(
      git(origin, ["rev-parse", "--abbrev-ref", "HEAD"]) === branch,
      "The fixture origin is on a branch, which the script requires."
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

    // The user stays on the origin's HEAD, and the simulated update below is
    // what makes them one commit behind — the ordinary state of a machine that
    // has been used since the last update.
    const behind = git(user, ["rev-parse", "--short", "HEAD"]);

    // The update being applied must not itself change sync.sh: git refuses to
    // fast-forward over a locally modified file, and the copy below is what
    // makes the script under test the one that runs — the file actually on
    // disk, including edits that have not been committed yet. A reset to
    // HEAD~1 instead would put a whole generation of sync.sh into the update
    // range and fail for that reason, which tests git, not the script.
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

    // ── Scenario 2: an update that stops tracking a protected file ─────────
    //
    // The image-to-video install record was tracked, so a local install
    // modified it, and the update that moves it out of git would delete it
    // from the working tree. The user's copy is theirs, not the machine's:
    // the script has to carry it through, byte for byte.
    //
    // The commit where that is true is built here rather than dug out of the
    // checkout's history. Whether the branch this suite happens to run on has
    // already made the move is not this suite's business — and it cannot be
    // looked up reliably, because app/runtimes/ is gitignored and so a clone
    // of any branch has no record file to find in the first place.

    const recordFile = "app/runtimes/image-to-video/install-status.json";
    const recordFile2 = "app/runtimes/image-to-video/installed.json";

    const origin2 = path.join(temp, "origin2");
    const user2 = path.join(temp, "user2");

    execFileSync(
      "git",
      ["clone", "--quiet", root, origin2],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    git(origin2, ["checkout", "-B", branch]);
    git(origin2, ["config", "user.email", "sync-test@example.invalid"]);
    git(origin2, ["config", "user.name", "sync test"]);

    // The premise, made true on purpose: at this commit both records are
    // tracked. -f because the folder is gitignored, which is the whole reason
    // the next commit has to untrack them.
    const shippedRecord = JSON.stringify({ state: "ready", step: "Complete" }, null, 2);
    const shippedRecord2 = JSON.stringify({ capability: "image-to-video", installed: true }, null, 2);
    fs.mkdirSync(path.join(origin2, "app", "runtimes", "image-to-video"), { recursive: true });
    fs.writeFileSync(path.join(origin2, recordFile), shippedRecord);
    fs.writeFileSync(path.join(origin2, recordFile2), shippedRecord2);
    git(origin2, ["add", "-f", recordFile, recordFile2]);
    git(origin2, ["commit", "--quiet", "-m", "the install records are tracked at this point"]);

    execFileSync(
      "git",
      ["clone", "--quiet", "--branch", branch, "--single-branch", origin2, user2],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    git(user2, ["config", "user.email", "user@example.invalid"]);
    git(user2, ["config", "user.name", "user"]);

    // The user is on the commit that still tracked the records, and the branch
    // keeps its real name, so the script's fetch lands the way it does on a
    // real single-branch clone.

    // The app writes these during an install; simulate a machine that has
    // installed the runtime since the last update.
    const userRecord = JSON.stringify({
      state: "ready",
      step: "Complete",
      message: "Image-to-Video is installed and ready.",
      manifest: { capability: "image-to-video", installed: true, python: "/Volumes/ai/app/runtimes/image-to-video/venv/bin/python" },
    }, null, 2);
    const userRecord2 = JSON.stringify({
      capability: "image-to-video",
      installed: true,
      python: "/Volumes/ai/app/runtimes/image-to-video/venv/bin/python",
    }, null, 2);
    // app/runtimes/ is machine-local and gitignored, so it is not in the
    // clone this scenario starts from. The suite's whole point is to write a
    // record into that folder, so it has to make the folder first — the way
    // the app does when it installs the capability.
    fs.mkdirSync(path.join(user2, "app", "runtimes", "image-to-video"), { recursive: true });
    fs.writeFileSync(path.join(user2, recordFile), userRecord);
    fs.writeFileSync(path.join(user2, recordFile2), userRecord2);

    fs.copyFileSync(path.join(root, "sync.sh"), path.join(user2, "sync.sh"));

    // The update: stop tracking both records and ignore them.
    git(origin2, ["rm", "--cached", "--quiet", recordFile, recordFile2]);
    fs.appendFileSync(
      path.join(origin2, ".gitignore"),
      "\napp/runtimes/image-to-video/installed.json\napp/runtimes/image-to-video/install-status.json\n"
    );
    git(origin2, ["add", ".gitignore"]);
    git(origin2, ["commit", "--quiet", "-m", "stop tracking the image-to-video install record"]);
    const recordAhead = git(origin2, ["rev-parse", "--short", "HEAD"]);

    const transition = run(user2, "bash", ["sync.sh"]);

    console.log(
      transition.stdout
        .split("\n")
        .filter((line) => line.includes("[sync]"))
        .map((line) => `    ${line.trim()}`)
        .join("\n")
    );

    assert(transition.status === 0, `The untrack transition exits 0 (got ${transition.status}).`);
    assert(
      git(user2, ["rev-parse", "--short", "HEAD"]) === recordAhead,
      `The checkout fast-forwarded past the untrack (${recordAhead}).`
    );
    assert(
      fs.readFileSync(path.join(user2, recordFile), "utf8") === userRecord,
      "The user's install record is byte-identical afterwards."
    );
    assert(
      fs.readFileSync(path.join(user2, recordFile2), "utf8") === userRecord2,
      "The user's install manifest is byte-identical afterwards."
    );
    // The test's own script copy is the one file it is allowed to leave
    // modified. Match on the path, because the helper trims the status
    // output and would eat the line's leading space.
    const dirt = git(user2, ["status", "--porcelain"])
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.trimEnd().endsWith("sync.sh"));

    assert(
      dirt.length === 0,
      dirt.length > 0
        ? `the checkout is clean apart from the test's own script copy - it is not (${dirt.join(", ")})`
        : "and the checkout is clean apart from the test's own script copy: the records are local, ignored, and accounted for."
    );

    const transitionAgain = run(user2, "bash", ["sync.sh"]);
    assert(transitionAgain.status === 0, `Running the transition again exits 0 (got ${transitionAgain.status}).`);
    assert(
      fs.readFileSync(path.join(user2, recordFile), "utf8") === userRecord,
      "and the record is still exactly the user's."
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
