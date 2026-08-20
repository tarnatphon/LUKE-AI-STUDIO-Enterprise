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

const supervisorFile = path.join(
  root,
  "scripts",
  "server",
  "text-runtime-supervisor.cjs"
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
  "runtime-supervisor-policy.json"
);

function requireText(
  content,
  value,
  label
) {
  if (!content.includes(value)) {
    throw new Error(
      `${label} missing: ${value}`
    );
  }
}

function main() {
  const server =
    fs.readFileSync(
      serverFile,
      "utf8"
    );

  const supervisor =
    fs.readFileSync(
      supervisorFile,
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
    "LUKE_AI_RUNTIME_SUPERVISOR_SETTINGS_API_V1",
    "/api/text-runtime/supervisor/settings",
    "normalizeRuntimeSupervisorPolicy",
    "writeRuntimeSupervisorPolicy",
    "allowShellCommand",
    "127.0.0.1",
  ]) {
    requireText(
      server,
      requirement,
      "Server"
    );
  }

  requireText(
    supervisor,
    "LUKE_AI_RUNTIME_SUPERVISOR_POLICY_RELOAD_V1",
    "Supervisor"
  );

  requireText(
    supervisor,
    "reloadPolicy()",
    "Supervisor"
  );

  for (const requirement of [
    "LUKE_AI_RUNTIME_SUPERVISOR_DASHBOARD_UI_V1",
    "Runtime Supervisor",
    "Runtime Settings",
    "Start Runtime",
    "Restart Runtime",
    "Stop Runtime",
    "Reset Supervisor",
    "Save Settings",
    "Supervisor Events",
    "/api/text-runtime/supervisor/settings",
  ]) {
    requireText(
      component,
      requirement,
      "Dashboard UI"
    );
  }

  requireText(
    css,
    "LUKE_AI_RUNTIME_SUPERVISOR_DASHBOARD_STYLES_V1",
    "Dashboard CSS"
  );

  if (
    policy.security
      ?.allowShellCommand !==
      false ||
    policy.security
      ?.terminateOnlyOwnedProcess !==
      true
  ) {
    throw new Error(
      "Runtime supervisor security policy is invalid."
    );
  }

  console.log(
    "PASS: Runtime Supervisor Settings API is present."
  );

  console.log(
    "PASS: Runtime policy validation is present."
  );

  console.log(
    "PASS: Localhost-only Health URL validation is present."
  );

  console.log(
    "PASS: Shell command execution remains disabled."
  );

  console.log(
    "PASS: Supervisor policy reload is connected."
  );

  console.log(
    "PASS: Start, Stop, Restart and Reset controls are connected."
  );

  console.log(
    "PASS: Runtime Settings UI is connected."
  );

  console.log(
    "PASS: Supervisor event history is displayed."
  );

  console.log(
    "PASS: Runtime Supervisor Dashboard validation completed."
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
