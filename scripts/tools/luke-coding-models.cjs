#!/usr/bin/env node
"use strict";

/**
 * Which free local model should drive Claude Code / OpenCode on this machine?
 *
 *   node scripts/tools/luke-coding-models.cjs              # this machine
 *   node scripts/tools/luke-coding-models.cjs --ram 18     # say the RAM
 *   node scripts/tools/luke-coding-models.cjs --profile mac-18
 *   node scripts/tools/luke-coding-models.cjs --json
 *
 * The answer comes from app/config/coding-agent-models.json plus LUKE's own
 * memory planner, so it is arithmetic about *this* machine rather than a
 * leaderboard. The working set is read from what LUKE learned last time a
 * backend started (app/runtime-state/memory/gpu-working-set.json) — on Apple
 * Silicon that is ~14.3 GB of an 18 GB machine, which is the number that
 * decides whether a model loads at all.
 *
 * Run this after LUKE has started once (so the working set is known), then:
 *   LUKE → Model Manager → paste the repo URL → pick the file → set Context
 *   explicitly to the value printed here → scripts/tools/luke-agent-env.sh check
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const catalog = require(path.join(root, "scripts", "server", "coding-agent-models.cjs"));

const WORKING_SET_FILE = path.join(root, "app", "runtime-state", "memory", "gpu-working-set.json");

function readLearnedWorkingSetGb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(WORKING_SET_FILE, "utf8"));
    const gb = Number(parsed?.workingSetGb);
    return gb > 0 ? gb : 0;
  } catch (_) {
    return 0;
  }
}

function parseArgs(argv) {
  const options = { ram: 0, workingSet: 0, profile: "", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--ram") options.ram = Number(argv[++i]);
    else if (arg === "--working-set") options.workingSet = Number(argv[++i]);
    else if (arg === "--profile") options.profile = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function verdictBadge(verdict) {
  if (verdict === "recommended") return "fits";
  if (verdict === "tight") return "tight";
  return "too big";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("node scripts/tools/luke-coding-models.cjs [--ram GB] [--working-set GB] [--profile id] [--json]");
    return;
  }

  const machine = options.profile
    ? { profileId: options.profile }
    : {
        systemRamGb: options.ram || os.totalmem() / 1024 ** 3,
        workingSetGb: options.workingSet || readLearnedWorkingSetGb(),
      };

  const report = catalog.recommendFor(machine);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { machine: profile, pick, models, backend } = report;
  console.log("");
  console.log(`  Free local coding models for ${profile.label}`);
  console.log(`  budget ${profile.workingSetGb.toFixed(1)} GB usable (${profile.source}), backend llama.cpp ${backend.pinnedRelease}`);
  console.log(`  catalog ${report.catalogVersion} verified ${report.verifiedAt}`);
  console.log("");
  console.log(`  ${pad("model", 44)}${pad("weights", 9)}${pad("KV/4K", 7)}${pad("auto", 7)}${pad("max ctx", 9)}verdict`);
  console.log(`  ${"-".repeat(86)}`);
  for (const model of models) {
    console.log(
      `  ${pad(model.label, 44)}${pad(`${model.weightGb.toFixed(1)} GB`, 9)}${pad(`${model.kvGbPer4096.toFixed(2)}`, 7)}${pad(model.autoContextTokens || "-", 7)}${pad(model.maxContextTokens || "-", 9)}${verdictBadge(model.verdict)}`,
    );
  }
  console.log("");

  if (!pick) {
    console.log("  Nothing in the catalog fits this machine with a 16K window.");
    console.log("  Use a smaller quant of the same model, or a 7B, and keep the context at 8192.");
    console.log("");
    return;
  }

  console.log(`  Pick: ${pick.label}  (${pick.license}, ${pick.weightGb} GB)`);
  console.log(`    ${pick.bestFor}`);
  if (pick.risk) console.log(`    Watch out: ${pick.risk}`);
  console.log(`    download: ${pick.sourceText}`);
  console.log("");
  console.log("  Then, in LUKE:");
  console.log("    1. Model Manager → paste that repo URL → choose the file");
  console.log(`    2. Model settings → Context = ${pick.contextTokens}  (leave Auto off: it is`);
  console.log("       deliberately conservative until llama.cpp has reported the real KV size once)");
  console.log("    3. KV cache stays q8_0; keep the Text workspace open");
  console.log("    4. scripts/tools/luke-agent-env.sh check   → tool calling must say ok");
  console.log("");
  const tooBig = models.filter((model) => model.verdict === "too-big");
  if (tooBig.length) {
    console.log(`  Not for this machine: ${tooBig.map((model) => `${model.label} (${model.weightGb} GB)`).join(", ")}`);
    console.log("");
  }
  console.log(`  Agent window target: ${report.agentNeeds.minContextTokens}–${report.agentNeeds.recommendedContextTokens} tokens (LUKE_LLM_MAX_CONTEXT raises LUKE's ceiling).`);
  console.log("");
}

try {
  main();
} catch (error) {
  console.error(`luke-coding-models: ${error.message}`);
  process.exit(1);
}
