"use strict";

/**
 * mac.sh must never create a node_modules symlink that points at an empty
 * folder.
 *
 * The bug this pins: node_modules_mac was renamed while `node_modules` was a
 * symlink to it. The launcher saw a dangling link, skipped the migration
 * (`-d` is false), then `mkdir -p node_modules_mac` + `ln -sf` manufactured a
 * brand new EMPTY target on every launch. Everything still said "Running!"
 * because serve.cjs serves app/dist, but `vite build` died with
 * ERR_MODULE_NOT_FOUND and the self-heal swallowed it.
 *
 * A fresh checkout is the deliberate exception: it has no dependencies yet,
 * and setup.sh installs them into the link it creates itself. The fatal guard
 * must therefore only fire when setup is NOT going to run.
 *
 * Run: node scripts/validation/test-mac-deps-guard.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const macSh = path.join(root, "mac.sh");
const setupSh = path.join(root, "scripts", "setup", "setup.sh");

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

const source = fs.readFileSync(macSh, "utf8");

/** Write a fake but structurally real vite install into a node_modules dir. */
function fakeVite(dir) {
  fs.mkdirSync(path.join(dir, "vite", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "vite", "package.json"), '{"name":"vite","version":"8.1.0"}\n');
  fs.writeFileSync(path.join(dir, "vite", "bin", "vite.js"), "// fixture\n");
}

/**
 * Run the REAL node_modules block of mac.sh in a throwaway repo. mac.sh is a
 * macOS launcher that goes on to start servers, so the copy is truncated just
 * before the first-time setup check and reports the state instead. `uname` is
 * stubbed to answer Darwin, and (optionally) `ln` is stubbed to fail only for
 * the symlink capability probe, which exercises the exFAT fallback.
 */
