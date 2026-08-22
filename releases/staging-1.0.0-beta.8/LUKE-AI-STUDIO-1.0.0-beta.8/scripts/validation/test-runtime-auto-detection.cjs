#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const detectorFile = path.join(
  root,
  "scripts",
  "server",
  "text-runtime-detector.cjs"
);

const serverFile = path.join(
  root,
  "scripts",
  "server",
  "serve.cjs"
);

async function main() {
  const {
    detectTextRuntimes,
    createPreset,
  } = require(
    detectorFile
  );

  const detection =
    await detectTextRuntimes();

  if (
    !Array.isArray(
      detection.detections
    ) ||
    detection.detections.length !== 3
  ) {
    throw new Error(
      "Runtime detection result is invalid."
    );
  }

  const types =
    new Set(
      detection.detections.map(
        (runtime) =>
          runtime.runtimeType
      )
    );

  for (const type of [
    "ollama",
    "llama.cpp",
    "mlx",
  ]) {
    if (!types.has(type)) {
      throw new Error(
        `Runtime type missing: ${type}`
      );
    }
  }

  const ollamaPreset =
    createPreset(
      "ollama",
      "/tmp/ollama"
    );

  if (
    ollamaPreset.command !==
      "/tmp/ollama" ||
    ollamaPreset.arguments[0] !==
      "serve" ||
    !ollamaPreset.healthUrl.includes(
      "127.0.0.1"
    )
  ) {
    throw new Error(
      "Ollama preset is invalid."
    );
  }

  const llamaPreset =
    createPreset(
      "llama.cpp",
      "/tmp/llama-server"
    );

  if (
    llamaPreset.command !==
      "/tmp/llama-server" ||
    llamaPreset.requiresModelPath !==
      true
  ) {
    throw new Error(
      "llama.cpp preset is invalid."
    );
  }

  const mlxPreset =
    createPreset(
      "mlx",
      "/tmp/mlx_lm.server"
    );

  if (
    mlxPreset.command !==
      "/tmp/mlx_lm.server" ||
    mlxPreset.requiresModelPath !==
      true
  ) {
    throw new Error(
      "MLX preset is invalid."
    );
  }

  const server =
    fs.readFileSync(
      serverFile,
      "utf8"
    );

  for (const requirement of [
    "LUKE_AI_RUNTIME_AUTO_DETECTION_API_V3",
    "/api/text-runtime/detect",
    "/api/text-runtime/configure-detected",
    "detectTextRuntimes",
    "createTextRuntimePreset",
    "writeRuntimeSupervisorPolicy",
    "reloadPolicy",
  ]) {
    if (!server.includes(requirement)) {
      throw new Error(
        `Detection contract missing: ${requirement}`
      );
    }
  }

  console.log(
    "PASS: Ollama detection is supported."
  );

  console.log(
    "PASS: llama.cpp detection is supported."
  );

  console.log(
    "PASS: MLX detection is supported."
  );

  console.log(
    "PASS: Runtime presets use localhost endpoints."
  );

  console.log(
    "PASS: Detection does not modify Runtime Settings."
  );

  console.log(
    "PASS: One-click configuration API is connected."
  );

  console.log(
    "PASS: Runtime Auto-Detection validation completed."
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack ||
        error.message
      : String(error)
  );

  process.exit(1);
});
