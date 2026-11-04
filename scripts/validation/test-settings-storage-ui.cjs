"use strict";

/**
 * Settings page really renders the latest work — regression for the report
 * "หน้า Setting ไม่เปลี่ยน + ดูผิดปกติ เส้นหายบาง".
 *
 * Three independent causes were found, all reproducible in this checkout:
 *
 *   1. Settings.jsx / OnlineSurfacesPanel.jsx used `m3-button-filled` and
 *      `m3-button-outlined`, but the stylesheet defines `m3-btn-filled` and
 *      `m3-btn-outlined`. 14 buttons had no styling at all; the outlined
 *      variant is exactly where the missing `border: 1px solid` (the "เส้น")
 *      lives. The new Storage locations panel added a third invented class.
 *   2. A missing hashed asset fell through to index.html while keeping the
 *      .js/.css MIME type. The browser parsed HTML as JavaScript and the SPA
 *      failed to boot — which makes every screen look broken at once.
 *   3. /api/health re-reads the checkout commit every 15s but never said which
 *      commit the RUNNING process booted on. After `git pull` without a
 *      restart, the bundle is new, the API is old, and health looks perfect.
 *
 * Run: node scripts/validation/test-settings-storage-ui.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
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
function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function definedCssClasses() {
  const out = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) {
        for (const match of fs.readFileSync(full, "utf8").matchAll(/\.([A-Za-z0-9_-]+)/g)) out.add(match[1]);
      }
    }
  };
  walk(path.join(root, "app", "frontend", "src"));
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

/** A throwaway checkout, like test-api-route-methods.cjs: no runtime-state,
 *  real app/dist, real server dependencies. Nothing here touches the user's
 *  own app/ folder. */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-settings-ui-"));
  const destination = path.join(temp, "repo");
  fs.mkdirSync(path.join(destination, "scripts", "server"), { recursive: true });
  fs.mkdirSync(path.join(destination, "app"), { recursive: true });
  const sources = spawnSync("find", ["scripts", "-type", "f", "-not", "-path", "*/node_modules/*"], {
    cwd: root, encoding: "utf8",
  }).stdout.split("\n").filter(Boolean);
  for (const file of sources) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const deps = path.join(root, "scripts", "server", "node_modules");
  if (fs.existsSync(deps)) fs.symlinkSync(deps, path.join(destination, "scripts", "server", "node_modules"), "dir");
  for (const folder of ["config", "dist"]) {
    const source = path.join(root, "app", folder);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(destination, "app", folder), { recursive: true });
  }
  return { temp, destination };
}