function runFixture(prepare, { noSymlinks = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-mac-deps-"));
  const repo = path.join(tmp, "repo");
  const frontend = path.join(repo, "app", "frontend");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(frontend, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });

  fs.writeFileSync(path.join(bin, "uname"), [
    "#!/usr/bin/env bash",
    'if [[ "${1:-}" == "-s" ]]; then echo Darwin; else exec /usr/bin/uname "$@"; fi',
    "",
  ].join("\n"), { mode: 0o755 });

  if (noSymlinks) {
    fs.writeFileSync(path.join(bin, "ln"), [
      "#!/usr/bin/env bash",
      'last="${@: -1}"',
      'if [[ "$last" == *".test_symlink" ]]; then exit 1; fi',
      'exec /bin/ln "$@"',
      "",
    ].join("\n"), { mode: 0o755 });
  }

  const cut = source.indexOf("# ── First-time setup check");
  if (cut < 0) throw new Error("mac.sh no longer has the first-time setup marker");
  const probe = [
    'echo "FLAG=$FRONTEND_DEPS_INCOMPLETE"',
    'if [[ -L "$FRONTEND_NODE_MODULES" ]]; then echo "LINK=$(readlink "$FRONTEND_NODE_MODULES")"; else echo "LINK=NONE"; fi',
    'if [[ -f "$FRONTEND_NODE_MODULES/vite/package.json" && -f "$FRONTEND_NODE_MODULES/vite/bin/vite.js" ]]; then echo "VITE=yes"; else echo "VITE=no"; fi',
    'if [[ -f "$MAC_NODE_MODULES/vite/package.json" ]]; then echo "MACVITE=yes"; else echo "MACVITE=no"; fi',
    "",
  ].join("\n");
  const script = path.join(repo, "mac.sh");
  fs.writeFileSync(script, source.slice(0, cut) + probe, { mode: 0o755 });

  prepare({ repo, frontend, fakeVite });

  const result = spawnSync("bash", [script], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH || ""}` },
  });
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  const value = (key) => {
    const match = out.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match ? match[1].trim() : "";
  };
  const observed = {
    status: result.status,
    out,
    FLAG: value("FLAG"),
    LINK: value("LINK"),
    VITE: value("VITE"),
    MACVITE: value("MACVITE"),
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  return observed;
}

async function main() {
  console.log("mac.sh frontend dependency guard validation");

  section("1. The guard is really in the launcher");
  const syntax = spawnSync("bash", ["-n", macSh], { encoding: "utf8" });
  check("mac.sh still parses (bash -n)", syntax.status === 0, String(syntax.stderr || ""));
  check("a helper decides whether a folder really has vite", /has_frontend_deps\(\) \{/.test(source));
  check("it checks both vite/package.json and the vite binary",
    /\$1\/vite\/package\.json/.test(source) && /\$1\/vite\/bin\/vite\.js/.test(source));
  check("the incomplete flag starts out unset", /FRONTEND_DEPS_INCOMPLETE=0/.test(source));
  const guardAt = source.indexOf('if has_frontend_deps "$MAC_NODE_MODULES"; then');
  const linkAt = source.indexOf('ln -sfn "node_modules_mac" "$FRONTEND_NODE_MODULES"');
  check("the target is checked BEFORE the symlink is created",
    guardAt >= 0 && linkAt >= 0 && guardAt < linkAt, `guard@${guardAt} link@${linkAt}`);
  check("the empty mkdir -p + link combination is gone",
    !source.includes('mkdir -p "$MAC_NODE_MODULES"'));
  check("an incomplete target sets the flag instead of linking",
    /FRONTEND_DEPS_INCOMPLETE=1/.test(source)
    && /refusing to link to an empty folder/.test(source));
  check("the symlink is created without dereferencing a stale directory link",
    /ln -sfn "node_modules_mac"/.test(source));
  check("a real node_modules is only migrated when it is the healthier copy",
    /if has_frontend_deps "\$FRONTEND_NODE_MODULES" \|\| ! has_frontend_deps "\$MAC_NODE_MODULES"; then/.test(source));
  check("the exFAT fallback is guarded too",
    /if ! has_frontend_deps "\$FRONTEND_NODE_MODULES"; then/.test(source));

  section("2. An installed machine stops loudly instead of starting broken");
  const fatal = 'if [[ "$FRONTEND_DEPS_INCOMPLETE" == "1" && -z "$SETUP_REASON" ]]; then';
  check("the fatal check only fires when setup will NOT run", source.includes(fatal));
  const whisperReason = source.indexOf('SETUP_REASON="macOS whisper.cpp speech backend is missing."');
  check("it sits AFTER all SETUP_REASON checks", whisperReason >= 0 && whisperReason < source.indexOf(fatal));
  check("it exits non-zero rather than printing Running!", /exit 1/.test(source.slice(source.indexOf(fatal))));
  check("it says why in plain words", /Frontend dependencies are incomplete: vite was not found/.test(source));
  check("it hands over a copy-paste repair",
    /npm ci/.test(source) && /rm -rf node_modules/.test(source) && /\.\/mac\.sh/.test(source));
  check("a fresh checkout still reaches setup.sh",
    /SETUP_REASON="Frontend build is missing\."/.test(source));
  const setup = fs.readFileSync(setupSh, "utf8");
  check("setup.sh still installs dependencies into the link it creates",
    /ln -sf "\$OS_LABEL" "\$FRONTEND_NODE_MODULES"/.test(setup)
    && /install --prefer-offline/.test(setup));

  section("3. Behaviour: symlink-capable filesystem (APFS / HFS+)");
  const healthy = runFixture(({ frontend, fakeVite }) => {
    fakeVite(path.join(frontend, "node_modules_mac"));
  });
  check("a complete node_modules_mac is linked and usable",
    healthy.status === 0 && healthy.FLAG === "0" && healthy.LINK === "node_modules_mac"
    && healthy.VITE === "yes" && healthy.MACVITE === "yes", JSON.stringify(healthy));

  const dangling = runFixture(({ frontend }) => {
    fs.symlinkSync("node_modules_mac", path.join(frontend, "node_modules"));
  });
  check("a dangling symlink does NOT become a link to an empty folder",
    dangling.status === 0 && dangling.FLAG === "1" && dangling.LINK === "NONE"
    && dangling.VITE === "no" && dangling.MACVITE === "no", JSON.stringify(dangling));
  check("the refusal is visible in the launcher output",
    /refusing to link to an empty folder/.test(dangling.out), dangling.out.slice(-200));

  const emptyTarget = runFixture(({ frontend }) => {
    fs.mkdirSync(path.join(frontend, "node_modules_mac"), { recursive: true });
  });
  check("an existing but empty node_modules_mac is refused too",
    emptyTarget.FLAG === "1" && emptyTarget.LINK === "NONE" && emptyTarget.VITE === "no",
    JSON.stringify(emptyTarget));

  const npmInstalled = runFixture(({ frontend, fakeVite }) => {
    fs.mkdirSync(path.join(frontend, "node_modules_mac"), { recursive: true });
    fakeVite(path.join(frontend, "node_modules"));
  });
  check("npm install's real node_modules with vite is migrated and linked",
    npmInstalled.FLAG === "0" && npmInstalled.VITE === "yes" && npmInstalled.MACVITE === "yes",
    JSON.stringify(npmInstalled));

  const incompleteReal = runFixture(({ frontend, fakeVite }) => {
    fakeVite(path.join(frontend, "node_modules_mac"));
    fs.mkdirSync(path.join(frontend, "node_modules"), { recursive: true });
  });
  check("an empty real node_modules does NOT delete the complete mac folder",
    incompleteReal.FLAG === "0" && incompleteReal.VITE === "yes" && incompleteReal.MACVITE === "yes",
    JSON.stringify(incompleteReal));
  check("and says which copy it kept", /node_modules_mac is complete/.test(incompleteReal.out));

  section("4. Behaviour: filesystem without symlinks (exFAT / FAT32)");
  const fallbackHealthy = runFixture(({ frontend, fakeVite }) => {
    fakeVite(path.join(frontend, "node_modules_mac"));
  }, { noSymlinks: true });
  check("the fallback swaps a complete folder in",
    fallbackHealthy.status === 0 && fallbackHealthy.FLAG === "0"
    && fallbackHealthy.VITE === "yes" && fallbackHealthy.LINK === "NONE",
    JSON.stringify(fallbackHealthy));

  const fallbackEmpty = runFixture(({ frontend }) => {
    fs.mkdirSync(path.join(frontend, "node_modules"), { recursive: true });
  }, { noSymlinks: true });
  check("the fallback flags an empty folder instead of pretending it is fine",
    fallbackEmpty.FLAG === "1" && fallbackEmpty.VITE === "no" && fallbackEmpty.LINK === "NONE",
    JSON.stringify(fallbackEmpty));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
