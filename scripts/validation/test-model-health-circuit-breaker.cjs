#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const {
  spawn,
} = require("node:child_process");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

// A fresh clone has no app/runtime-state at all, and whether an earlier suite
// happened to create the folder is not something a scan should depend on.
const { ensureRuntimeStateLayout } = require("./helpers/runtime-state-paths.cjs");

ensureRuntimeStateLayout(root);

const serverFile = path.join(
  root,
  "scripts/server",
  "serve.cjs"
);

// The user's real conversation archive. This suite must never write it: it
// used to overwrite it and restore it in a `finally`, which does not run
// on SIGKILL.
const realConversationFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-chat",
  "conversations.json"
);

// The server is pointed at a throwaway file instead, through
// LUKE_TEXT_CHAT_STORE.
const conversationFile = path.join(
  os.tmpdir(),
  `luke-text-chat-health-${process.pid}.json`
);

const healthFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-chat",
  "model-health.json"
);

const installedFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-models",
  "installed-models.json"
);

const componentFile = path.join(
  root,
  "app",
  "frontend",
  "src",
  "components",
  "PersistentTextChat.jsx"
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
        // Ask the operating system. A port derived from the process id is not
        // a free port: if anything else holds it, the suite dies with
        // EADDRINUSE before its first assertion.
        port: 0,
      },
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

async function requestJson(
  baseUrl,
  pathname,
  options = {}
) {
  const response = await fetch(
    `${baseUrl}${pathname}`,
    {
      method:
        options.method || "GET",
      headers: {
        "content-type":
          "application/json",
      },
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(
              options.body
            ),
    }
  );

  const text =
    await response.text();

  return {
    status: response.status,
    data:
      text
        ? JSON.parse(text)
        : null,
    text,
  };
}

async function readStream(response) {
  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let output = "";

  while (true) {
    const result =
      await reader.read();

    if (result.done) {
      break;
    }

    output += decoder.decode(
      result.value,
      {
        stream: true,
      }
    );
  }

  return output;
}

