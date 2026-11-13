#!/usr/bin/env node
"use strict";

/**
 * A breadcrumb that goes somewhere.
 *
 * Three screens and two terminal messages told the user to look in
 * "Settings > Performance". There is no Performance entry in Settings: the card
 * lives inside the Text Generation section, below the Context Size slider, in a
 * block headed Model & Context. So the advice sent people to a place that does
 * not exist, which is worse than no advice — it reads as the app describing a
 * version of itself it does not have.
 *
 * This suite pins three things:
 *   1. no product string still prints the invented path
 *   2. the path that is printed is the real one, so it can be followed by eye
 *   3. the app can take you there: #performance opens Settings, expands the
 *      section, and scrolls to the card
 *
 * Run: node scripts/validation/test-performance-panel-discoverable.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const app = read("app", "frontend", "src", "App.jsx");
const settings = read("app", "frontend", "src", "components", "Settings.jsx");
const panel = read("app", "frontend", "src", "components", "PerformancePanel.jsx");
const manager = read("app", "frontend", "src", "components", "ModelManager.jsx");
const chat = read("app", "frontend", "src", "components", "TextChat.jsx");
const serve = read("scripts", "server", "serve.cjs");
const outlook = read("scripts", "server", "model-load-outlook.cjs");

console.log("\n  the invented path is gone");

for (const [name, source] of [
  ["ModelManager.jsx", manager],
  ["TextChat.jsx", chat],
  ["PerformancePanel.jsx", panel],
  ["Settings.jsx", settings],
  ["App.jsx", app],
  ["serve.cjs", serve],
  ["model-load-outlook.cjs", outlook],
]) {
  check(!/Settings\s*>\s*Performance/.test(source), `${name} no longer sends anyone to "Settings > Performance"`);
}
check(!/Settings, then Performance/.test(chat), "nor to \"Settings, then Performance\"");

console.log("\n  the real path is the one printed");

const realPath = "Settings → Text Generation → Performance";
check(outlook.includes(realPath), "the load estimate names it", outlook.match(/Cache it once[^`]*/)?.[0] || "");
check(serve.includes(realPath), "and so does the launcher's own advice");
check(/Text Generation/.test(settings), "which is the section's real title", settings.match(/title="Text Generation"/)?.[0] || "");
check(/title="Model & Context"/.test(settings) === false || /Model & Context/.test(settings),
  "and the card sits in the block headed Model & Context");
check(/<PerformancePanel/.test(settings), "the card is mounted inside that section, not next to it");

console.log("\n  and the card says where it is");

check(/id="performance-panel"/.test(panel), "the card has an id to link to");
check(/Performance &amp; model cache/.test(panel), "its heading names the cache, so it can be found by eye");
check(/This card is Settings → Text Generation → Performance/.test(panel),
  "and it states its own address instead of assuming the user remembers");

console.log("\n  a link lands where it says");

