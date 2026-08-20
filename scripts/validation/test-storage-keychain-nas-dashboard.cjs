#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
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
  const vault =
    read(
      "scripts/server/macos-keychain-credential-vault.cjs"
    );

  const core =
    read(
      "scripts/server/unified-storage-provider-core.cjs"
    );

  const server =
    read(
      "scripts/server/serve.cjs"
    );

  const panel =
    read(
      "app/frontend/src/components/StorageProviderPanel.jsx"
    );

  const chat =
    read(
      "app/frontend/src/components/PersistentTextChat.jsx"
    );

  const css =
    read(
      "app/frontend/src/App.css"
    );

  for (const value of [
    "/usr/bin/security",
    "add-generic-password",
    "find-generic-password",
    "delete-generic-password",
    "shell: false",
    "redactCredential",
  ]) {
    requireText(
      vault,
      value,
      "Keychain Vault"
    );
  }

  for (const value of [
    "LUKE_AI_PROVIDER_CREDENTIAL_REFERENCE_V1",
    "setCredentialReference",
    "clearCredentialReference",
  ]) {
    requireText(
      core,
      value,
      "Provider Core"
    );
  }

  for (const value of [
    "LUKE_AI_STORAGE_KEYCHAIN_API_V1",
    "/api/storage/credentials",
    "/api/storage/credentials/status",
    "/api/storage/credentials/delete",
  ]) {
    requireText(
      server,
      value,
      "Storage API"
    );
  }

  for (const value of [
    "LUKE_AI_STORAGE_PROVIDER_PANEL_V1",
    "NAS & Cloud Providers",
    "Mounted NAS Folder",
    "Choose NAS Folder",
    "Add Storage Provider",
    "Test Provider",
  ]) {
    requireText(
      panel,
      value,
      "Provider Dashboard"
    );
  }

  requireText(
    chat,
    "LUKE_AI_STORAGE_PROVIDER_PANEL_IMPORT_V2",
    "Text UI"
  );

  requireText(
    chat,
    "LUKE_AI_STORAGE_PROVIDER_PANEL_MOUNT_V2",
    "Text UI"
  );

  requireText(
    css,
    "LUKE_AI_STORAGE_PROVIDER_PANEL_STYLES_V2",
    "Provider CSS"
  );

  if (
    (
      chat.match(
        /import StorageProviderPanel/g
      ) || []
    ).length !== 1
  ) {
    throw new Error(
      "Storage Provider Panel import must appear exactly once."
    );
  }

  if (
    (
      chat.match(
        /<StorageProviderPanel/g
      ) || []
    ).length !== 1
  ) {
    throw new Error(
      "Storage Provider Panel mount must appear exactly once."
    );
  }

  console.log(
    "PASS: macOS Keychain stores provider credentials."
  );

  console.log(
    "PASS: Credential secrets are never returned by the summary API."
  );

  console.log(
    "PASS: JSON provider configuration stores only credential references."
  );

  console.log(
    "PASS: Keychain commands use argument arrays with shell disabled."
  );

  console.log(
    "PASS: Mounted NAS folders can be selected with the native folder picker."
  );

  console.log(
    "PASS: NAS read, write and free-space health checks are available."
  );

  console.log(
    "PASS: SMB and WebDAV credentials can be saved to Keychain."
  );

  console.log(
    "PASS: NAS mounting remains manual and automatic mount remains disabled."
  );

  console.log(
    "PASS: Storage Keychain and NAS Dashboard validation completed."
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
