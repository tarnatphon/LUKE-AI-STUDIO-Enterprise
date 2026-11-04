"use strict";

/**
 * Follow-ups from the Settings page audit (user picked "เชื่อมฟังก์ชันกลับ +
 * เชื่อม UI ให้ครบ 11 routes").
 *
 * Four things were left behind in the report:
 *   1. "Volume" vs "Suggested" headers were ambiguous (current vs suggestion).
 *   2. handleBenchmarkTextBackend / handleThinkingToggle / CollapsibleCard /
 *      HardwareTierBadge were defined but never used — two of them are real
 *      missing features (benchmark button and DeepThink switch).
 *   3. Two hard-coded `count={8}` badges.
 *   4. Eleven /api/storage/* routes had no frontend caller at all.
 *
 * This suite proves the fixes statically, recomputes the route gap from the
 * real server + real frontend (must be zero), and renders both the Settings
 * workspace and the new administration panel through Vite SSR — the same
 * technique that reproduced "ae.map is not a function" without a browser.
 *
 * Run: node scripts/validation/test-settings-audit-followups.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));
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
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function hasText(markup, text) { return markup.includes(text.replace(/&/g, "&amp;")); }

const settings = read("app/frontend/src/components/Settings.jsx");
const locations = read("app/frontend/src/components/StorageLocationsPanel.jsx");
const online = read("app/frontend/src/components/OnlineSurfacesPanel.jsx");
const admin = read("app/frontend/src/components/StorageAdminPanel.jsx");
const appCss = read("app/frontend/src/App.css");
const settingsCss = read("app/frontend/src/components/Settings.css");
const serve = read("scripts/server/serve.cjs");

/** All /api/storage/* routes declared by the server. */
function serverRoutes() {
  return new Set([...serve.matchAll(/req\.url === "(\/api\/storage\/[^"]+)"/g)].map((m) => m[1]));
}
/** All /api/storage/* literal URLs used by any frontend module. */
function frontendRoutes() {
  const out = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(/"(\/api\/storage\/[^"]+)"/g)) out.add(m[1]);
      }
    }
  };
  walk(path.join(frontend, "src"));
  return out;
}

const EXPECTED_GAPS = [
  "/api/storage/credentials/delete",
  "/api/storage/credentials/status",
  "/api/storage/health/select",
  "/api/storage/lifecycle/protect",
  "/api/storage/lifecycle/unprotect",
  "/api/storage/providers/select",
  "/api/storage/recovery-certification",
  "/api/storage/recovery-certification/run",
  "/api/storage/resolve",
  "/api/storage/status",
  "/api/storage/watcher/interval",
];

section("A. Table headers say which volume is which");
check("current volume is labelled explicitly", locations.includes(">Current volume</th>"));
check("suggested volume is labelled explicitly", locations.includes(">Suggested volume</th>"));
check("ambiguous bare Volume/Suggested headers are gone",
  !/>Volume<\/th>/.test(locations) && !/>Suggested<\/th>/.test(locations));
check("both headers carry an explanatory tooltip",
  /title="The disk this folder is on right now"/.test(locations)
  && /title="Where LUKE suggests keeping this folder"/.test(locations));

section("B. Section counts come from real data");
check("no hard-coded count={8} remains in Settings.jsx", !/count=\{8\}/.test(settings));
check("online surfaces count comes from the exported switch list",
  /count=\{ONLINE_SURFACE_SWITCH_COUNT\}/.test(settings)
  && /export const ONLINE_SURFACE_SWITCH_COUNT = SWITCHES\.length/.test(online));
