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
    "Persistent Chat API did not become ready."
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
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    }
  );

  child.stdout.pipe(
    process.stdout
  );

  child.stderr.pipe(
    process.stderr
  );

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
              "บทสนทนาใหม่",
          },
        }
      );

    if (
      created.status !== 201 ||
      !created.data
        ?.conversation?.id
    ) {
      throw new Error(
        "Unable to create conversation."
      );
    }

    const conversationId =
      created.data.conversation.id;

    const messageResult =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: {
            role: "user",
            content:
              "ข้อความนี้ต้องอยู่หลัง Refresh",
          },
        }
      );

    if (
      messageResult.status !== 201 ||
      messageResult.data
        ?.conversation
        ?.messages?.length !== 1
    ) {
      throw new Error(
        "Unable to autosave chat message."
      );
    }

    const reloadResult =
      await requestJson(
        baseUrl,
        "/api/text-chat/conversations"
      );

    const restoredConversation =
      reloadResult.data
        ?.conversations
        ?.find(
          (conversation) =>
            conversation.id ===
            conversationId
        );

    if (
      reloadResult.status !== 200 ||
      !restoredConversation ||
      restoredConversation
        .messages?.[0]?.content !==
        "ข้อความนี้ต้องอยู่หลัง Refresh" ||
      reloadResult.data
        ?.lastOpenedConversationId !==
        conversationId
    ) {
      throw new Error(
        "Conversation was not restored after refresh."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (
      const requirement
      of [
        "/api/text-chat/conversations",
        "/messages",
        "Autosave เปิดใช้งาน",
        "ค้นหาประวัติแชท",
        "ปักหมุด",
        "window.confirm",
      ]
    ) {
      if (
        !component.includes(
          requirement
        )
      ) {
        throw new Error(
          `Persistent Chat UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Conversation was created."
    );
    console.log(
      "PASS: Chat message was autosaved."
    );
    console.log(
      "PASS: Conversation was restored after refresh."
    );
    console.log(
      "PASS: Last opened conversation was remembered."
    );
    console.log(
      "PASS: Search, pin and confirmed delete UI are present."
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
    "PASS: Persistent Text Chat validation completed."
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
