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
