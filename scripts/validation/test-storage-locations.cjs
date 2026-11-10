"use strict";

/**
 * Storage locations — the owner chooses PER FOLDER whether it lives on the
 * internal SSD or an external SSD. This is not a migration guide: nothing is
 * forced, nothing moves while the app runs, and the choice is reversible.
 *
 * Pins:
 *   the registry is shared by the bash launcher and the Node API
 *   the API only writes config (no data moves while serve.cjs is running)
 *   --apply moves data byte-for-byte, creates the symlink, is idempotent
 *   --reset + --apply puts the data back
 *   dangerous targets are refused; an unmounted volume never becomes a
 *     directory on the boot disk
 *   both launchers call --apply before the frontend freshness check
 *
 * Run: node scripts/validation/test-storage-locations.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const script = path.join(root, "scripts", "setup", "storage-layout.sh");
const registry = path.join(root, "scripts", "config", "storage-folders.json");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-storage-locations-"));
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
function section(t) { console.log(`\n${t}`); }

function makeRoot(name) {
  const dir = path.join(temp, name);
  fs.mkdirSync(path.join(dir, "scripts", "config"), { recursive: true });
  fs.mkdirSync(path.join(dir, "app", "llm-models"), { recursive: true });
  fs.mkdirSync(path.join(dir, "app", "runtime-state"), { recursive: true });
  fs.writeFileSync(path.join(dir, "app", "llm-models", "tiny.gguf"), "GGUF-BYTES-42");
  fs.writeFileSync(path.join(dir, "app", "runtime-state", "chat.json"), '{"history":true}');
  fs.copyFileSync(registry, path.join(dir, "scripts", "config", "storage-folders.json"));
  return dir;
}
function envFor(dir, extra = {}) {
  return {
    ...process.env,
    LUKE_STORAGE_ROOT: dir,
    LUKE_STORAGE_LAYOUT_FILE: path.join(dir, "storage-layout.conf"),
    ...extra,
  };
}
function bash(dir, args, extra = {}) {
  return spawnSync("bash", [script, ...args], { encoding: "utf8", env: envFor(dir, extra) });
}
function combined(r) { return `${r.stdout || ""}${r.stderr || ""}`; }

function main() {
  console.log("storage locations validation");

  section("1. One registry, shared by launcher and API");
  const folders = JSON.parse(fs.readFileSync(registry, "utf8"));
  check("the registry has eight managed folders", folders.length === 8, String(folders.length));
  check("ids are unique and slugs",
    new Set(folders.map((f) => f.id)).size === folders.length
    && folders.every((f) => /^[a-z0-9-]+$/.test(f.id)));
  check("every folder declares internal or external as its suggestion",
    folders.every((f) => ["internal", "external"].includes(f.recommended)));
  check("models are suggested external; state and built UI internal",
    folders.filter((f) => f.recommended === "external").length >= 5
    && ["runtime-state", "dist"].every((id) => folders.find((f) => f.id === id)?.recommended === "internal"));
  const idsFromBash = bash(makeRoot("ids"), ["--list"]).stdout.trim().split("\n").slice(1)
    .map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  check("bash parses exactly the same ids as the JSON registry",
    idsFromBash.length === folders.length && folders.every((f) => idsFromBash.includes(f.id)),
    idsFromBash.join(","));

  section("2. The API only records a choice; it never moves data");
  const apiRoot = makeRoot("api");
  process.env.LUKE_STORAGE_ROOT = apiRoot;
  process.env.LUKE_STORAGE_LAYOUT_FILE = path.join(apiRoot, "storage-layout.conf");
  const locations = require(path.join(root, "scripts", "server", "storage-locations.cjs"));
  let entries = locations.list();
  check("without a config every folder is in the checkout",
    entries.length === 8 && entries.every((f) => f.state === "in-checkout" && f.requiresRestart === false));
  const chosen = path.join(temp, "chosen-models");
  const saved = locations.setTarget("llm-models", chosen);
  check("setTarget returns requiresRestart", saved.requiresRestart === true);
  check("setTarget reports pending-restart, not applied",
    locations.list().find((f) => f.id === "llm-models").state === "pending-restart");
  check("the data is still a real directory in the checkout",
    fs.lstatSync(path.join(apiRoot, "app", "llm-models")).isDirectory()
    && fs.readFileSync(path.join(apiRoot, "app", "llm-models", "tiny.gguf"), "utf8") === "GGUF-BYTES-42");
  check("the config file is written with mode 600 and one assignment",
    /^llm-models=/.test(fs.readFileSync(locations.layoutFile(), "utf8").split("\n").find((l) => l.startsWith("llm-models")) || "")
    && (fs.statSync(locations.layoutFile()).mode & 0o777) === 0o600);
  check("a second choice does not duplicate the header",
    locations.setTarget("runtime-state", path.join(temp, "chosen-state"))
    && (fs.readFileSync(locations.layoutFile(), "utf8").match(/machine-local storage choices/g) || []).length === 1);

  const bad = [
    ["/", "a filesystem root"],
    [apiRoot, "the checkout root"],
    [path.join(apiRoot, ".git"), ".git"],
    [path.join(apiRoot, "app", "frontend"), "app/frontend"],
    [path.join(apiRoot, "app", "runtime-state"), "another managed folder"],
    ["relative/path", "a relative path"],
  ];
  for (const [target, label] of bad) {
    check(`the API refuses ${label}`, (() => {
      try { locations.validate(folders, "llm-models", target); return false; }
      catch (e) { return e.statusCode === 400; }
    })());
  }
  check("the API refuses an unknown folder id", (() => {
    try { locations.validate(folders, "not-a-folder", "/tmp/ok"); return false; }
    catch (e) { return e.statusCode === 400; }
  })());
  const aFile = path.join(temp, "a-file");
  fs.writeFileSync(aFile, "x");
  check("the API refuses a file as a target", (() => {
    try { locations.validate(folders, "llm-models", aFile); return false; }
    catch (e) { return e.statusCode === 400; }
  })());
  // The folder picker in Settings goes through this module, and it used to
  // accept the same directory for two folders. That is how a real machine ended
  // up with `runtime-state=` and `dist=` on one path: the bash script refused
  // it, the API did not.
  const pickerRoot = makeRoot("picker");
  process.env.LUKE_STORAGE_ROOT = pickerRoot;
  process.env.LUKE_STORAGE_LAYOUT_FILE = path.join(pickerRoot, "storage-layout.conf");
  const pickerShared = path.join(temp, "picker-shared");
  fs.mkdirSync(pickerShared, { recursive: true });
  locations.setTarget("runtime-state", pickerShared);
  const duplicateRefused = (() => {
    try { locations.setTarget("dist", pickerShared); return null; }
    catch (e) { return e; }
  })();
  check("the folder picker refuses a directory another folder already uses",
    duplicateRefused && duplicateRefused.statusCode === 400, String(duplicateRefused && duplicateRefused.message));
  check("and the refusal names the folder and the directory",
    duplicateRefused && /runtime-state is already configured to use /.test(duplicateRefused.message)
    && duplicateRefused.message.includes(pickerShared), String(duplicateRefused && duplicateRefused.message));
  check("the second choice was not written",
    !locations.readLayout(locations.readFolders()).dist,
    JSON.stringify(locations.readLayout(locations.readFolders())));

  // A config that is already duplicated — hand-edited, or written before this
  // check existed — must not claim it will apply on the next restart.
  fs.writeFileSync(locations.layoutFile(), `runtime-state=${pickerShared}\ndist=${pickerShared}\n`);
  const conflicted = locations.list().filter((f) => f.conflictWith && f.conflictWith.length);
  check("a duplicated config is reported as a conflict, not as pending",
    conflicted.length === 2 && conflicted.every((f) => f.state === "conflict"),
    conflicted.map((f) => `${f.id}:${f.state}`).join(","));
  check("each one names the folder it collides with",
    conflicted.some((f) => f.id === "dist" && f.conflictWith.includes("runtime-state"))
    && conflicted.some((f) => f.id === "runtime-state" && f.conflictWith.includes("dist")));

  process.env.LUKE_STORAGE_ROOT = apiRoot;
  process.env.LUKE_STORAGE_LAYOUT_FILE = path.join(apiRoot, "storage-layout.conf");
  check("resetTarget removes the choice", (() => {
    locations.resetTarget("llm-models");
    return !locations.readLayout(folders)["llm-models"];
  })());

  section("3. Volume classification (internal vs external SSD)");
  delete process.env.LUKE_STORAGE_PLATFORM;
  process.env.LUKE_STORAGE_PLATFORM = "Darwin";
  check("macOS /Volumes/... is external", locations.volumeOf("/Volumes/SSD/LUKE/llm-models").kind === "external");
  check("macOS /Users/... is internal", locations.volumeOf("/Users/me/LUKE/app/dist").kind === "internal");
  process.env.LUKE_STORAGE_PLATFORM = "Linux";
  check("Linux /media/... is external", locations.volumeOf("/media/me/SSD/LUKE/models").kind === "external");
  check("Linux /home/... is internal", locations.volumeOf("/home/me/LUKE/app/dist").kind === "internal");
  check("bash --detect agrees with the API (Darwin)",
    bash(apiRoot, ["--detect", "/Volumes/SSD/LUKE/llm-models"], { LUKE_STORAGE_PLATFORM: "Darwin" }).stdout.trim() === "external");
  check("bash --detect agrees with the API (Linux)",
    bash(apiRoot, ["--detect", "/media/me/SSD/LUKE/models"], { LUKE_STORAGE_PLATFORM: "Linux" }).stdout.trim() === "external");
  delete process.env.LUKE_STORAGE_PLATFORM;

  section("4. --apply moves data byte-for-byte and is idempotent");
  const applyRoot = makeRoot("apply");
  const target = path.join(temp, "target-models");
  const setResult = bash(applyRoot, ["--set", "llm-models", target]);
  check("--set exits 0 and does not move anything yet",
    setResult.status === 0 && fs.lstatSync(path.join(applyRoot, "app", "llm-models")).isDirectory());
  const applied = bash(applyRoot, ["--apply"]);
  check("--apply exits 0 even though it made changes", applied.status === 0);
  check("the logical path is now a symlink to the chosen location",
    fs.lstatSync(path.join(applyRoot, "app", "llm-models")).isSymbolicLink()
    && fs.readlinkSync(path.join(applyRoot, "app", "llm-models")) === target);
  check("the model bytes survived the move",
    fs.readFileSync(path.join(target, "tiny.gguf"), "utf8") === "GGUF-BYTES-42");
  check("API now reports the folder as applied, not pending", (() => {
    process.env.LUKE_STORAGE_ROOT = applyRoot;
    process.env.LUKE_STORAGE_LAYOUT_FILE = path.join(applyRoot, "storage-layout.conf");
    const row = locations.list().find((f) => f.id === "llm-models");
    return row.state === "applied" && row.requiresRestart === false && row.isSymlink === true;
  })());
  const again = bash(applyRoot, ["--apply"]);
  check("a second --apply is quiet (idempotent)", combined(again).trim() === "", combined(again).trim().slice(0, 120));

  section("5. --reset puts the data back");
  const reset = bash(applyRoot, ["--reset", "llm-models"]);
  check("--reset exits 0", reset.status === 0);
  check("--reset alone does not move anything", fs.lstatSync(path.join(applyRoot, "app", "llm-models")).isSymbolicLink());
  const back = bash(applyRoot, ["--apply"]);
  check("--apply after reset exits 0", back.status === 0);
  check("the logical path is a real directory again",
    fs.lstatSync(path.join(applyRoot, "app", "llm-models")).isDirectory());
  check("the bytes came back", fs.readFileSync(path.join(applyRoot, "app", "llm-models", "tiny.gguf"), "utf8") === "GGUF-BYTES-42");

  section("6. Refusals: dangerous targets and unmounted volumes");
  const guardRoot = makeRoot("guard");
  for (const [targetPath, label] of [
    ["/", "a filesystem root"],
    [guardRoot, "the checkout root"],
    [path.join(guardRoot, ".git"), ".git"],
    [path.join(guardRoot, "app", "frontend"), "app/frontend"],
    [path.join(guardRoot, "app", "runtime-state"), "another managed folder"],
    ["relative", "a relative path"],
  ]) {
    const r = bash(guardRoot, ["--set", "llm-models", targetPath]);
    check(`bash refuses ${label}`, r.status !== 0, combined(r).trim().slice(0, 100));
  }
  const missingVolume = "/Volumes/LUKE_DISK_THAT_IS_NOT_MOUNTED/models";
  const missing = bash(guardRoot, ["--set", "llm-models", missingVolume], { LUKE_STORAGE_PLATFORM: "Darwin" });
  check("--set accepts a valid-looking external path", missing.status === 0);
  const skipped = bash(guardRoot, ["--apply"], { LUKE_STORAGE_PLATFORM: "Darwin" });
  check("--apply warns and skips an unmounted volume", /not mounted/.test(combined(skipped)));
  check("and it did NOT create the path on the boot disk", !fs.existsSync(missingVolume));
  check("and the original folder is untouched",
    fs.lstatSync(path.join(guardRoot, "app", "llm-models")).isDirectory()
    && fs.readFileSync(path.join(guardRoot, "app", "llm-models", "tiny.gguf"), "utf8") === "GGUF-BYTES-42");

  section("6b. Two folders cannot share one directory");
  // This is the config that produced two warnings on a real machine:
  //   runtime-state=/Users/…/Local AI
  //   dist=/Users/…/Local AI
  // Only the "target is not empty" check downstream stopped the copy — which
  // reads as a warning rather than the misconfiguration it is, and on an empty
  // folder it would have mixed both datasets into one directory.
  const dupRoot = makeRoot("duplicate");
  const shared = path.join(temp, "shared-folder");
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, "keep.txt"), "someone else's data");
  const first = bash(dupRoot, ["--set", "runtime-state", shared]);
  check("the first folder may point there", first.status === 0, combined(first).slice(0, 100));
  const second = bash(dupRoot, ["--set", "dist", shared]);
  check("the second folder pointing at the same directory is refused",
    second.status !== 0 && /already configured to use/.test(combined(second)), combined(second).slice(0, 140));
  check("and the refusal names the folder it collides with", /runtime-state/.test(combined(second)));
  check("nothing in the shared directory was touched", fs.readdirSync(shared).join(",") === "keep.txt", fs.readdirSync(shared).join(","));
  check("and the config still holds only the first choice",
    fs.readFileSync(path.join(dupRoot, "storage-layout.conf"), "utf8").trim().split("\n").filter((line) => /=/.test(line)).length === 1,
    fs.readFileSync(path.join(dupRoot, "storage-layout.conf"), "utf8"));

  // The same shape written by hand, which is how it reached a real machine.
  const handRoot = makeRoot("handwritten");
  fs.writeFileSync(
    path.join(handRoot, "storage-layout.conf"),
    `runtime-state=${shared}\ndist=${shared}\n`,
  );
  const handApplied = bash(handRoot, ["--apply"]);
  const handText = combined(handApplied);
  const quotedShared = shared.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // One mistake gets one report. Before this, a launch printed four lines: an
  // ERROR naming the *other* folder, then a WARNING calling an ordinary
  // directory "unsafe" — so the same path was both the error and the excuse.
  check("a hand-written config with one shared target is reported once, not once per folder",
    (handText.match(/pointing at/g) || []).length === 1, handText.slice(0, 200));
  check("the report names both folders and the directory",
    /(runtime-state and dist|dist and runtime-state) are both pointing at /.test(handText), handText);
  check("it says nothing was moved", /nothing was moved/.test(handText), handText);
  check("it gives the repair for one folder, copy-pasteable",
    handText.includes("bash scripts/setup/storage-layout.sh --reset dist"), handText);
  check("and the alternative of giving it its own folder under that path",
    new RegExp(`--set dist \"${quotedShared}/dist\"`).test(handText), handText);
  check("it no longer calls an ordinary directory 'unsafe'", !/unsafe/.test(handText), handText);
  check("a storage problem still cannot stop the launch", handApplied.status === 0, `exit ${handApplied.status}`);
  check("and neither folder was replaced by a symlink",
    fs.lstatSync(path.join(handRoot, "app", "runtime-state")).isDirectory()
    && !fs.existsSync(path.join(handRoot, "app", "dist", "index.html")));

  const handListed = bash(handRoot, ["--list"]);
  check("--list names the same problem, so it can be found without launching",
    /both pointing at/.test(combined(handListed)), combined(handListed).slice(0, 160));

  // And it must stay quiet when the configuration is sane: a warning that
  // appears on every launch is a warning nobody reads.
  const cleanRoot = makeRoot("clean");
  fs.writeFileSync(path.join(cleanRoot, "storage-layout.conf"), `runtime-state=${path.join(temp, "clean-state")}\n`);
  check("a sane configuration says nothing at all about sharing",
    !/pointing at/.test(combined(bash(cleanRoot, ["--apply"]))));

  section("7. Wiring: launchers, routes, UI, machine-local config");
  for (const name of ["mac.sh", "linux.sh"]) {
    const launcher = fs.readFileSync(path.join(root, name), "utf8");
    const applyAt = launcher.indexOf("storage-layout.sh\" --apply");
    const buildAt = launcher.indexOf("check-frontend-build.sh");
    check(`${name} calls --apply before the frontend freshness check`,
      applyAt > 0 && buildAt > applyAt);
    check(`${name} treats a storage problem as non-fatal`, /--apply \|\| true/.test(launcher));
  }
  const serve = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
  check("serve.cjs requires the module", /require\("\.\/storage-locations\.cjs"\)/.test(serve));
  check("both storage-location routes are declared",
    (serve.match(/req\.url === "\/api\/storage\/locations"/g) || []).length === 2);
  const settings = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "Settings.jsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "StorageLocationsPanel.jsx"), "utf8");
  check("Settings mounts the panel in its own section",
    /StorageLocationsPanel/.test(settings) && /settings_section_storage/.test(settings));
  check("the panel reuses the existing native folder picker",
    /\/api\/storage\/choose-folder/.test(panel) && /\/api\/storage\/locations/.test(panel));
  check("the panel explains that a restart applies the choice",
    /Restart LUKE|Pending restart/.test(panel));
  check("storage-layout.conf is gitignored (machine-local)",
    /^storage-layout\.conf$/m.test(fs.readFileSync(path.join(root, ".gitignore"), "utf8")));
  check("an example config is shipped", fs.existsSync(path.join(root, "storage-layout.conf.example")));

}

try {
  main();
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
