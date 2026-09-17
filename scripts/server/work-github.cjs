"use strict";

/**
 * GitHub for the Work agent.
 *
 * The point is to let Work do the whole loop the way an agent does it elsewhere:
 * read the repository, branch, change files, commit, push, and open a pull
 * request — without ever turning the machine into an open terminal.
 *
 * Four rules hold everywhere in this file:
 *
 * 1. Everything stays in the granted Work folder. A clone is written through
 *    `resolveInsideRoot`, so `../outside` is refused before a byte is fetched,
 *    and the app never asks where else it might put things.
 * 2. No shell. Every tool call is `execFile(tool, args, { shell: false })`, so a
 *    repository name or a branch name can never become a command.
 * 3. Anything that leaves the machine — push, pull request — and anything that
 *    rewrites history locally — branch, commit — needs an explicit approval
 *    flag. Without it the call is refused and returns the exact command it
 *    would have run, so the UI can show it and ask.
 * 4. Credentials never travel. `gh` is preferred precisely because the app then
 *    holds no secret at all. A personal access token is the fallback, and it
 *    lives in `app/runtime-state/github-auth.json` — inside the app folder, so
 *    it sits on the same external disk as everything else. It is scrubbed out
 *    of every error message and never sent to the browser.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { resolveInsideRoot, createHttpError } = require("./work-path-guard.cjs");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..", "..");
const AUTH_FILE = path.join(ROOT, "app", "runtime-state", "github-auth.json");
const TOOL_TIMEOUT_MS = 20000;
const MAX_BUFFER = 4 * 1024 * 1024;
const MAX_LIST_ITEMS = 50;
const GITHUB_API = "https://api.github.com";

// ── small helpers ──────────────────────────────────────────────────────────

function reject(message, statusCode = 400) {
  return createHttpError(message, statusCode);
}

function approvalError(action, args, cwd) {
  const error = createHttpError(
    `${action} needs your approval first. Nothing was sent.`,
    403,
  );
  error.requiresApproval = true;
  error.preview = { tool: "git", args, cwd };
  return error;
}

function scrub(text, token) {
  let out = String(text == null ? "" : text);
  if (token) {
    // Split so the secret itself never appears as one readable run.
    out = out.split(token).join("[token hidden]");
  }
  return out.replace(/(gh[pousr]_[A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1[token hidden]");
}

function clean(value, maxLength = 400) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// The tests replace this to prove the REST calls without touching GitHub.
let fetchImpl = (...args) => globalThis.fetch(...args);

function setFetchImplementation(fn) {
  fetchImpl = typeof fn === "function" ? fn : (...args) => globalThis.fetch(...args);
}

/**
 * Credentials for git, without `gh` and without a secret in the command line.
 *
 * The token travels in the child process's environment as a temporary git
 * config value, never as an argument (which anyone could read with `ps`) and
 * never in the clone URL (which git saves in .git/config for good). The prompt
 * is switched off so a failed login can never hang the app waiting for typing.
 */
function gitAuthEnv(token) {
  if (!token) return { GIT_TERMINAL_PROMPT: "0" };
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${token}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

/** owner/name, read from the origin remote (https or ssh). */
function remoteSlug(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return null;
  const ssh = raw.match(/^[\w.-]+@[\w.-]+[:/]+(.+?)(?:\.git)?$/);
  const candidate = ssh ? ssh[1] : raw.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "");
  return REPO_SLUG.test(candidate) ? candidate : null;
}

const defaultToolRunner = (tool, args, options) => execFileAsync(tool, args, options);
let toolRunner = defaultToolRunner;

/** The tests replace this to simulate a machine without the GitHub CLI. */
function setToolRunner(fn) {
  toolRunner = typeof fn === "function" ? fn : defaultToolRunner;
}

