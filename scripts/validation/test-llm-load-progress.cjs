"use strict";

/**
 * A model load that says what it is doing.
 *
 * Loading tries every llama.cpp backend with two profiles each, and one
 * attempt on the CPU backend is allowed six minutes. Four attempts is twenty-
 * four minutes of a spinner saying "Loading Text Model" — which is what "it
 * will not load" looked like, when in fact it was trying the fourth thing.
 *
 * So the attempt is reported: which backend, which profile, which attempt of
 * how many, how long it has been going, and the last thing llama.cpp printed.
 * And the whole load is given a budget, so a run that cannot succeed ends with
 * a list of what was tried instead of another six minutes of silence.
 *
 * Run: node scripts/validation/test-llm-load-progress.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const chatFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/work/environment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return { port, child };
    } catch {
      await delay(250);
    }
  }
  child.kill("SIGKILL");
  throw new Error("The server never answered.");
}

async function main() {
  const server = fs.readFileSync(serverFile, "utf8");
  const chat = fs.readFileSync(chatFile, "utf8");

  section("1. The load keeps track of itself");
  check("there is one place the progress is kept", /let llmLoadProgress = null;/.test(server));
  check("a load begins by recording what it intends to try", /function beginLlmLoadProgress\(model, attempts\)/.test(server));
  check("each attempt is recorded before it starts", /function noteLlmLoadAttempt\(\{ backend, binary, profile \}\)/.test(server));
  check("and counts up", /llmLoadProgress\.attempt \+= 1;/.test(server));
  check("the backend's own output is kept, not thrown away", /function noteLlmLoadOutput\(output\)/.test(server));
  check("only the tail is kept — a model prints megabytes", /`\$\{llmLoadProgress\.tail\}\$\{output\}`\.slice\(-800\)/.test(server));
  check("output says the load is moving", /llmLoadProgress\.stage = "loading";/.test(server) && /llmLoadProgress\.lastOutputAt = Date\.now\(\);/.test(server));

  section("2. Every attempt is reported");
  check("the number of attempts is worked out up front",
    /const totalAttempts = sortedCandidates\.reduce\(/.test(server), "the loop must know how many attempts there are");
  check("it counts the profiles each backend gets",
    /sum \+ buildLlmLoadProfiles\(settings, candidate\)\.length/.test(server));
  check("each attempt is announced before it runs", /noteLlmLoadAttempt\(\{ backend: backend\.mode, binary: path\.basename\(backend\.path\), profile: profile\.name \}\);/.test(server));
  check("stderr is tapped", /noteLlmLoadOutput\(output\);/.test(server));
  check("stdout is tapped too", /noteLlmLoadOutput\(data\.toString\(\)\);/.test(server));
  check("the report names the backend, the profile and the attempt",
    /backend: llmLoadProgress\.backend,/.test(server) && /profile: llmLoadProgress\.profile,/.test(server) && /attempt: llmLoadProgress\.attempt,/.test(server));
  check("it says how long the load has been going", /elapsedMs: now - llmLoadProgress\.startedAt,/.test(server));
  check("and how long llama.cpp has been quiet", /silentForMs: now - llmLoadProgress\.lastOutputAt,/.test(server));
  check("the last line it printed comes back with it", /lastLine: lines\[lines\.length - 1\] \|\| "",/.test(server));

  section("3. The load has a budget");
  check("there is one", /const LLM_LOAD_BUDGET_MS = 20 \* 60 \* 1000;/.test(server));
  check("the deadline is set when the load begins", /deadline: now \+ LLM_LOAD_BUDGET_MS,/.test(server));
  check("an attempt past the budget is not started",
    /if \(llmLoadProgress && Date\.now\(\) > llmLoadProgress\.deadline\) \{/.test(server));
  check("and is recorded as one that was never tried", /not tried — the load budget of/.test(server));
  check("the screen is told how much time is left", /remainingMs: Math\.max\(0, llmLoadProgress\.deadline - now\),/.test(server));
  check("the progress is cleared whatever happens", /\} finally \{\s*\n\s*llmLoadProgress = null;\s*\n\s*\}/.test(server));

  section("4. The status carries it to the screen");
  const { port, child } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/llm/status`);
    const data = await response.json();
    check("the status has a loading field", Object.prototype.hasOwnProperty.call(data, "loading"), Object.keys(data).join(", "));
    check("and it is empty when nothing is loading", data.loading === null, JSON.stringify(data.loading));
    check("loading is published on the status endpoint", /loading: describeLlmLoad\(\),/.test(server));
  } finally {
    child.kill("SIGTERM");
  }

  section("5. The screen asks, and shows the answer");
  check("the spinner polls while a model is loading", /if \(!loadingModel\) \{\s*\n\s*setLoadProgress\(null\);/.test(chat));
  check("it asks the backend, not a guess", /const status = await getLlmStatus\(\);/.test(chat));
  check("it stops asking when the model is loaded", /window\.clearInterval\(timer\);/.test(chat));
  check("the poll is not a race", /let active = true;/.test(chat) && /return \(\) => \{\s*\n\s*active = false;/.test(chat));
  check("it says which backend and which attempt",
    /Trying \$\{loadProgress\.backend \|\| "backend"\} \(\$\{loadProgress\.profile\}\) — attempt \$\{loadProgress\.attempt\} of \$\{loadProgress\.attempts\}/.test(chat));
  check("it says how long it has been going", /formatLoadDuration\(loadProgress\.elapsedMs\)/.test(chat));
  check("it shows the last thing llama.cpp printed", /\{loadProgress\?\.lastLine && \(/.test(chat));
  check("and says when llama.cpp has gone quiet", /loadProgress\.silentForMs > 60000/.test(chat));
  check("the quiet message explains the external disk, because that is usually why", /external disk is slow the first time/.test(chat));
  check("durations read in minutes, not just seconds", /return minutes > 0 \? `\$\{minutes\}m \$\{String\(seconds\)\.padStart\(2, "0"\)\}s` : `\$\{seconds\}s`;/.test(chat));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
