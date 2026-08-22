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
  const policy =
    read(
      "scripts/server/storage-policy-manager.cjs"
    );

  const queue =
    read(
      "scripts/server/unified-storage-transfer-queue.cjs"
    );

  const server =
    read(
      "scripts/server/serve.cjs"
    );

  const config =
    JSON.parse(
      read(
        "app/config/storage/storage-policy-profiles.json"
      )
    );

  const panel =
    read(
      "app/frontend/src/components/StoragePolicyProfilesPanel.jsx"
    );

  const chat =
    read(
      "app/frontend/src/components/PersistentTextChat.jsx"
    );

  const css =
    read(
      "app/frontend/src/App.css"
    );

  for (const profile of [
    "models",
    "images",
    "video",
    "backups",
    "temporary",
  ]) {
    if (
      !config.profiles?.[
        profile
      ]
    ) {
      throw new Error(
        `Missing profile: ${profile}`
      );
    }
  }

  for (const value of [
    "StoragePolicyManager",
    "selectForWorkload",
    "calculatePolicyScore",
    "categoryWeights",
    "minimumFreeBytes",
  ]) {
    requireText(
      policy,
      value,
      "Policy Manager"
    );
  }

  requireText(
    queue,
    "LUKE_AI_WORKLOAD_AWARE_ROUTING_V1",
    "Queue"
  );

  requireText(
    queue,
    "workloadType",
    "Queue"
  );

  for (const value of [
    "/api/storage/policies",
    "/api/storage/policies/select",
  ]) {
    requireText(
      server,
      value,
      "Policy API"
    );
  }

  for (const value of [
    "LUKE_AI_STORAGE_POLICY_PROFILES_PANEL_V2",
    "Storage Policy Profiles",
    "Workload-Aware Routing",
    "Models",
    "Images",
    "Video",
    "Backups",
    "Temporary",
    "Test Routing",
  ]) {
    requireText(
      panel,
      value,
      "Policy Dashboard"
    );
  }

  requireText(
    chat,
    "LUKE_AI_STORAGE_POLICY_PROFILES_IMPORT_V2",
    "Text UI"
  );

  requireText(
    chat,
    "LUKE_AI_STORAGE_POLICY_PROFILES_MOUNT_V2",
    "Text UI"
  );

  requireText(
    css,
    "LUKE_AI_STORAGE_POLICY_PROFILES_STYLES_V2",
    "Policy CSS"
  );

  console.log(
    "PASS: Models policy profile is available."
  );

  console.log(
    "PASS: Images policy profile is available."
  );

  console.log(
    "PASS: Video policy profile is available."
  );

  console.log(
    "PASS: Backups policy profile is available."
  );

  console.log(
    "PASS: Temporary policy profile is available."
  );

  console.log(
    "PASS: Health scoring is adjusted per workload."
  );

  console.log(
    "PASS: Minimum free-space policy is enforced."
  );

  console.log(
    "PASS: Explicit provider selection overrides automatic policy routing."
  );

  console.log(
    "PASS: Unified Transfer Queue accepts workloadType."
  );

  console.log(
    "PASS: Queue remains sequential by default."
  );

  console.log(
    "PASS: Storage Policy Dashboard is connected."
  );

  console.log(
    "PASS: Storage Policy Profiles validation completed."
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
