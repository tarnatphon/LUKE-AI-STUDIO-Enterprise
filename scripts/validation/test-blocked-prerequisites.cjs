#!/usr/bin/env node
"use strict";

/**
 * The gate has to say why it failed.
 *
 * A full sweep on a fresh checkout reported "25 failed". Every one of them was
 * the checkout: `vite` not installed, `app/dist` never built, Python's video
 * runtime absent. All 25 pass once those exist. Nothing about the code was
 * wrong, but the summary said "failed", so the next reader sees 25 regressions
 * and starts hunting one that does not exist — this project already lost an
 * afternoon to that reading.
 *
 * So a suite that could not run is *blocked*, not failed: it has no opinion
 * about the code, and it gets the one command that would let it speak. The
 * distinction is checked against the filesystem, never guessed, because
 * `Cannot find module './serve-typo.cjs'` is a bug in our own code and must
 * keep failing.
 *
 * Run: node scripts/validation/test-blocked-prerequisites.cjs
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const blockedPrerequisites = require("./blocked-prerequisites.cjs");
const { missingPrerequisite, remedyForModule, barePackageName, groupByRemedy } = blockedPrerequisites;

const root = path.resolve(__dirname, "..", "..");
const runAll = path.join(__dirname, "run-all.cjs");
const eslintSuite = path.join(__dirname, "test-eslint-correctness.cjs");
const demoSuite = path.join(__dirname, "test-zzz-blocked-demo.cjs");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

console.log("\n=== the gate knows the difference between broken and uninstalled ===\n");

// ── what a package name is ──────────────────────────────────────────────────
check(barePackageName("@tauri-apps/api/window") === "@tauri-apps/api", "a scoped package keeps its scope and drops the subpath");
check(barePackageName("vite/dist/node") === "vite", "an unscoped one drops everything after the first slash");
check(barePackageName("./serve.cjs") === null, "a relative import is not a package");
check(barePackageName("node:fs") === null, "and neither is a builtin");

// ── a dependency that is genuinely absent ───────────────────────────────────
const absent = missingPrerequisite("Error: Cannot find module 'definitely-not-a-real-package-xyz'\n    at require (node:internal)");
check(absent && /is not installed/.test(absent.reason), "an absent package blocks the suite", JSON.stringify(absent));
check(/npm install/.test(absent.remedy), "with the command that installs it", absent.remedy);
check(absent.declared === false, "and it is a finding, not a declaration from the suite");

const absentEsm = missingPrerequisite("Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@not-installed-xyz/api' imported from /x/y.mjs");
check(absentEsm && absentEsm.reason.includes("@not-installed-xyz/api"), "the ESM form is read too", JSON.stringify(absentEsm));

// ── a bug in our own code is not a prerequisite ─────────────────────────────
check(missingPrerequisite("Error: Cannot find module './serve-typo.cjs'") === null,
  "a missing relative module stays a failure — that is a broken import, not a missing install");
check(missingPrerequisite("FAIL: 3 checks failed") === null, "and an ordinary assertion failure is untouched");
check(missingPrerequisite("") === null, "no output, no claim");

// ── the two things a checkout owes the suites ───────────────────────────────
const unbuilt = missingPrerequisite("Error: ENOENT: no such file or directory, open '/repo/app/dist/build-info.json'");
check(unbuilt && /app\/dist/.test(unbuilt.reason) && /run build/.test(unbuilt.remedy),
  "a missing build is a build, with the command that makes it", JSON.stringify(unbuilt));

const python = missingPrerequisite("FAIL: Python with imageio_ffmpeg is required for Duration Worker validation");
check(python && /imageio_ffmpeg/.test(python.reason) && /pip install/.test(python.remedy),
  "the Python video runtime names its own installer", JSON.stringify(python));

// ── a suite that says so itself ─────────────────────────────────────────────
const declared = missingPrerequisite("BLOCKED: eslint is not installed under app/frontend/node_modules\nREMEDY: npm ci --prefix app/frontend\n");
check(declared && declared.declared === true && declared.remedy === "npm ci --prefix app/frontend",
  "exit 3 plus BLOCKED:/REMEDY: is taken at its word", JSON.stringify(declared));

// ── the remedy points at the manifest that wants it ─────────────────────────
check(/app\/frontend/.test(remedyForModule("vite")), "vite is installed by the interface's manifest", remedyForModule("vite"));
check(/scripts\/server/.test(remedyForModule("jszip")), "jszip also by the server's — naming one would leave the other missing", remedyForModule("jszip"));
check(/^npm install /.test(remedyForModule("some-package-nobody-declared")), "and an undeclared one is installed plainly");

const grouped = groupByRemedy([
  { name: "a.cjs", blocked: { remedy: "npm ci --prefix app/frontend" } },
  { name: "b.cjs", blocked: { remedy: "npm ci --prefix app/frontend" } },
  { name: "c.cjs", blocked: { remedy: "npm --prefix app/frontend run build" } },
]);
check(grouped.length === 2 && grouped.find((group) => group.names.length === 2), "blocked suites are grouped by the command that frees them");

// ── the eslint suite no longer passes a check it never ran ──────────────────
check(/process\.exit\(3\)/.test(fs.readFileSync(eslintSuite, "utf8")),
  "a suite that cannot read the code exits 3 instead of returning quietly as a pass");

// ── a suite whose premise was false now says so instead of passing ─────────
const distSuiteSource = fs.readFileSync(path.join(__dirname, "test-frontend-dist-freshness.cjs"), "utf8");
check(/REMEDY: npm --prefix app\/frontend run build/.test(distSuiteSource),
  "with no build present, the dist check asks for a build rather than promising a check it cannot make");
check(!/then commit app\/dist/.test(distSuiteSource),
  "and no longer advises committing a folder that .gitignore excludes");
{
  const ignored = spawnSync("git", ["check-ignore", "-q", "app/dist"], { cwd: root });
  check(ignored.status === 0,
    "app/dist really is ignored, which is why the old header was wrong — and why nothing is committed to go stale",
    `git check-ignore exit ${ignored.status}`);
}

// ── end to end: run-all reports BLOCK, and --allow-blocked frees the gate ───
const runAllSource = fs.readFileSync(runAll, "utf8");
check(runAllSource.includes("blocked-prerequisites.cjs"), "the sweep asks the same module");
check(runAllSource.includes("Blocked — nothing was tested"), "and says plainly that nothing was tested");

try {
  fs.writeFileSync(demoSuite, [
    "#!/usr/bin/env node",
    "\"use strict\";",
    "console.log(\"BLOCKED: the demonstration package is not installed\");",
    "console.log(\"REMEDY: npm install demonstration-package\");",
    "process.exit(3);",
    "",
  ].join("\n"));

  const blockedRun = spawnSync(process.execPath, [runAll, "--filter", "test-zzz-blocked-demo", "--no-report"], {
    cwd: root, encoding: "utf8", timeout: 60000,
  });
  check(/BLOCK\s+test-zzz-blocked-demo/.test(blockedRun.stdout), "run-all labels it BLOCK, not FAIL", blockedRun.stdout.trim().split("\n").slice(-3).join(" | "));
  check(/0 passed · 0 failed · 1 blocked/.test(blockedRun.stdout), "the summary counts it apart from failures");
  check(blockedRun.status === 1, "and the gate does not pass while a suite could not speak", `exit ${blockedRun.status}`);

  const allowedRun = spawnSync(process.execPath, [runAll, "--filter", "test-zzz-blocked-demo", "--no-report", "--allow-blocked"], {
    cwd: root, encoding: "utf8", timeout: 60000,
  });
  check(allowedRun.status === 0, "--allow-blocked is for a machine that cannot install them", `exit ${allowedRun.status}`);
} finally {
  if (fs.existsSync(demoSuite)) fs.unlinkSync(demoSuite);
}

console.log(`\nPASS: ${checks} checks — blocked is a word the gate uses, and only when it is true.\n`);
