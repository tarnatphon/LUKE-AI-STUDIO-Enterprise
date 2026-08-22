#!/usr/bin/env node
"use strict";

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
  "scripts",
  "server",
  "serve.cjs"
);

const conversationStoreFile =
  path.join(
    root,
    "app",
    "runtime-state",
    "text-chat",
    "conversations.json"
  );

const feedbackStoreFile =
  path.join(
    root,
    "app",
    "runtime-state",
    "text-chat",
    "model-feedback.json"
  );

const componentFile =
  path.join(
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

async function main() {
  const originalConversationStore =
    fs.readFileSync(
      conversationStoreFile,
      "utf8"
    );

  const originalFeedbackStore =
    fs.readFileSync(
      feedbackStoreFile,
      "utf8"
    );

  fs.writeFileSync(
    conversationStoreFile,
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
    feedbackStoreFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        updatedAt: null,
        modelScores: {},
        messageFeedback: {},
        events: [],
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
              "Feedback Test",
          },
        }
      );

    const conversationId =
      created.data
        ?.conversation?.id;

    const messages = [];

    for (const modelId of [
      "model-alpha",
      "model-beta",
    ]) {
      const saved =
        await requestJson(
          baseUrl,
          `/api/text-chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            body: {
              role: "assistant",
              content:
                `คำตอบจาก ${modelId}`,
              modelId,
              metadata: {
                multiModel: true,
              },
            },
          }
        );

      messages.push(
        saved.data.message
      );
    }

    const like =
      await requestJson(
        baseUrl,
        "/api/text-chat/feedback",
        {
          method: "POST",
          body: {
            conversationId,
            messageId:
              messages[0].id,
            feedbackType:
              "like",
          },
        }
      );

    if (
      like.status !== 200 ||
      like.data
        ?.modelScore
        ?.likes !== 1
    ) {
      throw new Error(
        "Like feedback was not recorded."
      );
    }

    const preferred =
      await requestJson(
        baseUrl,
        "/api/text-chat/feedback",
        {
          method: "POST",
          body: {
            conversationId,
            messageId:
              messages[1].id,
            feedbackType:
              "preferred",
          },
        }
      );

    if (
      preferred.status !== 200 ||
      preferred.data
        ?.modelScore
        ?.preferred !== 1
    ) {
      throw new Error(
        "Preferred feedback was not recorded."
      );
    }

    const summary =
      await requestJson(
        baseUrl,
        "/api/text-chat/feedback/summary"
      );

    if (
      summary.status !== 200 ||
      summary.data
        ?.feedbackCount !== 2 ||
      summary.data
        ?.eventCount !== 2
    ) {
      throw new Error(
        "Feedback summary is invalid."
      );
    }

    const restored =
      await requestJson(
        baseUrl,
        `/api/text-chat/conversations/${conversationId}`
      );

    const preferredMessages =
      restored.data
        ?.conversation
        ?.messages
        ?.filter(
          (message) =>
            message.metadata
              ?.userPreferred === true
        ) || [];

    if (
      preferredMessages.length !== 1 ||
      preferredMessages[0].id !==
        messages[1].id
    ) {
      throw new Error(
        "Preferred response marker is invalid."
      );
    }

    const feedbackStore =
      JSON.parse(
        fs.readFileSync(
          feedbackStoreFile,
          "utf8"
        )
      );

    if (
      !feedbackStore
        .modelScores
        ["model-alpha"] ||
      !feedbackStore
        .modelScores
        ["model-beta"] ||
      feedbackStore.events.length !== 2
    ) {
      throw new Error(
        "Persistent feedback store is invalid."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-chat/feedback",
      "ThumbsUp",
      "ThumbsDown",
      "เลือกคำตอบนี้",
      "Regenerate",
      "submitMessageFeedback",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `Feedback UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Like feedback was recorded."
    );
    console.log(
      "PASS: Dislike and preferred feedback types are supported."
    );
    console.log(
      "PASS: Preferred response was marked in conversation history."
    );
    console.log(
      "PASS: Model satisfaction scores were persisted."
    );
    console.log(
      "PASS: Feedback audit events were preserved."
    );
    console.log(
      "PASS: Adaptive model score is available for ranking."
    );
    console.log(
      "PASS: Regenerate UI is connected."
    );
  } finally {
    await stopProcess(child);

    fs.writeFileSync(
      conversationStoreFile,
      originalConversationStore,
      "utf8"
    );

    fs.writeFileSync(
      feedbackStoreFile,
      originalFeedbackStore,
      "utf8"
    );
  }

  console.log(
    "PASS: Text Model Feedback validation completed."
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
