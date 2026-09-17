#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const distRoot = path.resolve("app/dist");
const html = fs.readFileSync(path.join(distRoot, "index.html"), "utf8");

function referencedAsset(pattern, label) {
  const match = html.match(pattern);
  if (!match) throw new Error(`${label}_REFERENCE_MISSING`);
  const assetPath = path.join(distRoot, match[1].replace(/^\//, ""));
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    throw new Error(`${label}_FILE_MISSING:${assetPath}`);
  }
  return assetPath;
}

const entryJs = referencedAsset(/src="\/(assets\/index-[^"]+\.js)"/, "ENTRY_JS");
const entryCss = referencedAsset(/href="\/(assets\/index-[^"]+\.css)"/, "ENTRY_CSS");
const jsBytes = fs.statSync(entryJs).size;
const cssBytes = fs.statSync(entryCss).size;
const cssGzipBytes = zlib.gzipSync(fs.readFileSync(entryCss)).length;

// The budget covers what the browser needs before it can paint the first
// screen. Workspace styles are no longer part of that: each workspace ships
// its own stylesheet, fetched when it opens, so growing a workspace no longer
// taxes the app's start-up. If this budget is ever hit again, the first
// question is whether the new rules belong to a workspace.
const limits = {
  initialJsBytes: 300 * 1024,
  initialCssGzipBytes: 26 * 1024,
};

if (jsBytes > limits.initialJsBytes) {
  throw new Error(`INITIAL_JS_BUDGET_EXCEEDED:${jsBytes}>${limits.initialJsBytes}`);
}
if (cssGzipBytes > limits.initialCssGzipBytes) {
  throw new Error(`INITIAL_CSS_GZIP_BUDGET_EXCEEDED:${cssGzipBytes}>${limits.initialCssGzipBytes}`);
}

// The split has to stay a split: a workspace-only style that creeps back into
// the entry sheet would quietly put the cost back on every start-up.
const entryCssText = fs.readFileSync(entryCss, "utf8");
const workspaceStyles = [
  { chunk: /href="\/(assets\/PersistentTextChat-[^"]+\.css)"/, selector: ".persistent-chat-recovery-panel", label: "PersistentTextChat" },
  { chunk: null, selector: ".persistent-chat-sidebar-header", label: "PersistentTextChat" },
  { chunk: null, selector: ".chat-empty-icon", label: "TextChat" },
  { chunk: null, selector: ".asset-library-grid", label: "AssetLibrary" },
];
for (const entry of workspaceStyles) {
  if (entryCssText.includes(entry.selector)) {
    throw new Error(`WORKSPACE_STYLE_IN_ENTRY_CSS:${entry.label}:${entry.selector}`);
  }
}
const chunkCss = fs
  .readdirSync(path.join(distRoot, "assets"))
  .filter((file) => file.endsWith(".css") && !file.startsWith("index-"));
if (chunkCss.length === 0) {
  throw new Error("WORKSPACE_STYLESHEETS_MISSING: no workspace stylesheet was emitted.");
}

console.log(`PASS: Initial JavaScript ${jsBytes} bytes <= ${limits.initialJsBytes}.`);
console.log(`PASS: Initial CSS ${cssBytes} bytes, gzip ${cssGzipBytes} bytes <= ${limits.initialCssGzipBytes}.`);
console.log(`PASS: ${chunkCss.length} workspace stylesheets travel with their own chunk, not with the first paint.`);
console.log("PASS: Beta 8 Frontend Bundle Budget validation completed.");
