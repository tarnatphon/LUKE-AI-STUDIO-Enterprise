#!/usr/bin/env node
"use strict";

/**
 * The committed app/dist is what the user actually runs — and nothing checked
 * that it matches the source.
 *
 * app/dist is tracked in git on purpose, so a machine that has never built the
 * frontend still gets a working UI. mac.sh self-heals it by restoring any
 * bundle index.html refers to but cannot find. That check passes perfectly for
 * a *stale* build: every referenced file is there, it is just last month's
 * code. Edit a component, forget the build, push, and the user pulls an app
 * whose interface does not match its server, with no warning anywhere.
 *
 * So this rebuilds the frontend into a throwaway directory and compares it
 * file by file with what is committed. Vite's output is content-hashed and
 * byte-reproducible — two builds of the same source were verified identical
 * before this check was written — so any difference means the source moved and
 * the build did not.
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
    console.log("  SKIPPED — app/frontend/node_modules/vite is not installed here.");
    console.log("  This check rebuilds the frontend to compare it with the committed");
    console.log("  app/dist, so it needs vite. Run ./mac.sh once (or npm install in");
    console.log("  app/frontend) and it will check on the next pass.");
    console.log("");
    return;
  }

  assert(fs.existsSync(dist), "The committed app/dist is there to compare against.");

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

    console.log(
      "\n  If this fails: cd app/frontend && node node_modules/vite/bin/vite.js build,"
    );
    console.log("  then commit app/dist. The user's machine runs the committed build,");
    console.log("  not your source.\n");

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
