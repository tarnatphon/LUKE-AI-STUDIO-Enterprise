#!/usr/bin/env node
"use strict";

/**
 * Chat context compaction validation.
 *
 * The promise: the user can keep typing forever. The conversation shown in the
 * UI is never shortened — only the payload that reaches llama.cpp is condensed
 * once it approaches the context window.
 *
 * Validated here:
 *   1. token estimation (Thai costs more than latin)
 *   2. nothing happens while the history is small
 *   3. step 1 - injected bulk (web results) is trimmed for free
 *   4. step 2 - the oldest turns are dropped, system prompt and the newest
 *      turns always survive
 *   5. step 3 - the dropped span is summarised by the loaded model and the
 *      summary is injected as memory
 */

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const {
  estimateTokens,
  payloadTokens,
  planCompaction,
  compactForChat,
  buildSummaryRequest,
  summaryMessage,
  readConfig,
} = require("../server/context-compaction.cjs");

const root = path.resolve(__dirname, "..", "..");
const configFile = path.join(root, "app", "config", "text-chat", "context-compaction.json");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

const THAI = "สวัสดีครับ วันนี้ผมต้องการให้คุณช่วยสรุปเนื้อหาการสนทนาทั้งหมดที่ผ่านมาให้กระชับ";
const ENGLISH = "Good morning, please summarise everything we discussed so far in a compact way";

function unitTestTokens() {
  const thaiTokens = estimateTokens(THAI);
  const englishTokens = estimateTokens(ENGLISH);
  assert(thaiTokens > 0 && englishTokens > 0, `token estimation works (thai ${thaiTokens}, latin ${englishTokens})`);
  assert(
    thaiTokens / THAI.length > englishTokens / ENGLISH.length,
    "Thai is estimated at more tokens per character than latin text"
  );
  assert(estimateTokens("") === 0, "empty content costs nothing");
  assert(estimateTokens(null) === 0, "missing content costs nothing");
}

function buildConversation(turns, prefix = "ผู้ใช้ถามเรื่องการตลาด") {
  const messages = [{ role: "system", content: "คุณเป็นผู้ช่วยของ LUKE AI STUDIO" }];
  for (let index = 0; index < turns; index += 1) {
    messages.push({ role: "user", content: `${prefix} รอบที่ ${index + 1} ` + "รายละเอียดเพิ่มเติม ".repeat(20) });
    messages.push({
      role: "assistant",
      content: `คำตอบรอบที่ ${index + 1} ` + "เนื้อหาคำตอบของผู้ช่วย ".repeat(25),
    });
  }
  return messages;
}

function unitTestPlan() {
  const config = { ...readConfig(root), triggerRatio: 0.7 };
  const contextTokens = 4096;

  const small = [
    { role: "system", content: "คุณเป็นผู้ช่วย" },
    { role: "user", content: "สวัสดี" },
  ];
  const smallPlan = planCompaction(small, { config, contextTokens, answerTokens: 512 });
  assert(smallPlan.compacted === false, "a short conversation is sent exactly as it is");
  assert(
    smallPlan.messages.length === small.length,
    "no message is touched while there is room in the context"
  );

  const disabled = planCompaction(buildConversation(20), {
    config: { ...config, enabled: false },
    contextTokens,
    answerTokens: 512,
  });
  assert(disabled.compacted === false, "compaction can be switched off in the config");

  // Step 1: injected web bulk is trimmed before anything is dropped.
  const withBulk = [
    { role: "system", content: "คุณเป็นผู้ช่วย" },
    {
      role: "user",
      content: "Web search results:\n" + "ผลการค้นหาเว็บ ".repeat(200),
    },
    { role: "assistant", content: "นี่คือสิ่งที่เจอจากเว็บ " + "ข้อมูล ".repeat(50) },
    { role: "user", content: "ช่วยสรุปให้หน่อย" },
  ];
  const bulkPlan = planCompaction(withBulk, {
    config,
    contextTokens: 4096,
    answerTokens: 256,
  });
  assert(bulkPlan.compacted === true, "an oversized payload is compacted");
  assert(bulkPlan.strategy === "trim-bulk", "step 1 trims injected bulk before dropping turns");
  assert(
    bulkPlan.droppedCount === 0,
    "no conversation turn is lost when trimming alone is enough"
  );

  // Step 2: once trimming is not enough the oldest turns go, never the newest.
  const long = buildConversation(18);
  const dropped = planCompaction(long, { config, contextTokens: 2048, answerTokens: 256 });
  assert(dropped.compacted === true, "a long conversation is compacted");
  assert(dropped.droppedCount > 0, `oldest turns are dropped (${dropped.droppedCount} messages)`);
  assert(
    dropped.messages[0]?.role === "system",
    "the system prompt always survives compaction"
  );
  const lastOriginal = long[long.length - 1].content;
  assert(
    dropped.messages[dropped.messages.length - 1].content === lastOriginal,
    "the newest message the user just sent is never removed"
  );
  assert(
    payloadTokens(dropped.messages) <= dropped.budget,
    "the compacted payload fits inside the 70% budget"
  );
  assert(dropped.needsSummary === true, "the dropped span is handed to the summariser");
}

