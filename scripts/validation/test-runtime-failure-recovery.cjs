#!/usr/bin/env node
"use strict";

let testPortOffset = 0;

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const {
  spawn,
} = require("node:child_process");

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

const storeFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-chat",
  "conversations.json"
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
        port: 38000 + ((process.pid + testPortOffset++) % 2000),
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

  let text = "";

  while (true) {
    const result =
      await reader.read();

    if (result.done) {
      break;
    }

    text += decoder.decode(
      result.value,
      {
        stream: true,
      }
    );
  }

  return text;
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
        `${baseUrl}/api/text-chat/conversations`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(120);
  }

  throw new Error(
    "Application server did not become ready."
  );
}

async function main() {
  const originalStore =
    fs.readFileSync(
      storeFile,
      "utf8"
    );

  const originalInstalled =
    fs.readFileSync(
      installedFile,
      "utf8"
    );

  fs.writeFileSync(
    storeFile,
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
        activeModelId:
          "primary-model",
        models: [
          {
            id:
              "primary-model@1:q4",
            modelId:
              "primary-model",
            modelName:
              "Qwen Coder Primary",
            installedPath:
              "/tmp/primary.gguf",
            contextLength:
              32768,
            capabilities: [
              "coding",
              "qwen",
            ],
            installedAt:
              new Date().toISOString()
          },
          {
            id:
              "fallback-model@1:q4",
            modelId:
              "fallback-model",
            modelName:
              "DeepSeek Coder Fallback",
            installedPath:
              "/tmp/fallback.gguf",
            contextLength:
              32768,
            capabilities: [
              "coding",
              "deepseek",
            ],
            installedAt:
              new Date().toISOString()
          },
          {
            id:
              "third-model@1:q4",
            modelId:
              "third-model",
            modelName:
              "General Model",
            installedPath:
              "/tmp/third.gguf",
            contextLength:
              32768,
            capabilities: [
              "general",
              "chat",
            ],
            installedAt:
              new Date().toISOString()
          }
        ]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const runtimePort =
    await getFreePort();

  const calledModels = [];
  const receivedGenerationBodies =
    [];

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

          receivedGenerationBodies.push(
            body
          );

          calledModels.push(
            body.model
          );

          if (
            body.model ===
            "primary-model"
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
                  "Primary runtime failed",
              })
            );

            return;
          }

          if (
            body.model ===
            "fallback-model"
          ) {
            res.writeHead(
              200,
              {
                "content-type":
                  "text/event-stream",
                "cache-control":
                  "no-cache",
              }
            );

            const answer =
              "คำตอบนี้สร้างจากโมเดลสำรองหลังจากโมเดลหลักทำงานไม่สำเร็จ";

            for (
              const part
              of [
                answer.slice(0, 25),
                answer.slice(25),
              ]
            ) {
              res.write(
                "data: " +
                JSON.stringify({
                  choices: [
                    {
                      delta: {
                        content: part,
                      },
                    },
                  ],
                }) +
                "\n\n"
              );

              await delay(20);
            }

            res.write(
              "data: [DONE]\n\n"
            );

            res.end();
            return;
          }

          res.writeHead(500);
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

    const created =
      await requestJson(
        baseUrl,
        "/api/text-chat/conversations",
        {
          method: "POST",
          body: {
            title:
              "Runtime Recovery Test",
          },
        }
      );

    const conversationId =
      created.data
        ?.conversation?.id;

    const savedUser =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: {
            role: "user",
            content:
              "ช่วยเขียน code และแก้ error",
          },
        }
      );

    if (savedUser.status !== 201) {
      throw new Error(
        "Unable to save user message."
      );
    }

    const generationResponse =
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
              "primary-model",
            response_format: {
              type:
                "json_schema",
              name:
                "runtime_recovery_json_output",
              schema: {
                type:
                  "object",
                additionalProperties:
                  false,
                properties: {
                  answer: {
                    type:
                      "string",
                  },
                },
                required: [
                  "answer",
                ],
              },
            },
          }),
        }
      );

    if (
      generationResponse.status !==
      200
    ) {
      throw new Error(
        await generationResponse.text()
      );
    }

    const streamText =
      await readStream(
        generationResponse
      );

    for (const requirement of [
      "event: recovery-start",
      "event: recovery-attempt",
      "event: recovery-failed-attempt",
      "event: recovery-delta",
      "event: recovery-complete",
    ]) {
      if (
        !streamText.includes(
          requirement
        )
      ) {
        throw new Error(
          `Recovery event missing: ${requirement}`
        );
      }
    }

    if (
      calledModels[0] !==
        "primary-model" ||
      calledModels[1] !==
        "fallback-model"
    ) {
      throw new Error(
        `Unexpected model order: ${calledModels.join(", ")}`
      );
    }

    if (
      receivedGenerationBodies.length !==
        2 ||
      !receivedGenerationBodies.every(
        (body) =>
          body.response_format
            ?.type ===
            "json_schema" &&
          body.response_format
            ?.json_schema
            ?.name ===
            "runtime_recovery_json_output" &&
          body.response_format
            ?.json_schema
            ?.strict === true &&
          body.response_format
            ?.json_schema
            ?.schema
            ?.properties
            ?.answer
            ?.type === "string"
      )
    ) {
      throw new Error(
        "Runtime Recovery attempts did not receive normalized JSON schema response_format."
      );
    }

    const restored =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}`
      );

    const assistantMessages =
      restored.data
        ?.conversation
        ?.messages
        ?.filter(
          (message) =>
            message.role ===
            "assistant"
        ) || [];

    if (
      assistantMessages.length !== 1
    ) {
      throw new Error(
        "Exactly one assistant response must be autosaved."
      );
    }

    const assistant =
      assistantMessages[0];

    if (
      assistant.modelId !==
        "fallback-model" ||
      assistant.metadata
        ?.recoveryUsed !== true ||
      assistant.metadata
        ?.successfulAttempt !== 2 ||
      assistant.metadata
        ?.attemptHistory
        ?.length !== 2
    ) {
      throw new Error(
        "Recovery metadata is invalid."
      );
    }

    if (
      assistant.metadata
        .attemptHistory[0]
        .status !== "failed" ||
      assistant.metadata
        .attemptHistory[1]
        .status !== "completed"
    ) {
      throw new Error(
        "Attempt history statuses are invalid."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-runtime/generate-with-recovery",
      "/api/text-runtime/recovery/stop",
      "Runtime Recovery",
      "recoveryAttempts",
      "fallbackModelId",
      "ใช้โมเดลสำรองสำเร็จ",
    ]) {
      if (
        !component.includes(
          requirement
        )
      ) {
        throw new Error(
          `Recovery UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Primary model was attempted first."
    );
    console.log(
      "PASS: Primary model failure was detected."
    );
    console.log(
      "PASS: Automatic fallback model was selected."
    );
    console.log(
      "PASS: Runtime Recovery attempts received normalized JSON schema response_format."
    );
    console.log(
      "PASS: Fallback response streamed successfully."
    );
    console.log(
      "PASS: Only the successful response was autosaved."
    );
    console.log(
      "PASS: Recovery attempt history was preserved."
    );
    console.log(
      "PASS: Successful fallback Model ID was stored."
    );
    console.log(
      "PASS: Runtime Recovery UI is connected."
    );
  } finally {
    await stopProcess(child);

    await new Promise(
      (resolve) => {
        runtimeServer.close(resolve);
      }
    );

    fs.writeFileSync(
      storeFile,
      originalStore,
      "utf8"
    );

    fs.writeFileSync(
      installedFile,
      originalInstalled,
      "utf8"
    );
  }

  console.log(
    "PASS: Runtime Failure Recovery validation completed."
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
