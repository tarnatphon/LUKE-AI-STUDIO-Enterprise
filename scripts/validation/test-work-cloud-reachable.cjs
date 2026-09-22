"use strict";

/**
 * Work's cloud path, reached through the door the app actually walks through.
 *
 * The chain first hung off /api/text-runtime/generate-with-recovery. Only
 * PersistentTextChat calls that, and PersistentTextChat is lazy imported in
 * App.jsx and never rendered — so six rounds of hardening sat on an endpoint
 * the running application never reaches. Nothing in the unit suites noticed,
 * because they all read source and the source was there.
 *
 * This boots the real server against a stand-in gateway and asks it for a
 * turn the way the browser does:
 *
 *   1. a Work turn reaches a provider and streams back;
 *   2. a chat turn does not — it stays on this machine;
 *   3. with no key saved, a Work turn does not either;
 *   4. the Settings endpoints connect, test and disconnect;
 *   5. and no response ever contains the key.
 *
 * Run: node scripts/validation/test-work-cloud-reachable.cjs
 */

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NVIDIA_KEY = "nvapi-SECRET-reachable-key-0001";

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

/** Read an SSE response into the text a chat window would show. */
async function readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let content = "";
  let done = false;
  const events = [];

  while (!done) {
    const result = await reader.read();

    if (result.done) break;

    buffer += decoder.decode(result.value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      events.push(frame);

      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();

        if (data === "[DONE]") {
          done = true;
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;

          if (typeof delta === "string") content += delta;
        } catch {}
      }
    }
  }

  return { content, events };
}

