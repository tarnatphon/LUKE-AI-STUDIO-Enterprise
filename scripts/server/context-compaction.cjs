"use strict";

/**
 * Context compaction — chat that never runs out of context.
 *
 * The conversation the user sees is never touched. What changes is only the
 * payload that is sent to llama.cpp: once the history approaches the model's
 * context window the oldest part is condensed, exactly like the hosted
 * assistants do, so typing can continue forever.
 *
 * Strategy (hybrid — cheapest first, model only when needed):
 *
 *   1. free   : throw away injected bulk (web search results, long attachment
 *               text) from everything but the newest turns
 *   2. free   : drop the oldest turns, always keeping system prompts and the
 *               newest turns the user can still see
 *   3. model  : ask the currently loaded model to summarise the dropped span
 *               into a compact memory block, then keep summary + newest turns
 *
 * Steps 1-2 cost nothing; step 3 costs one short generation and only runs when
 * trimming alone cannot buy enough room.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const DEFAULT_CONFIG = {
  enabled: true,
  triggerRatio: 0.7,
  answerReserveRatio: 0.15,
  keepLastMessages: 6,
  keepLastMessagesWithSummary: 4,
  maxSummaryTokens: 600,
  summaryTimeoutMs: 120000,
  summaryTemperature: 0.2,
  strategy: "hybrid",
  minMessagesBeforeSummary: 6,
  preserveFullHistory: true,
};

const THAI_RANGE = /[\u0E00-\u0E7F]/g;

function readConfig(root) {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, "app", "config", "text-chat", "context-compaction.json"), "utf8")
    );
    return { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch (_) {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Rough token estimate without a model round trip. Thai is expensive in every
 * llama tokenizer (close to one token per character) while latin text averages
 * about four characters per token, so the two are counted separately.
 */
function estimateTokens(value) {
  if (value === null || value === undefined) return 0;
  let text = value;
  if (Array.isArray(value)) {
    text = value
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join(" ");
  }
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch (_) {
      text = String(text);
    }
  }
  if (!text) return 0;
  const thai = (text.match(THAI_RANGE) || []).length;
  const rest = text.length - thai;
  return Math.ceil(thai * 1.2 + rest / 3.6);
}

function messageTokens(message) {
  if (!message || typeof message !== "object") return 0;
  const contentTokens =
    typeof message.content === "string"
      ? estimateTokens(message.content)
      : estimateTokens(message.content);
  const nameTokens = estimateTokens(message.name || "");
  // role + separators
  return contentTokens + nameTokens + 4;
}

function payloadTokens(messages, extra = 0) {
  const total = (Array.isArray(messages) ? messages : []).reduce(
    (sum, message) => sum + messageTokens(message),
    0
  );
  return total + extra + 8;
}

function isWebContextBlock(message) {
  if (!message || message.role !== "user") return false;
  const text = typeof message.content === "string" ? message.content : "";
  return /web search results|search results:|sources?:|\[web context\]/i.test(text) && text.length > 1200;
}

function trimBulkContent(message) {
  if (!message || typeof message.content !== "string") return message;
  const text = message.content;
  if (text.length <= 1200) return message;
  // Keep the head (the question) and the tail (the newest result), drop the
  // middle of long injected blocks or attachments.
  const head = text.slice(0, 400);
  const tail = text.slice(-300);
  return { ...message, content: `${head}\n…[ตัดเนื้อหาที่ยาวออกเพื่อประหยัด context]…\n${tail}` };
}

function cloneMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({ ...message }));
}

/**
 * Decides what has to be sent. Pure function — no model call — so the whole
 * policy can be validated without weights.
 */
function planCompaction(messages, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
  const contextTokens = Math.max(512, Number(options.contextTokens) || 4096);
  const answerTokens = Math.max(
    128,
    Number(options.answerTokens) || Math.round(contextTokens * config.answerReserveRatio)
  );
  const budget = Math.max(
    256,
    Math.round(contextTokens * config.triggerRatio) - answerTokens
  );

  const original = cloneMessages(messages);
  const usedTokens = payloadTokens(original);
  const result = {
    messages: original,
    usedTokens,
    budget,
    contextTokens,
    answerTokens,
    compacted: false,
    strategy: null,
    droppedCount: 0,
    trimmedCount: 0,
    savedTokens: 0,
    needsSummary: false,
    summarizedSpan: null,
  };

  if (config.enabled === false) return result;
  if (usedTokens <= budget) return result;

  // ── step 1: free — strip injected bulk from everything but the last turns ──
  const keepVerbatim = Math.max(2, Number(config.keepLastMessages) || 6);
  const bulkStart = 0;
  // Never trim inside the newest turns — but on a short conversation "the
  // newest six" is the whole conversation, so the protected tail is capped.
  const protectedTail = Math.min(keepVerbatim, Math.max(2, Math.floor(original.length / 2)));
  const bulkEnd = Math.max(0, original.length - protectedTail);
  let trimmed = 0;
  const stage1 = original.map((message, index) => {
    if (index < bulkStart || index >= bulkEnd) return message;
    if (!isWebContextBlock(message) && typeof message.content === "string" && message.content.length <= 1200) {
      return message;
    }
    trimmed += 1;
    return trimBulkContent(message);
  });

  result.trimmedCount = trimmed;
  if (payloadTokens(stage1) <= budget) {
    result.messages = stage1;
    result.compacted = true;
    result.strategy = "trim-bulk";
    result.savedTokens = usedTokens - payloadTokens(stage1);
    return result;
  }

  // ── step 2: free — drop the oldest turns (never system, never the newest) ──
  const systemMessages = [];
  let cursor = 0;
  while (cursor < stage1.length && stage1[cursor]?.role === "system") {
    systemMessages.push(stage1[cursor]);
    cursor += 1;
  }
  const conversation = stage1.slice(cursor);
  let keepFrom = 0;
  let candidate = null;
  while (keepFrom < conversation.length) {
    const window = [...systemMessages, ...conversation.slice(keepFrom)];
    if (payloadTokens(window) <= budget) {
      candidate = window;
      break;
    }
    keepFrom += 1;
  }

  if (candidate && candidate.length > systemMessages.length) {
    const droppedSpan = conversation.slice(0, keepFrom);
    result.messages = candidate;
    result.compacted = true;
    result.strategy = "drop-oldest";
    result.droppedCount = droppedSpan.length;
    result.savedTokens = usedTokens - payloadTokens(candidate);
    result.needsSummary =
      config.strategy !== "trim" &&
      droppedSpan.length >= Number(config.minMessagesBeforeSummary || 6);
    result.summarizedSpan = droppedSpan;
    return result;
  }

  // ── step 3: nothing fits by trimming — keep the newest turns only ─────────
  const lastTurns = conversation.slice(-Math.max(2, Number(config.keepLastMessagesWithSummary) || 4));
  const droppedSpan = conversation.slice(0, conversation.length - lastTurns.length);
  result.messages = [...systemMessages, ...lastTurns];
  result.compacted = true;
  result.strategy = "keep-newest";
  result.droppedCount = droppedSpan.length;
  result.savedTokens = usedTokens - payloadTokens(result.messages);
  result.needsSummary =
    config.strategy !== "trim" && droppedSpan.length >= Number(config.minMessagesBeforeSummary || 6);
  result.summarizedSpan = droppedSpan;
  return result;
}

