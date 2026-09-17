"use strict";

/**
 * The Work Terminal, proved rather than promised.
 *
 * The dock offers four buttons and a prompt that says "git status, cat file,
 * head/tail file". For a while none of the git buttons could work: the server
 * only understood cat, head and tail, so the terminal refused the very
 * commands its own interface advertised. This suite runs the buttons the way
 * the dock does, and proves the dangerous things are still refused.
 *
 * - every command the dock offers actually runs
 * - files are read only from inside the granted folder
 * - pipes, chaining, redirection and substitution are refused
 * - nothing that writes, and nothing that talks to a remote, is allowed
 *
 * Run: node scripts/validation/test-work-terminal.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

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

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-terminal-"));
  const outside = path.join(sandbox, "outside");
  const project = path.join(sandbox, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "# demo\nline two\n");
  fs.writeFileSync(path.join(project, "src", "app.js"), "function main() {\n  return 1;\n}\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "not yours\n");

  const git = (args) => execFileSync("git", args, { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let gitReady = true;
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "work@example.test"]);
    git(["config", "user.name", "Work Test"]);
    git(["add", "."]);
    git(["commit", "-q", "-m", "first commit"]);
  } catch {
    gitReady = false;
  }

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.status === 200) ready = true;
      } catch {}
      if (!ready) await delay(150);
    }
    if (!ready) throw new Error(`Application server did not become ready.\n${log}`);

    const call = async (endpoint, payload) => {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {}
      return { status: response.status, data };
    };

    const restored = await call("/api/work/folder/restore", { projectId: "terminal-test", roots: [project] });
    const grantId = restored.data?.grants?.[project];
    check("the granted folder is restored for this session", Boolean(grantId), JSON.stringify(restored.data).slice(0, 160));
    const body = (extra = {}) => ({ root: project, projectId: "terminal-test", grantId, ...extra });

    // ── 1. The session ─────────────────────────────────────────────────────
    section("1. The terminal opens in the granted folder");
    const session = await call("/api/work/terminal/session", body());
    check("the session answers", session.status === 200 && session.data.ok === true, JSON.stringify(session.data).slice(0, 160));
    check("it reports the folder it will run in", String(session.data.session?.cwd || "").startsWith(fs.realpathSync(project)), String(session.data.result?.cwd));
    check("it offers a prompt", Boolean(session.data.session?.prompt), JSON.stringify(session.data.session).slice(0, 120));

    const run = async (command) => call("/api/work/terminal", body({ command }));

    // ── 2. The buttons on the dock ─────────────────────────────────────────
    section("2. Every command the dock offers works");
    if (gitReady) {
      const status = await run("git status");
      check("git status", status.status === 200 && status.data.ok === true, JSON.stringify(status.data.error || "").slice(0, 160));
      check("git status really ran git", /branch|commit|working tree/i.test(String(status.data.result?.output || "")));

      const diff = await run("git diff --stat");
      check("git diff --stat", diff.status === 200 && diff.data.ok === true, JSON.stringify(diff.data.error || "").slice(0, 160));

      const logRun = await run("git log -20");
      check("git log -20", logRun.status === 200 && logRun.data.ok === true, JSON.stringify(logRun.data.error || "").slice(0, 160));
      check("git log shows the commit", /first commit/.test(String(logRun.data.result?.output || "")), String(logRun.data.result?.output).slice(0, 120));

      const shortLog = await run("git log --oneline -n 5");
      check("git log with --oneline and -n", shortLog.status === 200 && shortLog.data.ok === true, JSON.stringify(shortLog.data.error || "").slice(0, 160));

      const branch = await run("git branch");
      check("git branch", branch.status === 200 && branch.data.ok === true, JSON.stringify(branch.data.error || "").slice(0, 160));
    } else {
      check("git is available in this environment", false, "git was not found");
    }

    const listed = await run("list files");
    check("list files", listed.status === 200 && listed.data.ok === true, JSON.stringify(listed.data.error || "").slice(0, 160));
    check("the listing shows the project's own files", /README\.md/.test(String(listed.data.result?.output || "")) && /src\//.test(String(listed.data.result?.output || "")));
    check("the listing never shows the parent folder", !/outside|secret/.test(String(listed.data.result?.output || "")));

    const ls = await run("ls");
    check("ls works too", ls.status === 200 && ls.data.ok === true, JSON.stringify(ls.data.error || "").slice(0, 160));
    const recursive = await run("ls -R");
    check("ls -R walks the tree", /src\/app\.js/.test(String(recursive.data.result?.output || "")));

    const pwd = await run("pwd");
    check("pwd answers with the granted folder", String(pwd.data.result?.output || "").trim() === fs.realpathSync(project), String(pwd.data.result?.output));

    // ── 3. Reading files, still inside the folder ──────────────────────────
    section("3. Files are read from inside the granted folder and nowhere else");
    const cat = await run("cat README.md");
    check("cat reads a file", /line two/.test(String(cat.data.result?.output || "")));
    const head = await run("head -n 1 src/app.js");
    check("head respects -n", String(head.data.result?.output || "").trim() === "function main() {");
    const tail = await run("tail -n 1 src/app.js");
    check("tail respects -n", String(tail.data.result?.output || "").trim() === "}");
    for (const escape of ["cat ../outside/secret.txt", "cat /etc/passwd", "cat ../../etc/passwd", "cat src/../../outside/secret.txt"]) {
      const attempt = await run(escape);
      check(`refused: ${escape}`, attempt.status === 400 || !/not yours|root:/.test(JSON.stringify(attempt.data)), JSON.stringify(attempt.data).slice(0, 120));
    }

    // ── 4. What must never be possible ─────────────────────────────────────
    section("4. The dangerous things are still refused");
    for (const nasty of [
      "cat README.md | grep demo",
      "cat README.md; rm -rf src",
      "cat README.md > out.txt",
      "cat `echo README.md`",
      "cat $HOME/.ssh/id_rsa",
      "rm -rf src",
      "git push origin master",
      "git commit -m x",
      "git checkout -- src/app.js",
      "curl http://example.com",
      "node -e process.exit(1)",
    ]) {
      const attempt = await run(nasty);
      const refused = attempt.status !== 200 || !attempt.data?.ok;
      check(`refused: ${nasty}`, refused, JSON.stringify(attempt.data).slice(0, 120));
    }
    check("nothing was written or removed while refusing", fs.existsSync(path.join(project, "src", "app.js")) && !fs.existsSync(path.join(project, "out.txt")));

    // ── 5. The palette still works the way it always did ───────────────────
    section("5. The fixed palette is untouched");
    for (const commandId of ["git-status", "git-diff", "git-log", "list-files"]) {
      const palette = await call("/api/work/command", body({ commandId }));
      check(`palette: ${commandId}`, palette.status === 200 && palette.data.ok === true, JSON.stringify(palette.data.error || "").slice(0, 160));
    }
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // ── 6. A pasted script, and an answer that cannot go missing ─────────────
  // Pasting finished code into the terminal is the obvious thing to do with it.
  // It cannot work — there is no shell behind this terminal — but it must never
  // be silent, and the single-line input used to eat everything after the first
  // newline, which is exactly how "nothing happened" came to be.
  section("6. A pasted script is answered, never swallowed");
  const dock = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "WorkTerminalDock.jsx"), "utf8");
  check("the command box takes more than one line", /<textarea/.test(dock) && !/<input[^>]*aria-label="Work Terminal command"/.test(dock));
  check("a multi-line paste is recognised as a script", /command\.includes\("\\n"\)/.test(dock));
  check("it is answered with an explanation, not a request", /SCRIPT_NOT_A_COMMAND/.test(dock) && /setOutput\(\(current\) => [`'"]\$\{current/.test(dock));
  check("the explanation says where the code should go", /Files tab/i.test(dock) && /Work Chat/i.test(dock));
  check("the answer replaces the placeholder by position, not by regex", /function finishRunningLine/.test(dock));
  check("an answer is appended when the placeholder has moved",
    /at === -1/.test(dock) && /const marker = "Running…"/.test(dock) && /text\.lastIndexOf\(marker\)/.test(dock));
  check("no path can leave the terminal showing Running… forever", !/replace\(\/Running/.test(dock));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
