#!/usr/bin/env node
"use strict";

/**
 * The answer to "which free local models should *I* run?" — both slots, one
 * machine, with the arithmetic that produced them.
 *
 * Reading a leaderboard cannot answer this: the largest model that fits your
 * memory beats a better model that does not load, and Chat and Work want
 * different things (Chat wants answer quality per gigabyte, Work wants tool
 * calling and a 16K+ window). So this prints:
 *
 *   - the Work slot from the coding catalog (real KV arithmetic),
 *   - the Chat slot from the chat catalog (quality, quant risk, languages),
 *   - what does not fit and by how much,
 *   - and how to actually set it up in the app.
 *
 * Usage:
 *   node scripts/tools/luke-hardware-fit.cjs                 # this machine
 *   node scripts/tools/luke-hardware-fit.cjs --profile mac-18
 *   node scripts/tools/luke-hardware-fit.cjs --ram 18
 *   node scripts/tools/luke-hardware-fit.cjs --json
 *
 * Docs: docs/beta7/hardware-fit.md
 */

const os = require("node:os");
const chatFit = require("../server/chat-model-fit.cjs");
const codingModels = require("../server/coding-agent-models.cjs");

function parseArgs(argv) {
  const options = { json: false, profileId: "", systemRamGb: 0, workingSetGb: 0, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--profile") options.profileId = String(argv[++i] || "");
    else if (arg === "--ram") options.systemRamGb = Number(argv[++i] || 0);
    else if (arg === "--working-set") options.workingSetGb = Number(argv[++i] || 0);
    else if (!arg.startsWith("-")) options.profileId = arg;
  }
  return options;
}

function help() {
  console.log(`
Best fit for this machine — Chat and Work.

  node scripts/tools/luke-hardware-fit.cjs                 this machine
  node scripts/tools/luke-hardware-fit.cjs --profile mac-18
  node scripts/tools/luke-hardware-fit.cjs --ram 18
  node scripts/tools/luke-hardware-fit.cjs --ram 32 --working-set 25.6
  node scripts/tools/luke-hardware-fit.cjs --json

Profiles come from app/config/coding-agent-models.json:
  mac-18   18 GB Apple Silicon — 14.3 GB addressable by Metal
  mac-32   32 GB Apple Silicon
  pc-24    PC with 24 GB VRAM
  pc-48    PC 48 GB VRAM / Mac 64 GB
`);
}

function gb(value) {
  return `${Number(value || 0).toFixed(1)} GB`;
}

function machineFor(options) {
  if (options.profileId) return chatFit.resolveMachine({ profileId: options.profileId });
  const systemRamGb = options.systemRamGb > 0
    ? options.systemRamGb
    : os.totalmem() / 1024 ** 3;
  return chatFit.resolveMachine({
    systemRamGb,
    workingSetGb: options.workingSetGb > 0 ? options.workingSetGb : 0,
  });
}

function printHuman(fit) {
  const machine = fit.machine;
  console.log("");
  console.log(`Machine      ${machine.label}${machine.source === "profile" ? "" : ` (${machine.source})`}`);
  console.log(`Budget       ${gb(machine.workingSetGb)} addressable of ${gb(machine.systemRamGb)} RAM`);
  console.log("");

  const work = fit.work.pick;
  if (work) {
    console.log("WORK SLOT    " + work.label);
    console.log(`             ${gb(work.weightGb)} weights · ${Number(work.contextTokens).toLocaleString()}-token window · temperature 0.2`);
    console.log(`             KV ${work.kvGbPer4096} GB / 4K · ${gb(work.headroomGb)} left for the app · quality ${work.quality}/100 · ${work.license}`);
    console.log(`             tool calling: yes · risk: ${work.riskLevel}`);
    if (work.source?.repo) {
      console.log(`             https://huggingface.co/${work.source.repo}/resolve/main/${work.source.file}`);
    }
    if (work.bestFor) console.log(`             ${work.bestFor}`);
    if (work.risk) console.log(`             note: ${work.risk}`);
  } else {
    console.log("WORK SLOT    nothing fits this machine");
  }
  for (const warning of fit.work.warnings) console.log(`             ! ${warning}`);
  console.log("");

  const chat = fit.chat.pick;
  if (chat) {
    console.log(`CHAT SLOT    ${chat.name}`);
    console.log(`             ${gb(chat.sizeGb)} weights · ${chat.params || ""} · ${chat.license}`);
    console.log(`             score ${chat.score}/100 (quality ${chat.chatQuality}${chat.quantRisk === "medium" ? " − 8 for a 2-bit quant" : ""}) · ${chat.multilingual ? "multilingual" : "English-first"}`);
    console.log(`             needs ${gb(chat.neededGb)} of ${gb(machine.workingSetGb)}, leaving ${gb(chat.headroomGb)}`);
    console.log(`             ${chat.url}`);
    if (chat.notes) console.log(`             ${chat.notes}`);
    for (const alternative of fit.chat.alternatives) {
      console.log(`             also fits: ${alternative.name} — ${gb(alternative.sizeGb)}, ${gb(alternative.headroomGb)} left`);
    }
  } else {
    console.log("CHAT SLOT    nothing fits — use a smaller quant or a 4 GB machine");
  }
  console.log("");

  const nearMisses = fit.chat.models
    .filter((model) => model.verdict !== "fits")
    .slice(0, 3)
    .map((model) => [model.name, `${gb(model.sizeGb)} → needs ${gb(model.neededGb)}`, model.verdict === "tight" ? "tight" : "does not fit"]);
  const workMisses = fit.work.models
    .filter((model) => model.verdict === "too-big")
    .slice(0, 3)
    .map((model) => [model.label, `${gb(model.weightGb)} weights`, "does not fit"]);
  const misses = [...nearMisses, ...workMisses];
  if (misses.length) {
    console.log("DOES NOT FIT");
    for (const [name, size, verdict] of misses) {
      console.log(`             ${String(name).padEnd(44)} ${String(size).padEnd(24)} ${verdict}`);
    }
    console.log("");
  }

  console.log("SET UP       (in the app — nothing to type)");
  console.log("             1. AI Library → Code AI → \"Use for Work\" on the Work pick");
  console.log("             2. Chat → pick the chat model once; it is remembered for the Chat slot");
  console.log("             Switching tabs reloads the model — only one is resident at a time.");
  console.log("");
  console.log(`DISK         ${gb(fit.diskGb)} if both are downloaded${fit.sharedModel ? " (same file serves both slots)" : ""}`);
  console.log(`CATALOG      verified ${fit.verifiedAt} · llama.cpp ${fit.work.backend?.pinnedRelease || "?"} · ${fit.work.agentNeeds?.recommendedContextTokens || 20000}-token agent window`);
  console.log("");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    return 0;
  }
  const machine = machineFor(options);
  const fit = chatFit.bestFit({
    systemRamGb: machine.systemRamGb,
    workingSetGb: machine.workingSetGb,
  });
  fit.machine = machine;

  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      machine: fit.machine,
      work: fit.work.pick,
      workWarnings: fit.work.warnings,
      chat: fit.chat.pick,
      chatAlternatives: fit.chat.alternatives,
      chatModels: fit.chat.models,
      workModels: fit.work.models,
      diskGb: fit.diskGb,
      sharedModel: fit.sharedModel,
      verifiedAt: fit.verifiedAt,
    }, null, 2));
    return 0;
  }

  printHuman(fit);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`luke-hardware-fit: ${error.message}`);
  process.exitCode = 1;
}

module.exports = { parseArgs, machineFor };
