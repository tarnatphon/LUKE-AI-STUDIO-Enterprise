#!/usr/bin/env node
"use strict";

/**
 * The text backend must never be handed two requests at once, and it must never
 * be handed a payload larger than its context window. Both failures look the
 * same to the user: the answer stops halfway with ECONNRESET.
 *
 * Run: node scripts/validation/test-llm-request-guard.cjs
 */

const {
  countPromptTokens,
  createRequestQueue,
  fitMessagesToContext,
  findLongestIndex,
  findOldestDroppableIndex,
  isConnectionLossError,
} = require("../server/llm-request-guard.cjs");

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

async function main() {
  console.log("Text model request guard validation");

  section("1. Only one request reaches llama.cpp at a time");
  {
    const queue = createRequestQueue();
    const order = [];
    let running = 0;
    let peak = 0;
    const make = (name, ms) => () => queue.withSlot(name, async () => {
      running += 1;
      peak = Math.max(peak, running);
      order.push(`start:${name}`);
      await delay(ms);
      order.push(`end:${name}`);
      running -= 1;
      return name;
    });
    const results = await Promise.all([make("chat", 40)(), make("summary", 10)(), make("agency", 1)()]);
    check("every job completes", results.join(",") === "chat,summary,agency", results.join(","));
    check("they never overlap", peak === 1, `peak ${peak}`);
    check("they run one after another", order.join(" ") === "start:chat end:chat start:summary end:summary start:agency end:agency", order.join(" "));
  }

  {
    const queue = createRequestQueue();
    const release = await queue.hold("chat stream");
    let secondRan = false;
    const second = queue.withSlot("agency", async () => { secondRan = true; });
    await delay(20);
    check("a queued job waits for the stream to finish", secondRan === false);
    check("the waiter is counted", queue.waiters === 1, String(queue.waiters));
    release();
    await second;
    check("the queued job runs as soon as the slot is free", secondRan === true);
  }

  {
    const queue = createRequestQueue();
    let failedTaskRejected = false;
    await queue.withSlot("boom", async () => { throw new Error("backend died"); }).catch(() => { failedTaskRejected = true; });
    check("a failing job releases the slot", failedTaskRejected);
    let later = false;
    await queue.withSlot("after", async () => { later = true; });
    check("the next job is not blocked by a failure", later === true);
  }

  section("2. The payload always fits the context window");
  const long = (chars) => "ก".repeat(chars);
  const counter = (tokensPerMessage) => (messages) => messages.length * tokensPerMessage;

  {
    const messages = [
      { role: "system", content: "be brief" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    let called = 0;
    const result = await fitMessagesToContext(messages, {
      contextTokens: 8192,
      answerTokens: 1024,
      estimate: () => 100,
      countTokens: () => { called += 1; return 999999; },
    });
    check(
      "a short chat never pays for a token round trip",
      called === 0 && result.length === messages.length && result.every((message, index) => message === messages[index])
    );
  }

  {
    const messages = [
      { role: "system", content: "be brief" },
      { role: "user", content: long(2000) },
      { role: "assistant", content: long(2000) },
      { role: "user", content: long(2000) },
      { role: "assistant", content: long(2000) },
      { role: "user", content: "and the newest question must survive" },
    ];
    const result = await fitMessagesToContext(messages, {
      contextTokens: 8192,
      answerTokens: 1024,
      estimate: () => 9000,
      countTokens: counter(1500),
      maxRounds: 14,
    });
    check("an oversized payload is shrunk until it fits", result.length * 1500 <= 8192 - 1024 - 128, `${result.length} messages`);
    check("the newest message survives", result[result.length - 1]?.content === "and the newest question must survive");
    check("the leading system message survives", result[0]?.role === "system" && result[0]?.content === "be brief");
    check("at least two messages are always kept", result.length >= 2, String(result.length));
  }

  {
    const messages = [
      { role: "system", content: "be brief" },
      { role: "user", content: long(40000) },
    ];
    const result = await fitMessagesToContext(messages, {
      contextTokens: 4096,
      answerTokens: 512,
      estimate: () => 50000,
      countTokens: counter(100000),
      maxRounds: 14,
    });
    check("one message that is simply too big gets trimmed", result.length === 2 && result[1].content.length < 40000, `${result[1].content.length} chars`);
    check("the trimmed message keeps a head and a tail", result[1].content.includes("[trimmed to fit the context window]"));
  }

  {
    const messages = [{ role: "user", content: "x" }];
    let counted = 0;
    const result = await fitMessagesToContext(messages, {
      contextTokens: 4096,
      answerTokens: 512,
      estimate: () => 9000,
      countTokens: () => { counted += 1; return 0; },
    });
    check("an unavailable tokenizer falls back to the estimate", result.length === 1 && counted === 1);
  }

  {
    const messages = [{ role: "user", content: "x" }];
    const result = await fitMessagesToContext(messages, {
      contextTokens: 4096,
      answerTokens: 512,
      estimate: () => 9000,
    });
    check("without a counter the payload is left alone", result.length === 1);
  }

  {
    let logged = 0;
    const messages = [
      { role: "user", content: long(3000) },
      { role: "assistant", content: long(3000) },
      { role: "user", content: long(3000) },
      { role: "assistant", content: long(3000) },
      { role: "user", content: long(3000) },
      { role: "user", content: "last" },
    ];
    await fitMessagesToContext(messages, {
      contextTokens: 8192,
      answerTokens: 1024,
      estimate: () => 9000,
      countTokens: counter(2000),
      log: () => { logged += 1; },
    });
    check("trimming is reported once", logged === 1, String(logged));
  }

  section("3. Picking what to drop");
  check("leading system messages are never dropped", findOldestDroppableIndex([
    { role: "system", content: "a" },
    { role: "system", content: "b" },
    { role: "user", content: "c" },
    { role: "assistant", content: "d" },
  ]) === 2);
  check("the last message is never dropped", findOldestDroppableIndex([
    { role: "user", content: "only one" },
  ]) === -1);
  check("a system-only payload has nothing to drop", findOldestDroppableIndex([
    { role: "system", content: "a" },
    { role: "system", content: "b" },
  ]) === -1);
  check("the longest message is found", findLongestIndex([
    { role: "user", content: "short" },
    { role: "user", content: "a".repeat(900) },
  ]) === 1);
  check("short messages are not worth trimming", findLongestIndex([{ role: "user", content: "short" }]) === -1);

  section("4. Recognising a backend that went away");
  check("ECONNRESET is recognised", isConnectionLossError("read ECONNRESET"));
  check("socket hang up is recognised", isConnectionLossError("socket hang up"));
  check("a refused connection is recognised", isConnectionLossError("connect ECONNREFUSED 127.0.0.1:10086"));
  check("an ordinary error is not mistaken for it", isConnectionLossError("model not found") === false);
  check("a missing message is safe", isConnectionLossError(undefined) === false);

  section("5. Counting tokens through llama.cpp");
  {
    const calls = [];
    const requestJson = async (url, payload) => {
      calls.push({ url, payload });
      return { tokens: new Array(Math.ceil(String(payload.content).length / 4)).fill(1) };
    };
    const count = await countPromptTokens(
      [{ role: "user", content: "hello" }, { role: "assistant", content: "hi there" }],
      { port: 10086, requestJson },
    );
    check("the tokenizer endpoint is used", calls.length === 1 && calls[0].url === "http://127.0.0.1:10086/tokenize");
    check("the roles are part of what is counted", String(calls[0].payload.content).includes("<|user|>") && String(calls[0].payload.content).includes("<|assistant|>"));
    check("the token count comes back", count === 10, String(count));
    const empty = await countPromptTokens([], { requestJson });
    check("an empty payload costs no round trip", empty === 0 && calls.length === 1);
    const broken = await countPromptTokens([{ role: "user", content: "x" }], {
      requestJson: async () => { throw new Error("no /tokenize here"); },
    });
    check("a backend without /tokenize reports 0 instead of throwing", broken === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
