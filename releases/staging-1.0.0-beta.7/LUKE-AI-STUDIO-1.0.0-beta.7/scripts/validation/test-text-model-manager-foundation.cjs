#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

const requiredFiles = [
  "docs/beta7/text-model-manager-v1-spec.md",
  "app/config/text-models/catalog-policy.json",
  "app/runtime-state/text-models/download-queue.json",
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required file is missing: ${relativePath}`);
  }
}

const policy = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "app/config/text-models/catalog-policy.json",
    ),
    "utf8",
  ),
);

const queue = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "app/runtime-state/text-models/download-queue.json",
    ),
    "utf8",
  ),
);

if (policy.catalogMode !== "signed") {
  throw new Error("Text model catalog must use signed mode.");
}

if (policy.signatureRequired !== true) {
  throw new Error("Catalog signature verification must be required.");
}

if (policy.downloadPolicy?.maximumBatchSelection !== 3) {
  throw new Error("Maximum model selection must be three.");
}

if (policy.downloadPolicy?.maximumConcurrentDownloads !== 1) {
  throw new Error("Downloads must run sequentially.");
}

if (
  policy.installationPolicy?.verifySha256 !== true ||
  policy.installationPolicy?.sideBySideInstallation !== true ||
  policy.installationPolicy?.testBeforeActivation !== true
) {
  throw new Error("Safe installation policy is incomplete.");
}

if (
  policy.storagePolicy?.fallbackToLocalStaging !== true ||
  policy.storagePolicy?.confirmBeforeDeletingLocalCopy !== true
) {
  throw new Error("Storage fallback policy is incomplete.");
}

if (
  queue.schemaVersion !== 1 ||
  queue.activeItemId !== null ||
  !Array.isArray(queue.items)
) {
  throw new Error("Initial download queue state is invalid.");
}

console.log("PASS: Signed catalog policy is enabled.");
console.log("PASS: Batch selection is limited to three models.");
console.log("PASS: Download concurrency is limited to one.");
console.log("PASS: Side-by-side installation and rollback policy are enabled.");
console.log("PASS: Preferred storage and Local Staging fallback are enabled.");
console.log("PASS: Text Model Manager foundation validation completed.");
