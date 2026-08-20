#!/usr/bin/env node
"use strict";

let testPortOffset = 0;

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
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

const catalogFile = path.join(
  root,
  "app",
  "config",
  "text-models",
  "signed-catalog.json"
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

    server.once("error", reject);

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
      child.once("exit", () => {
        resolve(true);
      });
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

  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
    text,
  };
}

async function waitForServer(baseUrl, child) {
  for (
    let attempt = 0;
    attempt < 80;
    attempt += 1
  ) {
    if (child.exitCode !== null) {
      throw new Error(
        `Backend exited with code ${child.exitCode}.`
      );
    }

    try {
      const response = await fetch(
        `${baseUrl}/api/text-models/download-queue`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(150);
  }

  throw new Error(
    "Backend did not become ready."
  );
}

async function waitForCompleted(
  baseUrl,
  expectedCount
) {
  const startedAt = Date.now();

  while (
    Date.now() - startedAt < 30000
  ) {
    const result = await requestJson(
      baseUrl,
      "/api/text-models/download-queue"
    );

    const items =
      result.data?.queue?.items || [];

    const activeItems = items.filter(
      (item) =>
        [
          "downloading",
          "verifying",
        ].includes(item.state)
    );

    if (activeItems.length > 1) {
      throw new Error(
        "More than one model downloaded concurrently."
      );
    }

    const failed = items.find(
      (item) => item.state === "failed"
    );

    if (failed) {
      throw new Error(
        failed.error?.message ||
        "Queue item failed."
      );
    }

    if (
      items.filter(
        (item) => item.state === "completed"
      ).length === expectedCount
    ) {
      return items;
    }

    await delay(100);
  }

  throw new Error(
    "Sequential model queue timed out."
  );
}

async function main() {
  const originalCatalog =
    fs.readFileSync(catalogFile, "utf8");

  const originalQueue =
    fs.readFileSync(queueFile, "utf8");

  const testHome = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "luke-text-worker-"
    )
  );

  const payloads = [
    Buffer.alloc(128 * 1024, 1),
    Buffer.alloc(96 * 1024, 2),
    Buffer.alloc(64 * 1024, 3),
  ];

  const hashes = payloads.map(
    (payload) =>
      crypto
        .createHash("sha256")
        .update(payload)
        .digest("hex")
  );

  const assetPort = await getFreePort();

  const assetServer = http.createServer(
    (req, res) => {
      const match = req.url?.match(
        /^\/model-(\d)\.gguf$/
      );

      if (!match) {
        res.writeHead(404);
        res.end();
        return;
      }

      const index = Number(match[1]) - 1;
      const payload = payloads[index];

      if (!payload) {
        res.writeHead(404);
        res.end();
        return;
      }

      const rangeMatch =
        req.headers.range?.match(
          /^bytes=(\d+)-$/
        );

      const start = rangeMatch
        ? Number(rangeMatch[1])
        : 0;

      const body = payload.subarray(start);

      res.writeHead(
        start > 0 ? 206 : 200,
        {
          "content-type":
            "application/octet-stream",
          "content-length":
            String(body.length),
          ...(start > 0
            ? {
                "content-range":
                  `bytes ${start}-${payload.length - 1}/${payload.length}`,
              }
            : {}),
        }
      );

      let offset = 0;

      const timer = setInterval(() => {
        if (offset >= body.length) {
          clearInterval(timer);
          res.end();
          return;
        }

        const end = Math.min(
          offset + 4096,
          body.length
        );

        res.write(
          body.subarray(offset, end)
        );

        offset = end;
      }, 3);

      req.on("close", () => {
        clearInterval(timer);
      });
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

  const catalog = {
    schemaVersion: 1,
    catalogId: "worker-test",
    catalogVersion: "test",
    trust: {
      mode: "test",
      allowedHosts: ["127.0.0.1"],
      allowedPublishers: ["LUKE-Test"],
    },
    models: payloads.map(
      (payload, index) => ({
        id: `test-model-${index + 1}`,
        publisher: "LUKE-Test",
        name: {
          en: `Test Model ${index + 1}`,
        },
        format: "gguf",
        runtime: "llama.cpp",
        version: "1.0.0",
        recommendedVariant: "q4",
        variants: [
          {
            id: "q4",
            quantization: "Q4_K_M",
            filename:
              `model-${index + 1}.gguf`,
            sizeBytes: payload.length,
            download: {
              provider: "test",
              url:
                `http://127.0.0.1:${assetPort}/model-${index + 1}.gguf`,
              sha256: hashes[index],
              resolveSha256FromMetadata:
                false,
            },
          },
        ],
      }))
  };

  fs.writeFileSync(
    catalogFile,
    JSON.stringify(catalog, null, 2) + "\n",
    "utf8"
  );

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

  const backendPort = await getFreePort();
  const baseUrl =
    `http://127.0.0.1:${backendPort}`;

  const child = spawn(
    process.execPath,
    [serverFile],
    {
      cwd: root,
      env: {
        ...process.env,
        HOME: testHome,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(backendPort),
        LUKE_AI_HOST: "127.0.0.1",
        LUKE_AI_PORT: String(backendPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  try {
    await waitForServer(baseUrl, child);

    for (
      let index = 0;
      index < 3;
      index += 1
    ) {
      const result = await requestJson(
        baseUrl,
        "/api/text-models/download-queue",
        {
          method: "POST",
          body: {
            modelId:
              `test-model-${index + 1}`,
            variantId: "q4",
          },
        }
      );

      if (result.status !== 201) {
        throw new Error(
          `Unable to enqueue model: ${result.text}`
        );
      }
    }

    const completedItems =
      await waitForCompleted(baseUrl, 3);

    for (const item of completedItems) {
      if (
        item.state !== "completed" ||
        item.checksum?.verified !== true ||
        !item.installedPath ||
        !fs.existsSync(item.installedPath)
      ) {
        throw new Error(
          "Completed model item is invalid."
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Three text models entered the queue."
    );
    console.log(
      "PASS: Only one text model downloaded at a time."
    );
    console.log(
      "PASS: Queue started the next model automatically."
    );
    console.log(
      "PASS: SHA256 verification passed for every model."
    );
    console.log(
      "PASS: Models installed into managed storage."
    );
  } finally {
    await stopProcess(child);

    await new Promise((resolve) => {
      assetServer.close(resolve);
    });

    fs.writeFileSync(
      catalogFile,
      originalCatalog,
      "utf8"
    );

    fs.writeFileSync(
      queueFile,
      originalQueue,
      "utf8"
    );

    fs.rmSync(
      testHome,
      {
        recursive: true,
        force: true,
      }
    );
  }

  console.log(
    "PASS: Sequential text model download worker validation completed."
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
