"use strict";

/**
 * A model that cannot load should say so before anyone waits for it.
 *
 * The report that started this:
 *
 *   Model Load Failed
 *   Text model failed on all available llama.cpp backends. Last failure on
 *   Metal GPU (safe): … missing tensor 'blk.32.attn_norm.weight'
 *
 * The file's metadata claimed 33 blocks and its tensor table held 32. Nothing
 * could load it. The app offered it, started llama.cpp, waited, and then
 * blamed the backend. A header read decides the same question in milliseconds
 * and without reading a weight.
 *
 * Two faults are caught, both of them complete in the header:
 *   - blocks the metadata promises and the tensor table does not hold;
 *   - weights that run past the end of the file (an unfinished download).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const { checkModel, checkModels } = require("../../scripts/server/model-integrity.cjs");
const { loadHeader } = require("../../scripts/server/gguf-header.cjs");

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-integrity-"));

const str = (value) => {
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(Buffer.byteLength(value)));
  return Buffer.concat([length, Buffer.from(value)]);
};
const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};
const u64 = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

/**
 * A GGUF with `layers` blocks of Q4_K tensors, 4096 elements each, and its data
 * section present (or cut short, to simulate an unfinished download).
 */
function writeModel(file, { architecture = "qwen35", blockCount, layers, truncateBytes = 0, withWeights = true }) {
  const names = [];
  for (let index = 0; index < layers; index += 1) names.push(`blk.${index}.attn_norm.weight`);
  names.push("token_embd.weight", "output_norm.weight", "output.weight");
  const perTensor = 4096; // elements
  const bytesPerTensor = Math.ceil(perTensor / 256) * 144; // Q4_K
  const infos = [];
  let offset = 0;
  for (const name of names) {
    infos.push(Buffer.concat([str(name), u32(1), u64(perTensor), u32(12), u64(offset)]));
    offset += bytesPerTensor;
  }
  const header = Buffer.concat([
    Buffer.from("GGUF", "latin1"),
    u32(3),
    u64(names.length),
    u64(2),
    str("general.architecture"), u32(8), str(architecture),
    str(`${architecture}.block_count`), u32(4), u32(blockCount),
    ...infos,
  ]);
  const dataStart = Math.ceil(header.length / 32) * 32;
  const padding = Buffer.alloc(dataStart - header.length);
  const weights = Buffer.alloc(withWeights ? offset : 0);
  let content = Buffer.concat([header, padding, weights]);
  if (truncateBytes > 0) content = content.subarray(0, Math.max(0, content.length - truncateBytes));
  fs.writeFileSync(file, content);
  return file;
}

// ── the file that started this ──────────────────────────────────────────────
const broken = writeModel(path.join(tmp, "broken.gguf"), { blockCount: 33, layers: 32 });
const brokenResult = checkModel(broken);
check("33 blocks promised, 32 held is caught", brokenResult.ok === false && brokenResult.code === "missing-blocks", brokenResult.code);
check("and the reason names the missing block", /blk\.32 is missing/.test(brokenResult.reason), brokenResult.reason);
check("and rules out backend and memory", /not the backend and not memory/.test(brokenResult.reason), brokenResult.reason);
check("and says what to do", /download it again|another quant/i.test(brokenResult.reason), brokenResult.reason);

// ── the ordinary case, which must not be flagged ────────────────────────────
const whole = writeModel(path.join(tmp, "whole.gguf"), { blockCount: 32, layers: 32 });
const wholeResult = checkModel(whole);
check("an intact file passes", wholeResult.ok === true && wholeResult.code === "ok", JSON.stringify(wholeResult));
check("and reports what it found", wholeResult.architecture === "qwen35" && wholeResult.blocks === 32, JSON.stringify(wholeResult));

// ── an unfinished download ──────────────────────────────────────────────────
const cut = writeModel(path.join(tmp, "cut.gguf"), { blockCount: 32, layers: 32 });
const before = fs.statSync(cut).size;
fs.truncateSync(cut, before - Math.floor(before / 4));
const cutResult = checkModel(cut, { refresh: true });
check("a file shorter than its weights is caught", cutResult.ok === false && cutResult.code === "truncated", cutResult.code);
check("and told to be downloaded again", /download it again/i.test(cutResult.reason), cutResult.reason);
check("with the size it needs against the size it has", Array.isArray(cutResult.issues) && /needs .* has /.test(cutResult.issues[0] || ""), JSON.stringify(cutResult.issues));

