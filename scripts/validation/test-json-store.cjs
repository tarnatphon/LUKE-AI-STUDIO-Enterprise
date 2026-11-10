#!/usr/bin/env node
"use strict";

/**
 * One JSON reader, one atomic writer.
 *
 * The same twenty lines were pasted into 22 modules under scripts/server. They
 * agreed on the important part — temp file, then rename — and disagreed on the
 * parts a reader has to know: eighteen threw on a missing file, three answered
 * a fallback, one swallowed write errors so a model load could not die on a
 * calibration file, two skipped the write when nothing had changed so a tracked
 * config would not show as dirty.
 *
 * They also all left the temp file behind when the rename failed, which is the
 * kind of thing 22 copies never notice about themselves.
 *
 * Run: node scripts/validation/test-json-store.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readJson, readJsonOr, writeJsonAtomic } = require("../server/json-store.cjs");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

const root = path.resolve(__dirname, "..", "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-json-store-"));
const file = (name) => path.join(temp, name);
const leftovers = () => fs.readdirSync(temp).filter((name) => name.includes(".tmp-"));

console.log("\n=== one JSON reader, one atomic writer ===\n");

// ── the bytes are the bytes ────────────────────────────────────────────────
const target = file("policy.json");
check(writeJsonAtomic(target, { a: 1, nested: { b: [1, 2] } }) === true, "a write reports that it wrote");
check(fs.readFileSync(target, "utf8") === '{\n  "a": 1,\n  "nested": {\n    "b": [\n      1,\n      2\n    ]\n  }\n}\n',
  "with two-space indent and a trailing newline, exactly as the 22 copies did");
check(leftovers().length === 0, "and no temp file is left behind", leftovers().join(","));
check(JSON.stringify(readJson(target)) === JSON.stringify({ a: 1, nested: { b: [1, 2] } }), "readJson round-trips it");

check(writeJsonAtomic(file("deep/er/state.json"), { ok: true }) === true, "a missing parent directory is created");
check(fs.existsSync(file("deep/er/state.json")), "and the file lands there");

// ── a failed write cleans up after itself ──────────────────────────────────
const blocked = file("blocked.json");
fs.mkdirSync(blocked, { recursive: true }); // rename onto a directory fails
let threw = false;
try {
  writeJsonAtomic(blocked, { nope: true });
} catch {
  threw = true;
}
check(threw, "a write that cannot land throws rather than pretending");
check(leftovers().length === 0, "and its temp file is removed — the bug all 22 copies had", leftovers().join(","));
const swallowed = writeJsonAtomic(blocked, { nope: true }, { bestEffort: true });
check(swallowed === false, "bestEffort answers false instead of throwing");
check(leftovers().length === 0, "and still cleans up", leftovers().join(","));

// ── unchanged content is not rewritten ─────────────────────────────────────
const tracked = file("tracked.json");
writeJsonAtomic(tracked, { policy: "same" });
const before = fs.statSync(tracked).mtimeMs;
const skipped = writeJsonAtomic(tracked, { policy: "same" }, { skipIfUnchanged: true });
const after = fs.statSync(tracked).mtimeMs;
check(skipped === false, "skipIfUnchanged answers false when nothing changed");
check(before === after, "and does not touch the file, so a tracked config stays clean");
check(writeJsonAtomic(tracked, { policy: "different" }, { skipIfUnchanged: true }) === true,
  "but a real change is written");

// ── reading ────────────────────────────────────────────────────────────────
let readThrew = false;
try {
  readJson(file("absent.json"));
} catch {
  readThrew = true;
}
check(readThrew, "readJson throws on a file that is not there, like the 18 copies");
fs.writeFileSync(file("broken.json"), "{not json");
readThrew = false;
try {
  readJson(file("broken.json"));
} catch {
  readThrew = true;
}
check(readThrew, "and on one that does not parse");

check(readJsonOr(file("absent.json"), { fallback: true }).fallback === true, "readJsonOr answers the fallback for a missing file");
check(readJsonOr(file("broken.json"), null) === null, "and for an unparseable one");
fs.writeFileSync(file("number.json"), "42");
check(readJsonOr(file("number.json"), "fallback") === "fallback", "a bare number is not an object, so the fallback wins");
fs.writeFileSync(file("array.json"), "[1,2]");
check(Array.isArray(readJsonOr(file("array.json"), null)), "an array is an object, so it is returned by default");
check(readJsonOr(file("array.json"), null, { rejectArrays: true }) === null,
  "unless the caller rejects arrays, as the governor's settings reader does");
check(Array.isArray(readJsonOr(file("array.json"), null, { requireObject: false })),
  "and requireObject:false returns whatever parsed, as the model pool's did");

// ── and there is only one copy of any of it ───────────────────────────────
const serverDir = path.join(root, "scripts", "server");
const duplicates = [];
for (const name of fs.readdirSync(serverDir).filter((entry) => entry.endsWith(".cjs") && entry !== "json-store.cjs")) {
  const source = fs.readFileSync(path.join(serverDir, name), "utf8");
  if (/^(?:async )?function (writeJsonAtomic|safeReadJson|readJson)\s*\(/m.test(source)) duplicates.push(name);
}
check(duplicates.length === 0, "no module under scripts/server declares its own writer or reader", duplicates.join(","));

const users = fs.readdirSync(serverDir)
  .filter((entry) => entry.endsWith(".cjs") && entry !== "json-store.cjs")
  .filter((entry) => /require\("\.\/json-store\.cjs"\)/.test(fs.readFileSync(path.join(serverDir, entry), "utf8")));
check(users.length >= 20, "and the modules that had copies now ask the store", `${users.length} modules`);

fs.rmSync(temp, { recursive: true, force: true });

console.log(`\nPASS: ${checks} checks — one implementation, three explicit options, no orphaned temp files.\n`);
