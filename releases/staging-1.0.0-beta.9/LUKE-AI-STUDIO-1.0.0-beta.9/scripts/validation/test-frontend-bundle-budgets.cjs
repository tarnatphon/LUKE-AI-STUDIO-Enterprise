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

const limits = {
  initialJsBytes: 300 * 1024,
  initialCssGzipBytes: 25 * 1024,
};

if (jsBytes > limits.initialJsBytes) {
  throw new Error(`INITIAL_JS_BUDGET_EXCEEDED:${jsBytes}>${limits.initialJsBytes}`);
}
if (cssGzipBytes > limits.initialCssGzipBytes) {
  throw new Error(`INITIAL_CSS_GZIP_BUDGET_EXCEEDED:${cssGzipBytes}>${limits.initialCssGzipBytes}`);
}

console.log(`PASS: Initial JavaScript ${jsBytes} bytes <= ${limits.initialJsBytes}.`);
console.log(`PASS: Initial CSS ${cssBytes} bytes, gzip ${cssGzipBytes} bytes <= ${limits.initialCssGzipBytes}.`);
console.log("PASS: Beta 8 Frontend Bundle Budget validation completed.");
