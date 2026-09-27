#!/usr/bin/env node
"use strict";

/**
 * Every path mac.sh needs from git must actually be in git.
 *
 * mac.sh is what the user runs to start the application. Some of the paths it
 * touches are machine state it creates itself — node_modules, the llama and
 * whisper backends, the bundled Node runtime, and the built frontend under
 * app/dist. Others must arrive with the checkout, because mac.sh reads them
 * before setup has built anything: serve.cjs, setup.sh, git-local-state.sh,
 * update.cjs.
 *
 * app/dist used to be on that second list, and this suite used to insist it
 * was tracked. It is not any more: the frontend is built by setup
 * (`SETUP_REASON="Frontend build is missing."` is what mac.sh reports when
 * index.html is absent) and the folder is gitignored, so a clean checkout has
 * none of it. What is still worth pinning is that a build which is there is
 * complete — see the dist block below.
 *
 * If one of those is ever untracked or gitignored, `bash sync.sh` will never
 * deliver it and the app fails to start on the user's machine while looking
 * perfectly healthy here. This reads mac.sh's own references rather than a
 * hand-written list, so it cannot drift out of step with the script.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const macSh = path.join(root, "mac.sh");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * `git ls-files --error-unmatch` exits non-zero for a path that is not in the
 * index, and execFileSync turns that into a throw rather than a string. Asking
 * it and comparing the output therefore only worked while app/dist happened to
 * be clean; the first newly built bundle crashed this suite instead of being
 * reported by it.
 */
function isTracked(relative) {
  try {
    return git(["ls-files", "--error-unmatch", relative]) === relative;
  } catch {
    return false;
  }
}

// Roots mac.sh creates itself at install time; nothing in them comes from git.
const MACHINE_GENERATED = [
  "app/backend/",
  "app/llm-backend/",
  "app/speech-backend/",
  "app/tts-runtime/",
  "app/tools/",
  // The built frontend. setup.sh produces it, .gitignore excludes it, and a
  // checkout that has never run a build simply has no app/dist at all.
  "app/dist/",
  "app/frontend/node_modules",
  "app/frontend/.active_modules_os",
  "app/frontend/.test_symlink",
];

function main() {
  console.log("\n=== mac.sh launch files are tracked ===\n");

  assert(fs.existsSync(macSh), "mac.sh itself is there to read.");

  const source = fs.readFileSync(macSh, "utf8");

  // mac.sh builds every path from SCRIPT_DIR (the repo root) or APP_DIR
  // (repo root + "app"). Collect both forms.
  const referenced = new Set();
  const pattern = /\$(SCRIPT_DIR|APP_DIR|NODE_DIR)\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, variable, rest] = match;
    const relative =
      variable === "SCRIPT_DIR" ? rest
      : variable === "APP_DIR" ? path.join("app", rest)
      : path.join("app", "tools", "node-mac", rest);
    referenced.add(relative.replace(/\/+$/, ""));
  }

  assert(referenced.size > 0, `Read ${referenced.size} distinct paths out of mac.sh.`);

  const fromGit = [...referenced]
    .filter((p) => !MACHINE_GENERATED.some((prefix) => p.startsWith(prefix)))
    // A directory prefix such as "app/dist" or "app" is not a file to track.
    .filter((p) => path.extname(p) !== "" || p.includes("."))
    .sort();

  const machineState = [...referenced].filter((p) => MACHINE_GENERATED.some((prefix) => p.startsWith(prefix)));

  console.log(`  referenced: ${referenced.size} · must come from git: ${fromGit.length} · machine state: ${machineState.length}`);

  const missing = fromGit.filter((relative) => !isTracked(relative));

  if (missing.length) console.log(`  not tracked: ${missing.join(", ")}`);

  assert(
    missing.length === 0,
    `All ${fromGit.length} files mac.sh needs from the checkout are tracked (${missing.length} are not).`
  );

  const ignored = fromGit.filter((relative) => {
    try {
      execFileSync("git", ["check-ignore", "-q", relative], { cwd: root, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });

  assert(
    ignored.length === 0,
    `None of them is gitignored, so sync.sh can deliver them (${ignored.length} are).`
  );

  // The built frontend, if this checkout has one. mac.sh only asks whether
  // index.html exists, so a build that got as far as writing index.html and
  // not its bundles looks ready to it and breaks the app the first time a
  // view is opened.
  const distIndex = path.join(root, "app", "dist", "index.html");
  if (fs.existsSync(distIndex)) {
    const assets = [
      ...new Set(
        (fs.readFileSync(distIndex, "utf8").match(/assets\/[A-Za-z0-9._-]+/g) || [])
      ),
    ].sort();

    assert(assets.length > 0, `index.html references ${assets.length} bundle files.`);

    const missing = assets.filter(
      (asset) => !fs.existsSync(path.join(root, "app", "dist", asset))
    );

    assert(
      missing.length === 0,
      `Every bundle index.html references is on disk (${missing.length} are missing).`
    );
  } else {
    console.log("  – No app/dist/index.html here, which is what a checkout that has not built yet looks like.");
  }

  console.log("\n  PASS: mac.sh launch files are tracked completed.\n");
}

// The self-heal block at the top of mac.sh used to be covered here: it
// restores app/dist out of the git index, and this suite deleted a real
// bundle to watch it do so. It is not covered any more because it cannot
// be — `git ls-files app/dist` is empty now that the folder is build
// output, so the block finds nothing to restore and always stays quiet.
// The block itself is left in mac.sh untouched: deleting launcher code is
// a separate decision, and until then it is harmless rather than wrong.

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
