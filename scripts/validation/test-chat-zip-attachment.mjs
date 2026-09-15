#!/usr/bin/env node
"use strict";

/**
 * ZIP attachment validation.
 *
 * Builds real archives with JSZip and checks the policy that keeps a small
 * machine safe: whole projects can be attached (up to 500 MB) without the
 * prompt exploding — only text is inlined, everything skipped is reported.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const modulePath = path.join(root, "app", "frontend", "src", "lib", "zip-attachment.mjs");

// jszip is a dependency of the app itself; the validation reuses that copy
// instead of adding another one.
function loadJsZip() {
  const candidates = [
    path.join(root, "scripts", "server", "package.json"),
    path.join(root, "app", "frontend", "package.json"),
  ];
  for (const entry of candidates) {
    try {
      return createRequire(entry)("jszip");
    } catch (_) {}
  }
  throw new Error(
    "jszip is not installed. Run `npm install` in scripts/server (or app/frontend) before this validation."
  );
}

const JSZip = loadJsZip();

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function fileFromBuffer(name, buffer, type = "") {
  return {
    name,
    type,
    size: buffer.byteLength,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

async function buildProject() {
  const zip = new JSZip();
  zip.file("README.md", "# luke\nA local AI studio.\n".repeat(20));
  zip.file("src/index.js", "console.log('hello');\n".repeat(50));
  zip.file("src/app.py", "print('hi')\n".repeat(30));
  zip.file("package.json", '{ "name": "luke", "version": "1.0.0" }');
  zip.file("package-lock.json", '{ "huge": true }');
  zip.file("assets/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
  zip.file("node_modules/dep/index.js", "module.exports = 1;\n".repeat(100));
  zip.file(".git/config", "[core]\n");
  zip.file("build/bundle.js", "/*! minified */\n".repeat(500));
  return zip.generateAsync({ type: "nodebuffer" });
}

const {
  ZIP_MAX_BYTES,
  isZipFile,
  describeZipLimit,
  extractZipAttachment,
} = await import(pathToFileURL(modulePath).href);

console.log("ZIP attachment validation");

assert(isZipFile({ name: "project.zip" }) === true, ".zip files are recognised by name");
assert(isZipFile({ name: "archive", type: "application/zip" }) === true, ".zip files are recognised by mime type");
assert(isZipFile({ name: "notes.txt" }) === false, "other files are not mistaken for archives");
assert(describeZipLimit(ZIP_MAX_BYTES) === "500 MB", `the limit is ${describeZipLimit(ZIP_MAX_BYTES)}`);

const buffer = await buildProject();
const file = fileFromBuffer("project.zip", buffer);
const result = await extractZipAttachment(file, { JSZip });

assert(result.entries === 15, `the archive structure is read (${result.entries} entries, folders included)`);
assert(
  result.content.includes("[ZIP attachment: project.zip]"),
  "the model is told that this is an archive"
);
assert(result.content.includes("src/index.js"), "source files are inlined");
assert(result.content.includes("console.log('hello')"), "the actual source code reaches the model");
assert(result.content.includes("=== src/app.py ==="), "each inlined file is labelled with its path");

assert(!result.content.includes("node_modules/dep/index.js"), "node_modules is skipped");
assert(!result.content.includes("assets/logo.png".slice(0, 10)) || !result.content.includes("PNG"), "binaries are not dumped into the prompt");
assert(!result.content.includes('"huge": true'), "lock files are skipped");
assert(!result.content.includes("[core]"), ".git internals are skipped");
assert(result.skipped > 0, `skipped entries are counted (${result.skipped})`);
assert(
  /skipped \d+ \(/.test(result.content),
  "the skipped entries are reported so nothing is silently lost"
);
assert(result.included === 4, `only text files are inlined (${result.included} of ${result.entries})`);

// Size guard: 500 MB is the contract the user asked for.
const oversized = {
  name: "huge.zip",
  size: ZIP_MAX_BYTES + 1024,
  arrayBuffer: async () => new ArrayBuffer(8),
};
let threw = null;
try {
  await extractZipAttachment(oversized, { JSZip });
} catch (error) {
  threw = error;
}
assert(threw !== null, "an archive above the limit is refused before it is read");
assert(threw?.code === "ZIP_TOO_LARGE", "the refusal says the file is too large");
assert(/500 MB/.test(threw.message), "the refusal names the limit");

const atLimit = fileFromBuffer("exact.zip", buffer, "application/zip");
atLimit.size = ZIP_MAX_BYTES;
const limitResult = await extractZipAttachment(atLimit, { JSZip });
assert(limitResult.included > 0, "an archive exactly at the limit is still accepted");

// Broken archives must fail with guidance, not crash the composer.
let brokenError = null;
try {
  await extractZipAttachment(fileFromBuffer("broken.zip", Buffer.from("not a zip at all")), { JSZip });
} catch (error) {
  brokenError = error;
}
assert(brokenError !== null, "a corrupt archive is rejected");
assert(/could not be opened as a ZIP/.test(brokenError.message), "the error explains the archive could not be opened");

// A binary blob that pretends to be text must not be inlined.
const tricky = new JSZip();
tricky.file("blob.txt", Buffer.concat([Buffer.from("hello"), Buffer.from([0x00, 0x01, 0x02])]));
const trickyResult = await extractZipAttachment(
  fileFromBuffer("tricky.zip", await tricky.generateAsync({ type: "nodebuffer" })),
  { JSZip }
);
assert(trickyResult.included === 0, "files that are really binary are detected and skipped");

console.log("\nPASS: ZIP attachment validation completed.");
