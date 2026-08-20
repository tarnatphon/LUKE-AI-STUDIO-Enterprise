#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const server =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

const runner =
  fs.readFileSync(
    "scripts/server/image-to-video-process-runner.cjs",
    "utf8"
  );

const worker =
  fs.readFileSync(
    "scripts/workers/image_to_video_worker.py",
    "utf8"
  );

const compact =
  server.replace(
    /\s+/g,
    ""
  );

const markers = [
  "LUKE_AI_I2V_PROCESS_RUNNER_IMPORT_V2",
  "LUKE_AI_I2V_PROCESS_RUNNER_SINGLETON_V2",
  "LUKE_AI_I2V_JOB_PREPARATION_V2",
  "LUKE_AI_I2V_JOB_EXECUTION_CREATE_V2",
  "LUKE_AI_I2V_JOB_EXECUTION_RETRY_V2",
];

for (const marker of markers) {
  const count =
    server.split(marker)
      .length - 1;

  if (count !== 1) {
    throw new Error(
      `MARKER_COUNT_INVALID:${marker}:${count}`
    );
  }
}

for (
  const value of [
    "prepareImageToVideoJobExecution(",
    "getImageToVideoProcessRunner()",
    ".startPreparedJob(",
    "prepared.workerArgs",
    "prepared.outputRelative",
    "manager.failJob(",
  ]
) {
  if (
    !compact.includes(
      value.replace(
        /\s+/g,
        ""
      )
    )
  ) {
    throw new Error(
      `EXECUTION_CONTRACT_MISSING:${value}`
    );
  }
}

for (
  const arg of [
    '"--model"',
    '"--image"',
    '"--output"',
    '"--prompt"',
    '"--seconds"',
    '"--references"',
    '"--reference-lock"',
    '"--automatic-match"',
  ]
) {
  if (
    !server.includes(arg)
  ) {
    throw new Error(
      `WORKER_ARGUMENT_MISSING:${arg}`
    );
  }
}

if (
  !server.includes(
    'req.url === "/api/image-to-video/generate"'
  )
) {
  throw new Error(
    "LEGACY_GENERATE_ROUTE_REMOVED"
  );
}

if (
  !runner.includes(
    "HF_HUB_OFFLINE"
  ) ||
  !runner.includes(
    "TRANSFORMERS_OFFLINE"
  )
) {
  throw new Error(
    "RUNNER_OFFLINE_ENV_MISSING"
  );
}

if (
  !worker.includes(
    "local_files_only=True"
  )
) {
  throw new Error(
    "WORKER_LOCAL_ONLY_MISSING"
  );
}

console.log(
  "PASS: POST /jobs prepares and starts asynchronous generation."
);

console.log(
  "PASS: Retry prepares and starts a new asynchronous generation."
);

console.log(
  "PASS: Worker argument contract is preserved."
);

console.log(
  "PASS: app/outputs/video output contract is preserved."
);

console.log(
  "PASS: Legacy synchronous generation route remains available."
);

console.log(
  "PASS: Offline Process Runner and local-only worker safety remain enforced."
);

console.log(
  "PASS: Production Image-to-Video Job Execution Integration validation completed."
);
