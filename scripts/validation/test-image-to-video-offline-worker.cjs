#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const worker =
  fs.readFileSync(
    "scripts/workers/image_to_video_worker.py",
    "utf8"
  );

for (
  const required of [
    "StableVideoDiffusionPipeline.from_pretrained",
    "local_files_only=True",
    "LUKE_AI_I2V_LOCAL_ONLY_MODEL_V2",
  ]
) {
  if (!worker.includes(required)) {
    throw new Error(
      `MISSING:${required}`
    );
  }
}

for (
  const forbidden of [
    "snapshot_download(",
    "hf_hub_download(",
  ]
) {
  if (worker.includes(forbidden)) {
    throw new Error(
      `NETWORK_DOWNLOAD_FOUND:${forbidden}`
    );
  }
}

const count =
  (
    worker.match(
      /local_files_only\s*=\s*True/g
    ) || []
  ).length;

if (count !== 1) {
  throw new Error(
    `EXPECTED_ONE_LOCAL_ONLY_ARGUMENT:${count}`
  );
}

console.log(
  "PASS: Worker enforces exactly one local-only model load."
);

console.log(
  "PASS: Worker contains no explicit Hugging Face download."
);

console.log(
  "PASS: Hidden Image-to-Video model download is blocked."
);

console.log(
  "PASS: Image-to-Video Offline Worker validation completed."
);
