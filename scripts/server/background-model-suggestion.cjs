"use strict";

/**
 * When the machine has no small model, say which one to download.
 *
 * The Products tab can now tell the user that its translations are falling back
 * to a 5 GB chat model because no 1–3B model is installed. Telling somebody a
 * problem exists and leaving them to find a GGUF on the internet is half an
 * answer: the app already ships a signed catalog of exactly the models it can
 * download, queue and verify itself.
 *
 * So the same rule that picks a model at run time picks the one to offer here —
 * the smallest catalog entry that is inside the background cap and not already
 * on disk, and that this machine has the RAM to run. Nothing is downloaded
 * without a click: this module only decides what the button would say.
 *
 * Pure by construction (catalog and installed list arrive as arguments), so the
 * choice can be tested without a catalog file, a model folder or a network.
 */

const GIB = 1024 ** 3;

function basename(value) {
  return String(value || "").split(/[\\/]/).pop().trim().toLowerCase();
}

function roundGb(bytes) {
  const value = Number(bytes);
  return Number.isFinite(value) && value > 0 ? Math.round((value / GIB) * 100) / 100 : 0;
}

/**
 * @param {object} options
 * @param {object|null} [options.catalog]  the signed text-model catalog
 * @param {string[]} [options.installed]   filenames already in app/llm-models
 * @param {number} [options.maxSizeGb]     the background cap (from the policy)
 * @param {number} [options.minSizeGb]
 * @param {number} [options.totalRamGb]    this machine's RAM, 0 when unknown
 * @param {number} [options.reserveGb]     RAM that must stay free for everything else
 * @returns {{suggestion: object|null, reason: string, candidates: object[]}}
 */
function chooseSuggestion({
  catalog = null,
  installed = [],
  maxSizeGb = 3.2,
  minSizeGb = 0.2,
  totalRamGb = 0,
  reserveGb = 1.5,
} = {}) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const have = new Set((Array.isArray(installed) ? installed : []).map(basename).filter(Boolean));
  const cap = Number(maxSizeGb) > 0 ? Number(maxSizeGb) : 3.2;
  const floor = Number(minSizeGb) > 0 ? Number(minSizeGb) : 0.2;
  const ram = Number(totalRamGb) > 0 ? Number(totalRamGb) : 0;
  const reserve = Number.isFinite(Number(reserveGb)) ? Math.max(0, Number(reserveGb)) : 1.5;

  const candidates = [];
  for (const model of models) {
    const label = String(model?.name?.en || model?.name?.th || model?.id || "").trim();
    for (const variant of Array.isArray(model?.variants) ? model.variants : []) {
      const filename = String(variant?.filename || "").trim();
      if (!filename || !/\.gguf$/i.test(filename)) continue;
      if (have.has(basename(filename))) continue; // already downloaded
      const sizeGb = roundGb(variant?.sizeBytes);
      if (!sizeGb || sizeGb < floor || sizeGb > cap) continue;
      const minRamGb = roundGb(variant?.minimumRamBytes);
      // A suggestion that cannot run on this machine is not a suggestion.
      if (ram > 0 && minRamGb > 0 && minRamGb > ram - reserve) continue;
      candidates.push({
        modelId: String(model?.id || "").trim(),
        variantId: String(variant?.id || "").trim(),
        filename,
        label: label || filename,
        quantization: String(variant?.quantization || "").trim(),
        sizeGb,
        minRamGb,
      });
    }
  }

  candidates.sort((left, right) => left.sizeGb - right.sizeGb || left.filename.localeCompare(right.filename));

  if (!candidates.length) {
    return {
      suggestion: null,
      reason: `the catalog has no model between ${floor} and ${cap} GB that is not already downloaded and can run on this machine`,
      candidates: [],
    };
  }

  const chosen = candidates[0];
  return {
    suggestion: chosen,
    reason: `${chosen.label} ${chosen.quantization || ""}`.trim() +
      ` (${chosen.sizeGb} GB) is the smallest catalog model inside the ${cap} GB background cap`,
    candidates,
  };
}

module.exports = {
  chooseSuggestion,
  roundGb,
};