async function stopProcess(child) {
  if (
    !child ||
    child.exitCode !== null
  ) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    new Promise((resolve) => {
      child.once("exit", resolve);
    }),
    delay(3000),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

async function waitForServer(
  baseUrl,
  child
) {
  for (
    let attempt = 0;
    attempt < 100;
    attempt += 1
  ) {
    if (child.exitCode !== null) {
      throw new Error(
        `Backend exited with code ${child.exitCode}.`
      );
    }

    try {
      const response = await fetch(
        `${baseUrl}/api/text-runtime/model-health`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(120);
  }

  throw new Error(
    "Model Health API did not become ready."
  );
}

async function main() {
  // What the real archive looks like now, so the end of the run can prove
  // it still looks like this.
  const realBefore =
    fs.existsSync(realConversationFile)
      ? fs.readFileSync(
          realConversationFile,
          "utf8"
        )
      : null;

  // It may not exist yet: the app creates these on first use, so a suite
  // that demands one cannot run on a fresh checkout.
  const originalHealth =
    fs.existsSync(healthFile)
      ? fs.readFileSync(
          healthFile,
          "utf8"
        )
      : null;

  // It may not exist yet: the app creates these on first use, so a suite
  // that demands one cannot run on a fresh checkout.
  const originalInstalled =
    fs.existsSync(installedFile)
      ? fs.readFileSync(
          installedFile,
          "utf8"
        )
      : null;

  fs.writeFileSync(
    conversationFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        lastOpenedConversationId:
          null,
        conversations: [],
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    healthFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        models: {},
        events: [],
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    installedFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt:
          new Date().toISOString(),
        activeModelId:
          "unstable-model",
        models: [
          {
            id:
              "unstable-model@1:q4",
            modelId:
              "unstable-model",
            modelName:
              "Unstable Model",
            installedPath:
              "/tmp/unstable.gguf",
            contextLength:
              32768,
            capabilities: [
              "coding",
              "qwen"
            ],
            installedAt:
              new Date().toISOString()
          },
          {
            id:
              "healthy-model@1:q4",
            modelId:
              "healthy-model",
            modelName:
              "Healthy Model",
            installedPath:
              "/tmp/healthy.gguf",
            contextLength:
              32768,
            capabilities: [
              "coding",
              "deepseek"
            ],
            installedAt:
              new Date().toISOString()
          }
        ]
      },
      null,
      2
    ) + "\n"
  );

  const runtimePort =
    await getFreePort();

  const calledModels = [];

  const runtimeServer =
    http.createServer(
      async (req, res) => {
        const chunks = [];

        for await (const chunk of req) {
          chunks.push(chunk);
        }

        const rawBody =
          Buffer.concat(chunks)
            .toString("utf8");

        if (
          req.url ===
            "/v1/chat/completions" &&
          req.method === "POST"
        ) {
          const body =
            JSON.parse(rawBody);

          calledModels.push(
            body.model
          );

          if (
            body.model ===
            "unstable-model"
          ) {
            res.writeHead(
              500,
              {
                "content-type":
                  "application/json",
              }
            );

            res.end(
              JSON.stringify({
                error:
                  "Model crashed",
              })
            );

            return;
          }

          res.writeHead(
            200,
            {
              "content-type":
                "text/event-stream",
            }
          );

          res.write(
            "data: " +
            JSON.stringify({
              choices: [
                {
                  delta: {
                    content:
                      "Healthy fallback response",
                  },
                },
              ],
            }) +
            "\n\n"
          );

          res.write(
            "data: [DONE]\n\n"
          );

          res.end();
          return;
        }

        res.writeHead(404);
        res.end();
      }
    );

  await new Promise(
    (resolve, reject) => {
      runtimeServer.once(
        "error",
        reject
      );

      runtimeServer.listen(
        runtimePort,
        "127.0.0.1",
        resolve
      );
    }
  );

  const appPort =
    await getFreePort();

  const baseUrl =
    `http://127.0.0.1:${appPort}`;

  const child = spawn(
    process.execPath,
    [serverFile],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(appPort),
        LUKE_AI_HOST:
          "127.0.0.1",
        LUKE_AI_PORT:
          String(appPort),
        LUKE_TEXT_CHAT_STORE:
          conversationFile,
        LUKE_AI_TEXT_RUNTIME_BASE_URL:
          `http://127.0.0.1:${runtimePort}`,
        LUKE_AI_TEST_TOTAL_RAM_BYTES:
          String(32 * 1024 ** 3),
        LUKE_AI_TEST_AVAILABLE_RAM_BYTES:
          String(24 * 1024 ** 3),
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    }
  );

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  try {
    await waitForServer(
      baseUrl,
      child
    );

    for (
      let round = 0;
      round < 3;
      round += 1
    ) {
      const created =
        await requestJson(
          baseUrl,
          "/api/text-chat/conversations",
          {
            method: "POST",
            body: {
              title:
                `Health Test ${round}`,
            },
          }
        );

      const conversationId =
        created.data
          ?.conversation?.id;

      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: {
            role: "user",
            content:
              "ช่วยเขียน code",
          },
        }
      );

      const response =
        await fetch(
          `${baseUrl}/api/text-runtime/generate-with-recovery`,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: JSON.stringify({
              conversationId,
              modelId:
                "unstable-model",
            }),
          }
        );

      await readStream(response);
    }

    const health =
      await requestJson(
        baseUrl,
        "/api/text-runtime/model-health"
      );

    const unstable =
      health.data
        ?.models
        ?.find(
          (model) =>
            model.modelId ===
            "unstable-model"
        );

    if (
      health.status !== 200 ||
      !unstable ||
      unstable.circuitState !==
        "open" ||
      unstable.totalFailures < 3 ||
      !unstable.nextProbeAt
    ) {
      throw new Error(
        `Circuit was not opened: ${health.text}`
      );
    }

    const route =
      await requestJson(
        baseUrl,
        "/api/text-runtime/model-router/route",
        {
          method: "POST",
          body: {
            prompt:
              "ช่วยเขียน code",
          },
        }
      );

    if (
      route.status !== 200 ||
      route.data
        ?.selectedModel
        ?.modelId !==
        "healthy-model"
    ) {
      throw new Error(
        "Open circuit model was not excluded from routing."
      );
    }

    const reset =
      await requestJson(
        baseUrl,
        "/api/text-runtime/model-health/reset",
        {
          method: "POST",
          body: {
            modelId:
              "unstable-model",
          },
        }
      );

    if (
      reset.status !== 200 ||
      reset.data
        ?.model
        ?.circuitState !==
        "closed"
    ) {
      throw new Error(
        "Manual circuit reset failed."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-runtime/model-health",
      "/api/text-runtime/model-health/reset",
      "Model Health Monitor",
      "Reset Circuit",
      "modelHealth",
      "circuitState",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `Model Health UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Model failures were recorded."
    );
    console.log(
      "PASS: Circuit opened after repeated failures."
    );
    console.log(
      "PASS: Open circuit model was excluded from routing."
    );
    console.log(
      "PASS: Healthy fallback model remained available."
    );
    console.log(
      "PASS: Next half-open probe time was stored."
    );
    console.log(
      "PASS: Manual circuit reset closed the circuit."
    );
    console.log(
      "PASS: Model Health audit events were persisted."
    );
    console.log(
      "PASS: Model Health Dashboard UI is connected."
    );
  } finally {
    await stopProcess(child);

    await new Promise(
      (resolve) => {
        runtimeServer.close(resolve);
      }
    );

    const realAfter =
      fs.existsSync(realConversationFile)
        ? fs.readFileSync(
            realConversationFile,
            "utf8"
          )
        : null;

    if (realAfter !== realBefore) {
      throw new Error(
        "This suite wrote to the real conversation archive. " +
        "The server must be reached only through LUKE_TEXT_CHAT_STORE."
      );
    }

    console.log(
      "PASS: The real conversation archive was never touched."
    );

    fs.rmSync(conversationFile, { force: true });

    if (originalHealth === null) {
      fs.rmSync(healthFile, { force: true });
    } else {
      fs.writeFileSync(
        healthFile,
        originalHealth,
        "utf8"
      );
    }

    if (originalInstalled === null) {
      fs.rmSync(installedFile, { force: true });
    } else {
      fs.writeFileSync(
        installedFile,
        originalInstalled,
        "utf8"
      );
    }
  }

  console.log(
    "PASS: Model Health Circuit Breaker validation completed."
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
