#!/usr/bin/env node
"use strict";

/**
 * "What should I run on my machine?" — both slots, one answer.
 *
 * The failure this guards is a recommendation that ignores the machine: a
 * leaderboard pick that never loads, or a chat model that fits on paper and
 * leaves a Mac swapping because 0.3 GB of slack is not slack. So the suite
 * checks the arithmetic on four machine sizes, the two verdict boundaries
 * (fits vs tight vs too big), the CLI's output and JSON, and that the chat
 * catalog stays in step with the library the UI actually offers.
 *
 * Run: node scripts/validation/test-hardware-fit.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const chatFit = require(path.join(root, "scripts", "server", "chat-model-fit.cjs"));
const codingModels = require(path.join(root, "scripts", "server", "coding-agent-models.cjs"));
const cliPath = path.join(root, "scripts", "tools", "luke-hardware-fit.cjs");
const docPath = path.join(root, "docs", "beta7", "hardware-fit.md");
const libraryPath = path.join(root, "app", "frontend", "src", "lib", "text-model-library.mjs");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function main() {
  console.log("\n=== best fit for this machine ===\n");

  // ── 1. the machine-specific answers ───────────────────────────────────────
  const mac18 = chatFit.bestFit({ profileId: "mac-18" });
  assert(mac18.machine.workingSetGb === 14.3, "an 18 GB Mac has 14.3 GB of addressable memory, not 18");
  assert(mac18.work.pick?.id === "qwen2.5-coder-14b-q4_k_m", `Work is the 14B at Q4_K_M (${mac18.work.pick?.id})`);
  assert(Number(mac18.work.pick.contextTokens) >= 16384, `with a window an agent can use (${mac18.work.pick.contextTokens})`);
  assert(mac18.chat.pick?.id === "qwen3.6-27b-iq2_xxs", `Chat is the 27B at a 2-bit quant (${mac18.chat.pick?.id})`);
  assert(
    mac18.chat.pick.headroomGb >= mac18.chat.pick.slackGb,
    `Chat leaves real slack: ${mac18.chat.pick.headroomGb} GB over a ${mac18.chat.pick.slackGb} GB floor`,
  );
  assert(mac18.diskGb === 18.4, `both downloads total ${mac18.diskGb} GB of disk`);
  assert(mac18.sharedModel === false, "the two slots are different files here");

  const mac32 = chatFit.bestFit({ profileId: "mac-32" });
  assert(mac32.work.pick?.id === "qwen3-coder-30b-a3b-q4_k_m", "32 GB moves Work to the 30B at Q4_K_M");
  assert(mac32.chat.pick?.id === "mistral-small-3.2-24b-q4_k_m", "and Chat to a 4-bit 24B");
  assert(
    mac32.work.pick.id !== mac18.work.pick.id && mac32.chat.pick.id !== mac18.chat.pick.id,
    "both halves of the answer follow the machine, not a constant",
  );

  const pc24 = chatFit.bestFit({ profileId: "pc-24" });
  assert(pc24.work.pick?.id === "qwen3-coder-30b-a3b-q4_k_m", "24 GB of VRAM gets the 30B for Work");

  const tiny = chatFit.bestFit({ systemRamGb: 4 });
  assert(tiny.chat.pick === null || tiny.chat.pick.sizeGb <= 4, "a 4 GB machine is not told to download a 27B");
  assert(tiny.work.pick === null, "and Work says nothing fits instead of pretending");

  // ── 2. the verdict boundaries ─────────────────────────────────────────────
  const byId = (result, id) => result.chat.models.find((model) => model.id === id);
  assert(byId(mac18, "glm-4.7-flash-iq2_m").verdict === "tight", "GLM-4.7-Flash fits on paper and is called tight, not a pick");
  assert(byId(mac18, "mistral-small-3.2-24b-q4_k_m").verdict === "too-big", "a 14.4 GB model is too big for a 14.3 GB budget");
  assert(byId(mac18, "qwen3-4b-q4_k_m").verdict === "fits", "a 2.5 GB model fits with room to spare");
  assert(
    mac18.chat.models.every((model, index, list) => index === 0
      || ["fits", "tight", "too-big"].indexOf(model.verdict) >= ["fits", "tight", "too-big"].indexOf(list[index - 1].verdict)),
    "the chat list is ordered: what fits, then what nearly fits, then what cannot",
  );
  assert(
    mac18.work.models.find((model) => model.id === "qwen3-coder-30b-a3b-q4_k_m").verdict === "too-big",
    "and the 18.6 GB coder is too big for Work on this machine",
  );
  assert(
    mac18.chat.models.every((model) => /^https:\/\/huggingface\.co\//.test(model.url)),
    "every chat entry links to its own huggingface file",
  );

  // A 2-bit quant is scored down, not hidden: that is why the 27B does not win
  // outright on quality alone.
  const qwen27 = byId(mac18, "qwen3.6-27b-iq2_xxs");
  assert(qwen27.score === qwen27.chatQuality - 8, "a 2-bit quant carries an 8-point penalty");

  // ── 3. the catalog stays in step with the library the UI offers ───────────
  const library = fs.readFileSync(libraryPath, "utf8");
  const codingFiles = codingModels.getCatalog().models
    .map((model) => `${model.source?.file || ""} ${model.source?.mirrorFile || ""}`)
    .join(" ");
  const signedCatalog = JSON.parse(
    fs.readFileSync(path.join(root, "app", "config", "text-models", "signed-catalog.json"), "utf8"),
  );
  const signedFiles = (signedCatalog.models || [])
    .flatMap((model) => (model.variants || []).map((variant) => variant.filename))
    .join(" ");
  const described = `${library} ${codingFiles} ${signedFiles}`;
  const catalogFiles = chatFit.getChatCatalog().models;
  assert(catalogFiles.length >= 5, "the chat catalog has enough entries to choose from");
  // Every file this catalog recommends has to be one LUKE already offers — in
  // the frontend library or in the coding catalog — or the advice would send
  // people to a model the app cannot download.
  for (const model of catalogFiles) {
    assert(described.includes(model.filename), `${model.id}'s file is one the app already offers (${model.filename})`);
  }
  assert(
    path.basename(catalogFiles.find((model) => model.id === "qwen3-4b-q4_k_m").url) === "Qwen3-4B-Q4_K_M.gguf",
    "the Qwen3 4B entry points at the same file the signed catalog describes",
  );

  // ── 4. a broken catalog is refused, not recommended ───────────────────────
  const brokenPath = path.join(os.tmpdir(), `luke-chat-broken-${process.pid}.json`);
  fs.writeFileSync(brokenPath, JSON.stringify({
    models: [{
      id: "bad",
      name: "Bad",
      filename: "bad.gguf",
      sizeGb: 4,
      chatQuality: 10,
      quantRisk: "low",
      url: "https://huggingface.co/x/y/resolve/main/other.gguf",
    }],
  }));
  let brokenRejected = false;
  try {
    chatFit.readChatCatalog(brokenPath);
  } catch (error) {
    brokenRejected = /does not end with its filename/.test(error.message);
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
  assert(brokenRejected, "a catalog entry whose url points at another file is rejected");

  // ── 5. the CLI ────────────────────────────────────────────────────────────
  const cli = runCli(["--profile", "mac-18"]);
  assert(cli.status === 0, "the CLI runs for a machine profile");
  assert(cli.stdout.includes("Qwen2.5-Coder 14B Instruct"), "and names the Work pick");
  assert(cli.stdout.includes("Qwen3.6 27B"), "and the Chat pick");
  assert(cli.stdout.includes("DOES NOT FIT"), "and says what does not fit");
  assert(cli.stdout.includes("18.4 GB"), "and how much disk both cost");
  assert(cli.stdout.includes("IA Library") === false, "without inventing a UI path");
  assert(cli.stdout.includes("AI Library → Code AI"), "but pointing at the real one");

  const json = runCli(["--profile", "mac-18", "--json"]);
  const parsed = JSON.parse(json.stdout);
  assert(parsed.ok === true && parsed.work.id === mac18.work.pick.id, "--json agrees with the module");
  assert(parsed.chat.id === mac18.chat.pick.id, "for both slots");
  assert(Array.isArray(parsed.chatModels) && parsed.chatModels.length === mac18.chat.models.length, "and carries the full chat ranking");

  const ram = runCli(["--ram", "32"]);
  assert(ram.status === 0 && ram.stdout.includes("30B-A3B"), "--ram re-ranks for another machine");

  const help = runCli(["--help"]);
  assert(help.status === 0 && /mac-18/.test(help.stdout), "--help lists the machine profiles");

  const bad = runCli(["--profile", "mac-999"]);
  assert(bad.status === 1 && /unknown machine profile/.test(bad.stderr), "an unknown profile fails loudly");

  // ── 6. the doc ────────────────────────────────────────────────────────────
  assert(fs.existsSync(docPath), "docs/beta7/hardware-fit.md exists");
  const doc = fs.readFileSync(docPath, "utf8");
  assert(doc.includes("Qwen2.5-Coder 14B Instruct") && doc.includes("Qwen3.6 27B"), "the doc records the 18 GB Mac answer");
  assert(doc.includes("14.3 GB"), "and the budget it is based on");
  assert(doc.includes("18.6 GB"), "and the model that does not fit");
  assert(doc.includes("luke-hardware-fit.cjs"), "and the command that produced it");
  assert(doc.includes("/api/text-profiles"), "and how to apply it");

  console.log(`\nPASS: ${checks} checks — the best fit for a machine names both slots, with the arithmetic.\n`);
}

try {
  main();
} catch (error) {
  console.error(`\nFAIL: ${error.message}\n`);
  process.exit(1);
}

