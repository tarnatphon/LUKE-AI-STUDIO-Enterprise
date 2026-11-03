"use strict";

/**
 * A `git pull` must not leave the browser on the previous version's bundle.
 *
 * vite.config.js stamps `git rev-parse HEAD` into app/dist/build-info.json and
 * serve.cjs reports `frontend.stale`, but the launchers never used to look at
 * it. mac.sh had a manifest-only self-heal that ran BEFORE the node_modules
 * guard with its build output swallowed; linux.sh had no check at all. Both
 * now call scripts/setup/check-frontend-build.sh AFTER the guard and AFTER
 * setup.sh.
 *
 * This suite executes the REAL helper in throwaway repos with stubbed
 * `git`/`npm`, covering: matching stamp, different commit, missing stamp,
 * missing asset, missing manifest, missing index.html, no .git, no git binary,
 * vite missing, build failing, and a build that exits 0 but leaves the wrong
 * stamp. It also pins that two builds of the same commit stay byte-identical
 * (test-frontend-dist-freshness.cjs relies on that).
 *
 * Run: node scripts/validation/test-frontend-build-self-heal.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const helperPath = path.join(root, "scripts", "setup", "check-frontend-build.sh");
const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

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

/** Find an executable without relying on `which` being installed. */
function findCommand(cmd) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(dir, cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

const BASH = findCommand("bash") || "/bin/bash";

function write(pathname, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, content, { mode });
}

