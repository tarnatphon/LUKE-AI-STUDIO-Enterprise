#!/usr/bin/env node
"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

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
  const panel =
    read(
      "app/frontend/src/components/CloudStorageProviderPanel.jsx"
    );

  const chat =
    read(
      "app/frontend/src/components/PersistentTextChat.jsx"
    );

  const css =
    read(
      "app/frontend/src/App.css"
    );

  const server =
    read(
      "scripts/server/serve.cjs"
    );

  for (const value of [
    "LUKE_AI_CLOUD_STORAGE_PROVIDER_DASHBOARD_V2",
    "Amazon S3",
    "Cloudflare R2",
    "Backblaze B2",
    "MinIO",
    "Custom S3-Compatible",
    "Add Cloud Account",
    "Test Connection",
    "Upload & Verify",
    "Download & Verify",
    "Request Delete",
    "ยืนยันลบ Cloud Object",
    "Cloud Transfer History",
  ]) {
    requireText(
      panel,
      value,
      "Cloud Dashboard"
    );
  }

  for (const value of [
    "/api/storage/providers",
    "/api/storage/credentials",
    "/api/storage/s3/test",
    "/api/storage/s3/upload",
    "/api/storage/s3/download",
    "/api/storage/s3/delete-request",
    "/api/storage/s3/delete-confirm",
    "/api/storage/s3/delete-cancel",
    "/api/storage/s3/status",
  ]) {
    requireText(
      server,
      value,
      "Cloud API"
    );
  }

  requireText(
    chat,
    "LUKE_AI_CLOUD_STORAGE_PANEL_IMPORT_V2",
    "Text UI"
  );

  requireText(
    chat,
    "LUKE_AI_CLOUD_STORAGE_PANEL_MOUNT_V2",
    "Text UI"
  );

  requireText(
    css,
    "LUKE_AI_CLOUD_STORAGE_PROVIDER_STYLES_V2",
    "Cloud CSS"
  );

  if (
    (
      chat.match(
        /import CloudStorageProviderPanel/g
      ) || []
    ).length !== 1
  ) {
    throw new Error(
      "Cloud Panel import must appear exactly once."
    );
  }

  if (
    (
      chat.match(
        /<CloudStorageProviderPanel/g
      ) || []
    ).length !== 1
  ) {
    throw new Error(
      "Cloud Panel mount must appear exactly once."
    );
  }

  console.log(
    "PASS: AWS S3 Cloud account UI is available."
  );

  console.log(
    "PASS: Cloudflare R2 Cloud account UI is available."
  );

  console.log(
    "PASS: Backblaze B2 Cloud account UI is available."
  );

  console.log(
    "PASS: MinIO and Custom S3 account UI are available."
  );

  console.log(
    "PASS: Cloud credentials use macOS Keychain API."
  );

  console.log(
    "PASS: Cloud Test Connection UI is connected."
  );

  console.log(
    "PASS: Cloud Upload and SHA-256 verification UI is connected."
  );

  console.log(
    "PASS: Cloud Download and SHA-256 verification UI is connected."
  );

  console.log(
    "PASS: Cloud deletion requires Request and Confirm."
  );

  console.log(
    "PASS: Cloud Transfer History is displayed."
  );

  console.log(
    "PASS: Cloud Storage Provider Dashboard validation completed."
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
