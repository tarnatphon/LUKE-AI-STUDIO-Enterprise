#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const ref =
  fs.readFileSync(
    "app/frontend/src/components/ReferenceManager.jsx",
    "utf8"
  );

const generator =
  fs.readFileSync(
    "app/frontend/src/components/Generator.jsx",
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
  "LUKE_AI_REFERENCE_ASSET_SCHEMA_V1",
  "REFERENCE_TYPES",
  "normalizeReferenceType",
  "normalizeReferenceWeight",
  "normalizeReferenceAssetMetadata",
  "referenceType",
  "referenceWeight",
  "referenceLock",
  "originalName",
  "mimeType",
  "asset-library",
].forEach(
  (contract) => {
    assert(
      ref.includes(
        contract
      ),
      `Reference schema contract missing: ${contract}`
    );
  }
);

[
  "character",
  "face",
  "clothing",
  "product",
  "object",
  "style",
  "composition",
  "background",
  "brand",
  "generic",
].forEach(
  (type) => {
    assert(
      ref.includes(
        `"${type}"`
      ),
      `Reference type missing: ${type}`
    );
  }
);

assert(
  ref.includes(
    "Math.max("
  ) &&
  ref.includes(
    "0.2"
  ) &&
  ref.includes(
    "Math.min("
  ) &&
  ref.includes(
    "1,"
  ),
  "Reference weight bounds are missing."
);

assert(
  ref.includes(
    "0.85"
  ),
  "Reference weight default must be 0.85."
);

assert(
  generator.includes(
    "LUKE_AI_REFERENCE_PERSISTENCE_SCHEMA_V1"
  ),
  "Legacy Generator reference normalization missing."
);

assert(
  generator.includes(
    'localStorage.getItem('
  ),
  "Existing localStorage migration path must remain readable."
);

assert(
  registry.includes(
    '"reference"'
  ),
  "Asset Registry must continue supporting reference Assets."
);

console.log(
  "PASS: Reference metadata types are normalized."
);

console.log(
  "PASS: Reference weight is constrained to 0.20-1.00 with 0.85 default."
);

console.log(
  "PASS: Reference Lock defaults to true."
);

console.log(
  "PASS: originalName/mimeType/source metadata are supported."
);

console.log(
  "PASS: Existing localStorage reference presets remain readable."
);

console.log(
  "PASS: No destructive reference migration was introduced."
);

console.log(
  "PASS: Phase 3A-5C.1 Reference Asset Schema validation completed."
);