check(/window\.location\.hash\.replace\(\/\^#\/, ""\) === "performance"/.test(app),
  "App opens the Settings panel for #performance");
check(/window\.addEventListener\("hashchange", openIfAsked\)/.test(app)
  && /window\.removeEventListener\("hashchange", openIfAsked\)/.test(app),
  "and reacts when the hash changes while the app is already open");
check(/window\.location\.hash\.replace\(\/\^#\/, ""\) !== "performance"/.test(settings),
  "Settings recognises the same fragment");
check(/prev\.text \? prev : \{ \.\.\.prev, text: true \}/.test(settings),
  "expands the Text Generation section, without collapsing it if it was already open");
check(/settings_section_text", "true"/.test(settings), "and remembers that it did, so it stays open");
check(/document\.getElementById\("performance-panel"\)/.test(settings), "finds the card");
check(/scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/.test(settings), "and scrolls it into the middle of the screen");

console.log("\n  and the screens that give the advice link to it");

check(/<a href="#performance"/.test(manager), "the model card links to the panel");
check(/Settings → Text Generation → Performance/.test(manager), "with the path written out, not just an icon");
check(/<a href="#performance"/.test(chat), "and so does the stalled-load message in the chat");
check(/Cache it once button on the text model card/.test(chat),
  "which also admits the faster route: the button on the card");

console.log("\n  and the first-launch tune says what it did");

check(!/isGpuMode: true/.test(app), "the app no longer tells the server that this machine has a GPU");
check(!/isGpuMode: true/.test(panel), "and the Performance card does not tell it either");
check(
  /typeof body\.isGpuMode === "boolean" \? body\.isGpuMode : null/.test(serve),
  "the plan endpoint decides the mode itself when it is not told"
);
check(
  /gpuModeSource: requested === null \? "detected" : "requested"/.test(serve),
  "and reports who decided, so a CPU-only machine is not described as a GPU one"
);
check(/runtimeTunedNote: buildNote\(/.test(app),
  "the tune writes down what it applied, to which machine, and why");
check(/const keepThreads = currentThreads > 0 && currentThreads !== defaultThreads;/.test(app),
  "a thread count that is not the default is the user's, and is kept");
check(/tunedNote\.keptThreads \? `threads left at your \$\{tunedNote\.threads\}`/.test(panel),
  "the card says the kept count was kept, instead of quietly showing the machine's");
check(/Applied for you on first launch/.test(panel),
  "the card says the values were applied — not that they were always there");
check(/Nothing is re-applied after this/.test(panel),
  "and that nothing will overwrite them again");
check(/updateTextSetting\("runtimeTunedNote"/.test(panel),
  "pressing the button updates the explanation with the values, instead of leaving a stale one");

// #142 shipped a note that only a *new* install could ever read: a profile that
// was tuned before it existed kept `runtimeTuned: true` and got nothing.
check(/if \(prev\.runtimeTuned\) \{/.test(app) && /if \(prev\.runtimeTunedNote\) return prev;/.test(app),
  "an install tuned before the note existed gets one now, without re-applying anything");
check(/backfilled: true/.test(app), "marked as recorded now rather than applied now");
check(/Already in place from an earlier tune/.test(panel),
  "and the card says which it was, instead of claiming a first launch that already happened");
check(/const buildNote = \(\{ threads, keptThreads, batchSize, ubatchSize, backfilled \}\) => \(\{/.test(app),
  "one note shape for both paths, so they cannot drift apart");

// A tune is planned for one backend. If the machine starts running models
// somewhere else, those numbers are someone else's.
check(/const tunedModeMismatch = Boolean\(tunedNote\)/.test(panel) && /tunedNote\.gpuMode !== plan\.isGpuMode/.test(panel),
  "the card compares the backend the values were planned for with the one in use");
check(/Those values were planned for \{tunedNote\.gpuMode \? "the GPU" : "the CPU"\}/.test(panel),
  "and says which, when they no longer match");
check(/Press the button above to plan them again for the current backend\./.test(panel),
  "with the one action that fixes it");

console.log("\n  and a measurement outlives the visit that took it");

// "Measure once" that forgets the result the moment the panel closes makes the
// card claim it knows nothing every time it is opened — and the number was the
// point of the button.
check(/const MEASURED_KEY = "luke\.performance\.measured";/.test(panel),
  "the measurement has a key of its own");
check(/const \[measured, setMeasured\] = useState\(\(\) => readStoredMeasurement\(\)\)/.test(panel),
  "and is put back when the card opens, before anything is measured again");
check(/storeMeasurement\(data\.result, mmapStatus\?\.model\)/.test(panel),
  "a successful measurement is stored with the model it was taken on");
check(panel.indexOf("storeMeasurement(data.result") > panel.indexOf("if (!response.ok) throw new Error"),
  "only on success — a failure is a message, not a result");
check(!/storeMeasurement\(\{ error/.test(panel), "an error is never written to storage");
check(/function describeMeasurementAge\(at\)/.test(panel) && /return "Measured just now";/.test(panel),
  "the age is printed, because a number without one is a claim about right now");
check(/Measured \$\{minutes\} min ago/.test(panel) && /Measured \$\{Math\.round\(hours \/ 24\)\} d ago/.test(panel),
  "in minutes, hours and days");
check(/describeMeasurementAge\(measured\.at\)\}\$\{measured\.model \? ` on \$\{measured\.model\}`/.test(panel),
  "next to the model it describes");
check(/measured\?\.tokensPerSecond \? "Measure again" : "Measure speed"/.test(panel),
  "and the button offers to take a new one instead of pretending none exists");

console.log(`\nPASS: ${checks} checks — the advice points at a place that exists, and the app can take you there.`);
