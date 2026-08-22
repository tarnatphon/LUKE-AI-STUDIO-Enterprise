#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

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

const queueFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-models",
  "download-queue.json"
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
      const result = await fetch(
        `${baseUrl}/api/text-models/catalog`
      );

      if (result.status === 200) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new Error(
    "Text model catalog API did not become ready."
  );
}

async function main() {
  const originalQueue =
    fs.readFileSync(queueFile, "utf8");

  fs.writeFileSync(
    queueFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        activeItemId: null,
        items: [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const port = await getFreePort();
  const baseUrl =
    `http://127.0.0.1:${port}`;

  const child = spawn(
    process.execPath,
    [serverFile],
    {
      cwd: root,
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
    await waitForServer(
      baseUrl,
      child
    );

    const catalogResult =
      await requestJson(
        baseUrl,
        "/api/text-models/catalog"
      );

    if (
      catalogResult.status !== 200 ||
      !Array.isArray(
        catalogResult.data?.models
      ) ||
      !catalogResult.data.models.some(
        (model) =>
          model.id === "qwen3-4b"
      )
    ) {
      throw new Error(
        "Text model catalog response is invalid."
      );
    }

    const queueResult =
      await requestJson(
        baseUrl,
        "/api/text-models/download-queue"
      );

    if (
      queueResult.status !== 200 ||
      queueResult.data?.policy
        ?.maximumBatchSelection !== 3 ||
      queueResult.data?.policy
        ?.maximumConcurrentDownloads !== 1
    ) {
      throw new Error(
        "Text model queue policy is invalid."
      );
    }

    console.log("");
    console.log(
      "PASS: Text model catalog API responded."
    );
    console.log(
      "PASS: Official Qwen model is present."
    );
    console.log(
      "PASS: Maximum queue selection is three."
    );
    console.log(
      "PASS: Download concurrency is one."
    );
    console.log(
      "PASS: Text model catalog API validation completed."
    );
  } finally {
    await stopProcess(child);

    fs.writeFileSync(
      queueFile,
      originalQueue,
      "utf8"
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack || error.message
      : String(error)
  );

  process.exit(1);
});
