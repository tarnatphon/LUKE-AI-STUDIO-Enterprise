"use strict";

/**
 * A second, small model for background chores.
 *
 * Why this exists
 * ---------------
 * The Products tab translates Thai product names into English ones for the
 * image prompt. That job is 80 output tokens of dictionary work — and it used
 * to go through whatever chat model the user had loaded. On an 18 GB Mac with
 * SDXL resident that meant a 9B model, 5 GB of weights, swap, and a resource
 * governor taking the chat model away again: the translation never finished,
 * and the machine was unusable while it tried.
 *
 * A 1–3B model does this job just as well for a tenth of the memory, and it can
 * live next to an image model. So background jobs ask for the smallest
 * downloaded model that fits the policy and, when one exists, they get it —
 * without touching the chat model at all. The chat model is never unloaded to
 * make room for this, and the user's choice of chat model is not changed.
 *
 * What it will not do
 * -------------------
 * It does not take over conversations. Only a request that says
 * `purpose: "translate"` (or `background: true`) is routed here; everything
 * else goes to the chat model exactly as before. If the small model cannot be
 * loaded — none downloaded, the load failed, the machine is full — the call
 * falls back to the chat model when that one is ready, and only then fails.
 *
 * Selection is pure and takes the model list as an argument, so the rule "the
 * smallest model under the cap" can be tested without a single GGUF on disk.
 */

const DEFAULT_POLICY = {
  enabled: true,
  // Weights up to this size are considered "small". A 3B Q4 is about 2 GB; a
  // 7B Q4 is about 4.4 GB and is deliberately outside this.
  maxSizeGb: 3.2,
  // Anything smaller than this is a fragment, not a usable model.
  minSizeGb: 0.2,
  // An explicit choice wins over "smallest", as long as it exists.
  preferredModel: "",
  // How long a directory listing is trusted. The model folder rarely changes,
  // and isReady() is asked on every products poll.
  cacheMs: 30000,
};

const GIB = 1024 ** 3;

function normalizePolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const number = (key, fallback) => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    enabled: source.enabled !== false,
    maxSizeGb: number("maxSizeGb", DEFAULT_POLICY.maxSizeGb),
    minSizeGb: number("minSizeGb", DEFAULT_POLICY.minSizeGb),
    preferredModel: String(source.preferredModel || "").trim(),
    cacheMs: Math.max(0, Number(source.cacheMs) || DEFAULT_POLICY.cacheMs),
  };
}

/**
 * Pick the model background jobs should use.
 *
 * `models` is what the model folder lists: `{ filename, sizeBytes, sizeGb? }`.
 * A preferred model is used when it exists, whatever its size — the user asked
 * for it. Otherwise the smallest model inside the cap wins, because the job is
 * tiny and the point is to stay out of the way.
 */
function chooseBackgroundModel(models = [], policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const list = (Array.isArray(models) ? models : [])
    .map((model) => {
      const filename = String(model?.filename || model?.name || "").trim();
      const sizeBytes = Number(model?.sizeBytes ?? model?.bytes);
      const sizeGb = Number.isFinite(Number(model?.sizeGb))
        ? Number(model.sizeGb)
        : Number.isFinite(sizeBytes) && sizeBytes > 0
          ? Math.round((sizeBytes / GIB) * 100) / 100
          : 0;
      return { filename, sizeGb, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0 };
    })
    .filter((model) => model.filename && !/mmproj/i.test(model.filename));

  if (!policy.enabled) {
    return { model: null, reason: "background jobs are switched off — the chat model is used", candidates: [] };
  }

  if (policy.preferredModel) {
    const preferred = list.find((model) => model.filename === policy.preferredModel);
    if (preferred) {
      return {
        model: preferred,
        reason: `the preferred background model is ${preferred.filename} (${preferred.sizeGb} GB)`,
        candidates: list,
      };
    }
  }

  const usable = list
    .filter((model) => model.sizeGb >= policy.minSizeGb && model.sizeGb > 0 && model.sizeGb <= policy.maxSizeGb)
    .sort((left, right) => left.sizeGb - right.sizeGb || left.filename.localeCompare(right.filename));

  if (!usable.length) {
    return {
      model: null,
      reason: `no model between ${policy.minSizeGb} and ${policy.maxSizeGb} GB is downloaded — the chat model is used`,
      candidates: list,
    };
  }

  const chosen = usable[0];
  return {
    model: chosen,
    reason: `${chosen.filename} is the smallest downloaded model that fits the ${policy.maxSizeGb} GB background cap (${chosen.sizeGb} GB)`,
    candidates: list,
  };
}

