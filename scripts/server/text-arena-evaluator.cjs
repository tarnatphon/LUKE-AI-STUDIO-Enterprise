"use strict";

/**
 * Text Model Arena evaluator.
 *
 * Pure scoring helpers used by /api/llm/arena/generate-stream. Everything in
 * this module is deterministic and free of I/O so it can be unit tested
 * directly without spawning a llama.cpp runtime.
 *
 * Scoring pipeline:
 *   1. heuristic metrics  (relevance, completeness, clarity, detail, uniqueness)
 *   2. optional LLM judge (cross-review ranking produced by one of the models)
 *   3. optional feedback  (historical "use this answer" votes per model)
 */

const DEFAULT_POLICY = {
  evaluation: {
    mode: "heuristic+judge",
    minimumResponseCharacters: 1,
    weights: {
      relevance: 0.3,
      completeness: 0.25,
      clarity: 0.15,
      detail: 0.15,
      uniqueness: 0.15,
    },
    penalties: {
      emptyResponse: 1,
      refusalOrApology: 0.25,
      excessiveRepetition: 0.2,
      truncatedResponse: 0.1,
    },
  },
  judge: {
    enabled: true,
    weight: 0.4,
    heuristicWeight: 0.6,
    fallbackToHeuristic: true,
  },
  feedback: {
    enabled: true,
    weight: 0.12,
    positiveScore: 1,
    negativeScore: 0,
    minimumSamples: 1,
  },
};

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "was",
  "were", "are", "you", "your", "can", "could", "would", "should", "about",
  "into", "them", "they", "their", "there", "here", "what", "when", "where",
  "which", "while", "will", "not", "but", "all", "any", "one", "two", "more",
  "most", "some", "such", "only", "own", "same", "than", "too", "very",
  "please", "help", "make", "give", "tell", "show", "want", "need", "like",
  "just", "also", "then", "than", "over", "after", "before", "because",
  "how", "why", "who", "whom", "does", "did", "doing", "a", "an", "of",
  "to", "in", "on", "at", "as", "by", "or", "if", "it", "is", "be", "do",
]);

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Tokeniser that works for space separated languages and for Thai, which has
 * no word spaces. Thai runs are turned into character bigrams so similarity
 * comparisons still work for the Thai chat workspace.
 */
