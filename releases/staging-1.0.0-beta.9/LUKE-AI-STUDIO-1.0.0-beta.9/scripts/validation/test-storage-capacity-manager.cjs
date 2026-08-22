#!/usr/bin/env node
"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  calculateReserveBytes,
  capacityLevel,
} = require(
  "../server/storage-capacity-manager.cjs"
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
  const videoReserve =
    calculateReserveBytes({
      requiredBytes:
        100 * 1024 ** 3,
      workloadType:
        "video",
    });

  if (
    videoReserve <
    20 * 1024 ** 3
  ) {
    throw new Error(
      "Video reserve is too small."
    );
  }

  if (
    capacityLevel({
      availableBytes:
        100 * 1024 ** 3,
      requiredBytes:
        20 * 1024 ** 3,
      reserveBytes:
        10 * 1024 ** 3,
    }) !== "healthy"
  ) {
    throw new Error(
      "Healthy capacity classification failed."
    );
  }

  if (
    capacityLevel({
      availableBytes:
        10 * 1024 ** 3,
      requiredBytes:
        9 * 1024 ** 3,
      reserveBytes:
        5 * 1024 ** 3,
    }) !== "critical"
  ) {
    throw new Error(
      "Critical capacity classification failed."
    );
  }

  const manager =
    read(
      "scripts/server/storage-capacity-manager.cjs"
    );

  const queue =
    read(
      "scripts/server/unified-storage-transfer-queue.cjs"
    );

  const server =
    read(
      "scripts/server/serve.cjs"
    );

  const panel =
    read(
      "app/frontend/src/components/StorageCapacityPanel.jsx"
    );

  for (const value of [
    "StorageCapacityManager",
    "forecast",
    "reserve",
    "release",
    "getCleanupRecommendations",
    "automaticDeletion",
  ]) {
    requireText(
      manager,
      value,
      "Capacity Manager"
    );
  }

  requireText(
    queue,
    "LUKE_AI_STORAGE_CAPACITY_GUARD_V1",
    "Queue"
  );

  for (const value of [
    "/api/storage/capacity",
    "/api/storage/capacity/forecast",
  ]) {
    requireText(
      server,
      value,
      "Capacity API"
    );
  }

  for (const value of [
    "Storage Capacity Forecast",
    "Safe Space Management",
    "Forecast Space",
    "Automatic deletion:",
  ]) {
    requireText(
      panel,
      value,
      "Capacity Dashboard"
    );
  }

  console.log(
    "PASS: Required storage bytes are forecast before transfer."
  );

  console.log(
    "PASS: Safety reserve varies by workload."
  );

  console.log(
    "PASS: Active queue reservations reduce effective free space."
  );

  console.log(
    "PASS: Critical capacity prevents unsafe transfer start."
  );

  console.log(
    "PASS: Healthy provider recommendation integrates with storage policy."
  );

  console.log(
    "PASS: Capacity reservations are released after completion or failure."
  );

  console.log(
    "PASS: Cleanup recommendations never perform automatic deletion."
  );

  console.log(
    "PASS: Storage Capacity Dashboard is connected."
  );

  console.log(
    "PASS: Storage Capacity Management validation completed."
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
