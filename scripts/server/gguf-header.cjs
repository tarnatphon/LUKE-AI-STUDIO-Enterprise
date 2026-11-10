"use strict";

/**
 * The header of a GGUF file, read without touching the weights.
 *
 * One reader for two callers: `scripts/tools/gguf-tensors.cjs`, which a person
 * runs to ask what a file contains, and `model-integrity.cjs`, which the server
 * runs when a model appears in the folder so a damaged file is named before
 * anybody waits on a load.
 *
 * Everything here is about the first few megabytes: the metadata block and the
 * tensor table. The weights afterwards are never read, which is why this answers
 * in milliseconds on an 8 GB file and can be run over every model in a folder.
 */

const fs = require("fs");

const FIXED_VALUE_SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

/**
 * How many elements a quantisation block holds and how many bytes it occupies.
 * Needed to turn a tensor's shape into bytes, which is how a truncated file is
 * recognised: the last tensor's data has to end inside the file.
 */
const GGML_TYPES = {
  0: { name: "F32", block: 1, bytes: 4 },
  1: { name: "F16", block: 1, bytes: 2 },
  2: { name: "Q4_0", block: 32, bytes: 18 },
  3: { name: "Q4_1", block: 32, bytes: 20 },
  6: { name: "Q5_0", block: 32, bytes: 22 },
  7: { name: "Q5_1", block: 32, bytes: 24 },
  8: { name: "Q8_0", block: 32, bytes: 34 },
  9: { name: "Q8_1", block: 32, bytes: 36 },
  10: { name: "Q2_K", block: 256, bytes: 84 },
  11: { name: "Q3_K", block: 256, bytes: 110 },
  12: { name: "Q4_K", block: 256, bytes: 144 },
  13: { name: "Q5_K", block: 256, bytes: 176 },
  14: { name: "Q6_K", block: 256, bytes: 210 },
  15: { name: "Q8_K", block: 256, bytes: 292 },
  16: { name: "IQ2_XXS", block: 256, bytes: 66 },
  17: { name: "IQ2_XS", block: 256, bytes: 74 },
  18: { name: "IQ3_XXS", block: 256, bytes: 98 },
  19: { name: "IQ1_S", block: 256, bytes: 50 },
  20: { name: "IQ4_NL", block: 32, bytes: 18 },
  21: { name: "IQ3_S", block: 256, bytes: 110 },
  22: { name: "IQ2_S", block: 256, bytes: 82 },
  23: { name: "IQ4_XS", block: 256, bytes: 136 },
  24: { name: "I8", block: 1, bytes: 1 },
  25: { name: "I16", block: 1, bytes: 2 },
  26: { name: "I32", block: 1, bytes: 4 },
  27: { name: "I64", block: 1, bytes: 8 },
  28: { name: "F64", block: 1, bytes: 8 },
  29: { name: "IQ1_M", block: 256, bytes: 56 },
  30: { name: "BF16", block: 1, bytes: 2 },
};

/** How many strings of an array are worth keeping for display. */
const ARRAY_DISPLAY_LIMIT = 16;

