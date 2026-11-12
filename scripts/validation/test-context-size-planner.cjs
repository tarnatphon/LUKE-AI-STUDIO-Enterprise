#!/usr/bin/env node
"use strict";

/**
 * The context window has to be as large as the memory really allows, and no
 * larger. Two bugs made it wrong on an 18 GB Mac: an image backend that was
 * just idling was counted as a loaded model, and the KV cache cost was guessed
 * so pessimistically that the same machine was offered 20000 tokens.
 *
 * Run: node scripts/validation/test-context-size-planner.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  LADDER,
  fallbackKvGbPer4096,
  kvProfileFile,
  parseKvSelfSizeMib,
  planContextSize,
  readKvProfile,
  recordKvProfile,
} = require("../server/context-size-planner.cjs");

const serveSource = fs.readFileSync(path.resolve(__dirname, "..", "..", "scripts", "server", "serve.cjs"), "utf8");

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

section("1. Reading llama.cpp's own KV cache report");
check(
  "the buffer-size wording is parsed",
  parseKvSelfSizeMib("llama_kv_cache:      CPU KV buffer size =   604.00 MiB") === 604,
  String(parseKvSelfSizeMib("llama_kv_cache:      CPU KV buffer size =   604.00 MiB"))
);
check(
  "the per-device wording is parsed",
  parseKvSelfSizeMib("llama_kv_cache:   CUDA0 KV buffer size =   604.00 MiB") === 604
);
check(
  "the detailed wording is parsed",
  parseKvSelfSizeMib("KV self size  =  604.00 MiB, K (f16):  302.00 MiB, V (f16):  302.00 MiB") === 604
);
check("a decimal separator is handled", parseKvSelfSizeMib("KV self size  =  1,208.00 MiB") === 1208);
check("the newer wording is parsed too", parseKvSelfSizeMib("KV self size  =  604.00 MiB") === 604);
check("an unrelated line is ignored", parseKvSelfSizeMib("llama_context: n_ctx_per_seq (8192)") === 0);
check("a missing value is safe", parseKvSelfSizeMib(undefined) === 0);

section("2. The pessimistic fallback while nothing is measured yet");
check("a 9B model is costed conservatively", fallbackKvGbPer4096(7.5) === 1.05);
check("a 4B model is costed conservatively", fallbackKvGbPer4096(4.2) === 0.85);
check("a small model is costed conservatively", fallbackKvGbPer4096(2.0) === 0.55);

section("3. An 18 GB Mac with a 7.5 GB model");
// This is the machine from the bug report: 18 GB RAM, Metal working set 14.3 GB,
// one 9B Q6_K model, and — after the fix — nothing else resident.
const base = {
  modelSizeGb: 7.5,
  projectorSizeGb: 0,
  isVision: false,
  isGpu: true,
  vramGb: 0,
  systemRamGb: 18,
  workingSetGb: 14.3,
  residentGb: 0,
};
{
  const plan = planContextSize(base);
  check("the Metal working set is the pool, not the total RAM", plan.poolGb === 14.3, String(plan.poolGb));
  check("nothing is counted as resident when nothing is loaded", plan.freeGb === 4.3, String(plan.freeGb));
  check("an unmeasured model still gets a safe window", plan.contextSize === 12288, String(plan.contextSize));
  check("the plan says the KV cost was estimated", plan.usedLearnedKv === false);
}
{
  // After one run llama.cpp reported ~0.3 GB per 4096 tokens for this model,
  // which is what a 9B with a q8_0 cache really costs.
  const plan = planContextSize({ ...base, kvGbPerToken: 0.3 / 4096 });
  check("once the KV cost is measured the window grows", plan.contextSize === 16384, String(plan.contextSize));
  check("the plan says the real cost was used", plan.usedLearnedKv === true);
}
{
  const plan = planContextSize({ ...base, residentGb: 5.2, kvGbPerToken: 0.3 / 4096 });
  check("a genuinely loaded image model does shrink the window", plan.contextSize < 16384, String(plan.contextSize));
  check("the window stays usable alongside it", plan.contextSize >= 2048, String(plan.contextSize));
}
{
  const plan = planContextSize({ ...base, systemRamGb: 8, workingSetGb: 6.2 });
  check("a small machine falls back to a small window", plan.contextSize <= 2048, String(plan.contextSize));
}

section("4. Other shapes");
{
  const plan = planContextSize({ ...base, isVision: true, kvGbPerToken: 0.3 / 4096 });
  check("a vision model stays at 8192", plan.contextSize === 8192, String(plan.contextSize));
}
{
  const plan = planContextSize({ ...base, isGpu: true, vramGb: 24, systemRamGb: 64, workingSetGb: 0 });
  check("a discrete GPU caps the pool at its own memory", plan.poolGb === 24, String(plan.poolGb));
}
{
  const plan = planContextSize({ ...base, systemRamGb: 64, workingSetGb: 0, kvGbPerToken: 0.1 / 4096 });
  check("a big machine can take the whole ladder top", plan.contextSize === LADDER[0], String(plan.contextSize));
}
{
  const plan = planContextSize({ ...base, modelSizeGb: 1.5, workingSetGb: 14.3, kvGbPerToken: 0.05 / 4096 });
  check("a small model is not held back", plan.contextSize === 16384, String(plan.contextSize));
}

section("5. Remembering what llama.cpp reported");
{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "luke-kv-"));
  const model = "Qwen3.5-9B-Q6_K.gguf";
  check("nothing is known before the first run", readKvProfile(stateDir, model) === 0);
  check("recording works", recordKvProfile(stateDir, model, { contextSize: 8192, kvMib: 604 }) === true);
  const perToken = readKvProfile(stateDir, model);
  check("it comes back as GB per token", perToken > 0 && Math.abs(perToken - 604 / 1024 / 8192) < 1e-12, String(perToken));
  check("other models are unaffected", readKvProfile(stateDir, "another.gguf") === 0);
  check("the profile lands in runtime-state", kvProfileFile(stateDir).includes(path.join("text-chat", "llm-kv-profile.json")));
  recordKvProfile(stateDir, model, { contextSize: 16384, kvMib: 1208 });
  check("a later run updates it", Math.abs(readKvProfile(stateDir, model) - 1208 / 1024 / 16384) < 1e-12);
  check("a broken state folder never throws", readKvProfile(path.join(stateDir, "missing"), model) === 0);
  check("recording without numbers is ignored", recordKvProfile(stateDir, model, {}) === false);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

section("6. An idling image backend is no longer counted as resident");
check("the resident size comes from what the backend really loaded", serveSource.includes("const imageBytes = Number(imageModelResidentBytes) || 0;"));
check(
  "the configured image model is no longer counted by itself",
  !/if \(\(backendReady \|\| backendProc[\s\S]{0,200}estimateModelBytes\(imageModel\)/.test(serveSource)
);
check("the flag is set when the backend loads weights", /model files processing completed[\s\S]{0,400}imageModelResidentBytes = estimateModelBytes/.test(serveSource));
check("the flag is cleared when the backend stops", /backendReady = false;\s*\n\s*imageModelResidentBytes = 0;/.test(serveSource));
check("the planner is used for the choice", serveSource.includes("planContextSize({") && serveSource.includes("Auto-selected context size"));
check("the reason is logged, including what is resident", serveSource.includes("nothing else is loaded") && serveSource.includes("residentBreakdown()"));
check("the real KV cost is learned from the backend log", serveSource.includes("parseKvSelfSizeMib(output)") && serveSource.includes("recordKvProfile("));

section("7. The pool is the model budget, not total RAM");
check(
  "the planner asks the budget for its pool",
  /const budget = evaluateModelMemoryBudget\(\{ targetPaths: \[\], targetType: "context" \}\);/.test(serveSource)
);
check("and hands that in as the pool", /systemRamGb: poolGb/.test(serveSource));
check("without applying the working set twice", /workingSetGb: 0,/.test(serveSource));
check(
  "so the log line quotes the same number the memory card shows",
  /model budget \$\{plan\.poolGb\} GB/.test(serveSource),
  "the two figures have to be the same figure, or one of them is a lie"
);

// The consequence, with the numbers from the machine that reported 0 GB free:
// 18 GB of RAM, a 6.9 GB model, Metal's 18 GB of shared video memory.
const generous = planContextSize({ modelSizeGb: 6.9, isGpu: true, vramGb: 18, systemRamGb: 18 });
const budgeted = planContextSize({ modelSizeGb: 6.9, isGpu: true, vramGb: 18, systemRamGb: 12.04 });
check(`planning against all 18 GB still offers ${generous.contextSize} tokens`, generous.contextSize === 16384);
check(
  `planning against the 12.04 GB budget offers ${budgeted.contextSize}, not 16384`,
  budgeted.contextSize === 8192,
  "the KV cache that did not fit is the memory the machine was compressing"
);
check(
  `and the KV budget shrinks with it (${generous.kvBudgetGb} GB → ${budgeted.kvBudgetGb} GB)`,
  budgeted.kvBudgetGb < generous.kvBudgetGb
);
check("the plan reports the pool it used, so the log line can be checked", budgeted.poolGb === 12.04, String(budgeted.poolGb));

section("8. The number it picks is on screen, next to the slider");
const panelSource = fs.readFileSync(path.resolve(__dirname, "..", "..", "app", "frontend", "src", "components", "PerformancePanel.jsx"), "utf8");
const settingsSource = fs.readFileSync(path.resolve(__dirname, "..", "..", "app", "frontend", "src", "components", "Settings.jsx"), "utf8");
check("there is an endpoint that answers for a model", /req\.url\.startsWith\("\/api\/llm\/context-plan"\)/.test(serveSource));
check("it returns the automatic size and the plan behind it", /automatic: plan\.contextSize/.test(serveSource) && /plan,\s*\n\s*next,/.test(serveSource));
check(
  "and the price of the next step up the same ladder",
  /const index = CONTEXT_LADDER\.indexOf\(plan\.contextSize\)/.test(serveSource)
    && /overByGb: Number\(Math\.max\(0,/.test(serveSource),
  "a bigger window is only a real choice if its cost is known"
);
check("the planner is imported by name, not re-implemented", /LADDER: CONTEXT_LADDER,/.test(serveSource));
check("the Performance card asks for it", /fetch\("\/api\/llm\/context-plan"\)/.test(panelSource));
check("and prints what the app chose", /Context window \(the slider above\)/.test(panelSource) && /Automatic: \$\{automatic\} tokens/.test(panelSource));
check(
  "including the memory arithmetic, not just the number",
  /is free after the model and the GPU buffer/.test(panelSource) && /set aside for the KV cache/.test(panelSource)
);
check(
  "and where the KV cost came from",
  /measured from llama.cpp/.test(panelSource) && /an estimate until the model has run once/.test(panelSource)
);
check(
  "a window the user chose is reported as theirs, with the reason the app stopped",
  /Saved: \$\{contextPlan\.effective\} tokens/.test(panelSource) && /compresses memory/.test(panelSource)
);
check(
  "the slider itself points at that line instead of saying \"0 uses default limit\"",
  /0 lets the app choose a size from the memory this machine actually has/.test(settingsSource)
    && !/0 uses default limit/.test(settingsSource)
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
