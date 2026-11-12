"use strict";

/**
 * How long a model will take to load, measured instead of guessed.
 *
 * A 9 GB checkpoint on an exFAT volume, with `--no-mmap` (which exFAT needs —
 * mmap reads a checkpoint one page fault at a time there), is read *in full*
 * every time it is loaded. That is the whole load time on a slow external disk:
 * everything else llama.cpp does — parsing the header, allocating the tensors,
 * copying them to the GPU — is seconds. The user sees a spinner and a terminal
 * that says "cache it to load it faster" — true, unquantified, and (until the
 * cache card learned to say where it lives) pointing at a Settings entry the
 * sidebar does not have.
 *
 * So measure the source volume once per file, with a short sequential read that
 * is exactly the access pattern of the load, and say the number:
 *
 *     [llm] Reading 9.0 GB from AI at about 78 MB/s — roughly 118 s before the
 *           model answers, every load. Cache it once from the text model card,
 *           or in Settings → Text Generation → Performance ...
 *
 * Nothing here changes what the app does; it changes what it says. The estimate
 * is a floor (the file is read sequentially at the speed the volume just
 * demonstrated), not a promise, and the actual duration is reported next to it
 * when the load finishes so the two can be compared.
 *
 * The read is bounded: 64 MB by default, a few hundred milliseconds on a healthy
 * volume, and it is cached per file (path + size + mtime) for the life of the
 * process, so repeated loads cost nothing.
 */

const fs = require("node:fs");

const DEFAULT_SAMPLE_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
/** Below this, the estimate is not worth a spinner-width of text. */
const WORTH_MEASURING_BYTES = 512 * 1024 * 1024;

const measured = new Map();

function gb(bytes) {
  return `${(Number(bytes || 0) / 1024 ** 3).toFixed(1)} GB`;
}

function mbPerSecond(bytesPerSecond) {
  return Math.max(0, Math.round(Number(bytesPerSecond || 0) / 1024 ** 2));
}

function secondsText(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  if (value < 60) return `${value} s`;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * Sequential read speed of the volume `filePath` is on.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {number} [options.bytes]     how much to read
 * @param {number} [options.chunkSize]
 * @param {Function} [options.now]     returns milliseconds; injectable for tests
 * @param {object} [options.fs]        the fs module to use; injectable for tests
 * @returns {{bytesPerSecond: number, bytesRead: number, ms: number}|null}
 */
function measureReadSpeed(filePath, { bytes = DEFAULT_SAMPLE_BYTES, chunkSize = CHUNK_BYTES, now = () => Date.now(), fs: fsImpl = fs } = {}) {
  let fd = null;
  try {
    const stats = fsImpl.statSync(filePath);
    if (!stats.isFile()) return null;
    const want = Math.max(1, Math.min(bytes, stats.size));
    const buffer = Buffer.alloc(Math.min(chunkSize, want));
    fd = fsImpl.openSync(filePath, "r");
    const started = now();
    let read = 0;
    while (read < want) {
      const wantNow = Math.min(buffer.length, want - read);
      const got = fsImpl.readSync(fd, buffer, 0, wantNow, read);
      if (!got) break;
      read += got;
    }
    const ms = Math.max(1, now() - started);
    if (read <= 0) return null;
    return { bytesPerSecond: (read * 1000) / ms, bytesRead: read, ms };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // nothing to close
      }
    }
  }
}

/** The same, remembered per file version. "" means "do not measure". */
function volumeSpeed(filePath) {
  const key = (() => {
    try {
      const stats = fs.statSync(filePath);
      return `${filePath}|${stats.size}|${Math.round(stats.mtimeMs)}`;
    } catch {
      return "";
    }
  })();
  if (!key) return null;
  if (measured.has(key)) return measured.get(key);
  const result = measureReadSpeed(filePath);
  measured.set(key, result);
  return result;
}

/**
 * The sentence printed before the load, and the number the UI can show.
 *
 * `volume` is whatever the caller calls the disk ("AI", "the internal disk").
 * `cached` and `mmapDisabled` change the advice, not the arithmetic.
 */
function outlook({ filename = "", sizeBytes = 0, volume = "", bytesPerSecond = 0, cached = false, mmapDisabled = false } = {}) {
  const size = Number(sizeBytes) || 0;
  if (!size || size < WORTH_MEASURING_BYTES) return null;

  if (cached) {
    return {
      level: "info",
      estimatedSeconds: 0,
      bytesPerSecond: 0,
      sizeBytes: size,
      message: `${filename || "This model"} is loaded from a copy on the internal disk.`,
    };
  }

  const rate = Number(bytesPerSecond) || 0;
  if (!rate) return null;

  const estimatedSeconds = Math.round(size / rate);
  const where = volume ? ` from ${volume}` : "";
  const why = mmapDisabled
    ? "with mmap off on this filesystem the whole file is read every time"
    : "the whole file is read before the first token";
  return {
    level: estimatedSeconds >= 45 ? "warn" : "info",
    estimatedSeconds,
    // Carried so a caller does not have to re-measure to say "this volume gave
    // 78 MB/s" — the sentence and the number come from the same measurement.
    bytesPerSecond: rate,
    sizeBytes: size,
    message:
      `Reading ${gb(size)}${where} at about ${mbPerSecond(rate)} MB/s — ${why}, so roughly ` +
      `${secondsText(estimatedSeconds)} before the model answers. Cache it once from the text model card ` +
      "(or Settings → Text Generation → Performance) to read it from the internal disk instead, " +
      "or move the models to an internal APFS disk.",
  };
}

/** What actually happened, next to what was predicted. */
function completion({
  filename = "",
  sizeBytes = 0,
  elapsedMs = 0,
  bytesPerSecond = 0,
  predictedSeconds = 0,
} = {}) {
  const seconds = Math.max(0, Math.round((Number(elapsedMs) || 0) / 1000));
  const size = Number(sizeBytes) || 0;
  // How far the estimate was off is the part that makes the next estimate worth
  // believing, and the only part that says whether the wait was an anomaly.
  // Silent when it was close: a prediction that was right needs no commentary.
  const estimate = Number(predictedSeconds) || 0;
  const prediction = estimate > 0 && seconds > 0 && Math.abs(seconds - estimate) / estimate > 0.15
    ? ` The estimate before it started was ${secondsText(estimate)}, so this read was ${seconds > estimate ? "slower" : "faster"} than this volume had been.`
    : "";
  if (!size) return `${filename || "Model"} loaded in ${secondsText(seconds)}.${prediction}`;
  const effective = seconds > 0 ? size / seconds : Number(bytesPerSecond) || 0;
  const measuredSuffix = bytesPerSecond
    ? ` (${mbPerSecond(effective)} MB/s of the ${mbPerSecond(bytesPerSecond)} MB/s this volume measured)`
    : ` (${mbPerSecond(effective)} MB/s)`;
  return `${filename || "Model"} loaded in ${secondsText(seconds)} — ${gb(size)}${measuredSuffix}.${prediction}`;
}

/** Tests only: forget the measurements taken so far. */
function clearMeasurements() {
  measured.clear();
}

module.exports = {
  DEFAULT_SAMPLE_BYTES,
  WORTH_MEASURING_BYTES,
  measureReadSpeed,
  volumeSpeed,
  outlook,
  completion,
  clearMeasurements,
  // exposed for the tests' sake, not for callers
  __secondsText: secondsText,
  __mbPerSecond: mbPerSecond,
};
