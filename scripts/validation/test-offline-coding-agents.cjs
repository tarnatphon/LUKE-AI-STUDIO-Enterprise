#!/usr/bin/env node
"use strict";

/**
 * An offline coding agent is only as good as two things it cannot see:
 *
 *   1. `--jinja` on llama-server's command line. Without it the `tools` array is
 *      accepted and ignored, so Claude Code and OpenCode answer in prose and
 *      never edit a file. The flag is only safe on a build that lists it in
 *      `--help` (an older build exits on an unknown argument and takes the whole
 *      Text workspace with it), so the probe is tested against real binaries —
 *      one that prints help on stdout, one on stderr, one that prints nothing.
 *
 *   2. the context ceiling. LUKE_LLM_MAX_CONTEXT has to raise both clamps, or the
 *      agent gets a 20000-token window that its own system prompt nearly fills.
 *
 * The rest is `scripts/tools/luke-agent-env.sh`: it is what a user actually
 * runs, so it is driven here against a stand-in LUKE and a stand-in engine over
 * real sockets — env, port, model, opencode, check, and the unreachable case.
 *
 * Then the model picker (app/config/coding-agent-models.json +
 * scripts/tools/luke-coding-models.cjs). The claim worth guarding is arithmetic,
 * not taste: 18.6 GB of weights cannot load on a 14.3 GB Metal budget, and an
 * 18 GB machine should be told to run the 14B, not the 30B a leaderboard likes.
 *
 * Run: node scripts/validation/test-offline-coding-agents.cjs
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const toolCalling = require(path.join(root, "scripts", "server", "llm-tool-calling.cjs"));

const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const scriptPath = path.join(root, "scripts", "tools", "luke-agent-env.sh");
const docPath = path.join(root, "docs", "beta7", "offline-coding-agents.md");
const scriptSource = fs.readFileSync(scriptPath, "utf8");
const docSource = fs.readFileSync(docPath, "utf8");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-agent-test-"));
}

function writeExecutable(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  fs.chmodSync(file, 0o755);
  return file;
}

/** A stand-in LUKE API and a stand-in llama-server, on ephemeral ports. */
async function standUp() {
  const engine = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          object: "list",
          data: [{ id: "qwen3-coder-30b-a3b.gguf", object: "model" }],
        }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          model: parsed.model,
          choices: [{ index: 0, message: { role: "assistant", content: "ready" }, finish_reason: "stop" }],
        }));
        return;
      }
      if (req.url === "/v1/messages") {
        const wantsTool = Array.isArray(parsed.tools) && parsed.tools.length > 0;
        const content = wantsTool
          ? [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "README.md" } }]
          : [{ type: "text", text: "ready" }];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: parsed.model,
          content,
          stop_reason: wantsTool ? "tool_use" : "end_turn",
          usage: { input_tokens: 5, output_tokens: 1 },
        }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
  });

  await new Promise((resolve) => engine.listen(0, "127.0.0.1", resolve));
  const enginePort = engine.address().port;

  const luke = http.createServer((req, res) => {
    if (req.url === "/api/llm/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ready: true,
        running: true,
        port: enginePort,
        settings: {
          model: "qwen3-coder-30b-a3b.gguf",
          contextSize: 16384,
          toolCalling: true,
        },
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });

  await new Promise((resolve) => luke.listen(0, "127.0.0.1", resolve));
  const lukePort = luke.address().port;

  return {
    enginePort,
    lukePort,
    lukeUrl: `http://127.0.0.1:${lukePort}`,
    close: () => new Promise((resolve) => {
      engine.close(() => luke.close(resolve));
    }),
  };
}

/**
 * Runs the helper script asynchronously on purpose. The stand-in servers live in
 * this process, so a spawnSync here would block the event loop and the script's
 * curl would find nothing listening — a failure that looks like a broken script.
 */
