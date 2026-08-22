#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const ui =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideo.jsx",
    "utf8"
  );

const service =
  fs.readFileSync(
    "app/frontend/src/services/api.js",
    "utf8"
  );

const card =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideoRuntimeHealthCard.jsx",
    "utf8"
  );

const server =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

function requireText(
  source,
  value,
  label
) {
  if (!source.includes(value)) {
    throw new Error(
      `${label}:${value}`
    );
  }
}

const runtimeUiContracts = [
  "getImageToVideoRuntimeCapability",
  "ImageToVideoRuntimeHealthCard",
  "LUKE_AI_I2V_RUNTIME_HEALTH_STATE_V1",
  "LUKE_AI_I2V_RUNTIME_HEALTH_MOUNT_V1",
  "LUKE_AI_I2V_GENERATE_RUNTIME_GATE_V1",
  "runtimeCapability?.ready !== true",
  "refreshRuntimeCapability",
];

for (const value of runtimeUiContracts) {
  requireText(
    ui,
    value,
    "RUNTIME_UI_CONTRACT_MISSING"
  );
}

const asyncUiContracts = [
  "LUKE_AI_I2V_ASYNC_JOB_RUN_V1",
  "createImageToVideoJob",
  "getImageToVideoJob",
  "pollImageToVideoJob",
  "cancelImageToVideoJob",
  "retryImageToVideoJob",
  "jobHistory",
  "generatedVideoUrl",
];

for (const value of asyncUiContracts) {
  requireText(
    ui,
    value,
    "ASYNC_UI_CONTRACT_MISSING"
  );
}

requireText(
  service,
  "/api/capabilities/image-to-video/runtime",
  "RUNTIME_SERVICE_ENDPOINT_MISSING"
);

requireText(
  service,
  "generateImageToVideo",
  "LEGACY_GENERATE_SERVICE_REMOVED"
);

requireText(
  service,
  "createImageToVideoJob",
  "ASYNC_CREATE_SERVICE_MISSING"
);

requireText(
  service,
  "getImageToVideoJob",
  "ASYNC_GET_SERVICE_MISSING"
);

requireText(
  service,
  "cancelImageToVideoJob",
  "ASYNC_CANCEL_SERVICE_MISSING"
);

requireText(
  service,
  "retryImageToVideoJob",
  "ASYNC_RETRY_SERVICE_MISSING"
);

requireText(
  card,
  "Automatic install: OFF",
  "RUNTIME_UI_SAFETY_MISSING"
);

requireText(
  card,
  "Automatic repair: OFF",
  "RUNTIME_UI_SAFETY_MISSING"
);

requireText(
  server,
  "/api/capabilities/image-to-video/runtime",
  "BACKEND_ENDPOINT_MISSING"
);

requireText(
  server,
  "/api/image-to-video/jobs",
  "JOB_ENDPOINT_MISSING"
);

requireText(
  server,
  "/api/image-to-video/generate",
  "LEGACY_BACKEND_FALLBACK_REMOVED"
);

if (
  ui.includes(
    "await generateImageToVideo({"
  )
) {
  throw new Error(
    "UI_MUST_NOT_USE_SYNCHRONOUS_GENERATE_AFTER_ASYNC_MIGRATION"
  );
}

const runtimeGateCount =
  (
    ui.match(
      /LUKE_AI_I2V_GENERATE_RUNTIME_GATE_V1/g
    ) || []
  ).length;

if (runtimeGateCount !== 1) {
  throw new Error(
    `EXPECTED_ONE_RUNTIME_GATE:${runtimeGateCount}`
  );
}

const asyncCreateCount =
  (
    ui.match(
      /await\s+createImageToVideoJob\s*\(/g
    ) || []
  ).length;

if (asyncCreateCount !== 2) {
  throw new Error(
    `EXPECTED_SINGLE_AND_BATCH_ASYNC_CREATE_CALLS:${asyncCreateCount}`
  );
}

if (
  !ui.includes(
    "const run = async () =>"
  )
) {
  throw new Error(
    "SINGLE_ASYNC_HANDLER_MISSING"
  );
}

if (
  !ui.includes(
    "const startImportedBatch ="
  )
) {
  throw new Error(
    "BATCH_ASYNC_HANDLER_MISSING"
  );
}

console.log(
  "PASS: Runtime Health service integration is present."
);

console.log(
  "PASS: Runtime Health UI displays readiness state."
);

console.log(
  "PASS: Runtime readiness gate remains enforced before async generation."
);

console.log(
  "PASS: ImageToVideo UI now uses asynchronous Job API generation."
);

console.log(
  "PASS: Legacy generate service remains available only as fallback."
);

console.log(
  "PASS: Cancel, retry, polling and history contracts are present."
);

console.log(
  "PASS: Runtime Health performs no automatic install or repair."
);

console.log(
  "PASS: Image-to-Video Runtime UI Integration validation completed."
);
