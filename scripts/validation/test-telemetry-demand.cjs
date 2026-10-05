#!/usr/bin/env node
"use strict";

/**
 * Hardware sampling stops when nobody is watching.
 *
 * The monitor sampled the machine every five seconds for as long as the server
 * ran: `vm_stat` on macOS, `nvidia-smi` on Windows/Linux, and a whole
 * `llama-server --list-devices` process — which initialises Vulkan or CUDA,
 * prints two numbers and exits — on the machines that have a llama.cpp backend.
 * A server left running overnight with the browser closed did that 17,280 times.
 * On a machine that is also running a model, that is wake-ups and memory the
 * model could have had.
 *
 * The frontend only asks while its tab is visible, so "a client asked recently"
 * is the signal. These checks hold the two halves of it: the gate's own logic
 * (with an injected clock, so no check has to wait thirty seconds), and the
 * wiring — every sampler goes through the gate, forced samples still work, and a
 * returning client is not handed the numbers from before the pause.
 *
 * Run: node scripts/validation/test-telemetry-demand.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const { DEFAULT_WINDOW_MS, TelemetryDemand } = require("../server/telemetry-demand.cjs");

const root = path.resolve(__dirname, "..", "..");
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app", "frontend", "src", "App.jsx"), "utf8");

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

function fakeLogger() {
  const lines = [];
  return { lines, log: (message) => lines.push(String(message)) };
}

section("1. The gate itself (clock injected — nothing here waits in real time)");
{
  let clock = 0;
  const logger = fakeLogger();
  const demand = new TelemetryDemand({ now: () => clock, logger });

  check("before any client has asked, sampling is not wanted", demand.wanted() === false);
  check("and the wait is reported as open-ended", demand.idleFor() === Infinity);
  check("a sampler that asks now is refused", demand.allow("nvidia-smi") === false);

  demand.note();
  check("one request is enough to start sampling", demand.wanted() === true);
  check("a sampler that asks now is allowed", demand.allow("nvidia-smi") === true);

  clock += DEFAULT_WINDOW_MS - 1;
  check(`still wanted one millisecond inside the ${DEFAULT_WINDOW_MS}ms window`, demand.wanted() === true);
  clock += 2;
  check("and not wanted once the window has passed", demand.wanted() === false);
  check(
    "the pause is measured from the last request, not from the last sample",
    demand.idleFor() === DEFAULT_WINDOW_MS + 1,
    String(demand.idleFor())
  );
  check("so a sampler asking now is refused again", demand.allow("nvidia-smi") === false);

  demand.note();
  clock += 1000;
  check("a client that keeps asking keeps the samplers running", demand.wanted() === true);
  check("the window is measured from the newest request", demand.idleFor() === 1000, String(demand.idleFor()));
  demand.allow("nvidia-smi");
  demand.allow("vm_stat");
  check(
    "counters separate the samples taken from the ones skipped",
    demand.samplesTaken === 3 && demand.samplesSkipped === 2,
    JSON.stringify(demand.status())
  );
}

section("2. The log says why the numbers stopped moving — once, not every tick");
{
  let clock = 0;
  const logger = fakeLogger();
  const demand = new TelemetryDemand({ now: () => clock, logger });

  demand.allow("vm_stat");
  demand.allow("vm_stat");
  demand.allow("nvidia-smi");
  check("a dozen refused samples produce a single pause line", logger.lines.length === 1, logger.lines.join(" | "));
  check("and that line names what stopped", /sampling paused/.test(logger.lines[0]) && /vm_stat/.test(logger.lines[0]));

  demand.note();
  demand.allow("vm_stat");
  check("coming back is announced too", logger.lines.length === 2 && /resumed/.test(logger.lines[1]));
  demand.allow("vm_stat");
  demand.allow("vm_stat");
  check("and only once", logger.lines.length === 2, logger.lines.join(" | "));
}

section("3. Every sampler in the server goes through the gate");
const samplers = [
  ["nvidia-smi", /if \(!telemetryDemand\.allow\("nvidia-smi"\)\) \{\s*\n\s*return;/],
  ["llama.cpp --list-devices", /if \(!telemetryDemand\.allow\("llama\.cpp --list-devices"\)\) \{\s*\n\s*return;/],
  ["ps (unified memory)", /if \(!telemetryDemand\.allow\("ps \(unified memory\)"\)\) \{\s*\n\s*return;/],
  ["vm_stat", /if \(telemetryDemand\.allow\("vm_stat"\)\) pollMacRam\(\);/],
];
for (const [name, pattern] of samplers) {
  check(`${name} is gated`, pattern.test(serveSource));
}
check(
  "each gate is inside the un-forced path only, so a forced sample still runs",
  (serveSource.match(/} else \{\s*\n\s*telemetryDemand\.noteForced\(\);/g) || []).length === 3
);
check(
  "the boot baseline is still taken once, so a browser that opens immediately sees numbers",
  /pollNvidiaVram\(true\);/.test(serveSource) &&
    /pollLlamaVram\(true\);/.test(serveSource) &&
    /pollMetalVram\(true\);/.test(serveSource)
);
const fiveSecondTimers = serveSource.match(/setInterval\([\s\S]{0,140}?,\s*5000\);/g) || [];
check(
  "the four samplers are the only five-second timers, and each names its poll",
  fiveSecondTimers.length === 4 &&
    fiveSecondTimers.every((timer) => /pollNvidiaVram|pollLlamaVram|pollMetalVram|pollMacRam/.test(timer)),
  `${fiveSecondTimers.length}: ${fiveSecondTimers.map((timer) => timer.slice(0, 40)).join(" | ")}`
);

section("4. A returning client is not handed the numbers from before the pause");
check(
  "the telemetry route is what marks a client as watching",
  /if \(req\.url === "\/api\/telemetry"[\s\S]{0,600}telemetryDemand\.note\(\);/.test(serveSource)
);
check(
  "and it wakes the samplers when the pause has lapsed",
  /const wasWatching = telemetryDemand\.wanted\(\);\s*\n\s*telemetryDemand\.note\(\);\s*\n\s*if \(!wasWatching\) refreshTelemetryNow\(\);/.test(
    serveSource
  )
);
check(
  "the wake-up does not hold the answer hostage to a GPU query",
  /if \(!wasWatching\) refreshTelemetryNow\(\);\s*\n\s*return json\(res, 200, getTelemetry\(\)\);/.test(serveSource)
);
check(
  "the refresh covers the platform's own samplers, and swallows a failure",
  /function refreshTelemetryNow\(\) \{[\s\S]{0,500}pollNvidiaVram\(true\);[\s\S]{0,300}pollMacRam\(\);[\s\S]{0,200}pollMetalVram\(true\);[\s\S]{0,200}pollLlamaVram\(true\);[\s\S]{0,200}catch \(_\)/.test(
    serveSource
  )
);

section("5. The browser stops asking while nobody is looking at it");
check("a hidden tab stops the poll", /if \(document\.hidden\) \{\s*\n\s*stopPolling\(\);/.test(appSource));
check("polling does not start at all while hidden", /if \(document\.hidden\) return;\s*\n\s*interval = setInterval\(updateTelemetry, 1500\)/.test(appSource));
check("becoming visible asks at once, then resumes the interval", /updateTelemetry\(\);\s*\n\s*startPolling\(\);/.test(appSource));
check(
  "the visibility listener is removed with the effect, so it cannot pile up",
  /document\.addEventListener\("visibilitychange", onVisibilityChange\);[\s\S]{0,400}document\.removeEventListener\("visibilitychange", onVisibilityChange\);/.test(
    appSource
  )
);
check("the interval is cleared on unmount", /return \(\) => \{\s*\n\s*stopPolling\(\);/.test(appSource));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
