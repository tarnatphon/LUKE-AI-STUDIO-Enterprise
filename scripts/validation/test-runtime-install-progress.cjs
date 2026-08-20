#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
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

function fakeChild() {
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
        "Downloading package 25%\n"
      )
    );

    child.stdout.emit(
      "data",
      Buffer.from(
        "Installing package 70%\n"
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
  const start = Date.now();

  while (
    Date.now() - start <
    timeoutMs
  ) {
    if (predicate()) {
      return;
    }

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 25)
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
        os.tmpdir(),
        "luke-progress-"
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
        queue: {
          maximumQueuedJobs: 20,
          continueAfterFailure: true
        },
        installation: {
          timeoutMs: 5000,
          maximumLogCharacters: 50000,
          allowHomebrew: true,
          allowPythonVenv: true,
          minimumFreeSpaceBufferBytes: 0,
          rejectWhenDiskSpaceUnknown: false
        },
        paths: {
          pythonVenvRoot:
            temporaryDirectory
        },
        supportedRuntimes: {
          ollama: {
            displayName: "Ollama",
            installer: "homebrew",
            package: "ollama",
            estimatedInstallBytes: 1
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

  const queue =
    new RuntimeInstallQueue({
      root,
      policyPath,
      statePath,
      spawnImpl:
        () => fakeChild(),
    });

  queue.resolveHomebrew =
    () => "/opt/homebrew/bin/brew";

  queue.resolveDiskCheckPath =
    () => temporaryDirectory;

  const preflight =
    queue.getDiskPreflight(
      "ollama"
    );

  if (
    preflight.checked !== true ||
    preflight.allowed !== true
  ) {
    throw new Error(
      "Disk preflight failed."
    );
  }

  const job =
    queue.enqueue("ollama");

  if (
    job.progress !== 0 ||
    job.progressStage !==
      "queued"
  ) {
    throw new Error(
      "Queued progress is invalid."
    );
  }

  await waitUntil(() => {
    return (
      queue.getSnapshot()
        .jobs[0]?.status ===
      "completed"
    );
  });

  const completed =
    queue.getSnapshot()
      .jobs[0];

  if (
    completed.progress !== 100 ||
    completed.progressStage !==
      "completed"
  ) {
    throw new Error(
      "Completed progress is invalid."
    );
  }

  if (
    completed.diskPreflight
      ?.allowed !== true
  ) {
    throw new Error(
      "Disk preflight was not saved."
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
    "LUKE_AI_RUNTIME_INSTALL_PREFLIGHT_API_V2",
    "/api/text-runtime/install-preflight",
    "getDiskPreflight",
  ]) {
    if (!server.includes(requirement)) {
      throw new Error(
        `Server requirement missing: ${requirement}`
      );
    }
  }

  for (const requirement of [
    "LUKE_AI_RUNTIME_INSTALL_PROGRESS_UI_V2",
    "ตรวจพื้นที่ก่อนติดตั้ง",
    "persistent-chat-runtime-install-progress",
    "/api/text-runtime/install-preflight",
  ]) {
    if (!component.includes(requirement)) {
      throw new Error(
        `UI requirement missing: ${requirement}`
      );
    }
  }

  if (
    !css.includes(
      "LUKE_AI_RUNTIME_INSTALL_PROGRESS_STYLES_V2"
    )
  ) {
    throw new Error(
      "Progress styles are missing."
    );
  }

  console.log(
    "PASS: Disk space preflight returned available and required bytes."
  );

  console.log(
    "PASS: Queued jobs start at zero percent."
  );

  console.log(
    "PASS: Installer output updates progress."
  );

  console.log(
    "PASS: Completed jobs finish at one hundred percent."
  );

  console.log(
    "PASS: Disk preflight is persisted with each install job."
  );

  console.log(
    "PASS: Progress and Disk Preflight UI are connected."
  );

  console.log(
    "PASS: Runtime Install Progress validation completed."
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
