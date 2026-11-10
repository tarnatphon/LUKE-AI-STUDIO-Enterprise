"use strict";

/**
 * Sizes in GiB, and the one place they are rounded.
 *
 * What went wrong without this
 * ----------------------------
 * Four modules defined their own `roundGb` and two of them meant different
 * things by the argument: `serve.cjs`, `model-load-guard.cjs` and
 * `background-model-suggestion.cjs` took *bytes* and divided by 1024³, while
 * `gpu-memory-telemetry.cjs` took a number that was *already* in GB and only
 * rounded it. Same name, two units, and nothing at a call site said which.
 *
 * It had already fired. `makeRoomForLoad()` builds its shortfall out of
 * `budget.estimateGb - budget.availableGb` — a difference of two GB figures —
 * and then passed it through the byte version, so a 4 GB gap became
 * 4 / 1073741824 = 0.00 GB. `planMakeRoom({ shortfallGb: 0 })` answers
 * NO_SHORTFALL, "the load already fits", and the governor — the code that
 * exists so a loading model can take room from an engine that reloads on
 * demand — never made room for anything. Every blocking load was refused with
 * advice to unload something by hand.
 *
 * The names now carry the unit: `bytesToGib` takes bytes, `gibRounded` takes
 * GiB, and `gbShortfall` does the subtraction in GB where the budget lives.
 */

/** 1024³ — a binary gigabyte, which is what every "GB" in this app means. */
const GIB = 1024 ** 3;

/**
 * Round a figure that is already in GiB.
 *
 * @param {number} gib
 * @param {number} [decimals] 2 for display sizes, 1 where a tenth is enough
 * @returns {number} 0 for anything that is not a finite number
 */
function gibRounded(gib, decimals = 2) {
  const value = Number(gib);
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/**
 * Bytes to rounded GiB. Negative and unreadable sizes become 0 — a size of
 * "unknown" reads as zero everywhere it is used, and never as NaN, which used
 * to reach JSON as `null` and print as "null GB".
 *
 * @param {number} bytes
 * @param {number} [decimals]
 * @returns {number}
 */
function bytesToGib(bytes, decimals = 2) {
  const value = Number(bytes);
  return Number.isFinite(value) && value > 0 ? gibRounded(value / GIB, decimals) : 0;
}

/**
 * How much a load is short of, in GB.
 *
 * Both arguments come from the memory budget, which is already in GB. Do not
 * hand bytes to this — that is the mistake this module was written for.
 *
 * @param {number} estimateGb  what the load needs
 * @param {number} availableGb what is free
 * @param {number} [decimals]
 * @returns {number} 0 when the load fits
 */
function gbShortfall(estimateGb, availableGb, decimals = 2) {
  const need = Number(estimateGb) || 0;
  const have = Number(availableGb) || 0;
  return gibRounded(Math.max(0, need - have), decimals);
}

module.exports = {
  GIB,
  bytesToGib,
  gbShortfall,
  gibRounded,
};
