"use strict";

/**
 * What llama.cpp actually said when a load failed.
 *
 * What went wrong without this
 * ----------------------------
 * The stderr handler kept the *last* chunk that matched /error|failed/:
 *
 *     llmError = output.trim().slice(-1200);
 *
 * llama.cpp prints the reason first and then signs off, so the last match is
 * always the sign-off. A user loading a model that could not be read was told:
 *
 *     Text model failed on all available llama.cpp backends.
 *     Last failure: 0.00.457.536 E srv  llama_server: exiting due to model loading error
 *
 * — a timestamp, a log level and a restatement of the fact that it failed. The
 * sentence that named the cause ("error loading model: unknown model
 * architecture", "failed to allocate buffer", "invalid magic") had already been
 * printed, matched, and overwritten.
 *
 * So the first complaints are the ones kept, in the order llama.cpp made them,
 * while a bounded tail is still available in case nothing matched.
 */

/** Enough for several real lines, small enough to sit in a dialog. */
const DEFAULT_LIMIT = 2000;

/** Lines worth quoting: an error that is not the "no error" reassurance. */
function errorLinesFrom(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /error|failed|invalid|unsupported|cannot|unable/i.test(line) && !/no error/i.test(line));
}

/**
 * Add what is new to the lines already kept.
 *
 * @param {string[]} existing
 * @param {string} output  one stderr/stdout chunk
 * @param {{limit?: number}} [options]
 * @returns {string[]} the lines to keep — earliest first, bounded by characters
 */
function appendErrorLines(existing, output, { limit = DEFAULT_LIMIT } = {}) {
  const kept = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(kept);
  let size = kept.join("\n").length;
  for (const line of errorLinesFrom(output)) {
    if (seen.has(line)) continue;
    // The newline that joins it counts too, or the result lands one over.
    const separator = kept.length > 0 ? 1 : 0;
    const room = limit - size - separator;
    if (room <= 1) break;
    // A single monstrous line is cut, not dropped: the start is the useful half.
    const entry = line.length > room ? `${line.slice(0, room - 1)}…` : line;
    kept.push(entry);
    seen.add(line);
    size += separator + entry.length;
  }
  return kept;
}

/**
 * The architecture llama.cpp said it does not know, if that is what it said.
 *
 * Extracted in one place because two readers need it: the advice below, and the
 * ledger in backend-architecture-limits.cjs that warns about the same model
 * before the next load instead of after it.
 */
function unknownArchitecture(text) {
  const match = /unknown model architecture: *["']?([A-Za-z0-9._-]+)["']?/.exec(String(text ?? ""));
  return match ? match[1] : null;
}

/**
 * What to do about the line llama.cpp printed.
 *
 * The cause alone still leaves the reader to translate it. The three failures
 * seen on real machines each have one remedy, and none of them is "try again".
 *
 * @param {string} text  the error text as stored
 * @returns {string} a sentence of advice, or "" when nothing is recognised
 */
function explainFailure(text) {
  const lines = String(text ?? "");
  const architecture = unknownArchitecture(lines);
  if (architecture) {
    return `This build of llama.cpp does not know the '${architecture}' architecture, so it is older than the model. ` +
      "Update the text backend with scripts/setup/setup-llama.sh and LLAMA_RELEASE set to a newer build, then restart the app.";
  }
  if (/bad magic|invalid magic|not a GGUF|failed to read (?:the )?(?:model|file)|unexpected end of file/i.test(lines)) {
    return "The file could not be read as a model: it is truncated or not a GGUF. Download it again.";
  }
  const missingTensor = /missing tensor '([^']+)'/.exec(lines);
  if (missingTensor) {
    const layer = /^blk\.(\d+)\./.exec(missingTensor[1]);
    return `The model file does not contain ${missingTensor[1]}, which its own metadata says it should. ` +
      "That is a bad conversion or a truncated download rather than a memory problem: download the model again or pick another quant. " +
      "To see which tensors the file really holds, run: node scripts/tools/gguf-tensors.cjs " +
      `<model.gguf> --want ${missingTensor[1]}` + (layer ? ` (layer ${layer[1]})` : "");
  }
  if (/failed to allocate|out of memory|cannot allocate|not enough memory/i.test(lines)) {
    return "It does not fit in memory. Lower the context size or the GPU layers in Model settings, or unload another model first.";
  }
  if (/error loading model: .*projector|mmproj/i.test(lines) && /error/i.test(lines)) {
    return "The vision projector does not match this model. Pick the model again so its own mmproj-*.gguf is used, or load it as text-only.";
  }
  return "";
}

module.exports = {
  DEFAULT_LIMIT,
  appendErrorLines,
  errorLinesFrom,
  explainFailure,
  unknownArchitecture,
};
