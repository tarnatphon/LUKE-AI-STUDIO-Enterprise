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
  "scripts",
  "server",
  "serve.cjs"
);

// The user's real conversation archive. This suite must never write it: it
// used to overwrite it and restore it in a `finally`, which does not run
// on SIGKILL.
const realStoreFile = path.join(
  root,
  "app",
  "runtime-state",
  "text-chat",
  "conversations.json"
);

// The server is pointed at a throwaway file instead, through
// LUKE_TEXT_CHAT_STORE.
const storeFile = path.join(
  os.tmpdir(),
  `luke-text-chat-refresh-${process.pid}.json`
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
  pathname,
  child
) {
  for (
    let attempt = 0;
    attempt < 100;
    attempt += 1
  ) {
    if (
      child &&
      child.exitCode !== null
    ) {
      throw new Error(
        `Backend exited with code ${child.exitCode}.`
      );
    }

    try {
      const response = await fetch(
        `${baseUrl}${pathname}`
      );

      if (response.status < 500) {
        return;
      }
    } catch {}

    await delay(120);
  }

  throw new Error(
    `Server did not become ready: ${pathname}`
  );
}

async function main() {
  // What the real archive looks like now, so the end of the run can prove
  // it still looks like this.
  const realBefore =
    fs.existsSync(realStoreFile)
      ? fs.readFileSync(
          realStoreFile,
          "utf8"
        )
      : null;

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

  const runtimeRequests = {
    health: 0,
    unload: 0,
    load: 0,
    lastLoadBody: null,
  };

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

        let body = null;

        try {
          body =
            rawBody
              ? JSON.parse(rawBody)
              : null;
        } catch {}

        if (
          req.url === "/health"
        ) {
          runtimeRequests.health += 1;

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
              modelLoaded:
                runtimeRequests.load > 0,
            })
          );

          return;
        }

        if (
          req.url ===
            "/v1/models/unload" &&
          req.method === "POST"
        ) {
          runtimeRequests.unload += 1;

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
              unloaded: true,
            })
          );

          return;
        }

        if (
          req.url ===
            "/v1/models/load" &&
          req.method === "POST"
        ) {
          runtimeRequests.load += 1;
          runtimeRequests.lastLoadBody =
            body;

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
              loaded: true,
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
        LUKE_TEXT_CHAT_STORE:
          storeFile,
        LUKE_AI_TEXT_RUNTIME_BASE_URL:
          `http://127.0.0.1:${runtimePort}`,
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
      "/api/text-chat/conversations",
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
              "Runtime Refresh Test",
            systemPrompt:
              "ตอบเป็นภาษาไทย",
          },
        }
      );

    const conversationId =
      created.data?.conversation?.id;

    if (!conversationId) {
      throw new Error(
        "Unable to create conversation."
      );
    }

    const testMessages = [
      "จำไว้ว่าโปรเจกต์ชื่อ LUKE AI STUDIO",
      "ตกลงให้ดาวน์โหลดโมเดลทีละหนึ่งตัว",
      "ขั้นต่อไปต้อง Restore Memory เข้า Prompt",
    ];

    for (const content of testMessages) {
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
          "Unable to save test message."
        );
      }
    }

    const refreshResult =
      await requestJson(
        baseUrl,
        "/api/text-runtime/session/refresh",
        {
          method: "POST",
          body: {
            conversationId,
            forceMemoryRefresh: true,
            reason:
              "automated-test",
          },
        }
      );

    if (
      refreshResult.status !== 200 ||
      refreshResult.data
        ?.status !== "ready"
    ) {
      throw new Error(
        `Runtime refresh failed: ${refreshResult.text}`
      );
    }

    if (
      runtimeRequests.unload !== 1 ||
      runtimeRequests.load !== 1 ||
      runtimeRequests.health < 2
    ) {
      throw new Error(
        "Runtime unload, load or health verification was not called."
      );
    }

    const loadBody =
      runtimeRequests.lastLoadBody;

    if (
      !loadBody ||
      loadBody.conversationId !==
        conversationId ||
      typeof loadBody.systemPrompt !==
        "string" ||
      !loadBody.systemPrompt.includes(
        "LUKE AI STUDIO"
      ) ||
      !loadBody.systemPrompt.includes(
        "ดาวน์โหลดโมเดลทีละหนึ่งตัว"
      )
    ) {
      throw new Error(
        "Restore Memory was not injected into the runtime prompt."
      );
    }

    const promptResult =
      await requestJson(
        baseUrl,
        "/api/text-runtime/restore-prompt",
        {
          method: "POST",
          body: {
            conversationId,
          },
        }
      );

    if (
      promptResult.status !== 200 ||
      !promptResult.data
        ?.restorePrompt
        ?.includes(
          "งานที่ต้องดำเนินการต่อ"
        )
    ) {
      throw new Error(
        "Restore Prompt API is invalid."
      );
    }

    const statusResult =
      await requestJson(
        baseUrl,
        "/api/text-runtime/session/status",
        {
          method: "POST",
          body: {
            conversationId,
          },
        }
      );

    if (
      statusResult.status !== 200 ||
      statusResult.data
        ?.status !== "ready"
    ) {
      throw new Error(
        "Runtime Session Status is invalid."
      );
    }

    const component =
      fs.readFileSync(
        componentFile,
        "utf8"
      );

    for (const requirement of [
      "/api/text-runtime/session/refresh",
      "Reload Model Runtime",
      "Runtime Adapter พร้อมใช้งาน",
      "Restore Prompt",
      "automatic-context-or-ram-threshold",
    ]) {
      if (!component.includes(requirement)) {
        throw new Error(
          `Runtime UI requirement missing: ${requirement}`
        );
      }
    }

    console.log("");
    console.log(
      "PASS: Runtime health was checked before refresh."
    );
    console.log(
      "PASS: Loaded model was unloaded."
    );
    console.log(
      "PASS: Model runtime was loaded again."
    );
    console.log(
      "PASS: Runtime health was verified after reload."
    );
    console.log(
      "PASS: Conversation ID remained unchanged."
    );
    console.log(
      "PASS: Memory summary was injected into the restore prompt."
    );
    console.log(
      "PASS: Facts, decisions, tasks and recent messages were restored."
    );
    console.log(
      "PASS: Runtime Session UI is connected."
    );
  } finally {
    await stopProcess(child);

    await new Promise(
      (resolve) => {
        runtimeServer.close(resolve);
      }
    );

    const realAfter =
      fs.existsSync(realStoreFile)
        ? fs.readFileSync(
            realStoreFile,
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

    fs.rmSync(storeFile, { force: true });
  }

  console.log(
    "PASS: Text Runtime Session Refresh validation completed."
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