async function main() {
  // ── the stand-in gateway ────────────────────────────────────────────────

  const seen = [];
  let gatewayMode = "answer";

  const gateway = http.createServer((req, res) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      let payload = {};

      try {
        payload = JSON.parse(raw || "{}");
      } catch {}

      seen.push({ payload, authorization: req.headers.authorization });

      if (gatewayMode === "refuse") {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }

      res.writeHead(200, { "content-type": "text/event-stream" });

      for (const word of ["Work ", "answered ", "from the cloud."]) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));

  const gatewayPort = gateway.address().port;

  // ── the application server ──────────────────────────────────────────────

  const scratchKeyFile = path.join(os.tmpdir(), `luke-reachable-keys-${process.pid}.json`);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      LUKE_AI_HOST: "127.0.0.1",
      NODE_ENV: "test",
      LUKE_REMOTE_PROVIDER_FILE: scratchKeyFile,
      LUKE_REMOTE_PROVIDER_BASE_URL: `http://127.0.0.1:${gatewayPort}/v1`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  const post = async (endpoint, payload) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const text = await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {}

    return { status: response.status, data, text };
  };

  try {
    let ready = false;

    for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);

      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.status === 200) ready = true;
      } catch {}

      if (!ready) await delay(150);
    }

    if (!ready) throw new Error(`Application server did not become ready.\n${log}`);

    const messages = [
      { role: "system", content: "You are LUKE AI in Work mode." },
      { role: "user", content: "Fix the failing test." },
    ];

    section("1. With no key saved, a Work turn stays on this machine");
    const beforeKey = await post("/api/llm/chat", { messages, assistantMode: "work", stream: true });
    check("the gateway was not called", seen.length === 0, String(seen.length));
    check("and the local path answered the request instead",
      beforeKey.status === 409 && /text model/i.test(beforeKey.data?.error || ""),
      `${beforeKey.status} ${JSON.stringify(beforeKey.data)}`);

    section("2. The Settings endpoints connect a provider");
    const status0 = await post("/api/text-runtime/remote-provider/status");
    check("the panel can ask what is configured", status0.status === 200 && status0.data.ok === true);
    check("nothing is connected yet", status0.data.provider.chain.length === 0);

    const saved = await post("/api/text-runtime/remote-provider/key", {
      providerId: "nvidia",
      key: NVIDIA_KEY,
    });
    check("a key can be saved", saved.status === 200 && saved.data.ok === true, JSON.stringify(saved.data).slice(0, 160));
    check("and the response never carries it back", !saved.text.includes("SECRET"), saved.text.slice(0, 160));

    const status1 = await post("/api/text-runtime/remote-provider/status");
    check("the provider now shows as connected",
      status1.data.provider.providers.find((item) => item.id === "nvidia").configured === true);
    check("a hint is shown rather than the key",
      /^…[A-Za-z0-9]{1,6}$/.test(status1.data.provider.providers.find((item) => item.id === "nvidia").keyHint));
    check("and the chain lists it", status1.data.provider.chain.includes("nvidia"));

    section("3. Testing a provider reaches it");
    seen.length = 0;
    const tested = await post("/api/text-runtime/remote-provider/test", { providerId: "nvidia" });
    check("the test call succeeds", tested.status === 200 && tested.data.ok === true, JSON.stringify(tested.data).slice(0, 200));
    check("the gateway really was reached", seen.length === 1, String(seen.length));
    check("and the result says which model answered", /answered through/i.test(tested.data.test?.message || ""), tested.data.test?.message);
    check("the key is not in the result", !tested.text.includes("SECRET"));

    section("4. A Work turn now reaches the cloud");
    seen.length = 0;
    const workResponse = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, assistantMode: "work", stream: true }),
    });

    check("it streams rather than refusing", workResponse.status === 200, String(workResponse.status));
    check("the response is a server-sent stream",
      String(workResponse.headers.get("content-type") || "").includes("text/event-stream"),
      String(workResponse.headers.get("content-type")));

    const work = await readSse(workResponse);

    check("the gateway received the turn", seen.length === 1, String(seen.length));
    check("the answer arrived in full", work.content === "Work answered from the cloud.", work.content);
    check("the system message travelled with it",
      seen[0]?.payload?.messages?.[0]?.role === "system",
      JSON.stringify(seen[0]?.payload?.messages?.[0]));
    check("the stream was closed cleanly", work.events.some((frame) => frame.includes("[DONE]")));
    check("and the key is nowhere in it", !work.content.includes("SECRET") && !work.events.join("").includes("SECRET"));

    section("5. A chat turn never leaves this machine");
    seen.length = 0;
    const chat = await post("/api/llm/chat", { messages, assistantMode: "chat", stream: true });
    check("the gateway was not called for chat", seen.length === 0, String(seen.length));
    check("chat still needs the local model",
      chat.status === 409 && /text model/i.test(chat.data?.error || ""),
      `${chat.status} ${JSON.stringify(chat.data)}`);

    section("6. A request with no mode at all is treated as chat");
    seen.length = 0;
    const unmarked = await post("/api/llm/chat", { messages, stream: true });
    check("the gateway was not called", seen.length === 0, String(seen.length));
    check("and it fell through to the local path", unmarked.status === 409, String(unmarked.status));

    section("7. When every provider is spent, the turn falls back rather than lying");
    seen.length = 0;
    gatewayMode = "refuse";

    const refused = await post("/api/llm/chat", { messages, assistantMode: "work", stream: true });
    check("the gateway was tried", seen.length === 1, String(seen.length));
    check("nothing had streamed, so the response is still clean",
      refused.status === 409 && /text model/i.test(refused.data?.error || ""),
      `${refused.status} ${JSON.stringify(refused.data).slice(0, 160)}`);

    gatewayMode = "answer";

    section("8. Turning the local fallback off is honoured");
    const toggleOff = await post("/api/text-runtime/remote-provider/model", {
      localFallback: false,
    });
    check("the switch can be turned off",
      toggleOff.status === 200 && toggleOff.data.provider.localFallback === false,
      JSON.stringify(toggleOff.data?.provider?.localFallback));

    seen.length = 0;
    gatewayMode = "refuse";

    const noFallback = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, assistantMode: "work", stream: true }),
    });

    check("the gateway was tried", seen.length === 1, String(seen.length));
    check("and the turn did not fall back to the local model", noFallback.status === 200, String(noFallback.status));

    const explained = await readSse(noFallback);
    check("the user is told what refused, in words",
      /could not finish this turn/i.test(explained.content) && /NVIDIA/i.test(explained.content),
      explained.content.slice(0, 160));

    gatewayMode = "answer";

    await post("/api/text-runtime/remote-provider/model", { localFallback: true });

    section("9. Disconnecting puts the turn back on this machine");
    const cleared = await post("/api/text-runtime/remote-provider/key", {
      providerId: "nvidia",
      action: "clear",
    });
    check("the key can be forgotten", cleared.status === 200 && cleared.data.ok === true);
    check("and the chain is empty again", cleared.data.provider.chain.length === 0);

    seen.length = 0;
    const afterClear = await post("/api/llm/chat", { messages, assistantMode: "work", stream: true });
    check("a Work turn no longer reaches the cloud", seen.length === 0, String(seen.length));
    check("it goes back to needing the local model", afterClear.status === 409, String(afterClear.status));
    check("and the key file no longer holds it",
      !fs.readFileSync(scratchKeyFile, "utf8").includes("SECRET"));
  } finally {
    child.kill("SIGTERM");
    gateway.close();
    fs.rmSync(scratchKeyFile, { force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
