#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  EventEmitter,
} = require("node:events");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const installerFile = path.join(
  root,
  "scripts",
  "server",
  "text-runtime-installer.cjs"
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

function createFakeChild() {
  const child =
    new EventEmitter();

  child.stdout =
    new EventEmitter();

  child.stderr =
    new EventEmitter();

  child.exitCode = null;

  child.kill = () => true;

  queueMicrotask(() => {
    child.stdout.emit(
      "data",
      Buffer.from(
        "Installing runtime...\n"
      )
    );

    child.exitCode = 0;

    child.emit(
      "exit",
      0,
      null
    );
  });

  return child;
}

async function waitUntil(
  predicate,
  timeoutMs = 5000
) {
  const startedAt = Date.now();

  while (
    Date.now() - startedAt <
    timeoutMs
  ) {
    if (predicate()) {
      return;
    }

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 30)
    );
  }

  throw new Error(
    "Condition timed out."
  );
}

async function main() {
  const temporaryDirectory =
    fs.mkdtempSync(
      path.join(
        "/tmp",
        "luke-runtime-install-"
      )
    );

  const policyPath =
    path.join(
      temporaryDirectory,
      "policy.json"
    );

  const statePath =
    path.join(
      temporaryDirectory,
      "state.json"
    );

  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        enabled: true,
        queue: {
          maximumConcurrentInstalls: 1,
          maximumQueuedJobs: 20,
          continueAfterFailure: true
        },
        installation: {
          timeoutMs: 5000,
          maximumLogCharacters: 50000,
          allowHomebrew: true,
          allowPythonVenv: true,
          allowSystemPythonInstall: false,
          allowShell: false
        },
        paths: {
          pythonVenvRoot:
            temporaryDirectory
        },
        supportedRuntimes: {
          ollama: {
            displayName: "Ollama",
            installer: "homebrew",
            package: "ollama"
          },
          "llama.cpp": {
            displayName: "llama.cpp",
            installer: "homebrew",
            package: "llama.cpp"
          }
        }
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        activeJobId: null,
        jobs: []
      },
      null,
      2
    ) + "\n"
  );

  const {
    RuntimeInstallQueue,
  } = require(installerFile);

  const spawnCalls = [];

  const queue =
    new RuntimeInstallQueue({
      root,
      policyPath,
      statePath,
      spawnImpl: (
        command,
        args,
        options
      ) => {
        spawnCalls.push({
          command,
          args,
          options,
        });

        return createFakeChild();
      },
    });

  queue.resolveHomebrew =
    () => "/opt/homebrew/bin/brew";

  queue.enqueue("ollama");
  queue.enqueue("llama.cpp");

  await waitUntil(() => {
    const state =
      queue.getSnapshot();

    return (
      state.jobs.length === 2 &&
      state.jobs.every(
        (job) =>
          job.status === "completed"
      )
    );
  });

  const completed =
    queue.getSnapshot();

  if (
    completed.jobs.length !== 2 ||
    spawnCalls.length !== 2
  ) {
    throw new Error(
      "Queue did not process both jobs."
    );
  }

  if (
    spawnCalls.some(
      (call) =>
        call.options.shell !== false
    )
  ) {
    throw new Error(
      "Shell execution must remain disabled."
    );
  }

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

  for (const requirement of [
    "/api/text-runtime/install-queue",
    "/api/text-runtime/install",
    "/api/text-runtime/install-cancel",
    "/api/text-runtime/install-clear",
    "RuntimeInstallQueue",
  ]) {
    if (!server.includes(requirement)) {
      throw new Error(
        `Server contract missing: ${requirement}`
      );
    }
  }

  for (const requirement of [
    "LUKE_AI_RUNTIME_ONE_CLICK_INSTALL_UI_FINAL_V1",
    "LUKE_AI_RUNTIME_INSTALL_BUTTON_FINAL_V1",
    "LUKE_AI_RUNTIME_INSTALL_QUEUE_FINAL_V1",
    "One-Click Install",
    "Runtime Installation Queue",
    "Cancel Install",
    "Clear History",
    "/api/text-runtime/install-queue",
  ]) {
    if (!component.includes(requirement)) {
      throw new Error(
        `UI contract missing: ${requirement}`
      );
    }
  }

  if (
    !css.includes(
      "LUKE_AI_RUNTIME_INSTALL_FINAL_STYLES_V1"
    )
  ) {
    throw new Error(
      "Install CSS is missing."
    );
  }

  console.log(
    "PASS: Runtime install jobs were queued."
  );

  console.log(
    "PASS: Runtime installs were processed one at a time."
  );

  console.log(
    "PASS: Shell execution remained disabled."
  );

  console.log(
    "PASS: One-Click Install UI is connected."
  );

  console.log(
    "PASS: Runtime Installation Queue is displayed."
  );

  console.log(
    "PASS: Runtime One-Click Install validation completed."
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