function unitTestSummaryRequest() {
  const span = [
    { role: "user", content: "อยากทำแคมเปญขายกระเป๋า" },
    { role: "assistant", content: "แนะนำให้เริ่มจากกลุ่มเป้าหมาย" },
  ];
  const request = buildSummaryRequest(span, { model: "m", maxSummaryTokens: 300 });
  assert(request.stream === false, "the summary request is not streamed");
  assert(request.messages.length === 2, "the summary request carries instructions and the transcript");
  assert(
    /บีบอัดประวัติการสนทนา/.test(request.messages[0].content),
    "the summariser is instructed in the language of the conversation"
  );
  assert(
    request.messages[1].content.includes("อยากทำแคมเปญขายกระเป๋า"),
    "the transcript is included in the summary request"
  );

  const injected = summaryMessage("สรุป: ทำแคมเปญกระเป๋า", 8);
  assert(injected.role === "system", "the summary comes back as a memory block");
  assert(injected.content.includes("8"), "the memory block says how much was compacted");
}

async function integrationTestSummary() {
  let sawSummaryRequest = false;
  let summaryPayload = null;

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const system = (body.messages || [])
      .filter((message) => message.role === "system")
      .map((message) => String(message.content || ""))
      .join("\n");

    if (system.includes("บีบอัดประวัติการสนทนา")) {
      sawSummaryRequest = true;
      summaryPayload = body;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "สรุป: ผู้ใช้กำลังวางแผนแคมเปญกระเป๋า กลุ่มเป้าหมายคือวัยทำงาน" } }],
        })
      );
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const config = { ...readConfig(root), triggerRatio: 0.7 };
    const messages = buildConversation(18);
    const result = await compactForChat(messages, {
      config,
      contextTokens: 2048,
      answerTokens: 256,
      summaryPort: port,
      model: "local-model",
    });

    assert(sawSummaryRequest === true, "the loaded model is asked to summarise the dropped span");
    assert(result.strategy === "summarize", "the final strategy is a summary, not a silent loss");
    assert(
      result.messages.some(
        (message) => message.role === "system" && message.content.includes("สรุปการสนทนาก่อนหน้า")
      ),
      "the summary is injected as a memory block so the chat keeps its context"
    );
    assert(
      result.messages[result.messages.length - 1].content === messages[messages.length - 1].content,
      "the newest message is still the last one after summarising"
    );
    assert(
      payloadTokens(result.messages) < result.usedTokens,
      `the payload shrank from about ${result.usedTokens} to about ${payloadTokens(result.messages)} tokens`
    );
    assert(
      summaryPayload.max_tokens <= Number(config.maxSummaryTokens),
      "the summary itself is capped so it cannot eat the context"
    );

    // A failing summariser must never break the chat.
    await new Promise((resolve) => server.close(resolve));
    const withoutBackend = await compactForChat(messages, {
      config: { ...config, summaryTimeoutMs: 400 },
      contextTokens: 2048,
      answerTokens: 256,
      summaryPort: port,
      model: "local-model",
    });
    assert(
      withoutBackend.compacted === true && withoutBackend.messages.length < messages.length,
      "if the summariser is unreachable the chat still continues (trimmed, not broken)"
    );
    assert(
      withoutBackend.messages[withoutBackend.messages.length - 1].content ===
        messages[messages.length - 1].content,
      "and the newest message still survives that failure"
    );
  } finally {
    try {
      server.close();
    } catch (_) {}
  }
}

(async () => {
  console.log("Chat context compaction validation");
  assert(fs.existsSync(configFile), "the compaction policy ships as a config file");
  const config = readConfig(root);
  assert(config.preserveFullHistory === true, "the policy keeps the UI history untouched by default");
  assert(
    Math.abs(Number(config.triggerRatio) - 0.7) < 0.001,
    `compaction starts at ${Math.round(Number(config.triggerRatio) * 100)}% of the context window`
  );
  unitTestTokens();
  unitTestPlan();
  unitTestSummaryRequest();
  await integrationTestSummary();
  console.log("\nPASS: chat context compaction validation completed.");
})().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
