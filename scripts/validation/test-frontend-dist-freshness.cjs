#!/usr/bin/env node
"use strict";

/**
 * The build on this machine is the thing that gets served, and nothing checked
 * that it matches the source.
 *
 * This header used to say app/dist was "tracked in git on purpose" and that the
 * remedy for a stale bundle was to commit it. Neither is true: app/dist is
 * ignored (twice, in .gitignore) and has never been in a commit, so the advice
 * could not be followed and the comparison was not against a commit at all —
 * it is against whatever this checkout last built. mac.sh owns the real rule:
 * scripts/setup/check-frontend-build.sh compares the commit stamped into
 * app/dist/build-info.json with HEAD and rebuilds when they differ.
 *
 * What is left, and is still worth having, is the local question: is the folder
 * this server serves current with the source beside it? Edit a component, forget
 * to rebuild, and the browser shows last week's UI while the server answers with
 * this week's API — with nothing anywhere saying so.
 *
 * So this rebuilds into a throwaway directory and compares file by file. Vite's
 * output is content-hashed and byte-reproducible (verified again below: two
 * builds of the same source are identical), so a difference means the source
 * moved and the build did not.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const dist = path.join(root, "app", "dist");
const vite = path.join(frontend, "node_modules", "vite", "bin", "vite.js");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

function main() {
  console.log("\n=== Frontend dist freshness ===\n");

  if (!fs.existsSync(vite)) {
    console.log("BLOCKED: vite is not installed under app/frontend/node_modules");
    console.log("REMEDY: npm ci --prefix app/frontend");
    process.exit(3);
  }

  if (!fs.existsSync(dist)) {
    console.log("BLOCKED: there is no app/dist here to compare against");
    console.log("REMEDY: npm --prefix app/frontend run build");
    process.exit(3);
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-dist-check-"));
  const outDir = path.join(temp, "dist");

  try {
    const build = spawnSync(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir"], {
      cwd: frontend,
      encoding: "utf8",
      timeout: 300000,
    });

    assert(
      build.status === 0,
      `The frontend builds cleanly (exit ${build.status}).${
        build.status === 0 ? "" : `\n${String(build.stderr || build.stdout || "").slice(-800)}`
      }`
    );

    const committed = listFiles(dist);
    const fresh = listFiles(outDir);

    const missing = fresh.filter((file) => !committed.includes(file));
    const extra = committed.filter((file) => !fresh.includes(file));
    const stale = fresh
      .filter((file) => committed.includes(file))
      .filter((file) => sha256(path.join(dist, file)) !== sha256(path.join(outDir, file)));

    console.log(`  committed: ${committed.length} files · fresh build: ${fresh.length} files`);

    if (missing.length) console.log(`  not committed: ${missing.slice(0, 8).join(", ")}`);
    if (extra.length) console.log(`  committed but no longer built: ${extra.slice(0, 8).join(", ")}`);
    if (stale.length) console.log(`  different content: ${stale.slice(0, 8).join(", ")}`);

    assert(
      missing.length === 0,
      `Every file a fresh build produces is committed (${missing.length} are not).`
    );
    assert(
      extra.length === 0,
      `Nothing is committed that a fresh build no longer produces (${extra.length} are).`
    );
    assert(
      stale.length === 0,
      `Every committed bundle matches a fresh build byte for byte (${stale.length} do not).`
    );

    assert(
      committed.includes("index.html"),
      "index.html is among them, which is what mac.sh and serve.cjs both start from."
    );

    console.log("\n  If this fails, the served UI is older than the source beside it:");
    console.log("    npm --prefix app/frontend run build");
    console.log("  app/dist is git-ignored, so there is nothing to commit — mac.sh rebuilds");
    console.log("  it from the commit stamp on every launch.\n");

    console.log("  PASS: Frontend dist freshness completed.\n");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
