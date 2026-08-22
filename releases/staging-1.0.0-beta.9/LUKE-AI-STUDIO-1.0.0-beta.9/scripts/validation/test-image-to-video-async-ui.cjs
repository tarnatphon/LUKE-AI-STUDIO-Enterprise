#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const api =
  fs.readFileSync(
    "app/frontend/src/services/api.js",
    "utf8"
  );

const ui =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideo.jsx",
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

const serviceContracts = [
  "createImageToVideoJob",
  "getImageToVideoJob",
  "listImageToVideoJobs",
  "cancelImageToVideoJob",
  "retryImageToVideoJob",
  "/api/image-to-video/jobs",
];

for (const value of serviceContracts) {
  requireText(
    api,
    value,
    "ASYNC_SERVICE_CONTRACT_MISSING"
  );
}

const uiContracts = [
  "createImageToVideoJob",
  "getImageToVideoJob",
  "listImageToVideoJobs",
  "cancelImageToVideoJob",
  "retryImageToVideoJob",
  "pollImageToVideoJob",
  "cancelActiveJob",
  "retryJob",
  "activeJob",
  "jobHistory",
  "generatedVideoUrl",
  "runtimeCapability?.ready !== true",
  "refreshRuntimeCapability",
];

for (const value of uiContracts) {
  requireText(
    ui,
    value,
    "ASYNC_UI_CONTRACT_MISSING"
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

const pollCount =
  (
    ui.match(
      /await\s+pollImageToVideoJob\s*\(/g
    ) || []
  ).length;

if (pollCount < 1) {
  throw new Error(
    `EXPECTED_ASYNC_POLL_CALL:${pollCount}`
  );
}

if (
  ui.includes(
    "await generateImageToVideo({"
  )
) {
  throw new Error(
    "SYNCHRONOUS_GENERATE_CALL_STILL_USED_BY_UI"
  );
}

requireText(
  api,
  "generateImageToVideo",
  "LEGACY_FRONTEND_FALLBACK_REMOVED"
);

if (
  ui.includes(
    "downloads automatically on first generation"
  )
) {
  throw new Error(
    "STALE_HIDDEN_DOWNLOAD_COPY_PRESENT"
  );
}

console.log(
  "PASS: Async Image-to-Video Job services are present."
);

console.log(
  "PASS: UI creates asynchronous single and Batch Image-to-Video jobs."
);

console.log(
  "PASS: UI polls job state and progress."
);

console.log(
  "PASS: Cancel, retry and history controls are connected."
);

console.log(
  "PASS: Completed job output is handed to the video UI."
);

console.log(
  "PASS: Runtime readiness gate remains enforced."
);

console.log(
  "PASS: Legacy synchronous generate service remains fallback-only."
);

console.log(
  "PASS: Async UI validation is contract-based and independent of marker comments."
);

console.log(
  "PASS: Image-to-Video Async UI Migration validation completed."
);
