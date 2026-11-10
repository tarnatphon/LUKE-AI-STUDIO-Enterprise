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

const { bytesToGib } = require("./size-units.cjs");

function basename(value) {
  return String(value || "").split(/[\\/]/).pop().trim().toLowerCase();
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
      const sizeGb = bytesToGib(variant?.sizeBytes);
      if (!sizeGb || sizeGb < floor || sizeGb > cap) continue;
      const minRamGb = bytesToGib(variant?.minimumRamBytes);
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

const TERMINAL_STATES = new Set(["completed", "cancelled", "failed", "skipped"]);

/**
 * The download of the suggested model, if there is one, as the panel needs it.
 *
 * The button queues a download in Text Models; without this the user has to go
 * to another tab to find out whether it is happening, and coming back to a card
 * that still says "no small model" is exactly the confusion this whole thread
 * started with. Matching on modelId+variantId (not on the filename) means a
 * re-download of the same file is still recognised.
 */
function describeDownload(items = [], suggestion = null) {
  if (!suggestion || !suggestion.modelId) return null;
  const list = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.modelId === suggestion.modelId && item.variantId === suggestion.variantId,
  );
  if (!list.length) return null;
  // The queue appends, so the last matching entry is the current one.
  const item = list[list.length - 1];
  const state = String(item.state || "queued");
  const totalBytes = Number(item.progress?.totalBytes ?? item.sizeBytes) || 0;
  const downloadedBytes = Number(item.progress?.downloadedBytes) || 0;
  const reported = Number(item.progress?.percent);
  const percent = Number.isFinite(reported) && reported > 0
    ? Math.max(0, Math.min(100, Math.round(reported)))
    : totalBytes > 0 && downloadedBytes > 0
      ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
      : 0;
  return {
    state,
    active: !TERMINAL_STATES.has(state),
    percent,
    downloadedBytes,
    totalBytes,
    speedBytesPerSecond: Number(item.progress?.speedBytesPerSecond) || 0,
    queuePosition: Number(item.queuePosition) || 0,
    filename: String(item.filename || suggestion.filename || ""),
    error: item.error ? String(item.error).slice(0, 300) : null,
    updatedAt: item.updatedAt || null,
  };
}

module.exports = {
  chooseSuggestion,
  describeDownload,
  bytesToGib,
};
