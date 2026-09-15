#!/usr/bin/env node
"use strict";

/**
 * Chat attachment validation.
 *
 * Static contract test for the composer: picking a file must never depend on a
 * model being loaded (the user should be able to gather files, then load a
 * model), while sending still requires one.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const chatFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function section(source, startMarker, length = 2600) {
  const index = source.indexOf(startMarker);
  return index < 0 ? "" : source.slice(index, index + length);
}

const source = fs.readFileSync(chatFile, "utf8");

console.log("Chat attachment validation");

assert(source.includes('ref={fileInputRef}'), "the composer owns a hidden file input");
assert(/style=\{\{\s*display:\s*"none"\s*\}\}/.test(source), "the file input itself stays invisible");

const attachButton = section(source, 'className="chat-composer-attach-btn"', 700);
assert(attachButton.length > 0, "the paperclip button exists");
assert(
  attachButton.includes("fileInputRef.current?.click()"),
  "clicking the paperclip opens the file picker"
);
assert(
  !attachButton.includes("disabled"),
  "the paperclip is never disabled — files can be picked before a model is loaded"
);

assert(
  source.includes("isUndecodableImage"),
  "image formats browsers cannot decode are detected up front"
);
assert(
  /heic/i.test(source) && /HEIC\/HEIF\/AVIF\/TIFF/.test(source),
  "HEIC/HEIF/AVIF/TIFF get an actionable message instead of a cryptic failure"
);

for (const [label, marker] of [
  ["audio transcription", "transcribeAudioAttachment"],
  ["PDF text extraction", "extractPdfText"],
  ["Word documents", "extractWordText"],
  ["PowerPoint decks", "extractPowerPointText"],
  ["XLSX spreadsheets", "readXlsxFile"],
]) {
  assert(source.includes(marker), `${label} is wired into the attachment handler`);
}

assert(
  /onDrop=[\s\S]{0,200}addAttachmentFiles/.test(source),
  "files can also be dropped onto the composer"
);
assert(
  /onPaste=[\s\S]{0,200}addAttachmentFiles/.test(source),
  "files can also be pasted into the composer"
);

assert(
  /disabled=\{\(!draftAvailable[\s\S]{0,300}!status\.ready/.test(source),
  "sending still requires a loaded model (attachments are only staged before that)"
);

console.log("\nPASS: chat attachment validation completed.");
