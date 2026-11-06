"use strict";

/**
 * Which chat model fits *this* machine — and what the other slot should be.
 *
 * Work has a catalog of its own (coding-agent-models.cjs) because an agent needs
 * tool calling and a 16K+ window. Chat needs none of that, so it is ranked
 * differently: answer quality per gigabyte, how risky the quant is, and whether
 * it speaks the language the user does. The two answers belong together, because
 * only one model is resident at a time — a chat model can be as big as the
 * machine allows without stealing room from Work.
 *
 * The fit rule for chat is deliberately blunt: weights + 2 GB of compute buffers
 * + 1 GB of KV for an 8K window, against the memory that is really addressable.
 * Work's budget is stricter and computed from real KV arithmetic; chat does not
 * carry tool schemas, so it does not need that precision.
 *
 * Catalog: app/config/chat-model-fit.json · Docs: docs/beta7/hardware-fit.md
 */

const fs = require("node:fs");
const path = require("node:path");
const codingAgentModels = require("./coding-agent-models.cjs");

const CATALOG_PATH = path.join(__dirname, "..", "..", "app", "config", "chat-model-fit.json");

const CHAT_BUFFER_GB = 2;
const CHAT_KV_GB = 1;
const RISK_PENALTY = { low: 0, medium: 8 };

let cached = null;

function readChatCatalog(catalogPath = CATALOG_PATH) {
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  return validateChatCatalog(raw);
}

function assert(condition, message) {
  if (!condition) throw new Error(`chat-model-fit: ${message}`);
}

function validateChatCatalog(catalog) {
  assert(catalog && typeof catalog === "object", "catalog is not an object");
  assert(Array.isArray(catalog.models) && catalog.models.length > 0, "catalog has no models");
  const ids = new Set();
  for (const model of catalog.models) {
    assert(model.id, "a model has no id");
    assert(!ids.has(model.id), `duplicate model id ${model.id}`);
    ids.add(model.id);
    assert(model.name && model.filename, `${model.id} has no name/filename`);
    assert(/\.gguf$/i.test(model.filename), `${model.id} is not a GGUF`);
    assert(Number(model.sizeGb) > 0, `${model.id} has no sizeGb`);
    assert(Number(model.chatQuality) > 0, `${model.id} has no chatQuality`);
    assert(["low", "medium"].includes(model.quantRisk), `${model.id} has no quantRisk (low|medium)`);
    assert(/^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+\.gguf$/.test(model.url || ""), `${model.id} has no huggingface .gguf url`);
    assert(
      path.basename(model.url).endsWith(model.filename),
      `${model.id}'s url does not end with its filename`,
    );
  }
  return catalog;
}

function getChatCatalog() {
  if (!cached) cached = readChatCatalog();
  return cached;
}

function clearChatCatalogCache() {
  cached = null;
}

