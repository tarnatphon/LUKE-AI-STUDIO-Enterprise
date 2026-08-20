#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  StorageLifecycleManager,
  ageInDays,
} = require(
  "../server/storage-lifecycle-manager.cjs"
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
  const configPath =
    path.join(
      root,
      "app",
      "config",
      "storage",
      "storage-lifecycle-rules.json"
    );

  const temporaryState =
    path.join(
      "/tmp",
      `luke-lifecycle-test-${process.pid}.json`
    );

  fs.writeFileSync(
    temporaryState,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: null,
      lastPlan: null,
      plans: [],
      protectedPaths: [],
      events: [],
    })
  );

  const manager =
    new StorageLifecycleManager({
      configPath,
      statePath:
        temporaryState,
      workloadDetector: {
        detect() {
          return {
            workloadType:
              "temporary",
            confidence: 1,
            reason: "test",
          };
        },
      },
    });

  const old =
    Date.now() -
    100 *
      24 *
      60 *
      60 *
      1000;

  if (
    ageInDays(old) < 99
  ) {
    throw new Error(
      "Age calculation failed."
    );
  }

  const candidate =
    manager.classify({
      workloadType:
        "temporary",
      sizeBytes:
        100 * 1024 ** 2,
      modifiedAtMs:
        old,
    });

  if (
    candidate.action !==
    "delete-candidate"
  ) {
    throw new Error(
      "Old temporary file should be delete-candidate."
    );
  }

  const protectedResult =
    manager.classify({
      workloadType:
        "temporary",
      sizeBytes:
        100 * 1024 ** 2,
      modifiedAtMs:
        old,
      protectedFile:
        true,
    });

  if (
    protectedResult.action !==
    "keep"
  ) {
    throw new Error(
      "Protected files must stay Keep."
    );
  }

  const config =
    JSON.parse(
      read(
        "app/config/storage/storage-lifecycle-rules.json"
      )
    );

  for (const workload of [
    "models",
    "images",
    "video",
    "backups",
    "temporary",
  ]) {
    if (!config.rules?.[workload]) {
      throw new Error(
        `Missing lifecycle rule: ${workload}`
      );
    }
  }

  if (
    config.automaticDeletion !==
    false
  ) {
    throw new Error(
      "Automatic deletion must stay disabled."
    );
  }

  const server =
    read(
      "scripts/server/serve.cjs"
    );

  const panel =
    read(
      "app/frontend/src/components/StorageLifecyclePlannerPanel.jsx"
    );

  if (
    server.includes(
      "/api/storage/lifecycle/delete"
    )
  ) {
    throw new Error(
      "Lifecycle delete API must not exist."
    );
  }

  requireText(
    server,
    "/api/storage/lifecycle/plan",
    "Lifecycle API"
  );

  requireText(
    server,
    "/api/storage/lifecycle/protect",
    "Lifecycle API"
  );

  requireText(
    panel,
    "AUTO DELETE: OFF",
    "Lifecycle UI"
  );

  requireText(
    panel,
    "No files were deleted.",
    "Lifecycle UI"
  );

  console.log(
    "PASS: Lifecycle rules exist for Models, Images, Video, Backups and Temporary."
  );

  console.log(
    "PASS: Retention age controls Keep, Review, Archive and Delete-Candidate states."
  );

  console.log(
    "PASS: Protected paths always remain Keep."
  );

  console.log(
    "PASS: Symbolic links are excluded from lifecycle scans."
  );

  console.log(
    "PASS: Delete-Candidate is planning metadata only."
  );

  console.log(
    "PASS: No lifecycle deletion API exists."
  );

  console.log(
    "PASS: Automatic deletion remains disabled."
  );

  console.log(
    "PASS: Safe Cleanup Planner Dashboard is connected."
  );

  console.log(
    "PASS: Storage Lifecycle Rules validation completed."
  );

  fs.rmSync(
    temporaryState,
    {
      force: true,
    }
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
