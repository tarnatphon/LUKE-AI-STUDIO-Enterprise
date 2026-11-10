#!/usr/bin/env node
"use strict";

/**
 * What a GGUF file actually contains, read from its own header.
 *
 * Written for one error, seen twice on real machines:
 *
 *   error loading model: missing tensor 'blk.32.attn_norm.weight'
 *
 * llama.cpp takes the layer count from the metadata and then expects
 * `blk.<i>.attn_norm.weight` for every i. When that tensor is not in the file,
 * the load dies before a single weight is read — in 0.3 s, which is how you know
 * it is not memory and not the backend.
 *
 * There are two ways for that to happen, and they have opposite fixes:
 *
 *   1. the metadata says 33 blocks and the file holds 32 — a bad conversion or a
 *      truncated download: the file is at fault, download it again;
 *   2. the file holds the tensor under another name or another shape — the file
 *      is fine and the backend is older than the model: update the backend.
 *
 * This prints which one it is. It reads the header only — never the weights — so
 * it answers in milliseconds on a file of any size.
 *
 * Run: node scripts/tools/gguf-tensors.cjs <model.gguf> [--block N] [--list]
 */

const fs = require("fs");

const FIXED_VALUE_SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const GGML_TYPE_NAMES = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1", 8: "Q8_0", 9: "Q8_1",
  10: "Q2_K", 11: "Q3_K", 12: "Q4_K", 13: "Q5_K", 14: "Q6_K", 15: "Q8_K", 16: "IQ2_XXS",
  17: "IQ2_XS", 18: "IQ3_XXS", 19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S", 22: "IQ2_S",
  23: "IQ4_XS", 24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64", 29: "IQ1_M", 30: "BF16",
};

function readString(buffer, offset) {
  const length = Number(buffer.readBigUInt64LE(offset));
  const start = offset + 8;
  if (start + length > buffer.length) throw new Error("ran past the part of the file that was read");
  return [buffer.toString("utf8", start, start + length), start + length];
}

function readValue(buffer, offset, type) {
  if (type === 8) return readString(buffer, offset);
  if (type === 9) {
    const itemType = buffer.readUInt32LE(offset);
    const count = Number(buffer.readBigUInt64LE(offset + 4));
    let cursor = offset + 12;
    if (itemType === 8) {
      const items = [];
      for (let index = 0; index < count; index += 1) {
        const [text, next] = readString(buffer, cursor);
        cursor = next;
        if (items.length < 16) items.push(text);
      }
      return [items.length === count ? items : [...items, `…${count - items.length} more`], cursor];
    }
    const size = FIXED_VALUE_SIZE[itemType];
    if (!size) throw new Error(`array of unsupported type ${itemType}`);
    return [`[${count} values of type ${itemType}]`, cursor + size * count];
  }
  const size = FIXED_VALUE_SIZE[type];
  if (!size) throw new Error(`unsupported value type ${type}`);
  let value;
  switch (type) {
    case 0: value = buffer.readUInt8(offset); break;
    case 1: value = buffer.readInt8(offset); break;
    case 2: value = buffer.readUInt16LE(offset); break;
    case 3: value = buffer.readInt16LE(offset); break;
    case 4: value = buffer.readUInt32LE(offset); break;
    case 5: value = buffer.readInt32LE(offset); break;
    case 6: value = buffer.readFloatLE(offset); break;
    case 7: value = buffer.readUInt8(offset) !== 0; break;
    case 10: value = buffer.readBigUInt64LE(offset).toString(); break;
    case 11: value = buffer.readBigInt64LE(offset).toString(); break;
    case 12: value = buffer.readDoubleLE(offset); break;
    default: value = "?";
  }
  return [value, offset + size];
}

