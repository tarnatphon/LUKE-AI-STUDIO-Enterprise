#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..", "..");
const serverFile = path.join(
  projectRoot,
  "scripts",
  "server",
  "serve.cjs"
);

const startupTimeoutMs = Number(
  process.env.LUKE_API_TEST_TIMEOUT_MS || 30000
);

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function canReservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();

    server.on("error", (error) => {
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.listen(
      {
        // Match serve.cjs, which binds the frontend server on every IPv4 interface.
        // Probing loopback alone can select a port already occupied elsewhere.
        host: "0.0.0.0",
        port,
      },
      () => {
        const address = server.address();

        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Unable to allocate test port."));
          return;
        }

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(true);
        });
      }
    );
  });
}

async function getFreePort() {
  const minimum = 38000;
  const range = 2000;
  const startOffset = process.pid % range;

  for (let offset = 0; offset < range; offset += 1) {
    const port = minimum + ((startOffset + offset) % range);
    if (await canReservePort(port)) return port;
  }

  throw new Error("Unable to allocate a non-ephemeral test port.");
}

function discoverHealthEndpoints(source) {
  // LUKE_AI_BACKEND_TEST_LIFECYCLE_V2
  // Only API routes may be used for backend readiness checks.
  // Frontend SPA fallback routes such as /health must never count.
  const candidates = new Set([
    "/api/health",
    "/api/status",
  ]);

  const patterns = [
    /["'`](\/api\/(?:health|status|ready|ping))["'`]/gi,
    /["'`](\/(?:health|status|ready|ping))["'`]/gi,
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(source)) !== null) {
      candidates.add(match[1]);
    }
  }

  return Array.from(candidates);
}

