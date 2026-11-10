"use strict";

/**
 * The failure message has to name the cause, not the sign-off.
 *
 * Reported from a real machine:
 *
 *     Model Load Failed
 *     Text model failed on all available llama.cpp backends. Last failure:
 *     0.00.457.536 E srv  llama_server: exiting due to model loading error
 *
 * That is llama.cpp's last line. The line that said *why* was printed first,
 * matched /error/, stored, and then overwritten by every later match — so the
 * one sentence the user needed was the one thrown away.
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const { appendErrorLines, errorLinesFrom, explainFailure, DEFAULT_LIMIT } = require("../../scripts/server/llm-error-log.cjs");

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// A real failing load, in the order llama.cpp prints it.
const TRANSCRIPT = [
  "llama_model_loader: loaded meta data with 40 key-value pairs and 291 tensors from /Volumes/ai/app/llm-models/demo.gguf (version GGUF V3 (latest))",
  "llama_model_loader: Dumping metadata keys/values. Note: KV overrides do not apply in this output.",
  "llama_model_loader: - kv   0:                       general.architecture str              = qwen3vl",
  "print_info: file type  = Q4_K - Medium",
  "error loading model: unknown model architecture: 'qwen3vl'",
  "llama_load_model_from_file: failed to load model",
  "srv    load_model: failed to load model, ''",
  "srv    operator(): 0.00.457.536 E srv  llama_server: exiting due to model loading error",
];

// ── what counts as worth quoting ─────────────────────────────────────────────
const fromAll = errorLinesFrom(TRANSCRIPT.join("\n"));
check("the cause is picked out", fromAll.includes("error loading model: unknown model architecture: 'qwen3vl'"), fromAll.join(" | "));
check("chatter about key-value pairs is not", !fromAll.some((line) => line.includes("Dumping metadata")), fromAll.join(" | "));
check("a reassurance is not an error", errorLinesFrom("main: server is listening on port 10086 (no error)").length === 0);
check("an empty chunk yields nothing", errorLinesFrom("").length === 0 && errorLinesFrom(null).length === 0);

// ── arriving in pieces, as stderr actually does ──────────────────────────────
let kept = [];
const chunks = [];
for (let index = 0; index < TRANSCRIPT.length; index += 1) {
  // Split mid-line too: a chunk boundary is not a line boundary.
  chunks.push(`${TRANSCRIPT[index].slice(0, 30)}${TRANSCRIPT[index].slice(30)}\n`);
}
for (const chunk of chunks) kept = appendErrorLines(kept, chunk);
const message = kept.join("\n");
check("the cause survives every later chunk", message.startsWith("error loading model: unknown model architecture"), message.split("\n")[0]);
check("the sign-off is still there, after it", message.trimEnd().endsWith("exiting due to model loading error"), message.split("\n").slice(-1)[0]);
check("and the cause comes first, where a reader looks", message.indexOf("unknown model architecture") < message.indexOf("exiting due to model loading error"));

// The old behaviour, kept as the counter-example: one overwritten chunk.
let theOldWay = null;
for (const chunk of chunks) {
  if (/error|failed/i.test(chunk) && !/no error/i.test(chunk)) theOldWay = chunk.trim().slice(-1200);
}
check("the way it used to be kept was the sign-off alone", !theOldWay.includes("unknown model architecture"), theOldWay);
check("which is exactly the message that was reported", /exiting due to model loading error/.test(theOldWay) && !/architecture/.test(theOldWay));

// ── repeats and size ────────────────────────────────────────────────────────
const once = appendErrorLines([], "error loading model: bad magic\n");
const twice = appendErrorLines(once, "error loading model: bad magic\n");
check("a repeated line is not repeated", twice.length === once.length, twice.join(" | "));

const flood = appendErrorLines([], Array.from({ length: 500 }, (_, index) => `error number ${index} happened`).join("\n"));
check("a flood of errors is bounded", flood.join("\n").length <= DEFAULT_LIMIT, String(flood.join("\n").length));
check("and keeps the earliest ones", flood[0] === "error number 0 happened", flood[0]);

const huge = appendErrorLines([], `error loading model: ${"x".repeat(9000)}`);
check("one monstrous line is cut, not dropped", huge.length === 1 && huge[0].length <= DEFAULT_LIMIT, String(huge[0]?.length));

// ── the cause carries a remedy ──────────────────────────────────────────────
const arch = explainFailure(message);
check("an unknown architecture is explained", /older than the model/.test(arch) && /setup-llama\.sh/.test(arch), arch);
check("and names the architecture it choked on", /'qwen3vl'/.test(arch), arch);
check("a truncated file is told to download again",
  /truncated or not a GGUF/.test(explainFailure("llama_model_loader: bad magic")));
const tensor = explainFailure("0.00.290.802 E llama_model_load: error loading model: missing tensor 'blk.32.attn_norm.weight'");
check("a missing tensor is called a broken file, not a memory problem",
  /bad conversion or a truncated download/.test(tensor) && /rather than a memory problem/.test(tensor), tensor);
check("and it hands over the tool that settles it",
  /gguf-tensors\.cjs/.test(tensor) && /--want blk\.32\.attn_norm\.weight/.test(tensor), tensor);
check("a memory failure is told which two settings to lower",
  /context size or the GPU layers/.test(explainFailure("ggml_backend_cuda_buffer_type_alloc_buffer: failed to allocate 4096.00 MiB")));
check("a projector mismatch is not blamed on the model",
  /projector does not match/.test(explainFailure("srv load_model: error loading model: failed to load mmproj projector")));
check("something unrecognised gets no invented advice", explainFailure("srv llama_server: exiting due to model loading error") === "");

// ── and the server uses it ──────────────────────────────────────────────────
check("serve.cjs records errors through the module", /llmErrorLines = appendErrorLines\(llmErrorLines, output/.test(serveSource));
check("it no longer overwrites the message with the last chunk", !/llmError = output\.trim\(\)\.slice\(-1200\)/.test(serveSource));
check("the failure keeps its beginning", /error: message\.slice\(0, 900\),/.test(serveSource));
check("and names the backend and profile that failed", /Last failure\$\{where\}/.test(serveSource) && /on \$\{last\.backend\} \(\$\{last\.profile\}\)/.test(serveSource));
check("the message carries the remedy too", /const hint = explainFailure\(last\?\.error \|\| ""\);/.test(serveSource) && /hint \? `\\n\\n\$\{hint\}` : ""/.test(serveSource));
check("the recorder is reset for the next load", /llmError = null;\s*\n\s*llmErrorLines = \[\];\s*\n\s*llmErrorTail = "";/.test(serveSource));
check("a load that never says 'error' still has a tail to show", /llmError = llmErrorLines\.length > 0 \? llmErrorLines\.join\("\\n"\) : llmErrorTail\.trim\(\);/.test(serveSource));

console.log("");
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks — ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`PASS: ${passed} checks — a failed load reports what llama.cpp complained about first, not how it said goodbye.`);