/** The header of a GGUF file: metadata entries and the tensor table. */
function readHeader(buffer) {
  const magic = buffer.toString("latin1", 0, 4);
  if (magic !== "GGUF") throw new Error(`not a GGUF file (magic ${JSON.stringify(magic)})`);
  const version = buffer.readUInt32LE(4);
  const tensorCount = Number(buffer.readBigUInt64LE(8));
  const metadataCount = Number(buffer.readBigUInt64LE(16));
  let offset = 24;

  const metadata = {};
  for (let index = 0; index < metadataCount; index += 1) {
    const [key, afterKey] = readString(buffer, offset);
    const type = buffer.readUInt32LE(afterKey);
    const [value, afterValue] = readValue(buffer, afterKey + 4, type);
    metadata[key] = value;
    offset = afterValue;
  }

  const tensors = [];
  for (let index = 0; index < tensorCount; index += 1) {
    const [name, afterName] = readString(buffer, offset);
    const dimensions = buffer.readUInt32LE(afterName);
    let cursor = afterName + 4;
    const shape = [];
    for (let axis = 0; axis < dimensions; axis += 1) {
      shape.push(Number(buffer.readBigUInt64LE(cursor)));
      cursor += 8;
    }
    const type = buffer.readUInt32LE(cursor);
    cursor += 4;
    cursor += 8; // the byte offset of the weights, which this tool never follows
    tensors.push({ name, shape, type: GGML_TYPE_NAMES[type] || `type ${type}` });
    offset = cursor;
  }

  return { magic, version, tensorCount, metadataCount, metadata, tensors };
}

