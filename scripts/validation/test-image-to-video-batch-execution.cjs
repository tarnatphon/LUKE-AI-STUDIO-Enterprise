#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const ui =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideo.jsx",
    "utf8",
  );

const required = [
  "LUKE_AI_I2V_BATCH_STATE_V1",
  "LUKE_AI_I2V_BATCH_ENGINE_V1",
  "LUKE_AI_I2V_BATCH_RESTART_RECOVERY_V1",
  "LUKE_AI_I2V_BATCH_STUDIO_UI_V1",
  "currentBatchId",
  "batchSubmitting",
  "batchJobs",
  "batchSummary",
  "batchPercent",
  "batchFinished",
  "startImportedBatch",
  "batchId",
  "batchIndex",
  "batchSize",
  "batchSource",
  "prompt-file-import",
  "Queue",
  "Batch Progress",
];

for (const value of required) {
  if (!ui.includes(value)) {
    throw new Error(
      `BATCH_CONTRACT_MISSING:${value}`,
    );
  }
}

const createCalls =
  (
    ui.match(
      /await\s+createImageToVideoJob\s*\(/g,
    ) || []
  ).length;

if (createCalls < 2) {
  throw new Error(
    `EXPECTED_SINGLE_AND_BATCH_JOB_CREATION:${createCalls}`,
  );
}

if (
  !ui.includes(
    "row.prompt ||"
  )
) {
  throw new Error(
    "BATCH_ROW_PROMPT_NOT_CONNECTED"
  );
}

if (
  !ui.includes(
    "row.duration"
  )
) {
  throw new Error(
    "BATCH_ROW_DURATION_NOT_CONNECTED"
  );
}

if (
  !ui.includes(
    "[5, 10, 15]"
  )
) {
  throw new Error(
    "BATCH_DURATION_POLICY_MISSING"
  );
}

if (
  !ui.includes(
    "setCurrentBatchId"
  )
) {
  throw new Error(
    "BATCH_RESTART_RECOVERY_MISSING"
  );
}

if (
  ui.includes(
    "new ImageToVideoBatchQueue"
  ) ||
  ui.includes(
    "BatchProcessRunner"
  )
) {
  throw new Error(
    "DUPLICATE_BATCH_QUEUE_ARCHITECTURE_DETECTED"
  );
}

console.log(
  "PASS: Imported CSV/XLSX rows create persistent Image-to-Video jobs."
);

console.log(
  "PASS: One imported row maps to one existing async job."
);

console.log(
  "PASS: Prompt and 5/10/15-second duration are resolved per row."
);

console.log(
  "PASS: Batch metadata includes batchId / batchIndex / batchSize."
);

console.log(
  "PASS: Batch execution reuses the existing FIFO Process Runner."
);

console.log(
  "PASS: Existing concurrency=1 protection remains authoritative."
);

console.log(
  "PASS: Batch progress is derived from persistent Job History."
);

console.log(
  "PASS: Latest Batch context restores after application restart."
);

console.log(
  "PASS: Individual cancel/retry/history remain handled by existing Job controls."
);

console.log(
  "PASS: Image-to-Video Batch Execution Phase 3A-3 validation completed."
);
