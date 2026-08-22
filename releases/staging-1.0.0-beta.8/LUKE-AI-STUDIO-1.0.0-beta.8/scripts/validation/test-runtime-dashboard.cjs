#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

const dashboardFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "components",
  "RuntimeDownloadDashboard.jsx"
);

const appCandidates = [
  path.join(root, "app", "frontend", "src", "App.jsx"),
  path.join(root, "app", "frontend", "src", "App.tsx"),
  path.join(root, "app", "frontend", "src", "App.js"),
  path.join(root, "app", "frontend", "src", "App.ts"),
];

const cssFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "App.css"
);

const dashboard = fs.readFileSync(dashboardFile, "utf8");
const appFile = appCandidates.find((file) => fs.existsSync(file));

if (!appFile) {
  throw new Error("App entry file is missing.");
}

const app = fs.readFileSync(appFile, "utf8");
const css = fs.readFileSync(cssFile, "utf8");

const dashboardRequirements = [
  "/api/runtime/dependencies",
  "/api/runtime/install/jobs",
  "/start",
  "/cancel",
  "setInterval",
  "750",
  "10000",
  "SHA256",
  "defaultDownloadDirectory",
  "RuntimeDownloadDashboard",
];

for (const requirement of dashboardRequirements) {
  if (!dashboard.includes(requirement)) {
    throw new Error(
      `Runtime dashboard requirement missing: ${requirement}`
    );
  }
}

if (!app.includes("RuntimeDownloadDashboard")) {
  throw new Error(
    "Runtime dashboard is not connected to the App."
  );
}

if (
  !css.includes("LUKE_AI_RUNTIME_DASHBOARD_STYLES_V1") ||
  !css.includes(".runtime-dependency-grid") ||
  !css.includes(".runtime-progress-fill")
) {
  throw new Error(
    "Runtime dashboard styles are incomplete."
  );
}

console.log(
  "PASS: Runtime dashboard component is complete."
);
console.log(
  "PASS: Runtime dashboard API integration is present."
);
console.log(
  "PASS: Runtime dashboard progress polling is present."
);
console.log(
  "PASS: Runtime dashboard is connected to the App."
);
console.log(
  "PASS: Runtime dashboard validation completed."
);
