#!/usr/bin/env node
"use strict";

/**
 * "I rebuilt it and the new thing is still not there."
 *
 * That sentence has four different causes and they look identical on screen:
 *
 *   1. the checkout is older than the feature (the branch was never pulled);
 *   2. the checkout is current but app/dist was never rebuilt — and app/dist is
 *      what the server sends, not src/;
 *   3. the server on :1420 is running from a *different folder* than the one you
 *      just edited;
 *   4. the bundle is current but the browser is still running the previous one
 *      (a service worker / cached index.html), which a hard reload fixes.
 *
 * Guessing between them costs an afternoon. This prints which one it is, with the
 * evidence, and the exact commands that fix it.
 *
 * Usage:
 *   node scripts/tools/luke-which-build.cjs
 *   node scripts/tools/luke-which-build.cjs --port 1420
 *   node scripts/tools/luke-which-build.cjs --url http://127.0.0.1:1422
 *   node scripts/tools/luke-which-build.cjs --feature "Code Models (GGUF)"
 *   node scripts/tools/luke-which-build.cjs --json
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const DIST = path.join(ROOT, "app", "dist");

// What "the feature is here" means in a built bundle. Anything that ships in the
// UI can be checked this way: if the string is not in the served JavaScript, no
// amount of reloading will produce the tab.
const DEFAULT_FEATURE = "Code Models (GGUF)";

function parseArgs(argv) {
  const options = { url: "", port: 1420, json: false, help: false, feature: DEFAULT_FEATURE };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--port") options.port = Number(argv[++i] || options.port);
    else if (arg === "--url") options.url = String(argv[++i] || "");
    else if (arg === "--feature") options.feature = String(argv[++i] || DEFAULT_FEATURE);
  }
  if (!options.url) options.url = `http://127.0.0.1:${options.port}`;
  return options;
}

function help() {
  console.log(`
Which build is on screen?

  node scripts/tools/luke-which-build.cjs                 # checks :1420
  node scripts/tools/luke-which-build.cjs --port 1422
  node scripts/tools/luke-which-build.cjs --feature "AI Library"
  node scripts/tools/luke-which-build.cjs --json

It compares four things: the git checkout, app/dist (what the server sends), the
running server's /api/health, and the bundle the server actually hands out.
`);
}

function git(args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function bundleText() {
  const assets = path.join(DIST, "assets");
  let text = "";
  try {
    for (const file of fs.readdirSync(assets)) {
      if (!file.endsWith(".js")) continue;
      text += fs.readFileSync(path.join(assets, file), "utf8");
    }
  } catch {
    return "";
  }
  return text;
}

/** Everything knowable without asking a server. */
function readLocalState(options = {}) {
  const feature = options.feature || DEFAULT_FEATURE;
  const distInfo = readJson(path.join(DIST, "build-info.json"));
  const distIndex = (() => {
    try {
      return fs.readFileSync(path.join(DIST, "index.html"), "utf8");
    } catch {
      return "";
    }
  })();
  const indexRef = (distIndex.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [""])[0];
  const text = bundleText();
  return {
    root: ROOT,
    commit: git(["rev-parse", "HEAD"]),
    shortCommit: git(["rev-parse", "--short", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    subject: git(["log", "-1", "--pretty=%s"]),
    dirty: Boolean(git(["status", "--porcelain"])),
    dist: distInfo,
    distIndexRef: indexRef,
    hasFeature: text.includes(feature),
    feature,
  };
}

async function readServerState(options = {}) {
  const url = options.url;
  const result = { url, reachable: false, health: null, indexRef: "", error: "" };
  try {
    const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (health.ok) {
      result.health = await health.json();
      result.reachable = true;
    } else {
      result.error = `HTTP ${health.status}`;
    }
  } catch (error) {
    result.error = error?.name === "TimeoutError" ? "timed out" : (error?.message || String(error));
  }
  try {
    const html = await fetch(`${url}/`, { signal: AbortSignal.timeout(2500) });
    if (html.ok) {
      const body = await html.text();
      result.indexRef = (body.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [""])[0];
    }
  } catch {
    // The health probe already reported the failure; this is the HTML half.
  }
  return result;
}

/**
 * The four causes, in the order they can be distinguished. Each answer names one
 * thing to do, because "something is stale" is not actionable at 1 a.m.
 */
function classify(local, server = {}) {
  const health = server.health || {};
  const serverRoot = health.root || "";
  const sourceCommit = health.source?.commit || health.source?.shortCommit || "";
  const frontendCommit = health.frontend?.commit || "";

  if (!server.reachable) {
    return {
      cause: "server-down",
      headline: `No LUKE server answered at ${server.url}.`,
      detail: server.error || "Nothing is listening on that port.",
      steps: ["Start the app (or `node scripts/server/serve.cjs`), then run this again."],
    };
  }

  if (serverRoot && path.resolve(serverRoot) !== path.resolve(local.root)) {
    return {
      cause: "other-checkout",
      headline: "The app on this port is running from a different folder.",
      detail: `server root: ${serverRoot}\n  this folder: ${local.root}`,
      steps: [
        `Quit the app, then start it from ${local.root}`,
        "Or edit the folder the running app points at — nothing you build here will ever appear there.",
      ],
    };
  }

  if (!local.hasFeature) {
    return {
      cause: "bundle-without-feature",
      headline: `app/dist does not contain "${local.feature}".`,
      detail: `dist was built from ${local.dist?.shortCommit || "an unstamped build"}, `
        + `checkout is at ${local.shortCommit || "unknown"}${local.dirty ? " (with uncommitted changes)" : ""}.`,
      steps: [
        "git fetch origin && git status -sb      # is the branch you expect checked out?",
        "npm --prefix app/frontend ci            # only if node_modules is missing",
        "npm --prefix app/frontend run build     # app/dist is what the server serves",
        "Restart the app, then hard-reload the page (Cmd+Shift+R / Ctrl+Shift+R)",
      ],
    };
  }

  if (server.indexRef && local.distIndexRef && server.indexRef !== local.distIndexRef) {
    return {
      cause: "server-serving-other-bundle",
      headline: "The server is handing out a different bundle than the one in app/dist.",
      detail: `served: ${server.indexRef}\n  on disk: ${local.distIndexRef}`,
      steps: [
        "Restart the LUKE server so it re-reads app/dist.",
        "If it persists, another process is serving this port — check `lsof -i :" + (new URL(server.url).port || "1420") + "`.",
      ],
    };
  }

  if (health.frontend?.stale === true || (frontendCommit && sourceCommit && frontendCommit !== sourceCommit)) {
    return {
      cause: "dist-older-than-checkout",
      headline: "The bundle is older than the checkout.",
      detail: `bundle ${frontendCommit.slice(0, 7)} · checkout ${sourceCommit.slice(0, 7)}`,
      steps: [
        "npm --prefix app/frontend run build",
        "Restart the app, then hard-reload the page",
      ],
    };
  }

  if (health.restartRequired === true) {
    return {
      cause: "server-process-old",
      headline: "The running server process predates the checkout.",
      detail: `process loaded ${(health.process?.shortCommit || "?").slice(0, 7)} · checkout is ${sourceCommit.slice(0, 7)}`,
      steps: ["Restart the app so the backend reloads from the current checkout."],
    };
  }

  return {
    cause: "current-bundle",
    headline: `The bundle being served contains "${local.feature}".`,
    detail: `bundle ${(frontendCommit || local.dist?.shortCommit || "?").slice(0, 7)}`
      + ` · checkout ${(sourceCommit || local.shortCommit || "?").slice(0, 7)}`,
    steps: [
      "If the feature is still missing on screen, the tab is running an older bundle from the service worker:",
      "  hard reload (Cmd+Shift+R / Ctrl+Shift+R), or DevTools → Application → Service Workers → Unregister, then reload.",
    ],
  };
}

function printHuman(local, server, verdict) {
  const line = (label, value) => console.log(`${label.padEnd(14)} ${value}`);
  console.log("");
  line("checkout", `${local.root}`);
  line("", `${local.branch || "detached"} @ ${local.shortCommit || "?"}${local.dirty ? " (uncommitted changes)" : ""} — ${local.subject || "no commit"}`);
  line("app/dist", local.dist
    ? `built from ${local.dist.shortCommit || local.dist.commit?.slice(0, 7) || "?"}${local.dist.dirty ? " (dirty source)" : ""} · ${local.hasFeature ? `contains "${local.feature}"` : `does NOT contain "${local.feature}"`}`
    : `no build-info.json — ${local.hasFeature ? "but the bundle has the feature" : "and no feature marker found"}`);
  line("server", server.reachable
    ? `${server.url} · root=${server.health?.root || "?"}`
    : `${server.url} · ${server.error || "unreachable"}`);
  if (server.reachable) {
    line("", `source=${(server.health?.source?.shortCommit || "?").slice(0, 7)}`
      + ` · bundle=${(server.health?.frontend?.shortCommit || "?").slice(0, 7)}`
      + ` · stale=${server.health?.frontend?.stale === true}`
      + ` · restartRequired=${server.health?.restartRequired === true}`);
  }
  console.log("");
  console.log(`VERDICT        ${verdict.headline}`);
  for (const detailLine of String(verdict.detail || "").split("\n")) {
    if (detailLine.trim()) console.log(`               ${detailLine.trim()}`);
  }
  console.log("");
  console.log("DO THIS");
  for (const step of verdict.steps) console.log(`  ${step}`);
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    return 0;
  }
  const local = readLocalState(options);
  const server = await readServerState(options);
  const verdict = classify(local, server);

  if (options.json) {
    console.log(JSON.stringify({ ok: true, local, server: {
      url: server.url,
      reachable: server.reachable,
      root: server.health?.root || "",
      source: server.health?.source || null,
      frontend: server.health?.frontend || null,
      restartRequired: server.health?.restartRequired === true,
      indexRef: server.indexRef,
      error: server.error,
    }, verdict }, null, 2));
    return 0;
  }

  printHuman(local, server, verdict);
  return 0;
}

module.exports = {
  DEFAULT_FEATURE,
  parseArgs,
  readLocalState,
  readServerState,
  classify,
};

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`luke-which-build: ${error.message}`);
    process.exitCode = 1;
  });
}
