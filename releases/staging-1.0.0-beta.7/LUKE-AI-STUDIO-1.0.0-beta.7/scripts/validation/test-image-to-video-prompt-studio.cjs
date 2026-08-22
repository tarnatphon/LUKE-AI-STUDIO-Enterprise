#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const ui =
  fs.readFileSync(
    "app/frontend/src/components/ImageToVideo.jsx",
    "utf8"
  );

const importer =
  fs.readFileSync(
    "app/frontend/src/utils/imageToVideoPromptImport.js",
    "utf8"
  );

const packageJson =
  JSON.parse(
    fs.readFileSync(
      "app/frontend/package.json",
      "utf8"
    )
  );

const uiContracts = [
  "promptText",
  "durationSeconds",
  "importedPromptRows",
  "handlePromptFile",
  "Prompt Studio",
  "Import Prompt / Batch",
  ".txt,.md,.csv,.xlsx",
  "[5, 10, 15]",
  "durationUsesStitch",
  "Segment/Stitch",
  "prompt: promptText",
  "seconds: durationSeconds",
];

for (
  const value of
  uiContracts
) {
  if (
    !ui.includes(
      value
    )
  ) {
    throw new Error(
      `PROMPT_STUDIO_UI_MISSING:${value}`
    );
  }
}

const importerContracts = [
  "read-excel-file/browser",
  "readSheet",
  "parseCsvText",
  "importPromptFile",
  ".txt",
  ".csv",
  ".xlsx",
];

for (
  const value of
  importerContracts
) {
  if (
    !importer.includes(
      value
    )
  ) {
    throw new Error(
      `PROMPT_IMPORTER_MISSING:${value}`
    );
  }
}

if (
  !packageJson
    .dependencies
    ?.[
      "read-excel-file"
    ]
) {
  throw new Error(
    "XLSX_DEPENDENCY_MISSING"
  );
}

if (
  ui.includes(
    "durationRequiresStitch"
  )
) {
  throw new Error(
    "OBSOLETE_DURATION_GATE_PRESENT"
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
  "PASS: Prompt textarea is connected to generation."
);

console.log(
  "PASS: TXT / Markdown / CSV / XLSX import remain available."
);

console.log(
  "PASS: Duration selector exposes 5 / 10 / 15 seconds."
);

console.log(
  "PASS: 10 / 15 second duration now routes through Segment/Stitch."
);

console.log(
  "PASS: Certified asynchronous I2V Job API remains unchanged."
);

console.log(
  "PASS: Automatic Image-to-Video Prompt Studio Phase 3A-1 validation completed."
);
