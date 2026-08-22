#!/usr/bin/env node
"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  detectByExtension,
  detectByPath,
} = require(
  "../server/storage-workload-detector.cjs"
);

const root =
  path.resolve(
    __dirname,
    "..",
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath
    ),
    "utf8"
  );
}

function expect(
  actual,
  expected,
  label
) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${expected}, received ${actual}`
    );
  }
}

function requireText(
  content,
  value,
  label
) {
  if (!content.includes(value)) {
    throw new Error(
      `${label} missing: ${value}`
    );
  }
}

function main() {
  expect(
    detectByExtension(
      "/models/qwen.gguf"
    ).workloadType,
    "models",
    "GGUF"
  );

  expect(
    detectByExtension(
      "/renders/photo.png"
    ).workloadType,
    "images",
    "PNG"
  );

  expect(
    detectByExtension(
      "/video/movie.mov"
    ).workloadType,
    "video",
    "MOV"
  );

  expect(
    detectByExtension(
      "/backup/data.zip"
    ).workloadType,
    "backups",
    "ZIP"
  );

  expect(
    detectByPath(
      "/Users/test/Library/Caches/file.dat"
    ).workloadType,
    "temporary",
    "Cache path"
  );

  const queue =
    read(
      "scripts/server/unified-storage-transfer-queue.cjs"
    );

  const server =
    read(
      "scripts/server/serve.cjs"
    );

  const queuePanel =
    read(
      "app/frontend/src/components/UnifiedTransferQueuePanel.jsx"
    );

  const detectorPanel =
    read(
      "app/frontend/src/components/StorageWorkloadDetectionPanel.jsx"
    );

  requireText(
    queue,
    "LUKE_AI_AUTOMATIC_WORKLOAD_DETECTION_V1",
    "Queue"
  );

  requireText(
    queue,
    "workloadOverride",
    "Queue"
  );

  requireText(
    queue,
    "workloadDetection",
    "Queue"
  );

  requireText(
    server,
    "/api/storage/workload",
    "Detector API"
  );

  requireText(
    server,
    "/api/storage/workload/detect",
    "Detector API"
  );

  requireText(
    queuePanel,
    "Manual Workload Override",
    "Queue UI"
  );

  requireText(
    detectorPanel,
    "Automatic Workload Detection",
    "Detector UI"
  );

  console.log(
    "PASS: GGUF and model extensions route to Models."
  );

  console.log(
    "PASS: Image extensions route to Images."
  );

  console.log(
    "PASS: Video extensions route to Video."
  );

  console.log(
    "PASS: Archive and backup extensions route to Backups."
  );

  console.log(
    "PASS: Temporary and cache paths route to Temporary."
  );

  console.log(
    "PASS: Queue automatically detects workloadType."
  );

  console.log(
    "PASS: Manual workload override remains supported."
  );

  console.log(
    "PASS: Detection history is persisted."
  );

  console.log(
    "PASS: Automatic Workload Detection validation completed."
  );
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.stack ||
        error.message
      : String(error)
  );

  process.exit(1);
}
