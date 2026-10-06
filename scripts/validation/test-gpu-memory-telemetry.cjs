#!/usr/bin/env node
"use strict";

/**
 * The VRAM chip on macOS validation.
 *
 * On an 18 GB M3 Pro the monitor read `VRAM: 0.0 / 18 GB` with a model loaded
 * and generating. Nothing was wrong with the GPU; nothing was reading it. The
 * two sources the server had are nvidia-smi (absent on macOS) and llama.cpp's
 * `--list-devices` (parsed for CUDA/Vulkan/SYCL, and darwin had no backend path
 * registered — registering one would report the polling process's own ~0
 * allocations, not the running backend's).
 *
 * So the used value could not move, and the total was `os.totalmem()`: the
 * whole of unified memory, when the ceiling Metal actually offers is the
 * working set (~14.3 GB) the memory planner already refuses loads against.
 *
 * The replacement measures the backends themselves. Everything under test takes
 * the platform as an argument, never `process.platform`, so the macOS behaviour
 * is provable on Linux and in CI, where there is no Mac to ask — the lesson from
 * the suites that once read the machine they ran on.
 *
 * Run: node scripts/validation/test-gpu-memory-telemetry.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  DEFAULT_GPU_NAME,
  DEFAULT_UNIFIED_WORKING_SET_RATIO,
  GIB,
  PS_ARGS,
  gpuMemorySummary,
  residentBytesFromPs,
} = require("../server/gpu-memory-telemetry.cjs");

const appSource = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "app", "frontend", "src", "App.jsx"),
  "utf8"
);

const topStatusBarSource = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "app", "frontend", "src", "components", "TopStatusBar.jsx"),
  "utf8"
);

const serveSource = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "scripts", "server", "serve.cjs"),
  "utf8"
);

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// An 18 GB M3 Pro: 18 GB of unified memory, 14.3 GB of it addressable by Metal,
// and a llama.cpp backend holding a model plus KV cache.
const TOTAL_RAM_BYTES = 18 * GIB;
const WORKING_SET_GB = 14.3;
const LLAMA_PID = 4242;
const SD_PID = 4343;
const OTHER_PID = 999;

// `ps` reports KiB, so the listing is written in KiB and the expectations are
// derived from the same integers — comparing against 5.2 * GIB would compare a
// rounded KiB value with an unrounded byte value and fail by less than a
// megabyte, which is the kind of failure that reads as a real bug.
const LLAMA_KIB = 5452595; // 5.2 GB
const SD_KIB = 1572864; // 1.5 GB
const BROWSER_KIB = 3145728; // 3 GB, and not ours

const PS_LISTING = [
  `  ${OTHER_PID} ${BROWSER_KIB}`, // a browser: not ours, must never be counted
  `  ${LLAMA_PID} ${LLAMA_KIB}`, // llama.cpp
  `  ${SD_PID} ${SD_KIB}`, // stable-diffusion.cpp
  "",
].join("\n");

section("1. Reading `ps` without reading the whole machine");
const bothBackends = residentBytesFromPs(PS_LISTING, [LLAMA_PID, SD_PID]);
check(
  "the resident sets of our backends are summed, in bytes",
  bothBackends === (LLAMA_KIB + SD_KIB) * 1024,
  String(bothBackends)
);
check(
  "one backend alone is just that backend",
  residentBytesFromPs(PS_LISTING, [LLAMA_PID]) === LLAMA_KIB * 1024
);
check(
  "another program's 3 GB is not attributed to the GPU",
  bothBackends < 7 * GIB && residentBytesFromPs(PS_LISTING, [OTHER_PID]) === BROWSER_KIB * 1024
);
check(
  "no live backends means zero, not the whole listing",
  residentBytesFromPs(PS_LISTING, []) === 0 &&
    residentBytesFromPs(PS_LISTING, null) === 0
);
check(
  "a backend that already exited contributes nothing",
  residentBytesFromPs(PS_LISTING, [12345]) === 0
);
check(
  "headers, CRLF, junk and short lines are ignored",
  residentBytesFromPs(
    ["  PID   RSS", "  1 2\r", "not a line", `  ${LLAMA_PID} 1024`, "  77  "].join("\r\n"),
    [LLAMA_PID]
  ) === 1024 * 1024
);
check(
  "a pid is matched exactly, not as a prefix of a longer one",
  residentBytesFromPs(`  ${LLAMA_PID}0 999999\n  ${LLAMA_PID} 2048`, [LLAMA_PID]) === 2048 * 1024
);
check("the argv is fixed, so no pid ever reaches a command line", PS_ARGS.join(" ") === "-axo pid=,rss=");

section("2. The reading itself (platform as an argument, not as a fact about this machine)");
const loaded = gpuMemorySummary({
  platform: "darwin",
  gpuName: "Apple M3 Pro",
  totalRamBytes: TOTAL_RAM_BYTES,
  workingSetGb: WORKING_SET_GB,
  residentBytes: bothBackends,
});
check("a Mac gets a reading at all", Boolean(loaded));
check(
  "used is what the backends hold (6.7 GB), not 0.0",
  loaded.vram_used_gb === 6.7,
  String(loaded.vram_used_gb)
);
check(
  "total is the Metal working set (14.3 GB), not the 18 GB of RAM",
  loaded.vram_total_gb === WORKING_SET_GB,
  String(loaded.vram_total_gb)
);
check("the chip names the GPU it is describing", loaded.gpu_name === "Apple M3 Pro");
check("it says the memory is shared", loaded.unified === true);
check("it says where the ceiling came from", loaded.source === "metal-working-set");

const unlearned = gpuMemorySummary({
  platform: "darwin",
  totalRamBytes: TOTAL_RAM_BYTES,
  workingSetGb: 0,
  residentBytes: 2 * GIB,
});
check(
  "before the working set is learned the ceiling is the configured ratio of RAM",
  unlearned.vram_total_gb === Number((18 * DEFAULT_UNIFIED_WORKING_SET_RATIO).toFixed(2)),
  String(unlearned.vram_total_gb)
);
check("and the reading still marks itself as a fallback", unlearned.source === "unified-ratio-fallback");
check("a Mac with no GPU name reported still gets one", unlearned.gpu_name === DEFAULT_GPU_NAME);

const idle = gpuMemorySummary({
  platform: "darwin",
  totalRamBytes: TOTAL_RAM_BYTES,
  workingSetGb: WORKING_SET_GB,
  residentBytes: 0,
});
check("nothing loaded reads as 0 used…", idle.vram_used_gb === 0);
check(
  "…with the ceiling still present, so the chip is not hidden as unknown",
  idle.vram_total_gb === WORKING_SET_GB
);

const over = gpuMemorySummary({
  platform: "darwin",
  totalRamBytes: TOTAL_RAM_BYTES,
  workingSetGb: WORKING_SET_GB,
  residentBytes: 16 * GIB,
});
check(
  "used above the ceiling is shown, not clamped — that is the number that precedes an OOM",
  over.vram_used_gb === 16 && over.vram_total_gb === WORKING_SET_GB,
  `${over.vram_used_gb} / ${over.vram_total_gb}`
);

check(
  "Windows keeps nvidia-smi as its authority",
  gpuMemorySummary({ platform: "win32", totalRamBytes: 32 * GIB, workingSetGb: 8, residentBytes: GIB }) === null
);
check(
  "Linux keeps the llama.cpp device list as its authority",
  gpuMemorySummary({ platform: "linux", totalRamBytes: 32 * GIB, workingSetGb: 8, residentBytes: GIB }) === null
);
check(
  "a Mac that reports neither RAM nor a working set reports nothing, rather than 0.0 / 0.00",
  gpuMemorySummary({ platform: "darwin", totalRamBytes: 0, workingSetGb: 0, residentBytes: 0 }) === null
);

section("3. The same parser against a real `ps` on this machine");
try {
  const listing = execFileSync("ps", PS_ARGS, { encoding: "utf8", timeout: 10000 });
  const mine = residentBytesFromPs(listing, [process.pid]);
  check("this test's own process is found in a real listing", mine > 0, String(mine));
  check(
    "and the listing really holds other processes it did not claim",
    residentBytesFromPs(listing, []) === 0
  );
} catch (error) {
  check("a real `ps` listing can be read", false, String(error && error.message));
}

section("4. Wiring in the server");
check(
  "the telemetry module is required",
  serveSource.includes('require("./gpu-memory-telemetry.cjs")')
);
check(
  "on macOS the unified reading outranks the llama.cpp device list",
  /vram \|\| \(osPlatform === "darwin" \? getMetalVram\(\) : null\) \|\| getLlamaVram\(\)/.test(serveSource)
);
check(
  "the chip's used value comes from that reading",
  serveSource.includes("Number.isFinite(Number(deviceVram?.vram_used_gb)) ? deviceVram.vram_used_gb : 0")
);
check(
  "the poll is registered on darwin only, so no `ps` is spawned elsewhere",
  /if \(osPlatform === "darwin"\) \{\s*\n\s*setInterval\(\(\) => pollMetalVram\(false\), 5000\);\s*\n\s*pollMetalVram\(true\);/.test(
    serveSource
  )
);
check(
  "the pids it measures are the live backends, including the arena pool",
  /function gpuBackendPids\(\)[\s\S]{0,600}push\(llmProc\);[\s\S]{0,200}push\(backendProc\);[\s\S]{0,200}push\(openvinoProc\);[\s\S]{0,300}instance\.child/.test(
    serveSource
  )
);
check(
  "`ps` runs through execFile with the module's argv — no shell, no interpolated pids",
  /execFile\(\s*\n\s*"ps",\s*\n\s*PS_ARGS,/.test(serveSource)
);
check(
  "nothing is loaded ⇒ no `ps` at all, and an honest zero",
  /if \(pids\.length === 0\) \{[\s\S]{0,300}cachedMetalVramInfo = metalVramSummary\(0\);/.test(serveSource)
);
check(
  "a failed `ps` keeps the previous reading instead of flashing zero",
  /if \(error\) return;\s*\n\s*cachedMetalVramInfo = metalVramSummary\(residentBytesFromPs\(stdout, pids\)\);/.test(
    serveSource
  )
);
check(
  "the ceiling is the learned working set, shared with the memory planner",
  /workingSetGb: memoryCalibration\.workingSetGb\(\),\s*\n\s*ratio: Number\(gpuConfig\.unifiedWorkingSetRatio/.test(
    serveSource
  )
);
check(
  "getLlamaTelemetryBackendPath still has no darwin branch, and says why",
  !/function getLlamaTelemetryBackendPath\(\)[\s\S]{0,900}osPlatform === "darwin"/.test(serveSource) &&
    /No darwin branch on purpose[\s\S]{0,400}pollMetalVram/.test(serveSource)
);

section("5. The reported symptom, end to end");
// What the user saw: RAM 16 / 18 GB, VRAM 0.0 / 18 GB, model loaded.
const reported = gpuMemorySummary({
  platform: "darwin",
  gpuName: "Apple M3 Pro",
  totalRamBytes: TOTAL_RAM_BYTES,
  workingSetGb: WORKING_SET_GB,
  residentBytes: Math.round(5.2 * GIB),
});
check(
  "a loaded model now moves the used value off 0.0",
  reported.vram_used_gb > 0,
  String(reported.vram_used_gb)
);
check(
  "and the ceiling shown is the one loads are refused against, not total RAM",
  reported.vram_total_gb < Number((TOTAL_RAM_BYTES / GIB).toFixed(2)) &&
    reported.vram_total_gb === WORKING_SET_GB
);

section("The RAM chip says whose memory it is showing");
check(
  "macOS 'used' excludes what can be reclaimed, so the chip is not counting file cache as an app",
  /const totalFreeBytes = \(freePages \+ inactivePages \+ speculativePages\) \* pageSize;/.test(serveSource) &&
    /cachedMacRamUsedGb = roundGb\(os\.totalmem\(\) - totalFreeBytes\);/.test(serveSource)
);
check(
  "the server reports its own footprint next to the machine-wide figure",
  /server_rss_gb: roundGb\(process\.memoryUsage\(\)\.rss\),/.test(serveSource)
);
check(
  "and the chip shows LUKE's share — server process plus loaded model processes — beside the machine's",
  /\{hasServerRss && <> · LUKE \{formatGb\(lukeGb, \{ allowZero: true \}\)\} GB<\/>\}/.test(topStatusBarSource) &&
    /const lukeGb = \(serverRssGb \|\| 0\) \+ modelsGb;/.test(topStatusBarSource)
);
check(
  "the tooltip says the machine-wide figure is Activity Monitor's, and that the browser tab is the browser's",
  /comparable to what Activity Monitor shows/.test(topStatusBarSource) &&
    /belongs to the browser/.test(topStatusBarSource) &&
    /title=\{ramTitle\}/.test(topStatusBarSource)
);
check(
  "a machine reading that has not arrived yet is not shown as zero LUKE",
  /const hasServerRss = serverRssGb !== null;/.test(topStatusBarSource)
);
check(
  "the app keeps the footprint in its telemetry state and change detection, so the LUKE share actually refreshes",
  /server_rss_gb: null,/.test(appSource) && /prev\.server_rss_gb === stats\.server_rss_gb &&/.test(appSource)
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
