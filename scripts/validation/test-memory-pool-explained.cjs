#!/usr/bin/env node
"use strict";

/**
 * One memory pool, and a figure that says what it is made of.
 *
 * The AI Library card used to say three different things about the same
 * machine: 13.71 GB of an "18 GB" total, "13.71 GB of the 16 GB usable pool
 * (86%)", and "model budget 12.04 GB". The 16 GB came from total RAM minus a
 * 2 GB reserve — a pool no loader uses — while 12.04 GB is what a new load is
 * actually refused against (78% of RAM, the share Metal lets a GPU address,
 * minus the same reserve). So the percentage was measured against one number
 * and the budget against another, and the user was left to work out why a
 * 13.71 GB machine said "0 GB left".
 *
 * This suite pins the fix: one pool for the sentence and the budget, the pool's
 * derivation on screen, and the resident figure broken into the models that
 * make it up — because "which one do I unload" is the only question it raises.
 *
 * Run: node scripts/validation/test-memory-pool-explained.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serveFile = path.join(root, "scripts", "server", "serve.cjs");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const serve = fs.readFileSync(serveFile, "utf8");
const manager = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "ModelManager.jsx"), "utf8");

console.log("\n  one pool, stated once");

const pressureAt = serve.indexOf("function evaluateModelMemoryBudget");
check(pressureAt > 0, "the budget function is where it was");
const pressureBlock = serve.slice(serve.indexOf("let pressureRatio = 0;"), serve.indexOf("return {\n    enabled: true,"));
check(!/const poolBytes = Math\.max\(0, totalRamBytes - reserveBytes\)/.test(serve),
  "the pressure block no longer invents a second pool out of total RAM");
check((serve.match(/const poolBytes/g) || []).length === 1,
  "there is exactly one pool in the function", String((serve.match(/const poolBytes/g) || []).length));
check(/const poolGb = Number\(\(poolBytes \/ 1024 \*\* 3\)\.toFixed\(2\)\);/.test(pressureBlock),
  "the sentence quotes the pool the loader refuses loads against");
check(/pressureRatio = poolBytes > 0 \? Number\(\(residentBytes \/ poolBytes\)\.toFixed\(2\)\) : 0;/.test(pressureBlock),
  "and the percentage is measured against that same pool");
check(/Already use \$\{residentGb\} GB of the \$\{poolGb\} GB this machine gives them/.test(serve.replace("already use", "Already use")),
  "the sentence says what the machine gives the models, not what RAM it has");
check(/That is \$\{overGb\} GB past the budget/.test(pressureBlock),
  "and when the models are past it, says by how much and what macOS is doing about it");

console.log("\n  the pool can be checked by looking at it");

check(/poolDetail: \{/.test(serve), "the payload carries how the pool was derived");
for (const field of ["source", "workingSetGb", "ratio", "reserveGb", "calibrationGb", "overBudgetGb"]) {
  check(new RegExp(`\\b${field}:`).test(serve.slice(serve.indexOf("poolDetail: {"))),
    `it names ${field}`);
}
check(/source: measuredWorkingSetGb > 0 \? "measured" : "estimated",/.test(serve),
  "and says whether Metal was measured or the figure is an estimate");
check(/overBudgetGb: Number\(Math\.max\(0, \(residentBytes - poolBytes\) \/ 1024 \*\* 3\)\.toFixed\(2\)\),/.test(serve),
  "the over-budget figure is computed from the same two numbers");

console.log("\n  and the figure says which models it counts");

check(/function residentModelBreakdown\(\) \{/.test(serve), "there is one breakdown function");
check(/function residentHeavyModelBytes\(\) \{\s*\n\s*return residentModelBreakdown\(\)\.reduce/.test(serve),
  "and the total is the sum of it, not a second copy of the arithmetic");
for (const kind of ["image", "image-loading", "text-loading", "text", "arena"]) {
  check(new RegExp(`kind: "${kind}"`).test(serve), `it labels ${kind} models`);
}
check(/parts\.filter\(\(part\) => part\.bytes > 0\)/.test(serve), "a model holding nothing is not listed");
check(/resident: residentModelBreakdown\(\)[\s\S]{0,220}\.sort\(\(a, b\) => b\.gb - a\.gb\)/.test(serve),
  "the payload lists them largest first");

console.log("\n  the card explains both numbers");

check(/memoryBudget\.poolDetail\?\.source === "measured"/.test(manager), "the budget line says when it came from Metal");
check(/ที่ Metal ยอมให้จอง/.test(manager), "and when it did not, shows the arithmetic: RAM × share − reserve");
check(/memoryBudget\.poolDetail\?\.unified && memoryBudget\.poolDetail\?\.ratio/.test(manager),
  "the share only appears on a machine where the GPU shares one pool");
check(/RAM รวม \$\{memoryBudget\.poolDetail\.totalRamGb\} GB −/.test(manager),
  "and a machine without a shared pool is told its pool is RAM minus the reserve");
check(/memoryBudget\.resident \|\| \[\]\)\.length > 0/.test(manager), "the resident models are listed");
check(/memoryBudget\.poolDetail\?\.overBudgetGb \|\| 0\) > 0/.test(manager), "past the budget, the card says so");
check(/macOS จึงบีบอัดหน่วยความจำให้/.test(manager), "with the reason it still works: macOS compresses rather than refusing");
check(/จะโหลดโมเดลใหม่เพิ่มไม่ได้จนกว่าจะปล่อยตัวใดตัวหนึ่ง/.test(manager), "and what that costs: no new model until one is unloaded");

console.log("\n  and a live server agrees with itself");

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

async function live() {
  const port = await freePort();
  const child = spawn(process.execPath, [serveFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/backend-status`);
        ready = response.status === 200;
      } catch (_) {}
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    check(ready, "the server came up");

    const budget = (await (await fetch(`http://127.0.0.1:${port}/api/backend-status`)).json()).memoryBudget;
    check(budget.poolGb > 0, "the status publishes a pool", String(budget.poolGb));
    check(budget.poolGb <= budget.workingSetGb + 0.01, "which never exceeds the working set it came from",
      `${budget.poolGb} > ${budget.workingSetGb}`);
    check(Array.isArray(budget.resident), "the resident models are an array", JSON.stringify(budget.resident));
    check(Boolean(budget.poolDetail) && ["measured", "estimated"].includes(budget.poolDetail.source),
      "the pool says where it came from", JSON.stringify(budget.poolDetail));

    const detail = budget.poolDetail;
    // Three branches, and the payload has to name which one it used: a machine
    // with no shared GPU pool is limited by total RAM, not by Metal's share.
    const derived = detail.source === "measured"
      ? detail.workingSetGb - detail.calibrationGb
      : detail.unified
        ? detail.totalRamGb * detail.ratio - detail.reserveGb - detail.calibrationGb
        : detail.totalRamGb - detail.reserveGb - detail.calibrationGb;
    check(Math.abs(derived - budget.poolGb) < 0.05,
      "and the published pool is the one its own stated arithmetic produces",
      `${budget.poolGb} vs ${derived.toFixed(2)}`);

    const warnings = (budget.warnings || []).filter((entry) => entry.code === "MODEL_MEMORY_PRESSURE");
    for (const warning of warnings) {
      const quoted = Number((warning.message.match(/of the ([\d.]+) GB/) || [])[1]);
      check(Number.isFinite(quoted) && Math.abs(quoted - budget.poolGb) < 0.05,
        "a pressure warning quotes the same pool the card prints", `${quoted} vs ${budget.poolGb}`);
    }
    if (!warnings.length) check(true, "nothing is loaded here, so there is no pressure warning to contradict the pool");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

live()
  .then(() => {
    console.log(`\nPASS: ${checks} checks — one pool, its arithmetic, and the models it is spent on.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
