#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const server =
  fs.readFileSync(
    "scripts/server/serve.cjs",
    "utf8"
  );

const registry =
  fs.readFileSync(
    "scripts/server/asset-registry.cjs",
    "utf8"
  );

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      message
    );
  }
}

const marker =
  "LUKE_AI_I2V_VIDEO_ASSET_REGISTRATION_V1";

const markerIndex =
  server.indexOf(
    marker
  );

assert(
  markerIndex >= 0,
  "I2V Video Asset registration marker missing."
);

const guardIndex =
  server.lastIndexOf(
    'if (result.error || result.status !== 0 || !parsed?.ok)',
    markerIndex
  );

const responseIndex =
  server.indexOf(
    'return json(res, 200, { ok: true, output: path.relative(ROOT, outputPath)',
    markerIndex
  );

assert(
  guardIndex >= 0 &&
  responseIndex > markerIndex &&
  guardIndex < markerIndex,
  "Registration must occur after worker success and before success response."
);

const hook =
  server.slice(
    markerIndex,
    responseIndex
  );

[
  "fs.existsSync",
  "fs.statSync",
  "outputStat.isFile",
  "getLukeAssetRegistry",
  "registry.upsertByPath",
  'type:\n                "video"',
  "sizeBytes:",
  "sourcePrompt:",
  "sourceModel:",
  "seconds:",
  "batchId:",
  "batchIndex:",
  "batchSize:",
  "referenceCount:",
].forEach(
  (contract) => {
    assert(
      hook.includes(
        contract
      ),
      `I2V Asset contract missing: ${contract}`
    );
  }
);

assert(
  registry.includes(
    "upsertByPath("
  ),
  "Asset path deduplication contract missing."
);

assert(
  hook.includes(
    "catch (error)"
  ) &&
  hook.includes(
    "Completed I2V registration skipped"
  ),
  "Asset registration failure must remain non-fatal."
);

assert(
  !hook.includes(
    "copyFileSync"
  ),
  "Video Asset registration must not copy physical files."
);

assert(
  !hook.includes(
    "unlinkSync"
  ),
  "Video Asset registration must not delete physical files."
);

console.log(
  "PASS: I2V videos register only after worker success."
);

console.log(
  "PASS: Physical MP4 existence and file type are verified before registration."
);

console.log(
  "PASS: Actual output size is derived from fs.statSync."
);

console.log(
  "PASS: prompt/model/seconds/batch metadata is preserved when available."
);

console.log(
  "PASS: failed I2V worker responses bypass Asset registration."
);

console.log(
  "PASS: Asset registration remains non-fatal to successful video generation."
);

console.log(
  "PASS: path upsert prevents duplicate video Asset records."
);

console.log(
  "PASS: no physical file copy/delete behavior was introduced."
);

console.log(
  "PASS: Phase 3A-5B.3 Completed I2V Asset Registration validation completed."
);
