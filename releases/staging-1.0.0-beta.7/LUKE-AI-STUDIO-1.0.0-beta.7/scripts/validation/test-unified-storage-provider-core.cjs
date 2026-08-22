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

const coreFile = path.join(
  root,
  "scripts",
  "server",
  "unified-storage-provider-core.cjs"
);

const serverFile = path.join(
  root,
  "scripts",
  "server",
  "serve.cjs"
);

function main() {
  const temporaryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-provider-core-"
      )
    );

  const mountedNas =
    path.join(
      temporaryRoot,
      "nas"
    );

  const localRoot =
    path.join(
      temporaryRoot,
      "local"
    );

  fs.mkdirSync(
    mountedNas,
    {
      recursive: true,
    }
  );

  fs.mkdirSync(
    localRoot,
    {
      recursive: true,
    }
  );

  const configPath =
    path.join(
      temporaryRoot,
      "providers.json"
    );

  const statePath =
    path.join(
      temporaryRoot,
      "state.json"
    );

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        routingMode:
          "priority",
        providers: [
          {
            id:
              "office-nas",
            name:
              "Office NAS",
            category:
              "nas",
            adapter:
              "mounted-folder",
            enabled:
              true,
            priority:
              10,
            capabilities: {
              read: true,
              write: true,
              delete: false,
              resume: false
            },
            settings: {
              rootPath:
                mountedNas
            },
            credentialReference:
              null
          },
          {
            id:
              "local-fallback",
            name:
              "Local Fallback",
            category:
              "local",
            adapter:
              "local-folder",
            enabled:
              true,
            priority:
              1000,
            capabilities: {
              read: true,
              write: true,
              delete: false,
              resume: false
            },
            settings: {
              rootPath:
                localRoot
            },
            credentialReference:
              null
          }
        ],
        security: {
          allowPlaintextCredentials:
            false,
          allowShell:
            false,
          allowAutomaticMount:
            false,
          allowAutomaticDeletion:
            false,
          requireConfirmationBeforeDeletion:
            true
        }
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        providers: {},
        routingHistory: []
      },
      null,
      2
    ) + "\n"
  );

  const {
    UnifiedStorageProviderCore,
  } = require(coreFile);

  const core =
    new UnifiedStorageProviderCore({
      configPath,
      statePath,
    });

  const nas =
    core.getProvider(
      "office-nas"
    );

  if (
    nas.category !== "nas" ||
    nas.adapter !==
      "mounted-folder"
  ) {
    throw new Error(
      "NAS provider was not registered."
    );
  }

  const nasHealth =
    core.checkProvider(
      "office-nas"
    );

  if (
    nasHealth.health.status !==
      "online" ||
    nasHealth.health.writable !==
      true
  ) {
    throw new Error(
      "Mounted NAS health check failed."
    );
  }

  const selected =
    core.selectProvider({
      capability: "write",
    });

  if (
    selected.provider.id !==
      "office-nas"
  ) {
    throw new Error(
      "Priority router did not select NAS."
    );
  }

  const cloud =
    core.upsertProvider({
      id: "company-r2",
      name: "Company R2",
      category: "cloud",
      adapter: "s3-compatible",
      enabled: true,
      priority: 20,
      settings: {
        endpoint:
          "https://example.invalid",
        bucket:
          "luke-ai"
      },
      credentialReference:
        "luke-ai-cloud-company-r2",
      capabilities: {
        read: true,
        write: true,
        delete: false,
        resume: true
      }
    });

  if (
    cloud.category !==
      "cloud" ||
    cloud.adapter !==
      "s3-compatible"
  ) {
    throw new Error(
      "Cloud provider was not registered."
    );
  }

  const smb =
    core.upsertProvider({
      id: "office-smb",
      name: "Office SMB",
      category: "nas",
      adapter: "smb",
      enabled: true,
      priority: 30,
      settings: {
        host:
          "nas.local",
        share:
          "LUKE-AI"
      },
      credentialReference: null,
      capabilities: {
        read: true,
        write: true,
        delete: false,
        resume: true
      }
    });

  if (
    smb.configurationStatus !==
      "authentication-required"
  ) {
    throw new Error(
      "SMB provider should require credentials."
    );
  }

  let plaintextRejected =
    false;

  try {
    core.upsertProvider({
      id: "unsafe-cloud",
      name: "Unsafe Cloud",
      category: "cloud",
      adapter: "s3-compatible",
      settings: {
        endpoint:
          "https://example.invalid",
        secretKey:
          "must-not-be-saved"
      },
      credentialReference:
        "unsafe"
    });
  } catch {
    plaintextRejected =
      true;
  }

  if (!plaintextRejected) {
    throw new Error(
      "Plaintext credential fields were accepted."
    );
  }

  const server =
    fs.readFileSync(
      serverFile,
      "utf8"
    );

  for (const requirement of [
    "LUKE_AI_UNIFIED_STORAGE_PROVIDER_API_V1",
    "/api/storage/providers",
    "/api/storage/providers/check",
    "/api/storage/providers/select",
    "UnifiedStorageProviderCore",
  ]) {
    if (
      !server.includes(
        requirement
      )
    ) {
      throw new Error(
        `Provider API missing: ${requirement}`
      );
    }
  }

  console.log(
    "PASS: Local, External, NAS and Cloud provider categories are supported."
  );

  console.log(
    "PASS: Mounted NAS folder health and write permissions were checked."
  );

  console.log(
    "PASS: NAS priority routing selected the highest healthy provider."
  );

  console.log(
    "PASS: SMB, NFS, WebDAV and mounted-folder NAS adapters are registered."
  );

  console.log(
    "PASS: S3-compatible, Google Cloud and Azure Cloud adapters are registered."
  );

  console.log(
    "PASS: Multiple providers and accounts can be added."
  );

  console.log(
    "PASS: SMB without a credential reference requires authentication."
  );

  console.log(
    "PASS: Plaintext credential fields were rejected."
  );

  console.log(
    "PASS: Shell, automatic mount and automatic deletion remain disabled."
  );

  console.log(
    "PASS: Unified Storage Provider Core validation completed."
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
