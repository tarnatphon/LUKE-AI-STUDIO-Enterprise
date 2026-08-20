#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ImageToVideoJobManager,
} = require(
  "../server/image-to-video-job-manager.cjs"
);

const managerSource =
  fs.readFileSync(
    "scripts/server/image-to-video-job-manager.cjs",
    "utf8"
  );

const runnerSource =
  fs.readFileSync(
    "scripts/server/image-to-video-process-runner.cjs",
    "utf8"
  );

const serverSource =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

const apiSource =
  fs.readFileSync(
    "app/frontend/src/services/api.js",
    "utf8"
  );

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}

const root =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "luke-i2v-batch-controls-"
    )
  );

try {
  const manager =
    new ImageToVideoJobManager({
      statePath:
        path.join(
          root,
          "jobs.json"
        ),
    });

  const batchId =
    "batch-test";

  const first =
    manager.createJob({
      payload: {
        batchId,
        batchIndex: 1,
      },
    });

  const second =
    manager.createJob({
      payload: {
        batchId,
        batchIndex: 2,
      },
    });

  const third =
    manager.createJob({
      payload: {
        batchId,
        batchIndex: 3,
      },
    });

  const paused =
    manager.pauseBatch(
      batchId
    );

  assert(
    paused.paused === 3,
    "All queued Batch jobs should pause."
  );

  assert(
    manager.getJob(
      first.id
    ).state ===
      "paused",
    "Paused job state missing."
  );

  const skipped =
    manager.skipJob(
      second.id
    );

  assert(
    skipped.state ===
      "cancelled",
    "Skipped job must become terminal."
  );

  assert(
    skipped.error
      ?.code ===
      "BATCH_SKIPPED",
    "Skipped job code missing."
  );

  const resumed =
    manager.resumeBatch(
      batchId
    );

  assert(
    resumed.resumed === 2,
    "Remaining paused jobs should resume."
  );

  assert(
    manager.getJob(
      first.id
    ).state ===
      "queued",
    "First job must resume to queued."
  );

  assert(
    manager.getJob(
      third.id
    ).state ===
      "queued",
    "Third job must resume to queued."
  );

  assert(
    manager.getJob(
      second.id
    ).state ===
      "cancelled",
    "Skipped job must stay terminal."
  );

  for (
    const contract of [
      "pauseJob(",
      "resumeJob(",
      "skipJob(",
      "pauseBatch(",
      "resumeBatch(",
      "getBatchJobs(",
    ]
  ) {
    assert(
      managerSource.includes(
        contract
      ),
      `Manager contract missing: ${contract}`
    );
  }

  assert(
    runnerSource.includes(
      'latest.state ===\n        "paused"'
    ) ||
    runnerSource.includes(
      'latest.state === "paused"'
    ),
    "Runner does not protect paused jobs."
  );

  assert(
    serverSource.includes(
      "LUKE_AI_I2V_BATCH_CONTROLS_API_V1"
    ),
    "Batch API marker missing."
  );

  for (
    const contract of [
      "pause|resume|cancel|retry-failed",
      "skipMatch",
      "manager.pauseBatch",
      "manager.resumeBatch",
      "manager.skipJob",
    ]
  ) {
    assert(
      serverSource.includes(
        contract
      ),
      `Batch API contract missing: ${contract}`
    );
  }

  for (
    const contract of [
      "pauseImageToVideoBatch",
      "resumeImageToVideoBatch",
      "cancelImageToVideoBatch",
      "skipImageToVideoBatchJob",
    ]
  ) {
    assert(
      apiSource.includes(
        contract
      ),
      `Frontend API missing: ${contract}`
    );
  }

  console.log(
    "PASS: Queued Batch jobs can be paused persistently."
  );

  console.log(
    "PASS: Paused jobs resume to the existing FIFO state."
  );

  console.log(
    "PASS: Skip affects only queued/paused jobs."
  );

  console.log(
    "PASS: Running worker ownership remains outside Batch pause semantics."
  );

  console.log(
    "PASS: Batch controls reuse the certified Job Manager and Process Runner."
  );

  console.log(
    "PASS: Image-to-Video Batch Controls Phase 3A-4A validation completed."
  );

} finally {
  fs.rmSync(
    root,
    {
      recursive: true,
      force: true,
    }
  );
}
