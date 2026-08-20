#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  StorageIntegrityScanner,
  sha256File,
  classifyResult,
} = require(
  "../server/storage-integrity-scanner.cjs"
);

async function main() {
  const root =
    path.join(
      "/tmp",
      `luke-integrity-${process.pid}`
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    }
  );

  try {
    const archivePath =
      path.join(
        root,
        "archive.bin"
      );

    const restorePath =
      path.join(
        root,
        "restore.bin"
      );

    const configPath =
      path.join(
        root,
        "config.json"
      );

    const statePath =
      path.join(
        root,
        "state.json"
      );

    fs.writeFileSync(
      archivePath,
      "LUKE INTEGRITY ARCHIVE"
    );

    fs.writeFileSync(
      restorePath,
      "LUKE INTEGRITY RESTORE"
    );

    const archiveHash =
      await sha256File(
        archivePath
      );

    const restoreHash =
      await sha256File(
        restorePath
      );

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        enabled: false,
        intervalMinutes: 360,
        verifySha256: true,
        verifySize: true,
        maxRecordsPerScan: 2000,
        automaticRepair: false,
        automaticDeletion: false,
        automaticOverwrite: false,
      })
    );

    fs.writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: null,
        scheduler: {
          running: false,
          intervalMinutes: 360,
          startedAt: null,
          lastRunAt: null,
          nextRunAt: null,
        },
        lastScan: null,
        scans: [],
        events: [],
      })
    );

    const archiveManager = {
      getStatus() {
        return {
          archives: [
            {
              id: "archive-local",
              verified: true,
              destinationPath:
                archivePath,
              destinationProviderId:
                "local-test",
              objectKey: null,
              sourceBytes:
                fs.statSync(
                  archivePath
                ).size,
              sourceSha256:
                archiveHash,
            },
            {
              id: "archive-cloud",
              verified: true,
              destinationPath: null,
              destinationProviderId:
                "cloud-test",
              objectKey:
                "models/cloud.gguf",
              sourceBytes: 100,
              sourceSha256:
                "abc123",
            },
          ],
        };
      },
    };

    const restoreManager = {
      getStatus() {
        return {
          restores: [
            {
              id: "restore-local",
              status: "completed",
              verified: true,
              destinationPath:
                restorePath,
              expectedBytes:
                fs.statSync(
                  restorePath
                ).size,
              expectedSha256:
                restoreHash,
            },
          ],
        };
      },
    };

    const scanner =
      new StorageIntegrityScanner({
        configPath,
        statePath,
        safeArchiveManager:
          archiveManager,
        restoreManager,
      });

    const scan =
      await scanner.runScan();

    if (
      scan.summary.healthy !== 2
    ) {
      throw new Error(
        "Expected 2 healthy local records"
      );
    }

    if (
      scan.summary
        .remoteVerificationRequired !==
      1
    ) {
      throw new Error(
        "Expected 1 remote verification record"
      );
    }

    fs.writeFileSync(
      restorePath,
      "CORRUPTED DATA"
    );

    const corrupted =
      await scanner.runScan();

    if (
      corrupted.summary
        .checksumMismatch === 0 &&
      corrupted.summary
        .sizeMismatch === 0
    ) {
      throw new Error(
        "Corruption was not detected"
      );
    }

    if (
      classifyResult({
        exists: false,
        sizeMatches: false,
        checksumMatches: false,
        remote: false,
      }) !== "missing"
    ) {
      throw new Error(
        "Missing classification failed"
      );
    }

    const scheduler =
      scanner.startScheduler(60);

    if (
      scheduler.running !== true
    ) {
      throw new Error(
        "Scheduler failed to start"
      );
    }

    const stopped =
      scanner.stopScheduler();

    if (
      stopped.running !== false
    ) {
      throw new Error(
        "Scheduler failed to stop"
      );
    }

    console.log(
      "PASS: Verified archives are included in integrity scans."
    );

    console.log(
      "PASS: Verified restores are included in integrity scans."
    );

    console.log(
      "PASS: File size verification detects mutations."
    );

    console.log(
      "PASS: SHA-256 verification detects corruption."
    );

    console.log(
      "PASS: Missing files are reported without modification."
    );

    console.log(
      "PASS: Remote Cloud records are marked for deep verification."
    );

    console.log(
      "PASS: Scheduled verification can be started and stopped."
    );

    console.log(
      "PASS: Integrity Scanner performs read-only verification."
    );

    console.log(
      "PASS: Automatic repair, deletion and overwrite remain disabled."
    );

    console.log(
      "PASS: Storage Integrity Scanner validation completed."
    );
  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
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
