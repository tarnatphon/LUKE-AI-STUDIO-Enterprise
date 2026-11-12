"use strict";

/**
 * How much of a prompt the model can actually attend to.
 *
 * Split out of image-quality.cjs because this is a *display* calculation — one
 * chip and one note — while image-quality.cjs is imported by services/api.js,
 * which is in the entry bundle. The bundle budget test
 * (test-frontend-bundle-budgets.cjs) caught the cost of keeping them together.
 *
 * src/conditioning/conditioner.hpp in the pinned build (master-685-19bdfe2)
 * tokenises to `chunk_len = 77` and pads with `allow_overflow_expand = true`:
 * text past the first 77 tokens is not dropped, it becomes a second chunk that
 * is attended separately. Adherence therefore does not fall off a cliff — it
 * thins out, and the tail of a long prompt carries less weight than its head.
 * That is the mechanism behind "I described it exactly and it ignored half".
 *
 * CLIP's BPE runs about 1.3 tokens per English word, so 77 tokens is roughly 59
 * words. T5-based families (FLUX, SD3) have a 512-token window and are not
 * chunked this way.
 */

// ── How much prompt the model can actually read ─────────────────────────────
//
// src/conditioning/conditioner.hpp in the pinned build tokenises to
// chunk_len = 77 and pads with allow_overflow_expand = true: text past the
// first 77 tokens is not dropped, it becomes a *second* chunk that is attended
// separately. Adherence therefore does not fall off a cliff — it thins out, and
// the tail of a long prompt carries less weight than its head. That is the
// mechanism behind "I described it exactly and it ignored half of it".
//
// CLIP's BPE runs about 1.3 tokens per English word, so 77 tokens is roughly 59
// words; a prompt of 60 is already a two-chunk prompt at 0.95 chunks of budget.
// T5-based families (FLUX, SD3) have a 512-token window and are not affected.

const CLIP_CHUNK_TOKENS = 77;
const TOKENS_PER_WORD = 1.3;

function promptBudget(family) {
  const t5 = family === "flux" || family === "sd3";
  const tokens = t5 ? 512 : CLIP_CHUNK_TOKENS;
  return {
    family: family || "unknown",
    // What fits in one attention chunk.
    tokens,
    words: Math.floor(tokens / TOKENS_PER_WORD),
    // Past this, the prompt is split and its tail is attended separately.
    chunksAtWords: t5 ? Infinity : Math.floor(tokens / TOKENS_PER_WORD),
    usesT5: t5,
  };
}

/** Rough token estimate. Not exact — CLIP's BPE is not a word-per-word map. */
function estimateTokens(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * TOKENS_PER_WORD);
}

/**
 * How a prompt sits against the model's window, for the live counter.
 *
 * Returns `oneChunk`, `near` (the tail starts being split) or `over`. The words
 * are the honest number to show: a user can count words, not tokens.
 */
function describePromptLength(text, family) {
  const budget = promptBudget(family);
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  const tokens = estimateTokens(text);
  const chunks = Math.max(1, Math.ceil(tokens / budget.tokens));
  // Counted in words, not chunks, because the estimate is not exact: at 58 of 59
  // words the honest answer is "you are at the edge", not "this is one chunk".
  let status = "oneChunk";
  if (words > budget.words) status = words > budget.words * 1.6 ? "over" : "near";
  return {
    words,
    tokens,
    chunks,
    budget,
    status,
    // What to tell the user, in their terms.
    hint:
      status === "oneChunk"
        ? words > budget.words * 0.85
          ? `near the ${budget.words}-word limit for one CLIP chunk — a few more and the tail is split off`
          : `one CLIP chunk (${budget.words} words fit)`
        : status === "near"
          ? `past ${budget.words} words — this is now ${chunks} chunks, and the tail is attended separately`
          : `${chunks} chunks — most of this prompt will be weakly attended; cut it to the strongest ${budget.words} words`,
  };
}


module.exports = {
  CLIP_CHUNK_TOKENS,
  TOKENS_PER_WORD,
  promptBudget,
  estimateTokens,
  describePromptLength,
};
