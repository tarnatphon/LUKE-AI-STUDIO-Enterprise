#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const net = require("node:net");
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
            new Error("Unable to allocate test port.")
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
        ...(options.headers || {}),
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

async function waitForServer(baseUrl, child) {
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

    await delay(500);
  }

  throw new Error("Backend did not become ready.");
}

async function main() {
  const originalState = fs.existsSync(stateFile)
    ? fs.readFileSync(stateFile, "utf8")
    : null;

  fs.mkdirSync(path.dirname(stateFile), {
    recursive: true,
  });

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

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(
    process.execPath,
    [serverFile],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        LUKE_AI_HOST: "127.0.0.1",
        LUKE_AI_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  try {
    await waitForServer(baseUrl, child);

    const createResult = await requestJson(
      baseUrl,
      "/api/runtime/install/jobs",
      {
        method: "POST",
        body: {
          dependencyId: "video-runtime",
        },
      }
    );

    if (
      createResult.status !== 201 ||
      !createResult.data?.job?.id ||
      createResult.data.job.state !== "queued"
    ) {
      throw new Error(
        `Create job failed: ${createResult.text}`
      );
    }

    const jobId = createResult.data.job.id;

    const duplicateResult = await requestJson(
      baseUrl,
      "/api/runtime/install/jobs",
      {
        method: "POST",
        body: {
          dependencyId: "video-runtime",
        },
      }
    );

    if (duplicateResult.status !== 409) {
      throw new Error(
        "Duplicate active job was not rejected."
      );
    }

    const transitions = [
      ["preparing", 5],
      ["downloading", 40],
      ["verifying", 75],
      ["installing", 90],
      ["completed", 100],
    ];

    for (const [state, percent] of transitions) {
      const updateResult = await requestJson(
        baseUrl,
        `/api/runtime/install/jobs/${jobId}`,
        {
          method: "PATCH",
          body: {
            state,
            progress: {
              percent,
              downloadedBytes: percent * 1000,
              totalBytes: 100000,
              speedBytesPerSecond: 25000,
            },
          },
        }
      );

      if (
        updateResult.status !== 200 ||
        updateResult.data?.job?.state !== state
      ) {
        throw new Error(
          `Transition to ${state} failed: ` +
          updateResult.text
        );
      }
    }

    const invalidTransition = await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${jobId}`,
      {
        method: "PATCH",
        body: {
          state: "downloading",
        },
      }
    );

    if (invalidTransition.status !== 409) {
      throw new Error(
        "Invalid terminal-state transition was accepted."
      );
    }

    const getResult = await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${jobId}`
    );

    if (
      getResult.status !== 200 ||
      getResult.data?.job?.progress?.percent !== 100
    ) {
      throw new Error(
        "Completed job status is invalid."
      );
    }

    const listResult = await requestJson(
      baseUrl,
      "/api/runtime/install/jobs"
    );

    if (
      listResult.status !== 200 ||
      !Array.isArray(listResult.data?.jobs) ||
      listResult.data.jobs.length !== 1
    ) {
      throw new Error(
        "Runtime install job list is invalid."
      );
    }

    const cancelCreate = await requestJson(
      baseUrl,
      "/api/runtime/install/jobs",
      {
        method: "POST",
        body: {
          dependencyId: "speech-runtime",
          downloadDirectory:
            "/Volumes/EXTERNAL Drive/ai/ai-downloads",
        },
      }
    );

    const cancelJobId =
      cancelCreate.data?.job?.id;

    const cancelResult = await requestJson(
      baseUrl,
      `/api/runtime/install/jobs/${cancelJobId}/cancel`,
      {
        method: "POST",
      }
    );

    if (
      cancelResult.status !== 200 ||
      cancelResult.data?.job?.state !== "cancelled"
    ) {
      throw new Error(
        "Runtime install cancellation failed."
      );
    }

    console.log("");
    console.log(
      "PASS: Runtime install state transitions completed."
    );
    console.log(`Completed job: ${jobId}`);
    console.log(`Cancelled job: ${cancelJobId}`);
  } finally {
    await stopProcess(child);

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
    "PASS: Runtime install state API test completed."
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
