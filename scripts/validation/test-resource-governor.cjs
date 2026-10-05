#!/usr/bin/env node
"use strict";

/**
 * The resource governor validation.
 *
 * The app never gave anything back: a chat model stayed resident until the user
 * unloaded it by hand, so a machine used for one question an hour ago was still
 * holding its weights while the OS compressed other processes and swapped. The
 * governor releases an idle engine when the machine is genuinely short — and the
 * two words doing the work there are "genuinely" and "idle", because a governor
 * that takes a model away from somebody who is about to use it is worse than no
 * governor at all.
 *
 * So these checks hold three things: the pressure signals are read correctly on
 * each platform (a healthy macOS machine with a full file cache must read as
 * "room", not "tight"); nothing is released unless it is idle, restorable and
 * not mid-request; and the engines that cannot come back by themselves are left
 * alone *with the reason recorded*, rather than being killed silently.
 *
 * Platform, clock and memory numbers are arguments everywhere, so an 8 GB Mac
 * that swaps can be tested on a Linux runner that does not.
 *
 * Run: node scripts/validation/test-resource-governor.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_POLICY,
  ENGINE_RULES,
  GIB,
  TIER_POLICIES,
  assessMemoryPressure,
  parseCompressorBytes,
  parseMeminfo,
  parseSwapUsage,
  planRelease,
  policyFor,
} = require("../server/resource-governor.cjs");

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

const MINUTE = 60000;
const NOW = 1800000000000;

const MEMINFO_HEALTHY = [
  "MemTotal:       16384000 kB",
  "MemFree:         1024000 kB",
  "MemAvailable:    6553600 kB",
  "SwapTotal:       2097152 kB",
  "SwapFree:        2097152 kB",
  "",
].join("\n");

const MEMINFO_TIGHT = [
  "MemTotal:       16384000 kB",
  "MemAvailable:    1638400 kB",
  "SwapTotal:       2097152 kB",
  "SwapFree:        1048576 kB",
  "",
].join("\n");

const VM_STAT = [
  "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
  "Pages free:                              120000.",
  "Pages active:                            400000.",
  "Pages occupied by compressor:            131072.",
  "",
].join("\n");

function engine(overrides = {}) {
  return {
    id: "text",
    label: "Chat model qwen.gguf",
    resident: true,
    restorable: true,
    busy: false,
    sizeGb: 4.2,
    lastUsedAt: NOW - 60 * MINUTE,
    ...overrides,
  };
}

section("1. Reading each platform's memory signals");
{
  const healthy = parseMeminfo(MEMINFO_HEALTHY);
  check("MemAvailable is read in bytes", healthy.availableBytes === 6553600 * 1024, String(healthy.availableBytes));
  check("swap that is entirely free reads as zero used", healthy.swapUsedBytes === 0);

  const tight = parseMeminfo(MEMINFO_TIGHT);
  check("used swap is total minus free", tight.swapUsedBytes === 1024 * 1024 * 1024, String(tight.swapUsedBytes));

  check("a meminfo without the lines reads as null, not zero", parseMeminfo("MemTotal: 1 kB").availableBytes === null);
  check("garbage reads as null", parseMeminfo("").swapUsedBytes === null);

  check(
    "macOS swap usage is parsed in megabytes",
    parseSwapUsage("vm.swapusage: total = 2048.00M  used = 384.50M  free = 1663.50M  (encrypted)") ===
      Math.round(384.5 * 1024 * 1024),
    String(parseSwapUsage("vm.swapusage: total = 2048.00M  used = 384.50M  free = 1663.50M"))
  );
  check("and in gigabytes", parseSwapUsage("vm.swapusage: total = 4.00G  used = 1.25G  free = 2.75G") === 1.25 * GIB);
  check("zero swap used parses to zero, not null", parseSwapUsage("used = 0.00M") === 0);
  check("no swap configured reads as null", parseSwapUsage("vm.swapusage: total = 0.00M") === null);

  check("the compressor's pages become bytes at the reported page size", parseCompressorBytes(VM_STAT) === 131072 * 16384);
  check(
    "a 4 KB page size machine is converted with its own page size",
    parseCompressorBytes("page size of 4096 bytes\nPages occupied by compressor: 1000.") === 1000 * 4096
  );
  check("no compressor line reads as null", parseCompressorBytes("Pages free: 1.") === null);
}

section("2. Thresholds follow the machine, and overrides are clamped not trusted");
{
  const low = policyFor({ tier: "low" });
  const mid = policyFor({ tier: "mid" });
  const high = policyFor({ tier: "high" });
  check("a small machine is the least patient", low.idleMinutes < mid.idleMinutes && mid.idleMinutes < high.idleMinutes,
    `${low.idleMinutes}/${mid.idleMinutes}/${high.idleMinutes}`);
  check("and the most sensitive to swap", low.tightSwapGb < mid.tightSwapGb && mid.tightSwapGb < high.tightSwapGb);
  check("an unknown tier falls back to mid", policyFor({ tier: "enormous" }).idleMinutes === TIER_POLICIES.mid.idleMinutes);
  check("the governor is on by default", high.enabled === true && high.sweepMs >= 15000);

  const tuned = policyFor({ tier: "high", overrides: { idleMinutes: 5, tightSwapGb: 0.1, enabled: true } });
  check("this machine's own numbers win over the tier", tuned.idleMinutes === 5 && tuned.tightSwapGb === 0.1);
  check("a negative threshold is ignored, not believed", policyFor({ tier: "high", overrides: { tightSwapGb: -5 } }).tightSwapGb === high.tightSwapGb);
  check("junk is ignored too", policyFor({ tier: "high", overrides: { idleMinutes: "soon" } }).idleMinutes === high.idleMinutes);
  check("and it can be switched off", policyFor({ tier: "high", overrides: { enabled: false } }).enabled === false);
  check("switching the idle timer off is possible without switching the governor off", policyFor({ tier: "high", overrides: { idleMinutes: 0 } }).enabled === true);
}

section("3. A healthy machine is left alone — including a Mac with a full file cache");
{
  const high = policyFor({ tier: "high" });
  const calm = assessMemoryPressure({
    platform: "darwin",
    policy: high,
    totalRamBytes: 18 * GIB,
    availableBytes: null, // macOS: free+inactive is cache, so it is not offered as a signal
    swapUsedBytes: 0,
    compressorBytes: 0.2 * GIB,
  });
  check("no swap and a small compressor reads as ok", calm.level === "ok", calm.reason);
  check("and says the machine has room", /room/.test(calm.reason));

  const staleSwap = assessMemoryPressure({ platform: "darwin", policy: high, totalRamBytes: 18 * GIB, swapUsedBytes: 1.5 * GIB, compressorBytes: 0.4 * GIB });
  check(
    "swap left over from an old spike is NOT pressure on its own — macOS never gives it back",
    staleSwap.level === "ok",
    staleSwap.reason
  );
  check("but the reading says it saw the swap, so the number is not silently dropped", /swap in use \(1.5 GB\)/.test(staleSwap.reason) && /outlives the spike/.test(staleSwap.reason), staleSwap.reason);

  const swapping = assessMemoryPressure({ platform: "darwin", policy: high, totalRamBytes: 18 * GIB, swapUsedBytes: 1.5 * GIB, compressorBytes: 2.5 * GIB });
  check("a compressor past the tier's threshold reads as tight", swapping.level === "tight", swapping.reason);
  check("and the swap is reported as confirmation, with numbers a user can check", /compressor holding 2.5 GB/.test(swapping.reason) && /swap confirms it: 1.5 GB/.test(swapping.reason), swapping.reason);

  const hurting = assessMemoryPressure({ platform: "darwin", policy: high, totalRamBytes: 18 * GIB, swapUsedBytes: 5 * GIB, compressorBytes: 4.5 * GIB });
  check("heavy swap reads as critical", hurting.level === "critical", hurting.reason);
  check("a big compressor alone is also critical", assessMemoryPressure({ platform: "darwin", policy: high, totalRamBytes: 18 * GIB, swapUsedBytes: 0, compressorBytes: 4.5 * GIB }).level === "critical");
  check(
    "swap alone becomes actionable only past the critical mark",
    assessMemoryPressure({ platform: "darwin", policy: high, totalRamBytes: 18 * GIB, swapUsedBytes: 4.5 * GIB, compressorBytes: 0 }).level === "critical"
  );
  check(
    "and a machine with a higher critical mark treats the same swap as confirmation, not as an emergency",
    assessMemoryPressure({ platform: "darwin", policy: policyFor({ tier: "high", overrides: { criticalSwapGb: 8 } }), totalRamBytes: 64 * GIB, swapUsedBytes: 5 * GIB, compressorBytes: 2.5 * GIB }).level === "tight"
  );

  const linuxTight = assessMemoryPressure({ platform: "linux", policy: policyFor({ tier: "mid" }), totalRamBytes: 16 * GIB, ...(() => {
    const parsed = parseMeminfo(MEMINFO_TIGHT);
    return { availableBytes: parsed.availableBytes, swapUsedBytes: parsed.swapUsedBytes };
  })() });
  check("Linux reads its pressure from MemAvailable and swap", linuxTight.level !== "ok", linuxTight.reason);
  check("and reports the signals it used", linuxTight.signals.available === true && linuxTight.signals.swap === true);

  const noSignal = assessMemoryPressure({ platform: "win32", policy: policyFor({ tier: "mid" }), totalRamBytes: 32 * GIB });
  check("a platform with no signal says so instead of guessing", noSignal.level === "ok" && /no pressure signal/.test(noSignal.reason), noSignal.reason);
}

section("4. Nothing is released unless it is idle, restorable and free");
{
  const high = policyFor({ tier: "high" });
  const tight = { level: "tight", reason: "swap in use: 1.5 GB" };
  const critical = { level: "critical", reason: "swap in use: 5 GB" };
  const calm = { level: "ok", reason: "the machine has room" };

  check("a healthy machine keeps everything", planRelease({ now: NOW, engines: [engine()], pressure: calm, policy: high }).engine === null);
  check("and the refusal says why", planRelease({ now: NOW, engines: [engine()], pressure: calm, policy: high }).code === "NO_PRESSURE");
  check("a switched-off governor never releases", planRelease({ now: NOW, engines: [engine()], pressure: critical, policy: policyFor({ tier: "high", overrides: { enabled: false } }) }).code === "DISABLED");

  const idle = planRelease({ now: NOW, engines: [engine({ lastUsedAt: NOW - 60 * MINUTE })], pressure: tight, policy: high });
  check("tight memory plus an hour of idle releases the model", idle.engine?.id === "text", JSON.stringify(idle));
  check("and the reason says it comes back by itself", /reloads by itself/.test(idle.reason));
  check("the code says which rule fired", idle.code === "MEMORY_TIGHT_IDLE");

  check(
    "tight memory plus a model used five minutes ago releases nothing",
    planRelease({ now: NOW, engines: [engine({ lastUsedAt: NOW - 5 * MINUTE })], pressure: tight, policy: high }).code === "STILL_IN_USE"
  );
  check(
    "critical memory does not wait for the idle timer",
    planRelease({ now: NOW, engines: [engine({ lastUsedAt: NOW - 1 * MINUTE })], pressure: critical, policy: high }).code === "MEMORY_CRITICAL"
  );
  check(
    "but a model mid-answer is never taken away, even when critical",
    planRelease({ now: NOW, engines: [engine({ busy: true })], pressure: critical, policy: high }).engine === null
  );
  check(
    "an engine that was never used is not treated as infinitely idle when memory is merely tight",
    planRelease({ now: NOW, engines: [engine({ lastUsedAt: null })], pressure: tight, policy: high }).code === "STILL_IN_USE"
  );
  check(
    "…while critical does treat it as releasable, since never-used is the idlest there is",
    planRelease({ now: NOW, engines: [engine({ lastUsedAt: null })], pressure: critical, policy: high }).engine?.id === "text"
  );
  check(
    "with the idle timer switched off, tight memory waits",
    planRelease({ now: NOW, engines: [engine()], pressure: tight, policy: policyFor({ tier: "high", overrides: { idleMinutes: 0 } }) }).code === "TIMER_OFF"
  );

  const image = engine({ id: "image", label: "Image model sd.safetensors", restorable: false, sizeGb: 6 });
  const notRestorable = planRelease({ now: NOW, engines: [image], pressure: critical, policy: high });
  check("an engine that cannot come back is left alone", notRestorable.engine === null);
  check("and the refusal names it", notRestorable.code === "NOTHING_RESTORABLE" && /image/.test(notRestorable.reason), notRestorable.reason);

  const small = engine({ id: "text", sizeGb: 0.2 });
  check(
    "a release too small to be worth the reload is skipped",
    planRelease({ now: NOW, engines: [small], pressure: critical, policy: high }).engine === null
  );

  const two = [
    engine({ id: "arena", label: "Arena pool", lastUsedAt: NOW - 20 * MINUTE, sizeGb: 3 }),
    engine({ id: "text", lastUsedAt: NOW - 90 * MINUTE, sizeGb: 4 }),
  ];
  const lru = planRelease({ now: NOW, engines: two, pressure: critical, policy: high });
  check("the least recently used of two goes first", lru.engine.id === "text", lru.engine.id);
  check("and only one goes per sweep, so a machine that recovers stops losing engines", lru.engine && !Array.isArray(lru.engine));
}

section("5. Wiring in the server");
check("the governor module is required", serveSource.includes('require("./resource-governor.cjs")'));
check(
  "the sweep runs on its own timer, not on telemetry demand — it protects the machine while it works",
  /setInterval\(\(\) => \{\s*\n\s*sweepResourceGovernor\(\);\s*\n\s*\}, resourceGovernorSweepMs\);/.test(serveSource) &&
    !/telemetryDemand\.allow\([^)]*\)\)\s*sweepResourceGovernor/.test(serveSource)
);
check("and never more often than every 15 seconds", /Math\.max\(15000, Number\(resourceGovernorPolicy\(\)\.sweepMs\)/.test(serveSource));
check(
  "a chat request is counted as use, and marks the engine busy while it runs",
  /noteEngineUsed\("text"\);\s*\n\s*llmRequestsInFlight \+= 1;\s*\n\s*try \{\s*\n\s*await doLlmChat/.test(serveSource) &&
    /busy: llmRequestsInFlight > 0 \|\| activeArenaRuns\.size > 0/.test(serveSource)
);
check("the counter is released even when the chat throws", /finally \{[\s\S]{0,200}llmRequestsInFlight -= 1;\s*\n\s*noteEngineUsed\("text"\);/.test(serveSource));
check("a model that just became ready is not 'idle since never'", /llmReady = true;\s*\n\s*noteEngineUsed\("text"\);/.test(serveSource));
check("arena rounds count as use of the pool", /noteEngineUsed\("arena"\);\s*\n\s*await streamArenaGeneration/.test(serveSource));
check(
  "the release snapshots the model before killing it, which is what makes it reversible",
  /if \(engineId === "text"\) \{\s*\n[\s\S]{0,600}releasedMainModel = \{[\s\S]{0,700}await runExclusiveLlmOperation\(\(\) => killLlm\(\)\);/.test(serveSource)
);
check(
  "the snapshot names the governor and its reason, so the restore can say why it is reloading",
  /releasedBy: "governor",\s*\n\s*reason: decision\.reason,/.test(serveSource) &&
    /released by \$\{snapshot\.releasedBy \|\| "the arena"\}/.test(serveSource)
);
check(
  "the arena's own release still works and is labelled as the arena's",
  /releasedBy: "arena",/.test(serveSource) && !/arenaReleasedMainModel/.test(serveSource)
);
check(
  "the chat route still restores a released model before answering",
  /const restored = await restoreReleasedMainModel\(\);/.test(serveSource)
);
check(
  "macOS offers swap and the compressor, and deliberately not free+inactive",
  /runQuietCommand\("sysctl", \["-n", "vm\.swapusage"\]\)/.test(serveSource) &&
    /\/\/ free \+ inactive on macOS is file cache[\s\S]{0,140}availableBytes: null,/.test(serveSource)
);
check("Linux reads /proc/meminfo instead of spawning anything", /parseMeminfo\(fs\.readFileSync\("\/proc\/meminfo", "utf8"\)\)/.test(serveSource));
check(
  "a failed sweep is logged, never thrown — it runs on a timer",
  /catch \(error\) \{\s*\n[\s\S]{0,300}console\.warn\(`  \[governor\] sweep failed/.test(serveSource)
);
check(
  "the status is exposed where the AI Library already reads memory",
  /resourceGovernor: resourceGovernorStatus,/.test(serveSource)
);
check(
  "overrides live in runtime-state, so a pull never collides with them",
  /app", "runtime-state", "resource-governor\.json"/.test(serveSource)
);

section("6. The engines the governor declines to touch say why");
for (const [id, rule] of Object.entries(ENGINE_RULES)) {
  check(`${id} is ${rule.restorable ? "restorable" : "left alone, with a reason"}`, typeof rule.reason === "string" && rule.reason.length > 20, rule.reason);
}
check(
  "serve.cjs passes those reasons through to the status, not just a boolean",
  /notRestorableBecause: ENGINE_RULES\.image\.reason/.test(serveSource) &&
    /notRestorableBecause: engine\.notRestorableBecause \|\| null/.test(serveSource)
);

section("7. One real sweep decision on this machine");
{
  const policy = policyFor({ tier: "mid" });
  let signals = { availableBytes: null, swapUsedBytes: null };
  try {
    if (os.platform() === "linux") signals = parseMeminfo(fs.readFileSync("/proc/meminfo", "utf8"));
  } catch (_) {}
  const pressure = assessMemoryPressure({
    platform: os.platform(),
    policy,
    totalRamBytes: os.totalmem(),
    availableBytes: signals.availableBytes,
    swapUsedBytes: signals.swapUsedBytes,
    compressorBytes: null,
  });
  check("a real reading produces a level and a reason", ["ok", "tight", "critical"].includes(pressure.level) && pressure.reason.length > 5, pressure.reason);
  const decision = planRelease({ now: Date.now(), engines: [], pressure, policy });
  check("with nothing loaded it releases nothing", decision.engine === null, JSON.stringify(decision));
  check("and it says so rather than staying silent", decision.code === "NOTHING_RESTORABLE" || decision.code === "NO_PRESSURE", decision.code);
  check("the default policy is a real object, not a stub", DEFAULT_POLICY.sweepMs >= 15000 && DEFAULT_POLICY.minimumReleaseGb > 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
