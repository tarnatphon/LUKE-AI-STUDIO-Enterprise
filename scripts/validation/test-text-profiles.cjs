#!/usr/bin/env node
"use strict";

/**
 * Chat and Work keep separate model slots.
 *
 * The failure this guards is not a crash, it is a product that quietly goes back
 * to one model for both jobs: a coding GGUF answering "write me a poem" at
 * temperature 0.2, or a chat model in Work that writes tool calls out as prose.
 * So the suite checks three layers:
 *
 *   1. the store — defaults, saved overrides, validation (a browser-supplied
 *      value becomes a file the server opens, so a path must never survive),
 *      and the warnings that encode what makes Work work;
 *   2. the routes and the swap — activation must go through startLlm, must be a
 *      no-op when the right model is already resident, and must forget the slot
 *      when the engine stops;
 *   3. the UI wiring — switching mode activates that slot, a manual pick is
 *      remembered in the slot the user is in, and sampling follows the slot
 *      instead of always using Settings.
 *
 * Run: node scripts/validation/test-text-profiles.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const STATE_FILE = path.join(os.tmpdir(), `luke-text-profiles-${process.pid}.json`);
const REAL_STATE_FILE = path.join(root, "app", "runtime-state", "text-profiles.json");

const realStateBefore = fs.existsSync(REAL_STATE_FILE)
  ? { mtime: fs.statSync(REAL_STATE_FILE).mtimeMs, content: fs.readFileSync(REAL_STATE_FILE, "utf8") }
  : null;

process.env.LUKE_TEXT_PROFILES_FILE = STATE_FILE;

const textProfiles = require(path.join(root, "scripts", "server", "text-profiles.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "services", "api.js"), "utf8");
const chatSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "TextChat.jsx"), "utf8");
const chatCssSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "TextChat.css"), "utf8");
const docPath = path.join(root, "docs", "beta7", "chat-and-work-model-profiles.md");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

function restoreRealState() {
  if (realStateBefore) {
    fs.writeFileSync(REAL_STATE_FILE, realStateBefore.content, "utf8");
    return;
  }
  try {
    fs.unlinkSync(REAL_STATE_FILE);
  } catch (_) {}
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A throwaway checkout the real server can boot from, as the other suites do. */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-profiles-"));
  const destination = path.join(temp, "repo");
  fs.mkdirSync(path.join(destination, "scripts", "server"), { recursive: true });
  fs.mkdirSync(path.join(destination, "app"), { recursive: true });

  const sources = spawnSync("find", ["scripts", "-type", "f", "-not", "-path", "*/node_modules/*"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.split("\n").filter(Boolean);
  for (const file of sources) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }

  const dependencies = path.join(root, "scripts", "server", "node_modules");
  if (fs.existsSync(dependencies)) {
    fs.symlinkSync(dependencies, path.join(destination, "scripts", "server", "node_modules"), "dir");
  }
  for (const folder of ["config", "dist"]) {
    const source = path.join(root, "app", folder);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(destination, "app", folder), { recursive: true });
  }
  return { temp, destination };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The store can be perfect and the routes still unreachable. This boots the
 * real server on a throwaway checkout and drives the three routes the tab
 * switch depends on — including the refusal, which is the behaviour that keeps
 * a slot from loading a model the machine may not have.
 */
