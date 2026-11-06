"use strict";

/**
 * Which free local model can actually drive a coding agent on *this* machine.
 *
 * The web is full of "best local coding model" lists, and almost all of them
 * answer the wrong question. What matters here is narrower:
 *
 *   1. the chat template has tool calling (otherwise the agent can chat and
 *      never touch a file — see llm-tool-calling.cjs);
 *   2. the weights fit the memory this machine can really address, *with* a KV
 *      cache big enough for a 16–20K window, because an agent's first request is
 *      already large;
 *   3. the architecture predates the pinned llama.cpp build, or the user is
 *      willing to bump LLAMA_RELEASE.
 *
 * Point 2 is why "a 30B at Q4" is not an answer on an 18 GB Mac: 18.6 GB of
 * weights against a 14.3 GB Metal working set does not load at all, no matter
 * what a leaderboard says.
 *
 * The KV estimate is arithmetic rather than a guess — layers x KV heads x head
 * dim x 2 x 1 byte (q8_0) per token — and llama.cpp replaces it with the real
 * "KV self size" after the first load, which LUKE records per model. LUKE's own
 * auto-planner stays pessimistic until then, which is why a model can be marked
 * `recommended` here while `autoContextTokens` shows a smaller window: set the
 * context explicitly instead of trusting Auto on the first run.
 *
 * Catalog: app/config/coding-agent-models.json · Docs: docs/beta7/offline-coding-agents.md
 */

const fs = require("node:fs");
const path = require("node:path");
const { planContextSize } = require("./context-size-planner.cjs");

const CATALOG_PATH = path.join(__dirname, "..", "..", "app", "config", "coding-agent-models.json");
const BYTES_PER_GB = 1024 ** 3;
const GPU_BUFFER_GB = 1.5;
const AGENT_MIN_CONTEXT = 16384;

let cached = null;

function readCatalog(catalogPath = CATALOG_PATH) {
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  return validateCatalog(raw);
}

function assert(condition, message) {
  if (!condition) throw new Error(`coding-agent-models: ${message}`);
}

/** Fail loudly on a catalog that would quietly recommend something broken. */
function validateCatalog(catalog) {
  assert(catalog && typeof catalog === "object", "catalog is not an object");
  assert(Array.isArray(catalog.models) && catalog.models.length > 0, "catalog has no models");
  assert(Array.isArray(catalog.machineProfiles), "catalog has no machineProfiles");

  const ids = new Set();
  for (const model of catalog.models) {
    assert(model.id && typeof model.id === "string", "a model has no id");
    assert(!ids.has(model.id), `duplicate model id ${model.id}`);
    ids.add(model.id);
    assert(model.label, `${model.id} has no label`);
    assert(Number(model.weightGb) > 0, `${model.id} has no weightGb`);
    assert(model.license, `${model.id} has no license`);
    assert(model.toolCalling === true, `${model.id} is not tool-capable and does not belong here`);
    assert(Number(model.maxContextTokens) > 0, `${model.id} has no maxContextTokens`);
    assert(Number.isFinite(Number(model.quality)) && Number(model.quality) > 0, `${model.id} has no quality score`);
    assert(["low", "medium"].includes(model.riskLevel), `${model.id} has no riskLevel (low|medium)`);
    const hasArithmeticKv = Number(model.mlaKvGbPer4096) > 0
      || (Number(model.layers) > 0 && Number(model.kvHeads) > 0 && Number(model.headDim) > 0);
    assert(hasArithmeticKv, `${model.id} cannot have its KV cache computed`);
    const source = model.source || {};
    assert(
      (source.repo && source.file) || source.searchQuery,
      `${model.id} has no download source (repo+file, or a searchQuery)`,
    );
  }

  for (const profile of catalog.machineProfiles) {
    assert(profile.id && Number(profile.systemRamGb) > 0, "a machine profile is incomplete");
    assert(Number(profile.workingSetGb) > 0, `profile ${profile.id} has no working set`);
  }
  return catalog;
}

function getCatalog() {
  if (!cached) cached = readCatalog();
  return cached;
}

function clearCatalogCache() {
  cached = null;
}

/**
 * Gigabytes of KV cache per 4096 tokens, at q8_0 (one byte per element).
 *
 * Qwen/Mistral use grouped-query attention, so this is layers x KV heads x head
 * dim x 2. GLM-4.7-Flash uses MLA, which stores a compressed latent instead and
 * states its own number.
 */
