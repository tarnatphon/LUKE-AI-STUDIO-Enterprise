"use strict";

/**
 * Every Work endpoint, called the way the interface calls it.
 *
 * Work had a habit of looking finished while a tab was quietly dead: the
 * Terminal advertised four commands the server refused, and a GitHub panel
 * that preferred an unsigned-in CLI over the token the user had just saved.
 * Both were wiring, not logic — nothing in the unit tests could see them,
 * because the pieces worked and the joins did not.
 *
 * So this suite drives the HTTP surface end to end, against a real granted
 * folder, and asks one question of each endpoint: does it answer with real
 * output? It is deliberately dumb about shapes beyond what the caller reads,
 * so it fails when an answer stops being useful, not when it is renamed.
 *
 * Two things it cannot prove here: opening Files/Terminal/VS Code needs a
 * desktop, and pushing, cloning and opening a pull request need a real remote.
 * Those are checked as far as they go — that they ask first, refuse a
 * made-up target, and explain themselves instead of crashing.
 *
 * Run: node scripts/validation/test-work-endpoints.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const projectId = "endpoint-audit";

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

async function post(port, url, body) {
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

/**
 * Routes answer { ok, result }, { ok, environment }, { ok, file }, a bare
 * array, or a flat object. Callers read the payload, so the suite does too.
 */
function answer(data) {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data;
  if ("result" in data) return data.result;
  const others = Object.entries(data).filter(([key, value]) => key !== "ok" && value && typeof value === "object");
  if (others.length === 1) return others[0][1];
  return data;
}

const text = (value) => (typeof value === "string" ? value : JSON.stringify(value ?? ""));

/** One endpoint, asked for real output. */
async function works(port, label, url, body, read) {
  const response = await post(port, url, body);
  const payload = answer(response.data);
  const value = read ? read(payload) : payload;
  const useful = Array.isArray(value)
    ? value.length > 0
    : typeof value === "number"
      ? value > 0
      : typeof value === "boolean"
        ? value
        : text(value).trim().length > 0;
  check(label, response.status === 200 && useful,
    response.status === 200 ? `empty: ${text(value).slice(0, 90)}` : `${response.status} ${String(response.data?.error).slice(0, 90)}`);
  return { response, payload };
}

/** An endpoint that must refuse, and must say why. */
async function refuses(port, label, url, body, pattern) {
  const response = await post(port, url, body);
  const message = String(response.data?.error || "");
  check(label, response.status >= 400 && response.status < 500 && pattern.test(message),
    `${response.status} ${message.slice(0, 90)}`);
  return response;
}