function tokenize(text) {
  const source = String(text || "").toLowerCase();
  const tokens = [];

  const wordMatches = source.match(/[a-z][a-z0-9_'-]{1,}|[0-9]+(?:\.[0-9]+)?/g);
  if (wordMatches) {
    for (const word of wordMatches) {
      if (word.length < 2) continue;
      if (STOP_WORDS.has(word)) continue;
      tokens.push(word);
    }
  }

  const thaiRuns = source.match(/[฀-๿]{2,}/g);
  if (thaiRuns) {
    for (const run of thaiRuns) {
      const clean = run.replace(/\s+/g, "");
      if (clean.length < 2) continue;
      if (clean.length === 2) {
        tokens.push(clean);
        continue;
      }
      for (let index = 0; index < clean.length - 1; index += 1) {
        tokens.push(clean.slice(index, index + 2));
      }
    }
  }

  return tokens;
}

function uniqueCount(values) {
  return new Set(values).size;
}

/**
 * Jaccard similarity between two token bags (0 → completely different).
 */
function similarity(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isRefusal(text) {
  return /^(?:i\s+(?:am|'m)\s+sorry|i\s+can(?:not|'t)|as an ai|i do not have|i don't have|ขอโทษ|ไม่สามารถ)/im.test(
    String(text || "").trim()
  );
}

function detectRepetitionRatio(text) {
  const lines = splitSentences(text);
  if (lines.length < 3) return 0;
  const counts = new Map();
  for (const line of lines) {
    const key = line.toLowerCase().slice(0, 120);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let duplicated = 0;
  for (const count of counts.values()) {
    if (count > 1) duplicated += count - 1;
  }
  return duplicated / lines.length;
}

function calculateHeuristicMetrics({ content, prompt = "", peers = [] } = {}) {
  const text = String(content || "");
  const trimmed = text.trim();
  const promptTokens = tokenize(prompt);
  const responseTokens = tokenize(text);

  const promptSet = new Set(promptTokens);
  let overlap = 0;
  for (const token of new Set(responseTokens)) {
    if (promptSet.has(token)) overlap += 1;
  }
  const relevanceBase = promptSet.size > 0 ? overlap / promptSet.size : 0.5;
  // Long answers naturally repeat fewer prompt terms; keep a mild length bonus
  // so thorough answers are not punished for covering more ground.
  const coverageBonus = clamp01(uniqueCount(responseTokens) / 220) * 0.2;
  let relevance = clamp01(relevanceBase * 0.8 + coverageBonus);

  const length = trimmed.length;
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  // Thai has no spaces, so a character based unit keeps short Thai answers from
  // being scored as if they were tiny English answers.
  const lengthUnits = Math.max(words.length, length / 5);
  const lengthScore = lengthUnits / (lengthUnits + 45);
  const endsCleanly = !/(?:,|และ|หรือ|but|and|or)\s*$/i.test(trimmed) && length > 0;
  const structureBonus =
    (/\n[-*•]\s+/m.test(text) ? 0.12 : 0) +
    (/```/.test(text) ? 0.08 : 0) +
    (/\n?#{1,6}\s+\S/m.test(text) ? 0.06 : 0) +
    (endsCleanly ? 0.08 : 0);
  const completeness = clamp01(lengthScore * 0.62 + structureBonus + (length > 80 ? 0.14 : 0));

  const sentences = splitSentences(text);
  const averageSentenceWords = sentences.length ? words.length / sentences.length : 0;
  const sentenceLengthScore =
    averageSentenceWords === 0
      ? 0
      : averageSentenceWords >= 8 && averageSentenceWords <= 28
        ? 1
        : clamp01(1 - Math.abs(averageSentenceWords - 18) / 40);
  const upperCaseRatio = /[A-Za-z]/.test(text)
    ? (text.match(/[A-Z]/g) || []).length / (text.match(/[A-Za-z]/g) || []).length
    : 0;
  const repetitionRatio = detectRepetitionRatio(text);
  const clarity = clamp01(
    (sentenceLengthScore * 0.6 +
      (1 - clamp01(upperCaseRatio * 2)) * 0.2 +
      (1 - clamp01(repetitionRatio * 2)) * 0.2) *
      clamp01(length / 60)
  );

  const detailSignals = [
    /\d/.test(text),
    /\n[-*•]\s+/m.test(text) || /\n\d+[.)]\s+/.test(text),
    /```/.test(text),
    /(?:for example|ตัวอย่าง|เช่น|e\.g\.|ยกตัวอย่าง)/i.test(text),
    /(?:because|therefore|ดังนั้น|เพราะ|เนื่องจาก|hence|thus)/i.test(text),
    /(?:first|then|finally|ขั้นตอน|จากนั้น|สุดท้าย|ก่อน|ต่อไป)/i.test(text) || length > 250,
  ];
  const detailScore = detailSignals.filter(Boolean).length / detailSignals.length;
  const detail = clamp01(detailScore * 0.75 + clamp01(lengthUnits / 180) * 0.25);

  let uniqueness = 1;
  if (peers.length > 0) {
    let highest = 0;
    for (const peer of peers) {
      const peerTokens = tokenize(peer);
      highest = Math.max(highest, similarity(responseTokens, peerTokens));
    }
    uniqueness = clamp01(1 - highest);
  }

  return {
    relevance: round(relevance),
    completeness: round(completeness),
    clarity: round(clarity),
    detail: round(detail),
    uniqueness: round(uniqueness),
    characters: trimmed.length,
    words: words.length,
    repetitionRatio: round(repetitionRatio, 3),
    refusal: isRefusal(trimmed),
  };
}

function applyPenalties(metrics, penalties = {}, options = {}) {
  const emptyPenalty = Number(penalties.emptyResponse ?? 1);
  const refusalPenalty = Number(penalties.refusalOrApology ?? 0.25);
  const repetitionPenalty = Number(penalties.excessiveRepetition ?? 0.2);
  const truncationPenalty = Number(penalties.truncatedResponse ?? 0.1);

  let penalty = 0;
  const reasons = [];

  if (metrics.characters <= 0) {
    penalty += emptyPenalty;
    reasons.push("empty-response");
  }
  if (metrics.refusal) {
    penalty += refusalPenalty;
    reasons.push("refusal");
  }
  if (metrics.repetitionRatio >= 0.3) {
    penalty += repetitionPenalty;
    reasons.push("repetition");
  }
  if (options.truncated === true) {
    penalty += truncationPenalty;
    reasons.push("truncated");
  }

  return { penalty: round(penalty), reasons };
}

function heuristicScore(metrics, weights = {}, penalties = {}, options = {}) {
  const total =
    metrics.relevance * Number(weights.relevance ?? 0.3) +
    metrics.completeness * Number(weights.completeness ?? 0.25) +
    metrics.clarity * Number(weights.clarity ?? 0.15) +
    metrics.detail * Number(weights.detail ?? 0.15) +
    metrics.uniqueness * Number(weights.uniqueness ?? 0.15);

  const weightSum =
    Number(weights.relevance ?? 0.3) +
    Number(weights.completeness ?? 0.25) +
    Number(weights.clarity ?? 0.15) +
    Number(weights.detail ?? 0.15) +
    Number(weights.uniqueness ?? 0.15);

  const normalized = weightSum > 0 ? total / weightSum : 0;
  const applied = applyPenalties(metrics, penalties, options);
  return {
    score: round(clamp01(normalized - applied.penalty)),
    penalty: applied.penalty,
    penaltyReasons: applied.reasons,
  };
}

const JUDGE_SYSTEM_PROMPT = [
  "You are an impartial evaluation judge inside LUKE AI STUDIO.",
  "You compare candidate answers to the same user request and choose the best one.",
  "Judge only the answer text. Ignore the order, the label and the model name.",
  "Reply with one JSON object and nothing else:",
  '{"ranking":[{"modelId":"<exact id>","score":<0-100>,"reason":"<short>"}],"winnerModelId":"<exact id>","summary":"<one sentence>"}',
  "Rules: include every candidate exactly once, use the exact modelId values provided,",
  "give a higher score to the answer that is most correct, most complete and most useful,",
  "and never mention scores, rankings or internal evaluation inside the final chat answer.",
].join("\n");

function buildJudgePrompt({ prompt, responses = [], language = "" } = {}) {
  const candidates = responses
    .map((response, index) => {
      return [
        `--- candidate ${index + 1} ---`,
        `modelId: ${response.modelId}`,
        `answer:`,
        String(response.content || "").trim() || "(empty answer)",
      ].join("\n");
    })
    .join("\n\n");

  const languageNote = language
    ? `\nAnswer in this language: ${language}.`
    : "\nAnswer in the same language as the user request.";

  return {
    system: JUDGE_SYSTEM_PROMPT,
    user: [
      `User request:`,
      String(prompt || "").trim() || "(empty request)",
      ``,
      `Candidates:`,
      candidates,
      ``,
      `Return the JSON ranking now.${languageNote}`,
    ].join("\n"),
  };
}

/**
 * Extracts the first balanced JSON object from an LLM reply.
 * Returns null when the model did not produce parseable JSON.
 */
function extractJsonObject(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end === -1) return null;

  const candidate = source.slice(start, end);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    // Models sometimes wrap the JSON in a fenced block or add trailing prose.
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try {
        const parsed = JSON.parse(fenced[1].trim());
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch (__) {
        return null;
      }
    }
    return null;
  }
}

function parseJudgeResult(text, modelIds = []) {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return { ok: false, reason: "judge-response-not-json", ranking: [], winnerModelId: null, summary: "" };
  }

  const ranking = Array.isArray(parsed.ranking) ? parsed.ranking : [];
  const scores = new Map();
  const reasons = new Map();

  for (const entry of ranking) {
    if (!entry || typeof entry !== "object") continue;
    const modelId = String(entry.modelId || entry.model || entry.id || "").trim();
    if (!modelId) continue;
    const rawScore = Number(entry.score ?? entry.rating ?? entry.value);
    if (!Number.isFinite(rawScore)) continue;
    const normalized = clamp01(rawScore > 1 ? rawScore / 100 : rawScore);
    // Keep the highest score when a model appears twice.
    if (!scores.has(modelId) || normalized > scores.get(modelId)) {
      scores.set(modelId, normalized);
    }
    if (entry.reason && !reasons.has(modelId)) {
      reasons.set(modelId, String(entry.reason).slice(0, 400));
    }
  }

  const known = new Set(modelIds.map((modelId) => String(modelId)));
  const forKnownModels = known.size > 0;

  let winnerModelId = String(parsed.winnerModelId || parsed.winner || parsed.best || "").trim();
  if (winnerModelId && forKnownModels && !known.has(winnerModelId)) winnerModelId = "";

  if (!winnerModelId && scores.size > 0) {
    let bestId = null;
    let bestScore = -1;
    for (const [modelId, score] of scores) {
      if (forKnownModels && !known.has(modelId)) continue;
      if (score > bestScore) {
        bestScore = score;
        bestId = modelId;
      }
    }
    winnerModelId = bestId || "";
  }

  // Models that the judge skipped keep their heuristic ranking by receiving the
  // median judge score instead of being dropped to zero.
  const presentScores = modelIds
    .map((modelId) => scores.get(modelId))
    .filter((score) => Number.isFinite(score));
  const fallbackScore = presentScores.length
    ? presentScores.reduce((sum, score) => sum + score, 0) / presentScores.length
    : 0.5;

  const normalizedRanking = modelIds.map((modelId) => ({
    modelId,
    score: round(scores.has(modelId) ? scores.get(modelId) : fallbackScore),
    reason: reasons.get(modelId) || "",
  }));

  return {
    ok: scores.size > 0,
    reason: scores.size > 0 ? "" : "judge-ranking-empty",
    ranking: normalizedRanking,
    winnerModelId: winnerModelId || null,
    summary: String(parsed.summary || "").slice(0, 600),
  };
}

function feedbackScore(feedback, policy = {}) {
  const config = policy.feedback || DEFAULT_POLICY.feedback;
  if (config.enabled === false) return null;

  const minimumSamples = Number(config.minimumSamples ?? 1);
  const positive = Number(feedback?.positive || 0);
  const negative = Number(feedback?.negative || 0);
  const samples = positive + negative;
  if (samples < minimumSamples) return null;

  const positiveValue = Number(config.positiveScore ?? 1);
  const negativeValue = Number(config.negativeScore ?? 0);
  const total = positive * positiveValue + negative * negativeValue;
  return round(clamp01(total / Math.max(1, samples)));
}

/**
 * Full evaluation for one arena round.
 *
 * @param {object} input
 * @param {string} input.prompt                user request used for scoring
 * @param {Array}  input.responses             [{ modelId, content, status, error, timings, truncated }]
 * @param {object} [input.judgeResult]         output of parseJudgeResult()
 * @param {object} [input.policy]              model-arena-policy.json contents
 * @param {object} [input.feedbackByModel]     { [modelId]: { positive, negative } }
 */
function evaluateArenaResponses(input = {}) {
  const {
    prompt = "",
    responses = [],
    judgeResult = null,
    policy = {},
    feedbackByModel = {},
  } = input;

  const evaluationPolicy = { ...DEFAULT_POLICY.evaluation, ...(policy.evaluation || {}) };
  const judgePolicy = { ...DEFAULT_POLICY.judge, ...(policy.judge || {}) };
  const weights = { ...DEFAULT_POLICY.evaluation.weights, ...(evaluationPolicy.weights || {}) };
  const penalties = { ...DEFAULT_POLICY.evaluation.penalties, ...(evaluationPolicy.penalties || {}) };

  const minimumCharacters = Number(evaluationPolicy.minimumResponseCharacters ?? 1);
  const peers = responses
    .filter((response) => response.status === "completed")
    .map((response) => String(response.content || ""));

  const judgeScores = new Map();
  if (judgeResult && judgeResult.ok) {
    for (const entry of judgeResult.ranking || []) {
      judgeScores.set(entry.modelId, {
        score: entry.score,
        reason: entry.reason || "",
      });
    }
  }

  const scored = responses.map((response) => {
    const content = String(response.content || "");
    const usable = response.status === "completed" && content.trim().length >= minimumCharacters;

    const metrics = calculateHeuristicMetrics({
      content,
      prompt,
      peers: peers.filter((peer) => peer !== content),
    });

    const heuristic = usable
      ? heuristicScore(metrics, weights, penalties, { truncated: response.truncated === true })
      : { score: 0, penalty: 0, penaltyReasons: [response.status === "completed" ? "too-short" : (response.status || "failed")] };

    const judgeEntry = judgeScores.get(response.modelId) || null;
    const judgeWeight = Number(judgePolicy.weight ?? 0.4);
    const heuristicWeight = Number(judgePolicy.heuristicWeight ?? 0.6);

    let finalScore = heuristic.score;
    let basis = "heuristic";

    if (usable && judgeEntry) {
      const totalWeight = judgeWeight + heuristicWeight;
      finalScore = totalWeight > 0
        ? (heuristic.score * heuristicWeight + judgeEntry.score * judgeWeight) / totalWeight
        : heuristic.score;
      basis = "heuristic+judge";
    }

    const feedback = feedbackScore(feedbackByModel[response.modelId], policy);
    if (usable && feedback !== null) {
      const feedbackWeight = Number((policy.feedback || {}).weight ?? DEFAULT_POLICY.feedback.weight);
      finalScore = finalScore * (1 - feedbackWeight) + feedback * feedbackWeight;
      basis = `${basis}+feedback`;
    }

    return {
      ...response,
      usable,
      metrics,
      heuristicScore: round(heuristic.score),
      judgeScore: judgeEntry ? judgeEntry.score : null,
      judgeReason: judgeEntry ? judgeEntry.reason : "",
      feedbackScore: feedback,
      score: round(clamp01(finalScore)),
      basis,
      penalty: heuristic.penalty,
      penaltyReasons: heuristic.penaltyReasons,
    };
  });

  const ranked = [...scored]
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.modelId).localeCompare(String(right.modelId));
    })
    .map((response, index) => ({
      ...response,
      rank: index + 1,
      best: index === 0 && response.usable === true,
    }));

  const winner = ranked.find((response) => response.best) || null;
  const judgeWinner = judgeResult?.winnerModelId
    ? ranked.find((response) => response.modelId === judgeResult.winnerModelId) || null
    : null;

  return {
    evaluationMode: evaluationPolicy.mode || "heuristic",
    judge: {
      used: Boolean(judgeResult && judgeResult.ok),
      reason: judgeResult ? judgeResult.reason || "" : "judge-not-run",
      winnerModelId: judgeWinner ? judgeWinner.modelId : (judgeResult?.winnerModelId || null),
      summary: judgeResult?.summary || "",
    },
    winner,
    responses: ranked,
  };
}

module.exports = {
  DEFAULT_POLICY,
  calculateHeuristicMetrics,
  heuristicScore,
  applyPenalties,
  buildJudgePrompt,
  extractJsonObject,
  parseJudgeResult,
  feedbackScore,
  evaluateArenaResponses,
  similarity,
  tokenize,
  splitSentences,
  clamp01,
};
