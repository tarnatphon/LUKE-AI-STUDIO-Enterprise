"use strict";

/**
 * Hardware sampling only while somebody is watching.
 *
 * Why this exists
 * ---------------
 * The performance monitor sampled the machine every five seconds for as long as
 * the server ran, whether or not anybody was looking at it: `vm_stat` on macOS,
 * `nvidia-smi` on Windows/Linux, and — the expensive one — a whole
 * `llama-server --list-devices` process, which initialises Vulkan or CUDA before
 * it prints two numbers and exits. With the browser closed the app still woke
 * the GPU stack twelve times a minute, forever, on a machine that may be running
 * a model at the time.
 *
 * The frontend only asks `/api/telemetry` while its tab is visible, so "a client
 * asked recently" is a faithful proxy for "somebody is looking at these
 * numbers". Each sampler calls `allow()` before it spawns anything:
 *
 *   - no client for longer than the window → the sample is skipped and the last
 *     reading is kept, so a returning client is answered immediately instead of
 *     waiting for the next tick;
 *   - the transition is logged once in each direction, because a monitor whose
 *     numbers quietly stop moving looks broken if the log does not say why.
 *
 * The window is deliberately longer than the frontend's background keep-alive
 * and shorter than the time it takes a user to notice a stale number: a tab that
 * is hidden stops asking, sampling pauses half a minute later, and the poll the
 * tab makes on becoming visible wakes it again.
 *
 * Pure and clock-injected, so the pause/resume behaviour is testable without
 * waiting thirty seconds — or without a GPU to sample.
 */

const DEFAULT_WINDOW_MS = 30000;

class TelemetryDemand {
  constructor(options = {}) {
    this.windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : DEFAULT_WINDOW_MS;
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.logger = options.logger || console;
    // null, not 0: a zero timestamp is a legitimate reading from an injected
    // clock, and using it as "nobody has ever asked" made the first note() on a
    // fake clock look like no note at all.
    this.lastRequestAt = null;
    this.samplesTaken = 0;
    this.samplesSkipped = 0;
    this.lastAllowed = null;
  }

  /** A client asked for telemetry. Called from the route, on every request. */
  note() {
    this.lastRequestAt = this.now();
    return this;
  }

  /** Is anybody watching right now? Never true before the first request. */
  wanted() {
    return this.lastRequestAt !== null && this.now() - this.lastRequestAt < this.windowMs;
  }

  /** How long since a client asked; Infinity when none ever has. */
  idleFor() {
    return this.lastRequestAt === null ? Infinity : Math.max(0, this.now() - this.lastRequestAt);
  }

  /**
   * The gate every sampler goes through before spawning a process.
   * `name` only appears in the log line that says what was paused.
   */
  allow(name = "hardware sampler") {
    const wanted = this.wanted();
    if (wanted) {
      this.samplesTaken += 1;
    } else {
      this.samplesSkipped += 1;
    }
    if (wanted !== this.lastAllowed) {
      this.lastAllowed = wanted;
      if (wanted) {
        this.logger.log?.("  [telemetry] a client is watching — hardware sampling resumed.");
      } else {
        const idleSeconds = Number.isFinite(this.idleFor()) ? Math.round(this.idleFor() / 1000) : null;
        this.logger.log?.(
          `  [telemetry] nobody has asked for ${idleSeconds === null ? "a while" : `${idleSeconds}s`} — ` +
            `hardware sampling paused (${name} and the rest). It resumes with the next request.`
        );
      }
    }
    return wanted;
  }

  /** Forced samples (start-up, a backend finishing a load) bypass the gate. */
  noteForced() {
    this.samplesTaken += 1;
    return this;
  }

  status() {
    return {
      watched: this.wanted(),
      windowMs: this.windowMs,
      idleForMs: Number.isFinite(this.idleFor()) ? this.idleFor() : null,
      samplesTaken: this.samplesTaken,
      samplesSkipped: this.samplesSkipped,
    };
  }
}

module.exports = {
  DEFAULT_WINDOW_MS,
  TelemetryDemand,
};
