#!/usr/bin/env node
"use strict";

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

async function readGenerationStream(
  response
) {
  if (!response.body) {
    throw new Error(
      "Generation stream is missing."
    );
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let raw = "";

  while (true) {
    const result =
      await reader.read();

    if (result.done) {
      break;
    }

    raw += decoder.decode(
      result.value,
      {
        stream: true,
      }
    );
  }

  return raw;
}

async function main() {
  const originalStore =
    fs.readFileSync(
      storeFile,
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

  const runtimePort =
    await getFreePort();

  let receivedGenerationBody =
    null;
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
          req.url === "/health"
        ) {
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

        if (
          req.url ===
            "/v1/chat/completions" &&
          req.method === "POST"
        ) {
          receivedGenerationBody =
            JSON.parse(rawBody);
          receivedGenerationBodies.push(
            receivedGenerationBody
          );

          res.writeHead(
            200,
            {
              "content-type":
                receivedGenerationBody.stream === true
                  ? "text/event-stream"
                  : "application/json",
              ...(receivedGenerationBody.stream === true
                ? {
                    "cache-control":
                      "no-cache",
                    connection:
                      "keep-alive",
                  }
                : {}),
            }
          );

          if (
            receivedGenerationBody.stream !==
            true
          ) {
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content:
                        "{\"ok\":true}",
                    },
                  },
                ],
              })
            );
            return;
          }

          const parts = [
            "สวัสดีครับ ",
            "นี่คือคำตอบ",
            "แบบ Streaming",
          ];

          for (const part of parts) {
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

            await delay(25);
          }

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
        LLM_PORT:
          String(runtimePort),
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

    const created =
      await requestJson(
        baseUrl,
        "/api/text-chat/conversations",
        {
          method: "POST",
          body: {
            title:
              "Streaming Test",
            systemPrompt:
              "ตอบเป็นภาษาไทย",
          },
        }
      );

    const conversationId =
      created.data
        ?.conversation?.id;

    if (!conversationId) {
      throw new Error(
        "Unable to create conversation."
      );
    }

    const userMessage =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: {
            role: "user",
            content:
              "ช่วยตอบแบบ Streaming",
          },
        }
      );

    if (userMessage.status !== 201) {
      throw new Error(
        "Unable to save user message."
      );
    }

    const generationResponse =
      await fetch(
        `${baseUrl}/api/text-runtime/generate-stream`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            conversationId,
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
      await readGenerationStream(
        generationResponse
      );

    if (
      !streamText.includes(
        "event: delta"
      ) ||
      !streamText.includes(
        "event: complete"
      ) ||
      !streamText.includes(
        "แบบ Streaming"
      )
    ) {
      throw new Error(
        "Streaming events are incomplete."
      );
    }

    if (
      !receivedGenerationBody ||
      receivedGenerationBody
        .stream !== true ||
      !Array.isArray(
        receivedGenerationBody.messages
      ) ||
      !receivedGenerationBody
        .messages
        .some(
          (message) =>
            message.content
              ?.includes(
                "ช่วยตอบแบบ Streaming"
              )
        )
    ) {
      throw new Error(
        "Runtime generation payload is invalid."
      );
    }

    const schemaConversation =
      await requestJson(
        baseUrl,
        "/api/text-chat/conversations",
        {
          method: "POST",
          body: {
            title:
              "JSON Schema Streaming Test",
          },
        }
      );

    const schemaConversationId =
      schemaConversation.data
        ?.conversation
        ?.id;

    if (!schemaConversationId) {
      throw new Error(
        "Unable to create JSON schema validation conversation."
      );
    }

    const schemaUserMessage =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${schemaConversationId}/messages`,
        {
          method: "POST",
          body: {
            role: "user",
            content:
              "Return structured output.",
          },
        }
      );

    if (schemaUserMessage.status !== 201) {
      throw new Error(
        "Unable to save JSON schema validation message."
      );
    }

    const schemaResponse =
      await fetch(
        `${baseUrl}/api/text-runtime/generate-stream`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            conversationId:
              schemaConversationId,
            response_format: {
              type: "json_schema",
              json_schema: {
                schema: [],
              },
            },
            responseFormat: {
              type: "JSON_SCHEMA",
              schema_name:
                "Explicit Output Name!",
              schema: {
                title:
                  "Test Schema Output!",
                type: "object",
                additionalProperties:
                  false,
                properties: {
                  ok: {
                    type: "boolean",
                  },
                },
                required: [
                  "ok",
                ],
              },
              schema_strict: false,
            },
          }),
        }
      );

    const schemaStreamText =
      await readGenerationStream(
        schemaResponse
      );

    if (
      schemaResponse.status !== 200 ||
      !schemaStreamText.includes(
        "event: complete"
      )
    ) {
      throw new Error(
        `JSON schema response format request failed: status=${schemaResponse.status}`
      );
    }

    const schemaRuntimeBody =
      receivedGenerationBodies.find(
        (body) =>
          body.response_format
            ?.type === "json_schema"
      );

    if (
      !schemaRuntimeBody ||
      schemaRuntimeBody
        .response_format
        .json_schema
        ?.name !==
        "Explicit_Output_Name" ||
      schemaRuntimeBody
        .response_format
        .json_schema
        ?.strict !== false ||
      schemaRuntimeBody
        .response_format
        .json_schema
        ?.schema
        ?.properties
        ?.ok
        ?.type !== "boolean"
    ) {
      throw new Error(
        "Runtime did not receive normalized JSON schema response_format."
      );
    }

    const restored =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}`
      );

    const messages =
      restored.data
        ?.conversation
        ?.messages || [];

    const assistant =
      messages.find(
        (message) =>
          message.role ===
          "assistant"
      );

    if (
      messages.length !== 2 ||
      !assistant ||
      assistant.content !==
        "สวัสดีครับ นี่คือคำตอบแบบ Streaming" ||
      assistant.metadata
        ?.autosaved !== true
    ) {
      throw new Error(
        "Assistant response was not autosaved correctly."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      // LUKE_AI_STREAMING_RECOVERY_COMPATIBILITY_V1
      "/api/text-runtime/generate-with-recovery",
      "/api/text-runtime/recovery/stop",
      "streamingResponse",
      "หยุดการสร้างคำตอบ",
      "กำลังประมวลผล",
      "TextDecoder",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `Streaming UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: User message was saved before generation."
    );
    console.log(
      "PASS: Runtime received an OpenAI-compatible streaming request."
    );
    console.log(
      "PASS: Runtime received normalized JSON schema response_format."
    );
    console.log(
      "PASS: Text tokens streamed incrementally."
    );
    console.log(
      "PASS: Streaming completion event was emitted."
    );
    console.log(
      "PASS: Assistant response was autosaved."
    );
    console.log(
      "PASS: Conversation history contains user and assistant messages."
    );
    console.log(
      "PASS: Stop Generation UI is connected through Runtime Recovery."
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
  }

  console.log(
    "PASS: Text Generation Streaming validation completed."
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
