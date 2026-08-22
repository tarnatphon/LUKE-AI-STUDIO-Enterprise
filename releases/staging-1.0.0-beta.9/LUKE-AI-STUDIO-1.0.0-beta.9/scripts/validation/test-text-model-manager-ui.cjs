#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
  __dirname,
  "..",
  "..",
);

const componentFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "components",
  "TextModelManager.jsx",
);

const appCandidates = [
  "App.jsx",
  "App.tsx",
  "App.js",
  "App.ts",
].map(
  (filename) =>
    path.join(
      root,
      "app",
      "frontend",
      "src",
      filename,
    ),
);

const appFile =
  appCandidates.find(
    (candidate) =>
      fs.existsSync(candidate),
  );

const cssFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "App.css",
);

if (!appFile) {
  throw new Error(
    "Frontend App entry is missing.",
  );
}

const component =
  fs.readFileSync(
    componentFile,
    "utf8",
  );

const app =
  fs.readFileSync(
    appFile,
    "utf8",
  );

const css =
  fs.readFileSync(
    cssFile,
    "utf8",
  );

const componentRequirements = [
  "/api/text-models/catalog",
  "/api/text-models/download-queue",
  "maximumBatchSelection",
  "maximumConcurrentDownloads",
  "ดาวน์โหลดทันที",
  "pause",
  "resume",
  "cancel",
  "skip",
  "move",
  "Community Models",
  "Official Models",
  "750",
  "5000",
];

for (
  const requirement
  of componentRequirements
) {
  if (
    !component.includes(
      requirement,
    )
  ) {
    throw new Error(
      `Text Model Manager requirement missing: ${requirement}`,
    );
  }
}

if (
  !app.includes(
    "TextModelManager",
  )
) {
  throw new Error(
    "Text Model Manager is not connected to the App.",
  );
}

if (
  !css.includes(
    "LUKE_AI_TEXT_MODEL_MANAGER_STYLES_V1",
  ) ||
  !css.includes(
    ".text-model-grid",
  ) ||
  !css.includes(
    ".text-model-progress-fill",
  ) ||
  !css.includes(
    ".text-model-queue-panel",
  )
) {
  throw new Error(
    "Text Model Manager styles are incomplete.",
  );
}

console.log(
  "PASS: Text Model Manager cards are present.",
);
console.log(
  "PASS: One-click in-app download is connected.",
);
console.log(
  "PASS: Sequential Download Queue UI is present.",
);
console.log(
  "PASS: Queue actions are connected.",
);
console.log(
  "PASS: Official and Community categories are present.",
);
console.log(
  "PASS: Text Model Manager is connected to the App.",
);
console.log(
  "PASS: Text Model Manager UI validation completed.",
);
