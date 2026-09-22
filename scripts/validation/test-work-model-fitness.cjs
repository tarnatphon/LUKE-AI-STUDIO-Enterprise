"use strict";

/**
 * Work mode is only as good as the model behind it.
 *
 * Work asks a model to read files, edit them, run the project's own checks and
 * read the failure. A model that was not trained for tool use answers that
 * request by writing the tools out as prose — "update_tasks", "repo_map" — and
 * every workaround in this app exists to cope with the fallout of that. The
 * fix is not another workaround: it is a model that calls tools because it was
 * trained to.
 *
 * So the library says which models those are, what memory they need, and the
 * app says so out loud when the loaded model cannot carry Work — with the name
 * of one that can, for the machine it is running on.
 *
 * Run: node scripts/validation/test-work-model-fitness.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const libraryFile = path.join(root, "app", "frontend", "src", "lib", "text-model-library.mjs");
const chatFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");
const managerFile = path.join(root, "app", "frontend", "src", "components", "ModelManager.jsx");

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

async function main() {
  const lib = await import(`file://${libraryFile}`);
  const chat = fs.readFileSync(chatFile, "utf8");
  const manager = fs.readFileSync(managerFile, "utf8");

  section("1. The library knows which models can carry Work");
  const ready = lib.workReadyModels();
  check("there is more than one", ready.length >= 2, String(ready.length));
  check("every one says how much memory it needs", ready.every((model) => Number(model.minMemoryGb) > 0));
  check("every one says how big the download is", ready.every((model) => Number(model.sizeGb) > 0));
  check("every one can be downloaded", ready.every((model) => /^https:\/\/huggingface\.co\/.+\.gguf$/.test(String(model.url || ""))),
    ready.map((model) => model.url).join(" | ").slice(0, 160));
  check("the old 7B coder is not one of them",
    !ready.some((model) => /(^|[^0-9])7b\b/i.test(String(model.name))), ready.map((model) => model.name).join(", "));
  check("and neither is anything small enough to be one", ready.every((model) => Number(model.sizeGb) >= 8));
  check("the smallest option fits a 16 GB machine", ready.some((model) => model.minMemoryGb <= 16));

  section("2. A recommendation for the machine it is running on");
  for (const [ram, expected] of [[16, 16], [24, 24], [32, 24], [64, 24]]) {
    const pick = lib.recommendWorkModel(ram);
    check(`${ram} GB gets a model that fits`, Boolean(pick) && pick.minMemoryGb <= ram,
      pick ? `${pick.name} needs ${pick.minMemoryGb}` : "none");
    check(`${ram} GB gets the biggest that fits`,
      pick === lib.workReadyModels().filter((model) => model.minMemoryGb <= ram).sort((a, b) => b.sizeGb - a.sizeGb)[0]);
    void expected;
  }
  check("a machine with no memory reported still gets a suggestion", Boolean(lib.recommendWorkModel(0)));
  check("the loaded model is checked by filename",
    lib.isWorkReadyModel("Qwen3.6-27B-Q4_K_M.gguf") === true
    && lib.isWorkReadyModel("qwen2.5-coder-7b-instruct-q4_k_m.gguf") === false
    && lib.isWorkReadyModel("") === false);

  section("3. Work says so out loud");
  check("the chat watches the mode, the model, the machine and the cloud chain",
    /\}, \[assistantMode, selectedModel, specs, cloudChain\]\);/.test(chat));
  check("and only speaks in Work mode", /if \(assistantMode !== "work" \|\| !selectedModel \|\| isWorkReadyModel\(selectedModel\)\)/.test(chat));
  check("it names the model that is loaded", /\$\{selectedModel\}/.test(chat));
  check("it names one that would work, and its size", /\$\{best\.name\} \(\$\{best\.approxSize\}/.test(chat));
  check("it says what memory that needs", /needs \$\{best\.minMemoryGb\} GB/.test(chat));
  check("and it is honest when nothing fits",
    /best\.minMemoryGb > ramGb[\s\S]{0,500}Work mode is not going to work well/.test(chat));
  check("it can be dismissed", /onClick=\{\(\) => setWorkModelNotice\(""\)\}/.test(chat));
  check("it is shown where the user is working", /className="work-model-notice"/.test(chat));

  // Once a cloud provider is connected the warning is simply wrong: Work is not
  // going to use the local model for the turn, so telling the user their model
  // is too small sends them off to download 17 GB for nothing.
  check("the chat asks which providers are connected",
    /\/api\/text-runtime\/remote-provider\/status/.test(chat)
    && /setCloudChain\(/.test(chat));
  check("and it asks again when the mode changes",
    /\}, \[assistantMode\]\);/.test(chat));
  check("a connected provider replaces the warning instead of sitting under it",
    /if \(cloudChain\.length > 0\) \{\s*setWorkModelNotice\(/.test(chat));
  check("that replacement names the provider Work will use",
    /Work will answer through \$\{cloudChain\[0\]\}/.test(chat));
  check("and the rest of the chain behind it",
    /cloudChain\.slice\(1\)\.join\(" then "\)/.test(chat));
  check("it comes before the download advice, not after",
    chat.indexOf("if (cloudChain.length > 0)") < chat.indexOf("const best = recommendWorkModel(ramGb)"));
  check("and it still says the local model is not thrown away",
    /stays loaded for chat and as the last resort/.test(chat));

  section("4. The library stays out of the first paint");
  check("it is a module of its own", fs.existsSync(libraryFile));
  check("the chat imports that module, not the manager",
    /from "\.\.\/lib\/text-model-library\.mjs"/.test(chat) && !/from "\.\/ModelManager"/.test(chat));
  check("the manager imports it too", /from "\.\.\/lib\/text-model-library\.mjs"/.test(manager));
  check("and the manager still lists the library", /TEXT_MODEL_LIBRARY/.test(manager));
  check("the catalog is not duplicated in two places",
    (manager.match(/const TEXT_MODEL_LIBRARY = \[/g) || []).length === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
