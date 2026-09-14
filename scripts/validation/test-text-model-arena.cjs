#!/usr/bin/env node
"use strict";

/**
 * Text Model Arena validation.
 *
 * Boots the real application server with a mock llama-server binary so the
 * whole arena flow is exercised without model weights:
 *
 *   1. three models are loaded at the same time (one llama.cpp process each)
 *   2. all three answer the same prompt in parallel (SSE deltas)
 *   3. a judge pass ranks the answers
 *   4. the best answer wins and feedback is recorded
 *
 * The evaluator module is additionally unit tested directly.
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const modelsDir = path.join(root, "app", "llm-models");
const arenaStateFile = path.join(root, "app", "runtime-state", "text-chat", "model-arena.json");
const policyFile = path.join(root, "app", "config", "text-chat", "model-arena-policy.json");
const componentFile = path.join(root, "app", "frontend", "src", "components", "ModelArenaPanel.jsx");
const chatComponentFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");
const evaluatorFile = path.join(root, "scripts", "server", "text-arena-evaluator.cjs");

const MODEL_IDS = ["arena-alpha.gguf", "arena-beta.gguf", "arena-gamma.gguf"];

const ANSWERS = {
  "arena-alpha.gguf": "สั้นเกินไป",
  "arena-beta.gguf":
    "Multi Model Arena ให้โมเดลหลายตัวตอบคำถามเดียวกันพร้อมกัน จากนั้นระบบประเมินความเกี่ยวข้อง ความครบถ้วน ความชัดเจน และรายละเอียดของแต่ละคำตอบ ก่อนเลือกคำตอบที่ดีที่สุดให้ผู้ใช้ ตัวอย่างเช่น เมื่อถามเรื่องเดียวกัน โมเดลที่อธิบายครบทั้งขั้นตอนและยกตัวอย่างจะได้คะแนนสูงกว่า",
  "arena-gamma.gguf": "อีกหนึ่งคำตอบที่อธิบายการเปรียบเทียบได้ระดับหนึ่ง",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error || !port ? reject(error || new Error("no port")) : resolve(port)));
    });
  });
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null, text };
}

function parseEvents(streamText) {
  const events = [];
  for (const frame of streamText.split("\n\n")) {
    const lines = frame.split(/\r?\n/);
    let eventName = "message";
    let dataText = "";
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataText += line.slice(5).trim();
    }
    if (!dataText) continue;
    try {
      events.push({ event: eventName, data: JSON.parse(dataText) });
    } catch (_) {}
  }
  return events;
}

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function writeMockBackend(filePath) {
  const source = `#!/usr/bin/env node
"use strict";
const http = require("node:http");

const argv = process.argv.slice(2);
const modelIndex = argv.indexOf("--model");
const portIndex = argv.indexOf("--port");
const modelPath = modelIndex >= 0 ? argv[modelIndex + 1] : "";
const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : 0;
const modelId = String(modelPath).split(/[\\\\/]/).pop();

const answers = ${JSON.stringify(ANSWERS)};
const JUDGE_MARKER = "impartial evaluation judge";

function chunk(res, payload) {
  res.write("data: " + JSON.stringify(payload) + "\\n\\n");
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const part of req) chunks.push(part);
  const raw = Buffer.concat(chunks).toString("utf8");

  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: modelId, object: "model" }] }));
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    const body = JSON.parse(raw || "{}");
    const system = (body.messages || []).filter((m) => m.role === "system").map((m) => String(m.content || "")).join("\\n");
    let answer;

    if (system.includes(JUDGE_MARKER)) {
      answer = JSON.stringify({
        ranking: [
          { modelId: "arena-beta.gguf", score: 94, reason: "most complete and directly answers the request" },
          { modelId: "arena-gamma.gguf", score: 61, reason: "partially complete" },
          { modelId: "arena-alpha.gguf", score: 22, reason: "too short" },
        ],
        winnerModelId: "arena-beta.gguf",
        summary: "beta is the clearest answer",
      });
    } else {
      answer = answers[modelId] || "no answer";
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const parts = [answer.slice(0, Math.ceil(answer.length / 2)), answer.slice(Math.ceil(answer.length / 2))].filter(Boolean);
    for (const part of parts) {
      chunk(res, { choices: [{ delta: { content: part }, finish_reason: null }] });
      await new Promise((r) => setTimeout(r, 10));
    }
    chunk(res, {
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 40, total_tokens: 52 },
      timings: { predicted_n: 40, predicted_ms: 120, prompt_ms: 30 },
    });
    res.write("data: [DONE]\\n\\n");
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {});
`;
  fs.writeFileSync(filePath, source, "utf8");
  fs.chmodSync(filePath, 0o755);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unitTestEvaluator() {
  const {
    evaluateArenaResponses,
    parseJudgeResult,
    calculateHeuristicMetrics,
  } = require(evaluatorFile);

  const metrics = calculateHeuristicMetrics({
    content: ANSWERS["arena-beta.gguf"],
    prompt: "อธิบาย Multi Model Arena",
    peers: [ANSWERS["arena-alpha.gguf"]],
  });
  assert(metrics.completeness > 0.5, "detailed answer should score high completeness");
  assert(metrics.characters > 0, "metrics should count characters");

  const parsed = parseJudgeResult(
    'Here you go: {"ranking":[{"modelId":"a.gguf","score":90},{"modelId":"b.gguf","score":40}],"winnerModelId":"a.gguf","summary":"ok"}',
    ["a.gguf", "b.gguf"]
  );
  assert(parsed.ok === true, "judge JSON should parse");
  assert(parsed.winnerModelId === "a.gguf", "judge winner should be a.gguf");
  assert(parsed.ranking.length === 2, "judge ranking should include every candidate");

  const broken = parseJudgeResult("I cannot decide.", ["a.gguf"]);
  assert(broken.ok === false, "non-JSON judge output must not be trusted");

  const evaluated = evaluateArenaResponses({
    prompt: "อธิบาย Multi Model Arena",
    responses: [
      { modelId: "a.gguf", content: ANSWERS["arena-beta.gguf"], status: "completed" },
      { modelId: "b.gguf", content: ANSWERS["arena-alpha.gguf"], status: "completed" },
      { modelId: "c.gguf", content: "", status: "failed", error: "boom" },
    ],
    judgeResult: parsed,
    policy: {},
    feedbackByModel: {},
  });
  assert(evaluated.responses.length === 3, "every response must be ranked");
  assert(evaluated.winner && evaluated.winner.modelId === "a.gguf", "best answer should win");
  assert(evaluated.responses[0].best === true, "rank 1 must be marked best");
  assert(evaluated.responses[2].usable === false, "failed responses are not usable");
  assert(evaluated.judge.used === true, "judge result should be applied");
}

async function main() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "luke-arena-"));
  const mockBackend = path.join(temporaryDir, "mock-llama-server");
  writeMockBackend(mockBackend);

  fs.mkdirSync(modelsDir, { recursive: true });
  const createdModels = [];
  for (const modelId of MODEL_IDS) {
    const target = path.join(modelsDir, modelId);
    if (!fs.existsSync(target)) createdModels.push(target);
    fs.writeFileSync(target, `mock weights for ${modelId}\n`, "utf8");
  }

  const hadState = fs.existsSync(arenaStateFile);
  const originalState = hadState ? fs.readFileSync(arenaStateFile, "utf8") : null;

  const appPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;

  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(appPort),
      LUKE_AI_HOST: "127.0.0.1",
      LUKE_AI_PORT: String(appPort),
      LUKE_AI_ARENA_LLAMA_SERVER: mockBackend,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  child.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
  });

  try {
    unitTestEvaluator();

    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.`);
      try {
        const response = await fetch(`${baseUrl}/api/llm/arena/status`);
        if (response.status === 200) ready = true;
      } catch (_) {}
      if (!ready) await delay(150);
    }
    if (!ready) throw new Error("Application server did not become ready.");

    const policyResponse = await requestJson(baseUrl, "/api/llm/arena/policy");
    assert(policyResponse.status === 200, "arena policy endpoint failed");
    assert(
      Number(policyResponse.data?.policy?.selection?.maximumModels || 0) === 3,
      "arena policy should allow three models"
    );

    const statusBefore = await requestJson(baseUrl, "/api/llm/arena/status");
    assert(statusBefore.status === 200, "arena status endpoint failed");
    assert(
      (statusBefore.data?.installed || []).some((model) => model.filename === MODEL_IDS[0]),
      "mock models should be listed as installed"
    );

    const response = await fetch(`${baseUrl}/api/llm/arena/generate-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "arena-validation",
        modelIds: MODEL_IDS,
        messages: [
          { role: "system", content: "You are a helpful local AI assistant." },
          { role: "user", content: "อธิบาย Multi Model Arena" },
        ],
      }),
    });

    assert(response.ok, `arena stream failed with HTTP ${response.status}`);
    const events = parseEvents(await readStream(response));
    if (!events.some((event) => event.event === "arena-complete")) {
      throw new Error(`arena stream did not complete. Server log:\n${serverLog.slice(-2000)}`);
    }

    const readyEvent = events.find((event) => event.event === "arena-ready");
    assert(
      readyEvent && (readyEvent.data.instances || []).length === 3,
      "all three models should be loaded at the same time"
    );

    const deltaModels = new Set(
      events.filter((event) => event.event === "model-delta").map((event) => event.data.modelId)
    );
    assert(deltaModels.size === 3, `every model should stream deltas (got ${[...deltaModels].join(", ")})`);

    const completeEvent = events.find((event) => event.event === "arena-complete");
    const evaluation = completeEvent?.data?.evaluation;
    assert(evaluation, "arena-complete must include the evaluation");
    assert(evaluation.responses.length === 3, "evaluation must include every model");
    assert(evaluation.winner?.modelId === "arena-beta.gguf", "the best answer should win");
    assert(evaluation.responses[0].best === true, "the winner must be marked best");
    assert(evaluation.judge.used === true, "the judge pass should run and be reported");
    assert(
      evaluation.responses.every((entry) => entry.rank >= 1),
      "every response needs a rank"
    );

    const loadedStatus = await requestJson(baseUrl, "/api/llm/arena/status");
    assert(
      (loadedStatus.data?.instances || []).length === 3,
      "arena instances should stay resident after the round"
    );

    const selectResponse = await requestJson(baseUrl, "/api/llm/arena/select", {
      method: "POST",
      body: { modelId: evaluation.winner.modelId, chosen: true },
    });
    assert(selectResponse.status === 200, "feedback endpoint failed");
    assert(
      Number(selectResponse.data?.feedback?.[evaluation.winner.modelId]?.positive || 0) >= 1,
      "chosen answer should be recorded as positive feedback"
    );

    const unloadResponse = await requestJson(baseUrl, "/api/llm/arena/unload", {
      method: "POST",
      body: { all: true },
    });
    assert(unloadResponse.status === 200, "unload endpoint failed");
    assert(
      Array.isArray(unloadResponse.data?.unloaded) && unloadResponse.data.unloaded.length === 3,
      "every arena model should be unloaded"
    );

    const statusAfter = await requestJson(baseUrl, "/api/llm/arena/status");
    assert(
      (statusAfter.data?.instances || []).length === 0,
      "no arena instance should remain after unloading"
    );

    const panelSource = fs.readFileSync(componentFile, "utf8");
    for (const marker of ["Multi-Model Arena", "คำตอบที่ดีที่สุด", "chat-arena-panel"]) {
      assert(panelSource.includes(marker), `ModelArenaPanel is missing "${marker}"`);
    }

    const chatSource = fs.readFileSync(chatComponentFile, "utf8");
    for (const marker of ["ModelArenaPanel", "runArenaRound", "streamModelArena"]) {
      assert(chatSource.includes(marker), `TextChat is missing "${marker}"`);
    }

    console.log("  ✓ text model arena: parallel loading, streaming, judging and winner selection");
  } finally {
    await stopProcess(child);
    for (const target of createdModels) {
      try {
        fs.unlinkSync(target);
      } catch (_) {}
    }
    if (originalState !== null) fs.writeFileSync(arenaStateFile, originalState, "utf8");
    else if (fs.existsSync(arenaStateFile)) fs.unlinkSync(arenaStateFile);
    try {
      fs.rmSync(temporaryDir, { recursive: true, force: true });
    } catch (_) {}
    if (fs.existsSync(policyFile) === false) throw new Error("arena policy file is missing");
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
