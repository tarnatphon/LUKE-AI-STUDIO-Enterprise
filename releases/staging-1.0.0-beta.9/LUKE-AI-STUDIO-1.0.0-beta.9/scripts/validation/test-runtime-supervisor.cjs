#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const {
  spawn,
} = require("node:child_process");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

const supervisorFile = path.join(
  root,
  "scripts",
  "server",
  "text-runtime-supervisor.cjs"
);

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server =
      net.createServer();

    server.once(
      "error",
      reject
    );

    server.listen(
      0,
      "127.0.0.1",
      () => {
        const address =
          server.address();

        const port =
          typeof address === "object" &&
          address
            ? address.port
            : null;

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          if (!port) {
            reject(
              new Error(
                "Unable to allocate port."
              )
            );
            return;
          }

          resolve(port);
        });
      }
    );
  });
}

async function waitUntil(
  predicate,
  timeoutMs = 12000
) {
  const startedAt =
    Date.now();

  while (
    Date.now() -
      startedAt <
    timeoutMs
  ) {
    if (await predicate()) {
      return;
    }

    await delay(100);
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
        "luke-supervisor-recovery-"
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

  const runtimePath =
    path.join(
      temporaryDirectory,
      "mock-runtime.cjs"
    );

  const port =
    await getFreePort();

  fs.writeFileSync(
    runtimePath,
    `
"use strict";

const http = require("node:http");

const port =
  Number(
    process.env.MOCK_RUNTIME_PORT
  );

const crashAfter =
  Number(
    process.env.MOCK_CRASH_AFTER_MS ||
    0
  );

const server =
  http.createServer(
    (req, res) => {
      if (req.url === "/health") {
        res.writeHead(
          200,
          {
            "content-type":
              "application/json",
          }
        );

        res.end(
          JSON.stringify({
            ok: true,
            pid: process.pid,
          })
        );

        return;
      }

      res.writeHead(404);
      res.end();
    }
  );

server.listen(
  port,
  "127.0.0.1"
);

if (crashAfter > 0) {
  setTimeout(
    () => {
      process.exit(2);
    },
    crashAfter
  );
}

process.once(
  "SIGTERM",
  () => {
    server.close(
      () => {
        process.exit(0);
      }
    );
  }
);
`,
    "utf8"
  );

  fs.writeFileSync(
    policyPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        enabled: true,
        supervision: {
          autoStart: false,
          autoRestart: true,
          healthCheckIntervalMs:
            150,
          healthCheckTimeoutMs:
            500,
          startupGracePeriodMs:
            800,
          shutdownTimeoutMs:
            1000,
          maximumConsecutiveFailures:
            5,
          failureWindowMs:
            5000,
          suspendDurationMs:
            2000,
        },
        restart: {
          initialDelayMs:
            100,
          maximumDelayMs:
            500,
          backoffMultiplier:
            2,
          resetBackoffAfterHealthyMs:
            500,
        },
        runtime: {
          healthUrl:
            `http://127.0.0.1:${port}/health`,
          workingDirectory:
            temporaryDirectory,
          command:
            process.execPath,
          arguments: [
            runtimePath,
          ],
          environment: {
            MOCK_RUNTIME_PORT:
              String(port),
            MOCK_CRASH_AFTER_MS:
              "700",
          },
          inheritEnvironment:
            true,
        },
        security: {
          terminateOnlyOwnedProcess:
            true,
          allowShellCommand:
            false,
          writePidToState:
            true,
        },
        history: {
          maximumEvents:
            200,
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        status: "stopped",
        desiredState:
          "stopped",
        pid: null,
        ownedProcess: false,
        restartCount: 0,
        consecutiveFailures: 0,
        restartDelayMs: 0,
        suspendedUntil: null,
        events: [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const {
    TextRuntimeSupervisor,
  } = require(
    supervisorFile
  );

  const supervisor =
    new TextRuntimeSupervisor({
      root,
      policyPath,
      statePath,
      spawnImpl: spawn,
    });

  supervisor.startMonitoring();

  await supervisor.startRuntime({
    reason:
      "automated-recovery-test",
  });

  await waitUntil(
    async () => {
      const health =
        await supervisor.healthCheck();

      return health.healthy;
    }
  );

  const initial =
    supervisor.getStatus();

  if (
    !initial.pid ||
    initial.ownedProcess !== true
  ) {
    throw new Error(
      "Supervisor did not record owned PID."
    );
  }

  await waitUntil(
    () => {
      const status =
        supervisor.getStatus();

      return (
        status.restartCount >= 1
      );
    },
    15000
  );

  await waitUntil(
    async () => {
      const health =
        await supervisor.healthCheck();

      return health.healthy;
    },
    15000
  );

  const restarted =
    supervisor.getStatus();

  if (
    restarted.restartCount < 1 ||
    !restarted.pid
  ) {
    throw new Error(
      "Automatic restart failed."
    );
  }

  const pidBeforeManualRestart =
    restarted.pid;

  await supervisor.restartRuntime({
    reason:
      "manual-restart-test",
  });

  await waitUntil(
    async () => {
      const status =
        supervisor.getStatus();

      const health =
        await supervisor.healthCheck();

      return (
        health.healthy &&
        status.pid &&
        status.pid !==
          pidBeforeManualRestart
      );
    }
  );

  await supervisor.stopRuntime({
    reason:
      "automated-test-finished",
  });

  const stopped =
    supervisor.getStatus();

  if (
    stopped.status !==
      "stopped" ||
    stopped.pid !== null ||
    stopped.ownedProcess !==
      false
  ) {
    throw new Error(
      "Runtime did not stop cleanly."
    );
  }

  const eventTypes =
    new Set(
      (
        stopped.events || []
      ).map(
        (event) =>
          event.type
      )
    );

  for (const eventType of [
    "runtime-start-requested",
    "runtime-crashed",
    "restart-scheduled",
    "runtime-stop-requested",
  ]) {
    if (
      !eventTypes.has(
        eventType
      )
    ) {
      throw new Error(
        `Missing event: ${eventType}`
      );
    }
  }

  await supervisor.shutdown();

  console.log(
    "PASS: Runtime process was started by the supervisor."
  );

  console.log(
    "PASS: Runtime PID and ownership were recorded."
  );

  console.log(
    "PASS: Runtime crash was detected."
  );

  console.log(
    "PASS: Runtime restarted automatically."
  );

  console.log(
    "PASS: Restart audit events were persisted."
  );

  console.log(
    "PASS: Manual restart replaced the runtime process."
  );

  console.log(
    "PASS: Runtime stopped gracefully."
  );

  console.log(
    "PASS: Runtime Supervisor validation completed."
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