async function liveServerChecks() {
  const { temp, destination } = buildTempRoot();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(destination, "scripts", "server", "serve.cjs")], {
    cwd: destination,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      LUKE_AI_HOST: "127.0.0.1",
      LUKE_AI_PORT: String(port),
      LUKE_TEXT_PROFILES_FILE: path.join(temp, "state.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.resume();
  child.stderr.resume();

  const post = (target, body) =>
    fetch(`${baseUrl}${target}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try {
        await fetch(`${baseUrl}/api/health`);
        ready = true;
        break;
      } catch {
        await delay(150);
      }
    }
    assert(ready, "the server boots on a throwaway checkout");

    const initial = await fetch(`${baseUrl}/api/text-profiles`);
    const initialBody = await initial.json();
    assert(initial.status === 200 && initialBody.ok, "GET /api/text-profiles answers");
    assert(Object.keys(initialBody.profiles || {}).sort().join(",") === "chat,work", "it returns both slots");
    assert(initialBody.activeProfile === null || initialBody.activeProfile === undefined, "nothing is active before a model is loaded");
    assert(Array.isArray(initialBody.warnings?.work), "it reports the Work slot's warnings");

    const emptyActivate = await post("/api/text-profiles/activate", { profile: "work" });
    const emptyBody = await emptyActivate.json();
    assert(emptyActivate.status === 409, `activating an unconfigured slot is refused (${emptyActivate.status})`);
    assert(emptyBody.code === "NO_PROFILE_MODEL", "and says why: NO_PROFILE_MODEL");

    const unknownActivate = await post("/api/text-profiles/activate", { profile: "coding" });
    assert(unknownActivate.status === 400, "activating a slot that does not exist is a 400");

    const saved = await post("/api/text-profiles", {
      profile: "work",
      model: "../../escape.gguf",
      contextSize: 20000,
      temperature: 0.2,
    });
    const savedBody = await saved.json();
    assert(saved.status === 200 && savedBody.ok, "POST /api/text-profiles saves the Work slot");
    assert(savedBody.profiles.work.model === "escape.gguf", "a path never survives the round trip to disk");
    assert(savedBody.profiles.work.contextSize === 20000, "the saved window comes back");
    assert(savedBody.profiles.chat.model === "", "and the Chat slot is untouched");

    const badSave = await post("/api/text-profiles", { profile: "work", model: "weights.safetensors" });
    assert(badSave.status === 400, "a non-GGUF is refused by the route too");

    const savedAgain = await post("/api/text-profiles", { profile: "work", model: "escape.gguf", contextSize: 4096 });
    const savedAgainBody = await savedAgain.json();
    assert(
      (savedAgainBody.slotWarnings || []).some((warning) => warning.code === "small-context"),
      "the route returns the warning for a window an agent cannot work in",
    );

    // llama.cpp is not installed in the throwaway checkout, so activation must
    // fail loudly rather than report a model that is not there.
    const activation = await post("/api/text-profiles/activate", { profile: "work" });
    const activationBody = await activation.json();
    assert(activation.status >= 400 && activationBody.ok === false, `activation with no engine fails loudly (${activation.status})`);
    assert(
      /gguf|llama\.cpp|not found|ENOENT|download/i.test(activationBody.error || ""),
      `and the error names the missing piece rather than something vague (${activationBody.error})`,
    );

    const after = await fetch(`${baseUrl}/api/text-profiles`);
    const afterBody = await after.json();
    assert(afterBody.resident?.ready === false, "nothing is reported as resident after a failed load");
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  console.log("\n=== chat and work model slots ===\n");

  // ── 1. the store ──────────────────────────────────────────────────────────
  const defaults = textProfiles.readProfiles();
  assert(Object.keys(defaults).sort().join(",") === "chat,work", "there are exactly two slots: chat and work");
  assert(defaults.chat.requiresToolCalling === false, "Chat does not require tool calling");
  assert(defaults.work.requiresToolCalling === true, "Work does require tool calling — it is a coding agent");
  assert(defaults.work.contextSize > defaults.chat.contextSize, "Work gets the larger window by default");
  assert(defaults.work.temperature < defaults.chat.temperature, "Work samples colder than Chat by default");
  assert(defaults.chat.model === "" && defaults.work.model === "", "neither slot invents a model the machine may not have");

  const warningsEmpty = textProfiles.warningsFor("work", defaults.work);
  assert(warningsEmpty.some((w) => w.code === "no-model"), "an empty slot says so instead of failing silently");

  // a saved override wins over the default, and nothing else is disturbed
  const saved = textProfiles.saveProfile("work", {
    model: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    contextSize: 20000,
    temperature: 0.2,
  });
  assert(saved.profile.model === "qwen2.5-coder-14b-instruct-q4_k_m.gguf", "saving a Work model persists it");
  assert(saved.profile.contextSize === 20000, "saving a Work context persists it");
  assert(textProfiles.readProfiles().chat.model === "", "saving Work does not touch Chat");
  const afterSave = textProfiles.readProfiles();
  assert(afterSave.work.warningsFor === undefined, "profiles are plain data (no methods leaking into JSON)");
  assert(textProfiles.warningsFor("work", afterSave.work).length === 0, "a sane Work slot produces no warnings");

  // the validation that keeps a browser value from becoming a path
  assert(textProfiles.normalizeModel("../../etc/passwd") === "", "a path is not a model");
  assert(textProfiles.normalizeModel("model.safetensors") === "", "a non-GGUF is not a model");
  assert(textProfiles.normalizeModel("/abs/path/My Model.Q4_K_M.GGUF") === "My Model.Q4_K_M.GGUF", "a path is reduced to its GGUF file name, case preserved");

  // A path is sanitised rather than rejected: it still names a real file in
  // app/llm-models, and startLlm's own containment check runs on the result.
  const sanitised = textProfiles.saveProfile("chat", { model: "../../secrets.gguf" });
  assert(sanitised.profile.model === "secrets.gguf", "a path is stored as a bare file name, never as a path");

  let rejected = false;
  try {
    textProfiles.saveProfile("chat", { model: "model.safetensors" });
  } catch (error) {
    rejected = error.statusCode === 400;
  }
  assert(rejected, "a non-GGUF is refused with a 400");

  let unknownRejected = false;
  try {
    textProfiles.saveProfile("both", { model: "x.gguf" });
  } catch (error) {
    unknownRejected = error.statusCode === 400;
  }
  assert(unknownRejected, "an unknown slot id is refused");

  // warnings carry the research: agents need a big window, cold sampling, tools
  const badWork = textProfiles.warningsFor("work", {
    model: "a.gguf", contextSize: 4096, temperature: 0.9, requiresToolCalling: true, toolCalling: false,
  });
  const codes = badWork.map((w) => w.code);
  assert(codes.includes("small-context"), "a 4K window is warned about (an agent prompt does not fit)");
  assert(codes.includes("warm-sampling"), "temperature 0.9 is warned about (tool calls degrade)");
  assert(codes.includes("no-tool-calling"), "a backend without --jinja is warned about");

  // settings handed to startLlm
  const settings = textProfiles.settingsFor("work");
  assert(settings.model === "qwen2.5-coder-14b-instruct-q4_k_m.gguf", "settingsFor(work) returns the saved model");
  assert(settings.contextSize === 20000 && settings.temperature === 0.2, "settingsFor(work) returns the saved window and sampling");

  // classify: which slot is resident
  assert(textProfiles.classify("qwen2.5-coder-14b-instruct-q4_k_m.gguf") === "work", "a resident Work model is recognised");
  assert(textProfiles.classify("chat-model.gguf") === null, "an unassigned model belongs to neither slot");

  textProfiles.saveProfile("chat", { model: "qwen2.5-coder-14b-instruct-q4_k_m.gguf" });
  assert(textProfiles.classify("qwen2.5-coder-14b-instruct-q4_k_m.gguf") === "both", "one model in both slots is reported as both");

  let noModel = false;
  try {
    textProfiles.saveProfile("chat", { model: "" });
    textProfiles.settingsFor("chat");
  } catch (error) {
    noModel = error.code === "NO_PROFILE_MODEL";
  }
  assert(noModel, "activating an empty slot stops with NO_PROFILE_MODEL instead of loading nothing");

  // cleanup for the remaining assertions
  fs.rmSync(STATE_FILE, { force: true });

  // ── 2. the routes and the swap ────────────────────────────────────────────
  assert(serveSource.includes('require("./text-profiles.cjs")'), "serve.cjs owns the slots");
  assert(serveSource.includes('req.url === "/api/text-profiles" && req.method === "GET"'), "GET /api/text-profiles exists");
  assert(serveSource.includes('req.url === "/api/text-profiles" && req.method === "POST"'), "POST /api/text-profiles saves a slot");
  assert(serveSource.includes('req.url === "/api/text-profiles/activate"'), "POST /api/text-profiles/activate swaps the resident model");
  assert(
    /await runExclusiveLlmOperation\(\(\) => startLlm\(settings\)\)/.test(serveSource),
    "activation loads through the existing exclusive startLlm path",
  );
  assert(
    /if \(llmReady && residentModel === settings\.model\) \{[\s\S]{0,220}switched: false/.test(serveSource),
    "activation is a no-op when the right model is already resident",
  );
  assert(
    /llmModelLoadingBytes = 0;\s*\n\s*\/\/ Nothing is resident[\s\S]{0,80}?activeTextProfileId = null;/.test(serveSource),
    "stopping the engine forgets which slot was active",
  );
  assert(
    /activeTextProfileId = textProfiles\.classify\(llmSettings\.model\)/.test(serveSource),
    "a model started by hand re-derives its slot instead of leaving a stale one",
  );

  // ── 3. the UI wiring ──────────────────────────────────────────────────────
  assert(/export async function getTextProfiles\(/.test(apiSource), "api.js exposes getTextProfiles");
  assert(/export async function saveTextProfile\(/.test(apiSource), "api.js exposes saveTextProfile");
  assert(/export async function activateTextProfile\(/.test(apiSource), "api.js exposes activateTextProfile");
  assert(
    /activateTextProfile\(slot\)/.test(chatSource) && /\[assistantMode\]/.test(chatSource),
    "switching mode activates that slot",
  );
  assert(
    /saveTextProfile\(pickedSlot, \{ model: filename \}\)/.test(chatSource),
    "a manual model pick is remembered in the slot the user is in",
  );
  assert(
    /const requestTemperature = Number\.isFinite\(Number\(activeSlotProfile\?\.temperature\)\)/.test(chatSource),
    "sampling follows the active slot",
  );
  assert(
    !/temperature: textSettings\?\.temperature \|\| 0\.7,/.test(chatSource),
    "no call site still hard-codes the old temperature",
  );
  assert(
    /const configuredWorkModel = textProfileState\?\.profiles\?\.work\?\.model/.test(chatSource),
    "a configured Work slot suppresses the 'too small for tools' warning",
  );
  assert(/className="text-slot-notice"/.test(chatSource), "the active slot is visible in the chat header, not inferred");
  assert(
    /the other tab keeps its own model, so it reloads when you switch/.test(chatSource),
    "the banner explains the reload when the two slots differ",
  );
  assert(/text-slot-notice/.test(chatCssSource), "and the banner has styling of its own");

  // ── 4. the document ───────────────────────────────────────────────────────
  assert(fs.existsSync(docPath), "docs/beta7/chat-and-work-model-profiles.md exists");
  const docSource = fs.readFileSync(docPath, "utf8");
  assert(docSource.includes("/api/text-profiles/activate"), "the doc documents the activation route");
  assert(docSource.includes("only one"), "the doc says only one model is resident at a time");
  assert(docSource.includes("--jinja"), "the doc ties Work to tool calling");
  assert(/CLAUDE_CODE_ATTRIBUTION_HEADER/.test(docSource), "the doc records the agent-side tuning it was built from");

  // ── 5. against a running server ───────────────────────────────────────────
  restoreRealState();
  await liveServerChecks();

  console.log(`\nPASS: ${checks} checks — Chat and Work model slots are separate, saved, and swapped.\n`);
}

main().catch((error) => {
  restoreRealState();
  console.error(`\nFAIL: ${error.message}\n`);
  process.exit(1);
});
