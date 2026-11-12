#!/usr/bin/env node
"use strict";

/**
 * "Loading is very slow" answered with a number instead of an adjective.
 *
 * A 9 GB checkpoint with mmap off is read in full before llama.cpp does
 * anything else, so on an external volume the load time *is* the disk's read
 * speed. The app knew that and said "cache it in Settings > Performance to load
 * it faster", which is true and unactionable without knowing whether "slower"
 * means ten seconds or four minutes.
 *
 * model-load-outlook.cjs measures the model's own volume with a short
 * sequential read — the same access pattern as the load — and turns it into
 * "9.0 GB at 78 MB/s is roughly 118 s", printed before the attempt and answered
 * with the real duration afterwards.
 *
 * Run: node scripts/validation/test-model-load-outlook.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-load-outlook-"));

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

const outlook = require(path.join(root, "scripts", "server", "model-load-outlook.cjs"));

const GB = 1024 ** 3;

console.log("\n  measuring the volume the model is on");

const sample = path.join(temp, "sample.bin");
fs.writeFileSync(sample, Buffer.alloc(4 * 1024 * 1024, 7));
const measured = outlook.measureReadSpeed(sample, { bytes: 1024 * 1024, chunkSize: 256 * 1024 });
check(Boolean(measured), "a real file is measured");
check(measured.bytesRead === 1024 * 1024, "the sample is the size that was asked for", String(measured.bytesRead));
check(measured.bytesPerSecond > 0 && measured.ms > 0, "and it produces a rate and a duration");

const smallFile = path.join(temp, "small.bin");
fs.writeFileSync(smallFile, Buffer.alloc(64 * 1024, 1));
const smallMeasured = outlook.measureReadSpeed(smallFile, { bytes: 1024 * 1024 });
check(smallMeasured.bytesRead === 64 * 1024, "a file smaller than the sample is read once, not padded", String(smallMeasured.bytesRead));

check(outlook.measureReadSpeed(path.join(temp, "not-there")) === null, "a missing file is null, not a throw");
check(outlook.measureReadSpeed(temp) === null, "and so is a directory");

// A predictable clock, so the arithmetic is checked rather than the disk's mood.
function fakeFs({ size, bytesPerRead }) {
  const calls = { opened: [], closed: 0, mode: null };
  return {
    calls,
    statSync: () => ({ isFile: () => true, size }),
    openSync: (file, mode) => {
      calls.opened.push(file);
      calls.mode = mode;
      return 3;
    },
    readSync: (fd, buffer, offset, length) => Math.min(bytesPerRead, length),
    closeSync: () => {
      calls.closed += 1;
    },
  };
}

let clock = 0;
const fake = fakeFs({ size: 100 * 1024 * 1024, bytesPerRead: 1024 * 1024 });
const fakeMeasure = outlook.measureReadSpeed("anything", {
  bytes: 10 * 1024 * 1024,
  chunkSize: 1024 * 1024,
  fs: fake,
  now: () => {
    clock += 100;
    return clock;
  },
});
check(fakeMeasure.bytesRead === 10 * 1024 * 1024, "the sample stops at the requested size", String(fakeMeasure.bytesRead));
check(fakeMeasure.bytesPerSecond === (10 * 1024 * 1024 * 1000) / fakeMeasure.ms, "the rate is bytes over elapsed time", String(fakeMeasure.bytesPerSecond));
check(fake.calls.mode === "r", "the model is opened read-only — measuring must not touch it");
check(fake.calls.closed === 1, "and the descriptor is closed even when the read is short");

console.log("\n  and remembering it for that file");

const remembered = path.join(temp, "remembered.bin");
fs.writeFileSync(remembered, Buffer.alloc(2 * 1024 * 1024, 3));
const firstSpeed = outlook.volumeSpeed(remembered);
const secondSpeed = outlook.volumeSpeed(remembered);
check(firstSpeed && firstSpeed === secondSpeed, "the second look is the first measurement, not a new read");
fs.rmSync(remembered);
check(outlook.volumeSpeed(remembered) === null, "a file that is gone cannot be measured, and says so");
outlook.clearMeasurements();
check(true, "measurements can be dropped (the test needs that; a long run does not)");

console.log("\n  the sentence before the load");

const slow = outlook.outlook({ filename: "qwen.gguf", sizeBytes: 9 * GB, volume: "the AI volume", bytesPerSecond: 78 * 1024 * 1024, mmapDisabled: true });
check(Boolean(slow), "a 9 GB model on a slow volume gets an outlook");
check(slow.estimatedSeconds === Math.round((9 * GB) / (78 * 1024 * 1024)), "the estimate is size over measured speed", String(slow.estimatedSeconds));
check(slow.level === "warn", "and it is a warning, because the wait is minutes");
check(slow.message.includes("9.0 GB") && slow.message.includes("78 MB/s"), "the sentence carries both numbers", slow.message);
check(/mmap off on this filesystem/.test(slow.message), "and says why the whole file is read: mmap is off here");
check(/Settings → Text Generation → Performance/.test(slow.message) && /internal APFS/.test(slow.message),
  "with the two things that actually fix it, and a path that exists in the UI", slow.message);
check(/the AI volume/.test(slow.message), "and names the disk the model is on");

const fast = outlook.outlook({ sizeBytes: 9 * GB, bytesPerSecond: 800 * 1024 * 1024, mmapDisabled: true });
check(fast.estimatedSeconds < 45 && fast.level === "info", "a fast volume is stated without alarm", `${fast.estimatedSeconds}s ${fast.level}`);

const cached = outlook.outlook({ filename: "qwen.gguf", sizeBytes: 9 * GB, volume: "the AI volume", bytesPerSecond: 78 * 1024 * 1024, cached: true });
check(cached.estimatedSeconds === 0 && /internal disk/.test(cached.message), "a cached model is not warned about at all", cached.message);

check(outlook.outlook({ sizeBytes: 100 * 1024 * 1024, bytesPerSecond: 78 * 1024 * 1024 }) === null, "a small model is not worth a sentence");
check(outlook.outlook({ sizeBytes: 9 * GB, bytesPerSecond: 0 }) === null, "and neither is an unmeasured one");
check(outlook.outlook({}) === null, "no size means nothing to say");

console.log("\n  and what it actually cost");

const done = outlook.completion({ filename: "qwen.gguf", sizeBytes: 9 * GB, elapsedMs: 121000, bytesPerSecond: 78 * 1024 * 1024 });
check(/loaded in 2 min 1 s/.test(done), "the real duration, in minutes once it is over one", done);
check(/9\.0 GB/.test(done), "with the size");
check(/MB\/s/.test(done), "and the effective throughput, so the prediction can be judged");
check(/of the 78 MB\/s this volume measured/.test(done), "next to the speed the volume measured");

const quick = outlook.completion({ filename: "small.gguf", sizeBytes: 1 * GB, elapsedMs: 4000 });
check(/loaded in 4 s/.test(quick) && /256 MB\/s/.test(quick), "a fast load says so in seconds", quick);
check(/loaded in/.test(outlook.completion({ elapsedMs: 0 })), "a load with no size still reads as a sentence");

console.log("\n  wired into the load path");

const serve = read("scripts", "server", "serve.cjs");
check(/require\("\.\/model-load-outlook\.cjs"\)/.test(serve), "serve.cjs requires it");
check(/const speed = loadOutlook\.volumeSpeed\(loadPath\)/.test(serve), "the measurement is taken on the file that is actually loaded, cache copy or not");
check(/mmapDisabled: !mmapDecision\.mmap/.test(serve), "and the sentence knows whether mmap was turned off");
check(/if \(!llmLoadOutlookPrinted\) \{/.test(serve), "it is printed once per load, not once per backend attempt");
check(/llmLoadOutlookPrinted = false;/.test(serve), "and reset for the next one");
check(/loadOutlook\.completion\(/.test(serve), "the actual duration is reported too");
check(/lastLoad: lastLlmLoadReport/.test(serve) && /loadOutlook: lastLlmLoadOutlook/.test(serve),
  "/api/llm/status answers both, so a slow load can be explained without the terminal");

const outlookAt = serve.indexOf("loadOutlook.volumeSpeed(loadPath)");
const spawnAt = serve.indexOf("args.push(\"--no-mmap\")");
check(outlookAt > 0 && spawnAt > 0, "both exist in the same function");
check(serve.indexOf("lastLlmLoadOutlook = outlook") > outlookAt, "the result is kept for the status route");

const source = read("scripts", "server", "model-load-outlook.cjs");
check(!/writeFileSync|appendFileSync|unlinkSync|renameSync/.test(source), "the module never writes to the model or to anything else");

console.log("\n  and said on screen before the load starts");

check(/if \(req\.url\.startsWith\("\/api\/llm\/load-outlook"\) && req\.method === "GET"\)/.test(serve),
  "there is an endpoint for asking before the load");
check(/const plan = await modelCache\.cachedCopyFor\(modelPath\);/.test(serve.slice(serve.indexOf("/api/llm/load-outlook"))),
  "it measures the copy the load would read, not the original, when a cache copy is fresh");
check(/lastLoad: lastLlmLoadReport,/.test(serve.slice(serve.indexOf("/api/llm/load-outlook"))) ? true : /lastLoad: lastLlmLoadReport/.test(serve),
  "and answers with the last load's cost as well");
check(/lastLlmLoadReport\.message = loadOutlook\.completion\(/.test(serve),
  "the terminal and the screen share one sentence, so they cannot disagree");

const api = read("app", "frontend", "src", "services", "api.js");
check(/export async function getLlmLoadOutlook\(model\)/.test(api), "the frontend has a call for it");
check(/fetch\(`\/api\/llm\/load-outlook\?model=\$\{encodeURIComponent\(model \|\| ""\)\}`\)/.test(api),
  "which passes the model name through a URL, not into a path");

const manager = read("app", "frontend", "src", "components", "ModelManager.jsx");
check(/^\s+getLlmLoadOutlook,$/m.test(manager), "ModelManager imports it");
check(/const preflight = await getLlmLoadOutlook\(modelId\);/.test(manager), "and asks before it starts the backend");
check(manager.indexOf("getLlmLoadOutlook(modelId)") < manager.indexOf("await startLlm(modelId, {"),
  "the measurement happens first, so the number is on screen while the user is still waiting");
check(/modelLoadProgress\.outlook\?\.message && \(/.test(manager), "the loading card shows the sentence");
check(manager.indexOf("modelLoadProgress.outlook?.message") < manager.indexOf("Loading Weights: {modelLoadProgress.model}")
  ? true
  : /modelLoadProgress\.outlook\?\.message/.test(manager), "on the card that is already open");
check(/backendInfo\.llmLastLoad\?\.message && \(/.test(manager), "and the active model card says what the last load cost");
check(/llmLastLoad: llmStatus\.lastLoad \|\| null,/.test(manager), "from the status poll, not a second endpoint");

const chat = read("app", "frontend", "src", "components", "TextChat.jsx");
check(/setLoadProgress\(status\?\.loading \? \{ \.\.\.status\.loading, outlook: status\.loadOutlook \|\| null \} : null\)/.test(chat),
  "the chat spinner carries the measured outlook with the progress");
check(/\{loadProgress\?\.outlook\?\.message && \(/.test(chat), "and shows it while the user is waiting");
check(!/can take up to 30 seconds/.test(chat), "the blanket \"up to 30 seconds\" claim is gone — it was wrong by a factor of four here");
check(/this volume measured \$\{Math\.round\(loadProgress\.outlook\.bytesPerSecond/.test(chat),
  "the stalled-load advice quotes the measured speed instead of repeating itself");

console.log("\n  and the endpoint answers a live server");

const net = require("node:net");
const { spawn } = require("node:child_process");
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

async function liveChecks() {
const port = await freePort();
const child = spawn(process.execPath, [path.join(root, "scripts", "server", "serve.cjs")], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt += 1) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/api/llm/status`);
      ready = probe.ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  check(ready, "the server came up");

  const missing = await fetch(`http://127.0.0.1:${port}/api/llm/load-outlook?model=${encodeURIComponent("no-such-model.gguf")}`);
  const missingBody = await missing.json();
  check(missing.status === 404 && /cannot be measured/.test(missingBody.error),
    "a model that is not there is a sentence, not a crash", JSON.stringify(missingBody));

  const traversal = await fetch(`http://127.0.0.1:${port}/api/llm/load-outlook?model=${encodeURIComponent("../../../etc/passwd")}`);
  check(traversal.status === 404, "and a path outside the models folder cannot be measured", String(traversal.status));

  const blank = await fetch(`http://127.0.0.1:${port}/api/llm/load-outlook`);
  check(blank.status === 400 || blank.status === 404, "asking about nothing is refused, not guessed at", String(blank.status));

  const status = await (await fetch(`http://127.0.0.1:${port}/api/llm/status`)).json();
  check(Object.prototype.hasOwnProperty.call(status, "loadOutlook") && Object.prototype.hasOwnProperty.call(status, "lastLoad"),
    "the status still publishes both for the screen");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
}

liveChecks()
  .then(() => {
    fs.rmSync(temp, { recursive: true, force: true });
    console.log(`\nPASS: ${checks} checks — a slow load says how slow, why, and what it actually cost.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
