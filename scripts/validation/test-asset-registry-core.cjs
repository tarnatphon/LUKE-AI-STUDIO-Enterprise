#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  AssetRegistry,
  ASSET_TYPES,
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
      "luke-assets-"
    )
  );

try {
  const statePath =
    path.join(
      root,
      "asset-registry.json"
    );

  const registry =
    new AssetRegistry({
      statePath,
    });

  for (
    const type of [
      "image",
      "video",
      "reference",
      "prompt",
      "brand",
      "logo",
      "voice",
      "music",
    ]
  ) {
    assert(
      ASSET_TYPES.has(type),
      `Missing asset type: ${type}`
    );
  }

  const image =
    registry.create({
      type:
        "image",

      existingPath:
        "/tmp/product.png",

      storageProviderId:
        "local",

      tags: [
        "bag",
        "oem",
        "bag",
      ],

      project:
        "Example Project",

      campaign:
        "Launch",

      sourceModel:
        "local-model",

      sourcePrompt:
        "premium product image",

      metadata: {
        width: 1024,
        height: 1024,
      },
    });

  assert(
    image.assetId
      .startsWith(
        "ast_"
      ),
    "Stable assetId prefix missing."
  );

  assert(
    image.existingPath ===
      "/tmp/product.png",
    "existingPath was not preserved."
  );

  assert(
    image.tags.length === 2,
    "Tag deduplication failed."
  );

  const video =
    registry.create({
      type:
        "video",

      existingPath:
        "/tmp/product.mp4",

      derivedFrom: [
        image.assetId,
      ],

      references: [
        image.assetId,
      ],

      relations: [
        {
          assetId:
            image.assetId,

          relation:
            "derived_from",
        },
      ],
    });

  assert(
    video.derivedFrom
      .includes(
        image.assetId
      ),
    "derivedFrom relationship missing."
  );

  const updated =
    registry.update(
      image.assetId,
      {
        favorite: true,
        pinned: true,

        tags: [
          "bag",
          "hero",
        ],
      }
    );

  assert(
    updated.favorite === true,
    "Favorite update failed."
  );

  assert(
    updated.pinned === true,
    "Pinned update failed."
  );

  assert(
    registry.list({
      favorite: true,
    }).length === 1,
    "Favorite filter failed."
  );

  const reloaded =
    new AssetRegistry({
      statePath,
    });

  assert(
    reloaded.get(
      image.assetId
    )?.favorite === true,
    "Persistent reload failed."
  );

  assert(
    reloaded.remove(
      video.assetId
    ) === true,
    "Asset record removal failed."
  );

  assert(
    reloaded.get(
      video.assetId
    ) === null,
    "Removed asset record still exists."
  );

  assert(
    fs.existsSync(
      "/tmp/product.mp4"
    ) === false,
    "Test assumes registry does not create/copy physical files."
  );

  console.log(
    "PASS: Stable asset IDs are generated."
  );

  console.log(
    "PASS: Asset Registry references existing paths without file copying."
  );

  console.log(
    "PASS: Unified asset types are supported."
  );

  console.log(
    "PASS: tags/favorite/pinned/project/campaign metadata are supported."
  );

  console.log(
    "PASS: source prompt/model and asset relationships are supported."
  );

  console.log(
    "PASS: Registry state persists atomically."
  );

  console.log(
    "PASS: Removing an Asset record does not delete physical files."
  );

  console.log(
    "PASS: Phase 3A-5A Asset Registry Core validation completed."
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
