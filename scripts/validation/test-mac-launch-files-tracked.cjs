#!/usr/bin/env node
"use strict";

/**
 * Every path mac.sh needs from git must actually be in git.
 *
 * mac.sh is what the user runs to start the application. Some of the paths it
 * touches are machine state it creates itself — node_modules, the llama and
 * whisper backends, the bundled Node runtime. Others must arrive with the
 * checkout, because mac.sh reads them before setup has built anything:
 * app/dist/index.html, serve.cjs, setup.sh, git-local-state.sh, update.cjs.
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

  // mac.sh's own self-heal restores whatever index.html refers to but cannot
  // find, which only works if those bundles are in git too.
  const distIndex = path.join(root, "app", "dist", "index.html");
  assert(fs.existsSync(distIndex), "app/dist/index.html exists, which mac.sh checks first.");

  const assets = [
    ...new Set(
      (fs.readFileSync(distIndex, "utf8").match(/assets\/[A-Za-z0-9._-]+/g) || [])
    ),
  ].sort();

  assert(assets.length > 0, `index.html references ${assets.length} bundle files.`);

  const untrackedAssets = assets.filter(
    (asset) => !isTracked(path.join("app", "dist", asset))
  );

  assert(
    untrackedAssets.length === 0,
    `Every bundle mac.sh would try to self-heal is tracked (${untrackedAssets.length} are not).`
  );

  checkSelfHealSeesWholeTree();

  console.log("\n  PASS: mac.sh launch files are tracked completed.\n");
}

/**
 * index.html names only the entry point, so the old self-heal — which grepped
 * index.html for asset names — saw 3 of the 55 tracked files. The other 52 are
 * code-split chunks fetched when you open a view, so a missing one survived the
 * check and broke the app later.
 *
 * This runs mac.sh's own block, extracted from the file at runtime rather than
 * rewritten here, against a real deletion of a chunk index.html does not name.
 */
function checkSelfHealSeesWholeTree() {
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");

  const lines = fs.readFileSync(macSh, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith('if [[ -f "$DIST_INDEX" ]]'));
  assert(start >= 0, "Found mac.sh's dist self-heal block to run.");

  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === "fi") { end = i; break; }
  }
  assert(end > start, "The self-heal block has a closing fi.");

  const block = lines.slice(start, end + 1).join("\n");

  // A tracked chunk that index.html does not reference — exactly the case the
  // grep-based version could not see.
  const distIndexHtml = fs.readFileSync(path.join(root, "app", "dist", "index.html"), "utf8");
  const named = new Set(distIndexHtml.match(/assets\/[A-Za-z0-9._-]+/g) || []);
  const tracked = git(["ls-files", "app/dist"]).split("\n").filter(Boolean);
  const victim = tracked.find(
    (file) => file.startsWith("app/dist/assets/") && !named.has(file.replace("app/dist/", ""))
  );
  assert(Boolean(victim), `Found a tracked chunk index.html does not name (${victim}).`);

  // The block runs `git checkout -- app/dist`, which restores from the index.
  // Staged work therefore survives it, but an unstaged edit would be destroyed,
  // so that is the only state this needs to insist on — not a pristine tree,
  // which would make the suite unusable in the same commit that rebuilds dist.
  const unstaged = () => git(["diff", "--name-only", "--", "app/dist"]);
  assert(unstaged() === "", "app/dist has no unstaged edits for the self-heal to destroy.");

  const script = path.join(
    os.tmpdir(),
    `luke-selfheal-${process.pid}.sh`
  );
  fs.writeFileSync(
    script,
    [
      "#!/usr/bin/env bash",
      "set -uo pipefail",
      `SCRIPT_DIR=${JSON.stringify(root)}`,
      'APP_DIR="$SCRIPT_DIR/app"',
      'DIST_INDEX="$APP_DIR/dist/index.html"',
      block,
      "",
    ].join("\n")
  );

  try {
    const quiet = execFileSync("bash", [script], { encoding: "utf8" });
    assert(
      !quiet.includes("Restoring"),
      "With every file present the block stays quiet and restores nothing."
    );

    fs.rmSync(path.join(root, victim));
    const healed = execFileSync("bash", [script], { encoding: "utf8" });

    assert(
      healed.includes("Restoring missing frontend files"),
      `Deleting ${path.basename(victim)}, which index.html never mentions, is detected.`
    );
    assert(
      fs.existsSync(path.join(root, victim)),
      "and the block restored it."
    );
  } finally {
    fs.rmSync(script, { force: true });
    execFileSync("git", ["checkout", "--", "app/dist"], { cwd: root });
  }

  assert(unstaged() === "", "app/dist has no unstaged edits afterwards either.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
