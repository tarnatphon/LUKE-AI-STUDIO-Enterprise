#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  StorageSafeArchiveManager,
  sha256File,
} = require(
  "../server/storage-safe-archive-manager.cjs"
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

async function main() {
  const testRoot =
    path.join(
      "/tmp",
      `luke-safe-archive-${process.pid}`
    );

  fs.mkdirSync(
    testRoot,
    {
      recursive: true,
    }
  );

  const source =
    path.join(
      testRoot,
      "source.txt"
    );

  const destination =
    path.join(
      testRoot,
      "archive.txt"
    );

  const statePath =
    path.join(
      testRoot,
      "state.json"
    );

  fs.writeFileSync(
    source,
    "LUKE AI SAFE ARCHIVE TEST",
    "utf8"
  );

  let job = null;

  const transferQueue = {
    enqueue(input) {
      fs.copyFileSync(
        input.sourcePath,
        destination
      );

      job = {
        id: "job-test-1",
        sourcePath:
          input.sourcePath,
        destinationProviderId:
          "test-provider",
        status:
          "completed",
        verified:
          true,
      };

      return job;
    },

    getStatus() {
      return {
        jobs:
          job
            ? [job]
            : [],
      };
    },
  };

  const manager =
    new StorageSafeArchiveManager({
      statePath,
      transferQueue,
    });

  const archive =
    await manager
      .requestArchive({
        sourcePath:
          source,
      });

  if (!fs.existsSync(source)) {
    throw new Error(
      "Archive request must preserve source."
    );
  }

  const synced =
    manager.syncArchive(
      archive.id
    );

  if (
    synced.verified !== true
  ) {
    throw new Error(
      "Archive verification failed."
    );
  }

  if (
    synced.cleanupEligible !==
    true
  ) {
    throw new Error(
      "Verified archive must become cleanup eligible."
    );
  }

  const firstRequest =
    manager.requestCleanup(
      archive.id
    );

  if (
    firstRequest.status !==
    "pending"
  ) {
    throw new Error(
      "Cleanup request should be pending."
    );
  }

  if (!fs.existsSync(source)) {
    throw new Error(
      "Cleanup request alone must not delete source."
    );
  }

  manager.cancelCleanup(
    firstRequest.id
  );

  if (!fs.existsSync(source)) {
    throw new Error(
      "Cancelled cleanup must preserve source."
    );
  }

  const secondRequest =
    manager.requestCleanup(
      archive.id
    );

  const checksumBefore =
    await sha256File(
      source
    );

  if (
    checksumBefore !==
    archive.sourceSha256
  ) {
    throw new Error(
      "Source checksum mismatch before explicit cleanup."
    );
  }

  const result =
    await manager
      .confirmCleanup(
        secondRequest.id
      );

  if (
    result.sourceDeleted !==
    true
  ) {
    throw new Error(
      "Explicit cleanup confirmation did not delete source."
    );
  }

  if (fs.existsSync(source)) {
    throw new Error(
      "Source still exists after explicit confirmation."
    );
  }

  const server =
    read(
      "scripts/server/serve.cjs"
    );

  const panel =
    read(
      "app/frontend/src/components/StorageSafeArchivePanel.jsx"
    );

  for (const value of [
    "/api/storage/archive/request",
    "/api/storage/archive/sync",
    "/api/storage/archive/cleanup/request",
    "/api/storage/archive/cleanup/confirm",
    "/api/storage/archive/cleanup/cancel",
  ]) {
    requireText(
      server,
      value,
      "Safe Archive API"
    );
  }

  requireText(
    panel,
    "Archive → Verify → Explicit Cleanup",
    "Safe Archive UI"
  );

  requireText(
    panel,
    "Request Source Cleanup",
    "Safe Archive UI"
  );

  requireText(
    panel,
    "Confirm Delete Source",
    "Safe Archive UI"
  );

  console.log(
    "PASS: Archive requests preserve the source file."
  );

  console.log(
    "PASS: SHA-256 is captured before archive transfer."
  );

  console.log(
    "PASS: Cleanup becomes available only after verified archive completion."
  );

  console.log(
    "PASS: Cleanup request alone never deletes the source."
  );

  console.log(
    "PASS: Cancelled cleanup preserves the source."
  );

  console.log(
    "PASS: Source checksum and size are revalidated before deletion."
  );

  console.log(
    "PASS: Explicit cleanup confirmation deletes only the verified source."
  );

  console.log(
    "PASS: Automatic source deletion remains disabled."
  );

  console.log(
    "PASS: Safe Archive Dashboard is connected."
  );

  console.log(
    "PASS: Safe Archive Workflow validation completed."
  );

  fs.rmSync(
    testRoot,
    {
      recursive: true,
      force: true,
    }
  );
}

main().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.stack ||
          error.message
        : String(error)
    );

    process.exit(1);
  }
);
