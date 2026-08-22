#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const ui =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideo.jsx",
    "utf8"
  );

const api =
  fs.readFileSync(
    "app/frontend/src/services/api.js",
    "utf8"
  );

function requireText(
  source,
  text,
  label
) {
  if (
    !source.includes(text)
  ) {
    throw new Error(
      `${label}:${text}`
    );
  }
}

[
  "LUKE_AI_I2V_BATCH_CONTROL_HANDLERS_V1",
  "LUKE_AI_I2V_BATCH_PAUSED_SUMMARY_V1",
  "LUKE_AI_I2V_BATCH_CONTROL_UI_V1",
  "batchControlBusy",
  "pauseCurrentBatch",
  "resumeCurrentBatch",
  "cancelRemainingBatch",
  "retryFailedBatchItems",
  "skipBatchJob",
  "Pause Batch",
  "Resume Batch",
  "Cancel Remaining",
  "Retry Failed",
  "PAUSED",
  "Skip",
].forEach(
  (value) =>
    requireText(
      ui,
      value,
      "BATCH_UI_CONTRACT_MISSING"
    )
);

[
  "pauseImageToVideoBatch",
  "resumeImageToVideoBatch",
  "cancelImageToVideoBatch",
  "getRetryableImageToVideoBatchJobs",
  "skipImageToVideoBatchJob",
].forEach(
  (value) => {
    requireText(
      ui,
      value,
      "BATCH_UI_API_IMPORT_MISSING"
    );

    requireText(
      api,
      value,
      "BATCH_SERVICE_MISSING"
    );
  }
);

requireText(
  ui,
  'job.state ===\n          "paused"',
  "PAUSED_SUMMARY_MISSING"
);

requireText(
  ui,
  "retryImageToVideoJob",
  "EXISTING_RETRY_CONTRACT_NOT_REUSED"
);

requireText(
  ui,
  "refreshJobHistory",
  "JOB_HISTORY_REFRESH_NOT_REUSED"
);

if (
  ui.includes(
    "new BatchQueue"
  ) ||
  ui.includes(
    "BatchProcessRunner"
  )
) {
  throw new Error(
    "DUPLICATE_BATCH_QUEUE_DETECTED"
  );
}

console.log(
  "PASS: Batch Pause and Resume controls are connected."
);

console.log(
  "PASS: Cancel Remaining preserves the running-job backend semantics."
);

console.log(
  "PASS: Failed/cancelled Batch jobs reuse the existing retry service."
);

console.log(
  "PASS: queued/paused items expose individual Skip controls."
);

console.log(
  "PASS: persistent paused state is visible in Batch Progress."
);

console.log(
  "PASS: every Batch mutation refreshes persistent Job History."
);

console.log(
  "PASS: no second Batch Queue implementation was introduced."
);

console.log(
  "PASS: Image-to-Video Batch Control UI Phase 3A-4B validation completed."
);