function kvGbPer4096(model) {
  if (Number(model.mlaKvGbPer4096) > 0) return Number(model.mlaKvGbPer4096);
  const bytesPerToken = Number(model.layers) * Number(model.kvHeads) * Number(model.headDim) * 2;
  if (!(bytesPerToken > 0)) return 1.05;
  return (bytesPerToken * 4096) / BYTES_PER_GB;
}

function resolveMachine(machine = {}) {
  const catalog = getCatalog();
  if (machine.profileId) {
    const profile = catalog.machineProfiles.find((entry) => entry.id === machine.profileId);
    assert(profile, `unknown machine profile ${machine.profileId}`);
    return { ...profile, source: "profile" };
  }
  const systemRamGb = Number(machine.systemRamGb);
  assert(systemRamGb > 0, "systemRamGb is required");
  // No measured working set: Apple Silicon gives Metal ~80% of total RAM, and a
  // discrete GPU reports its own VRAM. The learned value from
  // app/runtime-state/memory/gpu-working-set.json is always better and wins.
  const workingSetGb = Number(machine.workingSetGb) > 0
    ? Number(machine.workingSetGb)
    : Number((systemRamGb * 0.8).toFixed(2));
  return {
    id: "detected",
    label: `this machine (${systemRamGb.toFixed(1)} GB, ${workingSetGb.toFixed(1)} GB usable)`,
    systemRamGb,
    workingSetGb,
    source: Number(machine.workingSetGb) > 0 ? "measured" : "estimated",
  };
}

/**
 * One model against one machine budget.
 *
 * `autoContextTokens` is what LUKE will pick on its own (conservative until the
 * KV cache has been measured once); `maxContextTokens` is what the memory
 * arithmetic allows if the context is set explicitly; `contextTokens` is the
 * value worth typing into Model settings.
 */
function evaluateModel(model, machine, options = {}) {
  const minContext = Number(options.minContextTokens) || AGENT_MIN_CONTEXT;
  const poolGb = Math.min(Number(machine.systemRamGb), Number(machine.workingSetGb));
  const headroomGb = poolGb - Number(model.weightGb) - GPU_BUFFER_GB;
  const kvPer4096 = kvGbPer4096(model);

  const plan = planContextSize({
    modelSizeGb: Number(model.weightGb),
    isGpu: true,
    vramGb: Number(machine.workingSetGb),
    systemRamGb: Number(machine.systemRamGb),
    workingSetGb: Number(machine.workingSetGb),
  });

  const kvBudgetGb = Math.max(0, headroomGb * 0.85);
  const rawMax = headroomGb > 0.4
    ? Math.floor((kvBudgetGb / kvPer4096) * 4096 / 1024) * 1024
    : 0;
  const maxContextTokens = Math.max(0, Math.min(rawMax, Number(model.maxContextTokens)));

  let verdict = "too-big";
  if (headroomGb > 0.4 && maxContextTokens >= minContext) verdict = "recommended";
  else if (headroomGb > 0.4 && maxContextTokens >= 4096) verdict = "tight";

  const contextTokens = verdict === "too-big"
    ? 0
    : Math.max(4096, Math.min(maxContextTokens, Number(options.recommendedContextTokens) || 20000));

  return {
    id: model.id,
    label: model.label,
    license: model.license,
    weightGb: Number(model.weightGb),
    kvGbPer4096: Number(kvPer4096.toFixed(3)),
    poolGb: Number(poolGb.toFixed(2)),
    headroomGb: Number(headroomGb.toFixed(2)),
    autoContextTokens: plan.contextSize,
    maxContextTokens,
    contextTokens,
    verdict,
    quality: Number(model.quality),
    riskLevel: model.riskLevel,
    bestFor: model.bestFor || "",
    risk: model.risk || "",
    source: model.source || {},
  };
}

function formatSource(source = {}) {
  if (source.repo && source.file) return `https://huggingface.co/${source.repo} → ${source.file}`;
  if (source.searchQuery) return `search "${source.searchQuery}" in LUKE → Model Manager`;
  return "no source";
}

