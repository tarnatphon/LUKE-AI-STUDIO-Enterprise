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

const { loadHeader, readHeader } = require("../server/gguf-header.cjs");

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
    console.log(`blk.${report.block}:       ${report.blockTensors.length === 0 ? "no tensors" : report.blockTensors.map((tensor) => `${tensor.name} ${tensor.typeName} [${tensor.shape.join("×")}]`).join(", ")}`);
    console.log(`neighbours:   ${report.neighbouringBlocks.length ? `blk.${report.neighbouringBlocks.join(", blk.")}` : "none"}`);
  }
  if (args.includes("--list")) {
    for (const tensor of header.tensors) console.log(`  ${tensor.name}  ${tensor.typeName} [${tensor.shape.join("×")}]`);
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