class GgufError extends Error {
  /**
   * @param {string} code  not-a-gguf | short-read | past-end | unsupported | unreadable
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "GgufError";
    this.code = code;
  }
}

function readString(buffer, offset) {
  if (offset + 8 > buffer.length) throw new GgufError("past-end", "ran past the part of the file that was read");
  const length = Number(buffer.readBigUInt64LE(offset));
  const start = offset + 8;
  if (start + length > buffer.length) throw new GgufError("past-end", "ran past the part of the file that was read");
  return [buffer.toString("utf8", start, start + length), start + length];
}

function readValue(buffer, offset, type) {
  if (type === 8) return readString(buffer, offset);
  if (type === 9) {
    const itemType = buffer.readUInt32LE(offset);
    const count = Number(buffer.readBigUInt64LE(offset + 4));
    let cursor = offset + 12;
    const display = [];
    if (itemType === 8) {
      for (let index = 0; index < count; index += 1) {
        const [text, next] = readString(buffer, cursor);
        cursor = next;
        if (display.length < ARRAY_DISPLAY_LIMIT) display.push(text);
      }
      if (count > display.length) display.push(`…${count - display.length} more`);
      return [{ value: display, count }, cursor];
    }
    const fixed = FIXED_VALUE_SIZE[itemType];
    if (!fixed) throw new GgufError("unsupported", `array of unsupported type ${itemType}`);
    return [{ value: `[${count} values of type ${itemType}]`, count }, cursor + fixed * count];
  }
  const size = FIXED_VALUE_SIZE[type];
  if (!size) throw new GgufError("unsupported", `unsupported value type ${type}`);
  if (offset + size > buffer.length) throw new GgufError("past-end", "ran past the part of the file that was read");
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
    case 11: value = buffer.readInt64LE(offset).toString(); break;
    case 12: value = buffer.readDoubleLE(offset); break;
    default: value = null;
  }
  return [value, offset + size];
}

/**
 * Parse a header out of the bytes available.
 *
 * @param {Buffer} buffer  the front of the file
 * @returns {{version: number, tensorCount: number, metadataCount: number, metadata: object, tensors: Array, headerEnd: number}}
 */
function readHeader(buffer) {
  if (buffer.length < 24) throw new GgufError("short-read", "shorter than a GGUF header");
  const magic = buffer.toString("latin1", 0, 4);
  if (magic !== "GGUF") throw new GgufError("not-a-gguf", `not a GGUF file (magic ${JSON.stringify(magic)})`);
  const version = buffer.readUInt32LE(4);
  const tensorCount = Number(buffer.readBigUInt64LE(8));
  const metadataCount = Number(buffer.readBigUInt64LE(16));
  let offset = 24;

  const metadata = {};
  const arrayCounts = {};
  for (let index = 0; index < metadataCount; index += 1) {
    const [key, afterKey] = readString(buffer, offset);
    const type = buffer.readUInt32LE(afterKey);
    const [value, afterValue] = readValue(buffer, afterKey + 4, type);
    if (value && typeof value === "object" && "value" in value && "count" in value) {
      arrayCounts[key] = value.count;
      metadata[key] = value.value;
    } else {
      metadata[key] = value;
    }
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
    const dataOffset = Number(buffer.readBigUInt64LE(cursor));
    cursor += 8;
    tensors.push({ name, shape, type, typeName: GGML_TYPES[type]?.name || `type ${type}`, offset: dataOffset });
    offset = cursor;
  }

  return { magic, version, tensorCount, metadataCount, metadata, arrayCounts, tensors, headerEnd: offset };
}

/**
 * Read the header of a file, growing the window when the metadata is large.
 *
 * A DeepSeek tokenizer alone puts the metadata block past 2 MB, so a fixed small
 * window is not enough; and running out of buffer arrives two ways — our own
 * "past-end" and Node's RangeError from a read that starts near the end.
 *
 * @param {string} file
 * @param {{sizes?: number[]}} [options]
 */
function loadHeader(file, { sizes = [4 * 1024 * 1024, 32 * 1024 * 1024, 256 * 1024 * 1024] } = {}) {
  const fd = fs.openSync(file, "r");
  try {
    const total = fs.fstatSync(fd).size;
    for (const size of sizes) {
      const wanted = Math.min(size, total);
      const buffer = Buffer.alloc(Math.max(wanted, 1));
      const read = fs.readSync(fd, buffer, 0, wanted, 0);
      try {
        return { ...readHeader(buffer.subarray(0, read)), fileSize: total };
      } catch (error) {
        const outOfBuffer = error.code === "past-end" || error.code === "ERR_OUT_OF_RANGE" || /ran past/.test(error.message);
        if (!outOfBuffer) throw error;
        if (read < size) {
          throw new GgufError(
            "past-end",
            `the header runs past the end of the file (${read} of ${total} bytes read) — the file is truncated`,
          );
        }
      }
    }
    throw new GgufError("past-end", "the header is larger than 256 MB");
  } finally {
    fs.closeSync(fd);
  }
}

/** The bytes one tensor occupies, or null when the type is unknown. */
function tensorBytes(tensor) {
  const type = GGML_TYPES[tensor?.type];
  if (!type) return null;
  const elements = tensor.shape.reduce((product, dimension) => product * dimension, 1);
  return Math.ceil(elements / type.block) * type.bytes;
}

/**
 * Where the weights end, in bytes from the start of the file.
 *
 * The data section begins after the header, padded to the file's alignment. Each
 * tensor's offset is measured from there, so the furthest one says how large the
 * file has to be — and a file that is shorter than that was cut off mid-download,
 * which is the second-most common way a model fails to load.
 *
 * @param {{tensors: Array, headerEnd: number, metadata: object}} header
 * @returns {{dataStart: number, dataEnd: number, unknownTypes: string[]} | null}
 */
function dataExtent(header) {
  const alignment = Number(header.metadata?.["general.alignment"]) || 32;
  const dataStart = Math.ceil(header.headerEnd / alignment) * alignment;
  let dataEnd = dataStart;
  const unknownTypes = new Set();
  for (const tensor of header.tensors) {
    const bytes = tensorBytes(tensor);
    if (bytes === null) {
      unknownTypes.add(tensor.typeName);
      continue;
    }
    dataEnd = Math.max(dataEnd, dataStart + tensor.offset + bytes);
  }
  if (unknownTypes.size > 0) return { dataStart, dataEnd: null, unknownTypes: [...unknownTypes] };
  return { dataStart, dataEnd, unknownTypes: [] };
}

module.exports = {
  GGML_TYPES,
  GgufError,
  dataExtent,
  loadHeader,
  readHeader,
  tensorBytes,
};
