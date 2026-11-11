#!/usr/bin/env node
"use strict";

/**
 * The backend told us it cannot load an architecture — once.
 *
 * llama.cpp only says "unknown model architecture: 'qwen3vl'" when a load has
 * already failed. The message is explained (llm-error-log.cjs) and then thrown
 * away with the error string, so the next time the same model is on screen
 * there is nothing on the row again: pick it, wait, watch it die, read it again.
 *
 * backend-architecture-limits.cjs keeps the fact against the exact binaries that
 * refused it — path, size, mtime — and the model list carries it as a warning
 * before the Load button is pressed.
 *
 * The property that matters most is that the record retires itself. Evidence
 * about a binary that has since been upgraded is not evidence, and a warning
 * that outlives its cause is how a user learns to ignore warnings.
 *
 * Run: node scripts/validation/test-backend-architecture-limits.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const server = path.join(root, "scripts", "server");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-arch-limits-"));

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

// The ledger reads its path at call time, so one env var aims it at the temp
// folder for every check below.
const statePath = path.join(temp, "backend-architecture-limits.json");
process.env.LUKE_BACKEND_ARCH_LIMITS_FILE = statePath;

const { unknownArchitecture } = require(path.join(server, "llm-error-log.cjs"));
const limits = require(path.join(server, "backend-architecture-limits.cjs"));

function backendFile(name, bytes) {
  const file = path.join(temp, name);
  fs.writeFileSync(file, bytes);
  return file;
}

function readState() {
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

console.log("\n  recognising the sentence");

const REAL_OUTPUT = [
  "llama_model_loader: - kv   0:                       general.architecture str              = qwen3vl",
  "llama_model_loader: - kv   1:                               general.name str              = Qwen3-VL-8B",
  "error loading model: unknown model architecture: 'qwen3vl'",
  "0.00.457.536 E srv  llama_server: exiting due to model loading error",
].join("\n");

check(unknownArchitecture(REAL_OUTPUT) === "qwen3vl", "the architecture is taken from real llama.cpp output");
check(unknownArchitecture('unknown model architecture: "gemma4"') === "gemma4", "double quotes are understood too");
check(unknownArchitecture("unknown model architecture: phi4") === "phi4", "and no quotes at all");
check(unknownArchitecture("failed to allocate buffer") === null, "another failure is not mistaken for this one");
check(unknownArchitecture("") === null && unknownArchitecture(null) === null, "nothing at all is null, not a crash");

console.log("\n  recording one");

const binary = backendFile("llama-server", "ELF-b9668");
const entry = limits.record({ architecture: "qwen3vl", backends: [binary], model: "qwen3vl-8b-q4.gguf" });

check(Boolean(entry), "the refusal is recorded");
check(readState().limits.length === 1, "in the machine-local state file");
check(entry.architecture === "qwen3vl" && entry.model === "qwen3vl-8b-q4.gguf", "with the architecture and the model that proved it");
check(/^\d{4}-\d{2}-\d{2}T/.test(entry.seenAt), "and when", entry.seenAt);
check(entry.backends.length === 1 && entry.backends[0].path === path.resolve(binary), "against the binary that refused it");
check(entry.backends[0].sizeBytes > 0 && entry.backends[0].mtimeMs > 0, "identified by size and mtime, not by a version it was never asked for");

const described = limits.describe(entry);
check(described.includes("'qwen3vl'"), "the sentence names the architecture", described);
check(described.includes("does not know"), "says what the backend reported");
check(/setup-llama\.sh/.test(described) && /LLAMA_RELEASE/.test(described), "and gives the command that fixes it");
check(/restart LUKE/.test(described), "including the part people forget");
check(/pick a model whose architecture/.test(described), "with the alternative of not fighting it");
check(/seen \d{4}-\d{2}-\d{2}/.test(described) && /qwen3vl-8b-q4\.gguf/.test(described), "and when it was seen, so an old record is obvious");

console.log("\n  what the model list asks");

check(Boolean(limits.forArchitecture("qwen3vl")), "a model of that architecture finds the warning");
check(limits.forArchitecture("llama") === null, "another architecture does not");
check(limits.forArchitecture("") === null && limits.forArchitecture(null) === null, "and neither does an empty one");

limits.record({ architecture: "qwen3vl", backends: [binary], model: "another.gguf" });
check(readState().limits.length === 1, "recording the same architecture again replaces the record, it does not stack");
check(limits.forArchitecture("qwen3vl").model === "another.gguf", "the newest evidence wins");

console.log("\n  and how it stops being true");

fs.appendFileSync(binary, "-upgraded");
check(limits.forArchitecture("qwen3vl") === null, "an upgraded binary retires the record by itself");
check(readState().limits.length === 0, "and the stale entry is pruned from the file, not left to rot");

const second = backendFile("llama-server-2", "ELF-b12242");
limits.record({ architecture: "gemma4", backends: [second], model: "gemma-4-9b.gguf" });
check(Boolean(limits.forArchitecture("gemma4")), "a fresh record works again");
fs.rmSync(second);
check(limits.forArchitecture("gemma4") === null, "a backend that is no longer installed retires it too");

const third = backendFile("llama-server-3", "ELF");
limits.record({ architecture: "qwen35", backends: [third], model: "qwen35.gguf" });
check(limits.clear("qwen35") === true, "a successful load clears the record");
check(limits.forArchitecture("qwen35") === null && readState().limits.length === 0, "and it is gone from the file");
check(limits.clear("qwen35") === false, "clearing nothing is not an error");
check(limits.clear("") === false, "and neither is clearing an empty name");

console.log("\n  refusing to record what cannot be checked");

check(limits.record({ architecture: "llama", backends: [], model: "x.gguf" }) === null, "no backend means no record — it could never be retired");
check(limits.record({ architecture: "", backends: [third], model: "x.gguf" }) === null, "and an empty architecture is not a fact");
check(limits.record({ architecture: "llama", backends: [path.join(temp, "not-installed")] }) === null, "nor is a binary that does not exist");
check(readState().limits.length === 0, "none of those wrote anything");

fs.writeFileSync(statePath, "{ this is not json");
check(Array.isArray(limits.activeLimits()) && limits.activeLimits().length === 0, "a corrupt state file is an empty ledger, not a failed model list");
fs.writeFileSync(statePath, JSON.stringify({ version: 1, limits: [{ architecture: "llama" }] }));
check(limits.activeLimits().length === 0, "an entry with no binary identity is ignored rather than warned about forever");

console.log("\n  wired to the load path and to the row");

const serve = read("scripts", "server", "serve.cjs");
const api = read("app", "frontend", "src", "services", "api.js");
const manager = read("app", "frontend", "src", "components", "ModelManager.jsx");

check(/require\("\.\/backend-architecture-limits\.cjs"\)/.test(serve), "serve.cjs requires the ledger");
check(/backendLimit: describeBackendLimit\(isProjector \? null : integrity\)/.test(serve), "every model row carries what the backend said");
check(/backendArchLimits\.forArchitecture\(architecture\)/.test(serve), "keyed by the architecture read from the file's own header");

const failedAt = serve.indexOf("const refusedArchitecture = unknownArchitecture(last?.error");
const throwAt = serve.indexOf("Text model failed on all available llama.cpp backends");
check(failedAt > 0 && throwAt > failedAt, "a failure that is an unknown architecture is recorded before the error is thrown");
check(/backends: sortedCandidates\.map\(\(candidate\) => candidate\.path\)/.test(serve), "against the backends that were actually tried");

const successAt = serve.indexOf("backendArchLimits.clear(integrity.architecture)");
const loadAt = serve.indexOf("await startLlmWithBackend({ ...settings, __loadProfile: profile }, backend);");
check(successAt > loadAt, "and a load that works clears it");

check(/backendLimit: model\?\.backendLimit/.test(api), "the frontend carries the field through normalizeModel");
check(/const backendLimit = model\.backendLimit \|\| null;/.test(manager), "the model row reads it");
check(/This backend may not load it/.test(manager), "and says so before the button is pressed");
check(/!integrityIssue && backendLimit/.test(manager), "without repeating itself over a file that cannot load at all");
check(/disabled=\{isBusy \|\| Boolean\(integrityIssue\)\}/.test(manager), "and without disabling Load: a new backend, or another quant, may work");

fs.rmSync(temp, { recursive: true, force: true });
console.log(`\nPASS: ${checks} checks — what the backend refused once is said before the next attempt, and forgotten when it stops being true.`);
process.exit(0);