async function runTool(tool, args, { cwd, env = {}, token = null } = {}) {
  try {
    const { stdout, stderr } = await toolRunner(tool, args, {
      cwd: cwd || undefined,
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    return { ok: true, code: 0, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (error) {
    const message = scrub(error && error.message ? error.message : String(error), token);
    const stderr = scrub(error && error.stderr ? error.stderr : "", token);
    const stdout = scrub(error && error.stdout ? error.stdout : "", token);
    return {
      ok: false,
      code: typeof error.code === "number" ? error.code : 1,
      stdout,
      stderr: stderr || message,
      message,
      notFound: message.includes("ENOENT"),
    };
  }
}

// ── input validation: a name is never allowed to become an argument ─────────

const REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function repoSlug(value) {
  const raw = clean(value, 200);
  if (!raw) throw reject("Name the repository as owner/name, for example luke-ai/studio.");
  if (REPO_SLUG.test(raw)) return raw;
  // A pasted URL is fine; anything else is not.
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    throw reject("That does not look like a repository. Use owner/name or an https:// URL.");
  }
  if (parsed.protocol !== "https:") throw reject("Only https repository links are accepted.");
  const host = parsed.hostname.toLowerCase();
  const isGithub = host === "github.com" || host === "www.github.com" || host.endsWith(".github.com");
  if (!isGithub) throw reject("This connects to github.com only.");
  const slug = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
  if (!REPO_SLUG.test(slug)) throw reject("That link does not point at a repository.");
  return slug;
}

function branchName(value) {
  const name = String(value == null ? "" : value).trim();
  if (!name) throw reject("Give the branch a name.");
  if (name.length > 200) throw reject("That branch name is too long.");
  if (name.startsWith("-")) throw reject("A branch name cannot start with a dash.");
  if (name.includes("..") || name.includes("\\") || /\s/.test(name)) {
    throw reject("A branch name cannot contain spaces, backslashes or '..'.");
  }
  if (!/^[A-Za-z0-9._/@-]+$/.test(name)) throw reject("A branch name may use letters, digits, . _ / @ and - only.");
  if (name.endsWith(".lock")) throw reject("A branch name cannot end in .lock.");
  return name;
}

function relativeDir(value) {
  const raw = String(value == null ? "" : value).trim().replace(/\\/g, "/");
  if (!raw) throw reject("Give the folder a name.");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) throw reject("The folder must sit inside the Work folder, so it cannot be an absolute path.");
  if (raw.split("/").includes("..")) throw reject("The folder cannot step outside the Work folder with '..'.");
  if (raw.includes("\0")) throw reject("That folder name is not usable.");
  return raw.replace(/^\.\/+/, "");
}

// ── credentials ────────────────────────────────────────────────────────────

async function readStoredToken() {
  try {
    const raw = await fsp.readFile(AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    return token || null;
  } catch {
    return null;
  }
}

async function storeToken(token) {
  const value = String(token == null ? "" : token).trim();
  if (!value) throw reject("There is no token to save.");
  if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(value)) {
    throw reject("That does not look like a GitHub token.");
  }
  await fsp.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fsp.writeFile(AUTH_FILE, `${JSON.stringify({ token: value, savedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(AUTH_FILE, 0o600); } catch {}
  return { saved: true, tokenFile: path.relative(ROOT, AUTH_FILE) };
}

async function clearToken() {
  await fsp.rm(AUTH_FILE, { force: true });
  return { cleared: true };
}

async function hasGh() {
  const result = await runTool("gh", ["--version"]);
  return Boolean(result.ok);
}

async function resolveToken() {
  const fromEnv = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (fromEnv) return { token: fromEnv, source: "environment" };
  const stored = await readStoredToken();
  if (stored) return { token: stored, source: "stored" };
  return { token: null, source: null };
}

/**
 * How this machine can reach GitHub right now.
 *
 * The CLI being installed is not the same as being signed in: plenty of Macs
 * have `gh` from Homebrew and never ran `gh auth login`. Preferring the CLI
 * anyway meant a token the user had just saved was ignored, and every GitHub
 * panel answered with the CLI's raw error instead of saying what was wrong.
 *
 * So: a token the user saved wins; otherwise the CLI's own login is used; if
 * neither exists the user is told to sign in, in so many words.
 */
async function githubAccess() {
  const { token, source } = await resolveToken();
  const ghInstalled = await hasGh();
  if (token) return { token, source, gh: ghInstalled };
  if (ghInstalled && (await ghLogin())) return { token: null, source: "gh-cli", gh: true };
  throw reject(
    "Sign in to GitHub first: paste a personal access token below, or run `gh auth login` on this machine.",
    401,
  );
}

/** The account the CLI itself is signed in as, or null when it is not. */
async function ghLogin() {
  const who = await runTool("gh", ["api", "user", "--jq", ".login"], {});
  return who.ok && who.stdout.trim() ? who.stdout.trim() : null;
}

async function authStatus() {
  const { token, source } = await resolveToken();
  const ghInstalled = await hasGh();
  const env = token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {};

  if (ghInstalled) {
    const who = await runTool("gh", ["api", "user", "--jq", ".login"], { env, token });
    if (who.ok && who.stdout.trim()) {
      return {
        mode: "gh-cli",
        installed: true,
        loggedIn: true,
        login: who.stdout.trim(),
        source: token ? source : "gh-cli",
        tokenStored: Boolean(token),
        host: "github.com",
      };
    }
    return {
      mode: "gh-cli",
      installed: true,
      loggedIn: false,
      login: null,
      source: null,
      tokenStored: Boolean(token),
      host: "github.com",
      hint: token
        ? "The GitHub CLI is installed but rejected the token. Check it in Settings."
        : "The GitHub CLI is installed but not signed in. Run 'gh auth login' on this machine, or paste a token in Settings.",
    };
  }

  if (token) {
    try {
      const response = await fetch(`${GITHUB_API}/user`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      });
      if (response.ok) {
        const data = await response.json();
        return {
          mode: "token",
          installed: false,
          loggedIn: true,
          login: data && data.login ? String(data.login) : null,
          source,
          tokenStored: source === "stored",
          host: "github.com",
          hint: "The GitHub CLI is not installed, so Work uses the token for everything: cloning and pushing private repositories, and opening pull requests.",
        };
      }
      return {
        mode: "token",
        installed: false,
        loggedIn: false,
        login: null,
        source,
        tokenStored: source === "stored",
        host: "github.com",
        hint: `GitHub refused the token (${response.status}). Replace it in Settings.`,
      };
    } catch (error) {
      return {
        mode: "token",
        installed: false,
        loggedIn: false,
        login: null,
        source,
        tokenStored: source === "stored",
        host: "github.com",
        hint: "Could not reach GitHub. Check the connection and try again.",
      };
    }
  }

  return {
    mode: "none",
    installed: false,
    loggedIn: false,
    login: null,
    source: null,
    tokenStored: false,
    host: "github.com",
    hint: "Save a personal access token in Settings. (The GitHub CLI is optional.)",
  };
}

// ── reading GitHub ─────────────────────────────────────────────────────────

function limitOf(value, fallback = 20) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), MAX_LIST_ITEMS);
}

async function ghJson(args, { token }) {
  const result = await runTool("gh", args, { env: token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {}, token });
  if (!result.ok) {
    throw reject(scrub(result.stderr || result.message, token).slice(0, 400) || "GitHub did not answer.", 502);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

async function apiJson(urlPath, { token, method = "GET", body = null } = {}) {
  const response = await fetchImpl(`${GITHUB_API}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "LUKE-AI-STUDIO",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw reject(
      `GitHub answered ${response.status}.${detail ? ` ${scrub(detail, token).slice(0, 200)}` : ""}`,
      502,
    );
  }
  if (response.status === 204) return null;
  return response.json();
}

async function listRepos({ limit = 20 } = {}) {
  const { token, gh } = await githubAccess();
  const count = limitOf(limit, 20);
  if (gh) {
    const rows = await ghJson(
      ["repo", "list", "--limit", String(count), "--json", "nameWithOwner,description,updatedAt,visibility"],
      { token },
    );
    return (rows || []).map((row) => ({
      nameWithOwner: row.nameWithOwner,
      description: clean(row.description, 200),
      updatedAt: row.updatedAt || null,
      visibility: row.visibility || null,
    }));
  }
  if (!token) throw reject("Sign in to GitHub first.", 401);
  const rows = await apiJson(`/user/repos?per_page=${count}&sort=updated&affiliation=owner,collaborator,organization_member`, { token });
  return (rows || []).map((row) => ({
    nameWithOwner: row.full_name,
    description: clean(row.description, 200),
    updatedAt: row.updated_at || null,
    visibility: row.private ? "PRIVATE" : "PUBLIC",
  }));
}

async function listIssues({ repo, limit = 20, state = "open" } = {}) {
  const slug = repoSlug(repo);
  const { token, gh } = await githubAccess();
  const count = limitOf(limit, 20);
  const wanted = state === "closed" ? "closed" : state === "all" ? "all" : "open";
  if (gh) {
    const rows = await ghJson(
      ["issue", "list", "--repo", slug, "--limit", String(count), "--state", wanted, "--json", "number,title,state,updatedAt,author"],
      { token },
    );
    return (rows || []).map((row) => ({
      number: row.number,
      title: clean(row.title, 200),
      state: row.state,
      updatedAt: row.updatedAt || null,
      author: row.author && row.author.login ? row.author.login : null,
    }));
  }
  if (!token) throw reject("Sign in to GitHub first.", 401);
  const rows = await apiJson(`/repos/${slug}/issues?per_page=${count}&state=${wanted}`, { token });
  return (rows || []).map((row) => ({
    number: row.number,
    title: clean(row.title, 200),
    state: row.state,
    updatedAt: row.updated_at || null,
    author: row.user && row.user.login ? row.user.login : null,
  }));
}

async function listPullRequests({ repo, limit = 20, state = "open" } = {}) {
  const slug = repoSlug(repo);
  const { token, gh } = await githubAccess();
  const count = limitOf(limit, 20);
  const wanted = state === "closed" ? "closed" : state === "all" ? "all" : "open";
  if (gh) {
    const rows = await ghJson(
      ["pr", "list", "--repo", slug, "--limit", String(count), "--state", wanted, "--json", "number,title,state,updatedAt,author,headRefName"],
      { token },
    );
    return (rows || []).map((row) => ({
      number: row.number,
      title: clean(row.title, 200),
      state: row.state,
      updatedAt: row.updatedAt || null,
      author: row.author && row.author.login ? row.author.login : null,
      headRefName: row.headRefName || null,
    }));
  }
  if (!token) throw reject("Sign in to GitHub first.", 401);
  const rows = await apiJson(`/repos/${slug}/pulls?per_page=${count}&state=${wanted}`, { token });
  return (rows || []).map((row) => ({
    number: row.number,
    title: clean(row.title, 200),
    state: row.state,
    updatedAt: row.updated_at || null,
    author: row.user && row.user.login ? row.user.login : null,
    headRefName: row.head && row.head.ref ? row.head.ref : null,
  }));
}

// ── the local repository: everything resolves inside the granted folder ─────

async function insideRoot(root, targetPath, { allowMissing = true } = {}) {
  const { realRoot, targetPath: resolved } = await resolveInsideRoot({ root, targetPath, allowMissing });
  return { realRoot, targetPath: resolved };
}

async function repositoryState(root) {
  const runGit = async (args) => {
    const result = await runTool("git", args, { cwd: root });
    return result.ok ? result.stdout.trim() : "";
  };
  const [isRepo, branch, status, lastCommit, remote, aheadBehind] = await Promise.all([
    runGit(["rev-parse", "--is-inside-work-tree"]),
    runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(["status", "--porcelain"]),
    runGit(["log", "-1", "--oneline"]),
    runGit(["remote", "get-url", "origin"]),
    runGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
  ]);
  const dirty = status ? status.split("\n").filter(Boolean).slice(0, 200) : [];
  const counts = aheadBehind ? aheadBehind.split(/\s+/) : [];
  return {
    isRepo: isRepo === "true",
    branch: branch || null,
    lastCommit: lastCommit || null,
    dirtyFiles: dirty,
    dirtyCount: dirty.length,
    remote: remote || null,
    ahead: Number.parseInt(counts[0] || "0", 10) || 0,
    behind: Number.parseInt(counts[1] || "0", 10) || 0,
  };
}

async function cloneRepo({ root, repo, directory, approvalGranted = false }) {
  const slug = repoSlug(repo);
  const folder = relativeDir(directory || slug.split("/")[1] || "repository");
  const { token } = await resolveToken();
  const { targetPath } = await insideRoot(root, folder, { allowMissing: true });

  const args = ["clone", "--", `https://github.com/${slug}.git`, targetPath];
  if (approvalGranted !== true) throw approvalError("Cloning a repository", args, root);

  if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) {
    throw reject(`There is already something in ${folder}. Choose another folder name.`, 409);
  }
  // With a token, git carries the credential itself, so private repositories
  // clone without the GitHub CLI. The token still never reaches the URL.
  const result = await runTool("git", args, { token, env: gitAuthEnv(token) });
  if (!result.ok) {
    throw reject(scrub(result.stderr || result.message, token).slice(0, 400) || "The clone failed.", 502);
  }
  return { cloned: true, path: path.relative(root, targetPath) || ".", repo: slug };
}

async function createBranch({ root, name, approvalGranted = false }) {
  const branch = branchName(name);
  const args = ["checkout", "-b", branch];
  // Approval comes before any check on the repository, so the answer is the
  // same whether or not the folder happens to be a repository.
  if (approvalGranted !== true) throw approvalError("Creating a branch", args, root);
  const state = await repositoryState(root);
  if (!state.isRepo) throw reject("This Work folder is not a git repository yet. Clone one first.", 409);
  const result = await runTool("git", args, { cwd: root });
  if (!result.ok) throw reject(scrub(result.stderr || result.message).slice(0, 400) || "The branch could not be created.", 502);
  return { branch, previous: state.branch };
}

async function commitAll({ root, message, approvalGranted = false }) {
  const text = String(message == null ? "" : message).trim();
  if (!text) throw reject("Write a commit message first.");
  if (text.length > 500) throw reject("That commit message is too long.");

  const addArgs = ["add", "-A"];
  const commitArgs = ["commit", "-m", text];
  if (approvalGranted !== true) throw approvalError("Committing", [...addArgs, "&&", ...commitArgs], root);

  const state = await repositoryState(root);
  if (!state.isRepo) throw reject("This Work folder is not a git repository yet. Clone one first.", 409);
  if (state.dirtyCount === 0) return { committed: false, reason: "There is nothing to commit." };

  const added = await runTool("git", addArgs, { cwd: root });
  if (!added.ok) throw reject(scrub(added.stderr || added.message).slice(0, 400) || "The files could not be staged.", 502);
  const commit = await runTool("git", commitArgs, { cwd: root });
  if (!commit.ok) throw reject(scrub(commit.stderr || commit.message).slice(0, 400) || "The commit failed.", 502);
  const after = await repositoryState(root);
  return { committed: true, branch: after.branch, lastCommit: after.lastCommit };
}

async function push({ root, branch, approvalGranted = false }) {
  if (branch) branchName(branch); // a name is checked even before approval
  const args = ["push", "--set-upstream", "origin", branch || "<the current branch>"];
  if (approvalGranted !== true) throw approvalError("Pushing to GitHub", args, root);
  const state = await repositoryState(root);
  if (!state.isRepo) throw reject("This Work folder is not a git repository yet. Clone one first.", 409);
  if (!state.remote) throw reject("This repository has no remote called origin to push to.", 409);
  const target = branch ? branchName(branch) : state.branch;
  if (!target) throw reject("There is no branch to push.");
  const { token } = await resolveToken();
  const result = await runTool("git", [...args.slice(0, -1), target], { cwd: root, token, env: gitAuthEnv(token) });
  if (!result.ok) throw reject(scrub(result.stderr || result.message, token).slice(0, 400) || "The push failed.", 502);
  return { pushed: true, branch: target, remote: state.remote };
}

async function openPullRequest({ root, title, body: bodyText, base, approvalGranted = false }) {
  const subject = String(title == null ? "" : title).trim() || "<the last commit message>";
  if (base) branchName(base);
  const args = [
    "pr", "create",
    "--title", subject.slice(0, 200),
    "--body", String(bodyText == null ? "" : bodyText).slice(0, 4000),
    "--head", "<the current branch>",
  ];
  if (base) args.push("--base", base);
  if (approvalGranted !== true) throw approvalError("Opening a pull request", ["gh", ...args], root);

  const state = await repositoryState(root);
  if (!state.isRepo) throw reject("This Work folder is not a git repository yet. Clone one first.", 409);
  const head = state.branch;
  if (!head || head === "HEAD") throw reject("Check out a branch before opening a pull request.", 409);
  if (state.dirtyCount > 0) throw reject("Commit your changes before opening a pull request.", 409);
  if (state.remote && state.ahead === 0) throw reject("Push the branch before opening a pull request.", 409);

  const finalArgs = args.map((value) => (value === "<the current branch>" ? head : value));
  if (subject === "<the last commit message>") {
    finalArgs[finalArgs.indexOf("<the last commit message>")] = clean(state.lastCommit, 120) || head;
  }

  const { token, gh } = await githubAccess();
  if (gh) {
    const result = await runTool("gh", finalArgs, { cwd: root, token, env: token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {} });
    if (!result.ok) {
      throw reject(scrub(result.stderr || result.message, token).slice(0, 400) || "The pull request could not be opened.", 502);
    }
    const url = (result.stdout.match(/https:\/\/\S+/g) || [])[0] || null;
    return { opened: true, url, branch: head, via: "gh-cli" };
  }

  // No GitHub CLI: open it through the API instead, so the loop still closes.
  if (!token) throw reject("Save a GitHub token first, or install the GitHub CLI.", 401);
  const slug = remoteSlug(state.remote);
  if (!slug) throw reject("The origin remote does not point at GitHub, so a pull request cannot be opened from here.", 409);
  const info = await apiJson(`/repos/${slug}`, { token });
  const target = base || (info && info.default_branch) || "main";
  const created = await apiJson(`/repos/${slug}/pulls`, {
    token,
    method: "POST",
    body: {
      title: (subject === "<the last commit message>" ? clean(state.lastCommit, 120) || head : subject).slice(0, 200),
      body: String(bodyText == null ? "" : bodyText).slice(0, 4000),
      head,
      base: target,
    },
  });
  return {
    opened: true,
    url: created && created.html_url ? created.html_url : null,
    number: created && created.number ? created.number : null,
    branch: head,
    base: target,
    via: "api",
  };
}

module.exports = {
  AUTH_FILE,
  gitAuthEnv,
  remoteSlug,
  setFetchImplementation,
  setToolRunner,
  authStatus,
  clearToken,
  cloneRepo,
  commitAll,
  createBranch,
  listIssues,
  listPullRequests,
  listRepos,
  openPullRequest,
  push,
  repositoryState,
  scrub,
  storeToken,
  branchName,
  repoSlug,
};