/**
 * Every model ranked for this machine: what fits first (recommended, then tight),
 * then the lowest-risk quant, then the most capable. Ranking by size would be
 * wrong — on a 32 GB machine the 30B at Q4 is a better answer than the 14B that
 * also happens to fit — and ranking by raw quality alone would pick a 2.8-bit
 * quant that mangles tool calls. Out-of-reach models stay in the list, last, so
 * the gaps are visible instead of hidden.
 */
function recommendFor(machine = {}, options = {}) {
  const catalog = getCatalog();
  const resolved = resolveMachine(machine);
  const ranked = catalog.models
    .map((model) => ({ ...evaluateModel(model, resolved, options), sourceText: formatSource(model.source) }))
    .sort((a, b) => {
      const rank = { recommended: 0, tight: 1, "too-big": 2 };
      if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
      const risk = { low: 0, medium: 1 };
      if (risk[a.riskLevel] !== risk[b.riskLevel]) return risk[a.riskLevel] - risk[b.riskLevel];
      return b.quality - a.quality;
    });

  return {
    machine: resolved,
    catalogVersion: catalog.catalogVersion,
    verifiedAt: catalog.verifiedAt,
    backend: catalog.backend,
    agentNeeds: catalog.agentNeeds,
    models: ranked,
    pick: ranked.find((entry) => entry.verdict === "recommended") || null,
  };
}

/**
 * The catalog as the Model Library shows it: every model ranked for this
 * machine, plus where to download it and whether it is already here.
 *
 * `recommendFor` answers "which model should I use"; a library tab also needs
 * "what happens if I press the button", which is a URL, a file name, and the
 * honest truth about whether that file is on disk. Building the URL from the
 * catalog's own repo+file (rather than trusting a link from the browser) keeps
 * the download and the recommendation pointing at the same bytes.
 */
function describeCodingModels(options = {}) {
  const recommendation =
    options.recommendation ||
    recommendFor(
      options.machine || { systemRamGb: options.systemRamGb },
      options,
    );

  const llmModelsDir = options.llmModelsDir || "";

  const installedFile = (source = {}) => {
    if (!llmModelsDir) return "";
    for (const candidate of [source.file, source.mirrorFile]) {
      if (!candidate) continue;
      const target = path.join(llmModelsDir, path.basename(String(candidate)));
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        return path.basename(String(candidate));
      }
    }
    return "";
  };

  const decorate = (entry) => {
    const model = getCatalog().models.find((candidate) => candidate.id === entry.id) || {};
    const source = model.source || entry.source || {};
    const installable = Boolean(source.repo && source.file);
    const download = installable
      ? {
          url: `https://huggingface.co/${source.repo}/resolve/main/${source.file}`,
          filename: path.basename(String(source.file)),
          sizeGb: Number(model.weightGb || entry.weightGb),
          mirrorUrl: source.mirror && source.mirrorFile
            ? `https://huggingface.co/${source.mirror}/resolve/main/${source.mirrorFile}`
            : "",
          mirrorFilename: source.mirrorFile ? path.basename(String(source.mirrorFile)) : "",
        }
      : null;
    const installed = installedFile(source);
    return {
      ...entry,
      name: model.label || entry.label,
      params: model.params || "",
      maxContextTokens: Number(model.maxContextTokens) || 0,
      bestFor: model.bestFor || entry.bestFor || "",
      risk: model.risk || entry.risk || "",
      evidence: model.evidence || "",
      toolCalling: model.toolCalling === true,
      installable,
      download,
      searchQuery: installable ? "" : (source.searchQuery || ""),
      installed,
      installedLabel: installed || "",
    };
  };

  return {
    ok: true,
    machine: recommendation.machine,
    catalogVersion: recommendation.catalogVersion,
    verifiedAt: recommendation.verifiedAt,
    backend: recommendation.backend,
    agentNeeds: recommendation.agentNeeds,
    rankingSource: getCatalog().rankingSource || "",
    pick: recommendation.pick ? decorate(recommendation.pick) : null,
    models: recommendation.models.map(decorate),
  };
}

module.exports = {
  CATALOG_PATH,
  AGENT_MIN_CONTEXT,
  getCatalog,
  readCatalog,
  validateCatalog,
  clearCatalogCache,
  kvGbPer4096,
  resolveMachine,
  evaluateModel,
  recommendFor,
  describeCodingModels,
  formatSource,
};
