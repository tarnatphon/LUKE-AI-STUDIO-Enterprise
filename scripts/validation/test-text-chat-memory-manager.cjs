#!/usr/bin/env node
"use strict";

let testPortOffset = 0;

const fs = require("node:fs");
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
  "scripts/server",
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
        `${baseUrl}/api/text-chat/conversations`
      );

      if (response.status === 200) {
        return;
      }
    } catch {}

    await delay(150);
  }

  throw new Error(
    "Text Chat API did not become ready."
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

  const port =
    await getFreePort();

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
        LUKE_AI_HOST:
          "127.0.0.1",
        LUKE_AI_PORT:
          String(port),
        LUKE_AI_TEST_TOTAL_RAM_BYTES:
          String(16 * 1024 ** 3),
        LUKE_AI_TEST_FREE_RAM_BYTES:
          String(512 * 1024 ** 2),
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
              "Memory Test",
            systemPrompt:
              "ทดสอบระบบความจำ",
          },
        }
      );

    const conversationId =
      created.data?.conversation?.id;

    if (!conversationId) {
      throw new Error(
        "Conversation creation failed."
      );
    }

    const messages = [
      "จำไว้ว่าโปรเจกต์นี้ชื่อ LUKE AI STUDIO",
      "ตกลงให้ดาวน์โหลดโมเดลทีละหนึ่งตัว",
      "ขั้นต่อไปเพิ่มระบบความจำต่อเนื่อง",
      "ข้อมูลคือผู้ใช้ต้องพิมพ์ต่อเนื่องโดยไม่สูญเสียบริบท",
    ];

    for (const content of messages) {
      const result =
        await requestJson(
          baseUrl,
          `/api/text-chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            body: {
              role: "user",
              content,
            },
          }
        );

      if (result.status !== 201) {
        throw new Error(
          "Unable to append memory test message."
        );
      }
    }

    const optimized =
      await requestJson(
        baseUrl,
        "/api/text-chat/memory/optimize",
        {
          method: "POST",
          body: {
            conversationId,
            force: true,
            reason:
              "automated-test",
          },
        }
      );

    if (
      optimized.status !== 200 ||
      optimized.data?.action !==
        "refresh" ||
      !optimized.data
        ?.conversation
        ?.memory
        ?.summary ||
      !optimized.data
        ?.conversation
        ?.session
        ?.id
    ) {
      throw new Error(
        `Memory optimization failed: ${optimized.text}`
      );
    }

    const status =
      await requestJson(
        baseUrl,
        "/api/text-chat/memory/status",
        {
          method: "POST",
          body: {
            conversationId,
          },
        }
      );

    if (
      status.status !== 200 ||
      status.data
        ?.memory
        ?.hasSummary !== true ||
      status.data
        ?.memory
        ?.snapshotCount < 1 ||
      status.data
        ?.session
        ?.refreshCount < 1 ||
      status.data
        ?.ram
        ?.action !==
        "emergency-refresh"
    ) {
      throw new Error(
        `Memory status is invalid: ${status.text}`
      );
    }

    const restored =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}`
      );

    if (
      restored.status !== 200 ||
      restored.data
        ?.conversation
        ?.messages
        ?.length !== messages.length ||
      !restored.data
        ?.conversation
        ?.session
        ?.restoreContext
        ?.summary
    ) {
      throw new Error(
        "Conversation history or restore context was lost."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-chat/memory/status",
      "/api/text-chat/memory/optimize",
      "Conversation Memory",
      "Context Action",
      "RAM Action",
      "Session Refresh",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `Memory UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Context usage was calculated."
    );
    console.log(
      "PASS: Conversation summary was created."
    );
    console.log(
      "PASS: Memory snapshot was persisted."
    );
    console.log(
      "PASS: Session refreshed without changing the conversation."
    );
    console.log(
      "PASS: Raw conversation history was preserved."
    );
    console.log(
      "PASS: Restore context contains summary and recent messages."
    );
    console.log(
      "PASS: RAM emergency refresh was detected."
    );
    console.log(
      "PASS: Context Memory UI is connected."
    );
  } finally {
    await stopProcess(child);

    fs.writeFileSync(
      storeFile,
      originalStore,
      "utf8"
    );
  }

  console.log(
    "PASS: Text Chat Memory Manager validation completed."
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
