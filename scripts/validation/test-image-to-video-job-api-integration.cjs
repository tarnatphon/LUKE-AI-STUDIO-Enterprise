#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const server =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

const manager =
  fs.readFileSync(
    "scripts/server/image-to-video-job-manager.cjs",
    "utf8"
  );

const requiredServer = [
  "LUKE_AI_I2V_JOB_MANAGER_IMPORT_V1",
  "LUKE_AI_I2V_JOB_MANAGER_SINGLETON_V1",
  "LUKE_AI_I2V_JOB_API_V1",
  "/api/image-to-video/jobs",
  "/api/image-to-video/jobs/summary",
  "/api/image-to-video/generate",
  "manager.createJob(",
  "manager.listJobs(",
  "manager.getJob(",
  "manager.cancelJob(",
  "manager.retryJob(",
];

for (
  const value of requiredServer
) {
  if (
    !server.includes(value)
  ) {
    throw new Error(
      `JOB_API_CONTRACT_MISSING:${value}`
    );
  }
}

const markers = [
  "LUKE_AI_I2V_JOB_MANAGER_IMPORT_V1",
  "LUKE_AI_I2V_JOB_MANAGER_SINGLETON_V1",
  "LUKE_AI_I2V_JOB_API_V1",
];

for (const marker of markers) {
  const count =
    server.split(marker)
      .length - 1;

  if (count !== 1) {
    throw new Error(
      `JOB_API_MARKER_COUNT:${marker}:${count}`
    );
  }
}

if (
  !manager.includes(
    "activeProcesses"
  )
) {
  throw new Error(
    "JOB_MANAGER_PROCESS_OWNERSHIP_MISSING"
  );
}

if (
  !manager.includes(
    'child.kill('
  )
) {
  throw new Error(
    "JOB_MANAGER_SIGTERM_PATH_MISSING"
  );
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

const forbidden = [
  "snapshot_download(",
  "hf_hub_download(",
];

for (const value of forbidden) {
  if (
    manager.includes(value)
  ) {
    throw new Error(
      `JOB_MANAGER_NETWORK_BEHAVIOR:${value}`
    );
  }
}

console.log(
  "PASS: Production Image-to-Video Job REST API contracts are present."
);

console.log(
  "PASS: Job creation, list, detail, cancel and retry APIs are wired."
);

console.log(
  "PASS: Existing synchronous generation endpoint remains available."
);

console.log(
  "PASS: Job API layer contains no model download behavior."
);

console.log(
  "PASS: Production Image-to-Video Job API Integration validation completed."
);
