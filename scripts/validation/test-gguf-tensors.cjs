"use strict";

/**
 * The tool that answers "missing tensor" without a 6 GB re-download.
 *
 * Reported from a real machine:
 *
 *   error loading model: missing tensor 'blk.32.attn_norm.weight'
 *
 * Two causes, opposite fixes — the file is broken, or the backend is older than
 * the model — and the difference lives entirely in the GGUF header. These
 * fixtures are built byte by byte here so both can be exercised, plus the
 * intact control.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const tool = path.join(root, "scripts", "tools", "gguf-tensors.cjs");
const { loadHeader, summarise, verdict } = require("../../scripts/tools/gguf-tensors.cjs");

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-gguf-"));

// ── fixtures ────────────────────────────────────────────────────────────────
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

function writeGguf(file, { architecture = "qwen35", blockCount, layers, layerTensors, tensorType = 12 }) {
  const names = [];
  for (let index = 0; index < layers; index += 1) {
    names.push(...layerTensors(index));
  }
  names.push("token_embd.weight", "output_norm.weight", "output.weight");
  const parts = [
    Buffer.from("GGUF", "latin1"),
    u32(3),
    u64(names.length),
    u64(2),
    str("general.architecture"),
    u32(8),
    str(architecture),
    str(`${architecture}.block_count`),
    u32(4),
    u32(blockCount),
  ];
  for (const name of names) {
    parts.push(Buffer.concat([str(name), u32(1), u64(4096), u32(tensorType), u64(0)]));
  }
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

const normalLayer = (index) => [`blk.${index}.attn_norm.weight`, `blk.${index}.ffn_down.weight`];

// 33 blocks claimed, 32 present: the file is broken.
const broken = writeGguf(path.join(tmp, "broken.gguf"), { blockCount: 33, layers: 32, layerTensors: normalLayer });
// 33 blocks claimed and 33 present, but the last one is named differently: the
// backend is older than the model.
const renamed = writeGguf(path.join(tmp, "renamed.gguf"), {
  blockCount: 33,
  layers: 33,
  layerTensors: (index) => [`blk.${index}.attn_norm${index === 32 ? "_v2" : ""}.weight`, `blk.${index}.ffn_down.weight`],
});
// The control: everything the metadata promises is there.
const intact = writeGguf(path.join(tmp, "intact.gguf"), { blockCount: 32, layers: 32, layerTensors: normalLayer });
// A tokenizer large enough to push the metadata block past the first window the
// tool reads: a real DeepSeek vocab does this, and the first version of the tool
// died on exactly that file with `The value of "offset" is out of range`.
const bigVocab = path.join(tmp, "big-vocab.gguf");
{
  const tokens = [];
  for (let index = 0; index < 160000; index += 1) tokens.push(`tok${index}_äö`);
  const names = ["token_embd.weight", "output_norm.weight", "output.weight"];
  for (let index = 0; index < 33; index += 1) names.push(`blk.${index}.attn_norm.weight`);
  const parts = [
    Buffer.from("GGUF", "latin1"), u32(3), u64(names.length), u64(3),
    str("general.architecture"), u32(8), str("qwen35"),
    str("qwen35.block_count"), u32(4), u32(34),
    str("tokenizer.ggml.tokens"), u32(9), Buffer.concat([u32(8), u64(tokens.length), ...tokens.map(str)]),
  ];
  for (const name of names) parts.push(Buffer.concat([str(name), u32(1), u64(4096), u32(12), u64(0)]));
  fs.writeFileSync(bigVocab, Buffer.concat(parts));
}
// A file that ends in the middle of its header.
const truncated = path.join(tmp, "truncated.gguf");
fs.writeFileSync(truncated, fs.readFileSync(intact).subarray(0, 200));

const notGguf = path.join(tmp, "not-a-model.gguf");
fs.writeFileSync(notGguf, Buffer.from("this is not a model, it is a text file\n"));

const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: "utf8", timeout: 60000 });

// ── the header, read back ───────────────────────────────────────────────────
const brokenHeader = loadHeader(broken);
check("the magic and version are read", brokenHeader.magic === "GGUF" && brokenHeader.version === 3, `${brokenHeader.magic} v${brokenHeader.version}`);
check("the architecture is read", brokenHeader.metadata["general.architecture"] === "qwen35", brokenHeader.metadata["general.architecture"]);
check("the tensor table is read", brokenHeader.tensors.length === 67, String(brokenHeader.tensors.length));
check("a quantisation type is named", brokenHeader.tensors[0].type === "Q4_K", brokenHeader.tensors[0].type);
check("shapes come with it", brokenHeader.tensors[0].shape.join("×") === "4096", brokenHeader.tensors[0].shape.join("×"));

const brokenReport = summarise(brokenHeader);
check("the block count is taken from the metadata, whatever it is called", brokenReport.blockCount === 33 && brokenReport.blockCountKey === "qwen35.block_count", JSON.stringify(brokenReport.blockCountKey));
check("the layers the file really holds are counted", brokenReport.layersInFile === 32 && brokenReport.highestLayer === 31, `${brokenReport.layersInFile}/${brokenReport.highestLayer}`);
check("and the ones it is missing are named", brokenReport.missingLayers.length === 1 && brokenReport.missingLayers[0] === 32, JSON.stringify(brokenReport.missingLayers));

// ── the two verdicts, which must not be the same verdict ────────────────────
const WANT = "blk.32.attn_norm.weight";
const fileVerdict = verdict(summarise(loadHeader(broken), null, WANT), 32);
check("a file missing a block is called a broken file", /no blk\.32 at all/.test(fileVerdict) && /download it again/i.test(fileVerdict), fileVerdict);
check("and memory is explicitly ruled out", /rather than|not a memory/.test(fileVerdict) || /not the backend and not memory/.test(fileVerdict), fileVerdict);

const backendVerdict = verdict(summarise(loadHeader(renamed), null, WANT), 32);
check("the same tensor under another name is called an old backend", /older than the model/.test(backendVerdict), backendVerdict);
check("and the near-miss is named, not the whole layer", /blk\.32\.attn_norm_v2\.weight/.test(backendVerdict) && !/ffn_down/.test(backendVerdict), backendVerdict);
check("the two verdicts really differ", fileVerdict !== backendVerdict);

const intactReport = summarise(loadHeader(intact), null, "blk.31.attn_norm.weight");
check("a complete file has nothing missing", intactReport.missingLayers.length === 0);
check("and the tool does not cry wolf", /Every block the metadata names/.test(verdict(intactReport)), verdict(intactReport));

// ── a header bigger than the first window ───────────────────────────────────
check("a metadata block past 2 MB still reads", fs.statSync(bigVocab).size > 2 * 1024 * 1024, `${(fs.statSync(bigVocab).size / 1048576).toFixed(1)} MB`);
const bigHeader = loadHeader(bigVocab);
// The tool shows the first few tokens and a count, not 160 000 strings; the
// proof that it stepped over the rest correctly is the tensor table after it.
const tokens = bigHeader.metadata["tokenizer.ggml.tokens"];
check("the array is summarised rather than dumped", tokens.length === 17 && /more/.test(tokens[16]), tokens[tokens.length - 1]);
check("and the tensor table after it still parses", bigHeader.tensors.length === 36, String(bigHeader.tensors.length));
const bigReport = summarise(bigHeader, null, "blk.32.attn_norm.weight");
check("the tensor that is present is reported present", bigReport.want.present === true);
check("and the verdict names the layer that is missing, not the one that was asked about",
  /blk\.33 is missing from the file itself/.test(verdict(bigReport, 32)), verdict(bigReport, 32));

// A file cut short says so, instead of printing a stack trace.
const truncatedRun = run(truncated);
check("a file that ends inside its header is called truncated", truncatedRun.status === 2 && /truncated/.test(truncatedRun.stderr), truncatedRun.stderr);

// ── from the command line, where the user meets it ──────────────────────────
const brokenRun = run(broken, "--want", WANT);
check("a broken file exits 1, so a script can act on it", brokenRun.status === 1, `exit ${brokenRun.status}`);
check("and says which tensor the backend wanted", /asked for:\s+blk\.32\.attn_norm\.weight — NOT present/.test(brokenRun.stdout), brokenRun.stdout.split("\n").slice(-3).join(" | "));
check("the layer it asked about is shown", /blk\.32:\s+no tensors/.test(brokenRun.stdout), brokenRun.stdout);

const intactRun = run(intact);
check("a complete file exits 0", intactRun.status === 0, `exit ${intactRun.status}`);

const listRun = run(intact, "--list");
check("--list prints every tensor", /token_embd\.weight/.test(listRun.stdout) && /blk\.31\.ffn_down\.weight/.test(listRun.stdout));

const notGgufRun = run(notGguf);
check("a file that is not a model is refused plainly", notGgufRun.status === 2 && /not a GGUF file/.test(notGgufRun.stderr), notGgufRun.stderr);
check("and so is a missing file", run(path.join(tmp, "absent.gguf")).status === 2);
check("with no argument it says how to use it", /usage:/.test(run().stderr));

fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks — ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`PASS: ${passed} checks — "missing tensor" is answered as a broken file or an old backend, and never as a guess.`);
