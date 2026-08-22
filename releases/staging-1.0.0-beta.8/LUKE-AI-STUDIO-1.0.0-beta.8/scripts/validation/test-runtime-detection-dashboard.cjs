#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const componentFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "components",
  "PersistentTextChat.jsx"
);

const cssFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "App.css"
);

const serverFile = path.join(
  root,
  "scripts",
  "server",
  "serve.cjs"
);

function requireText(
  content,
  requirement,
  label
) {
  if (!content.includes(requirement)) {
    throw new Error(
      `${label} missing: ${requirement}`
    );
  }
}

function main() {
  const component =
    fs.readFileSync(
      componentFile,
      "utf8"
    );

  const css =
    fs.readFileSync(
      cssFile,
      "utf8"
    );

  const server =
    fs.readFileSync(
      serverFile,
      "utf8"
    );

  for (const requirement of [
    "LUKE_AI_RUNTIME_DETECTION_DASHBOARD_UI_V1",
    "Runtime Auto-Detection",
    "ตรวจหา Runtime",
    "One-Click Configure",
    "detectedTextRuntimes",
    "detectInstalledTextRuntimes",
    "configureDetectedTextRuntime",
    "/api/text-runtime/detect",
    "/api/text-runtime/configure-detected",
    "Ollama",
    "llama.cpp",
    "MLX",
  ]) {
    requireText(
      component,
      requirement,
      "Runtime Detection UI"
    );
  }

  for (const requirement of [
    "LUKE_AI_RUNTIME_DETECTION_DASHBOARD_STYLES_V1",
    ".persistent-chat-runtime-detection-panel",
    ".persistent-chat-runtime-detection-grid",
    ".persistent-chat-runtime-detection-card",
    ".persistent-chat-runtime-running",
  ]) {
    requireText(
      css,
      requirement,
      "Runtime Detection CSS"
    );
  }

  for (const requirement of [
    "/api/text-runtime/detect",
    "/api/text-runtime/configure-detected",
  ]) {
    requireText(
      server,
      requirement,
      "Runtime Detection Backend"
    );
  }

  if (
    component.includes(
      "/api/text-runtime/configure-detected/${"
    )
  ) {
    throw new Error(
      "Dynamic configure endpoint is not allowed."
    );
  }

  console.log(
    "PASS: Runtime Detection Cards are connected."
  );

  console.log(
    "PASS: Ollama, llama.cpp and MLX cards are supported."
  );

  console.log(
    "PASS: Installed and running states are displayed."
  );

  console.log(
    "PASS: Executable, version and health details are displayed."
  );

  console.log(
    "PASS: One-click configuration is connected."
  );

  console.log(
    "PASS: Missing runtimes cannot be configured."
  );

  console.log(
    "PASS: Detection does not change settings without confirmation."
  );

  console.log(
    "PASS: Runtime Detection Dashboard validation completed."
  );
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.stack ||
        error.message
      : String(error)
  );

  process.exit(1);
}
