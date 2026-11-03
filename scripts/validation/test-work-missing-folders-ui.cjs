"use strict";

/**
 * "Forget missing folders" must be visible where the user can act on it.
 *
 * The server already names failed restores in the console. That was not
 * enough: on a Mac the owner had to copy a path out of a terminal and go
 * hunting in Edit project. This suite renders the real strip through Vite's
 * SSR build (no browser, no network) and proves it shows every path, every
 * reason, and exactly one button — and that it is gone when nothing failed.
 *
 * Run: node scripts/validation/test-work-missing-folders-ui.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

const ENTRIES = [
  { root: "/Users/ekky/Desktop/Super AI Trader", error: "The selected Work folder is no longer available." },
  { root: "/Volumes/AI/old-project", error: "Work folder access requires an absolute selected folder." },
];

let passed = 0;

function check(name, condition) {
  let ok = false;
  let detail = "";
  try {
    ok = typeof condition === "function" ? Boolean(condition()) : Boolean(condition);
  } catch (error) {
    detail = error?.message || String(error);
  }
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

async function main() {
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "missing-folders-ui-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { default as MissingFoldersBanner } from ${JSON.stringify(path.join(frontend, "src", "components", "MissingFoldersBanner.jsx"))};`,
    `export { default as ChatProjects } from ${JSON.stringify(path.join(frontend, "src", "components", "ChatProjects.jsx"))};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));

  await vite.build({
    root: frontend,
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    build: {
      ssr: entryFile,
      outDir: path.join(work, "out"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "missing-folders.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const built = require(path.join(work, "out", "missing-folders.cjs"));
  const renderBanner = (entries, onForget) => built.renderToStaticMarkup(
    built.createElement(built.MissingFoldersBanner, { entries, onForget: onForget || (() => {}) }),
  );

  try {
    const markup = renderBanner(ENTRIES);
    check("the strip is rendered with a stable test id", /data-testid="missing-folders-banner"/.test(markup));
    check("it announces itself as a status, not a dialog", /role="status"/.test(markup));
    check("it counts the failed folders", /2 saved folders could not be granted/.test(markup));
    check("it names every failed path", ENTRIES.every((entry) => markup.includes(entry.root)));
    check("it shows each reason from the server", ENTRIES.every((entry) => markup.includes(entry.error)));
    check("it offers exactly one Forget missing folders button",
      (markup.match(/Forget missing folders/g) || []).length === 1
      && /data-testid="forget-missing-folders"/.test(markup));
    check("the button is clickable, not disabled or a label", /<button[^>]*data-testid="forget-missing-folders"[^>]*>/.test(markup)
      && !/data-testid="forget-missing-folders"[^>]*disabled/.test(markup));
    check("it says files on disk are not deleted", /Files on disk are not deleted/.test(markup));

    const one = renderBanner([ENTRIES[0]]);
    check("one failure uses the singular wording", /1 saved folder could not be granted/.test(one));
    check("the second path is absent from the single-failure strip", !one.includes(ENTRIES[1].root));

    check("nothing is rendered when no restore failed", renderBanner([]) === "");
    check("a malformed entries prop does not crash the strip", renderBanner(undefined) === "");

    const hostile = renderBanner([{ root: "<script>alert(1)</script>", error: "gone" }]);
    check("a path is escaped as text, never injected as markup",
      !/<script>alert\(1\)<\/script>/.test(hostile) && /&lt;script&gt;/.test(hostile));

    // The editor must still render after the new import and props were added.
    const editorMarkup = built.renderToStaticMarkup(built.createElement(built.ChatProjects, {
      projects: [{ id: "p1", name: "Example", sourceFolders: [], folderGrants: {} }],
      setProjects: () => {},
      conversations: [],
      activeProjectId: "p1",
      setActiveProjectId: () => {},
      setActiveConversationId: () => {},
      setActiveTab: () => {},
      failedProjectFolders: { p1: ENTRIES },
      onForgetMissingFolders: () => {},
    }));
    check("the project sidebar still renders with the new props", /Example/.test(editorMarkup) && /Projects/.test(editorMarkup));

    // Static wiring: the strip belongs inside Edit project, not floating.
    const editor = fs.readFileSync(path.join(frontend, "src", "components", "ChatProjects.jsx"), "utf8");
    const app = fs.readFileSync(path.join(frontend, "src", "App.jsx"), "utf8");
    const sidebar = fs.readFileSync(path.join(frontend, "src", "components", "Sidebar.jsx"), "utf8");
    const lib = fs.readFileSync(path.join(frontend, "src", "lib", "work-grants.mjs"), "utf8");
    check("the strip is placed inside the Edit project dialog",
      editor.indexOf('role="dialog"') < editor.indexOf("<MissingFoldersBanner"));
    check("the failures are collected from the restore reply",
      /recordFailedFolders\(project\.id, failed\)/.test(app) && /const \{ grants, failed \}/.test(app));
    check("the failures travel App -> Sidebar -> editor",
      /failedProjectFolders=\{failedProjectFolders\}/.test(app)
      && /failedProjectFolders=\{failedProjectFolders\}/.test(sidebar));
    check("one click persists the removal and clears the strip",
      /setProjects\(\(current\)/.test(editor)
      && /onForgetMissingFolders\?\.\(editingProject\.id\)/.test(editor));
    check("the forget plan is a pure helper the other suite exercises",
      /export function forgetMissingFolders/.test(lib)
      && /export function missingFolderEntries/.test(lib)
      && /export function pruneProjectFolders/.test(lib));

  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed${process.exitCode ? " · with failures" : ", 0 failed"}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