/** Read enough of the file for its header, growing the window if it is large. */
function loadHeader(file) {
  const fd = fs.openSync(file, "r");
  try {
    const total = fs.fstatSync(fd).size;
    for (const size of [4 * 1024 * 1024, 32 * 1024 * 1024, 256 * 1024 * 1024]) {
      const wanted = Math.min(size, total);
      const buffer = Buffer.alloc(wanted);
      const read = fs.readSync(fd, buffer, 0, wanted, 0);
      try {
        return readHeader(buffer.subarray(0, read));
      } catch (error) {
        // "Not enough bytes" arrives two ways and both mean "grow the window":
        // this module's own message, and Node's RangeError from a read that
        // starts near the end of the buffer. Only the first was caught before,
        // so the first real file this tool saw — whose DeepSeek tokenizer alone
        // puts the metadata past 2 MB — died with `offset is out of range`.
        const outOfBuffer = /ran past/.test(error.message) || error.code === "ERR_OUT_OF_RANGE";
        if (!outOfBuffer) throw error;
        // Running out when the window already covered the whole file is not a
        // window problem: the header runs past the end of the file.
        if (read < size) {
          throw new Error(
            `the header runs past the end of the file (${read} of ${total} bytes read) — the file is truncated`,
          );
        }
      }
    }
    throw new Error("the header is larger than 256 MB");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The blocks of one layer, and whether the file's metadata agrees with them.
 *
 * @param {{metadata: object, tensors: Array}} header
 * @param {number|null} block  the layer number to report on, if any
 */
function summarise(header, block = null, want = null) {
  const architecture = header.metadata["general.architecture"] || "(none)";
  const blockCountKey = Object.keys(header.metadata).find((key) => /\.block_count$/.test(key));
  const blockCount = blockCountKey ? Number(header.metadata[blockCountKey]) : null;
  const layers = new Set();
  for (const tensor of header.tensors) {
    const match = /^blk\.(\d+)\./.exec(tensor.name);
    if (match) layers.add(Number(match[1]));
  }
  const highest = layers.size > 0 ? Math.max(...layers) : -1;
  const missing =
    blockCount === null ? [] : Array.from({ length: blockCount }, (_, index) => index).filter((index) => !layers.has(index));
  const report = {
    architecture,
    blockCountKey,
    blockCount,
    layersInFile: layers.size,
    highestLayer: highest,
    missingLayers: missing,
    tensorCount: header.tensorCount,
    version: header.version,
  };
  if (want) {
    const present = header.tensors.some((tensor) => tensor.name === want);
    const match = /^blk\.(\d+)\./.exec(want);
    report.want = {
      name: want,
      present,
      layer: match ? Number(match[1]) : null,
      // Only the tensors that look like the same thing under another name: a
      // layer has many tensors, and listing all of them buries the answer.
      sameLayer: match
        ? header.tensors
          .filter((tensor) => tensor.name.startsWith(`blk.${match[1]}.${want.split(".").slice(2, 3).join(".")}`))
          .map((tensor) => tensor.name)
        : [],
    };
    if (block === null && report.want.layer !== null) block = report.want.layer;
  }
  if (block !== null) {
    report.block = block;
    report.blockTensors = header.tensors.filter((tensor) => tensor.name.startsWith(`blk.${block}.`));
    report.neighbouringBlocks = Array.from(layers)
      .filter((index) => Math.abs(index - block) <= 1)
      .sort((left, right) => left - right);
  }
  return report;
}

/** The two causes, told apart — because the fixes are opposite. */
function verdict(report, block = null) {
  // The exact name the backend asked for is the strongest evidence there is.
  if (report.want && !report.want.present) {
    const layer = report.want.layer;
    if (report.want.sameLayer.length > 0) {
      return `The backend asked for ${report.want.name}, and blk.${layer} exists under ${report.want.sameLayer.length} other ` +
        `name(s): ${report.want.sameLayer.slice(0, 4).join(", ")}. The file is fine — this backend is older than the model, ` +
        "so update it (scripts/setup/setup-llama.sh with a newer LLAMA_RELEASE).";
    }
    if (layer !== null && report.missingLayers.includes(layer)) {
      return `The backend asked for ${report.want.name}; the file has no blk.${layer} at all. The metadata says ` +
        `${report.blockCount} blocks and the file holds ${report.layersInFile} — a bad conversion or a truncated download, ` +
        "not a memory shortfall. Download it again, or use another quant.";
    }
  }
  if (report.blockCount === null) {
    return "This file does not name a block count, so the layer check did not run.";
  }
  if (report.missingLayers.length === 0) {
    return `Every block the metadata names (0…${report.blockCount - 1}) is present, so a missing-tensor error would come from the backend's naming, not from this file.`;
  }
  // The layer that is actually absent, which is not necessarily the one asked
  // about. And a block that is present and complete is not a near-miss.
  const layer = report.missingLayers[0];
  if (block !== null && report.missingLayers.includes(block) && report.blockTensors.length > 0) {
    return `blk.${block} exists under ${report.blockTensors.length} other name(s), so the backend expects different names: this is an architecture the installed backend is too old to read.`;
  }
  return `The metadata says ${report.blockCount} blocks (0…${report.blockCount - 1}) but the file holds ${report.layersInFile} ` +
    `(highest blk.${report.highestLayer}), so blk.${layer} is missing from the file itself. That is a bad conversion or a ` +
    "truncated download: the file is at fault, not the backend and not memory. Download it again, or use another quant.";
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((argument) => !argument.startsWith("--"));
  if (!file) {
    console.error("usage: node scripts/tools/gguf-tensors.cjs <model.gguf> [--want <tensor name>] [--block N] [--list]");
    process.exit(2);
  }
  const blockIndex = args.indexOf("--block");
  const block = blockIndex >= 0 && args[blockIndex + 1] !== undefined ? Number(args[blockIndex + 1]) : null;
  const wantIndex = args.indexOf("--want");
  const want = wantIndex >= 0 && args[wantIndex + 1] !== undefined ? String(args[wantIndex + 1]) : null;
  const header = loadHeader(file);
  const report = summarise(header, Number.isFinite(block) ? block : null, want);

  console.log(`file:         ${file}`);
  console.log(`version:      ${report.version}`);
  console.log(`architecture: ${report.architecture}`);
  console.log(`blocks:       metadata says ${report.blockCount ?? "nothing"} (${report.blockCountKey || "no block_count key"}), ` +
    `file holds ${report.layersInFile} (highest blk.${report.highestLayer})`);
  console.log(`tensors:      ${report.tensorCount}`);
  if (report.missingLayers.length > 0) {
    console.log(`missing:      blk.${report.missingLayers.slice(0, 12).join(", blk.")}${report.missingLayers.length > 12 ? " …" : ""}`);
  }
  if (report.blockTensors) {
    console.log(`blk.${report.block}:       ${report.blockTensors.length === 0 ? "no tensors" : report.blockTensors.map((tensor) => `${tensor.name} ${tensor.type} [${tensor.shape.join("×")}]`).join(", ")}`);
    console.log(`neighbours:   ${report.neighbouringBlocks.length ? `blk.${report.neighbouringBlocks.join(", blk.")}` : "none"}`);
  }
  if (args.includes("--list")) {
    for (const tensor of header.tensors) console.log(`  ${tensor.name}  ${tensor.type} [${tensor.shape.join("×")}]`);
  }
  if (report.want) console.log(`asked for:    ${report.want.name} — ${report.want.present ? "present" : "NOT present"}`);
  console.log("");
  console.log(verdict(report, report.block === undefined ? null : report.block));
  return report.missingLayers.length > 0 ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(`gguf-tensors: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  loadHeader,
  readHeader,
  summarise,
  verdict,
};
