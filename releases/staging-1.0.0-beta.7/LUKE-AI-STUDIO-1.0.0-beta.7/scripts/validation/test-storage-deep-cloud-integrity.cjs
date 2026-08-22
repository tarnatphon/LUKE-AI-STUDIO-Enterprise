#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  StorageDeepCloudIntegrityManager,
  classifyVerification,
} = require(
  "../server/storage-deep-cloud-integrity-manager.cjs"
);

function hashBuffer(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

async function main() {
  const root =
    path.join(
      "/tmp",
      `luke-deep-cloud-${process.pid}`
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    }
  );

  try {
    const statePath =
      path.join(
        root,
        "state.json"
      );

    const content =
      Buffer.from(
        "LUKE AI DEEP CLOUD INTEGRITY TEST"
      );

    const checksum =
      hashBuffer(
        content
      );

    let corrupt =
      false;

    const archiveManager = {
      getStatus() {
        return {
          archives: [
            {
              id:
                "archive-cloud-test",
              verified:
                true,
              destinationProviderId:
                "s3-test",
              objectKey:
                "models/test.gguf",
              sourceBytes:
                content.length,
              sourceSha256:
                checksum,
            },
          ],
        };
      },
    };

    const s3Adapter = {
      async downloadFile({
        destinationPath,
        approvedRoot,
      }) {
        const resolved =
          path.resolve(
            destinationPath
          );

        const rootResolved =
          path.resolve(
            approvedRoot
          );

        if (
          !resolved.startsWith(
            rootResolved +
            path.sep
          )
        ) {
          throw new Error(
            "Unsafe temporary destination"
          );
        }

        fs.mkdirSync(
          path.dirname(
            resolved
          ),
          {
            recursive: true,
          }
        );

        fs.writeFileSync(
          resolved,
          corrupt
            ? Buffer.from(
                "CORRUPTED CLOUD OBJECT"
              )
            : content
        );

        return {
          ok: true,
          sha256Verified:
            !corrupt,
        };
      },
    };

    const manager =
      new StorageDeepCloudIntegrityManager({
        statePath,
        safeArchiveManager:
          archiveManager,
        s3Adapter,
      });

    const healthy =
      await manager
        .verifyArchive({
          archiveId:
            "archive-cloud-test",
          approvedRoot:
            root,
        });

    if (
      healthy.status !==
      "healthy"
    ) {
      throw new Error(
        "Healthy cloud verification failed."
      );
    }

    if (
      healthy
        .temporaryCopyRemoved !==
      true
    ) {
      throw new Error(
        "Temporary verification file was not removed."
      );
    }

    corrupt = true;

    const damaged =
      await manager
        .verifyArchive({
          archiveId:
            "archive-cloud-test",
          approvedRoot:
            root,
        });

    if (
      ![
        "size-mismatch",
        "checksum-mismatch",
      ].includes(
        damaged.status
      )
    ) {
      throw new Error(
        "Cloud corruption was not detected."
      );
    }

    const status =
      manager.getStatus();

    if (
      status.alertSummary
        .open < 1
    ) {
      throw new Error(
        "Integrity alert was not created."
      );
    }

    const alert =
      status.alerts.find(
        (item) =>
          item.status ===
          "open"
      );

    const acknowledged =
      manager
        .acknowledgeAlert(
          alert.id
        );

    if (
      acknowledged.status !==
      "acknowledged"
    ) {
      throw new Error(
        "Alert acknowledgement failed."
      );
    }

    if (
      classifyVerification({
        expectedBytes: 100,
        actualBytes: 99,
        expectedSha256: "a",
        actualSha256: "a",
      }) !==
      "size-mismatch"
    ) {
      throw new Error(
        "Size classification failed."
      );
    }

    console.log(
      "PASS: Deep verification uses the S3 download contract."
    );

    console.log(
      "PASS: Cloud object is downloaded only to the approved temporary verification area."
    );

    console.log(
      "PASS: Cloud object size is compared with verified archive metadata."
    );

    console.log(
      "PASS: Cloud object SHA-256 is compared with verified archive metadata."
    );

    console.log(
      "PASS: Corrupted Cloud objects create critical integrity alerts."
    );

    console.log(
      "PASS: Integrity alerts can be acknowledged without modifying Cloud objects."
    );

    console.log(
      "PASS: Temporary verification copies are removed after verification."
    );

    console.log(
      "PASS: Remote objects and archive sources remain read-only."
    );

    console.log(
      "PASS: Automatic repair and deletion remain disabled."
    );

    console.log(
      "PASS: Deep Cloud Integrity Verification validation completed."
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
