#!/usr/bin/env node
"use strict";

let testPortOffset = 0;

const fs = require("node:fs");
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

const catalogFile = path.join(
  projectRoot,
  "app",
  "config",
  "runtime-dependencies.json"
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
        `${baseUrl}/api/runtime/storage`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new Error(
    "Runtime storage API did not become ready."
  );
}

async function main() {
  const originalCatalog =
    fs.readFileSync(catalogFile, "utf8");

  const testRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "luke-storage-test-"
    )
  );

  const missingExternal = path.join(
    testRoot,
    "missing-external",
    "ai-downloads"
  );

  const fallbackDirectory = path.join(
    testRoot,
    "fallback"
  );

  const catalog =
    JSON.parse(originalCatalog);

  catalog.defaultDownloadDirectory =
    missingExternal;

  catalog.fallbackDownloadDirectory =
    fallbackDirectory;

  catalog.storagePolicy = {
    ...(catalog.storagePolicy || {}),
    fallbackWhenUnavailable: true,
    createDirectoryWhenWritable: true,
    requireWritableDirectory: true,
    minimumFreeBytes: 0,
  };

  fs.writeFileSync(
    catalogFile,
    JSON.stringify(
      catalog,
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
    await waitForServer(
      baseUrl,
      child
    );

    const statusResponse = await fetch(
      `${baseUrl}/api/runtime/storage`
    );

    const statusData =
      await statusResponse.json();

    if (
      statusResponse.status !== 200 ||
      statusData.ok !== true ||
      statusData.usingFallback !== true ||
      statusData.selectedDirectory !==
        fallbackDirectory ||
      statusData.reason !==
        "external-drive-not-mounted"
    ) {
      throw new Error(
        "Runtime storage fallback status is invalid."
      );
    }

    if (
      !fs.existsSync(fallbackDirectory)
    ) {
      throw new Error(
        "Fallback directory was not created."
      );
    }

    const resolveResponse = await fetch(
      `${baseUrl}/api/runtime/storage/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    const resolveData =
      await resolveResponse.json();

    if (
      resolveResponse.status !== 200 ||
      resolveData.selectedDirectory !==
        fallbackDirectory ||
      resolveData.usingFallback !== true
    ) {
      throw new Error(
        "Runtime storage resolve API is invalid."
      );
    }

    // LUKE_AI_RUNTIME_STORAGE_MOUNT_TEST_V1
    if (fs.existsSync(missingExternal)) {
      throw new Error(
        "Runtime storage resolver created a false external drive path."
      );
    }

    if (
      resolveData.external?.volumeMounted !== false ||
      resolveData.externalDirectoryCreationAllowed !== false
    ) {
      throw new Error(
        "External drive mount guard status is invalid."
      );
    }

    console.log("");
    console.log(
      "PASS: External drive absence detected."
    );
    console.log(
      "PASS: Safe fallback directory selected."
    );
    console.log(
      "PASS: Safe fallback directory created."
    );
    console.log(
      "PASS: Runtime storage resolve API completed."
    );
    console.log(
      "PASS: Missing external volume was not created."
    );
    console.log(
      "PASS: External volume mount guard completed."
    );
  } finally {
    await stopProcess(child);

    fs.writeFileSync(
      catalogFile,
      originalCatalog,
      "utf8"
    );

    fs.rmSync(
      testRoot,
      {
        recursive: true,
        force: true,
      }
    );
  }

  console.log(
    "PASS: Runtime storage availability test completed."
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
