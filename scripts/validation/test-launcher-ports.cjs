#!/usr/bin/env node
"use strict";

/**
 * A second launch replaces the first one. It does not shoot it.
 *
 * Both launchers used to start with
 *
 *     lsof -t -i:1420 -i:8080 -i:10086 | xargs kill -9
 *
 * which kills by port, blindly, and never says so. Open a second window and the
 * second window SIGKILLs the first window's backend. The first window has no
 * handler for SIGKILL, so it prints the only thing it can — "Killed: 9" — in a
 * window that was working perfectly well, and its llama-server is left holding
 * port 10086 with nobody watching it. That is the reported bug.
 *
 * The replacement, stop_existing_servers, is the thing this suite runs: it asks
 * with SIGTERM, waits up to five seconds, escalates only for whatever is still
 * there, and names the port each PID is holding. Port discovery is replaced with
 * a stub `lsof` on PATH (this sandbox has no lsof at all), so the
 * kill/wait/escalate logic is exercised for real rather than grepped for.
 *
 * It also pins the second half of that fix: `lsof -t -i:1420` returns every
 * process with a socket on the port, clients included — the browser showing the
 * app, a curl tailing the log — and the launcher SIGTERMed all of them. It now
 * asks for `-sTCP:LISTEN` only, and prints the port and the command beside each
 * PID so a three-line takeover cannot be mistaken for three copies of the app.
 *
 * Run: node scripts/validation/test-launcher-ports.cjs
 */

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-ports-"));

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── the function, lifted out of the launcher that runs it ────────────────────
function extractHelper(file) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
  const start = lines.findIndex((line) => /^stop_existing_servers\(\) \{$/.test(line));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && line === "}");
  if (end === -1) return "";
  return lines.slice(start, end + 1).join("\n");
}

// A stub lsof: `lsof -t -i:PORT` would print the PIDs on that port; this prints
// the PID we told it to, once per port asked, so the dedupe gets exercised too.
const shimDir = path.join(temp, "shim");
fs.mkdirSync(shimDir, { recursive: true });
// The shim also records the arguments it was called with, so the suite can
// check *what the launcher asked for* — a listener, not every client.
fs.writeFileSync(
  path.join(shimDir, "lsof"),
  '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LSOF_LOG"\nprintf "%s\\n" "$FAKE_PIDS"\n',
  { mode: 0o755 }
);
const envWithShim = {
  ...process.env,
  PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
  FRONTEND_PORT: "14200",
  LLM_PORT: "14202",
};

// Asynchronous on purpose: the helper decides "still alive" with `kill -0`, and
// spawnSync would block this process's event loop, so the child we just killed
// would stay a zombie — still visible to `kill -0` — for the whole five-second
// wait, and every run would look like the escalation path.
let runCount = 0;
function runHelper(file, fakePids) {
  const started = Date.now();
  runCount += 1;
  const lsofLog = path.join(temp, `lsof-${runCount}.log`);
  fs.writeFileSync(lsofLog, "");
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", `set -euo pipefail\n${extractHelper(file)}\nstop_existing_servers`], {
      env: { ...envWithShim, FAKE_PIDS: fakePids, FAKE_LSOF_LOG: lsofLog },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30000);
    const finish = (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr, elapsed: Date.now() - started, lsofLog });
    };
    proc.on("exit", finish);
    proc.on("error", (error) => finish(null, String(error)));
  });
}

// A process we spawned stays in the table as a zombie until libuv reaps it, so
// `kill(pid, 0)` keeps succeeding for a moment after it is dead. Wait for the
// exit event instead.
function waitExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A child that stays up until it is killed. With `stubborn` it ignores SIGTERM,
// which is what a wedged llama-server looks like.
function sleeper(stubborn) {
  const code = stubborn
    ? "process.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000)"
    : "process.stdout.write('ready\\n');setInterval(()=>{},1000)";
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((resolve) => child.stdout.once("data", () => resolve(child)));
}

