#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(
  __dirname,
  "..",
  ".."
);

const serverFile = path.join(
  projectRoot,
  "scripts",
  "server",
  "serve.cjs"
);

const stateFile = path.join(
  projectRoot,
  "app",
  "runtime-state",
  "install-jobs.json"
);

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);

    server.listen(
      {
        host: "127.0.0.1",
        port: 0,
      },
      () => {
        const address = server.address();

        if (
          !address ||
          typeof address === "string"
        ) {
          reject(
            new Error(
              "Unable to allocate test port."
            )
          );

          return;
        }

        const port = address.port;

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(port);
        });
      }
    );
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  const stopped = await Promise.race([
    new Promise((resolve) => {
      child.once("exit", () => resolve(true));
    }),
    delay(3000).then(() => false),
  ]);

  if (!stopped && child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

async function requestJson(
  baseUrl,
  pathname,
  options = {}
) {
  const response = await fetch(
    `${baseUrl}${pathname}`,
    {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
      },
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  return {
    status: response.status,
    data,
    text,
  };
}

async function waitForBackend(
  baseUrl,
  child
) {
  for (
    let attempt = 0;
    attempt < 60;
    attempt += 1
  ) {
    if (child.exitCode !== null) {
      throw new Error(
        `Backend exited with code ${child.exitCode}.`
      );
    }

    try {
      const response = await fetch(
        `${baseUrl}/api/runtime/dependencies`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new Error(
    "Backend did not become ready."
  );
}

async function waitForJobState(
  baseUrl,
  jobId,
  acceptedStates,
  timeoutMilliseconds = 30000
) {
  const startedAt = Date.now();

  while (
    Date.now() - startedAt <
    timeoutMilliseconds
  ) {
    const result = await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${jobId}`
    );

    const state = result.data?.job?.state;

    if (acceptedStates.includes(state)) {
      return result.data.job;
    }

    await delay(100);
  }

  throw new Error(
    `Job ${jobId} did not reach ` +
    acceptedStates.join(", ")
  );
}

async function main() {
  const originalState = fs.existsSync(stateFile)
    ? fs.readFileSync(stateFile, "utf8")
    : null;

  const testRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "luke-runtime-worker-"
    )
  );

  const goodPayload = Buffer.from(
    "LUKE AI STUDIO SAFE RUNTIME PACKAGE\n",
    "utf8"
  );

  const goodSha256 = crypto
    .createHash("sha256")
    .update(goodPayload)
    .digest("hex");

  const assetPort = await getFreePort();

  const assetServer = http.createServer(
    (req, res) => {
      if (req.url === "/runtime.bin") {
        res.writeHead(200, {
          "content-type":
            "application/octet-stream",
          "content-length":
            String(goodPayload.length),
        });

        res.end(goodPayload);
        return;
      }

      if (req.url === "/slow.bin") {
        const largePayload = Buffer.alloc(
          1024 * 1024,
          7
        );

        res.writeHead(200, {
          "content-type":
            "application/octet-stream",
          "content-length":
            String(largePayload.length),
        });

        let offset = 0;

        const timer = setInterval(() => {
          if (offset >= largePayload.length) {
            clearInterval(timer);
            res.end();
            return;
          }

          const end = Math.min(
            offset + 4096,
            largePayload.length
          );

          res.write(
            largePayload.subarray(
              offset,
              end
            )
          );

          offset = end;
        }, 20);

        req.on("close", () => {
          clearInterval(timer);
        });

        return;
      }

      res.writeHead(404);
      res.end();
    }
  );

  await new Promise((resolve, reject) => {
    assetServer.once("error", reject);
    assetServer.listen(
      assetPort,
      "127.0.0.1",
      resolve
    );
  });

  fs.mkdirSync(
    path.dirname(stateFile),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        jobs: [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const backendPort = await getFreePort();
  const baseUrl =
    `http://127.0.0.1:${backendPort}`;

  const child = spawn(
    process.execPath,
    [serverFile],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(backendPort),
        LUKE_AI_HOST: "127.0.0.1",
        LUKE_AI_PORT:
          String(backendPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  try {
    await waitForBackend(
      baseUrl,
      child
    );

    const createResult = await requestJson(
      baseUrl,
      "/api/runtime/install/jobs",
      {
        method: "POST",
        body: {
          dependencyId:
            "video-runtime",
          downloadDirectory:
            testRoot,
        },
      }
    );

    if (
      createResult.status !== 201 ||
      !createResult.data?.job?.id
    ) {
      throw new Error(
        `Unable to create install job: ` +
        createResult.text
      );
    }

    const jobId =
      createResult.data.job.id;

    const startResult = await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${jobId}/start`,
      {
        method: "POST",
        body: {
          url:
            `http://127.0.0.1:` +
            `${assetPort}/runtime.bin`,
          sha256: goodSha256,
          filename:
            "video-runtime.package",
        },
      }
    );

    if (startResult.status !== 202) {
      throw new Error(
        `Unable to start install job: ` +
        startResult.text
      );
    }

    const completedJob =
      await waitForJobState(
        baseUrl,
        jobId,
        ["completed"]
      );

    if (
      completedJob.progress?.percent !== 100 ||
      completedJob.checksum?.verified !== true ||
      !completedJob.installedAsset?.path ||
      !fs.existsSync(
        completedJob.installedAsset.path
      )
    ) {
      throw new Error(
        "Completed runtime installation is invalid."
      );
    }

    const installedPayload =
      fs.readFileSync(
        completedJob.installedAsset.path
      );

    if (
      !installedPayload.equals(goodPayload)
    ) {
      throw new Error(
        "Installed runtime payload is incorrect."
      );
    }

    const badCreate = await requestJson(
      baseUrl,
      "/api/runtime/install/jobs",
      {
        method: "POST",
        body: {
          dependencyId:
            "speech-runtime",
          downloadDirectory:
            testRoot,
        },
      }
    );

    const badJobId =
      badCreate.data?.job?.id;

    const badStart = await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${badJobId}/start`,
      {
        method: "POST",
        body: {
          url:
            `http://127.0.0.1:` +
            `${assetPort}/runtime.bin`,
          sha256:
            "0".repeat(64),
          filename:
            "speech-runtime.package",
        },
      }
    );

    if (badStart.status !== 202) {
      throw new Error(
        "Checksum test job did not start."
      );
    }

    const failedJob =
      await waitForJobState(
        baseUrl,
        badJobId,
        ["failed", "rolled-back"]
      );

    if (
      failedJob.checksum?.verified !== false ||
      failedJob.error?.code !==
        "CHECKSUM_MISMATCH"
    ) {
      throw new Error(
        "Checksum mismatch was not recorded."
      );
    }

    const cancelCreate = await requestJson(
      baseUrl,
      "/api/runtime/install/jobs",
      {
        method: "POST",
        body: {
          dependencyId:
            "tts-runtime",
          downloadDirectory:
            testRoot,
        },
      }
    );

    const cancelJobId =
      cancelCreate.data?.job?.id;

    const slowPayloadSha = crypto
      .createHash("sha256")
      .update(Buffer.alloc(
        1024 * 1024,
        7
      ))
      .digest("hex");

    await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${cancelJobId}/start`,
      {
        method: "POST",
        body: {
          url:
            `http://127.0.0.1:` +
            `${assetPort}/slow.bin`,
          sha256:
            slowPayloadSha,
          filename:
            "tts-runtime.package",
        },
      }
    );

    await waitForJobState(
      baseUrl,
      cancelJobId,
      ["downloading"]
    );

    const cancelResult = await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${cancelJobId}/cancel`,
      {
        method: "POST",
      }
    );

    if (cancelResult.status !== 200) {
      throw new Error(
        `Cancel failed: ${cancelResult.text}`
      );
    }

    const cancelledJob =
      await waitForJobState(
        baseUrl,
        cancelJobId,
        ["cancelled"]
      );

    if (
      cancelledJob.state !== "cancelled"
    ) {
      throw new Error(
        "Download worker cancellation failed."
      );
    }

    console.log("");
    console.log(
      "PASS: Runtime download completed."
    );
    console.log(
      "PASS: SHA256 verification completed."
    );
    console.log(
      "PASS: Checksum mismatch was rejected."
    );
    console.log(
      "PASS: Active download cancellation completed."
    );
  } finally {
    await stopProcess(child);

    await new Promise((resolve) => {
      assetServer.close(resolve);
    });

    fs.rmSync(testRoot, {
      recursive: true,
      force: true,
    });

    if (originalState === null) {
      fs.rmSync(stateFile, {
        force: true,
      });
    } else {
      fs.writeFileSync(
        stateFile,
        originalState,
        "utf8"
      );
    }
  }

  console.log(
    "PASS: Runtime safe download worker test completed."
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack || error.message
      : String(error)
  );

  process.exit(1);
});
