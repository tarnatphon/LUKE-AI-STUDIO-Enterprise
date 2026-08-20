#!/usr/bin/env node
"use strict";

let testPortOffset = 0;

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

const catalogFile = path.join(
  root,
  "app",
  "config",
  "text-models",
  "signed-catalog.json"
);

const installedFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-models",
  "installed-models.json"
);

const queueFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-models",
  "download-queue.json"
);

const componentFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "components",
  "TextModelManager.jsx"
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
        `${baseUrl}/api/text-models/updates`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(150);
  }

  throw new Error(
    "Text Model Update API did not become ready."
  );
}

async function main() {
  const originalCatalog =
    fs.readFileSync(catalogFile, "utf8");

  const originalInstalled =
    fs.existsSync(installedFile)
      ? fs.readFileSync(installedFile, "utf8")
      : null;

  const originalQueue =
    fs.readFileSync(queueFile, "utf8");

  const catalog =
    JSON.parse(originalCatalog);

  const model =
    catalog.models.find(
      (item) =>
        item.id === "qwen3-4b"
    );

  if (!model) {
    throw new Error(
      "Qwen test model is missing."
    );
  }

  model.version = "2.0.0";

  fs.writeFileSync(
    catalogFile,
    JSON.stringify(
      catalog,
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.writeFileSync(
    installedFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt:
          new Date().toISOString(),
        activeModelId: null,
        models: [
          {
            id:
              "qwen3-4b@1.0.0:q4-k-m",
            modelId: "qwen3-4b",
            modelName: "Qwen3 4B",
            publisher: "Qwen",
            version: "1.0.0",
            variantId: "q4-k-m",
            quantization: "Q4_K_M",
            format: "gguf",
            runtime: "llama.cpp",
            installedPath:
              "/tmp/qwen-old.gguf",
            installedAt:
              new Date().toISOString(),
            active: true,
            rollbackAvailable: false
          }
        ]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.writeFileSync(
    queueFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        activeItemId: null,
        items: []
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
    await waitForServer(baseUrl, child);

    const updateResult =
      await requestJson(
        baseUrl,
        "/api/text-models/updates"
      );

    if (
      updateResult.status !== 200 ||
      updateResult.data?.summary
        ?.updatesAvailable !== 1
    ) {
      throw new Error(
        `Update summary is invalid: ${updateResult.text}`
      );
    }

    const qwenStatus =
      updateResult.data.models.find(
        (item) =>
          item.modelId === "qwen3-4b"
      );

    if (
      !qwenStatus ||
      qwenStatus.installedVersion !==
        "1.0.0" ||
      qwenStatus.latestVersion !==
        "2.0.0" ||
      qwenStatus.updateAvailable !== true
    ) {
      throw new Error(
        "Qwen update status is invalid."
      );
    }

    const staticUpdateResult =
      await requestJson(
        baseUrl,
        "/api/text-models/update",
        {
          method: "POST",
          body: {
            modelId: "missing-model",
          },
        }
      );

    if (
      staticUpdateResult.status !== 404
    ) {
      throw new Error(
        "Static Text Model Update endpoint is invalid."
      );
    }

    const installedResult =
      await requestJson(
        baseUrl,
        "/api/text-models/installed"
      );

    if (
      installedResult.status !== 200 ||
      installedResult.data?.registry
        ?.models?.length !== 1
    ) {
      throw new Error(
        "Installed Model Registry API is invalid."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-models/updates",
      // LUKE_AI_TEXT_MODEL_STATIC_UPDATE_TEST_V1
      "/api/text-models/update",
      "Update Available",
      "อัปเดตทันที",
      "rollbackAvailable",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `Update UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Installed Model Registry API responded."
    );
    console.log(
      "PASS: Automatic update comparison detected a newer version."
    );
    console.log(
      "PASS: Installed and latest versions were reported."
    );
    console.log(
      "PASS: Update Available UI is present."
    );
    console.log(
      "PASS: One-click Update action is connected."
    );
    console.log(
      "PASS: Static Text Model Update endpoint is connected."
    );
  } finally {
    await stopProcess(child);

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

    if (originalInstalled === null) {
      fs.rmSync(
        installedFile,
        {
          force: true,
        }
      );
    } else {
      fs.writeFileSync(
        installedFile,
        originalInstalled,
        "utf8"
      );
    }
  }

  console.log(
    "PASS: Text Model Update Manager validation completed."
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
