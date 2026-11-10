#!/usr/bin/env node
"use strict";

/**
 * A projector belongs to the model it was trained with.
 *
 * On a real machine this was in the log:
 *
 *   --model .../gemma-4-12b-it-uncensored-Q3_K_M.gguf
 *   --mmproj .../mmproj-Qwen3VL-8B-Instruct-F16.gguf
 *
 * Two things had to be true for that: gemma-4 is detected as multimodal (it is),
 * and the search ended with "give me whichever file has mmproj in its name"
 * (it did). Nothing matches a Qwen3VL vision encoder to gemma-4 weights; the
 * encoder either fails to load or answers image questions for a model that
 * never saw these images, and the UI reports vision as available either way.
 *
 * Run: node scripts/validation/test-vision-projector.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { chooseProjector, familiesIn, isProjectorFile, PROJECTOR_FAMILIES } = require("../server/vision-projector.cjs");
const { findProjector } = require("../server/text-model-pool.cjs");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const root = path.resolve(__dirname, "..", "..");
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const poolSource = fs.readFileSync(path.join(root, "scripts", "server", "text-model-pool.cjs"), "utf8");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-projector-"));

console.log("\n=== a vision projector belongs to its model ===\n");

// ── 1. the failure that started this ───────────────────────────────────────
const foreignFolder = ["gemma-4-12b-it-uncensored-Q3_K_M.gguf", "mmproj-Qwen3VL-8B-Instruct-F16.gguf"];
const bugCase = chooseProjector({ modelFilename: foreignFolder[0], files: foreignFolder });
check(bugCase.filename === null, "gemma-4 with only a Qwen3VL projector on disk gets no projector", String(bugCase.filename));
check(/No gemma-4 projector found/.test(bugCase.reason), "and the reason names the family it looked for", bugCase.reason);
check(/mmproj-Qwen3VL/.test(bugCase.reason), "and what was there instead", bugCase.reason);
check(bugCase.warning === "", "a refusal is not a warning — there is nothing doubtful to load");

// ── 2. every real pairing still resolves ───────────────────────────────────
const pairs = [
  ["qwen3vl-8b-q4_k_m.gguf", "mmproj-Qwen3VL-8B-Instruct-F16.gguf"],
  ["llava-v1.6-mistral-7b.Q4_K_M.gguf", "mmproj-llava-v1.6-f16.gguf"],
  ["smolvlm-500m-instruct.Q8_0.gguf", "mmproj-smolvlm-500m-f16.gguf"],
  ["llama-3.2-11b-internvl-Q4.gguf", "mmproj-internvl-11b-f16.gguf"],
];
for (const [model, projector] of pairs) {
  const choice = chooseProjector({ modelFilename: model, files: [model, projector, "mmproj-other-family-f16.gguf"] });
  check(choice.filename === projector, `${model} finds its own projector`, String(choice.filename));
  check(/same family/.test(choice.reason), `${model}: matched by family token`, choice.reason);
}

const repoMatch = chooseProjector({
  modelFilename: "unsloth--gemma-4-12b-it-GGUF--gemma-4-12b-Q4.gguf",
  files: [
    "unsloth--gemma-4-12b-it-GGUF--gemma-4-12b-Q4.gguf",
    "mmproj-gemma-4-other-f16.gguf",
    "unsloth--gemma-4-12b-it-GGUF--mmproj-F16.gguf",
  ],
});
check(repoMatch.filename === "unsloth--gemma-4-12b-it-GGUF--mmproj-F16.gguf",
  "a projector from the same repository beats one from the same family", String(repoMatch.filename));
check(/same repository/.test(repoMatch.reason), "and says why", repoMatch.reason);

// ── 3. text models never borrow an encoder ─────────────────────────────────
for (const name of ["qwen2.5-coder-14b-instruct-q4_k_m.gguf", "ggml-model-q4_k.gguf", "gemma-4-12b-q4.gguf"]) {
  const choice = chooseProjector({ modelFilename: name, files: [name, "mmproj-qwen3vl-8b-f16.gguf"] });
  if (name === "gemma-4-12b-q4.gguf") {
    check(choice.filename === null, `${name} is a vision family with no match, so nothing is attached`, String(choice.filename));
  } else {
    check(choice.filename === null, `${name} takes no projector, whichever ones are lying around`, String(choice.filename));
  }
}

const emptyFolder = chooseProjector({ modelFilename: "gemma-4-12b-q4.gguf", files: ["gemma-4-12b-q4.gguf"] });
check(emptyFolder.filename === null && /No mmproj projector/.test(emptyFolder.reason),
  "an empty folder is said plainly", emptyFolder.reason);

// ── 4. an explicit choice is honoured, and judged out loud ─────────────────
const explicitGood = chooseProjector({
  modelFilename: "qwen3vl-8b-q4_k_m.gguf",
  files: ["qwen3vl-8b-q4_k_m.gguf", "mmproj-Qwen3VL-8B-Instruct-F16.gguf"],
  explicit: "mmproj-Qwen3VL-8B-Instruct-F16.gguf",
});
check(explicitGood.filename === "mmproj-Qwen3VL-8B-Instruct-F16.gguf" && explicitGood.warning === "",
  "a projector chosen in Settings is used, quietly, when it matches");

const explicitBad = chooseProjector({
  modelFilename: "gemma-4-12b-it-uncensored-Q3_K_M.gguf",
  files: foreignFolder,
  explicit: "mmproj-Qwen3VL-8B-Instruct-F16.gguf",
});
check(explicitBad.filename === "mmproj-Qwen3VL-8B-Instruct-F16.gguf", "a mismatched explicit choice is still the user's call");
check(/image answers will be wrong/.test(explicitBad.warning), "but it is said out loud", explicitBad.warning);

const explicitGone = chooseProjector({
  modelFilename: "qwen3vl-8b-q4_k_m.gguf",
  files: ["qwen3vl-8b-q4_k_m.gguf", "mmproj-Qwen3VL-8B-Instruct-F16.gguf"],
  explicit: "mmproj-deleted-last-week.gguf",
});
check(explicitGone.filename === "mmproj-Qwen3VL-8B-Instruct-F16.gguf", "a remembered projector that is gone falls back to matching");

// ── 5. the helpers ─────────────────────────────────────────────────────────
check(familiesIn("Qwen3VL-8B-Instruct-F16.gguf").includes("qwen3vl"), "family tokens are found case-insensitively");
check(isProjectorFile("mmproj-model-f16.gguf") && !isProjectorFile("gemma-4-12b.gguf"), "a projector is an mmproj .gguf");
check(PROJECTOR_FAMILIES.every((token) => token === token.toLowerCase()), "the family list is lowercase, like every filename it is compared to");

// ── 6. both spawners ask the same question ─────────────────────────────────
check(serveSource.includes('require("./vision-projector.cjs")'), "the chat runtime asks the module");
check(poolSource.includes('require("./vision-projector.cjs")'), "and so does the arena pool");
check(!/lower === "mmproj-model-f16\.gguf" \|\| lower\.includes\("mmproj"\)/.test(serveSource),
  "the chat runtime no longer takes whichever projector has mmproj in its name");
check(!/fileLower\.includes\("mmproj"\)/.test(poolSource),
  "and neither does the arena pool");

// Behavioural, through the pool's own exported helper and a real folder.
const modelsDir = path.join(temp, "models");
fs.mkdirSync(modelsDir, { recursive: true });
fs.writeFileSync(path.join(modelsDir, "gemma-4-12b-it-uncensored-Q3_K_M.gguf"), "gguf");
fs.writeFileSync(path.join(modelsDir, "mmproj-Qwen3VL-8B-Instruct-F16.gguf"), "gguf");
check(findProjector(modelsDir, "gemma-4-12b-it-uncensored-Q3_K_M.gguf") === null,
  "the arena loader passes no --mmproj for gemma-4 in that folder",
  String(findProjector(modelsDir, "gemma-4-12b-it-uncensored-Q3_K_M.gguf")));

fs.writeFileSync(path.join(modelsDir, "mmproj-gemma-4-12b-f16.gguf"), "gguf");
check(findProjector(modelsDir, "gemma-4-12b-it-uncensored-Q3_K_M.gguf") === "mmproj-gemma-4-12b-f16.gguf",
  "and finds it as soon as the right one exists",
  String(findProjector(modelsDir, "gemma-4-12b-it-uncensored-Q3_K_M.gguf")));

fs.rmSync(temp, { recursive: true, force: true });

console.log(`\nPASS: ${checks} checks — vision is attached only to the model it was trained for.\n`);