async function main() {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-endpoints-")));
  const secret = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-secret-")));
  fs.writeFileSync(path.join(secret, "passwords.txt"), "top secret\n");

  fs.writeFileSync(path.join(sandbox, "README.md"), "# Endpoint audit\n\nThe greeting builder lives in src/app.js.\n");
  fs.writeFileSync(path.join(sandbox, "package.json"), `${JSON.stringify({
    name: "endpoint-audit",
    version: "1.0.0",
    scripts: { test: "node -e \"process.exit(0)\"" },
  }, null, 2)}\n`);
  fs.mkdirSync(path.join(sandbox, "src"));
  fs.writeFileSync(path.join(sandbox, "src", "app.js"),
    "import { formatName } from \"./util.js\";\n\nexport function buildGreeting(name) {\n  return `hello ${formatName(name)}`;\n}\n");
  fs.writeFileSync(path.join(sandbox, "src", "util.js"),
    "export function formatName(name) {\n  return String(name || \"\").trim();\n}\n");
  const git = (args) => execFileSync("git", args, { cwd: sandbox, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]);
  git(["config", "user.email", "audit@example.test"]);
  git(["config", "user.name", "Endpoint Audit"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "first"]);

  const { port, child } = await startServer();
  try {
    const granted = await post(port, "/api/work/folder/restore", { projectId, roots: [sandbox] });
    const grantId = granted.data?.grants?.[sandbox];
    if (!grantId) throw new Error(`The folder could not be granted: ${JSON.stringify(granted.data)}`);

    const base = { projectId, root: sandbox, grantId };
    const projectShape = { projectId, sourceFolders: [sandbox], folderGrants: { [sandbox]: grantId }, activeRoot: sandbox };

    section("1. The panel that tells the user whether Work can work at all");
    await works(port, "environment lists the project's folders", "/api/work/environment", projectShape,
      (d) => (d?.sourceFolders || []).length);
    const readiness = await works(port, "readiness reports a ready folder and no warning", "/api/work/readiness", projectShape,
      (d) => (d?.readyCount === 1 && d?.hint === null ? "ready" : ""));
    check("readiness says which folder is live", readiness.payload?.activeRoot === sandbox, String(readiness.payload?.activeRoot));
    await works(port, "the terminal knows where it is sitting", "/api/work/terminal/session", base, (d) => d?.cwd);

    section("2. Reading the repository");
    await works(port, "directory lists the folder", "/api/work/directory", { ...base, path: "" }, (d) => (d?.entries || []).length);
    await works(port, "a file comes back with its contents", "/api/work/file/read", { ...base, path: "src/app.js" }, (d) => d?.content ?? d?.file?.content);
    await works(port, "the repository map names the languages", "/api/work/index/map", { ...base, limit: 0 }, (d) => d?.summary?.fileCount);
    await works(port, "a file's outline is read without reading it all", "/api/work/index/outline", { ...base, path: "src/app.js" }, (d) => (d?.outline || d?.symbols || []).length);
    await works(port, "a symbol is found where it is defined", "/api/work/index/symbol", { ...base, name: "formatName", limit: 20 }, (d) => (d?.definitions || []).length);
    await works(port, "searching the code finds the matches", "/api/work/index/search",
      { ...base, pattern: "formatName", limit: 25, extension: null, flags: "" }, (d) => (d?.results || []).length);
    await works(port, "project search indexes the folder and answers", "/api/work/search",
      { projectId, query: "greeting", limit: 8, sources: [{ root: sandbox, grantId }] }, (d) => (d?.results || []).length);

    section("3. Writing, and the run that can undo it");
    await works(port, "a file is written", "/api/work/file/write",
      { ...base, path: "src/notes.txt", content: "written by the audit\n", approvalGranted: true }, (d) => d?.saved);
    await works(port, "a file is patched in place", "/api/work/file/patch",
      { ...base, path: "src/util.js", edits: [{ op: "replace", old: 'String(name || "").trim()', new: 'String(name || "friend").trim()' }] },
      (d) => (d?.applied || []).length);
    const patched = fs.readFileSync(path.join(sandbox, "src", "util.js"), "utf8");
    check("the patch reached the file on disk", patched.includes('"friend"'), patched.slice(0, 60));

    const begin = await post(port, "/api/work/run/begin", { ...base, label: "endpoint audit" });
    const runId = answer(begin.data)?.runId;
    check("a run opens before anything is changed", begin.status === 200 && Boolean(runId), String(runId));
    await works(port, "a file written inside the run is saved", "/api/work/file/write",
      { ...base, path: "src/app.js", content: "export function buildGreeting(name) {\n  return `hi ${name} — changed by the audit`;\n}\n", approvalGranted: true, runId },
      (d) => d?.saved);
    await works(port, "the run shows what it changed", "/api/work/run/review", { ...base, runId }, (d) => d?.filesTouched);
    await works(port, "one file's diff is readable", "/api/work/review/diff", { ...base, path: "src/app.js" }, (d) => d?.diff ?? d?.output);
    await works(port, "recent runs are listed", "/api/work/run/list", base, (d) => (Array.isArray(d) ? d.length : (d?.runs || []).length));
    await works(port, "the run puts the file back", "/api/work/run/revert", { ...base, runId }, (d) => (d?.restored || []).length);
    const restored = fs.readFileSync(path.join(sandbox, "src", "app.js"), "utf8");
    check("the file on disk is the original again", restored.includes("formatName(name)"), restored.slice(0, 60));

    section("4. The terminal, and the commands the project already has");
    await works(port, "git status runs", "/api/work/terminal", { ...base, command: "git status" }, (d) => d?.output);
    await works(port, "listing files runs", "/api/work/terminal", { ...base, command: "list files" }, (d) => d?.output);
    await works(port, "reading a file runs", "/api/work/terminal", { ...base, command: "cat README.md" }, (d) => d?.output);
    await works(port, "the command palette runs", "/api/work/command", { ...base, commandId: "git-status" }, (d) => d?.output);
    await works(port, "the git panel reads the branch", "/api/work/git/status", base, (d) => d?.branch);
    const plan = await post(port, "/api/work/check/plan", base);
    const commands = answer(plan.data);
    const checkId = (Array.isArray(commands) ? commands : commands?.commands || [])[0]?.id;
    check("the project's own checks are detected", Boolean(checkId), JSON.stringify(commands).slice(0, 120));
    await works(port, `the detected check runs (${checkId})`, "/api/work/check/run",
      { ...base, commandId: checkId, timeoutMs: 120000 }, (d) => d?.output ?? text(d));

    section("5. GitHub: the parts that do not need an account");
    await works(port, "connection status answers", "/api/work/github/status", { projectId }, (d) => d?.mode);
    await works(port, "the local clone is described", "/api/work/github/repository", base, (d) => d?.branch);
    const branch = await post(port, "/api/work/github/branch", { ...base, name: "audit-branch" });
    check("creating a branch asks before it acts",
      branch.status === 403 && branch.data?.requiresApproval === true, `${branch.status} ${String(branch.data?.error).slice(0, 60)}`);
    check("the refusal carries a preview of what it wants to run",
      Boolean(branch.data?.preview?.tool) || Boolean(branch.data?.preview?.command), JSON.stringify(branch.data?.preview).slice(0, 90));
    const madeBranch = await post(port, "/api/work/github/branch", { ...base, name: "audit-branch", approvalGranted: true });
    check("a branch is created once it is approved", madeBranch.status === 200 && Boolean(answer(madeBranch.data)?.branch),
      `${madeBranch.status} ${JSON.stringify(answer(madeBranch.data)).slice(0, 80)}`);
    const commit = await post(port, "/api/work/github/commit", { ...base, message: "audit: prove the GitHub tab works", approvalGranted: true });
    check("a commit is made once it is approved", commit.status === 200 && answer(commit.data)?.committed === true,
      `${commit.status} ${JSON.stringify(answer(commit.data)).slice(0, 80)}`);
    // Push, pull request and clone need a remote this machine does not have;
    // what matters is that they refuse with an explanation, not a crash.
    for (const [label, url, body] of [
      ["pushing without a remote explains itself", "/api/work/github/push", base],
      ["a pull request without a remote explains itself", "/api/work/github/pull-request", { ...base, title: "audit" }],
      ["cloning a repository that is not there explains itself", "/api/work/github/clone", { ...base, repo: "luke-ai/does-not-exist" }],
    ]) {
      const response = await post(port, url, { ...body, approvalGranted: true });
      const message = String(response.data?.error || "");
      check(label, response.status >= 400 && response.status < 503 && message.trim().length > 0,
        `${response.status} ${message.slice(0, 80)}`);
    }

    section("6. Opening something on the desktop asks first, and only then");
    await refuses(port, "opening a folder is refused without approval", "/api/work/open",
      { ...base, target: "files", approvalGranted: false }, /approval/i);
    await refuses(port, "a made-up target is refused", "/api/work/open",
      { ...base, target: "../../etc", approvalGranted: true }, /unsupported|refus/i);
    const opened = await post(port, "/api/work/open", { ...base, target: "files", approvalGranted: true });
    check("an approved open is attempted, and says so when there is no desktop",
      opened.status === 200 || /could not open|ENOENT|spawn/i.test(String(opened.data?.error)),
      `${opened.status} ${String(opened.data?.error).slice(0, 70)}`);

    section("7. The granted folder is still the whole world");
    const outside = `../${path.basename(secret)}/passwords.txt`;
    for (const [label, url, body] of [
      ["reading outside is refused", "/api/work/file/read", { ...base, path: outside }],
      ["outlining outside is refused", "/api/work/index/outline", { ...base, path: outside }],
      ["reading outside from the terminal is refused", "/api/work/terminal", { ...base, command: `cat ${outside}` }],
      ["writing outside is refused", "/api/work/file/write", { ...base, path: "../escaped.txt", content: "nope", approvalGranted: true }],
      ["patching outside is refused", "/api/work/file/patch", { ...base, path: outside, edits: [{ op: "set", content: "pwned" }] }],
      ["a folder that was never granted is refused", "/api/work/file/read", { projectId, root: secret, grantId, path: "passwords.txt" }],
    ]) {
      await refuses(port, label, url, body, /permission|forbidden|refus|outside/i);
    }
    check("nothing appeared outside the granted folder", !fs.existsSync(path.join(os.tmpdir(), "escaped.txt")));
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(secret, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
