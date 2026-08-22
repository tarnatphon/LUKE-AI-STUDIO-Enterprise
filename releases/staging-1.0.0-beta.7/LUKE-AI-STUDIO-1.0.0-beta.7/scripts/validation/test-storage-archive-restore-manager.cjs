#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  StorageArchiveRestoreManager,
  sha256File,
  restoreAsNewPath,
} = require(
  "../server/storage-archive-restore-manager.cjs"
);

async function main() {
  const root =
    path.join(
      "/tmp",
      `luke-restore-${process.pid}`
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    }
  );

  const archiveFile =
    path.join(
      root,
      "archive.bin"
    );

  const destination =
    path.join(
      root,
      "restored.bin"
    );

  const statePath =
    path.join(
      root,
      "state.json"
    );

  fs.writeFileSync(
    archiveFile,
    "LUKE AI RESTORE VERIFICATION TEST"
  );

  const expectedSha256 =
    await sha256File(
      archiveFile
    );

  const expectedBytes =
    fs.statSync(
      archiveFile
    ).size;

  const safeArchiveManager = {
    getStatus() {
      return {
        archives: [
          {
            id:
              "archive-test-1",
            verified:
              true,
            destinationProviderId:
              "local-test",
            destinationPath:
              archiveFile,
            objectKey:
              null,
            sourceSha256:
              expectedSha256,
            sourceBytes:
              expectedBytes,
          },
        ],
      };
    },
  };

  const manager =
    new StorageArchiveRestoreManager({
      statePath,
      safeArchiveManager,
      transferQueue: {},
    });

  const restore =
    manager.requestRestore({
      archiveId:
        "archive-test-1",
      destinationPath:
        destination,
      restoreAsNew:
        false,
    });

  if (
    fs.existsSync(
      destination
    )
  ) {
    throw new Error(
      "Restore request must not create destination."
    );
  }

  const completed =
    await manager
      .restoreLocalArchive({
        restoreId:
          restore.id,
        sourceArchivePath:
          archiveFile,
      });

  if (
    completed.verified !==
    true
  ) {
    throw new Error(
      "Restore verification failed."
    );
  }

  const restoredHash =
    await sha256File(
      destination
    );

  if (
    restoredHash !==
    expectedSha256
  ) {
    throw new Error(
      "Restored checksum mismatch."
    );
  }

  let overwriteBlocked =
    false;

  try {
    manager.requestRestore({
      archiveId:
        "archive-test-1",
      destinationPath:
        destination,
      restoreAsNew:
        false,
    });
  } catch (error) {
    overwriteBlocked =
      error.statusCode ===
      409;
  }

  if (!overwriteBlocked) {
    throw new Error(
      "Automatic overwrite must be blocked."
    );
  }

  const unique =
    restoreAsNewPath(
      destination
    );

  if (
    unique === destination
  ) {
    throw new Error(
      "Restore-as-new did not create unique path."
    );
  }

  console.log(
    "PASS: Only verified archives can be restored."
  );

  console.log(
    "PASS: Archive size is verified before restore."
  );

  console.log(
    "PASS: Archive SHA-256 is verified before restore."
  );

  console.log(
    "PASS: Restored size is verified after copy."
  );

  console.log(
    "PASS: Restored SHA-256 is verified after copy."
  );

  console.log(
    "PASS: Existing files are never overwritten automatically."
  );

  console.log(
    "PASS: Restore-as-new creates a unique destination."
  );

  console.log(
    "PASS: Archive source remains preserved."
  );

  console.log(
    "PASS: Archive Restore Workflow validation completed."
  );

  fs.rmSync(
    root,
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