function buildSummaryRequest(span, options = {}) {
  const transcript = span
    .map((message) => {
      const role = message.role === "assistant" ? "ผู้ช่วย" : message.role === "system" ? "ระบบ" : "ผู้ใช้";
      const text =
        typeof message.content === "string"
          ? message.content
          : (message.content || []).map((part) => part?.text || "").join(" ");
      return `${role}: ${text.slice(0, 1500)}`;
    })
    .join("\n");

  return {
    model: options.model || "local-model",
    messages: [
      {
        role: "system",
        content:
          "คุณกำลังช่วยบีบอัดประวัติการสนทนา ตอบเป็นภาษาเดียวกับการสนทนา " +
          "สรุปเฉพาะสิ่งสำคัญ: สิ่งที่ผู้ใช้ต้องการ, ข้อตกลง, ข้อมูลหรือตัวเลขที่ใช้ต่อ, " +
          "และงานที่ยังทำไม่เสร็จ ห้ามเพิ่มข้อมูลใหม่ ห้ามถามคำถาม ให้เป็นข้อความกระชับ",
      },
      { role: "user", content: transcript },
    ],
    temperature: Number(options.temperature ?? 0.2),
    max_tokens: Number(options.maxSummaryTokens || 600),
    stream: false,
  };
}

function requestSummary(port, span, options = {}) {
  return new Promise((resolve) => {
    const body = JSON.stringify(buildSummaryRequest(span, options));
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw || "{}");
            const content = parsed?.choices?.[0]?.message?.content;
            if (content && String(content).trim()) {
              resolve({ ok: true, summary: String(content).trim() });
              return;
            }
            resolve({ ok: false, error: "empty summary" });
          } catch (error) {
            resolve({ ok: false, error: error.message || String(error) });
          }
        });
      }
    );
    req.setTimeout(Number(options.timeoutMs || 120000), () => {
      req.destroy();
      resolve({ ok: false, error: "summary timeout" });
    });
    req.on("error", (error) => resolve({ ok: false, error: error.message || String(error) }));
    req.end(body);
  });
}

function summaryMessage(summary, droppedCount, languageHint = "th") {
  const label =
    languageHint === "th"
      ? `สรุปการสนทนาก่อนหน้า (${droppedCount} ข้อความที่ถูกบีบอัดอัตโนมัติ):`
      : `Summary of the earlier conversation (${droppedCount} compacted messages):`;
  return { role: "system", content: `${label}\n${summary}` };
}

/**
 * Full pipeline used by /api/llm/chat: plan → (optionally) summarise → payload.
 */
async function compactForChat(messages, options = {}) {
  const plan = planCompaction(messages, options);
  if (!plan.compacted) return plan;
  if (!plan.needsSummary || !options.summaryPort) return plan;

  const summary = await requestSummary(options.summaryPort, plan.summarizedSpan, {
    model: options.model,
    temperature: (options.config || {}).summaryTemperature,
    maxSummaryTokens: (options.config || {}).maxSummaryTokens,
    timeoutMs: (options.config || {}).summaryTimeoutMs,
  });

  if (!summary.ok) {
    plan.summaryError = summary.error;
    return plan;
  }

  const systemMessages = [];
  let cursor = 0;
  while (cursor < plan.messages.length && plan.messages[cursor]?.role === "system") {
    systemMessages.push(plan.messages[cursor]);
    cursor += 1;
  }
  const rest = plan.messages.slice(cursor);
  plan.messages = [...systemMessages, summaryMessage(summary.summary, plan.droppedCount), ...rest];
  plan.summary = summary.summary;
  plan.strategy = "summarize";
  plan.savedTokens = plan.usedTokens - payloadTokens(plan.messages);
  return plan;
}

module.exports = {
  DEFAULT_CONFIG,
  readConfig,
  estimateTokens,
  messageTokens,
  payloadTokens,
  planCompaction,
  buildSummaryRequest,
  requestSummary,
  summaryMessage,
  compactForChat,
  isWebContextBlock,
  trimBulkContent,
};
