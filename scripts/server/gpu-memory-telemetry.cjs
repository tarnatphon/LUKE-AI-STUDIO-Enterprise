"use strict";

/**
 * GPU memory telemetry for unified-memory machines (Apple Silicon).
 *
 * Why this exists
 * ---------------
 * The performance monitor's VRAM chip read `0.0 / 18 GB` on every Mac, loaded
 * or not, because the two sources the server could read do not exist there:
 *
 *   - `nvidia-smi` — no such command on macOS.
 *   - `llama-server --list-devices` — its device lines are parsed for
 *     `CUDA0 | Vulkan0 | SYCL0`, and darwin has no backend path registered, so
 *     the poll never ran. Registering one would not have helped either: Metal
 *     answers with `recommendedMaxWorkingSetSize` and the *calling process's*
 *     `currentAllocatedSize`, so a freshly spawned `--list-devices` process
 *     reports its own ~0 MB and never what the running backend holds.
 *
 * The total (18 GB) came from `getGpuInfo()`, which reports the whole of
 * unified memory as VRAM. So the chip showed a real ceiling next to a used
 * value that could not move.
 *
 * What macOS does allow us to know
 * --------------------------------
 * The GPU has no separate memory to query, but the weights, KV cache and
 * compute buffers of a model live in the one pool as the resident pages of the
 * backend process that loaded them. `ps` reports exactly that, so the honest
 * reading is:
 *
 *   used  = resident set of the live GPU backends (llama.cpp, sd.cpp, pool)
 *   total = the Metal working set the app already learns from
 *           `ggml_metal_device_init: recommendedMaxWorkingSetSize = 14302.25 MB`
 *           (see memory-calibration.cjs), or a ratio of total RAM until it is
 *           learned.
 *
 * The total is deliberately the working set rather than the 18 GB of RAM: that
 * is the budget the models actually share, and it is the number the memory
 * planner already refuses loads against.
 *
 * Everything here is pure — the platform arrives as an argument, never from
 * `process.platform` — so the macOS behaviour can be proven on Linux and in CI,
 * where no Mac hardware exists to ask.
 */

const GIB = 1024 ** 3;

/**
 * What fraction of unified memory Metal can address, used only until the real
 * working set has been learned from a backend log. Same default the memory
 * planner uses, so the chip and the load-time budget agree.
 */
const DEFAULT_UNIFIED_WORKING_SET_RATIO = 0.78;

const DEFAULT_GPU_NAME = "Apple Metal GPU";

/** `ps -axo pid=,rss=` — rss is in KiB on both BSD and Linux ps. */
const PS_ARGS = ["-axo", "pid=,rss="];

function roundGb(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

/**
 * Sums the resident set of the pids we own, out of a whole `ps` listing.
 *
 * One listing is read for every backend instead of one `ps` per pid: the count
 * of live backends changes between polls (the arena pool loads and unloads),
 * and a single fixed argv keeps the pid list off the command line entirely.
 * Anything not in `pids` is another program's memory and is ignored.
 */
function residentBytesFromPs(psOutput, pids) {
  const wanted = new Set(
    (Array.isArray(pids) ? pids : [])
      .map((pid) => Number(pid))
      .filter((pid) => Number.isFinite(pid) && pid > 0)
  );
  // No backends means nothing of ours is resident. Without this guard an empty
  // `pids` would read as "no filter" and sum the whole machine.
  if (wanted.size === 0) return 0;

  let bytes = 0;
  for (const line of String(psOutput || "").split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    if (!wanted.has(Number(match[1]))) continue;
    const kib = Number(match[2]);
    if (Number.isFinite(kib) && kib > 0) bytes += kib * 1024;
  }
  return bytes;
}

/**
 * The reading for one poll, or null when this platform has a better source.
 *
 * `used` is not clamped to `total`. A backend holding more than the working set
 * is the condition that precedes `kIOGPUCommandBufferCallbackErrorOutOfMemory`,
 * and clamping it to the ceiling is how a chip that exists to warn about that
 * would stop warning.
 */
function gpuMemorySummary({
  platform = "",
  gpuName = "",
  totalRamBytes = 0,
  workingSetGb = 0,
  ratio = DEFAULT_UNIFIED_WORKING_SET_RATIO,
  residentBytes = 0,
} = {}) {
  // Windows and Linux keep nvidia-smi and the llama.cpp device list: those
  // report the card's own memory across processes, which is more accurate than
  // a process footprint and is what their chip has always shown.
  if (String(platform).toLowerCase() !== "darwin") return null;

  const measuredGb = Number(workingSetGb);
  const measured = Number.isFinite(measuredGb) && measuredGb > 0;
  const fallbackRatio = Number(ratio);
  const totalRamGb = Number(totalRamBytes) > 0 ? Number(totalRamBytes) / GIB : 0;
  const totalGb = measured
    ? measuredGb
    : totalRamGb * (Number.isFinite(fallbackRatio) && fallbackRatio > 0
      ? fallbackRatio
      : DEFAULT_UNIFIED_WORKING_SET_RATIO);

  // No ceiling known at all (no learned working set and no readable total RAM):
  // report nothing rather than a chip that says `0.0 / 0.00 GB`.
  if (!(totalGb > 0)) return null;

  const resident = Number(residentBytes);
  return {
    gpu_name: String(gpuName || "").trim() || DEFAULT_GPU_NAME,
    vram_used_gb: roundGb(Number.isFinite(resident) && resident > 0 ? resident / GIB : 0),
    vram_total_gb: roundGb(totalGb),
    unified: true,
    source: measured ? "metal-working-set" : "unified-ratio-fallback",
  };
}

module.exports = {
  DEFAULT_GPU_NAME,
  DEFAULT_UNIFIED_WORKING_SET_RATIO,
  GIB,
  PS_ARGS,
  gpuMemorySummary,
  residentBytesFromPs,
  roundGb,
};
