"use strict";

/**
 * Theme catalog regression — "Workspace could not be loaded. ae.map is not a
 * function" on the Settings tab (Mac, 2026-11-04, bundle main@f3a7153).
 *
 * `app/frontend/src/themes.js` exports THEMES as a keyed OBJECT, but both
 * Settings.jsx (Appearance & Themes cards) and TopStatusBar.jsx (theme
 * dropdown) called `THEMES.map(...)`. As soon as either section opened, React
 * threw and the whole Settings workspace fell into WorkspaceErrorBoundary.
 * The render also expected fields (`bg`, `primary`, `secondary`, `type`) that
 * the catalogue never had, and its ids (`midnightGlass`, ...) had no matching
 * `html[data-theme="..."]` block in App.css, so a chosen theme changed nothing.
 *
 * This suite renders BOTH real components through Vite SSR (no browser, no
 * network) and proves the theme cards/dropdown render, that every id is styled
 * by CSS, and that legacy ids saved in localStorage still resolve.
 *
 * Run: node scripts/validation/test-theme-catalog.cjs
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
/** renderToStaticMarkup escapes "&" as "&amp;". */
function hasText(markup, text) { return markup.includes(text.replace(/&/g, "&amp;")); }

const css = fs.readFileSync(path.join(frontend, "src", "App.css"), "utf8");
const themesSource = fs.readFileSync(path.join(frontend, "src", "themes.js"), "utf8");
const settingsSource = fs.readFileSync(path.join(frontend, "src", "components", "Settings.jsx"), "utf8");
const statusSource = fs.readFileSync(path.join(frontend, "src", "components", "TopStatusBar.jsx"), "utf8");
const appSource = fs.readFileSync(path.join(frontend, "src", "App.jsx"), "utf8");

/** Read a CSS custom property out of a theme block (or :root for "light"). */
function cssVariable(themeId, name) {
  let block = "";
  if (themeId === "light") {
    const start = css.indexOf(":root {");
    block = css.slice(start, css.indexOf("}", start));
  } else {
    const marker = `html[data-theme="${themeId}"] {`;
    const start = css.indexOf(marker);
    if (start < 0) return "";
    block = css.slice(start, css.indexOf("}", start));
  }
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : "";
}

