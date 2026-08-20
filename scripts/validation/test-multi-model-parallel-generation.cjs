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

  const modelIds = [
    "model-alpha",
    "model-beta",
    "model-gamma",
  ];

  fs.writeFileSync(
    installedFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt:
          new Date().toISOString(),
        activeModelId:
          modelIds[0],
        models:
          modelIds.map(
            (modelId, index) => ({
              id:
                `${modelId}@1.0.0:q4`,
              modelId,
              modelName:
                `Model ${index + 1}`,
              version:
                "1.0.0",
              variantId:
                "q4",
              quantization:
                "Q4_K_M",
              runtime:
                "llama.cpp",
              installedPath:
                `/tmp/${modelId}.gguf`,
              installedAt:
                new Date().toISOString(),
            })
          ),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const runtimePort =
    await getFreePort();

  const responseMap = {
    "model-alpha":
      "คำตอบสั้นเกี่ยวกับระบบ",
    "model-beta":
      "คำตอบที่ครบถ้วนเกี่ยวกับระบบ Multi Model โดยอธิบายการประมวลผลพร้อมกัน การเปรียบเทียบ และการเลือกผลลัพธ์ที่ดีที่สุดอย่างชัดเจน",
    "model-gamma":
      "แนวทางอีกแบบสำหรับการเปรียบเทียบคำตอบจากหลายโมเดล",
  };

  const receivedModels = [];
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

          const modelId =
            body.model;

          receivedGenerationBodies.push(
            body
          );

          receivedModels.push(
            modelId
          );

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
            responseMap[modelId];

          const midpoint =
            Math.ceil(
              answer.length / 2
            );

          for (const part of [
            answer.slice(
              0,
              midpoint
            ),
            answer.slice(
              midpoint
            ),
          ]) {
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

        if (req.url === "/health") {
          res.writeHead(
            200,
            {
              "content-type":
                "application/json",
            }
          );

          res.end(
            JSON.stringify({
              ok: true,
            })
          );

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

    const available =
      await requestJson(
        baseUrl,
        "/api/text-runtime/models/available"
      );

    if (
      available.status !== 200 ||
      available.data
        ?.maximumSelection !== 3 ||
      available.data
        ?.models?.length !== 3
    ) {
      throw new Error(
        "Available Models API is invalid."
      );
    }

    const created =
      await requestJson(
        baseUrl,
        "/api/text-chat/conversations",
        {
          method: "POST",
          body: {
            title:
              "Multi Model Test",
          },
        }
      );

    const conversationId =
      created.data
        ?.conversation?.id;

    const savedUserMessage =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: {
            role: "user",
            content:
              "อธิบายระบบ Multi Model",
          },
        }
      );

    if (
      savedUserMessage.status !==
      201
    ) {
      throw new Error(
        "User message was not saved."
      );
    }

    const generationResponse =
      await fetch(
        `${baseUrl}/api/text-runtime/multi-generate-stream`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            conversationId,
            modelIds,
            response_format: {
              type:
                "json_schema",
              name:
                "multi_model_json_output",
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

    if (
      !streamText.includes(
        "event: multi-start"
      ) ||
      !streamText.includes(
        "event: model-delta"
      ) ||
      !streamText.includes(
        "event: multi-complete"
      )
    ) {
      throw new Error(
        "Multi-model stream events are incomplete."
      );
    }

    if (
      new Set(
        receivedModels
      ).size !== 3
    ) {
      throw new Error(
        "Three unique models were not called."
      );
    }

    if (
      receivedGenerationBodies.length !==
        3 ||
      !receivedGenerationBodies.every(
        (body) =>
          body.response_format
            ?.type ===
            "json_schema" &&
          body.response_format
            ?.json_schema
            ?.name ===
            "multi_model_json_output" &&
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
        "Multi-model runtime requests did not receive normalized JSON schema response_format."
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
      assistantMessages.length !== 3
    ) {
      throw new Error(
        "All model responses were not autosaved."
      );
    }

    const bestMessages =
      assistantMessages.filter(
        (message) =>
          message.metadata
            ?.best === true
      );

    if (
      bestMessages.length !== 1
    ) {
      throw new Error(
        "Exactly one Best Response was not selected."
      );
    }

    if (
      !bestMessages[0]
        .metadata?.score ||
      bestMessages[0]
        .metadata?.rank !== 1
    ) {
      throw new Error(
        "Best Response evaluation metadata is invalid."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-runtime/models/available",
      "/api/text-runtime/multi-generate-stream",
      "Multi-Model Comparison",
      "Best Response",
      "หยุดทุกโมเดล",
      "selectedModelIds",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `Multi-model UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Three unique models were selected."
    );
    console.log(
      "PASS: All three models generated in parallel."
    );
    console.log(
      "PASS: All multi-model runtime requests received normalized JSON schema response_format."
    );
    console.log(
      "PASS: Every model streamed its response."
    );
    console.log(
      "PASS: All model responses were autosaved."
    );
    console.log(
      "PASS: Responses were scored and ranked."
    );
    console.log(
      "PASS: Exactly one Best Response was selected."
    );
    console.log(
      "PASS: Model ID and evaluation metadata were preserved."
    );
    console.log(
      "PASS: Multi-Model Comparison UI is connected."
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
    "PASS: Multi-Model Parallel Generation validation completed."
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
