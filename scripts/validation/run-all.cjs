#!/usr/bin/env node
"use strict";

/**
 * Runs every validation suite in this folder and aggregates the result.
 *
 * The suites are plain `node` scripts that exit non-zero when an assertion
 * fails, so this runner only has to discover them, give each one a time
 * budget, and report the ones that did not pass. It is what CI calls, but it
 * runs just as well on a laptop:
 *
 *   node scripts/validation/run-all.cjs                 # everything
 *   node scripts/validation/run-all.cjs --filter zip    # only matching names
 *   node scripts/validation/run-all.cjs --list          # names, run nothing
 *   node scripts/validation/run-all.cjs --bail          # stop at the first failure
 *
 * Notes:
 * - The suites are run one at a time. Several of them bind ports and boot the
 *   server, so running them in parallel produces flaky failures.
 * - Server dependencies (jszip, @aws-sdk/*, ...) live in scripts/server and must
 *   be installed first: `npm ci --prefix scripts/server`. Without them the
 *   suites that require serve.cjs fail with MODULE_NOT_FOUND.
 * - The Python suite is opt-in because it needs third-party packages that are
 *   not part of the repo install (imageio_ffmpeg, ...).
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");
const REPORT_DIR = path.join(ROOT, "validation-reports");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const filter = valueOf("--filter", "");
const listOnly = has("--list");
const bail = has("--bail");
const verbose = has("--verbose");
const includePython = has("--include-python");
const includeShell = !has("--no-shell-check");
const writeReport = !has("--no-report");
const strict = has("--strict");
const timeoutMs = Math.max(1, Number(valueOf("--timeout", "180"))) * 1000;

/**
 * Suites that are known to fail, with the reason they are still here.
 *
 * A suite listed here that fails counts as an expected failure (XFAIL) and does
 * not fail the run, so CI stays green while the debt is visible. A listed suite
 * that starts passing is reported as XPASS, which is a prompt to delete its
 * entry. Anything not listed has to pass.
 *
 * Pass --strict to ignore this file and fail on every non-zero exit.
 */
const BASELINE_FILE = path.join(HERE, "ci-baseline.json");

function normaliseEntry(name, value) {
  if (typeof value === "string") return { name, reason: value, platforms: null };
  return {
    name,
    reason: (value && value.reason) || "(no reason given)",
    platforms: Array.isArray(value && value.platforms) && value.platforms.length ? value.platforms : null,
  };
}

function loadBaseline() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    return new Map(
      Object.entries(parsed.suites || {}).map(([name, value]) => [name, normaliseEntry(name, value)])
    );
  } catch (err) {
    if (err.code !== "ENOENT") {
      process.stderr.write(`(could not read ${path.relative(ROOT, BASELINE_FILE)}: ${err.message})\n`);
    }
    return new Map();
  }
}

function discover() {
  const suites = [];
  for (const name of fs.readdirSync(HERE).sort()) {
    const full = path.join(HERE, name);
    if (/^test-.*\.cjs$/.test(name) || /^test-.*\.mjs$/.test(name)) {
      suites.push({ name, command: process.execPath, args: [full] });
    } else if (/^test_.*\.py$/.test(name)) {
      if (includePython) suites.push({ name, command: "python3", args: [full] });
      else suites.push({ name, command: null, args: [], skip: "needs imageio_ffmpeg (use --include-python)" });
    }
  }
  // The release gate is a shell script, kept last so it validates a tree that
  // the node suites have already exercised.
  if (includeShell) {
    const shellSuite = path.join(HERE, "validate-release.sh");
    if (fs.existsSync(shellSuite)) {
      suites.push({ name: "validate-release.sh", command: "bash", args: [shellSuite] });
    }
  }
  return suites.filter((s) => !filter || s.name.includes(filter));
}

function lastMeaningfulLine(output) {
  const lines = String(output || "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i].trim();
    if (/^(PASS|FAIL|ok|✓)/i.test(l) || /error|fail/i.test(l)) return l.slice(0, 120);
  }
  return lines.length ? lines[lines.length - 1].trim().slice(0, 120) : "";
}

function runSuite(suite) {
  const started = Date.now();
  const result = spawnSync(suite.command, suite.args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI || "1", FORCE_COLOR: "0" },
  });
  const ms = Date.now() - started;
  if (verbose) process.stdout.write(result.stdout || "");
  const timedOut = result.error && result.error.code === "ETIMEDOUT";
  const ok = !result.error && result.status === 0;
  return {
    name: suite.name,
    ok,
    ms,
    timedOut,
    status: result.status,
    note: timedOut ? `timed out after ${timeoutMs / 1000}s` : lastMeaningfulLine(result.stdout || result.stderr),
    output: timedOut ? result.stdout || "" : `${result.stdout || ""}${result.stderr || ""}`,
  };
}