// ── files that are not models ───────────────────────────────────────────────
const junk = path.join(tmp, "junk.gguf");
fs.writeFileSync(junk, Buffer.alloc(4096, 0x41));
const junkResult = checkModel(junk);
check("a file that was never a GGUF is named as one", junkResult.ok === false && junkResult.code === "not-a-gguf", junkResult.code);

const tiny = path.join(tmp, "tiny.gguf");
fs.writeFileSync(tiny, "GGUF-BYTES-42");
check("a test-sized stub is skipped, not condemned", checkModel(tiny).checked === false, JSON.stringify(checkModel(tiny)));

const folder = path.join(tmp, "a-folder.gguf");
fs.mkdirSync(folder);
check("a folder is skipped", checkModel(folder).checked === false);

check("a file that is not there is skipped", checkModel(path.join(tmp, "absent.gguf")).checked === false);

const blankArch = writeModel(path.join(tmp, "blank-architecture.gguf"), { architecture: "", blockCount: 2, layers: 2 });
check("a file with no architecture is refused, not guessed at", checkModel(blankArch).code === "no-architecture", JSON.stringify(checkModel(blankArch)));

// ── the header reader it stands on ──────────────────────────────────────────
const header = loadHeader(whole);
check("the data section is where the header ends, padded", header.headerEnd > 0 && header.fileSize > header.headerEnd, `${header.headerEnd}/${header.fileSize}`);
check("a heavy file is not read whole", header.tensors.length === 35, String(header.tensors.length));

// ── caching, so a folder listing stays cheap ────────────────────────────────
const first = checkModel(whole);
const second = checkModel(whole);
check("the same file is not re-read on every listing", first === second);
fs.utimesSync(whole, new Date(), new Date(Date.now() + 5000));
const afterTouch = checkModel(whole);
check("but a changed file is read again", afterTouch !== first, "cache key is size+mtime");

const many = checkModels({ broken, whole, cut });
check("a whole folder can be checked at once", Object.keys(many).length === 3 && many.broken.ok === false && many.whole.ok === true, JSON.stringify(Object.keys(many)));

// ── the server and the panel use it ─────────────────────────────────────────
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
check("the text model list carries the verdict", /integrity: isProjector\s*\n?\s*\? \{ ok: true, checked: false/.test(serveSource) && /checkModelIntegrity\(fullPath\)/.test(serveSource));
check("the file list does too", /info\.integrity = checkModelIntegrity\(path\.join\(MODELS, filename\)\)/.test(serveSource));

const startLlm = serveSource.slice(serveSource.indexOf("async function startLlm(settings = {})"), serveSource.indexOf("async function startLlmWithBackend"));
check("a load asks about the file before starting anything", /checkModelIntegrity\(modelPath\)/.test(startLlm));
check("and refuses it with the reason", /cannot be loaded: \$\{integrity\.reason\}/.test(startLlm));
check("as a 400, because the file is the problem, not the server", /broken\.statusCode = 400/.test(startLlm));
const checkAt = startLlm.indexOf("checkModelIntegrity(modelPath)");
const waitAt = startLlm.indexOf("waitForOtherModelLoad");
check("before it queues behind anyone else's load", checkAt > 0 && (waitAt === -1 || checkAt < waitAt), `check ${checkAt}, wait ${waitAt}`);

const apiSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "services", "api.js"), "utf8");
check("the panel receives the verdict", /integrity: model\?\.integrity && typeof model\.integrity === "object"/.test(apiSource));
const managerSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "ModelManager.jsx"), "utf8");
check("says which file cannot load", /This file cannot load — \{integrityIssue\.reason\}/.test(managerSource));
check("and does not offer to load it", /disabled=\{isBusy \|\| Boolean\(integrityIssue\)\}/.test(managerSource));

fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks — ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`PASS: ${passed} checks — a model that cannot load says so before it is loaded.`);
