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

const outputsDirectory = path.join(
  projectRoot,
  "app",
  "outputs"
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
        `${baseUrl}/api/runtime/storage/usage`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new Error(
    "Storage usage API did not become ready."
  );
}

async function main() {
  const originalState = fs.existsSync(stateFile)
    ? fs.readFileSync(stateFile, "utf8")
    : null;

  const testDirectory = path.join(
    outputsDirectory,
    `.cleanup-test-${Date.now()}`
  );

  // LUKE_AI_RUNTIME_STORAGE_CLEANUP_TEST_PATH_FIX_V1
  const activeJobId =
    "runtime-cleanup-protection-test";

  const protectedDirectory = path.join(
    outputsDirectory,
    ".luke-runtime",
    activeJobId
  );

  const removableFile = path.join(
    testDirectory,
    "remove-me.bin"
  );

  const protectedFile = path.join(
    protectedDirectory,
    "download.part"
  );

  // LUKE_AI_RUNTIME_STORAGE_CLEANUP_TEST_DIRECTORY_FIX_V1
  fs.mkdirSync(testDirectory, {
    recursive: true,
  });

  fs.mkdirSync(protectedDirectory, {
    recursive: true,
  });

  fs.writeFileSync(
    removableFile,
    Buffer.alloc(8192, 1)
  );

  fs.writeFileSync(
    protectedFile,
    Buffer.alloc(4096, 2)
  );

  fs.mkdirSync(path.dirname(stateFile), {
    recursive: true,
  });

  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        jobs: [
          {
            id: activeJobId,
            dependencyId: "video-runtime",
            state: "downloading",
            progress: {
              percent: 25,
              downloadedBytes: 4096,
              totalBytes: 16384,
              speedBytesPerSecond: 1024,
            },
            downloadDirectory: outputsDirectory,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
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

    const usageResult = await requestJson(
      baseUrl,
      "/api/runtime/storage/usage"
    );

    if (
      usageResult.status !== 200 ||
      usageResult.data?.ok !== true ||
      !Array.isArray(
        usageResult.data?.categories
      )
    ) {
      throw new Error(
        `Storage usage failed: ${usageResult.text}`
      );
    }

    const outputsCategory =
      usageResult.data.categories.find(
        (category) =>
          category.id === "outputs"
      );

    if (
      !outputsCategory ||
      outputsCategory.sizeBytes < 12288
    ) {
      throw new Error(
        "Output storage usage was not calculated."
      );
    }

    const dryRun = await requestJson(
      baseUrl,
      "/api/runtime/storage/cleanup",
      {
        method: "POST",
        body: {
          categoryId: "outputs",
          dryRun: true,
        },
      }
    );

    if (
      dryRun.status !== 200 ||
      dryRun.data?.dryRun !== true ||
      dryRun.data?.cleanup?.deletedFiles < 1
    ) {
      throw new Error(
        `Cleanup dry run failed: ${dryRun.text}`
      );
    }

    if (
      !fs.existsSync(removableFile) ||
      !fs.existsSync(protectedFile)
    ) {
      throw new Error(
        "Dry run modified storage files."
      );
    }

    const cleanupResult = await requestJson(
      baseUrl,
      "/api/runtime/storage/cleanup",
      {
        method: "POST",
        body: {
          categoryId: "outputs",
          dryRun: false,
        },
      }
    );

    if (
      cleanupResult.status !== 200 ||
      cleanupResult.data?.dryRun !== false
    ) {
      throw new Error(
        `Cleanup execution failed: ${cleanupResult.text}`
      );
    }

    if (fs.existsSync(removableFile)) {
      throw new Error(
        "Cleanable output file was not deleted."
      );
    }

    if (!fs.existsSync(protectedFile)) {
      throw new Error(
        "Active runtime file was incorrectly deleted."
      );
    }

    if (
      !Array.isArray(
        cleanupResult.data?.cleanup?.skippedProtected
      ) ||
      cleanupResult.data.cleanup.skippedProtected.length < 1
    ) {
      throw new Error(
        "Protected runtime path was not reported."
      );
    }

    const modelsCleanup = await requestJson(
      baseUrl,
      "/api/runtime/storage/cleanup",
      {
        method: "POST",
        body: {
          categoryId: "models",
          dryRun: false,
        },
      }
    );

    if (modelsCleanup.status !== 403) {
      throw new Error(
        "Protected models category accepted cleanup."
      );
    }

    const unknownCleanup = await requestJson(
      baseUrl,
      "/api/runtime/storage/cleanup",
      {
        method: "POST",
        body: {
          categoryId: "../../",
          dryRun: false,
        },
      }
    );

    if (unknownCleanup.status !== 404) {
      throw new Error(
        "Unsafe cleanup category was not rejected."
      );
    }

    console.log("");
    console.log(
      "PASS: Runtime storage usage calculated."
    );
    console.log(
      "PASS: Cleanup dry run completed without deletion."
    );
    console.log(
      "PASS: Cleanable storage file deleted."
    );
    console.log(
      "PASS: Active runtime file remained protected."
    );
    console.log(
      "PASS: Cleanup category remained available with protected descendants."
    );
    console.log(
      "PASS: Protected models category rejected cleanup."
    );
    console.log(
      "PASS: Unsafe cleanup category rejected."
    );
  } finally {
    await stopProcess(child);

    fs.rmSync(testDirectory, {
      recursive: true,
      force: true,
    });

    fs.rmSync(protectedDirectory, {
      recursive: true,
      force: true,
    });

    const runtimeTestRoot = path.join(
      outputsDirectory,
      ".luke-runtime"
    );

    if (
      fs.existsSync(runtimeTestRoot) &&
      fs.readdirSync(runtimeTestRoot).length === 0
    ) {
      fs.rmdirSync(runtimeTestRoot);
    }

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
    "PASS: Runtime storage cleanup test completed."
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