function runNodeScript(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...env },
      cwd: root,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function runScript(args, env) {
  return new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function main() {
  console.log("\n=== offline coding agents: --jinja, context ceiling, helper script, docs ===\n");

  // ── 1. the --jinja probe ────────────────────────────────────────────────────
  const dir = scratchDir();
  const stdoutHelp = writeExecutable(dir, "help-stdout.sh", "#!/bin/sh\necho 'usage: llama-server --jinja --ctx-size N'\n");
  const stderrHelp = writeExecutable(dir, "help-stderr.sh", "#!/bin/sh\necho 'usage: llama-server --ctx-size N --jinja' 1>&2\n");
  const noJinja = writeExecutable(dir, "help-old.sh", "#!/bin/sh\necho 'usage: llama-server --ctx-size N --parallel 1'\n");
  const silent = writeExecutable(dir, "help-silent.sh", "#!/bin/sh\nexit 0\n");

  assert(toolCalling.supportsJinja(stdoutHelp) === true, "a build that lists --jinja on stdout is detected");
  assert(toolCalling.supportsJinja(stderrHelp) === true, "a build that lists --jinja on stderr is detected");
  assert(toolCalling.supportsJinja(noJinja) === false, "a build without --jinja is not given the flag");
  assert(toolCalling.supportsJinja(silent) === false, "a build whose help cannot be read is not given the flag");
  assert(toolCalling.supportsJinja(path.join(dir, "missing-binary")) === false, "a missing backend binary does not throw");

  assert(
    JSON.stringify(toolCalling.toolCallingArgs({ binaryPath: stdoutHelp })) === JSON.stringify(["--jinja"]),
    "toolCallingArgs returns --jinja for a supporting build",
  );
  assert(
    JSON.stringify(toolCalling.toolCallingArgs({ binaryPath: noJinja })) === JSON.stringify([]),
    "toolCallingArgs returns nothing for an older build",
  );
  assert(
    JSON.stringify(toolCalling.toolCallingArgs({ binaryPath: stdoutHelp, enabled: false })) === JSON.stringify([]),
    "toolCallingArgs honours enabled:false",
  );

  process.env.LUKE_LLM_NO_JINJA = "1";
  assert(
    JSON.stringify(toolCalling.toolCallingArgs({ binaryPath: stdoutHelp })) === JSON.stringify([]),
    "LUKE_LLM_NO_JINJA=1 is an escape hatch for a model whose template misbehaves",
  );
  delete process.env.LUKE_LLM_NO_JINJA;

  // ── 2. serve.cjs wiring ────────────────────────────────────────────────────
  assert(
    /const \{ toolCallingArgs \} = require\("\.\/llm-tool-calling\.cjs"\);/.test(serveSource),
    "serve.cjs imports the probe from scripts/server/llm-tool-calling.cjs",
  );
  assert(
    /toolCallingArgs\(\{ binaryPath: backend\.path \}\)/.test(serveSource),
    "the probe is asked about the backend that is about to start",
  );
  assert(
    /llmSettings\.toolCalling = toolArgs\.length > 0;/.test(serveSource),
    "the result is reported on /api/llm/status as settings.toolCalling",
  );
  assert(
    !/args\.push\("--jinja"\)/.test(serveSource),
    "serve.cjs never pushes --jinja unconditionally",
  );

  // ── 3. the context ceiling ─────────────────────────────────────────────────
  assert(
    /const LLM_CONTEXT_CEILING = \(\(\) => \{[\s\S]{0,400}?return 20000;/.test(serveSource),
    "the context ceiling still defaults to 20000 tokens",
  );
  assert(
    /requested < 512\) return 20000/.test(serveSource),
    "a nonsense LUKE_LLM_MAX_CONTEXT falls back to the default instead of breaking the load",
  );
  assert(
    (serveSource.match(/Math\.min\(LLM_CONTEXT_CEILING/g) || []).length >= 2,
    "both context clamps honour the ceiling (planned load and saved settings)",
  );
  assert(
    !/Math\.min\(20000,/.test(serveSource),
    "no hard-coded 20000 clamp is left behind",
  );

  // ── 4. the helper script, against a stand-in LUKE ──────────────────────────
  if (process.platform === "win32") {
    console.log("  · helper script checks skipped on Windows (bash only)");
  } else {
    const stand = await standUp();
    try {
      const port = await runScript(["port"], { LUKE_URL: stand.lukeUrl });
      assert(port.status === 0, "`port` exits 0 while LUKE is running");
      assert(port.stdout.trim() === String(stand.enginePort), "`port` reads the live engine port instead of assuming 10086");

      const model = await runScript(["model"], { LUKE_URL: stand.lukeUrl });
      assert(model.status === 0 && model.stdout.trim() === "qwen3-coder-30b-a3b.gguf", "`model` reads the id the engine actually serves");

      const env = await runScript(["env"], { LUKE_URL: stand.lukeUrl });
      assert(env.status === 0, "`env` exits 0");
      assert(
        env.stdout.includes(`export ANTHROPIC_BASE_URL="http://127.0.0.1:${stand.enginePort}"`),
        "`env` points Claude Code at the engine, with no /v1 suffix",
      );
      assert(
        /export ANTHROPIC_BASE_URL="[^"]*"$/m.test(env.stdout) && !/ANTHROPIC_BASE_URL="[^"]*\/v1"/.test(env.stdout),
        "ANTHROPIC_BASE_URL carries no /v1 suffix (Claude Code appends /v1/messages)",
      );
      assert(env.stdout.includes('export ANTHROPIC_API_KEY=""'), "ANTHROPIC_API_KEY is cleared so it cannot win over the token");
      assert(env.stdout.includes("export ANTHROPIC_AUTH_TOKEN="), "ANTHROPIC_AUTH_TOKEN is set");
      assert(env.stdout.includes("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"), "`env` turns off Claude Code's non-essential traffic");
      assert(env.stdout.includes("API_TIMEOUT_MS="), "`env` raises the request timeout for a local model");
      assert(env.stdout.includes(`export LUKE_CONTEXT_TOKENS="${16384}"`), "`env` reports the live context window");
      assert(env.stdout.includes("export CLAUDE_CODE_ATTRIBUTION_HEADER=0"), "`env` turns off the header the local-Claude-Code guides blame for the slowdown");
      assert(env.stdout.includes('export CLAUDE_CODE_MAX_CONTEXT_TOKENS="16384"'), "`env` tells Claude Code the window the server actually allocated");
      assert(env.stdout.includes("export ANTHROPIC_MODEL="), "`env` names the model explicitly");
      assert(env.stdout.includes("export CLAUDE_CODE_SUBAGENT_MODEL="), "`env` pins subagents to the same local model");
      assert(!/CLAUDE_CODE_AUTO_COMPACT_WINDOW="/.test(env.stdout), "a 16K window does not get a 100k compaction window");

      const target = scratchDir();
      const opencode = await runScript(["opencode", target], { LUKE_URL: stand.lukeUrl });
      assert(opencode.status === 0, "`opencode` exits 0");
      const configPath = path.join(target, "opencode.json");
      assert(fs.existsSync(configPath), "`opencode` writes opencode.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      assert(
        config.provider.luke.options.baseURL === `http://127.0.0.1:${stand.enginePort}/v1`,
        "opencode.json points at the engine's OpenAI-compatible /v1 prefix",
      );
      assert(config.provider.luke.npm === "@ai-sdk/openai-compatible", "opencode.json uses the OpenAI-compatible adapter");
      assert(
        Object.keys(config.provider.luke.models)[0] === "qwen3-coder-30b-a3b.gguf",
        "the model key is exactly the id GET /v1/models reports",
      );
      assert(
        config.model === "luke/qwen3-coder-30b-a3b.gguf",
        "the default model matches provider id + model key",
      );
      assert(config.provider.luke.models["qwen3-coder-30b-a3b.gguf"].limit.context === 16384, "the context limit comes from LUKE, not a guess");

      const before = fs.readFileSync(configPath, "utf8");
      const again = await runScript(["opencode", target], { LUKE_URL: stand.lukeUrl });
      assert(again.status !== 0, "`opencode` refuses to overwrite a project config");
      assert(fs.readFileSync(configPath, "utf8") === before, "the refused overwrite left the file untouched");

      const check = await runScript(["check"], { LUKE_URL: stand.lukeUrl });
      assert(check.status === 0, "`check` exits 0 when every route answers");
      const okLines = (check.stderr + check.stdout).match(/ok/g) || [];
      assert(okLines.length >= 5, "`check` reports the five routes (API, engine, OpenAI, Anthropic, tools)");
      assert(/Anthropic\s+POST \/v1\/messages\s+ok/.test(check.stdout), "`check` proves the Anthropic route Claude Code needs");
      assert(/Tool calling\s+tools\[\] in \/v1\/messages\s+ok/.test(check.stdout), "`check` proves a tool call actually comes back");
    } finally {
      await stand.close();
    }

    // nothing listening anywhere → a clear message, not an empty export block
    const deadPort = await (async () => {
      const server = http.createServer();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const p = server.address().port;
      await new Promise((resolve) => server.close(resolve));
      return p;
    })();
    // A wider window flips the auto-compaction branch: Claude Code must compact
    // below what the server allocated, never above it.
    const wideStatus = http.createServer((req, res) => {
      if (req.url === "/api/llm/status") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ready: true,
          port: stand.enginePort,
          settings: { model: "qwen2.5-coder-30b-a3b.gguf", contextSize: 65536, toolCalling: true },
        }));
        return;
      }
      res.writeHead(404); res.end("{}");
    });
    await new Promise((resolve) => wideStatus.listen(0, "127.0.0.1", resolve));
    try {
      const wide = await runScript(["env"], { LUKE_URL: `http://127.0.0.1:${wideStatus.address().port}` });
      assert(wide.status === 0, "`env` works with a wide window");
      assert(/CLAUDE_CODE_AUTO_COMPACT_WINDOW="49152"/.test(wide.stdout), "a 64K window compacts at 75% of it, not at 200k");
    } finally {
      await new Promise((resolve) => wideStatus.close(resolve));
    }

    // Nothing on LUKE_URL and nothing on the default engine port: the helper has
    // to refuse rather than print an export block pointing at port 0.
    const dead = await runScript(["env"], { LUKE_URL: `http://127.0.0.1:${deadPort}` });
    assert(dead.status !== 0, "`env` fails loudly when LUKE is not running");
    assert(dead.stdout.trim() === "", "`env` prints no export block when it cannot find an engine");
    assert(/not answering|Start LUKE|no answer/i.test(dead.stderr), "the failure says what to start");

    // An explicit port is trusted, which is the documented way to skip discovery.
    const forced = await runScript(["port"], {
      LUKE_URL: `http://127.0.0.1:${deadPort}`,
      LUKE_LLM_PORT: "28142",
    });
    assert(forced.status === 0 && forced.stdout.trim() === "28142", "LUKE_LLM_PORT skips discovery when the port is known");

    assert(scriptSource.includes("LUKE_LLM_NO_JINJA") === false, "the helper does not pretend to disable the flag");
    assert(scriptSource.includes("LUKE_LLM_PORT"), "the helper can skip port discovery when asked");
  }

  // ── 5. the model catalog: does the arithmetic agree with the advice? ───────
  const modelCatalog = require(path.join(root, "scripts", "server", "coding-agent-models.cjs"));
  const catalog = modelCatalog.getCatalog();
  const setupLlamaSource = fs.readFileSync(path.join(root, "scripts", "setup", "setup-llama.sh"), "utf8");

  assert(
    setupLlamaSource.includes(`\${LLAMA_RELEASE:-${catalog.backend.pinnedRelease}}`),
    "the catalog's pinned llama.cpp release is the one setup-llama.sh installs",
  );
  assert(
    catalog.models.every((model) => model.toolCalling === true),
    "every catalog entry is tool-capable (a model without tools cannot drive an agent)",
  );
  assert(
    catalog.models.every((model) => model.license && Number(model.weightGb) > 0),
    "every catalog entry states its licence and its real file size",
  );

  // 18 GB Mac: 14.3 GB working set is the budget (Metal), not the 18 GB of RAM.
  const small = modelCatalog.recommendFor({ profileId: "mac-18" });
  assert(small.machine.workingSetGb === 14.3, "the mac-18 profile uses the 14.3 GB Metal working set");
  assert(small.pick && small.pick.id === "qwen2.5-coder-14b-q4_k_m", "an 18 GB Mac is told to run the 14B, not a leaderboard 30B");
  assert(
    small.models.filter((model) => model.verdict === "recommended").length >= 3,
    "the 18 GB machine has more than one workable option, not a single forced choice",
  );

  const heavy = small.models.find((model) => model.id === "qwen3-coder-30b-a3b-q4_k_m");
  assert(heavy.verdict === "too-big", "the 30B at Q4 (18.6 GB) is refused on an 18 GB machine");
  assert(heavy.contextTokens === 0, "a model that cannot load is not given a context budget");
  assert(heavy.weightGb > small.machine.workingSetGb, "the refusal is arithmetic: weights exceed the working set");

  // A bigger machine gets the bigger model instead of the same safe answer.
  const big = modelCatalog.recommendFor({ systemRamGb: 64, workingSetGb: 48 });
  assert(big.pick && big.pick.id === "qwen3-coder-30b-a3b-q4_k_m", "a 48 GB budget is told to run the 30B at Q4");

  // KV cache is computed, not copied from a vendor table.
  const kv = modelCatalog.kvGbPer4096({ layers: 48, kvHeads: 8, headDim: 128 });
  assert(Math.abs(kv - 0.375) < 0.01, "GQA KV is layers x KV heads x head dim x 2 bytes per token");
  assert(modelCatalog.kvGbPer4096({ mlaKvGbPer4096: 0.105 }) === 0.105, "an MLA model uses its own stated KV figure");

  // No measured working set: fall back to ~80% of RAM, and say it is an estimate.
  const detected = modelCatalog.recommendFor({ systemRamGb: 18 });
  assert(Math.abs(detected.machine.workingSetGb - 14.4) < 0.01, "without a measurement the working set falls back to 80% of RAM");
  assert(detected.machine.source === "estimated", "the fallback is labelled as an estimate, not a measurement");

  // A broken catalog must fail loudly instead of recommending nothing.
  let rejected = false;
  try {
    modelCatalog.validateCatalog({ models: [{ id: "no-fields" }], machineProfiles: [] });
  } catch (_) {
    rejected = true;
  }
  assert(rejected, "an incomplete catalog entry is rejected");

  if (process.platform !== "win32") {
    const cli = await runNodeScript(["scripts/tools/luke-coding-models.cjs", "--profile", "mac-18"]);
    assert(cli.status === 0, "the model picker exits 0");
    assert(/Qwen2\.5-Coder 14B/.test(cli.stdout), "the picker names the recommended model");
    assert(/too big/.test(cli.stdout), "the picker shows what does not fit instead of hiding it");
    assert(/Context = 20000/.test(cli.stdout), "the picker says which context to set explicitly");

    const cliJson = await runNodeScript(["scripts/tools/luke-coding-models.cjs", "--profile", "mac-18", "--json"]);
    assert(cliJson.status === 0, "the picker can answer in JSON");
    const parsed = JSON.parse(cliJson.stdout);
    assert(parsed.pick && parsed.pick.id === "qwen2.5-coder-14b-q4_k_m", "the JSON pick matches the catalog ranking");
    assert(parsed.models.length === catalog.models.length, "the JSON lists every catalog model");
  }

  // ── 6. the document says the things that are easy to get wrong ─────────────
  assert(docSource.includes("no `/v1` suffix"), "the doc warns that ANTHROPIC_BASE_URL has no /v1 suffix");
  assert(docSource.includes("--jinja"), "the doc explains the one flag that makes tools work");
  assert(docSource.includes("LUKE_LLM_MAX_CONTEXT"), "the doc explains how to raise the context ceiling");
  assert(docSource.includes("/v1/messages"), "the doc names the Anthropic route");
  assert(docSource.includes("opencode.json"), "the doc shows the OpenCode config file");
  assert(
    /503/.test(docSource) && /gateway is not the offline path/i.test(docSource),
    "the doc says the 1420 gateway is not the offline path",
  );
  assert(docSource.includes("luke-agent-env.sh check"), "the doc points at the check command");
  assert(/Troubleshooting/.test(docSource), "the doc has a troubleshooting table");
  assert(docSource.includes("luke-coding-models.cjs"), "the doc points at the model picker");
  assert(docSource.includes("14.3 GB"), "the doc uses the real Metal working set, not total RAM");
  assert(docSource.includes("18.6 GB"), "the doc names the size that disqualifies the 30B at Q4 on 18 GB");
  assert(/Qwen2\.5-Coder-14B/.test(docSource), "the doc names the model it recommends for this machine");

  console.log(`\nPASS: ${checks} checks — offline coding agents are wired, documented and scripted.\n`);
}

main().catch((error) => {
  console.error(`\nFAIL: ${error.message}\n`);
  process.exit(1);
});