function fixture({ stamp = "match", manifest = "present", indexHtml = true, vite = true,
                   distExists = true, gitMode = "ok", npmMode = "ok" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-frontend-build-"));
  const repo = path.join(tmp, "repo");
  const frontend = path.join(repo, "app", "frontend");
  const dist = path.join(repo, "app", "dist");
  const stubbin = path.join(tmp, "bin");
  const marker = path.join(tmp, "npm-called");
  fs.mkdirSync(stubbin, { recursive: true });
  fs.mkdirSync(path.join(dist, ".vite"), { recursive: true });

  if (vite) {
    write(path.join(frontend, "node_modules", "vite", "package.json"),
      '{"name":"vite","version":"8.1.0"}\n');
    write(path.join(frontend, "node_modules", "vite", "bin", "vite.js"), "// fixture\n");
  }

  if (indexHtml && distExists) {
    write(path.join(dist, "index.html"), '<html><body>fixture</body></html>\n');
  }

  if (distExists) {
    if (stamp === "match" || stamp === "mismatch") {
      const commit = stamp === "match" ? HEAD : OTHER;
      write(path.join(dist, "build-info.json"),
        `{\n  "available": true,\n  "commit": "${commit}",\n  "shortCommit": "${commit.slice(0, 7)}",\n  "branch": "main"\n}\n`);
    } else if (stamp === "nostamp") {
      write(path.join(dist, "build-info.json"), '{\n  "available": true,\n  "branch": "main"\n}\n');
    } // "missing" writes nothing
  }

  if (manifest !== "missing") {
    write(path.join(dist, ".vite", "manifest.json"), JSON.stringify({
      "index.html": {
        file: "assets/index-AAA.js",
        css: ["assets/index-BBB.css"],
        src: "index.html",
        isEntry: true,
      },
    }));
    if (manifest === "present") {
      write(path.join(dist, "assets", "index-AAA.js"), "// chunk\n");
      write(path.join(dist, "assets", "index-BBB.css"), "/* css */\n");
    } // "missing-asset" leaves both chunks absent
  }

  fs.mkdirSync(path.join(repo, "scripts", "setup"), { recursive: true });
  fs.copyFileSync(helperPath, path.join(repo, "scripts", "setup", "check-frontend-build.sh"));

  // git stub: `-C <dir> rev-parse --verify HEAD` is the only call the helper
  // makes. "no-repo" simulates a zip/exported tree with no .git.
  write(path.join(stubbin, "git"), [
    "#!/usr/bin/env bash",
    'if [[ "${1:-}" == "-C" ]]; then shift 2; fi',
    'if [[ "${1:-}" == "rev-parse" && "${2:-}" == "--verify" && "${3:-}" == "HEAD" ]]; then',
    '  [[ "${LUKE_TEST_GIT_MODE:-ok}" == "no-repo" ]] && exit 1',
    '  echo "$LUKE_TEST_HEAD"',
    "  exit 0",
    "fi",
    "exit 1",
    "",
  ].join("\n"), 0o755);

  // npm stub: records whether a rebuild was attempted, then behaves as asked.
  write(path.join(stubbin, "npm"), [
    "#!/usr/bin/env bash",
    'echo called > "$LUKE_TEST_MARKER"',
    'case "${LUKE_TEST_NPM_MODE:-ok}" in',
    "  fail) exit 1 ;;",
    '  wrongstamp)',
    '    printf \'{\\n  "commit": "%s"\\n}\\n\' "$LUKE_TEST_OTHER" > "$LUKE_TEST_DIST/build-info.json"',
    '    echo "<html>fixture</html>" > "$LUKE_TEST_DIST/index.html"',
    "    exit 0 ;;",
    '  *)',
    '    printf \'{\\n  "commit": "%s",\\n  "shortCommit": "%s"\\n}\\n\' "$LUKE_TEST_HEAD" "${LUKE_TEST_HEAD:0:7}" > "$LUKE_TEST_DIST/build-info.json"',
    '    echo "<html>fixture</html>" > "$LUKE_TEST_DIST/index.html"',
    "    exit 0 ;;",
    "esac",
    "",
  ].join("\n"), 0o755);

  const env = {
    ...process.env,
    LUKE_TEST_HEAD: HEAD,
    LUKE_TEST_OTHER: OTHER,
    LUKE_TEST_MARKER: marker,
    LUKE_TEST_DIST: dist,
    LUKE_TEST_GIT_MODE: gitMode,
    LUKE_TEST_NPM_MODE: npmMode,
    GIT_CEILING_DIRECTORIES: tmp,
  };

  if (gitMode === "no-binary") {
    // A PATH with the shell tools but WITHOUT git. `command -v git` must fail
    // and the helper must exit 0 quietly (offline-first, zip installs).
    const toolbin = path.join(tmp, "tools");
    fs.mkdirSync(toolbin, { recursive: true });
    for (const cmd of ["uname", "sed", "grep", "tr", "sort", "head", "dirname", "cat"]) {
      const found = findCommand(cmd);
      if (found) fs.symlinkSync(found, path.join(toolbin, cmd));
    }
    env.PATH = toolbin;
  } else {
    env.PATH = `${stubbin}:${process.env.PATH || ""}`;
  }

  const result = spawnSync(BASH, [path.join(repo, "scripts", "setup", "check-frontend-build.sh")], {
    cwd: repo,
    encoding: "utf8",
    env,
  });
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  const npmCalled = fs.existsSync(marker);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { status: result.status, out, npmCalled };
}

async function main() {
  console.log("frontend build self-heal validation");
  const helper = fs.readFileSync(helperPath, "utf8");
  const macSh = fs.readFileSync(path.join(root, "mac.sh"), "utf8");
  const linuxSh = fs.readFileSync(path.join(root, "linux.sh"), "utf8");

  section("1. The helper exists and is wired into both launchers");
  check("helper parses (bash -n)", spawnSync("bash", ["-n", helperPath], { encoding: "utf8" }).status === 0);
  for (const [name, source] of [["mac.sh", macSh], ["linux.sh", linuxSh]]) {
    check(`${name}: parses (bash -n)`,
      spawnSync("bash", ["-n", path.join(root, name)], { encoding: "utf8" }).status === 0);
    const fatalAt = source.indexOf('FRONTEND_DEPS_INCOMPLETE" == "1"');
    const setupAt = source.indexOf('if [[ -n "$SETUP_REASON" ]]; then');
    const callAt = source.indexOf("CHECK_FRONTEND_BUILD=");
    check(`${name}: calls the helper AFTER the deps guard and AFTER setup.sh`,
      fatalAt >= 0 && setupAt > fatalAt && callAt > setupAt,
      `fatal@${fatalAt} setup@${setupAt} call@${callAt}`);
    check(`${name}: failing the helper stops the launch`, /exit 1/.test(source.slice(callAt, callAt + 700)));
    check(`${name}: references the shared helper by its real path`,
      source.includes("$SCRIPT_DIR/scripts/setup/check-frontend-build.sh"));
  }
  check("the old pre-guard, output-swallowing self-heal is gone from mac.sh",
    !macSh.includes("MISSING_ASSET") && !macSh.includes("npm run build) >/dev/null"));
  check("helper compares the stamp with git rev-parse HEAD",
    /git -C "\$ROOT_DIR" rev-parse --verify HEAD/.test(helper));
  check("helper skips quietly when git is unavailable", /command -v git/.test(helper) && /exit 0/.test(helper));
  check("helper checks vite BEFORE rebuilding",
    helper.indexOf("vite/bin/vite.js") < helper.indexOf("BUILD_CMD="));
  const buildCallAt = helper.indexOf('"${BUILD_CMD[@]}"');
  const verifyAt = helper.indexOf("still does not match HEAD");
  check("helper verifies the stamp AFTER the build",
    buildCallAt >= 0 && verifyAt > buildCallAt);
  check("helper exits non-zero rather than serving a stale UI",
    /fail_rebuild/.test(helper) && /exit 1/.test(helper));
  check("helper keeps bundles byte-identical (no wall clock)",
    !/Date\.now|\$\(date|\bdate \+/.test(helper));
  check("test-frontend-dist-freshness.cjs is still the byte-identity gate",
    fs.existsSync(path.join(root, "scripts", "validation", "test-frontend-dist-freshness.cjs")));

  section("2. Behaviour: a bundle that already matches HEAD");
  const match = fixture();
  check("no rebuild, exit 0, says the bundle matches",
    match.status === 0 && !match.npmCalled && /Frontend bundle matches/.test(match.out),
    JSON.stringify(match));
  const matchManifestOnly = fixture({ manifest: "missing-asset" });
  check("a missing emitted asset still forces a rebuild even when the stamp matches",
    matchManifestOnly.status === 0 && matchManifestOnly.npmCalled
    && /a bundle asset is missing/.test(matchManifestOnly.out), JSON.stringify(matchManifestOnly));

  section("3. Behaviour: every stale/incomplete state is rebuilt");
  const cases = [
    ["different commit after git pull", { stamp: "mismatch" }, /bundle was built from b{7}, checkout is a{7}/],
    ["no build-info.json", { stamp: "missing" }, /build-info.json is missing/],
    ["build-info.json without a commit", { stamp: "nostamp" }, /no commit stamp/],
    ["missing build manifest", { manifest: "missing" }, /manifest is missing/],
    ["missing index.html", { indexHtml: false }, /index.html is missing/],
    ["missing emitted chunk", { manifest: "missing-asset" }, /a bundle asset is missing/],
    ["no dist at all", { distExists: false }, /index.html is missing/],
  ];
  for (const [label, options, expected] of cases) {
    const r = fixture(options);
    check(`${label}: rebuilds and verifies the new stamp`,
      r.status === 0 && r.npmCalled && expected.test(r.out) && /Rebuilt at a{7}/.test(r.out),
      JSON.stringify(r));
  }

  section("4. Behaviour: offline / zip installs are never blocked");
  const noRepo = fixture({ gitMode: "no-repo", stamp: "mismatch" });
  check("no .git → skips quietly without rebuilding",
    noRepo.status === 0 && !noRepo.npmCalled && noRepo.out.trim() === "", JSON.stringify(noRepo));
  const noGitBinary = fixture({ gitMode: "no-binary", stamp: "mismatch" });
  check("no git binary on PATH → skips quietly without rebuilding",
    noGitBinary.status === 0 && !noGitBinary.npmCalled && noGitBinary.out.trim() === "",
    JSON.stringify(noGitBinary));

  section("5. Behaviour: failures are loud, never a stale UI");
  const noVite = fixture({ stamp: "mismatch", vite: false });
  check("vite missing → exits 1 BEFORE attempting npm",
    noVite.status === 1 && !noVite.npmCalled && /vite is missing/.test(noVite.out),
    JSON.stringify(noVite));
  const buildFails = fixture({ stamp: "mismatch", npmMode: "fail" });
  check("npm run build fails → exit 1 with a repair command",
    buildFails.status === 1 && /Frontend rebuild failed/.test(buildFails.out)
    && /npm run build/.test(buildFails.out), JSON.stringify(buildFails));
  const wrongStamp = fixture({ stamp: "mismatch", npmMode: "wrongstamp" });
  check("build exits 0 but leaves a wrong stamp → exit 1 (not a stale UI)",
    wrongStamp.status === 1 && /still does not match HEAD/.test(wrongStamp.out),
    JSON.stringify(wrongStamp));
  const healthyButNoVite = fixture({ vite: false });
  check("a matching bundle needs no rebuild, so missing vite does not block it",
    healthyButNoVite.status === 0 && !healthyButNoVite.npmCalled,
    JSON.stringify(healthyButNoVite));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
