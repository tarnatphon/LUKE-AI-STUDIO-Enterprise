"use strict";

/**
 * The Work Terminal can run a script, and that is the whole risk.
 *
 * Read-only commands are easy: they cannot change anything. Running
 * `npm install` or `node app.js` is different — it is arbitrary code with the
 * user's access, in the folder the user granted. Refusing it entirely leaves
 * the loop unfinished (write code, run it, read what broke), so Work runs it
 * the way the rest of Work does things: a short list of programs, a parsed
 * argv, no shell, an approval before anything happens, a time limit, a cap on
 * the output, and the working directory pinned inside the granted folder.
 *
 * This suite proves each of those, and proves the containment still holds for
 * a command that is allowed to write.
 *
 * Run: node scripts/validation/test-work-command-run.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const runnerFile = path.join(root, "scripts", "server", "work-command-runner.cjs");
const projectId = "command-run-audit";

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/work/environment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return { port, child };
    } catch {
      await delay(250);
    }
  }
  child.kill("SIGKILL");
  throw new Error("The server never answered.");
}

async function main() {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-run-")));
  const neighbour = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-neighbour-")));
  fs.writeFileSync(path.join(sandbox, "app.js"), "console.log('the script ran');\n");
  fs.writeFileSync(path.join(sandbox, "package.json"), `${JSON.stringify({ name: "run-audit", scripts: { hello: "node app.js" } }, null, 2)}\n`);

  const { port, child } = await startServer();
  try {
    const granted = await post("/api/work/folder/restore", { projectId, roots: [sandbox] });
    const grantId = granted.data?.grants?.[sandbox];
    if (!grantId) throw new Error(`The folder could not be granted: ${JSON.stringify(granted.data)}`);

    const base = { projectId, root: sandbox, grantId };
    const terminal = (command, extra = {}) => post("/api/work/terminal", { ...base, command, ...extra });

    section("1. Reading still needs no permission");
    for (const command of ["cat app.js", "git status", "ls", "pwd", "list files"]) {
      const response = await terminal(command);
      check(`read-only: ${command}`, response.status === 200, `${response.status} ${String(response.data?.error).slice(0, 70)}`);
    }

    section("2. A script asks before it touches anything");
    const sideEffect = "node -e \"require('fs').writeFileSync('made-by-a-script.txt','x')\"";
    const asked = await terminal(sideEffect);
    check("it refuses until it is allowed", asked.status === 403 && asked.data?.requiresApproval === true,
      `${asked.status} ${String(asked.data?.error).slice(0, 70)}`);
    check("the refusal says what would run",
      asked.data?.preview?.tool === "node" && Array.isArray(asked.data?.preview?.args) && asked.data?.preview?.cwd === sandbox,
      JSON.stringify(asked.data?.preview).slice(0, 90));
    check("the refusal warns what running it means", /access|network|writes|runs/i.test(String(asked.data?.preview?.note)),
      String(asked.data?.preview?.note).slice(0, 70));
    check("nothing was written while it waited", !fs.existsSync(path.join(sandbox, "made-by-a-script.txt")));

    section("3. Once allowed, it really runs");
    const allowed = await terminal(sideEffect, { approvalGranted: true });
    check("the command is accepted", allowed.status === 200, `${allowed.status} ${String(allowed.data?.error).slice(0, 70)}`);
    check("the script's file now exists, inside the folder", fs.existsSync(path.join(sandbox, "made-by-a-script.txt")));
    const printed = await terminal('node -e "console.log(1); console.log(2)"', { approvalGranted: true });
    check("output comes back from the process", /1[\s\S]*2/.test(String(printed.data?.result?.output)), String(printed.data?.result?.output).slice(0, 60));
    check("a quote can hold what a shell would have acted on", printed.status === 200, String(printed.data?.error).slice(0, 70));
    const cwd = await terminal('node -e "console.log(process.cwd())"', { approvalGranted: true });
    check("it runs in the granted folder", String(cwd.data?.result?.output).trim() === sandbox, String(cwd.data?.result?.output).trim());
    const failing = await terminal('node -e "process.exit(3)"', { approvalGranted: true });
    check("a failing script reports its exit code", failing.data?.result?.exitCode === 3, JSON.stringify(failing.data?.result?.exitCode));
    const script = await terminal("npm run hello", { approvalGranted: true });
    check("the project's own npm script runs", /the script ran/.test(String(script.data?.result?.output)), String(script.data?.result?.output).slice(0, 60));

    section("4. Approval is per command, never remembered");
    const second = await terminal('node -e "console.log(9)"');
    check("the next command asks again", second.status === 403 && second.data?.requiresApproval === true, `${second.status}`);

    section("5. What is never allowed");
    for (const [label, command] of [
      ["a program outside the list", "sudo rm -rf /"],
      ["a shell of any kind", "bash -c 'echo hi'"],
      ["chaining with &&", "node app.js && echo done"],
      ["chaining with ;", "node app.js; echo done"],
      ["a pipe", "cat app.js | grep the"],
      ["command substitution", "node -e \"$(whoami)\""],
      ["backticks", "node -e `whoami`"],
      ["redirection", "node app.js > out.txt"],
    ]) {
      const response = await terminal(command, { approvalGranted: true });
      check(label, response.status === 400, `${response.status} ${String(response.data?.error).slice(0, 60)}`);
    }
    check("no shell file was written by a redirection", !fs.existsSync(path.join(sandbox, "out.txt")));

    section("5b. A placeholder the model left in is named, not blamed on pipes");
    const placeholder = await terminal("npm install <missing-dependency>", { approvalGranted: true });
    check("it is refused", placeholder.status === 400, `${placeholder.status}`);
    check("and the refusal says it is a placeholder", /placeholder/i.test(String(placeholder.data?.error)), String(placeholder.data?.error).slice(0, 90));
    check("the placeholder itself is quoted back", /<missing-dependency>/.test(String(placeholder.data?.error)), String(placeholder.data?.error).slice(0, 90));
    check("it is not called a pipe", !/[Pp]ipes/.test(String(placeholder.data?.error)), String(placeholder.data?.error).slice(0, 90));
    const real = await terminal("npm install lodash --dry-run", { approvalGranted: true });
    check("a real package name still runs", real.status === 200, `${real.status} ${String(real.data?.error).slice(0, 60)}`);

    section("6. The granted folder still bounds every path it is given");
    const neighbourName = path.basename(neighbour);
    for (const [label, command] of [
      ["a script outside the folder", "node ../outside.js"],
      ["a path that climbs out", `node ../${neighbourName}/app.js`],
      ["a path that climbs out from inside", `node ./../${neighbourName}/app.js`],
    ]) {
      const response = await terminal(command, { approvalGranted: true });
      check(label, response.status === 400 && /outside the granted folder/i.test(String(response.data?.error)),
        `${response.status} ${String(response.data?.error).slice(0, 70)}`);
    }
    check("nothing appeared in the neighbouring folder", !fs.existsSync(path.join(neighbour, "pwned.txt")));
    // Honest about the limit: Work's own file operations cannot leave the
    // granted folder, but a script the user approves runs with the user's
    // access, and no amount of argument checking changes that. The approval
    // has to say so — and this suite has to know it too.
    const warned = await terminal('node -e "1"');
    check("the approval says the script runs with the user's access",
      /same access|network|writes|runs/i.test(String(warned.data?.preview?.note)), String(warned.data?.preview?.note).slice(0, 70));

    section("7. A runaway command is stopped, and a flood is cut down");
    const slow = await terminal('node -e "setTimeout(() => {}, 60000)"', { approvalGranted: true, timeoutMs: 1500 });
    check("it does not run past its time", slow.status === 200 && slow.data?.result?.timedOut === true,
      JSON.stringify({ status: slow.status, timedOut: slow.data?.result?.timedOut }));
    const flood = await terminal('node -e "console.log(\'x\'.repeat(300000))"', { approvalGranted: true });
    check("a huge output is cut down instead of swallowed", flood.status === 200 && flood.data?.result?.truncated === true,
      JSON.stringify({ status: flood.status, truncated: flood.data?.result?.truncated }));
    check("the cut is visible in the output", /omitted/.test(String(flood.data?.result?.output)));

    section("8. The runner keeps its promises in code");
    const runner = fs.readFileSync(runnerFile, "utf8");
    check("it never uses a shell", /shell:\s*false/.test(runner));
    check("it pins the working directory to the granted folder", /cwd:\s*root/.test(runner));
    check("it hands over a scrubbed environment", /env:\s*sanitisedEnv\(\)/.test(runner));
    check("it kills a runaway rather than waiting", /killSignal:\s*"SIGKILL"/.test(runner));
    check("the programs it will run are listed in one place", /const RUNNABLE_PROGRAMS = \{/.test(runner));
    check("the list is short enough to read", Object.keys(require(runnerFile).RUNNABLE_PROGRAMS).length <= 12);
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(neighbour, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  async function post(url, body) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
