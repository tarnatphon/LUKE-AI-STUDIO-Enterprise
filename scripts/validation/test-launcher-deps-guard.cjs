"use strict";

/**
 * No launcher may create a node_modules link that points at an empty folder,
 * and setup.sh may not proceed to `vite build` without a usable vite.
 *
 * The bug this pins: node_modules_mac was renamed while `node_modules` was a
 * symlink to it. mac.sh saw a dangling link, skipped the migration (`-d` is
 * false), then `mkdir -p node_modules_mac` + `ln -sf` manufactured a brand new
 * EMPTY target on every launch. Everything still said "Running!" because
 * serve.cjs serves app/dist, but `vite build` died with
 * ERR_MODULE_NOT_FOUND and the self-heal swallowed it. linux.sh had the same
 * code, and setup.sh checked neither.
 *
 * A fresh checkout is the deliberate exception: it has no dependencies yet,
 * and setup.sh installs them into the link it creates itself. The fatal guard
 * must therefore only fire when setup is NOT going to run.
 *
 * Run: node scripts/validation/test-launcher-deps-guard.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const setupSh = path.join(root, "scripts", "setup", "setup.sh");

const LAUNCHERS = [
  { id: "mac", file: "mac.sh", platform: "Darwin", osVar: "MAC_NODE_MODULES", osFolder: "node_modules_mac", start: "./mac.sh" },
  { id: "linux", file: "linux.sh", platform: "Linux", osVar: "LINUX_NODE_MODULES", osFolder: "node_modules_linux", start: "./linux.sh" },
];

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

function readSource(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

/** Write a fake but structurally real vite install into a node_modules dir. */
function fakeVite(dir) {
  fs.mkdirSync(path.join(dir, "vite", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "vite", "package.json"), '{"name":"vite","version":"8.1.0"}\n');
  fs.writeFileSync(path.join(dir, "vite", "bin", "vite.js"), "// fixture\n");
}

/**
 * Run the REAL node_modules block of a launcher in a throwaway repo. The
 * launchers go on to start servers, so the copy is truncated just before the
 * first-time setup check and reports the state instead. `uname` is stubbed to
 * answer the launcher's platform, and (optionally) `ln` is stubbed to fail only
 * for the symlink capability probe, which exercises the exFAT fallback.
 */