check("storage locations count is driven by the API response",
  /count=\{storageFolderCount\}/.test(settings)
  && /onFoldersChange=\{setStorageFolderCount\}/.test(settings)
  && /onFoldersChangeRef\.current\?\.\(/.test(locations)
  && /Array\.isArray\(body\.folders\)/.test(locations));
check("storage administration count comes from its action list",
  /count=\{STORAGE_ADMIN_ACTIONS\.length\}/.test(settings));

section("C. Missing features are wired back, dead code is gone");
check("Benchmark handler is called by a real button",
  (settings.match(/handleBenchmarkTextBackend/g) || []).length >= 2
  && /onClick=\{\(\) => void handleBenchmarkTextBackend\(\)\}/.test(settings)
  && /Benchmark text backends/.test(settings));
check("DeepThink toggle calls the thinking handler",
  (settings.match(/handleThinkingToggle/g) || []).length >= 2
  && /onChange=\{\(enabled\) => void handleThinkingToggle\(enabled\)\}/.test(settings)
  && /DeepThink \(reasoning mode\)/.test(settings));
check("HardwareTierBadge is rendered with specs",
  (settings.match(/HardwareTierBadge/g) || []).length >= 2
  && /<HardwareTierBadge specs=\{specs\} \/>/.test(settings)
  && /\.hardware-tier-badge/.test(settingsCss));
check("superseded CollapsibleCard component is deleted",
  !/CollapsibleCard/.test(settings));
check("CollapsibleCard CSS is deleted from both stylesheets",
  !/collapsible/i.test(settingsCss) && !/collapsible/i.test(appCss));
check("the still-used settings section CSS survived",
  /\.settings-section-header/.test(appCss) && /\.m3-btn-outlined/.test(appCss));
check("new section is expanded on first visit, then remembered",
  /settings_section_storageAdmin"\) === null\s*\?\s*true/.test(settings)
  && /toggleSection\("storageAdmin"\)/.test(settings));

section("D. Every storage route now has a UI caller");
const gaps = [...serverRoutes()].filter((route) => !frontendRoutes().has(route)).sort();
check("recomputed route gap is empty", gaps.length === 0, gaps.join(", "));
check("the audit originally had exactly 11 gaps", EXPECTED_GAPS.length === 11);
const actionRoutes = [...admin.matchAll(/route: "(\/api\/storage\/[^"]+)"/g)].map((m) => m[1]);
check("the admin panel declares all 11 previously-orphaned routes",
  EXPECTED_GAPS.every((route) => actionRoutes.includes(route))
  && actionRoutes.length === EXPECTED_GAPS.length,
  actionRoutes.join(", "));
check("GET/POST methods match the server",
  EXPECTED_GAPS.every((route) => {
    const block = admin.slice(admin.indexOf(`route: "${route}"`), admin.indexOf(`route: "${route}"`) + 260);
    const declared = (block.match(/method: "(GET|POST)"/) || [])[1];
    const serverBlock = serve.slice(serve.indexOf(`req.url === "${route}"`), serve.indexOf(`req.url === "${route}"`) + 400);
    const expected = (serverBlock.match(/req\.method === "(GET|POST)"/) || [])[1];
    return declared && declared === expected;
  }));
check("the action payloads use the server's field names",
  ["capability", "path", "credentialReference", "providerId", "intervalMs"]
    .every((field) => admin.includes(`key: "${field}"`)));
check("every action has a unique, testable button",
  EXPECTED_GAPS.length === 11
  && (admin.match(/id: "[a-z-]+"/g) || []).length >= 11
  && /data-testid=\{`storage-admin-\$\{action\.id\}`\}/.test(admin));
check("read-only GETs load on mount; mutations need a click",
  /filter\(\(a\) => a\.method === "GET"\)/.test(admin)
  && /onClick=\{\(\) => void call\(action\)\}/.test(admin));

async function main() {
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "settings-audit-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { default as Settings } from ${JSON.stringify(path.join(frontend, "src", "components", "Settings.jsx"))};`,
    `export { default as StorageAdminPanel, STORAGE_ADMIN_ACTIONS } from ${JSON.stringify(path.join(frontend, "src", "components", "StorageAdminPanel.jsx"))};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));
  await vite.build({
    root: frontend, configFile: false, logLevel: "silent", plugins: [react()],
    build: {
      ssr: entryFile, outDir: path.join(work, "out"), emptyOutDir: true, minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "settings-audit.cjs" } },
    },
    ssr: { noExternal: true }, define: { "process.env.NODE_ENV": '"production"' },
  });

  globalThis.localStorage = {
    getItem: (key) => (["settings_section_text", "settings_section_storage",
      "settings_section_storageAdmin", "settings_section_appearance"].includes(key) ? "true" : null),
    setItem() {},
  };
  globalThis.window = { matchMedia: () => ({ matches: true }), alert() {}, confirm() {}, location: { origin: "" } };
  globalThis.document = {
    visibilityState: "visible", addEventListener() {}, removeEventListener() {},
    documentElement: { setAttribute() {} },
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

  const built = require(path.join(work, "out", "settings-audit.cjs"));
  try {
    section("E. Real renders (Vite SSR, no browser)");
    let adminMarkup = "";
    let adminError = "";
    try {
      adminMarkup = built.renderToStaticMarkup(built.createElement(built.StorageAdminPanel));
    } catch (error) { adminError = error?.message || String(error); }
    check("Storage administration panel renders without throwing", !adminError, adminError);
    check("one button per orphaned route is present",
      (adminMarkup.match(/data-testid="storage-admin-/g) || []).length === 11);
    check("every action label is visible",
      built.STORAGE_ADMIN_ACTIONS.every((a) => hasText(adminMarkup, a.label)));
    check("every route is shown next to its button",
      built.STORAGE_ADMIN_ACTIONS.every((a) => adminMarkup.includes(a.route)));

    const props = {
      constraints: { width: 512, height: 512, backendType: "cpu" }, setConstraints() {},
      activeModel: null,
      specs: { tier: "high", cpu_name: "Apple M3 Pro", cpu_cores_physical: 5,
        ram_total_gb: 18, gpu_vram_gb: 0, recommended_text_settings: { contextSize: 4096 } },
      backendOptions: { options: [], unavailable: [] }, setBackendOptions() {},
      serverRunning: false, setServerRunning() {}, setActiveModel() {},
      textSettings: {}, setTextSettings() {}, speechSettings: {}, setSpeechSettings() {},
      ttsSettings: {}, setTtsSettings() {}, health: {}, cleanupItems: [], isReadinessBusy: false,
      refreshReadiness() {}, copyDiagnostics() {}, cleanupSafeItems() {}, diagnosticsCopied: false,
      theme: "dark", setTheme() {}, fontSize: 16, setFontSize() {},
    };
    let markup = "";
    let renderError = "";
    try {
      markup = built.renderToStaticMarkup(built.createElement(built.Settings, { ...props, showHeader: false }));
    } catch (error) { renderError = error?.message || String(error); }
    check("the whole Settings workspace still renders", !renderError, renderError);
    check("Benchmark button is really in the markup", hasText(markup, "Benchmark text backends"));
    check("DeepThink switch is really in the markup", hasText(markup, "DeepThink (reasoning mode)"));
    check("hardware tier badge is really in the markup", markup.includes("hardware-tier-badge"));
    check("Storage administration section is really in the markup",
      hasText(markup, "Storage administration"));
    check("Storage locations section is still there", hasText(markup, "Storage locations"));
    check("the tab render does not duplicate the page heading",
      !hasText(markup, "Settings & Parameters"));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed · ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
