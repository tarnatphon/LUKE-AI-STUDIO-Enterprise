"use strict";

/**
 * Patch-based editing for the Work agent.
 *
 * Making a small model re-emit an entire file to change three lines is how
 * files get corrupted and how context windows die. The agent sends targeted
 * edits instead, and this module proves each one lands on exactly the place it
 * means before a byte is written.
 *
 * Everything resolves through the shared path guard, so a patch can no more
 * leave the granted folder than a whole-file write could.
 */

const fsp = require("node:fs/promises");
const path = require("node:path");
const { resolveInsideRoot, createHttpError } = require("./work-path-guard.cjs");

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EDITS_PER_CALL = 24;

function reject(message, statusCode = 400, code = "PATCH_REJECTED") {
  const error = createHttpError(message, statusCode);
  error.code = code;
  return error;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function lineOf(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

/** The closest stretch of the file to a failed anchor, so the model can fix itself. */
const CONTEXT_SCAN_CHARS = 200000;

function nearestContext(text, wanted) {
  if (!wanted) return "";
  const target = wanted.slice(0, 120);
  const haystack = text.length > CONTEXT_SCAN_CHARS ? text.slice(0, CONTEXT_SCAN_CHARS) : text;
  // Bounded scan: at most ~50k comparisons, so a huge file cannot stall the run.
  const positions = Math.max(1, Math.min(haystack.length - target.length, 50000));
  const step = Math.max(1, Math.floor((haystack.length - target.length) / positions) || 1);
  let best = { score: -1, index: 0 };
  for (let index = 0; index + target.length <= haystack.length; index += step) {
    let matches = 0;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (haystack[index + offset] === target[offset]) matches += 1;
    }
    const score = matches / target.length;
    if (score > best.score) best = { score, index };
    if (best.score > 0.9) break;
  }
  if (best.score <= 0) return "";
  const start = Math.max(0, best.index - 200);
  const end = Math.min(haystack.length, best.index + 400);
  return haystack.slice(start, end);
}

function normaliseEdits(edits) {
  const list = Array.isArray(edits) ? edits : edits ? [edits] : [];
  if (list.length === 0) throw reject("A patch needs at least one edit.", 400, "NO_EDITS");
  if (list.length > MAX_EDITS_PER_CALL) {
    throw reject(`A patch may contain at most ${MAX_EDITS_PER_CALL} edits.`, 400, "TOO_MANY_EDITS");
  }
  return list.map((edit, index) => {
    const op = String(edit?.op || "").trim();
    if (!op) throw reject(`Edit ${index + 1} has no "op".`, 400, "MISSING_OP");
    return { op, ...edit, index };
  });
}

function requireString(value, label, editIndex) {
  if (typeof value !== "string" || value.length === 0) {
    throw reject(`Edit ${editIndex + 1} is missing "${label}".`, 400, "MISSING_FIELD");
  }
  return value;
}

/**
 * Apply a list of targeted edits to one file.
 * Edits apply in order against the text as it evolves, so several edits to the
 * same file can be sent in a single round trip.
 */
async function applyFilePatch({ root, filePath, edits, expectedModifiedAt, create = false }) {
  if (!root || !filePath) throw reject("A granted folder and a file path are required.", 400, "MISSING_TARGET");
  const normalised = normaliseEdits(edits);

  const { targetPath } = await resolveInsideRoot({ root, targetPath: filePath, allowMissing: true });

  let exists = true;
  let currentStat = null;
  try {
    currentStat = await fsp.stat(targetPath);
  } catch {
    exists = false;
  }

  if (exists && create) throw reject("That file already exists. Patch it instead of creating it.", 409, "ALREADY_EXISTS");
  if (!exists && !create) {
    const allowedOnMissing = normalised.every((edit) => ["append", "prepend", "set"].includes(edit.op));
    if (!allowedOnMissing) throw reject("That file does not exist. Create it first, or use append/prepend.", 404, "FILE_MISSING");
  }
  if (expectedModifiedAt && exists && currentStat.mtime.toISOString() !== expectedModifiedAt) {
    throw reject("File was modified by another writer.", 409, "STALE_FILE");
  }
  if (exists && currentStat.size > MAX_FILE_BYTES) {
    throw reject("That file is too large to patch safely.", 413, "FILE_TOO_LARGE");
  }

  const original = exists ? await fsp.readFile(targetPath, "utf8") : "";
  let text = original;
  const applied = [];
  const lineEnding = /\r\n/.test(original) ? "\r\n" : "\n";
  const normaliseNewlines = (value) => (lineEnding === "\r\n" ? String(value).replace(/\r?\n/g, "\r\n") : String(value).replace(/\r\n/g, "\n"));

  for (const edit of normalised) {
    const at = edit.index;
    if (edit.op === "set") {
      text = normaliseNewlines(requireString(edit.content ?? edit.text, "content", at));
      applied.push({ op: "set", bytes: text.length });
      continue;
    }
    if (edit.op === "replace") {
      const oldText = normaliseNewlines(requireString(edit.old, "old", at));
      const newText = normaliseNewlines(String(edit.new ?? edit.content ?? ""));
      const occurrences = countOccurrences(text, oldText);
      const expected = Number(edit.count || edit.expected || 0);
      if (occurrences === 0) {
        throw reject(
          `Edit ${at + 1}: the text to replace was not found in ${filePath}. Nothing was written. Match it exactly, including indentation, or read the file again. Closest text in the file:\n---\n${nearestContext(text, oldText)}\n---`,
          422,
          "ANCHOR_NOT_FOUND",
        );
      }
      if (occurrences > 1 && expected !== occurrences) {
        throw reject(
          `Edit ${at + 1}: the text to replace appears ${occurrences} times in ${filePath} (lines ${lineOf(text, text.indexOf(oldText))}+). Add more surrounding lines so it is unique, or set "count" to ${occurrences}. Nothing was written.`,
          422,
          "AMBIGUOUS_ANCHOR",
        );
      }
      const replaceAll = expected === occurrences && occurrences > 1;
      text = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, () => newText);
      applied.push({ op: "replace", occurrences, line: lineOf(original, original.indexOf(oldText)) || null });
      continue;
    }
    if (edit.op === "delete") {
      const oldText = normaliseNewlines(requireString(edit.old ?? edit.text, "old", at));
      const occurrences = countOccurrences(text, oldText);
      if (occurrences === 0) {
        throw reject(`Edit ${at + 1}: the text to delete was not found in ${filePath}. Nothing was written.`, 422, "ANCHOR_NOT_FOUND");
      }
      if (occurrences > 1 && Number(edit.count || 0) !== occurrences) {
        throw reject(`Edit ${at + 1}: the text to delete appears ${occurrences} times. Make it unique or set "count". Nothing was written.`, 422, "AMBIGUOUS_ANCHOR");
      }
      text = occurrences > 1 ? text.split(oldText).join("") : text.replace(oldText, () => "");
      applied.push({ op: "delete", occurrences });
      continue;
    }
    if (edit.op === "insert_after" || edit.op === "insert_before") {
      const anchor = normaliseNewlines(requireString(edit.anchor, "anchor", at));
      const insert = normaliseNewlines(requireString(edit.text ?? edit.content, "text", at));
      const occurrences = countOccurrences(text, anchor);
      if (occurrences === 0) {
        throw reject(
          `Edit ${at + 1}: the anchor was not found in ${filePath}. Nothing was written. Closest text in the file:\n---\n${nearestContext(text, anchor)}\n---`,
          422,
          "ANCHOR_NOT_FOUND",
        );
      }
      if (occurrences > 1 && Number(edit.count || 0) !== occurrences) {
        throw reject(`Edit ${at + 1}: the anchor appears ${occurrences} times in ${filePath}. Make it unique or set "count". Nothing was written.`, 422, "AMBIGUOUS_ANCHOR");
      }
      if (occurrences > 1) {
        text = text.split(anchor).join(edit.op === "insert_after" ? anchor + insert : insert + anchor);
      } else {
        const position = edit.op === "insert_after" ? text.indexOf(anchor) + anchor.length : text.indexOf(anchor);
        text = text.slice(0, position) + insert + text.slice(position);
      }
      applied.push({ op: edit.op, line: lineOf(text, text.indexOf(anchor)) || null });
      continue;
    }
    if (edit.op === "append") {
      const insert = normaliseNewlines(requireString(edit.text ?? edit.content, "text", at));
      text = text.length === 0 || text.endsWith("\n") ? text + insert : text + lineEnding + insert;
      applied.push({ op: "append" });
      continue;
    }
    if (edit.op === "prepend") {
      const insert = normaliseNewlines(requireString(edit.text ?? edit.content, "text", at));
      text = text.length === 0 ? insert : insert + (insert.endsWith("\n") ? "" : lineEnding) + text;
      applied.push({ op: "prepend" });
      continue;
    }
    throw reject(`Edit ${at + 1}: unsupported patch op "${edit.op}". Use set, replace, delete, insert_after, insert_before, append or prepend.`, 400, "UNSUPPORTED_OP");
  }

  if (text === original) {
    return {
      path: filePath,
      changed: false,
      saved: false,
      message: "The patch produced no change, so nothing was written.",
      applied,
    };
  }

  const directory = path.dirname(targetPath);
  await fsp.mkdir(directory, { recursive: true });
  const tempFile = `${targetPath}.patch-tmp.${process.pid}.${Date.now()}`;
  await fsp.writeFile(tempFile, text, "utf8");
  await fsp.rename(tempFile, targetPath);
  const savedStat = await fsp.stat(targetPath);

  return {
    path: filePath,
    changed: true,
    saved: true,
    created: !exists,
    applied,
    bytes: savedStat.size,
    linesBefore: original ? original.split("\n").length : 0,
    linesAfter: text.split("\n").length,
    modifiedAt: savedStat.mtime.toISOString(),
  };
}

module.exports = { applyFilePatch, countOccurrences, nearestContext, MAX_EDITS_PER_CALL };
