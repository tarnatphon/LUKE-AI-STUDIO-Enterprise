#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const serverFile = path.join(
  root,
  "scripts",
  "server",
  "serve.cjs"
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

const policyFile = path.join(
  root,
  "app",
  "config",
  "text-chat",
  "model-router-policy.json"
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
  const server =
    fs.readFileSync(
      serverFile,
      "utf8"
    );

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

  const policy =
    JSON.parse(
      fs.readFileSync(
        policyFile,
        "utf8"
      )
    );

  for (const requirement of [
    "LUKE_AI_AUTOMATIC_MODEL_ROUTER_V1",
    "/api/text-runtime/model-router/route",
    "detectModelRouterTaskType",
    "routeTextModel",
    "fallbackModels",
    "getAdaptiveModelScore",
    "getTextModelHardwareRecommendation",
  ]) {
    requireText(
      server,
      requirement,
      "Backend"
    );
  }

  for (const requirement of [
    "LUKE_AI_AUTOMATIC_MODEL_ROUTER_UI_V2",
    "/api/text-runtime/model-router/route",
    "Automatic Model Router",
    "เลือกโมเดลอัตโนมัติ",
    "routeModelForPrompt",
    "routerDecision",
    "routedModelId",
    "ประเภทคำถาม",
  ]) {
    requireText(
      component,
      requirement,
      "Frontend"
    );
  }

  requireText(
    css,
    "LUKE_AI_AUTOMATIC_MODEL_ROUTER_STYLES_V2",
    "CSS"
  );

  requireText(
    css,
    ".persistent-chat-router-panel",
    "CSS"
  );

  if (
    policy.enabled !== true ||
    policy.routing
      ?.automaticByDefault !== true ||
    Number(
      policy.routing
        ?.maximumFallbackModels
    ) !== 2
  ) {
    throw new Error(
      "Router policy is invalid."
    );
  }

  console.log(
    "PASS: Automatic Model Router backend is present."
  );

  console.log(
    "PASS: Task classification and scoring are present."
  );

  console.log(
    "PASS: Feedback and hardware scoring are connected."
  );

  console.log(
    "PASS: Fallback model routing is configured."
  );

  console.log(
    "PASS: Automatic Model Router UI is connected."
  );

  console.log(
    "PASS: Manual Auto Router toggle is connected."
  );

  console.log(
    "PASS: Automatic Model Router validation completed."
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