(async () => {
  for (const launcher of ["mac.sh", "linux.sh"]) {
    console.log(`\n  ${launcher}`);

    const source = fs.readFileSync(path.join(root, launcher), "utf8");
    const lines = source.split("\n");

    // ── nothing left to do when the ports are free ──────────────────────────
    const bystander = await sleeper(false);
    const quiet = await runHelper(launcher, "");
    check(quiet.status === 0, "a launch with free ports succeeds", `exit ${quiet.status} ${quiet.stderr}`);
    check(quiet.stdout === "", "and says nothing about processes it did not find", JSON.stringify(quiet.stdout));
    check(alive(bystander.pid) && bystander.exitCode === null, "and kills nothing");
    bystander.kill("SIGKILL");
    await waitExit(bystander, 3000);

    // ── an earlier copy that stops when asked ───────────────────────────────
    const polite = await sleeper(false);
    const asked = await runHelper(launcher, String(polite.pid));
    check(asked.status === 0, "stopping an earlier copy succeeds", `exit ${asked.status} ${asked.stderr}`);
    check(
      asked.stdout.includes("An earlier copy is still running — stopping it:"),
      "it says it is taking over",
      JSON.stringify(asked.stdout)
    );
    check(
      new RegExp(`\\n\\s+${polite.pid} {3}port 14200 {3}\\S`).test(asked.stdout),
      "and names the PID, the port that PID holds, and what the process is",
      JSON.stringify(asked.stdout)
    );
    check(
      (asked.stdout.match(/port 14200/g) || []).length === 1,
      "one line per PID, even though lsof is asked about three ports",
      JSON.stringify(asked.stdout)
    );
    check(
      /-sTCP:LISTEN/.test(fs.readFileSync(asked.lsofLog, "utf8")),
      "it asks lsof for the process holding the port, not the clients connected to it",
      fs.readFileSync(asked.lsofLog, "utf8").trim()
    );
    check(
      /-i:14200/.test(fs.readFileSync(asked.lsofLog, "utf8")),
      "and it asks about the frontend port it is about to bind",
      fs.readFileSync(asked.lsofLog, "utf8").trim()
    );
    const politeGone = await waitExit(polite, 3000);
    check(politeGone, "the earlier copy is gone");
    check(polite.signalCode === "SIGTERM", "because of SIGTERM", `signal ${polite.signalCode}`);
    check(!/ignored the request/.test(asked.stdout), "and it was not killed — it was asked");
    check(asked.elapsed < 4500, "the wait ends as soon as the process does, not after the full five seconds", `${asked.elapsed} ms`);
    if (!politeGone) polite.kill("SIGKILL");

    // ── an earlier copy that ignores SIGTERM ────────────────────────────────
    const stubborn = await sleeper(true);
    const forced = await runHelper(launcher, String(stubborn.pid));
    check(forced.status === 0, "a process that ignores SIGTERM does not fail the launch", `exit ${forced.status}`);
    check(/ignored the request to stop; killing it\./.test(forced.stdout), "it says that it had to insist", JSON.stringify(forced.stdout));
    check(forced.stdout.indexOf("stopping it:") < forced.stdout.indexOf("ignored the request"), "it asks before it insists");
    const stubbornGone = await waitExit(stubborn, 3000);
    check(stubbornGone, "and the process is gone");
    check(stubborn.signalCode === "SIGKILL", "because the second signal was the one that cannot be ignored", `signal ${stubborn.signalCode}`);
    if (!stubbornGone) stubborn.kill("SIGKILL");

    // ── where the helper lives decides whether it exists ────────────────────
    // It was once inserted just before its first call, which put it *inside*
    // `if [[ -n "$SETUP_REASON" ]]`. On an already set-up machine that branch
    // does not run, so the launch path called a function that was never defined.
    const definitionAt = lines.findIndex((line) => /^stop_existing_servers\(\) \{$/.test(line));
    const branchAt = lines.findIndex((line) => /^if \[\[ -n "\$SETUP_REASON" \]\]/.test(line));
    const calls = lines.map((line, index) => ({ line, index })).filter((entry) => /^ *stop_existing_servers$/.test(entry.line));
    check(definitionAt > 0, "the helper is defined");
    check(branchAt > 0 && definitionAt < branchAt, "it is defined outside the setup branch, so a normal launch can call it", `def ${definitionAt + 1}, branch ${branchAt + 1}`);
    check(calls.length === 2, "both port-clearing sites call it", `${calls.length} calls`);
    check(calls.every((call) => call.index > definitionAt), "and each call comes after the definition", calls.map((c) => c.index + 1).join(", "));

    // ── the thing that caused this is gone ─────────────────────────────────
    const kills = lines.filter((line) => /xargs kill -9/.test(line) && !/^\s*#/.test(line));
    check(kills.length === 0, "no blind kill -9 by port remains", kills.join(" | "));
    const sigkills = lines.filter((line) => /kill -9/.test(line) && !/^\s*#/.test(line));
    check(sigkills.length === 1 || sigkills.every((line) => /SIGNAL|kill -9 "\$pid"/.test(line)), "kill -9 survives only as the escalation, never as the first move", sigkills.join(" | "));

    // ── bash 3.2, the shell macOS actually ships ───────────────────────────
    const syntax = spawnSync("bash", ["-n", path.join(root, launcher)], { encoding: "utf8" });
    check(syntax.status === 0, "the launcher still parses", syntax.stderr.trim());
    const helperText = extractHelper(launcher);
    check(!/local -[aA]|declare -A|\$\{[a-zA-Z_]+,,\}|mapfile|readarray/.test(helperText), "the helper stays inside bash 3.2");
    check(!/\$\(\s*</.test(helperText) && !/<<</.test(helperText), "and uses no here-string or process substitution that bash 3.2 lacks");
  }

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`\nPASS: ${checks} checks — a second launch replaces the first, and says that it did.`);
  process.exit(0);
})().catch((error) => {
  fs.rmSync(temp, { recursive: true, force: true });
  console.error(`\n${error.message}`);
  process.exit(1);
});
