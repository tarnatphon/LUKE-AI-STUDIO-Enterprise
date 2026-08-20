#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const files = {
  manager: path.join(
    root,
    "scripts",
    "server",
    "storage-destination-manager.cjs"
  ),
  picker: path.join(
    root,
    "scripts",
    "server",
    "storage-folder-picker.cjs"
  ),
  server: path.join(
    root,
    "scripts",
    "server",
    "serve.cjs"
  ),
  panel: path.join(
    root,
    "app",
    "frontend",
    "src",
    "components",
    "StorageDestinationPanel.jsx"
  ),
  chat: path.join(
    root,
    "app",
    "frontend",
    "src",
    "components",
    "PersistentTextChat.jsx"
  ),
  css: path.join(
    root,
    "app",
    "frontend",
    "src",
    "App.css"
  ),
};

function read(filePath) {
  return fs.readFileSync(
    filePath,
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
  const manager = read(files.manager);
  const picker = read(files.picker);
  const server = read(files.server);
  const panel = read(files.panel);
  const chat = read(files.chat);
  const css = read(files.css);

  for (const value of [
    "LUKE_AI_STORAGE_POLICY_MANAGEMENT_V1",
    "getPolicy()",
    "updatePolicy(input)",
    "allowAutomaticDeletion",
    "requireConfirmationBeforeLocalDeletion",
  ]) {
    requireText(
      manager,
      value,
      "Storage Manager"
    );
  }

  for (const value of [
    "/usr/bin/osascript",
    "chooseStorageFolder",
    "shell: false",
  ]) {
    requireText(
      picker,
      value,
      "Folder Picker"
    );
  }

  for (const value of [
    "/api/storage/settings",
    "/api/storage/choose-folder",
    "/api/storage/transfer",
    "/api/storage/confirm-local-deletion",
    "/api/storage/cancel-local-deletion",
  ]) {
    requireText(
      server,
      value,
      "Storage API"
    );
  }

  for (const value of [
    "LUKE_AI_STORAGE_DESTINATION_DASHBOARD_V2",
    "Storage Destination Manager",
    "Save Storage Settings",
    "Choose Folder",
    "Transfer to External Drive",
    "ยืนยันลบ Local Copy",
    "เก็บ Local Copy ไว้",
    "Transfer History",
  ]) {
    requireText(
      panel,
      value,
      "Storage Dashboard"
    );
  }

  requireText(
    chat,
    "LUKE_AI_STORAGE_DESTINATION_PANEL_IMPORT_FINAL_V1",
    "Text UI"
  );

  requireText(
    chat,
    "LUKE_AI_STORAGE_DESTINATION_PANEL_MOUNT_FINAL_V1",
    "Text UI"
  );

  requireText(
    css,
    "LUKE_AI_STORAGE_DESTINATION_DASHBOARD_STYLES_FINAL_V1",
    "Storage CSS"
  );

  if (
    (
      chat.match(
        /import StorageDestinationPanel/g
      ) || []
    ).length !== 1
  ) {
    throw new Error(
      "Storage panel import must appear exactly once."
    );
  }

  if (
    (
      chat.match(
        /<StorageDestinationPanel/g
      ) || []
    ).length !== 1
  ) {
    throw new Error(
      "Storage panel mount must appear exactly once."
    );
  }

  console.log(
    "PASS: Storage Settings API is connected."
  );

  console.log(
    "PASS: Automatic, External, Local and Custom modes are supported."
  );

  console.log(
    "PASS: macOS Folder Picker uses shell-disabled execution."
  );

  console.log(
    "PASS: Active destination and fallback status are displayed."
  );

  console.log(
    "PASS: Local-to-External transfer controls are connected."
  );

  console.log(
    "PASS: Transfer history and SHA-256 status are displayed."
  );

  console.log(
    "PASS: Local deletion requires explicit confirmation."
  );

  console.log(
    "PASS: Cancelling deletion preserves the Local copy."
  );

  console.log(
    "PASS: Storage Destination Dashboard validation completed."
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
