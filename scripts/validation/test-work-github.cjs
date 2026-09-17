"use strict";

/**
 * GitHub in Work, proved rather than promised.
 *
 * The promise is that Work can do the whole loop — read, branch, commit, push,
 * open a pull request — and that no step of it can reach outside the folder
 * the user granted, run a shell, or move a secret.
 *
 * - a repository or branch name can never become a command
 * - a clone lands inside the granted folder or it does not happen
 * - nothing is written locally, and nothing leaves the machine, without an
 *   explicit approval that returns the exact command for review
 * - the token lives in the app folder (on the external disk) and is scrubbed
 *   out of everything the app prints
 *
 * Run: node scripts/validation/test-work-github.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const execFileAsync = promisify(execFile);

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const workGithub = require(path.join(root, "scripts", "server", "work-github.cjs"));

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

async function refuses(label, fn, matcher = /./) {
  let error = null;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  check(label, Boolean(error) && matcher.test(error instanceof Error ? error.message : String(error)), error ? String(error.message).slice(0, 120) : "it did not refuse");
  return error;
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
  const gitWorks = (() => {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  // ── 1. Names are data, never commands ────────────────────────────────────
  section("1. A name can never become a command");
  check("owner/name is accepted", workGithub.repoSlug("luke-ai/studio") === "luke-ai/studio");
  check("an https link is reduced to owner/name", workGithub.repoSlug("https://github.com/luke-ai/studio.git") === "luke-ai/studio");
  for (const bad of [
    "owner/name; rm -rf /",
    "owner/name && echo pwned",
    "git@github.com:owner/name.git",
    "http://github.com/owner/name",
    "https://example.com/owner/name",
    "-upload-pack=echo pwned",
    "owner/name/../..",
  ]) {
    await refuses(`refused: ${bad}`, () => workGithub.repoSlug(bad));
  }

  check("a normal branch is accepted", workGithub.branchName("arena/01a09e4b-work") === "arena/01a09e4b-work");
  for (const bad of ["-x", "feature -x", "a..b", "x.lock", "with space", "back\\slash", ""]) {
    await refuses(`branch refused: ${JSON.stringify(bad)}`, () => workGithub.branchName(bad));
  }

  // ── 2. A clone stays inside the granted folder ───────────────────────────
  section("2. A clone lands inside the granted folder or not at all");
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-github-"));
  const granted = path.join(sandbox, "granted");
  const outside = path.join(sandbox, "outside");
  fs.mkdirSync(granted);
  fs.mkdirSync(outside);

  for (const escape of ["../outside/repo", "/etc/passwd", "../../etc", "~/repo"]) {
    await refuses(
      `escape refused: ${escape}`,
      () => workGithub.cloneRepo({ root: granted, repo: "luke-ai/studio", directory: escape, approvalGranted: true }),
      /granted folder|absolute|outside/,
    );
  }
  check("nothing appeared outside the granted folder", fs.readdirSync(outside).length === 0);

  // ── 3. Nothing is written without approval ───────────────────────────────
  section("3. Nothing happens until it is approved");
  const unapproved = await refuses(
    "cloning without approval is refused",
    () => workGithub.cloneRepo({ root: granted, repo: "luke-ai/studio", directory: "repo" }),
    /approval/i,
  );
  check("the refusal explains itself", unapproved && unapproved.requiresApproval === true);
  check("the refusal shows the exact command", Boolean(unapproved && unapproved.preview && unapproved.preview.args.length));
  check("nothing was created while waiting for approval", !fs.existsSync(path.join(granted, "repo")));

  // A real repository, so the rest is tested against git itself.
  const repoDir = path.join(granted, "project");
  fs.mkdirSync(repoDir, { recursive: true });
  if (gitWorks) {
    const git = (args) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git(["init", "-b", "main"]);
    git(["config", "user.email", "work@example.test"]);
    git(["config", "user.name", "Work Test"]);
    fs.writeFileSync(path.join(repoDir, "README.md"), "# project\n");
    git(["add", "README.md"]);
    git(["commit", "-m", "first"]);
  }

  const state = gitWorks ? await workGithub.repositoryState(repoDir) : { isRepo: true, branch: "main" };
  check("the local repository is read", state.isRepo === true);
  check("the branch is reported", state.branch === "main", JSON.stringify(state));

  await refuses(
    "branching without approval is refused",
    () => workGithub.createBranch({ root: repoDir, name: "feature/x" }),
    /approval/i,
  );
  check("no branch was created while waiting", gitWorks && !execFileSync("git", ["branch", "--list", "feature/x"], { cwd: repoDir, encoding: "utf8" }).trim());

  await refuses(
    "committing without approval is refused",
    () => workGithub.commitAll({ root: repoDir, message: "work" }),
    /approval/i,
  );
  await refuses(
    "committing without a message is refused",
    () => workGithub.commitAll({ root: repoDir, message: "  ", approvalGranted: true }),
    /message/i,
  );
  await refuses(
    "pushing without approval is refused",
    () => workGithub.push({ root: repoDir, approvalGranted: false }),
    /approval/i,
  );
  await refuses(
    "opening a pull request without approval is refused",
    () => workGithub.openPullRequest({ root: repoDir, title: "x", approvalGranted: false }),
    /approval/i,
  );

  // ── 4. With approval, the loop really works ──────────────────────────────
  section("4. Approved work happens, and only inside the folder");
  if (gitWorks) {
    fs.writeFileSync(path.join(repoDir, "notes.txt"), "hello\n");
    const dirty = await workGithub.repositoryState(repoDir);
    check("the new file is seen as a change", dirty.dirtyCount >= 1, JSON.stringify(dirty.dirtyFiles));

    const branch = await workGithub.createBranch({ root: repoDir, name: "arena/01a09e4b-work", approvalGranted: true });
    check("the branch is created", branch.branch === "arena/01a09e4b-work");
    check("it reports the branch it came from", branch.previous === "main");

    const committed = await workGithub.commitAll({ root: repoDir, message: "add notes", approvalGranted: true });
    check("the change is committed", committed.committed === true);
    check("the commit is the newest one", /add notes/.test(String(committed.lastCommit)));

    const after = await workGithub.repositoryState(repoDir);
    check("the folder is clean again", after.dirtyCount === 0, JSON.stringify(after.dirtyFiles));
    check("the branch is the new one", after.branch === "arena/01a09e4b-work");

    await refuses(
      "pushing with nowhere to push is refused, not crashed",
      () => workGithub.push({ root: repoDir, approvalGranted: true }),
      /remote/i,
    );
  } else {
    check("git is available in this environment", false, "git was not found");
  }

  // ── 5. Credentials stay in the app folder and never leak ─────────────────
  section("5. The token lives with the app and is never printed");
  const previousToken = await fs.promises.readFile(workGithub.AUTH_FILE, "utf8").catch(() => null);
  check("the token file is inside the app folder", workGithub.AUTH_FILE.startsWith(path.join(root, "app", "runtime-state")));
  await refuses("a bad token is refused", () => workGithub.storeToken("hunter2"));
  await refuses("an empty token is refused", () => workGithub.storeToken(""));

  const fakeToken = `ghp_${"a".repeat(30)}`;
  const saved = await workGithub.storeToken(fakeToken);
  check("a well-shaped token is saved", saved.saved === true);
  check("it is saved with owner-only permissions", (fs.statSync(workGithub.AUTH_FILE).mode & 0o777) === 0o600);

  const status = await workGithub.authStatus();
  const statusText = JSON.stringify(status);
  check("the status never contains the token", !statusText.includes(fakeToken), statusText.slice(0, 160));
  check("the status says how it is signed in", ["gh-cli", "token", "none"].includes(status.mode), statusText.slice(0, 160));
  check("scrubbing removes a token from any text", !workGithub.scrub(`failed: ${fakeToken}`, fakeToken).includes(fakeToken));
  check("scrubbing catches tokens it was not told about", !workGithub.scrub(`boom ${fakeToken}`).includes(fakeToken.slice(4)));

  let ignored = false;
  try {
    execFileSync("git", ["check-ignore", "-q", "app/runtime-state/github-auth.json"], { cwd: root, stdio: "ignore" });
    ignored = true;
  } catch {}
  check("the token file can never be committed", ignored, "add it to .gitignore");

  await workGithub.clearToken();
  check("the token can be deleted", !fs.existsSync(workGithub.AUTH_FILE));
  if (previousToken) {
    await fs.promises.mkdir(path.dirname(workGithub.AUTH_FILE), { recursive: true });
    await fs.promises.writeFile(workGithub.AUTH_FILE, previousToken, { mode: 0o600 });
  }

  // ── 6. Without the GitHub CLI, the token does the whole job ──────────────
  section("6. A machine with no GitHub CLI still gets the whole loop");
  // This machine may export a token of its own; the test has to prove the one
  // the user saved is the one that is used, so the environment is stood aside.
  const envTokens = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  check("git is given the credential as environment, never as an argument", (() => {
    const env = workGithub.gitAuthEnv(fakeToken);
    return env.GIT_CONFIG_VALUE_0.includes("AUTHORIZATION: bearer") && env.GIT_TERMINAL_PROMPT === "0";
  })());
  check("git is never left waiting for a password", workGithub.gitAuthEnv(null).GIT_TERMINAL_PROMPT === "0");
  check("an https remote is read as owner/name", workGithub.remoteSlug("https://github.com/luke-ai/studio.git") === "luke-ai/studio");
  check("an ssh remote is read as owner/name", workGithub.remoteSlug("git@github.com:luke-ai/studio.git") === "luke-ai/studio");
  check("a remote that is not GitHub is refused", workGithub.remoteSlug("file:///tmp/elsewhere") === null);

  if (gitWorks) {
    const calls = [];
    workGithub.setFetchImplementation(async (url, options) => {
      calls.push({ url: String(url), method: (options && options.method) || "GET", headers: options && options.headers, body: options && options.body });
      const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
      if (String(url).endsWith("/repos/luke-ai/studio")) return json({ default_branch: "main" });
      if (String(url).endsWith("/repos/luke-ai/studio/pulls")) return json({ html_url: "https://github.com/luke-ai/studio/pull/7", number: 7 });
      return json({ login: "tester" });
    });
    workGithub.setToolRunner((tool, args, options) =>
      tool === "gh"
        ? Promise.reject(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }))
        : execFileAsync(tool, args, options));

    // A repository whose origin points at GitHub, with a branch that is ahead.
    const remoteRepo = path.join(granted, "remote-project");
    fs.mkdirSync(remoteRepo, { recursive: true });
    const rgit = (args) => execFileSync("git", args, { cwd: remoteRepo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    rgit(["init", "-b", "main"]);
    rgit(["config", "user.email", "work@example.test"]);
    rgit(["config", "user.name", "Work Test"]);
    rgit(["remote", "add", "origin", "https://github.com/luke-ai/studio.git"]);
    fs.writeFileSync(path.join(remoteRepo, "README.md"), "# readme\n");
    rgit(["add", "README.md"]);
    rgit(["commit", "-m", "first"]);
    rgit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const firstCommit = rgit(["rev-parse", "main"]).trim();
    rgit(["checkout", "-b", "feature/token-only"]);
    fs.writeFileSync(path.join(remoteRepo, "work.txt"), "work\n");
    rgit(["add", "work.txt"]);
    rgit(["commit", "-m", "token only"]);
    // Make the branch look pushed: an upstream that is one commit behind.
    rgit(["update-ref", "refs/remotes/origin/feature/token-only", firstCommit]);
    rgit(["config", "branch.feature/token-only.remote", "origin"]);
    rgit(["config", "branch.feature/token-only.merge", "refs/heads/feature/token-only"]);

    const ahead = await workGithub.repositoryState(remoteRepo);
    check("the branch is seen as ahead of its upstream", ahead.ahead >= 1, JSON.stringify(ahead));

    await workGithub.storeToken(fakeToken);
    await refuses(
      "a pull request still asks before it is opened",
      () => workGithub.openPullRequest({ root: remoteRepo, title: "Token only" }),
      /approval/i,
    );

    const opened = await workGithub.openPullRequest({ root: remoteRepo, title: "Token only", body: "from the token path", approvalGranted: true });
    check("the pull request is opened without the GitHub CLI", opened.opened === true && opened.via === "api", JSON.stringify(opened));
    check("it comes back with its link", opened.url === "https://github.com/luke-ai/studio/pull/7");
    const posted = calls.find((entry) => entry.method === "POST" && entry.url.endsWith("/repos/luke-ai/studio/pulls"));
    check("it posted to the right repository", Boolean(posted), JSON.stringify(calls.map((c) => `${c.method} ${c.url}`)));
    const sent = posted ? JSON.parse(posted.body) : {};
    check("from the branch into the default branch", sent.head === "feature/token-only" && sent.base === "main", JSON.stringify(sent));
    check("with the title the user wrote", sent.title === "Token only");
    check("the token went in the header, not the URL", posted && String(posted.headers.authorization).includes(fakeToken) && !posted.url.includes(fakeToken));

    await workGithub.clearToken();
    await refuses(
      "with no token and no GitHub CLI, it says what is missing",
      () => workGithub.openPullRequest({ root: remoteRepo, title: "x", approvalGranted: true }),
      /token/i,
    );

    workGithub.setToolRunner(null);
    workGithub.setFetchImplementation(null);
  }
  if (envTokens.GITHUB_TOKEN) process.env.GITHUB_TOKEN = envTokens.GITHUB_TOKEN;
  if (envTokens.GH_TOKEN) process.env.GH_TOKEN = envTokens.GH_TOKEN;

  // ── 7. The endpoints answer ──────────────────────────────────────────────
  section("7. The endpoints answer, and the guards hold");
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

    // A grant is session state held by the server, so the test asks the server
    // for one the same way the app does after a restart.
    const restored = await call("/api/work/folder/restore", { projectId: "p1", roots: [granted, repoDir] });
    const grantId = restored.data && restored.data.grants ? restored.data.grants[granted] : null;
    const repoGrantId = restored.data && restored.data.grants ? restored.data.grants[repoDir] : null;
    check("the granted folder is restored for this session", Boolean(grantId), JSON.stringify(restored.data).slice(0, 160));

    const noGrant = await call("/api/work/github/clone", { projectId: "p1", root: granted, repo: "luke-ai/studio", directory: "repo", approvalGranted: true });
    check("without a grant nothing happens at all", noGrant.status === 403, JSON.stringify(noGrant.data).slice(0, 160));

    const statusCall = await call("/api/work/github/status", { projectId: "p1" });
    check("the connection status answers", statusCall.status === 200 && statusCall.data.ok === true);
    check("it does not hand out a secret", !JSON.stringify(statusCall.data).includes(fakeToken));

    const badRepo = await call("/api/work/github/issues", { projectId: "p1", root: granted, grantId, repo: "owner/name; rm -rf /" });
    check("a repository name that is really a command is refused", badRepo.status === 400, JSON.stringify(badRepo.data).slice(0, 120));

    const escape = await call("/api/work/github/clone", {
      projectId: "p1",
      root: granted,
      grantId,
      repo: "luke-ai/studio",
      directory: "../outside/repo",
      approvalGranted: true,
    });
    check("a clone that would land outside the folder is refused", escape.status === 400, JSON.stringify(escape.data).slice(0, 120));
    check("still nothing outside the granted folder", fs.readdirSync(outside).length === 0);

    const needsApproval = await call("/api/work/github/push", { projectId: "p1", root: repoDir, grantId: repoGrantId });
    check("pushing from the panel asks first", needsApproval.status === 403);
    check("and it says what it wants to run", needsApproval.data && needsApproval.data.requiresApproval === true);

    const badToken = await call("/api/work/github/token", { projectId: "p1", root: granted, grantId, token: "nope" });
    check("a bad token is refused at the endpoint too", badToken.status === 400);
  } finally {
    child.kill("SIGTERM");
  }

  fs.rmSync(sandbox, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