function runFixture(launcher, prepare, { noSymlinks = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `luke-${launcher.id}-deps-`));
  const repo = path.join(tmp, "repo");
  const frontend = path.join(repo, "app", "frontend");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(frontend, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });

  fs.writeFileSync(path.join(bin, "uname"), [
    "#!/usr/bin/env bash",
    `if [[ "\${1:-}" == "-s" ]]; then echo ${launcher.platform}; else exec /usr/bin/uname "$@"; fi`,
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

  const source = readSource(launcher.file);
  const cut = source.indexOf("# ── First-time setup check");
  if (cut < 0) throw new Error(`${launcher.file} no longer has the first-time setup marker`);
  const probe = [
    'echo "FLAG=$FRONTEND_DEPS_INCOMPLETE"',
    'if [[ -L "$FRONTEND_NODE_MODULES" ]]; then echo "LINK=$(readlink "$FRONTEND_NODE_MODULES")"; else echo "LINK=NONE"; fi',
    'if [[ -f "$FRONTEND_NODE_MODULES/vite/package.json" && -f "$FRONTEND_NODE_MODULES/vite/bin/vite.js" ]]; then echo "VITE=yes"; else echo "VITE=no"; fi',
    `if [[ -f "$${launcher.osVar}/vite/package.json" ]]; then echo "OSVITE=yes"; else echo "OSVITE=no"; fi`,
    "",
  ].join("\n");
  const script = path.join(repo, launcher.file);
  fs.writeFileSync(script, source.slice(0, cut) + probe, { mode: 0o755 });

  prepare({ repo, frontend, fakeVite, osFolder: launcher.osFolder });

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
    OSVITE: value("OSVITE"),
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  return observed;
}

async function main() {
  console.log("launcher frontend dependency guard validation");

  for (const launcher of LAUNCHERS) {
    const source = readSource(launcher.file);
    section(`1. ${launcher.file}: the guard is really in the launcher`);
    const syntax = spawnSync("bash", ["-n", path.join(root, launcher.file)], { encoding: "utf8" });
    check(`${launcher.id}: parses (bash -n)`, syntax.status === 0, String(syntax.stderr || ""));
    check(`${launcher.id}: a helper decides whether a folder really has vite`, /has_frontend_deps\(\) \{/.test(source));
    check(`${launcher.id}: checks vite/package.json AND the vite binary`,
      /\$1\/vite\/package\.json/.test(source) && /\$1\/vite\/bin\/vite\.js/.test(source));
    check(`${launcher.id}: the incomplete flag starts unset`, /FRONTEND_DEPS_INCOMPLETE=0/.test(source));
    const guardAt = source.indexOf(`if has_frontend_deps "$${launcher.osVar}"; then`);
    const linkAt = source.indexOf(`ln -sfn "${launcher.osFolder}" "$FRONTEND_NODE_MODULES"`);
    check(`${launcher.id}: target checked BEFORE the symlink is created`,
      guardAt >= 0 && linkAt >= 0 && guardAt < linkAt, `guard@${guardAt} link@${linkAt}`);
    check(`${launcher.id}: the empty mkdir -p + link combination is gone`,
      !source.includes(`mkdir -p "$${launcher.osVar}"`));
    check(`${launcher.id}: an incomplete target flags instead of linking`,
      /FRONTEND_DEPS_INCOMPLETE=1/.test(source) && /refusing to link to an empty folder/.test(source));
    check(`${launcher.id}: symlink created without dereferencing a stale directory link`,
      new RegExp(`ln -sfn "${launcher.osFolder}"`).test(source));
    check(`${launcher.id}: a real node_modules is only migrated when healthier`,
      /if has_frontend_deps "\$FRONTEND_NODE_MODULES" \|\| ! has_frontend_deps "\$/.test(source));
    check(`${launcher.id}: the exFAT fallback is guarded too`,
      /if ! has_frontend_deps "\$FRONTEND_NODE_MODULES"; then/.test(source));

    section(`2. ${launcher.file}: an installed machine stops loudly`);
    const fatal = 'if [[ "$FRONTEND_DEPS_INCOMPLETE" == "1" && -z "$SETUP_REASON" ]]; then';
    check(`${launcher.id}: fatal check only fires when setup will NOT run`, source.includes(fatal));
    const lastReason = launcher.id === "mac"
      ? 'SETUP_REASON="macOS whisper.cpp speech backend is missing."'
      : 'SETUP_REASON="Kokoro text-to-speech runtime is missing."';
    const reasonAt = source.indexOf(lastReason);
    check(`${launcher.id}: it sits AFTER all SETUP_REASON checks`,
      reasonAt >= 0 && reasonAt < source.indexOf(fatal));
    check(`${launcher.id}: exits non-zero rather than printing Running!`,
      /exit 1/.test(source.slice(source.indexOf(fatal))));
    check(`${launcher.id}: says why in plain words`,
      /Frontend dependencies are incomplete: vite was not found/.test(source));
    check(`${launcher.id}: hands over a copy-paste repair`,
      /npm ci/.test(source) && /rm -rf node_modules/.test(source)
      && source.includes(launcher.start));
    check(`${launcher.id}: a fresh checkout still reaches setup.sh`,
      /SETUP_REASON="Frontend build is missing\."/.test(source));
  }

  section("3. setup.sh verifies vite after npm install, before the build");
  const setup = fs.readFileSync(setupSh, "utf8");
  check("setup.sh parses (bash -n)", spawnSync("bash", ["-n", setupSh], { encoding: "utf8" }).status === 0);
  check("setup.sh still installs dependencies into the link it creates",
    /ln -sf "\$OS_LABEL" "\$FRONTEND_NODE_MODULES"/.test(setup)
    && /install --prefer-offline/.test(setup));
  check("a POST-install vite check was added", /FRONTEND_VITE_DIR="\$FRONTEND_DIR\/node_modules\/vite"/.test(setup));
  check("it checks both vite/package.json and vite/bin/vite.js",
    /FRONTEND_VITE_DIR\/package\.json/.test(setup) && /FRONTEND_VITE_DIR\/bin\/vite\.js/.test(setup));
  check("it fails before the Step 4 build",
    setup.indexOf("FRONTEND_VITE_DIR") < setup.indexOf("# ── Step 4: Build frontend"));
  check("it explains ERR_MODULE_NOT_FOUND and the repair",
    /ERR_MODULE_NOT_FOUND/.test(setup) && /npm ci/.test(setup) && /print_fail/.test(setup.slice(setup.indexOf("FRONTEND_VITE_DIR"))));

  // Execute the real verification block with print_ok/print_fail stubs.
  const begin = setup.indexOf("# npm can exit 0 while leaving no usable vite behind");
  const end = setup.indexOf("# ── Step 4: Build frontend");
  const snippet = setup.slice(begin, end);
  function runSetupGuard(withVite) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-setup-guard-"));
    const fe = path.join(tmp, "app", "frontend");
    fs.mkdirSync(fe, { recursive: true });
    if (withVite) fakeVite(path.join(fe, "node_modules"));
    const script = path.join(tmp, "guard.sh");
    fs.writeFileSync(script, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `FRONTEND_DIR="${fe}"`,
      'print_ok()   { echo "   OK   $1"; }',
      'print_fail() { echo "   XX   $1"; }',
      snippet,
      'echo "GUARD_OK=1"',
      "",
    ].join("\n"), { mode: 0o755 });
    const r = spawnSync("bash", [script], { encoding: "utf8" });
    fs.rmSync(tmp, { recursive: true, force: true });
    return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
  }
  const setupHealthy = runSetupGuard(true);
  check("real check passes when vite is present",
    setupHealthy.status === 0 && /GUARD_OK=1/.test(setupHealthy.out)
    && /vite is present/.test(setupHealthy.out), JSON.stringify(setupHealthy));
  const setupBroken = runSetupGuard(false);
  check("real check exits 1 when npm install left no vite",
    setupBroken.status === 1 && !/GUARD_OK=1/.test(setupBroken.out)
    && /ERR_MODULE_NOT_FOUND/.test(setupBroken.out) && /npm ci/.test(setupBroken.out),
    JSON.stringify(setupBroken));

  section("4. Behaviour: 8 states per launcher, both filesystem kinds");
  for (const launcher of LAUNCHERS) {
    const L = launcher.id;
    const healthy = runFixture(launcher, ({ frontend, fakeVite, osFolder }) => {
      fakeVite(path.join(frontend, osFolder));
    });
    check(`${L}: a complete ${launcher.osFolder} is linked and usable`,
      healthy.status === 0 && healthy.FLAG === "0" && healthy.LINK === launcher.osFolder
      && healthy.VITE === "yes" && healthy.OSVITE === "yes", JSON.stringify(healthy));

    const dangling = runFixture(launcher, ({ frontend, osFolder }) => {
      fs.symlinkSync(osFolder, path.join(frontend, "node_modules"));
    });
    check(`${L}: a dangling symlink does NOT become a link to an empty folder`,
      dangling.status === 0 && dangling.FLAG === "1" && dangling.LINK === "NONE"
      && dangling.VITE === "no" && dangling.OSVITE === "no", JSON.stringify(dangling));
    check(`${L}: the refusal is visible in the launcher output`,
      /refusing to link to an empty folder/.test(dangling.out), dangling.out.slice(-200));

    const emptyTarget = runFixture(launcher, ({ frontend, osFolder }) => {
      fs.mkdirSync(path.join(frontend, osFolder), { recursive: true });
    });
    check(`${L}: an existing but empty ${launcher.osFolder} is refused too`,
      emptyTarget.FLAG === "1" && emptyTarget.LINK === "NONE" && emptyTarget.VITE === "no",
      JSON.stringify(emptyTarget));

    const npmInstalled = runFixture(launcher, ({ frontend, fakeVite, osFolder }) => {
      fs.mkdirSync(path.join(frontend, osFolder), { recursive: true });
      fakeVite(path.join(frontend, "node_modules"));
    });
    check(`${L}: npm install's real node_modules with vite is migrated and linked`,
      npmInstalled.FLAG === "0" && npmInstalled.VITE === "yes" && npmInstalled.OSVITE === "yes",
      JSON.stringify(npmInstalled));

    const incompleteReal = runFixture(launcher, ({ frontend, fakeVite, osFolder }) => {
      fakeVite(path.join(frontend, osFolder));
      fs.mkdirSync(path.join(frontend, "node_modules"), { recursive: true });
    });
    check(`${L}: an empty real node_modules does NOT delete the complete OS folder`,
      incompleteReal.FLAG === "0" && incompleteReal.VITE === "yes" && incompleteReal.OSVITE === "yes",
      JSON.stringify(incompleteReal));
    check(`${L}: says which copy it kept`, /is complete/.test(incompleteReal.out));

    const fallbackHealthy = runFixture(launcher, ({ frontend, fakeVite, osFolder }) => {
      fakeVite(path.join(frontend, osFolder));
    }, { noSymlinks: true });
    check(`${L}: exFAT fallback swaps a complete folder in`,
      fallbackHealthy.status === 0 && fallbackHealthy.FLAG === "0"
      && fallbackHealthy.VITE === "yes" && fallbackHealthy.LINK === "NONE",
      JSON.stringify(fallbackHealthy));

    const fallbackEmpty = runFixture(launcher, ({ frontend }) => {
      fs.mkdirSync(path.join(frontend, "node_modules"), { recursive: true });
    }, { noSymlinks: true });
    check(`${L}: exFAT fallback flags an empty folder instead of pretending it is fine`,
      fallbackEmpty.FLAG === "1" && fallbackEmpty.VITE === "no" && fallbackEmpty.LINK === "NONE",
      JSON.stringify(fallbackEmpty));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
