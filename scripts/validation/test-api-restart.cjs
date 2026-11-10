#!/usr/bin/env node
"use strict";

/**
 * The app has to be able to act on its own advice.
 *
 * /api/health already reports "the server is older than the app on disk" — the
 * launcher started this process before the last `git pull`, and routes are
 * registered at boot, so a new endpoint answers 404. The notice said "restart
 * the app" and offered no way to do it.
 *
 * POST /api/restart answers that. The interesting part is not the endpoint, it
 * is who performs the restart: the backend *exits* with code 75 and the
 * launcher starts it again. A backend that spawned its own replacement would
 * outlive the launcher's Ctrl+C trap and become exactly the orphan that
 * /api/llm/processes was written to find.
 *
 * Run: node scripts/validation/test-api-restart.cjs
 */

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const serveSource = fs.readFileSync(serverFile, "utf8");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-restart-"));

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function boot(port) {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child;
    } catch {
      // not listening yet
    }
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error("The server never answered.");
}

function post(port, { headers, body = "{}" } = {}) {
  return fetch(`http://127.0.0.1:${port}/api/restart`, { method: "POST", headers, body });
}

async function main() {
  console.log("\n=== the app can restart itself, and the launcher does it ===\n");

  // ── refusals first: nothing here may be reachable by accident ──────────────
  const port = await freePort();
  const server = await boot(port);
  const exits = new Promise((resolve) => server.on("exit", (code, signal) => resolve({ code, signal })));
  try {
    const plain = await post(port, { headers: { "Content-Type": "application/json" } });
    check(plain.status === 400, "a POST without the confirmation header is refused", String(plain.status));

    const formPost = await post(port, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    check(formPost.status === 400 || formPost.status === 415,
      "and so is a form post, which a stray page could send", String(formPost.status));

    const wrongType = await post(port, { headers: { "Content-Type": "text/plain", "X-Luke-Restart": "1" } });
    check(wrongType.status === 415, "a text/plain body is refused even with the header", String(wrongType.status));

    const getAttempt = await fetch(`http://127.0.0.1:${port}/api/restart`);
    check(getAttempt.status === 404, "GET does not restart anything", String(getAttempt.status));

    // ── the real request ─────────────────────────────────────────────────────
    const accepted = await post(port, { headers: { "Content-Type": "application/json", "X-Luke-Restart": "1" } });
    const payload = await accepted.json();
    check(accepted.status === 200 && payload.restarting === true, "the confirmed request is accepted", JSON.stringify(payload));
    check(payload.exitCode === 75, "and names the exit code the launcher waits for", String(payload.exitCode));

    const finished = await Promise.race([exits, delay(20000).then(() => null)]);
    check(Boolean(finished), "the backend actually exits", finished ? JSON.stringify(finished) : "still running after 20 s");
    check(finished && finished.code === 75,
      "with 75 — EX_TEMPFAIL, which the launcher treats as 'start again'",
      finished ? `exit ${finished.code} signal ${finished.signal}` : "");
  } finally {
    if (server.exitCode === null) server.kill("SIGKILL");
  }

  // ── the launcher carries the restart out ───────────────────────────────────
  // The loop is taken from mac.sh itself, not re-implemented here: a copy of it
  // in a test proves nothing about the file the user runs.
  function loopFrom(launcher) {
    const source = fs.readFileSync(path.join(root, launcher), "utf8");
    const start = source.indexOf("while :; do");
    const end = source.indexOf("\ndone\n", start);
    return { source, start, loop: start >= 0 && end > start ? source.slice(start, end + 5) : "" };
  }

  /**
   * Everything from `EXIT_STATUS=0` to the end of the launcher: the restart
   * loop, the crash report and the final cleanup. Extracted rather than
   * rewritten, so what runs in the harness is what runs for the user.
   */
  function tailFrom(launcher) {
    const source = fs.readFileSync(path.join(root, launcher), "utf8");
    const start = source.indexOf("EXIT_STATUS=0");
    return start >= 0 ? source.slice(start) : "";
  }

  for (const launcher of ["mac.sh", "linux.sh"]) {
    const { source, start, loop } = loopFrom(launcher);
    check(Boolean(loop), `${launcher} runs the backend in a restart loop`);
    check(/-eq 75/.test(loop), `${launcher} restarts on exit 75`);
    // `wait ... || true` followed by `$?` reads the status of `true`, not of the
    // child — a loop that would never fire.
    check(!/wait "\$SERVER_PID" \|\| true\s*\n\s*RESTART_STATUS=\$\?/.test(source),
      `${launcher} captures the status of wait, not of a '|| true' after it`);
    check(start > 0 && source.indexOf("trap cleanup") < start,
      `${launcher} installs its Ctrl+C trap before entering the loop, so Ctrl+C still stops everything`);
    const tail = tailFrom(launcher);
    check(/-ne 0 \]\]/.test(tail) && /exited with status \$EXIT_STATUS/.test(tail),
      `${launcher} reports a crash instead of saying goodbye`);
    check(/exit "\$EXIT_STATUS"/.test(tail), `${launcher} exits with the backend's own status`);
  }

  // The loop, executed: a fake backend that asks for a restart once.
  const counter = path.join(temp, "runs.txt");
  const fakeNode = path.join(temp, "fake-node.sh");
  fs.writeFileSync(fakeNode, [
    "#!/usr/bin/env bash",
    `count=$(cat "${counter}" 2>/dev/null || echo 0)`,
    "count=$((count + 1))",
    `echo "$count" > "${counter}"`,
    'if [[ "$count" -eq 1 ]]; then exit 75; fi',
    "exit 0",
    "",
  ].join("\n"));
  fs.chmodSync(fakeNode, 0o755);

  const harness = path.join(temp, "harness.sh");
  fs.writeFileSync(harness, [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    `NODE_BIN="${fakeNode}"`,
    "SERVE_SCRIPT=unused",
    "cleanup() { echo CLEANUP; exit 0; }",
    // mac.sh starts the backend and then loops waiting for it; the loop is
    // about what happens after an exit, so the first start has to be here too.
    '"$NODE_BIN" "$SERVE_SCRIPT" &',
    "SERVER_PID=$!",
    loopFrom("mac.sh").loop,
    tailFrom("mac.sh"), // loop + crash report + the final cleanup, as the launcher has it
    "",
  ].join("\n"));
  const ran = spawnSync("bash", [harness], { encoding: "utf8", timeout: 60000 });
  check((fs.existsSync(counter) ? fs.readFileSync(counter, "utf8").trim() : "0") === "2",
    "the launcher's own loop starts the backend a second time after exit 75",
    fs.existsSync(counter) ? fs.readFileSync(counter, "utf8").trim() : "no runs");
  check(/CLEANUP/.test(ran.stdout || ""), "and shuts down normally when it finally exits 0");
  check(!/\[error\]/.test(ran.stdout || ""), "a normal stop reports no error", (ran.stdout || "").trim().slice(-80));

  // ── and a backend that crashes is not a backend that was stopped ──────────
  const crashNode = path.join(temp, "crash-node.sh");
  fs.writeFileSync(crashNode, "#!/usr/bin/env bash\nexit 3\n");
  fs.chmodSync(crashNode, 0o755);
  const crashHarness = path.join(temp, "crash-harness.sh");
  fs.writeFileSync(crashHarness, [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    `NODE_BIN="${crashNode}"`,
    "SERVE_SCRIPT=unused",
    "cleanup() { echo CLEANUP; exit 0; }",
    '"$NODE_BIN" "$SERVE_SCRIPT" &',
    "SERVER_PID=$!",
    tailFrom("mac.sh"),
    "",
  ].join("\n"));
  const crashed = spawnSync("bash", [crashHarness], { encoding: "utf8", timeout: 60000 });
  const crashOut = `${crashed.stdout || ""}${crashed.stderr || ""}`;
  check(/the backend exited with status 3 without being asked to stop/.test(crashOut),
    "a crash is named as a crash", crashOut.trim().slice(-90));
  check(/ps aux \| grep -c/.test(crashOut), "and points at a model backend that may have outlived it");
  check(!/CLEANUP/.test(crashed.stdout || ""), "no goodbye is printed for a stop nobody asked for");
  check(crashed.status === 3, "and the launcher exits with the backend's status, so a script can see it", `exit ${crashed.status}`);

  // ── one shutdown, two ways to leave ────────────────────────────────────────
  check(/const RESTART_EXIT_CODE = 75;/.test(serveSource), "the exit code is defined once, in the server");
  check(/async function shutdownAll\(code = 0\)/.test(serveSource), "and there is one shutdown path");
  check(/process\.on\("SIGTERM", \(\) => shutdownAll\(0\)\)/.test(serveSource), "which SIGTERM uses");
  check(/setTimeout\(\(\) => \{ shutdownAll\(RESTART_EXIT_CODE\); \}, 300\);/.test(serveSource),
    "and which the restart uses, so llama-server is stopped before the exit");
  check(/unloadArenaPool\(\)/.test(serveSource.slice(serveSource.indexOf("async function shutdownAll"), serveSource.indexOf("async function shutdownAll") + 600)),
    "the arena pool is unloaded on the way out — a restart that left VRAM held would be an orphan");

  const healthSource = fs.readFileSync(path.join(root, "app/frontend/src/components/ModelManager.jsx"), "utf8");
  check(/fetch\("\/api\/restart"/.test(healthSource), "the Settings panel offers the button");
  check(/X-Luke-Restart/.test(healthSource), "and sends the header the endpoint requires");

  fs.rmSync(temp, { recursive: true, force: true });

  console.log(`\nPASS: ${checks} checks — a restart the launcher performs, not one the process performs on itself.\n`);
}

// This suite deliberately kills the server it is talking to, and undici's
// keep-alive pool holds the dead socket open for ~18 s afterwards. Exit on
// purpose instead of waiting for a connection that will never answer.
main().then(() => process.exit(0)).catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
