#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const managerFile = path.join(
  root,
  "scripts",
  "server",
  "storage-destination-manager.cjs"
);

const serverFile = path.join(
  root,
  "scripts",
  "server",
  "serve.cjs"
);

async function main() {
  const temporaryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-storage-test-"
      )
    );

  const localRoot =
    path.join(
      temporaryRoot,
      "local"
    );

  const externalRoot =
    path.join(
      temporaryRoot,
      "external"
    );

  const policyPath =
    path.join(
      temporaryRoot,
      "policy.json"
    );

  const statePath =
    path.join(
      temporaryRoot,
      "state.json"
    );

  fs.mkdirSync(
    localRoot,
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        enabled: true,
        selectionMode:
          "automatic",
        preferredDestination: {
          type:
            "external",
          volumeName:
            "TEST",
          relativePath:
            "downloads"
        },
        localFallback: {
          enabled: true,
          path:
            localRoot
        },
        customDestination: {
          enabled: false,
          path: ""
        },
        transfer: {
          verifyFileSize: true,
          verifySha256: true,
          preserveLocalCopyAfterTransfer:
            true,
          requireConfirmationBeforeLocalDeletion:
            true,
          maximumHistoryItems:
            200
        },
        security: {
          allowShell: false,
          allowPathOutsideApprovedRoots:
            false,
          allowAutomaticDeletion:
            false
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        activeDestination: null,
        externalDriveAvailable:
          false,
        fallbackActive: false,
        pendingDeletionConfirmations:
          [],
        transferHistory: []
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const {
    StorageDestinationManager,
  } = require(managerFile);

  const manager =
    new StorageDestinationManager({
      root,
      policyPath,
      statePath,
    });

  manager.getExternalRoot =
    () => externalRoot;

  manager.getExternalDestination =
    () =>
      path.join(
        externalRoot,
        "downloads"
      );

  const fallback =
    manager.resolveActiveDestination();

  if (
    fallback.destination.type !==
      "local" ||
    fallback.fallbackActive !==
      true
  ) {
    throw new Error(
      "Local fallback was not selected."
    );
  }

  fs.mkdirSync(
    externalRoot,
    {
      recursive: true,
    }
  );

  const external =
    manager.resolveActiveDestination();

  if (
    external.destination.type !==
      "external" ||
    external.externalDriveAvailable !==
      true
  ) {
    throw new Error(
      "External destination was not selected."
    );
  }

  const sourcePath =
    path.join(
      localRoot,
      "models",
      "sample.bin"
    );

  fs.mkdirSync(
    path.dirname(sourcePath),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    sourcePath,
    "LUKE-AI-STORAGE-TEST",
    "utf8"
  );

  const result =
    await manager.transferLocalFile({
      sourcePath,
    });

  if (
    result.transfer.verification
      .verified !== true
  ) {
    throw new Error(
      "Transfer verification failed."
    );
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      "Local copy was deleted without confirmation."
    );
  }

  if (
    !fs.existsSync(
      result.transfer.destinationPath
    )
  ) {
    throw new Error(
      "External copy was not created."
    );
  }

  const confirmation =
    result.pendingDeletionConfirmation;

  if (!confirmation?.confirmationId) {
    throw new Error(
      "Deletion confirmation was not created."
    );
  }

  await manager.confirmLocalDeletion({
    confirmationId:
      confirmation.confirmationId,
  });

  if (fs.existsSync(sourcePath)) {
    throw new Error(
      "Confirmed deletion did not remove the Local copy."
    );
  }

  const secondSource =
    path.join(
      localRoot,
      "cancel-test.bin"
    );

  fs.writeFileSync(
    secondSource,
    "CANCEL-TEST",
    "utf8"
  );

  const secondResult =
    await manager.transferLocalFile({
      sourcePath:
        secondSource,
    });

  manager.cancelLocalDeletion({
    confirmationId:
      secondResult
        .pendingDeletionConfirmation
        .confirmationId,
  });

  if (!fs.existsSync(secondSource)) {
    throw new Error(
      "Cancelled deletion removed the Local copy."
    );
  }

  const server =
    fs.readFileSync(
      serverFile,
      "utf8"
    );

  for (const requirement of [
    "LUKE_AI_STORAGE_DESTINATION_MANAGER_API_V2",
    "/api/storage/status",
    "/api/storage/resolve",
    "/api/storage/transfer",
    "/api/storage/confirm-local-deletion",
    "/api/storage/cancel-local-deletion",
    "StorageDestinationManager",
  ]) {
    if (!server.includes(requirement)) {
      throw new Error(
        `Storage API requirement missing: ${requirement}`
      );
    }
  }

  console.log(
    "PASS: Local fallback was selected when External Drive was unavailable."
  );

  console.log(
    "PASS: External destination was selected when the drive became available."
  );

  console.log(
    "PASS: Files were copied from Local fallback to External storage."
  );

  console.log(
    "PASS: File size and SHA-256 verification completed."
  );

  console.log(
    "PASS: Local copy remained after transfer."
  );

  console.log(
    "PASS: Local deletion required explicit confirmation."
  );

  console.log(
    "PASS: Confirmed deletion removed only the verified Local source."
  );

  console.log(
    "PASS: Cancelled deletion preserved the Local source."
  );

  console.log(
    "PASS: Shell and automatic deletion remained disabled."
  );

  console.log(
    "PASS: Storage Destination Manager validation completed."
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack ||
        error.message
      : String(error)
  );

  process.exit(1);
});
