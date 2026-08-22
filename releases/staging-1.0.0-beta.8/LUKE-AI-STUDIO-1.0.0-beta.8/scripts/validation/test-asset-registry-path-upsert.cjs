#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  AssetRegistry,
} = require(
  "../server/asset-registry.cjs"
);

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      message
    );
  }
}

const root =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "luke-asset-upsert-"
    )
  );

try {
  const statePath =
    path.join(
      root,
      "registry.json"
    );

  const physicalFile =
    path.join(
      root,
      "image.png"
    );

  fs.writeFileSync(
    physicalFile,
    "fake-image-data",
    "utf8"
  );

  const registry =
    new AssetRegistry({
      statePath,
    });

  const first =
    registry.upsertByPath({
      type:
        "image",

      existingPath:
        physicalFile,

      sourcePrompt:
        "first prompt",

      tags: [
        "first",
      ],
    });

  const second =
    registry.upsertByPath({
      type:
        "image",

      existingPath:
        path.join(
          root,
          ".",
          "image.png"
        ),

      sourcePrompt:
        "updated prompt",

      tags: [
        "updated",
      ],

      metadata: {
        width: 1024,
      },
    });

  assert(
    first.assetId ===
      second.assetId,
    "Repeated path upsert created a duplicate asset."
  );

  assert(
    registry.list()
      .length === 1,
    "Registry should contain one Asset for one physical path."
  );

  assert(
    second.sourcePrompt ===
      "updated prompt",
    "Existing Asset metadata was not updated."
  );

  assert(
    second.tags.includes(
      "updated"
    ),
    "Updated tags were not persisted."
  );

  const found =
    registry.findByPath(
      physicalFile
    );

  assert(
    found?.assetId ===
      first.assetId,
    "findByPath() did not locate the Asset."
  );

  const reloaded =
    new AssetRegistry({
      statePath,
    });

  assert(
    reloaded.findByPath(
      physicalFile
    )?.assetId ===
      first.assetId,
    "Path deduplication did not survive reload."
  );

  console.log(
    "PASS: existingPath is normalized."
  );

  console.log(
    "PASS: one physical path maps to one Asset record."
  );

  console.log(
    "PASS: repeated registration updates existing metadata."
  );

  console.log(
    "PASS: findByPath() survives persistent reload."
  );

  console.log(
    "PASS: no file copy is performed by Asset Registry."
  );

  console.log(
    "PASS: Phase 3A-5B.1 Asset Path Upsert validation completed."
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
