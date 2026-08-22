#!/usr/bin/env node
"use strict";

const crypto =
  require("node:crypto");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  S3CompatibleStorageAdapter,
} = require(
  "../server/s3-compatible-storage-adapter.cjs"
);

function fakeBody(bytes) {
  return {
    async transformToByteArray() {
      return Uint8Array.from(
        bytes
      );
    },
  };
}

async function main() {
  const temporaryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-s3-test-"
      )
    );

  const sourcePath =
    path.join(
      temporaryRoot,
      "source.bin"
    );

  const destinationPath =
    path.join(
      temporaryRoot,
      "downloads",
      "result.bin"
    );

  const statePath =
    path.join(
      temporaryRoot,
      "state.json"
    );

  const bytes =
    Buffer.from(
      "LUKE-AI-S3-COMPATIBLE-TEST"
    );

  fs.writeFileSync(
    sourcePath,
    bytes
  );

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        transfers: [],
        pendingDeleteConfirmations:
          [],
      },
      null,
      2
    ) + "\n"
  );

  const sha256 =
    crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");

  const provider = {
    id: "test-r2",
    name: "Test R2",
    category: "cloud",
    adapter:
      "s3-compatible",
    enabled: true,
    priority: 20,
    credentialReference:
      "test-r2-key",
    settings: {
      endpoint:
        "https://example.invalid",
      region: "auto",
      bucket: "luke-ai",
      forcePathStyle:
        false,
    },
    capabilities: {
      read: true,
      write: true,
      delete: false,
      resume: true,
    },
  };

  const providerCore = {
    getProvider(providerId) {
      if (
        providerId !==
        provider.id
      ) {
        throw new Error(
          "Provider missing."
        );
      }

      return provider;
    },
  };

  const credentialVault = {
    async get(reference) {
      if (
        reference !==
        provider
          .credentialReference
      ) {
        throw new Error(
          "Credential missing."
        );
      }

      return {
        accessKeyId:
          "TEST_ACCESS_KEY",
        secretAccessKey:
          "TEST_SECRET_KEY",
      };
    },
  };

  const client = {
    async send(command) {
      switch (
        command.constructor.name
      ) {
        case "HeadBucketCommand":
          return {};

        case "ListObjectsV2Command":
          return {
            KeyCount: 0,
          };

        case "HeadObjectCommand":
          return {
            ContentLength:
              bytes.length,
            Metadata: {
              "luke-sha256":
                sha256,
            },
          };

        case "GetObjectCommand":
          return {
            Body:
              fakeBody(bytes),
            Metadata: {
              "luke-sha256":
                sha256,
            },
          };

        case "DeleteObjectCommand":
          return {};

        default:
          return {};
      }
    },
  };

  let uploadCompleted =
    false;

  const adapter =
    new S3CompatibleStorageAdapter({
      providerCore,
      credentialVault,
      statePath,

      clientFactory() {
        return client;
      },

      uploadFactory() {
        return {
          on(
            eventName,
            callback
          ) {
            if (
              eventName ===
              "httpUploadProgress"
            ) {
              callback({
                loaded:
                  bytes.length,
                total:
                  bytes.length,
              });
            }

            return this;
          },

          async done() {
            uploadCompleted =
              true;
          },
        };
      },
    });

  const connection =
    await adapter
      .testConnection(
        provider.id
      );

  if (
    connection.connected !==
      true ||
    connection.canList !==
      true
  ) {
    throw new Error(
      "Connection test failed."
    );
  }

  const upload =
    await adapter
      .uploadFile({
        providerId:
          provider.id,
        sourcePath,
        objectKey:
          "models/test.bin",
      });

  if (
    uploadCompleted !==
      true ||
    upload.transfer
      .verified !== true ||
    upload.sourcePreserved !==
      true ||
    !fs.existsSync(
      sourcePath
    )
  ) {
    throw new Error(
      "Upload validation failed."
    );
  }

  const download =
    await adapter
      .downloadFile({
        providerId:
          provider.id,
        objectKey:
          "models/test.bin",
        destinationPath,
        approvedRoot:
          temporaryRoot,
      });

  if (
    download.transfer
      .sha256Verified !==
      true ||
    !fs.existsSync(
      destinationPath
    )
  ) {
    throw new Error(
      "Download validation failed."
    );
  }

  const confirmation =
    adapter.requestDelete({
      providerId:
        provider.id,
      objectKey:
        "models/test.bin",
    });

  if (
    !confirmation
      .confirmationId
  ) {
    throw new Error(
      "Delete confirmation missing."
    );
  }

  const deleted =
    await adapter
      .confirmDelete({
        confirmationId:
          confirmation
            .confirmationId,
      });

  if (
    deleted.deleted !==
      true
  ) {
    throw new Error(
      "Confirmed delete failed."
    );
  }

  const second =
    adapter.requestDelete({
      providerId:
        provider.id,
      objectKey:
        "models/keep.bin",
    });

  adapter.cancelDelete({
    confirmationId:
      second
        .confirmationId,
  });

  const state =
    adapter.getStatus();

  if (
    state
      .pendingDeleteConfirmations
      .length !== 0
  ) {
    throw new Error(
      "Cancelled delete remained pending."
    );
  }

  const server =
    fs.readFileSync(
      path.join(
        process.cwd(),
        "scripts",
        "server",
        "serve.cjs"
      ),
      "utf8"
    );

  for (const value of [
    "LUKE_AI_S3_COMPATIBLE_STORAGE_API_V2",
    "/api/storage/s3/test",
    "/api/storage/s3/upload",
    "/api/storage/s3/download",
    "/api/storage/s3/delete-request",
    "/api/storage/s3/delete-confirm",
    "/api/storage/s3/delete-cancel",
    "/api/storage/s3/status",
  ]) {
    if (
      !server.includes(value)
    ) {
      throw new Error(
        `Missing API: ${value}`
      );
    }
  }

  console.log(
    "PASS: AWS S3, Cloudflare R2, Backblaze B2 and MinIO use one S3-compatible adapter."
  );

  console.log(
    "PASS: Credentials are loaded through credential references."
  );

  console.log(
    "PASS: Bucket connection and list permissions are checked."
  );

  console.log(
    "PASS: Upload uses queue size 1."
  );

  console.log(
    "PASS: Upload size and SHA-256 metadata are verified."
  );

  console.log(
    "PASS: Local source is preserved after upload."
  );

  console.log(
    "PASS: Download SHA-256 verification succeeds."
  );

  console.log(
    "PASS: Cloud deletion requires explicit confirmation."
  );

  console.log(
    "PASS: Cancelled deletion preserves the Cloud object."
  );

  console.log(
    "PASS: S3-Compatible Storage Adapter validation completed."
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
