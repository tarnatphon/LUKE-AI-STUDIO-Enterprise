"use strict";

/**
 * Everything that protects llama.cpp from a request it cannot survive.
 *
 * 1. a single queue: llama-server runs with --parallel 1, so two requests at
 *    the same time fight over the one slot and the chat stream can be cut off
 *    mid-answer (ECONNRESET). Chat, the compaction summary and the scheduled
 *    agency jobs all take turns here.
 * 2. a real size check: the heuristic token estimator is only an estimate. When
 *    it is wrong the prompt can be larger than the context window, which is the
 *    other reason the backend drops the connection. So before a payload leaves,
 *    it is measured with the model's own tokenizer and shrunk until it fits.
 */

function createRequestQueue() {
  let chain = Promise.resolve();
  let waiters = 0;

  function hold(label, onWait = null) {
    return new Promise((resolveHold) => {
      waiters += 1;
      const previous = chain.catch(() => {});
      let releaseSlot = () => {};
      const held = new Promise((resolve) => { releaseSlot = resolve; });
      chain = previous.then(() => held).catch(() => {});
      previous.then(() => {
        waiters -= 1;
        if (waiters > 0 && typeof onWait === "function") onWait(label, waiters);
        resolveHold(() => releaseSlot());
      });
    });
  }

  async function withSlot(label, task, onWait = null) {
    const release = await hold(label, onWait);
    try {
      return await task();
    } finally {
      release();
    }
  }

  return { hold, withSlot, get waiters() { return waiters; } };
}

// The one queue the application uses.
const llmQueue = createRequestQueue();

function holdLlmSlot(label) {
  return llmQueue.hold(label, (pendingLabel, count) => {
    console.log(`  [llm] ${pendingLabel} is waiting for the text model (${count} queued).`);
  });
}

function withLlmSlot(label, task) {
  return llmQueue.withSlot(label, task, (pendingLabel, count) => {
    console.log(`  [llm] ${pendingLabel} is waiting for the text model (${count} queued).`);
  });
}

/**
 * Ask llama.cpp how many tokens a payload really is. Returns 0 when the
 * endpoint is unavailable, and callers then fall back to the estimate.
 */
async function countPromptTokens(messages, { port = 10086, requestJson } = {}) {
  const text = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const content = typeof message?.content === "string"
        ? message.content
        : (Array.isArray(message?.content)
            ? message.content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join(" ")
            : "");
      return `<|${message?.role || "user"}|>\n${content}`;
    })
    .join("\n")
    .trim();
  if (!text || typeof requestJson !== "function") return 0;
  try {
    const result = await requestJson(`http://127.0.0.1:${port}/tokenize`, { content: text }, 8000);
    const count = Array.isArray(result?.tokens)
      ? result.tokens.length
      : Number(result?.n_tokens || result?.count || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch (_) {
    return 0;
  }
}

function findOldestDroppableIndex(messages) {
  let cursor = 0;
  while (cursor < messages.length && messages[cursor]?.role === "system") cursor += 1;
  // The newest message always has to survive, otherwise the question is lost.
  for (let index = cursor; index < messages.length - 1; index += 1) {
    if (messages[index]?.role !== "system") return index;
  }
  return -1;
}

function findLongestIndex(messages, minimumLength = 400) {
  let best = -1;
  let bestLength = -1;
  messages.forEach((message, index) => {
    const content = typeof message?.content === "string"
      ? message.content
      : JSON.stringify(message?.content ?? "");
    if (content.length > bestLength) {
      bestLength = content.length;
      best = index;
    }
  });
  return bestLength > minimumLength ? best : -1;
}

/**
 * Shrink a payload until the model's own tokenizer says it fits.
 * Short chats never pay for a round trip: when the estimate is comfortably
 * below the limit the payload is returned untouched.
 */
async function fitMessagesToContext(messages, options = {}) {
  const list = Array.isArray(messages) ? [...messages] : [];
  if (list.length === 0) return list;

  const {
    contextTokens = 4096,
    answerTokens = 512,
    reserveTokens = 128,
    estimate = () => 0,
    countTokens = null,
    log = null,
    maxRounds = 14,
  } = options;

  const limit = Math.max(256, Number(contextTokens) - Number(answerTokens) - Number(reserveTokens));
  if (Number(estimate(list)) <= limit * 0.55) return list;
  if (typeof countTokens !== "function") return list;

  for (let round = 0; round < Number(maxRounds); round += 1) {
    const realTokens = await countTokens(list);
    if (!realTokens) return list; // tokenizer unavailable: keep the heuristic result
    if (realTokens <= limit) {
      if (round > 0 && typeof log === "function") {
        log(`payload trimmed to fit the ${contextTokens}-token window: ${realTokens} tokens, ${list.length} messages.`);
      }
      return list;
    }
    const dropIndex = findOldestDroppableIndex(list);
    if (dropIndex !== -1) {
      list.splice(dropIndex, 1);
      continue;
    }
    const trimIndex = findLongestIndex(list);
    if (trimIndex === -1) return list;
    const content = typeof list[trimIndex].content === "string"
      ? list[trimIndex].content
      : JSON.stringify(list[trimIndex].content ?? "");
    const keep = Math.max(400, Math.floor(content.length * 0.6));
    const half = Math.floor(keep / 2);
    list[trimIndex] = {
      ...list[trimIndex],
      content: `${content.slice(0, half)}\n…[trimmed to fit the context window]…\n${content.slice(-half)}`,
    };
  }
  if (typeof log === "function") {
    log(`warning: the payload still does not fit the ${contextTokens}-token window after trimming.`);
  }
  return list;
}

function isConnectionLossError(message) {
  const lower = String(message || "").toLowerCase();
  return lower.includes("econnreset")
    || lower.includes("socket hang up")
    || lower.includes("econnrefused")
    || lower.includes("epipe");
}

module.exports = {
  countPromptTokens,
  createRequestQueue,
  fitMessagesToContext,
  findLongestIndex,
  findOldestDroppableIndex,
  holdLlmSlot,
  isConnectionLossError,
  withLlmSlot,
};
