"use strict";

/**
 * Do not start two heavy models at the same time.
 *
 * What went wrong without this
 * ---------------------------
 * The memory budget already refuses a load that cannot fit, and it does that by
 * counting what is *resident*. A model that is still loading is not resident
 * yet, so on an 18 GB Mac the image model spent fourteen minutes pouring a
 * 6.6 GB SDXL out of a slow external disk, and in the middle of that the chat
 * model was started on top of it. Both were "not resident" from the budget's
 * point of view, so nothing was refused; what actually happened was 5 GB of
 * swap, a 5 GB memory compressor, and llama.cpp giving up after three minutes
 * without ever answering a request.
 *
 * Two separate mistakes, so two separate answers:
 *
 *   1. in-flight bytes — a model on its way in is already holding memory, so
 *      it must be counted by `residentHeavyModelBytes()` while it loads;
 *   2. a start guard — the second load waits for the first one to finish,
 *      because two models being read and converted at once is the peak that
 *      breaks the machine, not the steady state afterwards.
 *
 * The guard is deliberately not a refusal. Waiting a few minutes is invisible;
 * a refused load looks like a broken app. When the wait runs out it says so in
 * one line and starts anyway, so a stuck backend can never wedge the app.
 *
 * Everything here is pure: the clock, the flags and the sizes arrive as
 * arguments, so a machine that swaps can be tested without one.
 */

const DEFAULT_WAIT_MS = 5 * 60 * 1000;
const GIB = 1024 ** 3;

function roundGb(bytes) {
  const value = Number(bytes);
  return Number.isFinite(value) && value > 0 ? Math.round((value / GIB) * 10) / 10 : 0;
}

function roundMinutes(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.round(value / 60000));
}

/**
 * Bytes held by models that are loading right now.
 *
 * An entry is `{ loading, bytes }`; anything that has finished loading is
 * already counted by the caller as resident and must not be added twice.
 */
function inFlightBytes(entries = []) {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, entry) => {
    if (!entry || entry.loading !== true) return sum;
    const bytes = Number(entry.bytes);
    return sum + (Number.isFinite(bytes) && bytes > 0 ? bytes : 0);
  }, 0);
}

/**
 * What to do before starting `target` while `other` may still be loading.
 *
 * @param {object} options
 * @param {"text"|"image"} [options.target]
 * @param {boolean} [options.otherLoading]  the other engine is mid-load
 * @param {string}  [options.otherLabel]    what to call it in the log line
 * @param {number}  [options.otherGb]       what it is loading, in GB
 * @param {number}  [options.waitedMs]      how long we have waited already
 * @param {number}  [options.waitMs]        the budget for waiting
 * @returns {{action: "proceed"|"wait", timedOut?: boolean, waitedMs: number,
 *            waitMs: number, remainingMs: number, otherGb: number, reason: string}}
 */
function planLoadStart({
  target = "text",
  otherLoading = false,
  otherLabel = "",
  otherGb = 0,
  waitedMs = 0,
  waitMs = DEFAULT_WAIT_MS,
} = {}) {
  const other = target === "text" ? "image" : "text";
  const label = String(otherLabel || "").trim() || `the ${other} model`;
  const limit = Math.max(0, Number(waitMs) || 0);
  const waited = Math.max(0, Number(waitedMs) || 0);
  const sizeGb = Number.isFinite(Number(otherGb)) && Number(otherGb) > 0 ? Number(otherGb) : 0;
  const base = { waitedMs: waited, waitMs: limit, remainingMs: 0, otherGb: sizeGb };

  if (otherLoading !== true) {
    return {
      ...base,
      action: "proceed",
      reason: `nothing else is loading — ${target} starts now`,
    };
  }

  // Waiting is the default; a zero budget is an explicit "never wait".
  if (limit === 0) {
    return {
      ...base,
      action: "proceed",
      timedOut: true,
      reason: `${label} is still loading${sizeGb ? ` (${sizeGb} GB)` : ""} — the wait is switched off, starting ${target} anyway`,
    };
  }

  if (waited >= limit) {
    return {
      ...base,
      action: "proceed",
      timedOut: true,
      reason: `${label} is still loading after ${roundMinutes(waited)} min${sizeGb ? ` (${sizeGb} GB)` : ""} — starting ${target} anyway, which may make the machine swap`,
    };
  }

  return {
    ...base,
    action: "wait",
    remainingMs: limit - waited,
    reason: `${label} is loading${sizeGb ? ` (${sizeGb} GB)` : ""} — waiting up to ${roundMinutes(limit)} min so both do not load at once`,
  };
}

/**
 * The waiting itself, with its clock and its sleep injected.
 *
 * serve.cjs has the flags, the byte counts and the log; this has the loop, so
 * "it waits, then starts anyway" can be tested in milliseconds instead of five
 * minutes, on a machine that is not short of memory.
 *
 * @param {object} options
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.now]
 * @param {() => boolean} [options.isOtherLoading]
 * @param {() => number} [options.otherBytes]
 * @param {(plan: object, first: boolean) => void} [options.onWait]  called once per new state
 * @param {(plan: object) => void} [options.onDone]
 */
async function waitForOtherLoad({
  target = "text",
  otherLabel = "",
  waitMs = DEFAULT_WAIT_MS,
  pollMs = 2000,
  isOtherLoading = () => false,
  otherBytes = () => 0,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  onWait = null,
  onDone = null,
} = {}) {
  const startedAt = now();
  let announced = false;
  let plan = null;
  for (;;) {
    const loading = isOtherLoading() === true;
    const bytes = Number(otherBytes()) || 0;
    plan = planLoadStart({
      target,
      otherLoading: loading,
      otherLabel,
      otherGb: roundGb(bytes),
      waitedMs: now() - startedAt,
      waitMs,
    });
    if (plan.action !== "wait") {
      if (onDone) onDone(plan);
      return plan;
    }
    if (!announced) {
      announced = true;
      if (onWait) onWait(plan, true);
    }
    await sleep(Math.max(0, Number(pollMs) || 0));
  }
}

module.exports = {
  DEFAULT_WAIT_MS,
  inFlightBytes,
  planLoadStart,
  roundGb,
  waitForOtherLoad,
};