/** What this machine can really address, with the source of the number. */
function resolveMachine(machine = {}) {
  const catalog = codingAgentModels.getCatalog();
  if (machine.profileId) {
    const profile = catalog.machineProfiles.find((entry) => entry.id === machine.profileId);
    assert(profile, `unknown machine profile ${machine.profileId}`);
    return { ...profile, source: "profile" };
  }
  const systemRamGb = Number(machine.systemRamGb);
  assert(systemRamGb > 0, "systemRamGb is required");
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

function evaluateChatModel(model, machine) {
  const poolGb = Math.min(Number(machine.systemRamGb), Number(machine.workingSetGb));
  const neededGb = Number(model.sizeGb) + CHAT_BUFFER_GB + CHAT_KV_GB;
  const headroomGb = Number((poolGb - neededGb).toFixed(2));
  // Fitting with nothing to spare is not fitting: macOS, the UI and the app's
  // own buffers all live in the same pool, so a model that leaves under ~8% of it
  // empty swaps the machine into stutter. That is "tight", not "fits".
  const slackGb = Number(Math.max(0.75, poolGb * 0.08).toFixed(2));
  const verdict = headroomGb >= slackGb ? "fits" : headroomGb >= 0 ? "tight" : "too-big";
  return {
    id: model.id,
    name: model.name,
    filename: model.filename,
    publisher: model.publisher,
    params: model.params,
    license: model.license,
    sizeGb: Number(model.sizeGb),
    chatQuality: Number(model.chatQuality),
    quantRisk: model.quantRisk,
    multilingual: model.multilingual === true,
    notes: model.notes || "",
    url: model.url,
    // What the answer is worth: quality, minus the price of a quant that may
    // drop words. A 76 at 2 bits is not a 76 at 4 bits.
    score: Number((Number(model.chatQuality) - (RISK_PENALTY[model.quantRisk] || 0)).toFixed(1)),
    neededGb: Number(neededGb.toFixed(2)),
    headroomGb,
    slackGb,
    verdict,
  };
}

/**
 * Rank the chat models for a machine. Fits first (by score), then the rest by
 * how close they came, so the gap is visible instead of deleted.
 */
function recommendChat(machine = {}) {
  const resolved = resolveMachine(machine);
  const catalog = getChatCatalog();
  const models = catalog.models
    .map((model) => evaluateChatModel(model, resolved))
    .sort((a, b) => {
      const rank = { fits: 0, tight: 1, "too-big": 2 };
      if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
      if (a.verdict === "fits") return b.score - a.score;
      return b.headroomGb - a.headroomGb;
    });
  const fits = models.filter((model) => model.verdict === "fits");
  return {
    machine: resolved,
    catalogVersion: catalog.catalogVersion,
    verifiedAt: catalog.verifiedAt,
    budgetNote: catalog.budgetNote || "",
    models,
    pick: fits[0] || null,
    alternatives: fits.slice(1, 3),
  };
}

/**
 * Both slots, for one machine. This is the answer to "what should I run?" —
 * Work from the coding catalog (tool calling, KV arithmetic), Chat from the chat
 * catalog (quality per gigabyte, quant risk, languages).
 */
function bestFit(machine = {}) {
  const chat = recommendChat(machine);
  // Work is ranked for the same machine object, so a profile id or a RAM number
  // means the same thing in both halves of the answer.
  const work = codingAgentModels.recommendFor({
    systemRamGb: chat.machine.systemRamGb,
    workingSetGb: chat.machine.workingSetGb,
  });
  const workPick = work.pick;
  const workWarnings = [];
  if (!workPick) {
    workWarnings.push("No coding model in the catalog fits this machine: Work will need a smaller quant or a machine with more usable memory.");
  } else if (Number(workPick.contextTokens) < Number(work.agentNeeds?.minContextTokens || 16384)) {
    workWarnings.push(`The best fit only reaches a ${workPick.contextTokens}-token window, below the 16K an agent needs.`);
  }
  return {
    machine: chat.machine,
    verifiedAt: chat.verifiedAt,
    chat: {
      pick: chat.pick,
      alternatives: chat.alternatives,
      models: chat.models,
      budgetNote: chat.budgetNote,
    },
    work: {
      pick: workPick,
      warnings: workWarnings,
      agentNeeds: work.agentNeeds,
      models: work.models,
      backend: work.backend,
    },
    diskGb: Number(
      ((chat.pick?.sizeGb || 0) + (workPick?.weightGb || 0)).toFixed(1),
    ),
    // Both slots can share one file. Saying so avoids a needless second
    // download on a small machine.
    sharedModel: Boolean(
      chat.pick && workPick && chat.pick.filename === (workPick.source?.file || ""),
    ),
  };
}

module.exports = {
  CATALOG_PATH,
  CHAT_BUFFER_GB,
  CHAT_KV_GB,
  readChatCatalog,
  validateChatCatalog,
  getChatCatalog,
  clearChatCatalogCache,
  resolveMachine,
  evaluateChatModel,
  recommendChat,
  bestFit,
};