/**
 * The client the social agency talks to. It answers `isReady()` and
 * `chat(messages, options)` — the same two methods the chat model client has —
 * so call sites do not need to know which model answered.
 */
function createBackgroundLlmClient({
  policy = DEFAULT_POLICY,
  listModels = () => [],
  getPool = () => null,
  mainClient = null,
  logger = console,
  now = () => Date.now(),
} = {}) {
  let cached = { at: 0, choice: null };
  let loadPromise = null;
  let fallbackNoticeAt = 0;

  const currentPolicy = () => normalizePolicy(typeof policy === "function" ? policy() : policy);

  function choice() {
    const active = currentPolicy();
    const at = now();
    if (cached.choice && at - cached.at < active.cacheMs) return cached.choice;
    let models = [];
    try {
      models = listModels() || [];
    } catch (error) {
      logger.warn?.(`  [background-llm] could not list models: ${error?.message || error}`);
      models = [];
    }
    const picked = chooseBackgroundModel(models, active);
    cached = { at, choice: { ...picked, policy: active } };
    return cached.choice;
  }

  const mainReady = () => {
    try {
      return Boolean(mainClient && mainClient.isReady && mainClient.isReady());
    } catch {
      return false;
    }
  };

  async function ensureLoaded(filename) {
    if (!loadPromise) {
      loadPromise = (async () => {
        const pool = getPool();
        if (!pool || typeof pool.ensureLoaded !== "function") {
          throw new Error("the arena pool is not available for a background model");
        }
        const result = await pool.ensureLoaded([filename]);
        const instance = (result?.instances || []).find(
          (entry) => entry && entry.status === "ready" && entry.modelId === filename,
        );
        if (!instance) {
          const failure = (result?.failures || []).find((entry) => entry && entry.modelId === filename);
          throw new Error(failure?.error || `${filename} did not become ready`);
        }
        return instance;
      })();
      // A failed load must not be remembered as the answer forever: the next
      // translation retries, and the products tab keeps its queued state.
      loadPromise.catch(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  }

  async function chatViaBackground(entry, messages, options) {
    await ensureLoaded(entry.model.filename);
    const pool = getPool();
    const result = await pool.generate({
      modelId: entry.model.filename,
      messages,
      options: {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs,
      },
    });
    const content = String(result?.content || "");
    if (!content.trim()) throw new Error("the background model returned nothing");
    return content;
  }

  return {
    isReady() {
      if (mainReady()) return true;
      // A small model that exists can be loaded on demand, so the queued work
      // may proceed even though no chat model is running.
      return Boolean(choice().model);
    },

    /**
     * Only `purpose: "translate"` (or `background: true`) is routed to the small
     * model. Everything else is the chat model's job, exactly as before.
     */
    async chat(messages, options = {}) {
      const wantsBackground = options.purpose === "translate" || options.background === true;
      const entry = choice();
      if (!wantsBackground || !entry.model) {
        if (mainClient && typeof mainClient.chat === "function") return mainClient.chat(messages, options);
        throw new Error("no local model is ready");
      }
      try {
        return await chatViaBackground(entry, messages, options);
      } catch (error) {
        if (now() - fallbackNoticeAt > 60000) {
          fallbackNoticeAt = now();
          logger.warn?.(
            `  [background-llm] ${entry.model.filename} could not run the translation (${error?.message || error}) — using the chat model instead`,
          );
        }
        if (mainReady() && mainClient && typeof mainClient.chat === "function") {
          return mainClient.chat(messages, options);
        }
        throw error;
      }
    },

    /** What the Settings panel and the log can say about this, in one object. */
    status() {
      const entry = choice();
      return {
        enabled: entry.policy.enabled,
        maxSizeGb: entry.policy.maxSizeGb,
        preferredModel: entry.policy.preferredModel || null,
        model: entry.model ? { filename: entry.model.filename, sizeGb: entry.model.sizeGb } : null,
        reason: entry.reason,
        mainReady: mainReady(),
      };
    },

    /** Tests and settings changes: forget the cached listing. */
    invalidate() {
      cached = { at: 0, choice: null };
      loadPromise = null;
    },
  };
}

module.exports = {
  DEFAULT_POLICY,
  chooseBackgroundModel,
  createBackgroundLlmClient,
  normalizePolicy,
};
