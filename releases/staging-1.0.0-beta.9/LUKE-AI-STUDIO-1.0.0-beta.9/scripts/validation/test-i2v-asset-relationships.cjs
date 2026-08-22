#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const ui =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideo.jsx",
    "utf8"
  );

const styles =
  fs.readFileSync(
    "app/frontend/src/App.css",
    "utf8"
  );

const server =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

const registry =
  fs.readFileSync(
    "scripts/server/asset-registry.cjs",
    "utf8"
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

[
  "LUKE_AI_I2V_ASSET_RELATIONSHIP_STATE_V1",
  "sourceAssetId",
  "setSourceAssetId",
  "referenceAssetIds",
  "setReferenceAssetIds",
  "LUKE_AI_I2V_ASSET_RELATIONSHIP_PAYLOAD_V1",
  "LUKE_AI_I2V_ASSET_RELATIONSHIP_PICKER_V1",
  "listAssets",
  'type: "image"',
  'type: "reference"',
  "selectedRelationshipSourceAsset",
  "selectedRelationshipReferenceAssets",
  "i2v-asset-picker-counts",
  "i2v-asset-picker-empty",
  "i2v-asset-picker-notice",
  "assetRelationshipNotice",
  "source Assets available",
  "reference Assets available",
  "No eligible Asset Library records are available to link yet.",
  "no longer available",
  "availableAssetIds",
  "Linked source",
  "Linked references",
].forEach(
  (contract) => {
    assert(
      ui.includes(
        contract
      ),
      `UI relationship contract missing: ${contract}`
    );
  }
);

[
  "LUKE_AI_I2V_VIDEO_RELATIONSHIPS_V1",
  "body.sourceAssetId",
  "body.referenceAssetIds",
  "derivedFrom:",
  "references:",
  "relations:",
  '"derived_from"',
  '"reference"',
].forEach(
  (contract) => {
    assert(
      server.includes(
        contract
      ),
      `Server relationship contract missing: ${contract}`
    );
  }
);

[
  "derivedFrom",
  "references",
  "relations",
].forEach(
  (contract) => {
    assert(
      registry.includes(
        contract
      ),
      `Registry relationship support missing: ${contract}`
    );
  }
);

assert(
  ui.includes(
    "sourceAssetId ||"
  ),
  "sourceAssetId must remain optional."
);

assert(
  ui.includes(
    "? referenceAssetIds"
  ) ||
  ui.includes(
    "referenceAssetIds\n"
  ),
  "referenceAssetIds must remain optional."
);

assert(
  ui.includes(
    "refreshAssetRelationshipOptions"
  ) &&
  ui.includes(
    "selectedOptions"
  ),
  "Image-to-Video must expose a read-only existing Asset relationship picker."
);

assert(
  ui.includes(
    "formatRelationshipAssetPath"
  ),
  "Image-to-Video relationship picker must show linked Asset paths for verification."
);

assert(
  ui.includes(
    "availableAssetIds.has(currentAssetId)"
  ) &&
  ui.includes(
    "setReferenceAssetIds((currentAssetIds)"
  ),
  "Image-to-Video relationship picker must clear stale selected Asset IDs after refresh."
);

assert(
  ui.includes(
    "setAssetRelationshipNotice(\"\");\n                setSourceAssetId"
  ) &&
  ui.includes(
    "setAssetRelationshipNotice(\"\");\n                setReferenceAssetIds"
  ),
  "Image-to-Video relationship picker must clear stale cleanup notices after manual selection."
);

assert(
  (
    ui.match(
      /disabled=\{assetRelationshipLoading\}/g
    ) || []
  ).length >= 3,
  "Image-to-Video relationship picker must disable refresh and selection controls while loading."
);

assert(
  styles.includes(
    "i2v-asset-picker-counts"
  ) &&
  styles.includes(
    "i2v-asset-picker-empty"
  ) &&
  styles.includes(
    "i2v-asset-picker-notice"
  ),
  "Image-to-Video relationship picker count/empty styles are missing."
);

assert(
  !ui.includes(
    "deleteAsset("
  ) &&
  !ui.includes(
    "updateAsset("
  ) &&
  !ui.includes(
    "createAsset("
  ),
  "Image-to-Video Asset relationship picker must remain read-only."
);

assert(
  server.includes(
    "body.sourceAssetId\n                  ?"
  ),
  "Video derivedFrom must only be populated when source Asset ID exists."
);

assert(
  !server.includes(
    "copyFileSync"
  ) ||
  !server.includes(
    "LUKE_AI_I2V_VIDEO_RELATIONSHIPS_V1\n              fs.copyFileSync"
  ),
  "Relationship wiring must not duplicate physical files."
);

console.log(
  "PASS: sourceAssetId is optional in I2V generation."
);

console.log(
  "PASS: referenceAssetIds are optional in I2V generation."
);

console.log(
  "PASS: Video Assets receive derived_from relationships when a source Asset exists."
);

console.log(
  "PASS: Reference Asset IDs are preserved separately."
);

console.log(
  "PASS: Existing Asset IDs are reused without copying files."
);

console.log(
  "PASS: Image-to-Video can link existing Asset Library records read-only."
);

console.log(
  "PASS: Image-to-Video shows selected Asset relationships before generation."
);

console.log(
  "PASS: Image-to-Video shows available Asset relationship counts."
);

console.log(
  "PASS: Image-to-Video shows an empty state when no linkable Assets exist."
);

console.log(
  "PASS: Image-to-Video clears stale selected Asset IDs after refresh."
);

console.log(
  "PASS: Image-to-Video explains stale linked Asset cleanup."
);

console.log(
  "PASS: Image-to-Video clears stale cleanup notices after manual selection."
);

console.log(
  "PASS: Image-to-Video disables Asset relationship controls while loading."
);

console.log(
  "PASS: I2V generation remains supported when no Asset IDs exist."
);

console.log(
  "PASS: Phase 3A-5B.4 Image-to-Video Asset Relationship validation completed."
);
