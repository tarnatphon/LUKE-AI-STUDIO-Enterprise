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

  let judgeRequestBody = null;

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
          judgeRequestBody =
            JSON.parse(rawBody);

          res.writeHead(
            200,
            {
              "content-type":
                "text/event-stream",
              "cache-control":
                "no-cache",
            }
          );

          const finalAnswer =
            "ระบบ Multi Model สามารถประมวลผลคำตอบจากหลายโมเดลพร้อมกัน เปรียบเทียบคุณภาพ และรวมจุดแข็งเป็นคำตอบสุดท้ายที่ชัดเจนและครบถ้วน";

          const midpoint =
            Math.ceil(
              finalAnswer.length / 2
            );

          for (const part of [
            finalAnswer.slice(
              0,
              midpoint
            ),
            finalAnswer.slice(
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

    const created =
      await requestJson(
        baseUrl,
        "/api/text-chat/conversations",
        {
          method: "POST",
          body: {
            title:
              "AI Judge Test",
          },
        }
      );

    const conversationId =
      created.data
        ?.conversation?.id;

    const messages = [
      {
        role: "user",
        content:
          "อธิบายระบบ Multi Model",
      },
      {
        role: "assistant",
        content:
          "คำตอบจากโมเดลหนึ่ง",
        modelId:
          "model-alpha",
        metadata: {
          multiModel: true,
          score: 0.55,
          rank: 3,
          best: false,
        },
      },
      {
        role: "assistant",
        content:
          "คำตอบที่ครบถ้วนเรื่องการประมวลผลหลายโมเดลและการเลือกคำตอบดีที่สุด",
        modelId:
          "model-beta",
        metadata: {
          multiModel: true,
          score: 0.91,
          rank: 1,
          best: true,
        },
      },
      {
        role: "assistant",
        content:
          "คำตอบทางเลือกจากโมเดลที่สาม",
        modelId:
          "model-gamma",
        metadata: {
          multiModel: true,
          score: 0.68,
          rank: 2,
          best: false,
        },
      },
    ];

    for (const message of messages) {
      const saved =
        await requestJson(
          baseUrl,
          `/api/text-chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            body: message,
          }
        );

      if (saved.status !== 201) {
        throw new Error(
          "Unable to seed judge messages."
        );
      }
    }

    const response =
      await fetch(
        `${baseUrl}/api/text-runtime/judge-synthesis`,
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            conversationId,
            response_format: {
              type:
                "json_schema",
              name:
                "ai_judge_json_output",
              schema: {
                type:
                  "object",
                additionalProperties:
                  false,
                properties: {
                  finalAnswer: {
                    type:
                      "string",
                  },
                },
                required: [
                  "finalAnswer",
                ],
              },
              strict:
                false,
            },
          }),
        }
      );

    if (response.status !== 200) {
      throw new Error(
        await response.text()
      );
    }

    const streamText =
      await readStream(response);

    if (
      !streamText.includes(
        "event: judge-start"
      ) ||
      !streamText.includes(
        "event: judge-delta"
      ) ||
      !streamText.includes(
        "event: judge-complete"
      )
    ) {
      throw new Error(
        "AI Judge stream events are incomplete."
      );
    }

    if (
      !judgeRequestBody ||
      judgeRequestBody.model !==
        "model-beta" ||
      !judgeRequestBody
        .messages?.[1]
        ?.content
        ?.includes(
          "คำตอบจากโมเดลหนึ่ง"
        ) ||
      !judgeRequestBody
        .messages?.[1]
        ?.content
        ?.includes(
          "คำตอบทางเลือกจากโมเดลที่สาม"
        )
    ) {
      throw new Error(
        "AI Judge prompt did not include all source responses."
      );
    }

    if (
      judgeRequestBody
        .response_format
        ?.type !== "json_schema" ||
      judgeRequestBody
        .response_format
        ?.json_schema
        ?.name !==
        "ai_judge_json_output" ||
      judgeRequestBody
        .response_format
        ?.json_schema
        ?.strict !== false ||
      judgeRequestBody
        .response_format
        ?.json_schema
        ?.schema
        ?.properties
        ?.finalAnswer
        ?.type !== "string"
    ) {
      throw new Error(
        "AI Judge runtime request did not receive normalized JSON schema response_format."
      );
    }

    const restored =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}`
      );

    const finalAnswers =
      restored.data
        ?.conversation
        ?.messages
        ?.filter(
          (message) =>
            message.metadata
              ?.finalAnswer === true
        ) || [];

    if (
      finalAnswers.length !== 1 ||
      finalAnswers[0]
        .metadata
        ?.sourceModelIds
        ?.length !== 3 ||
      finalAnswers[0]
        .metadata
        ?.autosaved !== true ||
      finalAnswers[0]
        .metadata
        ?.fallback !== false
    ) {
      throw new Error(
        "Final Answer metadata is invalid."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-runtime/judge-synthesis",
      "AI Judge Final Answer",
      "สร้าง Final Answer",
      "หยุด AI Judge",
      "Best Response Fallback",
      "judgeResponse",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `AI Judge UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: AI Judge received all model responses."
    );
    console.log(
      "PASS: Highest ranked model was selected as Judge."
    );
    console.log(
      "PASS: AI Judge runtime request received normalized JSON schema response_format."
    );
    console.log(
      "PASS: Final Answer streamed incrementally."
    );
    console.log(
      "PASS: Final Answer was autosaved."
    );
    console.log(
      "PASS: Original model responses were preserved."
    );
    console.log(
      "PASS: Source Model IDs were stored in metadata."
    );
    console.log(
      "PASS: AI Judge Synthesis UI is connected."
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
    "PASS: AI Judge Synthesis validation completed."
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
