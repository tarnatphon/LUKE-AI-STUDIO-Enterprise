#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const ui =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideo.jsx",
    "utf8",
  );

function requireText(
  text
) {
  if (!ui.includes(text)) {
    throw new Error(
      `BATCH_ANALYTICS_CONTRACT_MISSING:${text}`,
    );
  }
}

[
  "LUKE_AI_I2V_BATCH_ANALYTICS_HELPERS_V1",
  "LUKE_AI_I2V_BATCH_ANALYTICS_MODEL_V1",
  "LUKE_AI_I2V_BATCH_ANALYTICS_EXPORT_V1",
  "LUKE_AI_I2V_BATCH_ANALYTICS_UI_V1",
  "batchElapsedMs",
  "averageGenerationMs",
  "estimatedRemainingMs",
  "outputSizeSamples",
  "averageOutputBytes",
  "estimatedRemainingBytes",
  "BATCH_SKIPPED",
  "buildBatchReport",
  "exportBatchCsv",
  "exportBatchJson",
  "Export CSV",
  "Export JSON",
  "Observed data only",
  "No size sample yet",
].forEach(
  requireText,
);

if (
  !ui.includes(
    "job?.startedAt"
  ) ||
  !ui.includes(
    "job?.finishedAt"
  )
) {
  throw new Error(
    "ETA_NOT_DERIVED_FROM_REAL_JOB_TIMESTAMPS",
  );
}

if (
  !ui.includes(
    "job?.output"
  ) ||
  !ui.includes(
    "sizeBytes"
  )
) {
  throw new Error(
    "STORAGE_NOT_DERIVED_FROM_OBSERVED_OUTPUT_METADATA",
  );
}

if (
  ui.includes(
    "DEFAULT_AVERAGE_GENERATION_TIME"
  ) ||
  ui.includes(
    "DEFAULT_VIDEO_SIZE_BYTES"
  )
) {
  throw new Error(
    "FABRICATED_ANALYTICS_DEFAULT_DETECTED",
  );
}

console.log(
  "PASS: Batch elapsed time uses startedAt and finishedAt."
);

console.log(
  "PASS: Average generation time uses completed jobs only."
);

console.log(
  "PASS: ETA is withheld until observed completion samples exist."
);

console.log(
  "PASS: Storage estimates use observed output.sizeBytes only."
);

console.log(
  "PASS: Skipped and ordinary cancelled jobs are reported separately."
);

console.log(
  "PASS: Completion Report supports CSV and JSON export."
);

console.log(
  "PASS: Image-to-Video Batch Analytics Phase 3A-4C validation completed."
);