const suites = discover();

if (listOnly) {
  for (const s of suites) process.stdout.write(`${s.skip ? "skip" : "run "}  ${s.name}${s.skip ? `  (${s.skip})` : ""}\n`);
  process.exit(0);
}

if (suites.length === 0) {
  process.stderr.write(`no suites matched ${filter ? `"${filter}"` : "(nothing to run)"}\n`);
  process.exit(1);
}

process.stdout.write(`Running ${suites.length} validation suite(s) · timeout ${timeoutMs / 1000}s each\n\n`);

const results = [];
const baseline = strict ? new Map() : loadBaseline();
for (const suite of suites) {
  if (suite.skip) {
    results.push({ name: suite.name, skipped: true, note: suite.skip, ms: 0 });
    process.stdout.write(`SKIP  ${suite.name}  (${suite.skip})\n`);
    continue;
  }
  const result = runSuite(suite);
  const known = baseline.get(suite.name);
  const applies = known && (!known.platforms || known.platforms.includes(process.platform));
  if (result.ok) {
    result.state = applies ? "xpass" : "pass";
  } else {
    result.state = applies && !strict ? "xfail" : "fail";
    result.knownReason = applies ? known.reason : undefined;
  }
  results.push(result);
  const label = { pass: "PASS ", xfail: "XFAIL", xpass: "XPASS", fail: "FAIL ", skip: "SKIP " }[result.state];
  process.stdout.write(`${label}  ${result.name}  ${result.ms}ms  ${result.note}\n`);
  if (result.state === "fail" && bail) {
    process.stdout.write("\n--bail: stopping at the first failure\n");
    break;
  }
}

const passed = results.filter((r) => r.state === "pass");
const xpassed = results.filter((r) => r.state === "xpass");
const failed = results.filter((r) => r.state === "fail");
const xfailed = results.filter((r) => r.state === "xfail");
const skipped = results.filter((r) => r.skipped);
const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

process.stdout.write(`\n${"-".repeat(60)}\n`);
process.stdout.write(
  `${passed.length} passed · ${failed.length} failed · ${xfailed.length} known-failing · ${xpassed.length} xpassed · ${skipped.length} skipped · ${(totalMs / 1000).toFixed(1)}s\n`
);

if (xfailed.length) {
  process.stdout.write("\nKnown-failing (tracked in ci-baseline.json, not blocking):\n");
  for (const f of xfailed) {
    process.stdout.write(`  ${f.name}${f.knownReason ? ` — ${f.knownReason}` : ""}\n`);
  }
}

if (xpassed.length) {
  process.stdout.write("\nNow passing but still listed as known-failing — remove them from ci-baseline.json:\n");
  for (const f of xpassed) process.stdout.write(`  ${f.name}\n`);
}

if (failed.length) {
  process.stdout.write("\nFailures:\n");
  for (const f of failed) {
    process.stdout.write(`\n  ${f.name}${f.timedOut ? " (timed out)" : ` (exit ${f.status})`}\n`);
    const tail = String(f.output).trim().split("\n").slice(-12);
    for (const line of tail) process.stdout.write(`    ${line}\n`);
  }
}

if (writeReport) {
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const file = path.join(REPORT_DIR, `run-all-${stamp}.txt`);
    const body = [
      `LUKE AI STUDIO — validation run`,
      `when:    ${new Date().toISOString()}`,
      `node:    ${process.version}`,
      `platform: ${process.platform} ${process.arch}`,
      `command: ${process.argv.slice(1).join(" ")}`,
      "",
      `${passed.length} passed · ${failed.length} failed · ${xfailed.length} known-failing · ${xpassed.length} xpassed · ${skipped.length} skipped · ${(totalMs / 1000).toFixed(1)}s`,
      "",
      ...results.map((r) => {
        const state = r.skipped ? "SKIP" : r.state.toUpperCase();
        return `${state}  ${r.name}  ${r.ms}ms  ${r.note}`;
      }),
      "",
      ...(failed.length ? ["Failures:", ...failed.map((f) => `\n### ${f.name} (exit ${f.status})\n${f.output}`)] : []),
      ...(xfailed.length ? ["", "Known-failing:", ...xfailed.map((f) => `  ${f.name}${f.knownReason ? ` — ${f.knownReason}` : ""}`)] : []),
    ].join("\n");
    fs.writeFileSync(file, body);
    process.stdout.write(`\nreport: ${path.relative(ROOT, file)}\n`);
  } catch (err) {
    process.stdout.write(`\n(could not write report: ${err.message})\n`);
  }
}

process.exit(failed.length ? 1 : 0);
