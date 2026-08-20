#!/usr/bin/env node
"use strict";

let testPortOffset = 0;

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
        port: 38000 + ((process.pid + testPortOffset++) % 2000),
      },
      () => {
        const address = server.address();

        if (
          !address ||
          typeof address === "string"
        ) {
          reject(
            new Error(
              "Unable to allocate runtime test port."
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

async function main() {
  if (!fs.existsSync(serverFile)) {
    throw new Error(
      `Backend server is missing: ${serverFile}`
    );
  }

  const port = await getFreePort();

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

  child.stdout.on("data", (chunk) => {
    process.stdout.write(
      `[backend] ${chunk.toString()}`
    );
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(
      `[backend] ${chunk.toString()}`
    );
  });

  const endpoint =
    `http://127.0.0.1:${port}` +
    "/api/runtime/dependencies";

  try {
    let response = null;

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
        response = await fetch(endpoint);

        if (response.status === 200) {
          break;
        }
      } catch {}

      await delay(500);
    }

    if (!response || response.status !== 200) {
      throw new Error(
        "Runtime dependency API did not become ready."
      );
    }

    const data = await response.json();

    if (!Array.isArray(data.dependencies)) {
      throw new Error(
        "Runtime dependency API returned no catalog."
      );
    }

    const expectedIds = [
      "portable-node",
      "portable-npm",
      "portable-npx",
      "image-runtime",
      "video-runtime",
      "speech-runtime",
      "tts-runtime",
    ];

    const returnedIds = new Set(
      data.dependencies.map(
        (dependency) => dependency.id
      )
    );

    for (const id of expectedIds) {
      if (!returnedIds.has(id)) {
        throw new Error(
          `Missing dependency: ${id}`
        );
      }
    }

    if (
      !data.summary ||
      data.summary.total !==
        data.dependencies.length
    ) {
      throw new Error(
        "Runtime dependency summary is invalid."
      );
    }

    if (
      data.defaultDownloadDirectory !==
      "/Volumes/EXTERNAL Drive/ai/ai-downloads"
    ) {
      throw new Error(
        "Default download directory is incorrect."
      );
    }

    console.log("");
    console.log(
      "PASS: Runtime dependency catalog API responded."
    );
    console.log(
      `Dependencies     : ${data.summary.total}`
    );
    console.log(
      `Ready            : ${data.summary.ready}`
    );
    console.log(
      `Missing          : ${data.summary.missing}`
    );
    console.log(
      `Required missing : ${data.summary.requiredMissing}`
    );
  } finally {
    await stopProcess(child);
  }

  console.log("");
  console.log(
    "PASS: Runtime dependency API test completed."
  );
}

main().catch((error) => {
  console.error("");
  console.error(
    error instanceof Error
      ? error.stack || error.message
      : String(error)
  );

  process.exit(1);
});
