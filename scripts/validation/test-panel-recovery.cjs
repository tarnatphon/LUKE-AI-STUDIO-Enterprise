#!/usr/bin/env node
"use strict";

/**
 * A settings panel that arrives as "Failed to fetch dynamically imported
 * module" is not a broken panel — it is a tab that outlived a rebuild.
 *
 * Vite hashes each panel's filename, and a rebuild replaces those files. A tab
 * opened before the rebuild still asks for the old names, gets a 404, and
 * React.lazy then remembers that rejection for the life of the page: returning
 * Home and opening the tab again keeps failing until a reload. The old message
 * named the URL and nothing else.
 *
 * lib/panel-recovery.mjs recognises that one failure, reloads once per tab, and
 * otherwise says what happened. These checks run it in plain node with a stub
 * sessionStorage and a counted reload, so the guard is measured — a genuinely
 * incomplete build must reload once, not forever.
 *
 * Run: node scripts/validation/test-panel-recovery.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

// Chrome, Firefox, Safari and webpack all word this differently, and the two
// strings the user actually saw are the first two.
const CHROME = new Error("Failed to fetch dynamically imported module: http://localhost:1420/assets/RuntimeDownloadDashboard-C-kQsBX9.js");
const ALSO_CHROME = new Error("Failed to fetch dynamically imported module: http://localhost:1420/assets/TextModelManager-Dv6VyQYh.js");
const FIREFOX = new Error("error loading dynamically imported module: http://localhost:1420/assets/Settings-1.js");
const SAFARI = new Error("Importing a module script failed.");
const WEBPACK_MESSAGE = new Error("Loading chunk 412 failed.");
const WEBPACK_NAME = Object.assign(new Error("something went wrong"), { name: "ChunkLoadError" });
const MIME = new Error("Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".");

const NOT_A_CHUNK = [
  new TypeError("Cannot read properties of undefined (reading 'map')"),
  new Error("Request failed with status 500"),
  new Error("Unexpected token '<'"),
  new Error("Hydration failed because the initial UI does not match"),
];

function storageStub(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    get size() {
      return store.size;
    },
  };
}

(async () => {
  const moduleFile = path.join(root, "app", "frontend", "src", "lib", "panel-recovery.mjs");
  check(fs.existsSync(moduleFile), "the recovery module exists");
  const recovery = await import(pathToFileURL(moduleFile).href);
  const { isChunkLoadError, withChunkRecovery, claimSingleReload, chunkFailureAdvice, RELOAD_FLAG } = recovery;

  console.log("\n  recognising the failure");

  check(isChunkLoadError(CHROME), "the exact message from the report is recognised");
  check(isChunkLoadError(ALSO_CHROME), "and the second panel that failed with it");
  for (const [label, error] of [["Firefox", FIREFOX], ["Safari", SAFARI], ["webpack message", WEBPACK_MESSAGE], ["webpack error name", WEBPACK_NAME], ["MIME refusal", MIME]]) {
    check(isChunkLoadError(error), `${label} wording is recognised too`);
  }
  for (const error of NOT_A_CHUNK) {
    check(!isChunkLoadError(error), `an ordinary failure is not mistaken for one: ${error.message.slice(0, 40)}`);
  }
  check(!isChunkLoadError(null) && !isChunkLoadError(undefined), "nothing at all is not a chunk error");

  console.log("\n  recovering");

  const loaded = { default: () => null };
  const fine = withChunkRecovery(() => Promise.resolve(loaded), { storage: storageStub(), reload: () => { throw new Error("must not reload"); } });
  check((await fine()) === loaded, "a panel that loads is passed through untouched");

  let reloads = 0;
  const storage = storageStub();
  const failing = withChunkRecovery(() => Promise.reject(CHROME), { storage, reload: () => { reloads += 1; } });
  const outcome = await Promise.race([failing().then(() => "resolved", () => "rejected"), new Promise((resolve) => setTimeout(() => resolve("pending"), 150))]);
  check(reloads === 1, "a missing panel triggers exactly one reload", `${reloads} reloads`);
  check(outcome === "pending", "and the promise stays pending while the page reloads, so the error never flashes", outcome);
  check(storage.getItem(RELOAD_FLAG) !== null, "the reload is recorded, so a broken build cannot loop");

  let secondReloads = 0;
  const again = withChunkRecovery(() => Promise.reject(ALSO_CHROME), { storage, reload: () => { secondReloads += 1; } });
  const secondOutcome = await again().then(() => "resolved", (error) => error);
  check(secondReloads === 0, "the second failure in the same tab does not reload again");
  check(secondOutcome === ALSO_CHROME, "it comes back to the boundary instead, so the message can explain", String(secondOutcome));

  let ordinaryReloads = 0;
  const ordinary = withChunkRecovery(() => Promise.reject(NOT_A_CHUNK[0]), { storage: storageStub(), reload: () => { ordinaryReloads += 1; } });
  const ordinaryOutcome = await ordinary().then(() => "resolved", (error) => error);
  check(ordinaryReloads === 0, "a panel that throws is never reloaded away");
  check(ordinaryOutcome === NOT_A_CHUNK[0], "its error reaches the boundary unchanged");

  let brokenStorageReloads = 0;
  const brokenStorage = {
    getItem() {
      throw new Error("access is denied for this document");
    },
    setItem() {
      throw new Error("access is denied for this document");
    },
  };
  const noStorage = withChunkRecovery(() => Promise.reject(CHROME), { storage: brokenStorage, reload: () => { brokenStorageReloads += 1; } });
  const noStorageOutcome = await noStorage().then(() => "resolved", (error) => error);
  check(brokenStorageReloads === 0 && noStorageOutcome === CHROME, "storage that throws is survivable: no reload, the message instead");
  check(!claimSingleReload(null), "no storage means no automatic reload, never a crash");

  const once = storageStub();
  check(claimSingleReload(once) === true, "the first claim in a tab is granted");
  check(claimSingleReload(once) === false, "and the second is refused");

  console.log("\n  what the user is told");

  const advice = chunkFailureAdvice("1.0.0-beta.16 · main@1239c05");
  check(advice.includes("1.0.0-beta.16 · main@1239c05"), "the advice names the build this window is running");
  check(/rebuilt while this window was open/.test(advice), "it says why the file is gone");
  check(/Reload to load the current build/.test(advice), "it gives the one action that fixes it");
  check(/nothing you have entered is lost/.test(advice), "it says the work is not at risk");
  check(/restart LUKE/.test(advice), "and what to do if reloading does not help");
  check(!/undefined/.test(chunkFailureAdvice("")), "an unstamped bundle does not print \"undefined\"");

  console.log("\n  wired to every panel");

  const app = read("app", "frontend", "src", "App.jsx");
  check(app.includes('from "./lib/panel-recovery.mjs"'), "App.jsx imports the recovery module");
  check(app.includes("const lazyPanel = (load) => lazy(withChunkRecovery(load));"), "and defines one wrapper every panel goes through");
  check(!/lazy\(\s*\(\)\s*=>\s*import\(/.test(app), "no panel is imported directly with a bare lazy()");
  check(!/lazy\(workspaceLoaders\[/.test(app) && !/lazy\(workspaceLoaders\./.test(app), "no workspace loader bypasses the wrapper either");
  const panels = (app.match(/lazyPanel\(/g) || []).length;
  check(panels === 13, "all thirteen lazy panels use it", `${panels} panels`);

  const boundary = app.slice(app.indexOf("class SoftWorkspaceBoundary"), app.indexOf("class WorkspaceErrorBoundary"));
  check(boundary.includes("isChunkLoadError(this.state.error)"), "the settings boundary checks the error's kind");
  check(boundary.includes("chunkFailureAdvice(buildLabel())"), "and explains it instead of pasting the URL");
  check(boundary.includes('onClick={() => window.location.reload()}'), "and offers a Reload button");
  check(boundary.includes("A settings panel failed to load."), "while every other failure keeps its old message");

  console.log("\n  the server side of the same story");

  const server = read("scripts", "server", "serve.cjs");
  check(server.includes("Frontend asset missing"), "a missing hashed file 404s loudly rather than answering with index.html");
  check(server.includes("return \"no-cache, must-revalidate\";"), "and index.html is revalidated, so a reload really does fetch the new hashes");
  check(server.includes("public, max-age=31536000, immutable"), "while fingerprinted bundles stay cacheable");

  console.log(`\nPASS: ${checks} checks — a panel from an older build reloads itself once, and says so when it cannot.`);
  process.exit(0);
})().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