async function requestEndpoint(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      redirect: "manual",
      signal: controller.signal,
    });

    const body = await response.text();

    let json = null;

    try {
      json = body ? JSON.parse(body) : null;
    } catch {}

    return {
      transportOk: true,
      status: response.status,
      body: body.slice(0, 1000),
      json,
      contentType: response.headers.get("content-type") || "",
    };
  } catch (error) {
    return {
      transportOk: false,
      status: 0,
      body: error instanceof Error
        ? error.message
        : String(error),
      json: null,
      contentType: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isApiReady(endpoint, result) {
  if (
    !endpoint.startsWith("/api/") ||
    !result.transportOk ||
    result.status !== 200
  ) {
    return false;
  }

  if (
    !result.contentType.toLowerCase().includes("application/json") ||
    !result.json ||
    typeof result.json !== "object"
  ) {
    return false;
  }

  return true;
}

function dependencyHealthIsHealthy(endpoint, result) {
  if (endpoint !== "/api/health") {
    return true;
  }

  return result.json && result.json.ok === true;
}

async function runNegativeTests(baseUrl) {
  const tests = [];

  const missingRoute = await requestEndpoint(
    `${baseUrl}/api/__luke_missing_route__`
  );

  tests.push({
    name: "Unknown API route",
    passed:
      missingRoute.transportOk &&
      [404, 405].includes(missingRoute.status),
    expected: "HTTP 404 or 405",
    actual: `HTTP ${missingRoute.status}`,
    body: missingRoute.body,
  });

  const unsupportedMethod = await requestEndpoint(
    `${baseUrl}/api/health`,
    {
      method: "DELETE",
    }
  );

  tests.push({
    name: "Unsupported health method",
    passed:
      unsupportedMethod.transportOk &&
      [400, 404, 405].includes(unsupportedMethod.status),
    expected: "HTTP 400, 404 or 405",
    actual: `HTTP ${unsupportedMethod.status}`,
    body: unsupportedMethod.body,
  });

  const invalidJson = await requestEndpoint(
    `${baseUrl}/api/settings`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid-json",
    }
  );

  tests.push({
    name: "Invalid JSON payload",
    passed:
      invalidJson.transportOk &&
      [400, 404, 405, 415, 422].includes(invalidJson.status),
    expected: "HTTP 400, 404, 405, 415 or 422",
    actual: `HTTP ${invalidJson.status}`,
    body: invalidJson.body,
  });

  console.log("");
  console.log("Negative API tests:");

  for (const test of tests) {
    console.log(`${test.passed ? "PASS" : "FAIL"}: ${test.name}`);
    console.log(`  Expected: ${test.expected}`);
    console.log(`  Actual  : ${test.actual}`);

    if (test.body) {
      console.log(`  Body    : ${test.body.slice(0, 300)}`);
    }
  }

  const failedTests = tests.filter((test) => !test.passed);

  if (failedTests.length > 0) {
    throw new Error(
      `${failedTests.length} negative API test(s) failed.`
    );
  }

  console.log("");
  console.log("PASS: Backend negative API tests completed.");
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
    throw new Error(`Backend server not found: ${serverFile}`);
  }

  const source = fs.readFileSync(serverFile, "utf8");
  const endpoints = discoverHealthEndpoints(source);
  const port = await getFreePort();

  console.log("LUKE AI STUDIO Backend API Smoke Test");
  console.log(`Server : ${serverFile}`);
  console.log(`Port   : ${port}`);
  console.log(`Routes : ${endpoints.join(", ")}`);

  const output = [];
  const childEnv = { ...process.env };
  delete childEnv.LUKE_AI_I2V_VALIDATION_PYTHON;

  const child = spawn(
    process.execPath,
    [serverFile],
    {
      cwd: projectRoot,
      env: {
        ...childEnv,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        LUKE_AI_HOST: "127.0.0.1",
        LUKE_AI_PORT: String(port),
        LOCAL_AI_HOST: "127.0.0.1",
        LOCAL_AI_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output.push(text);
    process.stdout.write(`[backend] ${text}`);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    output.push(text);
    process.stderr.write(`[backend] ${text}`);
  });

  let passed = false;
  let selectedEndpoint = "";
  let selectedResult = null;
  let lastResult = null;

  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt < startupTimeoutMs) {
      if (child.exitCode !== null) {
        throw new Error(
          `Backend exited before becoming ready. Exit code: ${child.exitCode}`
        );
      }

      for (const endpoint of endpoints) {
        const url = `http://127.0.0.1:${port}${endpoint}`;
        const result = await requestEndpoint(url);

        lastResult = result;

        if (isApiReady(endpoint, result)) {
          passed = true;
          selectedEndpoint = endpoint;
          selectedResult = result;

          console.log("");
          console.log(`PASS: Backend API ready at ${endpoint}`);
          console.log(`HTTP: ${result.status}`);

          if (result.body) {
            console.log(`Body: ${result.body}`);
          }

          if (!dependencyHealthIsHealthy(endpoint, result)) {
            console.log("");
            console.log(
              "NOTICE: Backend API is reachable, but optional runtime " +
              "dependencies are not fully installed."
            );
          }

          break;
        }
      }

      if (passed) {
        break;
      }

      await delay(500);
    }

    if (!passed) {
      console.error("");
      console.error("FAIL: Backend API did not become ready.");

      if (lastResult) {
        console.error(`Last status: ${lastResult.status}`);
        console.error(`Last result: ${lastResult.body}`);
      }

      const logs = output.join("").trim();

      if (logs) {
        console.error("");
        console.error("Backend output:");
        console.error(logs.slice(-4000));
      }

      throw new Error("Backend API readiness test failed.");
    }

    console.log("");
    console.log(
      `PASS: Backend API smoke test completed using ${selectedEndpoint}.`
    );

    await runNegativeTests(
      `http://127.0.0.1:${port}`
    );

    if (
      selectedEndpoint === "/api/health" &&
      selectedResult &&
      !dependencyHealthIsHealthy(selectedEndpoint, selectedResult)
    ) {
      console.log("");
      console.log(
        "NOTICE: Dependency health is degraded; " +
        "API lifecycle and error contracts still passed."
      );
    }
  } finally {
    await stopProcess(child);
  }

  console.log("");
  console.log("PASS: Backend process stopped after all API tests.");
  process.exit(0);
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
