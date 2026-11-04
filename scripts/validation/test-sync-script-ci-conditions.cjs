"use strict";

/**
 * CI-condition regression for test-sync-script.cjs.
 *
 * PR #83's first CI run failed at this suite, a rerun passed, and the reason
 * was never recoverable: the report showed only the last passing ✓ line. Two
 * separate defects made that possible.
 *
 *   1. The fixture inherited the runner's GLOBAL git config. A runner with
 *      `commit.gpgsign=true`, `user.useConfigOnly=true` or a `core.hooksPath`
 *      makes every `git commit` in the fixture fail instantly, while the same
 *      suite passes on a developer machine with a clean config. That is the
 *      reproducible "passes here, fails in CI" class.
 *   2. run-all.cjs kept `lastMeaningfulLine(result.stdout || result.stderr)`,
 *      so once a ✓ line had been printed, an error on stderr was discarded and
 *      the CI annotation named the last passing check instead of the failure.
 *
 * This suite reproduces BOTH conditions on purpose and asserts they are gone.
 * It also proves the hostile config is genuinely hostile (a control run), so
 * the test cannot pass vacuously.
 *
 * Run: node scripts/validation/test-sync-script-ci-conditions.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-sync-ci-"));
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Git used to BUILD fixtures: hermetic on purpose, so the environment under
 *  test cannot leak into the fixture setup itself. */
const CLEAN_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
function cleanGit(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: CLEAN_ENV });
}

const HOSTILE_CONFIG = path.join(temp, "hostile.gitconfig");
fs.writeFileSync(HOSTILE_CONFIG, [
  "[user]",
  "\tuseConfigOnly = true",
  "[commit]",
  "\tgpgsign = true",
  "[core]",
  `\thooksPath = ${path.join(temp, "hooks-that-do-not-exist")}`,
  "[init]",
  "\tdefaultBranch = unrelated-name",
  "",
].join("\n"));
const HOSTILE_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: HOSTILE_CONFIG,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  CI: "1",
};

function main() {
  console.log("sync.sh CI-condition regression");

  section("1. The hostile config really is hostile (control)");
  const control = path.join(temp, "control");
  fs.mkdirSync(control);
  for (const [args, label] of [
    [["init", "--quiet"], "init"],
    [["config", "user.email", "control@example.invalid"], "email"],
    [["config", "user.name", "control"], "name"],
  ]) {
    cleanGit(control, args);
    void label;
  }
  fs.writeFileSync(path.join(control, "a.txt"), "control\n");
  cleanGit(control, ["add", "a.txt"]);
  const controlCommit = spawnSync("git", ["commit", "--quiet", "-m", "control"], {
    cwd: control, encoding: "utf8", env: HOSTILE_ENV,
  });
  check("a plain git commit FAILS under the runner-style global config",
    controlCommit.status !== 0,
    `status=${controlCommit.status}`);
  check("and it fails for a config reason, not a missing repo",
    /gpg|sign|hooks|useConfigOnly/i.test(`${controlCommit.stderr}${controlCommit.stdout}`));

  section("2. The suite passes from a detached-HEAD CI checkout under that config");
  const ci = path.join(temp, "ci-checkout");
  const cloned = cleanGit(root, ["clone", "--quiet", "--no-hardlinks", "--single-branch", root, ci]);
  check("built a single-branch CI-style clone", cloned.status === 0, String(cloned.stderr || "").trim());
  cleanGit(ci, ["checkout", "--quiet", "--detach", "HEAD"]);
  check("the clone is on a detached HEAD like actions/checkout",
    cleanGit(ci, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() === "HEAD");
  // A clone replays COMMITTED state. This suite is normally run while its own
  // fix is still uncommitted, so copy the working-tree version in: otherwise
  // the check below would pass/fail against stale code instead of this patch.
  fs.copyFileSync(
    path.join(root, "scripts", "validation", "test-sync-script.cjs"),
    path.join(ci, "scripts", "validation", "test-sync-script.cjs")
  );

  const suite = spawnSync(process.execPath, [
    path.join(ci, "scripts", "validation", "test-sync-script.cjs"),
  ], { cwd: ci, encoding: "utf8", env: HOSTILE_ENV, timeout: 120000 });
  check("test-sync-script.cjs exits 0 under detached HEAD + hostile config",
    suite.status === 0,
    String(suite.stdout || "").trim().split("\n").slice(-3).join(" | "));
  check("and it completes both scenarios",
    (suite.stdout || "").includes("PASS: sync.sh updates a checkout completed."));
  check("no gpg / hooks / config error leaked into the run",
    !/gpg failed|failed to write commit object|cannot run gpg/i.test(`${suite.stdout}${suite.stderr}`));

  section("3. A failing suite's stderr reason is no longer discarded");
  const probe = path.join(__dirname, "test-zz-ci-note-probe.cjs");
  const marker = "CI_NOTE_PROBE_REASON_42";
  fs.writeFileSync(probe, [
    '"use strict";',
    'console.log("  ✓ a passing check was printed first");',
    `console.error("${marker}");`,
    "process.exit(1);",
    "",
  ].join("\n"));
  try {
    const runner = spawnSync(process.execPath, [
      path.join(__dirname, "run-all.cjs"),
      "--filter", "test-zz-ci-note-probe",
      "--bail", "--no-report", "--no-shell-check", "--timeout", "20",
    ], { cwd: root, encoding: "utf8", timeout: 60000 });
    check("run-all reports the failing probe", (runner.stdout || "").includes("FAIL"));
    check("the report names the STDERR reason, not the last ✓ line",
      (runner.stdout || "").includes(marker),
      (runner.stdout || "").trim().split("\n").filter((l) => /FAIL|✓|PROBE/.test(l)).slice(-3).join(" | "));
  } finally {
    fs.rmSync(probe, { force: true });
  }

  section("4. The suite is hermetic by construction");
  const source = fs.readFileSync(path.join(root, "scripts", "validation", "test-sync-script.cjs"), "utf8");
  check("every clone uses --no-hardlinks",
    (source.match(/"clone", "--quiet", "--no-hardlinks"/g) || []).length === 4);
  check("every clone goes through gitArgs()",
    (source.match(/gitArgs\(\["clone"/g) || []).length === 4);
  check("global + system git config are neutralised",
    /GIT_CONFIG_GLOBAL: os\.devNull/.test(source) && /GIT_CONFIG_SYSTEM: os\.devNull/.test(source));
  check("signing, hooks and autocrlf are explicitly disabled",
    /commit\.gpgsign=false/.test(source) && /core\.hooksPath=\/dev\/null/.test(source)
    && /core\.autocrlf=false/.test(source));
  check("sync.sh itself runs with the same hermetic env",
    /spawnSync\(command, args, \{ cwd, encoding: "utf8", env: GIT_ENV \}\)/.test(source));
  const runnerSource = fs.readFileSync(path.join(root, "scripts", "validation", "run-all.cjs"), "utf8");
  check("run-all reads stdout AND stderr for a failing suite",
    /\$\{result\.stdout \|\| ""\}\\n\$\{result\.stderr \|\| ""\}/.test(runnerSource));

}

try {
  main();
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const probe = path.join(__dirname, "test-zz-ci-note-probe.cjs");
  if (fs.existsSync(probe)) fs.rmSync(probe, { force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