async function main() {
  console.log("settings page / storage UI regression");

  section("1. Every button class in Settings actually exists in the CSS");
  const defined = definedCssClasses();
  const panels = [
    "app/frontend/src/components/Settings.jsx",
    "app/frontend/src/components/OnlineSurfacesPanel.jsx",
    "app/frontend/src/components/StorageLocationsPanel.jsx",
  ];
  const allPanelText = panels.map(read).join("\n");
  check("no invented m3-button-* class survives", !/m3-button-(filled|outlined)/.test(allPanelText));
  check("no invented settings-small-button survives", !/settings-small-button/.test(allPanelText));
  const buttonClasses = [...new Set(
    [...allPanelText.matchAll(/(?:^|["\s])((?:m3-[a-z0-9-]+)|settings-small-button)(?=["\s])/g)].map((m) => m[1])
  )];
  const missing = buttonClasses.filter((c) => !defined.has(c));
  check("all button classes used by the three panels are defined in CSS",
    buttonClasses.length > 0 && missing.length === 0,
    `missing: ${missing.join(", ")} | used: ${buttonClasses.join(", ")}`);
  const appCss = read("app/frontend/src/App.css");
  check("the outlined button really carries the missing border (เส้น)",
    /\.m3-btn-outlined\s*\{[^}]*border:\s*1px solid/.test(appCss));
  check("the new section is expanded on first visit, then remembers the owner's choice",
    /settings_section_storage"\) === null\s*\?\s*true/.test(read(panels[0])));

  section("2. The new Settings section and its API are wired");
  const settings = read(panels[0]);
  const panel = read(panels[2]);
  const serve = read("scripts/server/serve.cjs");
  check("Settings mounts StorageLocationsPanel in a section of its own",
    /<StorageLocationsPanel/.test(settings) && /title="Storage locations"/.test(settings));
  check("the panel reuses the existing native folder picker",
    /\/api\/storage\/choose-folder/.test(panel) && /\/api\/storage\/locations/.test(panel));
  check("a 404 is explained as an old server that needs a restart",
    /response\.status === 404/.test(panel) && /\/mac\.sh/.test(panel));
  check("health publishes the commit this process booted on",
    /const PROCESS_SOURCE = readSourceInfo\(ROOT\)/.test(serve)
    && /process:\s*\{/.test(serve) && /restartRequired/.test(serve));

  section("3. A missing asset must 404, not index.html with a JS MIME type");
  check("the static handler distinguishes assets from SPA routes",
    /const isStaticAsset =/.test(serve) && /return missingAsset\(\)/.test(serve));
  const distIndex = path.join(root, "app", "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    check("app/dist/index.html exists (build the frontend first)", false);
    return;
  }
  const builtBundles = fs.readdirSync(path.join(root, "app", "dist", "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(root, "app", "dist", "assets", f), "utf8"))
    .join("\n");
  check("the built bundle actually contains the Storage locations panel",
    builtBundles.includes("Storage locations") && builtBundles.includes("/api/storage/locations"));
  check("and it no longer contains the dead m3-button-* classes",
    !/m3-button-(?:filled|outlined)/.test(builtBundles));
  const { temp, destination } = buildTempRoot();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(destination, "scripts", "server", "serve.cjs")], {
    cwd: destination,
    env: {
      ...process.env,
      NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
      LUKE_AI_HOST: "127.0.0.1", LUKE_AI_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (c) => { serverLog += c.toString("utf8"); });
  child.stderr.on("data", (c) => { serverLog += c.toString("utf8"); });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try { await fetch(`${base}/api/health`); ready = true; break; }
      catch { await delay(150); }
    }
    check("the throwaway server boots", ready, serverLog.slice(-200));
    if (!ready) return;

    const missingAsset = await fetch(`${base}/assets/luke-deliberately-missing-404.js`);
    const missingBody = await missingAsset.text();
    check("a missing /assets/*.js answers 404", missingAsset.status === 404, String(missingAsset.status));
    check("and the body is a readable message, NOT index.html",
      !/<!doctype|<html/i.test(missingBody) && /Frontend asset missing/.test(missingBody));
    check("and it is not sent with a JavaScript MIME type",
      !/javascript/.test(missingAsset.headers.get("content-type") || ""),
      missingAsset.headers.get("content-type") || "");

    const spa = await fetch(`${base}/some/spa/route/that/does/not/exist`);
    const spaBody = await spa.text();
    check("an extensionless SPA route still falls back to index.html",
      spa.status === 200 && /<html/i.test(spaBody));

    const html = fs.readFileSync(path.join(destination, "app", "dist", "index.html"), "utf8");
    const asset = (html.match(/src="\/(assets\/[^"]+\.js)"/) || [])[1];
    if (asset) {
      const real = await fetch(`${base}/${asset}`);
      check("a real hashed bundle still serves as JavaScript",
        real.status === 200 && /javascript/.test(real.headers.get("content-type") || ""));
    } else {
      check("index.html references a hashed JS bundle", false);
    }

    const locations = await fetch(`${base}/api/storage/locations`);
    const payload = await locations.json();
    check("the running server answers /api/storage/locations with all 8 folders",
      locations.status === 200 && payload.ok === true && payload.folders?.length === 8,
      `${locations.status} ${payload.folders?.length}`);

    const health = await (await fetch(`${base}/api/health`)).json();
    check("health exposes process.restartRequired and a top-level flag",
      typeof health.process?.restartRequired === "boolean"
      && typeof health.restartRequired === "boolean");
    check("health still reports checkout, bundle and stale as before",
      "source" in health && "frontend" in health && typeof health.frontend?.stale === "boolean");
  } finally {
    child.kill("SIGKILL");
    await delay(150);
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

}

main()
  .catch((error) => {
    failed += 1;
    console.error(error);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