async function main() {
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "theme-catalog-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { default as Settings } from ${JSON.stringify(path.join(frontend, "src", "components", "Settings.jsx"))};`,
    `export { default as TopStatusBar } from ${JSON.stringify(path.join(frontend, "src", "components", "TopStatusBar.jsx"))};`,
    `export { THEMES, THEME_LIST, THEME_IDS, DEFAULT_THEME, canonicalThemeId } from ${JSON.stringify(path.join(frontend, "src", "themes.js"))};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));

  await vite.build({
    root: frontend, configFile: false, logLevel: "silent", plugins: [react()],
    build: {
      ssr: entryFile, outDir: path.join(work, "out"), emptyOutDir: true, minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "theme-catalog.cjs" } },
    },
    ssr: { noExternal: true }, define: { "process.env.NODE_ENV": '"production"' },
  });

  // The real components read localStorage in useState initialisers and register
  // document listeners in effects (effects do not run during SSR).
  globalThis.localStorage = {
    getItem: (key) => (key === "settings_section_appearance" ? "true" : null),
    setItem() {},
  };
  globalThis.window = { matchMedia: () => ({ matches: true }), alert() {}, confirm() {}, location: { origin: "" } };
  globalThis.document = {
    visibilityState: "visible", addEventListener() {}, removeEventListener() {},
    documentElement: { setAttribute() {} },
  };
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

  const built = require(path.join(work, "out", "theme-catalog.cjs"));
  const { THEMES, THEME_LIST, THEME_IDS, DEFAULT_THEME, canonicalThemeId } = built;

  try {
    section("A. The catalogue shape");
    check("THEMES is a keyed object, never an array",
      !Array.isArray(THEMES) && typeof THEMES === "object" && Object.keys(THEMES).length === 3);
    check("THEME_LIST is a real array", Array.isArray(THEME_LIST));
    check("THEME_LIST has at least the seven styled themes",
      THEME_LIST.length >= 7, `length=${THEME_LIST.length}`);
    check("every theme id is unique", new Set(THEME_IDS).size === THEME_IDS.length);
    check("every descriptor has the fields the UI renders",
      THEME_LIST.every((t) => t.id && t.name && t.bg && t.primary && t.secondary
        && (t.type === "dark" || t.type === "light")));
    check("DEFAULT_THEME is one of the renderable ids", THEME_IDS.includes(DEFAULT_THEME));
    check("source documents why THEMES must not be mapped",
      /NOT an array/i.test(themesSource) && /THEME_LIST/.test(themesSource));
    check("no component calls THEMES.map any more",
      !/\bTHEMES\.map\s*\(/.test(settingsSource) && !/\bTHEMES\.map\s*\(/.test(statusSource));
    check("both components render from THEME_LIST",
      /THEME_LIST\.map/.test(settingsSource) && /THEME_LIST\.map/.test(statusSource));

    section("B. Ids and swatches actually exist in App.css");
    for (const theme of THEME_LIST) {
      const styled = theme.id === "light" || css.includes(`html[data-theme="${theme.id}"]`);
      check(`id "${theme.id}" has a CSS theme block`, styled);
      check(`swatch colours for "${theme.id}" match its CSS variables`,
        theme.bg === cssVariable(theme.id, "md-sys-color-background")
        && theme.primary === cssVariable(theme.id, "md-sys-color-primary")
        && theme.secondary === cssVariable(theme.id, "md-sys-color-secondary"),
        `${theme.bg}/${theme.primary}/${theme.secondary}`);
    }

    section("C. Legacy localStorage ids still resolve");
    for (const [legacy, expected] of Object.entries({
      midnightGlass: "dark", cyberStudio: "dark-cyberpunk", studioMinimal: "dark-oled",
    })) {
      check(`${legacy} -> ${expected}`, canonicalThemeId(legacy) === expected);
    }
    check("known ids pass through unchanged",
      THEME_IDS.every((id) => canonicalThemeId(id) === id));
    check("unknown / missing ids fall back to DEFAULT_THEME",
      canonicalThemeId("not-a-theme") === DEFAULT_THEME && canonicalThemeId(undefined) === DEFAULT_THEME);
    check("App.jsx applies the canonical id to <html>",
      /setAttribute\("data-theme", canonicalThemeId\(theme\)\)/.test(appSource)
      && /import \{ canonicalThemeId \} from "\.\/themes"/.test(appSource));

    section("D. The Settings workspace renders (the reported crash)");
    const settingsProps = {
      constraints: { width: 512, height: 512, backendType: "cpu" }, setConstraints() {},
      activeModel: null, specs: {}, backendOptions: { options: [], unavailable: [] },
      setBackendOptions() {}, serverRunning: false, setServerRunning() {}, setActiveModel() {},
      textSettings: {}, setTextSettings() {}, speechSettings: {}, setSpeechSettings() {},
      ttsSettings: {}, setTtsSettings() {}, health: {}, cleanupItems: [], isReadinessBusy: false,
      refreshReadiness() {}, copyDiagnostics() {}, cleanupSafeItems() {}, diagnosticsCopied: false,
      theme: "midnightGlass", setTheme() {}, fontSize: 16, setFontSize() {},
    };
    let settingsMarkup = "";
    let settingsError = "";
    try {
      settingsMarkup = built.renderToStaticMarkup(built.createElement(built.Settings, settingsProps));
    } catch (error) {
      settingsError = error?.message || String(error);
    }
    check("Settings renders without throwing", !settingsError, settingsError);
    check("standalone Settings keeps its own heading and sections",
      hasText(settingsMarkup, "Settings & Parameters")
      && hasText(settingsMarkup, "Appearance & Themes"));
    let tabMarkup = "";
    try {
      tabMarkup = built.renderToStaticMarkup(built.createElement(built.Settings, {
        ...settingsProps, showHeader: false,
      }));
    } catch (error) {
      tabMarkup = "";
    }
    check("the Settings tab suppresses the duplicate heading",
      tabMarkup.length > 0 && !hasText(tabMarkup, "Settings & Parameters")
      && (tabMarkup.match(/theme-card-btn/g) || []).length === THEME_LIST.length);
    check("one theme card per catalogue entry",
      (settingsMarkup.match(/theme-card-btn/g) || []).length === THEME_LIST.length);
    check("every theme name is visible",
      THEME_LIST.every((t) => settingsMarkup.includes(t.name)));
    check("appearance section count is the real catalogue length",
      /count=\{THEME_LIST\.length\}/.test(settingsSource));

    section("E. The header theme dropdown renders too");
    const statusProps = {
      telemetry: {}, serverRunning: false, activeModel: null, isLlmLoaded: false,
      onStopServer() {}, isStoppingServer: false, theme: "dark", setTheme() {},
      sidebarVisible: true, onToggleSidebar() {},
    };
    let dropdownMarkup = "";
    let dropdownError = "";
    try {
      dropdownMarkup = built.renderToStaticMarkup(built.createElement(built.TopStatusBar, {
        ...statusProps, initialThemeMenuOpen: true,
      }));
    } catch (error) {
      dropdownError = error?.message || String(error);
    }
    check("open theme dropdown renders without throwing", !dropdownError, dropdownError);
    check("one dropdown item per catalogue entry",
      (dropdownMarkup.match(/theme-dropdown-item/g) || []).length === THEME_LIST.length);
    check("every theme name is visible in the dropdown",
      THEME_LIST.every((t) => dropdownMarkup.includes(t.name)));
    const closedMarkup = built.renderToStaticMarkup(built.createElement(built.TopStatusBar, statusProps));
    check("dropdown stays closed by default (UX unchanged)",
      !closedMarkup.includes("theme-dropdown-item"));
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
