"use strict";

/**
 * Which vision projector belongs to which model.
 *
 * A projector (`mmproj-*.gguf`) is the vision encoder those specific weights
 * were trained with. It is not interchangeable: llama.cpp will either refuse a
 * projector whose CLIP metadata does not match, or accept it and answer image
 * questions from a model that never saw this one.
 *
 * The old selection ended with
 *
 *   bestMatch = files.find(file => lower.includes("mmproj"))
 *
 * which turns "I have no projector for this model" into "here is somebody
 * else's". On a machine holding `mmproj-Qwen3VL-8B-Instruct-F16.gguf`,
 * `gemma-4-12b-it-uncensored-Q3_K_M.gguf` was launched with the Qwen projector
 * attached, and the UI then reported vision as available. Nothing about that
 * pairing is true.
 *
 * So: the model's family token has to appear in the projector's name. When
 * nothing matches, no projector is passed at all and the caller says so — the
 * honest "Matching mmproj projector not found" that the fallback made
 * unreachable.
 */

const path = require("node:path");

/**
 * Family tokens as they appear in filenames (lowercased). One list, used for
 * both sides of the comparison, because two lists is how the two sides drift.
 */
const PROJECTOR_FAMILIES = [
  "gemma-4",
  "gemma4",
  "gemma-3",
  "gemma3",
  "llava",
  "qwen2vl",
  "qwen2-vl",
  "qwen3vl",
  "qwen3-vl",
  "qwen3.5-4b-vision",
  "paligemma",
  "minicpm",
  "internvl",
  "phi-3",
  "phi3",
  "smolvlm",
  "moondream",
];

function lowerName(value) {
  return String(value || "").toLowerCase();
}

/** Family tokens present in a filename, in list order. */
function familiesIn(name) {
  const lower = lowerName(name);
  return PROJECTOR_FAMILIES.filter((token) => lower.includes(token));
}

function isProjectorFile(name) {
  const lower = lowerName(name);
  return lower.endsWith(".gguf") && lower.includes("mmproj");
}

/**
 * Pick the projector for `modelFilename` out of `files` (bare names in the
 * models folder).
 *
 * Returns `{ filename, reason, warning }`:
 *   filename — a name from `files`, or null for "none belongs to this model"
 *   reason   — why, in words that can be shown to the user
 *   warning  — set when the pairing is doubtful; the caller prints it
 */
function chooseProjector({ modelFilename, files = [], explicit = "" } = {}) {
  const model = path.basename(String(modelFilename || ""));
  const projectors = files.filter(isProjectorFile);
  const modelFamilies = familiesIn(model);

  // An explicit choice from Settings is the user's, so it is honoured — but a
  // projector from another family is said out loud rather than obeyed silently.
  if (explicit) {
    const name = path.basename(String(explicit));
    if (files.includes(name)) {
      const chosenFamilies = familiesIn(name);
      const shared = chosenFamilies.filter((token) => modelFamilies.includes(token));
      const warning =
        chosenFamilies.length && !shared.length
          ? `${name} is a ${chosenFamilies.join("/")} projector, but ${model} is ${
              modelFamilies.length ? modelFamilies.join("/") : "not a vision family"
            } — image answers will be wrong; pick the projector shipped with this model`
          : "";
      return { filename: name, reason: "chosen in Settings", warning };
    }
  }

  if (!projectors.length) {
    return { filename: null, reason: "No mmproj projector in the models folder", warning: "" };
  }

  // 1. Same Hugging Face repository, e.g. `unsloth--gemma-4-12b-it-GGUF--model.gguf`
  //    keeps its projector in the same `owner--repo--` prefix.
  const separator = model.lastIndexOf("--");
  if (separator > 0) {
    const prefix = model.slice(0, separator + 2);
    const sameRepo = projectors.find((file) => file.startsWith(prefix));
    if (sameRepo) return { filename: sameRepo, reason: "same repository", warning: "" };
  }

  // 2. Same family token on both names.
  for (const token of modelFamilies) {
    const match = projectors.find((file) => lowerName(file).includes(token));
    if (match) return { filename: match, reason: `same family (${token})`, warning: "" };
  }

  // 3. Nothing matches. Say so; do not borrow somebody else's encoder.
  const named = projectors.slice(0, 3).join(", ");
  return {
    filename: null,
    reason: modelFamilies.length
      ? `No ${modelFamilies.join("/")} projector found (present: ${named})`
      : `Model name names no vision family, so no projector can be matched (present: ${named})`,
    warning: "",
  };
}

module.exports = { chooseProjector, familiesIn, isProjectorFile, PROJECTOR_FAMILIES };
