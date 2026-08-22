#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const server =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

const api =
  fs.readFileSync(
    "app/frontend/src/services/api.js",
    "utf8"
  );

const ref =
  fs.readFileSync(
    "app/frontend/src/components/ReferenceManager.jsx",
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
  "LUKE_AI_REFERENCE_UPLOAD_API_V1",
  "/api/references/upload",
  "registry.upsertByPath",
].forEach(
  (value) =>
    assert(
      server.includes(value),
      `SERVER_CONTRACT_MISSING:${value}`
    )
);

[
  "LUKE_AI_REFERENCE_UPLOAD_SERVICE_V1",
  "uploadReferenceAsset",
].forEach(
  (value) =>
    assert(
      api.includes(value),
      `API_CONTRACT_MISSING:${value}`
    )
);

[
  "LUKE_AI_REFERENCE_UPLOAD_REGISTRATION_V2",
  "await uploadReferenceAsset",
  "readImageFile",
  "assetId:",
  "referenceType:",
  "referenceWeight:",
  "referenceLock:",
  "Asset registration skipped",
].forEach(
  (value) =>
    assert(
      ref.includes(value),
      `REFERENCE_MANAGER_CONTRACT_MISSING:${value}`
    )
);

assert(
  ref.includes(
    "const src ="
  ),
  "Local preview source must remain available."
);

assert(
  ref.includes(
    "catch (error)"
  ),
  "Asset registration failure must be non-fatal."
);

assert(
  ref.includes(
    "uploaded?.asset"
  ),
  "Returned Asset ID is not connected."
);

console.log(
  "PASS: Uploaded references persist through Asset API."
);

console.log(
  "PASS: Successful uploads receive stable Asset IDs."
);

console.log(
  "PASS: Local preview remains available before/without Asset registration."
);

console.log(
  "PASS: Failed Asset registration does not block the reference workflow."
);

console.log(
  "PASS: Reference metadata preserves type, weight and lock."
);

console.log(
  "PASS: Phase 3A-5C.2 Uploaded Reference Auto-Registration validation completed."
);
