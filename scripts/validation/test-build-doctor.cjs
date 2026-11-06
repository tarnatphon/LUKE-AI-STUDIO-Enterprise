#!/usr/bin/env node
"use strict";

/**
 * "I rebuilt it and the new tab is still not there."
 *
 * The doctor exists because that sentence covers four different failures that
 * look identical on screen, and only one of them is fixed by rebuilding. This
 * suite drives each cause through classify() with the shape /api/health really
 * returns, so the advice cannot quietly rot into "try a hard reload" for the
 * case where the checkout is simply old.
 *
 * Run: node scripts/validation/test-build-doctor.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const doctor = require(path.join(root, "scripts", "tools", "luke-which-build.cjs"));
const managerSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "ModelManager.jsx"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "ModelManager.css"), "utf8");
const docPath = path.join(root, "docs", "beta7", "which-build-is-on-screen.md");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

const LOCAL = {
  root: "/repo/luke",
  commit: "7cabe02" + "0".repeat(33),
  shortCommit: "7cabe02",
  branch: "arena/c58b4d5e",
  subject: "AI Library: a Code Models (GGUF) tab",
  dirty: false,
  dist: { commit: "46d7cba" + "0".repeat(33), shortCommit: "46d7cba", dirty: true },
  distIndexRef: "assets/index-NewBuild.js",
  hasFeature: true,
  feature: "Code Models (GGUF)",
};

const health = (overrides = {}) => ({
  ok: true,
  root: "/repo/luke",
  source: { commit: "7cabe02" + "0".repeat(33), shortCommit: "7cabe02", available: true },
  frontend: { commit: "7cabe02" + "0".repeat(33), shortCommit: "7cabe02", stale: false },
  process: { commit: "7cabe02" + "0".repeat(33), shortCommit: "7cabe02", available: true },
  restartRequired: false,
  ...overrides,
});

function server(extra = {}) {
  return { url: "http://127.0.0.1:1420", reachable: true, health: health(extra.health), indexRef: "assets/index-NewBuild.js", error: "", ...extra };
}

function main() {
  console.log("\n=== which build is on screen ===\n");

  // ── 1. no server ──────────────────────────────────────────────────────────
  const down = doctor.classify(LOCAL, { url: "http://127.0.0.1:1420", reachable: false, health: null, indexRef: "", error: "fetch failed" });
  assert(down.cause === "server-down", "no server is reported as no server, not as a stale build");
  assert(down.steps.some((step) => /serve\.cjs/.test(step)), "and it says how to start one");

  // ── 2. the server is running from another folder ──────────────────────────
  const other = doctor.classify(LOCAL, server({ health: health({ root: "/repo/other-checkout" }) }));
  assert(other.cause === "other-checkout", "a server on a different folder is named as such");
  assert(other.detail.includes("/repo/other-checkout"), "and the folder is in the detail");
  assert(other.steps.some((step) => step.includes("/repo/luke")), "with the fix pointing at the folder you edited");

  // ── 3. the bundle simply does not contain the feature ─────────────────────
  const oldBundle = doctor.classify({ ...LOCAL, hasFeature: false }, server());
  assert(oldBundle.cause === "bundle-without-feature", "a bundle without the marker is the first thing that can be wrong");
  assert(
    oldBundle.steps.some((step) => /npm --prefix app\/frontend run build/.test(step)),
    "and the fix is the build command, not a reload",
  );
  assert(
    oldBundle.steps.some((step) => /git fetch/.test(step)),
    "with the checkout checked too, since an old branch also produces it",
  );

  // ── 4. the server hands out a different bundle than the one on disk ───────
  const serving = doctor.classify(LOCAL, server({ indexRef: "assets/index-OldBuild.js" }));
  assert(serving.cause === "server-serving-other-bundle", "a different index asset means another build is being served");
  assert(serving.detail.includes("index-OldBuild.js"), "the served bundle is named");

  // ── 5. dist older than the checkout ───────────────────────────────────────
  const stale = doctor.classify(LOCAL, server({
    health: health({ frontend: { commit: "4".repeat(40), shortCommit: "4444444", stale: true } }),
  }));
  assert(stale.cause === "dist-older-than-checkout", "frontend.stale is reported as a stale dist");
  assert(
    stale.steps.some((step) => /run build/.test(step)),
    "and rebuild is the first instruction",
  );

  // ── 6. the process predates the checkout ──────────────────────────────────
  const oldProcess = doctor.classify(LOCAL, server({
    health: health({ process: { commit: "5".repeat(40), shortCommit: "5555555", available: true }, restartRequired: true }),
  }));
  assert(oldProcess.cause === "server-process-old", "an old backend process is a restart, not a rebuild");

  // ── 7. everything agrees ──────────────────────────────────────────────────
  const fine = doctor.classify(LOCAL, server());
  assert(fine.cause === "current-bundle", "when the numbers agree, it says so");
  assert(
    fine.steps.join(" ").includes("Service Workers"),
    "and the remaining explanation is the service worker, with the button that clears it",
  );

  // ── 7b. the folder is not a checkout at all ───────────────────────────────
  // Running the command inside a models drive (an external SSD, /Volumes/AI)
  // fails with MODULE_NOT_FOUND. The doctor names that instead of talking about
  // stale bundles.
  const notCheckout = doctor.classify(
    { ...LOCAL, root: "/Volumes/AI", isCheckout: false, isGitRepo: false, hasFeature: false, dist: null },
    server(),
  );
  assert(notCheckout.cause === "not-a-checkout", "a folder without a LUKE server is named as not a checkout");
  assert(
    notCheckout.steps.some((step) => step.includes("/repo/luke")),
    "and it points at the folder the app really runs from",
  );

  const noGit = doctor.classify({ ...LOCAL, isGitRepo: false }, server());
  assert(noGit.cause === "current-bundle", "a checkout without git still compares dist and feature markers");

  // ── 7c. --root checks another folder without cd ───────────────────────────
  const elsewhere = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "tools", "luke-which-build.cjs"), "--root", path.join(root, "app"), "--json", "--port", "1"],
    { cwd: os.tmpdir(), encoding: "utf8" },
  );
  const elsewhereJson = JSON.parse(elsewhere.stdout);
  assert(elsewhereJson.local.root === path.join(root, "app"), "--root inspects the folder it is given, not just the cwd");
  assert(elsewhereJson.verdict.cause === "not-a-checkout", "and reports that app/ is not a checkout on its own");

  const sameRepo = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "tools", "luke-which-build.cjs"), "--json", "--port", "1"],
    { cwd: os.tmpdir(), encoding: "utf8" },
  );
  const sameRepoJson = JSON.parse(sameRepo.stdout);
  assert(sameRepoJson.local.root === root, "and defaults to the checkout the script lives in, wherever it is run from");
  assert(sameRepoJson.local.isCheckout === true, "which is a checkout");

  // ── 8. the CLI ────────────────────────────────────────────────────────────
  const cli = spawnSync(process.execPath, [path.join(root, "scripts", "tools", "luke-which-build.cjs"), "--json", "--port", "1"], {
    cwd: root,
    encoding: "utf8",
  });
  assert(cli.status === 0, "the doctor runs even when nothing is listening");
  const parsed = JSON.parse(cli.stdout);
  assert(parsed.ok === true && parsed.local.root, "--json carries the local state");
  assert(parsed.verdict.cause === "server-down", "and the verdict for a dead port");
  assert(typeof parsed.local.hasFeature === "boolean", "including whether app/dist contains the marker");

  const help = spawnSync(process.execPath, [path.join(root, "scripts", "tools", "luke-which-build.cjs"), "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  assert(help.status === 0 && /--feature/.test(help.stdout), "--help documents the marker option");

  // ── 9. the in-app card ────────────────────────────────────────────────────
  assert(/library-build-warning/.test(managerSource), "AI Library shows the build warning");
  assert(
    /buildHealth\?\.frontend\?\.stale === true/.test(managerSource),
    "driven by /api/health's own stale flag rather than a copy of the logic",
  );
  assert(
    /navigator\.serviceWorker\.getRegistrations\(\)/.test(managerSource),
    "its Reload UI button clears the cached app shell before reloading",
  );
  assert(
    /The interface was built from/.test(managerSource) && /The running server loaded/.test(managerSource),
    "it distinguishes a stale bundle from a stale backend",
  );
  assert(/\.library-build-warning\s*\{/.test(cssSource), "and the card has styling");

  // ── 10. the doc ───────────────────────────────────────────────────────────
  assert(fs.existsSync(docPath), "docs/beta7/which-build-is-on-screen.md exists");
  const doc = fs.readFileSync(docPath, "utf8");
  assert(doc.includes("luke-which-build.cjs"), "the doc names the command");
  assert(doc.includes("app/dist"), "and says that app/dist is what the server sends");
  assert(doc.includes("Service Workers"), "and how to clear the cached shell");
  assert(/four different failures|Four causes/i.test(doc), "and why one symptom has four causes");

  console.log(`\nPASS: ${checks} checks — a missing tab is diagnosed, not guessed.\n`);
}

try {
  main();
} catch (error) {
  console.error(`\nFAIL: ${error.message}\n`);
  process.exit(1);
}
