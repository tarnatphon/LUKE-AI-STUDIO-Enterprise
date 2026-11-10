#!/usr/bin/env node
"use strict";

/**
 * The scripts have to run on the shell the Mac actually has.
 *
 * `./validate.sh` — the one command the README tells a user to run — died on
 * macOS before the first suite:
 *
 *   ./validate.sh: line 86: PASSTHROUGH[@]: unbound variable
 *
 * macOS ships bash 3.2 (2007). Under `set -u` it treats an expansion of an empty
 * array as an unbound variable; bash 4.4 made that legal. So the line is fine on
 * every Linux box and CI image, and fails on the machine the app is launched
 * from. It was tested where nobody lives.
 *
 * There is no way to install bash 3.2 here to run the scripts against, so the
 * check reads the source instead: an empty array expanded bare under `set -u` is
 * the bug, `${arr[@]+"${arr[@]}"}` or a `${#arr[@]}` guard is the fix, and
 * constructs 3.2 never had (`declare -A`, `mapfile`, `${x,,}`) are called out
 * separately because they fail louder but for the same reason.
 *
 * Run: node scripts/validation/test-shell-bash32.cjs
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { findUnsafeArrayExpansions, findModernBashisms, usesStrictUnset } = require("./bash32-lint.cjs");

const root = path.resolve(__dirname, "..", "..");
const validateScript = path.join(root, "validate.sh");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

function shellScripts(dir = root, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) shellScripts(full, found);
    else if (/\.(sh|command)$/.test(entry.name)) found.push(full);
  }
  return found;
}

console.log("\n=== the scripts run on the shell the Mac actually has (bash 3.2) ===\n");

// ── the bug, and the two ways to avoid it ──────────────────────────────────
const bug = 'set -u\nPASSTHROUGH=()\nnode run-all.cjs "${PASSTHROUGH[@]}"\n';
check(findUnsafeArrayExpansions(bug).length === 1, "an empty array expanded bare under set -u is found");

const alternative = 'set -u\nPASSTHROUGH=()\nnode run-all.cjs ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}\n';
check(findUnsafeArrayExpansions(alternative).length === 0, "the ${arr[@]+…} form is not reported");

const guarded = 'set -u\nSTATE=()\nif [[ "${#STATE[@]}" -gt 0 ]]; then\n  for f in "${STATE[@]}"; do echo "$f"; done\nfi\n';
check(findUnsafeArrayExpansions(guarded).length === 0, "nor is a loop behind a ${#arr[@]} guard — sync.sh does this");

const populated = 'set -u\nNAMES=(\n  "a"\n  "b"\n)\nfor n in "${NAMES[@]}"; do echo "$n"; done\n';
check(findUnsafeArrayExpansions(populated).length === 0, "nor an array that is actually filled");

const noStrict = 'PASSTHROUGH=()\nnode run-all.cjs "${PASSTHROUGH[@]}"\n';
check(findUnsafeArrayExpansions(noStrict).length === 0, "without set -u an empty array is legal on 3.2, so it is not reported");

check(findModernBashisms("declare -A map\n").length === 1, "declare -A is called out separately");
check(findModernBashisms('echo "${name,,}"\n').length === 1, "and ${name,,}");
check(findModernBashisms("# declare -A in a comment is not code\n").length === 0, "a comment is not code");

// ── every script in the tree ───────────────────────────────────────────────
const scripts = shellScripts();
check(scripts.length >= 25, "the whole tree is read, not one file", `${scripts.length} scripts`);

const strictCount = scripts.filter((file) => usesStrictUnset(fs.readFileSync(file, "utf8"))).length;
check(strictCount >= 10, "including the ones that run under set -u", `${strictCount} strict scripts`);

const unsafe = [];
const modern = [];
for (const file of scripts) {
  const source = fs.readFileSync(file, "utf8");
  for (const finding of findUnsafeArrayExpansions(source)) unsafe.push(`${path.relative(root, file)}:${finding.line} ${finding.text}`);
  for (const finding of findModernBashisms(source)) modern.push(`${path.relative(root, file)}:${finding.line} ${finding.phrase}`);
}
check(unsafe.length === 0, "no script expands an empty array bare under set -u", unsafe.join(" | "));
check(modern.length === 0, "no script uses a construct bash 3.2 does not have", modern.join(" | "));

// ── validate.sh still forwards the flags it does not consume ───────────────
// The unbound expansion only bit when there were no passthrough flags, so the
// empty case is the one that has to be exercised: --no-install and --no-build
// are consumed here, leaving nothing to forward except the filter itself.
const forwarded = spawnSync("bash", [validateScript, "--no-install", "--no-build", "--filter", "test-blocked-prerequisites"], {
  cwd: root, encoding: "utf8", timeout: 300000,
});
check(forwarded.status === 0, "validate.sh completes and forwards --filter to the sweep", `exit ${forwarded.status}`);
check(/--filter test-blocked-prerequisites/.test(forwarded.stdout), "the suite it was asked for is the suite it ran");
check(/PASS: \d+ checks/.test(forwarded.stdout), "and that suite's own result came through");

// ── and the fixed line is the fixed line ───────────────────────────────────
const validateSource = fs.readFileSync(validateScript, "utf8");
check(/\$\{PASSTHROUGH\[@\]\+"\$\{PASSTHROUGH\[@\]\}"\}/.test(validateSource),
  "validate.sh expands its passthrough array the 3.2-safe way, with the reason written beside it");
check(/bash 3\.2/.test(validateSource), "and the comment says why, so nobody tidies it back");

console.log(`\nPASS: ${checks} checks — the scripts survive bash 3.2, the one that broke them.\n`);
