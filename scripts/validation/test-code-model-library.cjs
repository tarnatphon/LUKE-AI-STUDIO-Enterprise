#!/usr/bin/env node
"use strict";

/**
 * AI Library → Code AI.
 *
 * The tab exists because "best local coding model" is not a list you can read
 * off a leaderboard: the answer depends on the machine, and the wrong answer is
 * not slow, it is a model that never loads. So the suite checks the parts that
 * make the tab honest:
 *
 *   1. the catalog module ranks for a machine (18 GB → the 14B; an 18.6 GB Q4 →
 *      too-big, because 14.3 GB of Metal working set cannot hold it);
 *   2. every entry that claims to be installable carries a real
 *      huggingface.co .gguf URL whose filename matches the catalog;
 *   3. installed detection looks for the file (and its mirror) on disk;
 *   4. the server route is wired to the live machine, not a constant;
 *   5. the tab downloads through the same pipeline as every other text model,
 *      and can hand the installed file to the Work slot;
 *   6. against a running server, the endpoint answers and re-ranks when the
 *      machine changes.
 *
 * Run: node scripts/validation/test-code-model-library.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const catalog = require(path.join(root, "scripts", "server", "coding-agent-models.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "services", "api.js"), "utf8");
const managerSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "ModelManager.jsx"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "ModelManager.css"), "utf8");
const docPath = path.join(root, "docs", "beta7", "code-ai-library-tab.md");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-code-ai-"));
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
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.resume();
  child.stderr.resume();

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

    const response = await fetch(`${baseUrl}/api/coding-models`);
    const body = await response.json();
    assert(response.status === 200 && body.ok === true, "GET /api/coding-models answers");
    assert(Array.isArray(body.models) && body.models.length >= 4, `it returns the catalog (${body.models?.length} models)`);
    assert(
      body.pick === null || body.pick.verdict === "recommended",
      "a recommendation, or an honest null when nothing fits this machine",
    );
    assert(
      body.models.every((model, index, list) => index === 0 || ["recommended", "tight", "too-big"].indexOf(model.verdict) >= ["recommended", "tight", "too-big"].indexOf(list[index - 1].verdict)),
      "the list is ranked: what fits, then what nearly fits, then what does not",
    );
    assert(
      body.models.every((model) => model.download === null || /^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+\.gguf$/.test(model.download.url)),
      "every download it offers is a huggingface resolve URL to a .gguf",
    );
    assert(body.models.every((model) => model.installed === ""), "nothing is reported as installed in an empty library");
    assert(typeof body.machine?.workingSetGb === "number" && body.machine.workingSetGb > 0, "the machine's usable memory is reported");

    // The ranking is per machine, not a constant: on 18 GB the 14B is the pick
    // and the 30B at Q4_K_M is out of reach; on 64 GB it is the other way round.
    const macLike = await (await fetch(`${baseUrl}/api/coding-models?systemRamGb=18`)).json();
    assert(macLike.pick?.id === "qwen2.5-coder-14b-q4_k_m", `18 GB is offered the 14B (${macLike.pick?.id})`);
    assert(
      macLike.models.find((model) => model.id === "qwen3-coder-30b-a3b-q4_k_m")?.verdict === "too-big",
      "and the 30B at Q4_K_M is too big there",
    );

    const wide = await (await fetch(`${baseUrl}/api/coding-models?systemRamGb=64`)).json();
    assert(wide.pick?.id === "qwen3-coder-30b-a3b-q4_k_m", `64 GB is offered the 30B (${wide.pick?.id})`);
    assert(wide.pick.id !== macLike.pick.id, "the recommendation follows the machine");
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
  console.log("\n=== AI Library: Code AI ===\n");

  // ── 1. the ranking ────────────────────────────────────────────────────────
  const mac = catalog.describeCodingModels({ systemRamGb: 18, workingSetGb: 14.3, llmModelsDir: os.tmpdir() });
  assert(mac.models.length >= 4, "the catalog has coding models to offer");
  assert(mac.pick && mac.pick.verdict === "recommended", "an 18 GB Mac gets a recommendation");
  assert(mac.pick.id === "qwen2.5-coder-14b-q4_k_m", `and it is the 14B at Q4_K_M (${mac.pick.id})`);
  assert(Number(mac.pick.contextTokens) >= 16384, `with a window an agent can work in (${mac.pick.contextTokens})`);
  assert(
    mac.models.find((model) => model.id === "qwen3-coder-30b-a3b-q4_k_m").verdict === "too-big",
    "an 18.6 GB model is marked too big, not 'slower', on 14.3 GB of usable memory",
  );
  assert(
    mac.models.every((model) => model.toolCalling === true),
    "every entry claims tool calling — a coding model that cannot call tools is not a coding model",
  );
  assert(
    mac.models.filter((model) => model.verdict === "recommended").length >= 2,
    "more than one model is offered, so the choice is real",
  );

  const big = catalog.describeCodingModels({ systemRamGb: 64, workingSetGb: 48, llmModelsDir: os.tmpdir() });
  assert(big.pick.id === "qwen3-coder-30b-a3b-q4_k_m", "a 64 GB machine is offered the 30B instead");
  assert(big.pick.id !== mac.pick.id, "the recommendation follows the machine");

  // ── 2. every installable entry is really installable ──────────────────────
  for (const model of mac.models) {
    if (!model.installable) {
      assert(Boolean(model.searchQuery), `${model.id} has no file, so it says how to search for one`);
      continue;
    }
    assert(
      /^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+\.gguf$/.test(model.download.url),
      `${model.id} downloads from a huggingface /resolve/main/ .gguf URL`,
    );
    assert(
      decodeURIComponent(model.download.url).endsWith(`/${model.download.filename}`),
      `${model.id}'s URL ends with the filename the server will store`,
    );
    assert(Number(model.download.sizeGb) > 0, `${model.id} states the size it will download`);
  }

  // ── 3. installed detection ────────────────────────────────────────────────
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), "luke-code-models-"));
  try {
    const fileName = mac.pick.download.filename;
    fs.writeFileSync(path.join(libraryDir, fileName), "not really 9 GB");
    const withFile = catalog.describeCodingModels({ systemRamGb: 18, workingSetGb: 14.3, llmModelsDir: libraryDir });
    assert(
      withFile.models.find((model) => model.id === mac.pick.id).installed === fileName,
      "a model already on disk is reported as installed",
    );
    assert(
      withFile.models.filter((model) => model.installed).length === 1,
      "and only that one",
    );

    // A mirror download counts: the user who grabbed the bartowski file has the
    // model, whatever the catalog's first choice of source was. Checked in a
    // library that holds *only* the mirror, because the primary file wins when
    // both are present (that is the file the catalog recommends downloading).
    const mirrorModel = mac.models.find((model) => model.download?.mirrorFilename && model.id !== mac.pick.id);
    assert(Boolean(mirrorModel), "the catalog names a mirror for at least one model");
    const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), "luke-code-mirror-"));
    try {
      fs.writeFileSync(path.join(mirrorDir, mirrorModel.download.mirrorFilename), "mirror");
      const withMirror = catalog.describeCodingModels({ systemRamGb: 18, workingSetGb: 14.3, llmModelsDir: mirrorDir });
      assert(
        withMirror.models.find((model) => model.id === mirrorModel.id).installed === mirrorModel.download.mirrorFilename,
        "the mirror file counts as the same model",
      );
      assert(
        withMirror.models.filter((model) => model.installed).length === 1,
        "and does not mark anything else installed",
      );
    } finally {
      fs.rmSync(mirrorDir, { recursive: true, force: true });
    }
    const elsewhere = catalog.describeCodingModels({ systemRamGb: 18, workingSetGb: 14.3, llmModelsDir: path.join(libraryDir, "nope") });
    assert(elsewhere.models.every((model) => !model.installed), "a missing directory does not invent installs");
  } finally {
    fs.rmSync(libraryDir, { recursive: true, force: true });
  }

  // ── 4. the server route ───────────────────────────────────────────────────
  assert(serveSource.includes('require("./coding-agent-models.cjs")'), "the server owns the catalog");
  assert(/\/\^\\\/api\\\/coding-models/.test(serveSource), "GET /api/coding-models is routed");
  assert(
    /describeCodingModels\(\{[\s\S]{0,220}?llmModelsDir: LLM_MODELS/.test(serveSource),
    "the route asks the catalog for this machine's library directory",
  );
  assert(/systemRamGb = measured \? requestedRam : os\.totalmem\(\)/.test(serveSource), "the route reads the real amount of memory");
  assert(/memoryCalibration\.workingSetGb\(\)/.test(serveSource), "and the measured working set, not 80% of RAM");

  // ── 5. the tab ────────────────────────────────────────────────────────────
  assert(/export async function getCodingModels\(/.test(apiSource), "api.js exposes getCodingModels");
  assert(/\{ id: "code", label: "Code AI" \}/.test(managerSource), "AI Library has a Code AI section");
  // The top row of tabs is Image / Text / Code / Speech / TTS. Code models are
  // GGUF models, so the tab selects the GGUF runtime *and* the coding catalog
  // rather than inventing a fifth runtime that would have to reimplement
  // download, delete and load.
  assert(/Code Models \(GGUF\)/.test(managerSource), "the top tab row offers Code Models (GGUF)");
  assert(
    /setActiveModelType\("text"\);\s*setTextLibraryMode\("code"\)/.test(managerSource),
    "which selects the GGUF runtime and the coding catalog together",
  );
  assert(
    /setActiveModelType\("text"\);\s*setTextLibraryMode\("text"\)/.test(managerSource),
    "and Text Models (GGUF) goes back to the general library",
  );
  assert(
    /textLibraryMode === "code" && activeModelType === "text" \? "Code Model Library"/.test(managerSource),
    "the heading says Code Model Library while that tab is open",
  );
  assert(
    /Local \{localModelTypeLabel\} Models/.test(managerSource)
      && /const isCodeLibrary = activeModelType === "text" && textLibraryMode === "code"/.test(managerSource),
    "the local-models heading says Code, not Text, while the code tab is open",
  );
  assert(
    /isCodeLibrary \? "Code Model Context Window" : "Text Model Context Window"/.test(managerSource),
    "and the context-window card it shares with Text is relabelled too",
  );
  assert(
    /No code models detected in app\/llm-models\//.test(managerSource),
    "an empty code library says so instead of talking about text models",
  );
  assert(
    /handleUseCodeModelForWork\(\{ id: filename, name: filename, filename \}\)/.test(managerSource),
    "a GGUF already on disk can be made the Work model from its row",
  );
  assert(/className="code-ai-manager"/.test(managerSource), "and renders it");
  assert(
    /await downloadByUrl\(model\.download\.url, model\.download\.filename\)/.test(managerSource),
    "its download goes through the same pipeline as every other text model",
  );
  assert(
    /saveTextProfile\("work", \{ model: filename, contextSize, temperature: 0\.2 \}\)/.test(managerSource)
      && /await activateTextProfile\("work"\)/.test(managerSource),
    "an installed coding model can be handed straight to the Work slot",
  );
  assert(
    /textLibraryMode !== "code"/.test(managerSource),
    "the Hugging Face search does not sit under the Code AI tab",
  );
  assert(/\.code-model-grid\s*\{/.test(cssSource) || /\.code-model-grid\[/.test(cssSource) || cssSource.includes(".code-model-grid"), "the grid has layout");
  assert(cssSource.includes(".compatibility-pill.ready"), "the fit badges have colour");
  assert(
    /Some file|no verified download link/.test(managerSource),
    "an entry without a verified file tells the user to search instead of dead-ending",
  );

  // ── 6. the doc ────────────────────────────────────────────────────────────
  assert(fs.existsSync(docPath), "docs/beta7/code-ai-library-tab.md exists");
  const docSource = fs.readFileSync(docPath, "utf8");
  assert(docSource.includes("/api/coding-models"), "the doc documents the endpoint");
  assert(docSource.includes("18.6 GB") || docSource.includes("too big"), "the doc explains the too-big verdict");

  await liveServerChecks();

  console.log(`\nPASS: ${checks} checks — Code AI offers the coding models this machine can actually run.\n`);
}

main().catch((error) => {
  console.error(`\nFAIL: ${error.message}\n`);
  process.exit(1);
});
