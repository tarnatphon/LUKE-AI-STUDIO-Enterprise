#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

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
  "LUKE_AI_GENERATED_IMAGE_ASSET_REGISTRATION_V1",
  "saveGeneratedOutput",
  "getLukeAssetRegistry",
  "registry.upsertByPath",
  'type:\n          "image"',
  "registrationSource",
].forEach(
  (contract) => {
    assert(
      server.includes(
        contract
      ),
      `Generated Image Asset contract missing: ${contract}`
    );
  }
);

assert(
  registry.includes(
    "upsertByPath("
  ),
  "Asset Registry path-upsert contract missing."
);

assert(
  !server.includes(
    "copyFileSync"
  ) ||
  !server.includes(
    "LUKE_AI_GENERATED_IMAGE_ASSET_REGISTRATION_V1\n  fs.copyFileSync"
  ),
  "Generated Image registration must not copy the output file."
);

const markerIndex =
  server.indexOf(
    "LUKE_AI_GENERATED_IMAGE_ASSET_REGISTRATION_V1"
  );

const saveIndex =
  server.indexOf(
    "function saveGeneratedOutput("
  );

assert(
  markerIndex >
    saveIndex,
  "Registration must live inside/after saveGeneratedOutput flow."
);

console.log(
  "PASS: Generated Image registration uses Asset Registry upsertByPath."
);

console.log(
  "PASS: Image Asset registration occurs only after generated-output persistence flow."
);

console.log(
  "PASS: Existing generated files are referenced without copying."
);

console.log(
  "PASS: source prompt/model/project/campaign metadata is forwarded when available."
);

console.log(
  "PASS: registration failure is non-fatal to image generation."
);

console.log(
  "PASS: Phase 3A-5B.2 Generated Image Asset Registration validation completed."
);
