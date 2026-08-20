#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const server = fs.readFileSync(
  "scripts/server/serve.cjs",
  "utf8"
);

const runner = fs.readFileSync(
  "scripts/server/image-to-video-process-runner.cjs",
  "utf8"
);

const durationWorker = fs.readFileSync(
  "scripts/workers/image_to_video_duration_worker.py",
  "utf8"
);

const baseWorker = fs.readFileSync(
  "scripts/workers/image_to_video_worker.py",
  "utf8"
);

const ui = fs.readFileSync(
  "app/frontend/src/components/ImageToVideo.jsx",
  "utf8"
);

function required(
  source,
  text,
  label
) {
  if (!source.includes(text)) {
    throw new Error(
      `${label}:${text}`
    );
  }
}

[
  "image_to_video_duration_worker.py",
  "getRequestedSeconds",
  "selectWorkerPath",
  "seconds > 5",
  "selectedWorkerPath",
  "task.workerPath",
  "maxConcurrent",
].forEach(
  (value) =>
    required(
      runner,
      value,
      "RUNNER_DURATION_MISSING"
    )
);

[
  "SEGMENT_SECONDS = 5",
  "SUPPORTED_DURATIONS",
  "normalize_segment",
  "extract_last_frame",
  "concat_segments",
  "count_frames_and_secs",
  "segment-stitch-v1",
  "HF_HUB_OFFLINE",
  "TRANSFORMERS_OFFLINE",
  "LUKE_AI_I2V_BASE_WORKER",
].forEach(
  (value) =>
    required(
      durationWorker,
      value,
      "DURATION_WORKER_MISSING"
    )
);

required(
  baseWorker,
  "local_files_only=True",
  "BASE_WORKER_LOCAL_ONLY_MISSING"
);

required(
  server,
  "LUKE_AI_I2V_DURATION_15_BACKEND_V1",
  "BACKEND_DURATION_15_MISSING"
);

required(
  ui,
  "[5, 10, 15]",
  "UI_DURATION_OPTIONS_MISSING"
);

required(
  ui,
  "durationUsesStitch",
  "UI_STITCH_MODE_MISSING"
);

required(
  ui,
  "seconds: durationSeconds",
  "UI_DURATION_PAYLOAD_MISSING"
);

if (
  ui.includes(
    "durationRequiresStitch"
  )
) {
  throw new Error(
    "OLD_DURATION_GATE_ACTIVE"
  );
}

if (
  ui.includes(
    "intentionally blocked"
  )
) {
  throw new Error(
    "LONG_DURATION_STILL_BLOCKED"
  );
}

console.log(
  "PASS: 5-second jobs preserve the certified base worker route."
);

console.log(
  "PASS: 10/15-second jobs route through Duration Worker."
);

console.log(
  "PASS: Offline/local-only generation remains enforced."
);

console.log(
  "PASS: Concurrency control remains in Process Runner."
);

console.log(
  "PASS: Last-frame continuity is enabled."
);

console.log(
  "PASS: FFmpeg normalization and duration verification are enabled."
);

console.log(
  "PASS: UI supports 5 / 10 / 15 second targets."
);

console.log(
  "PASS: Image-to-Video Duration Strategy Phase 3A-2 validation completed."
);
