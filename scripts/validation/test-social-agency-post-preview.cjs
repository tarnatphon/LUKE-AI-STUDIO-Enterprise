#!/usr/bin/env node
"use strict";

// Guard the full-content/platform-layout preview used by Style, Entry details,
// and the approval queue. This repository's UI validations are source-level;
// the production Vite build separately validates JSX and imports.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const preview = read("app", "frontend", "src", "social-agency", "PostPreview.jsx");
const css = read("app", "frontend", "src", "social-agency.css");
const styleTab = read("app", "frontend", "src", "social-agency", "StyleTab.jsx");
const drawers = read("app", "frontend", "src", "social-agency", "drawers.jsx");
const runsTab = read("app", "frontend", "src", "social-agency", "RunsTab.jsx");

const tests = [
  ["preview uses the exact published caption when it exists, otherwise the draft", () => {
    assert.match(preview, /entry\?\.publishedCaption \|\| entry\?\.caption/);
    assert.match(preview, /captionProp === undefined/);
  }],
  ["the preview renders complete copy without line clamping", () => {
    assert.match(preview, /<p>\{text \|\| captionPlaceholder\}<\/p>/);
    assert.match(css, /\.sa-post-preview-caption p, \.sa-post-preview-line-bubble p\s*\{[^}]*white-space:\s*pre-wrap/s);
    assert.match(css, /\.sa-post-preview-caption p, \.sa-post-preview-line-bubble p\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    assert.doesNotMatch(preview, /line-clamp/);
  }],
  ["media layout reflects platform-specific image/video behavior", () => {
    assert.match(preview, /platform !== "tiktok"/);
    assert.match(preview, /sendImageTextStack !== false/);
    assert.match(preview, /showFacebookProductRef/);
    assert.match(preview, /<video[^>]*controls/);
    assert.match(css, /\.sa-post-preview\.is-instagram \.sa-post-preview-media\s*\{[^}]*aspect-ratio:\s*1 \/ 1/s);
    assert.match(css, /\.sa-post-preview\.is-tiktok \.sa-post-preview-media\s*\{[^}]*aspect-ratio:\s*9 \/ 16/s);
  }],
  ["each generated platform version gets a full visual preview", () => {
    assert.match(styleTab, /<PostPreview[\s\S]*?platform=\{platform\}[\s\S]*?caption=\{text\}/);
    assert.match(styleTab, /ดูข้อความเต็มพร้อมตัวอย่างการจัดวาง/);
  }],
  ["entry details show the full post and retain copy support", () => {
    assert.match(drawers, /พรีวิวโพสต์เต็ม/);
    assert.match(drawers, /<PostPreview entry=\{entry\} client=\{client\} product=\{product\}/);
    assert.match(drawers, /copy\(entry\.publishedCaption \|\| entry\.caption, "caption"\)/);
  }],
  ["the approval queue can expand a complete post preview", () => {
    assert.match(runsTab, /<details className="sa-approval-preview">/);
    assert.match(runsTab, /พรีวิวข้อความและเลย์เอาต์โพสต์เต็ม/);
    assert.match(runsTab, /<PostPreview entry=\{entry\} client=\{activeClient\} product=\{product\}/);
  }],
];

for (const [name, test] of tests) {
  test();
  console.log(`  ok - ${name}`);
}
console.log(`PASS: ${tests.length} Social Agency post preview checks`);
