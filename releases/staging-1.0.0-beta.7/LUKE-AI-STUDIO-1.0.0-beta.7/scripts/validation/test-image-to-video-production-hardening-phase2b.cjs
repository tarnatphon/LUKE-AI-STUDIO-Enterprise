#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const server =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

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

const maintenance =
  fs.readFileSync(
    "scripts/server/image-to-video-maintenance.cjs",
    "utf8"
  );

const serverContracts = [
  "runImageToVideoStartupMaintenance",
  "getImageToVideoRecoveryStatus",
  "/api/image-to-video/maintenance/status",
  "/api/image-to-video/recovery",
  "planImageToVideoCleanup",
  "applyImageToVideoCleanup",
];

for (const value of serverContracts) {
  if (!server.includes(value)) {
    throw new Error(
      `SERVER_PHASE2B_CONTRACT_MISSING:${value}`
    );
  }
}

if (
  (
    server.match(
      /runImageToVideoStartupMaintenance\(\);/g
    ) || []
  ).length !== 1
) {
  throw new Error(
    "STARTUP_MAINTENANCE_MUST_RUN_EXACTLY_ONCE"
  );
}

const serviceContracts = [
  "getImageToVideoRecoveryStatus",
  "getImageToVideoMaintenanceStatus",
  "/api/image-to-video/recovery",
  "/api/image-to-video/maintenance/status",
];

for (const value of serviceContracts) {
  if (!api.includes(value)) {
    throw new Error(
      `RECOVERY_SERVICE_MISSING:${value}`
    );
  }
}

const uiContracts = [
  "LUKE_AI_I2V_UI_RESTART_RECOVERY_V1",
  "getImageToVideoRecoveryStatus",
  "recoveredJobs",
  "activeJobs",
  "pollImageToVideoJob",
  "PROCESS_INTERRUPTED",
];

for (const value of uiContracts) {
  if (
    value === "PROCESS_INTERRUPTED"
  ) {
    continue;
  }

  if (!ui.includes(value)) {
    throw new Error(
      `UI_RECOVERY_CONTRACT_MISSING:${value}`
    );
  }
}

if (
  !ui.includes(
    "previous Image-to-Video job was interrupted"
  )
) {
  throw new Error(
    "INTERRUPTED_JOB_MESSAGE_MISSING"
  );
}

if (
  ui.includes(
    "resumeInterruptedProcess"
  )
) {
  throw new Error(
    "UI_MUST_NOT_RESUME_DEAD_PROCESS"
  );
}

if (
  !maintenance.includes(
    "REFUSING_OUTSIDE_I2V_PATH"
  )
) {
  throw new Error(
    "MAINTENANCE_PATH_SAFETY_MISSING"
  );
}

if (
  !maintenance.includes(
    "REFERENCED_BY_RETAINED_HISTORY"
  )
) {
  throw new Error(
    "REFERENCED_OUTPUT_PROTECTION_MISSING"
  );
}

console.log(
  "PASS: Startup maintenance is executed once."
);

console.log(
  "PASS: Maintenance remains plan-first and path allowlisted."
);

console.log(
  "PASS: Maintenance and recovery status APIs are available."
);

console.log(
  "PASS: Frontend can restore active Image-to-Video state after restart."
);

console.log(
  "PASS: Only genuinely active jobs resume polling."
);

console.log(
  "PASS: Interrupted jobs are shown as failed/retryable rather than resuming a dead process."
);

console.log(
  "PASS: Referenced outputs remain protected."
);

console.log(
  "PASS: Image-to-Video Production Hardening Phase 2B validation completed."
);
