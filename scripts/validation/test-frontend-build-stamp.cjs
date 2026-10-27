#!/usr/bin/env node
"use strict";

/**
 * "I rebuilt it and the feature is still not there."
 *
 * That report is almost never a code bug: the tab is running a bundle from an
 * older commit, or app/dist was never rebuilt after a pull. Both look exactly
 * like a broken feature, and telling them apart used to need devtools and a
 * chunk-hash comparison.
 *
 * The app now stamps the commit into the bundle (vite.config.js), writes the
 * same stamp into app/dist/build-info.json, and the server reports both the
 * commit it runs from (source-info.cjs) and the commit the dist on disk was
 * built from (/api/health). The sidebar compares them and prints the fix.
 *
 * These checks cover the four links in that chain, and the one property that
 * makes it safe: the stamp must stay reproducible, because
 * test-frontend-dist-freshness rebuilds the frontend and compares it with the
 * committed dist byte for byte. A wall-clock timestamp in the bundle would
 * break that on every run.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function git(...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function main() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);

  test("the server can name the commit it runs from", () => {
    const { readSourceInfo, createSourceInfoReader } = require("../server/source-info.cjs");
    const info = readSourceInfo(root);
    assert(info.available, "a git checkout is detected");
    assert(info.commit === git("rev-parse", "HEAD"), "the commit matches git rev-parse HEAD");
    assert(info.shortCommit === info.commit.slice(0, 7), "a short sha is derived, not guessed");
    assert(typeof info.dirty === "boolean", "uncommitted edits are reported as a boolean");
    assert(info.branch.length > 0, "the branch is reported");
    assert(!Number.isNaN(Date.parse(info.commitDate)), "the commit date parses");

    // A tarball, a shallow export or a machine without git must not crash the
    // health endpoint — it has to say "unknown" and carry on.
    const outside = readSourceInfo(os.tmpdir());
    assert(outside.available === false && outside.commit === "", "outside a repo it reports unknown instead of throwing");

    const cached = createSourceInfoReader(root, 60000);
    assert(cached() === cached(), "the reader caches between health polls");
    cached.invalidate();
    assert(cached().available, "and can be invalidated");
  });

  test("the build stamps its own commit, and only what is reproducible", () => {
    const config = read("app", "frontend", "vite.config.js");
    assert(/function readBuildStamp\(\)/.test(config), "the config reads a stamp");
    assert(/git", \["-C", REPO_ROOT, \.\.\.args\]/.test(config), "it asks git for it");
    assert(/"import\.meta\.env\.VITE_LUKE_BUILD": JSON\.stringify\(JSON\.stringify\(BUILD_STAMP\)\)/.test(config),
      "it is injected through import.meta.env, so no global has to be declared");
    assert(/name: "luke-build-info"/.test(config), "a plugin writes build-info.json");
    assert(/configResolved\(config\)/.test(config) && /path\.resolve\(config\.root, config\.build\.outDir\)/.test(config),
      "the plugin writes to the resolved outDir, so a --outDir build is stamped too");

    // The reproducibility constraint, stated as a check rather than a comment.
    const stampBlock = config.slice(config.indexOf("function readBuildStamp"), config.indexOf("const BUILD_STAMP"));
    assert(!/Date\.now\(\)|new Date\(\)|builtAt/.test(stampBlock),
      "the stamp carries no wall-clock time — two builds of one commit stay byte-identical");

    const info = JSON.parse(read("app", "dist", "build-info.json"));
    assert(!("builtAt" in info) || info.builtAt === "", "the written build-info.json has no build timestamp");
    assert(/^[0-9a-f]{40}$/.test(info.commit), "it records the full commit sha");
    assert(info.shortCommit === info.commit.slice(0, 7), "and the short sha the UI prints");
  });

  test("the running bundle is stamped with the commit it was built from", () => {
    const dist = path.join(root, "app", "dist");
    if (!fs.existsSync(dist)) {
      console.log("    (no app/dist here — skipping the bundle comparison)");
      return;
    }
    const info = JSON.parse(read("app", "dist", "build-info.json"));
    const entry = fs.readdirSync(path.join(dist, "assets")).filter((file) => /^index-.*\.js$/.test(file));
    assert(entry.length === 1, `the entry chunk is identifiable (${entry.join(", ")})`);
    const bundle = fs.readFileSync(path.join(dist, "assets", entry[0]), "utf8");
    assert(bundle.includes(info.shortCommit), "the entry chunk really contains the stamped sha");
    assert(bundle.includes("build-stamp"), "and the component that shows it");
  });

  test("a stale bundle is told apart from a stale build", async () => {
    const mod = await import(pathToFileURL(path.join(root, "app", "frontend", "src", "lib", "build-info.mjs")).href);
    const sha = (letter) => letter.repeat(40);
    const build = {
      available: true, commit: sha("a"), shortCommit: "aaaaaaa",
      branch: "main", dirty: false, commitDate: "2026-10-27T10:00:00+07:00", version: "1.0.0-beta.16",
    };
    const health = (distCommit, sourceCommit) => ({
      source: { available: true, commit: sourceCommit, shortCommit: sourceCommit.slice(0, 7) },
      frontend: { commit: distCommit, shortCommit: distCommit.slice(0, 7) },
    });

    assert(mod.diagnoseBuild({ build, health: health(sha("a"), sha("a")) }).state === "ok",
      "matching commits are reported as up to date");
    assert(mod.diagnoseBuild({ build, health: health(sha("a"), sha("b")) }).state === "stale",
      "a dist older than the source is 'stale'");
    assert(mod.diagnoseBuild({ build, health: health(sha("b"), sha("c")) }).state === "cached",
      "a tab older than the file on disk is 'cached'");
    assert(mod.diagnoseBuild({ build }).state === "info",
      "with no server answer it reports the build and claims nothing");
    assert(mod.diagnoseBuild({ build: { available: false } }).state === "unknown",
      "an unstamped bundle is 'unknown', never a green tick");

    const stale = mod.diagnoseBuild({ build, health: health(sha("a"), sha("b")) });
    assert(stale.hint.includes("vite build"), "the stale fix is the actual build command");
    const cached = mod.diagnoseBuild({ build, health: health(sha("b"), sha("c")) });
    assert(/Cmd\+Shift\+R/.test(cached.hint), "the cached fix is a hard reload");

    assert(mod.buildLabel(build).includes("aaaaaaa"), "the label carries the short sha");
    assert(mod.buildLabel({ ...build, branch: "HEAD" }) === "1.0.0-beta.16 · aaaaaaa",
      "a detached HEAD prints no branch name");
    assert(/ไม่ทราบ/.test(mod.buildLabel({ available: false })), "an unknown build says so in Thai");
  });

  test("the server reports both stamps in /api/health", () => {
    const serve = read("scripts", "server", "serve.cjs");
    assert(/require\("\.\/source-info\.cjs"\)/.test(serve), "serve.cjs uses the source reader");
    assert(/createSourceInfoReader\(ROOT\)/.test(serve), "cached, not run per request");
    assert(/readFileSync\(path\.join\(DIST, "build-info\.json"\)/.test(serve), "it reads the dist stamp");
    assert(/stale: Boolean\(frontendBuild && source\.available/.test(serve),
      "it states staleness itself instead of leaving it to the browser");
    assert(/source,\n\s+frontend: \{/.test(serve), "health carries source and frontend");
  });

  test("the app shows the stamp and the repair step", () => {
    const stamp = read("app", "frontend", "src", "components", "BuildStamp.jsx");
    assert(/import \{ BUILD_STATE_TH, diagnoseBuild \} from "\.\.\/lib\/build-info\.mjs"/.test(stamp), "it uses the shared diagnosis");
    assert(/data-build-state=\{state\}/.test(stamp), "the state is machine-readable for future checks");
    assert(/build-stamp-hint/.test(stamp), "the repair step is rendered, not only in a title");
    assert(/title=\{title\}/.test(stamp), "the full detail is in the tooltip");

    const sidebar = read("app", "frontend", "src", "components", "Sidebar.jsx");
    assert(/import BuildStamp from "\.\/BuildStamp"/.test(sidebar), "the sidebar renders it");
    assert(/<BuildStamp health=\{health\} \/>/.test(sidebar), "with the health payload");
    assert(/health = null,/.test(sidebar), "and a default, so the sidebar works without it");

    const app = read("app", "frontend", "src", "App.jsx");
    assert(/specs=\{specs\}\n\s+health=\{health\}/.test(app), "App passes health down");

    const builder = read("app", "frontend", "src", "components", "WorkflowBuilder.jsx");
    assert(/<BuildStamp compact \/>/.test(builder), "the workflow header shows it too");

    const css = read("app", "frontend", "src", "App.css");
    for (const state of ["ok", "info", "unknown", "stale", "cached"]) {
      assert(css.includes(`.build-stamp.${state}`), `the ${state} state has a style`);
    }
  });

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok - ${name}`);
    } catch (error) {
      console.error(`  FAIL - ${name}\n${error.stack || error}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`PASS: ${tests.length} build-stamp checks`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
