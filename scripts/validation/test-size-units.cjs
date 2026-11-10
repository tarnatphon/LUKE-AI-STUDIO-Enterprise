"use strict";

/**
 * Sizes carry a unit, and the name has to carry it too.
 *
 * The bug this suite pins: `roundGb` existed four times and meant two things.
 * Three copies divided bytes by 1024³; the copy in `gpu-memory-telemetry.cjs`
 * took a number that was already GB. `serve.cjs` then fed it
 * `estimateGb - availableGb` — GB minus GB — and got back that difference
 * *divided by a gibibyte*. A 4 GB shortfall became 0.00 GB, `planMakeRoom()`
 * answered NO_SHORTFALL, and the resource governor never made room for
 * anything: every blocking load was refused with advice to unload by hand.
 *
 * So this checks three things — the arithmetic, the integration it broke, and
 * that nobody has quietly grown a fifth copy.
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const { GIB, bytesToGib, gbShortfall, gibRounded } = require("../../scripts/server/size-units.cjs");
const { planMakeRoom, DEFAULT_POLICY } = require("../../scripts/server/resource-governor.cjs");

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── bytes in, GiB out ─────────────────────────────────────────────────────────
check("a gibibyte is 1024³", GIB === 1073741824, String(GIB));
check("4 GiB of bytes reads as 4", bytesToGib(4 * GIB) === 4, String(bytesToGib(4 * GIB)));
check("a byte count rounds to two places", bytesToGib(Math.round(4.567 * GIB)) === 4.57, String(bytesToGib(Math.round(4.567 * GIB))));
check("and to one where a tenth is enough", bytesToGib(Math.round(4.567 * GIB), 1) === 4.6, String(bytesToGib(Math.round(4.567 * GIB), 1)));
check("zero bytes is zero, not NaN", bytesToGib(0) === 0);
check("an unreadable size is zero rather than null in JSON", bytesToGib(null) === 0 && bytesToGib(undefined) === 0 && bytesToGib("nonsense") === 0);
check("a negative size is zero", bytesToGib(-5 * GIB) === 0, String(bytesToGib(-5 * GIB)));

// ── GiB in, GiB out ──────────────────────────────────────────────────────────
check("a figure that is already GB is only rounded", gibRounded(4.567) === 4.57, String(gibRounded(4.567)));
check("and is not divided again", gibRounded(4) === 4, String(gibRounded(4)));
check("not a number rounds to zero", gibRounded(NaN) === 0 && gibRounded(undefined) === 0);

// ── the subtraction the governor lives on ────────────────────────────────────
check("a 4 GB shortfall is 4 GB", gbShortfall(12, 8) === 4, String(gbShortfall(12, 8)));
check("a load that fits is a zero shortfall", gbShortfall(8, 12) === 0, String(gbShortfall(8, 12)));
check("a fractional gap survives rounding", gbShortfall(12.4, 12) === 0.4, String(gbShortfall(12.4, 12)));
check("a missing budget is a zero shortfall", gbShortfall(undefined, undefined) === 0);

// The old code path, kept here as the counter-example it is: dividing the same
// difference by 1024³ is what made every shortfall vanish.
const theOldWay = Math.round(((12 - 8) / GIB) * 100) / 100;
check("the way it used to be computed was 0.00 for a 4 GB gap", theOldWay === 0, String(theOldWay));

// ── and the planner it feeds ─────────────────────────────────────────────────
const engine = { id: "image", label: "Image engine", resident: true, makeRoom: true, busy: false, sizeGb: 6.6 };
const withFix = planMakeRoom({ shortfallGb: gbShortfall(12, 8), engines: [engine], policy: DEFAULT_POLICY });
const withoutIt = planMakeRoom({ shortfallGb: theOldWay, engines: [engine], policy: DEFAULT_POLICY });
check("a real shortfall makes the planner free room", withFix.code === "MAKE_ROOM" && withFix.engines.length === 1, withFix.code);
check("the four-fold-divided one told it the load already fits", withoutIt.code === "NO_SHORTFALL", withoutIt.code);

// ── one implementation, and the names say which unit goes in ─────────────────
const serverDir = path.join(root, "scripts", "server");
const sourceFiles = fs.readdirSync(serverDir).filter((name) => name.endsWith(".cjs"));
const offenders = sourceFiles.filter((name) => {
  if (name === "size-units.cjs") return false;
  const source = fs.readFileSync(path.join(serverDir, name), "utf8");
  return /function\s+roundGb\s*\(/.test(source) || /(?:^|[^.\w])roundGb\s*\(/m.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
});
check("no module defines its own roundGb any more", offenders.length === 0, offenders.join(", "));

const users = [
  ["serve.cjs", "bytesToGib"],
  ["model-load-guard.cjs", "bytesToGib"],
  ["background-model-suggestion.cjs", "bytesToGib"],
  ["gpu-memory-telemetry.cjs", "gibRounded"],
];
for (const [file, helper] of users) {
  const source = fs.readFileSync(path.join(serverDir, file), "utf8");
  check(`${file} takes ${helper} from size-units`, source.includes(`require("./size-units.cjs")`) && new RegExp(`\\b${helper}\\(`).test(source));
  check(`${file} keeps no second conversion of its own`, !/Math\.round\([^)]*1024\s*\*\*\s*3/.test(source));
}

const serveSource = fs.readFileSync(path.join(serverDir, "serve.cjs"), "utf8");
check("the shortfall is computed in GB, from the budget's own units",
  /gbShortfall\(budget\?\.estimateGb, budget\?\.availableGb\)/.test(serveSource));
check("and nothing hands bytesToGib a difference of GB figures",
  !/bytesToGib\(\s*Math\.max\(0, \(Number\(budget\?\.estimateGb\)/.test(serveSource));

console.log("");
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks — ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`PASS: ${passed} checks — a size says which unit went in, and the governor gets a gap it can act on.`);
