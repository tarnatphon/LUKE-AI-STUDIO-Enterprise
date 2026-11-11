#!/usr/bin/env node
"use strict";

/**
 * The llama.cpp build an upgrade left behind, found by name.
 *
 * setup-llama.sh installs to `<dest>.new` and renames the previous build to
 * `<dest>.bak`; older versions wrote `<dest>.old`. Nothing removes them, and
 * nobody opens app/llm-backend — so a machine updated twice carries two
 * complete backends it will never load, Metal shaders and all.
 *
 * backend-leftovers.cjs lists them, and serve.cjs offers them as cleanup
 * candidates with their size. Nothing is deleted automatically: this is a name
 * on a list the user can act on, not a routine that removes 300 MB because it
 * guessed.
 *
 * Run: node scripts/validation/test-backend-leftovers.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-backend-leftovers-"));

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

const { findBackendLeftovers } = require(path.join(root, "scripts", "server", "backend-leftovers.cjs"));

function buildTree() {
  const base = fs.mkdtempSync(path.join(temp, "install-"));
  const mkdir = (...parts) => fs.mkdirSync(path.join(base, ...parts), { recursive: true });
  const write = (rel, bytes) => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), bytes);
  };

  // The live install, which must never be listed.
  mkdir("mac", "arm64");
  write("mac/arm64/llama-server", "ELF-b9668");

  // What an upgrade leaves: the backup the current installer makes…
  write("mac/arm64.bak/llama-server", "ELF-b9100");
  // …and the folder an older installer made, nested inside the live one.
  mkdir("mac", "arm64", "arm64.old");

  // Linux layout: mode folder plus a staging folder and a stray file.
  mkdir("linux", "cpu");
  mkdir("linux", "cpu.new");
  write("linux/llama-server.bak", "x");

  // Noise that must not match.
  write("linux/README.md", "not a backend");
  mkdir("linux", "cpu", "shaders");
  return base;
}

console.log("\n  what an upgrade leaves behind");

const base = buildTree();
const found = findBackendLeftovers(base).map((entry) => path.relative(base, entry));

check(found.includes("mac/arm64.bak"), "the installer's backup of a whole mode");
check(found.includes(path.join("mac", "arm64", "arm64.old")), "the nested leftover an older installer wrote");
check(found.includes("linux/cpu.new"), "a staging folder left by a failed upgrade");
check(found.includes("linux/llama-server.bak"), "and a single file replaced inside a mode folder");
check(found.length === 4, "exactly those four, nothing more", found.join(", "));

check(!found.includes("mac/arm64"), "the live backend is not a candidate");
check(!found.includes(path.join("mac", "arm64", "llama-server")), "nor is the binary the app runs");
check(!found.some((entry) => entry.endsWith("README.md")), "and neither is a file that merely lives there");
check(!found.some((entry) => entry.endsWith("shaders")), "nor a real subfolder with a normal name");

check(found.every((entry) => path.isAbsolute(path.join(base, entry))), "the paths are absolute, so the cleanup route can delete them");
check(found.every((entry) => !entry.includes("..")), "and all of them sit inside the backend folder");

check(JSON.stringify(findBackendLeftovers(base)) === JSON.stringify(findBackendLeftovers(base)), "the answer is stable between calls");
check(findBackendLeftovers(path.join(temp, "no-such-install")).length === 0, "a machine with no backends answers with nothing");
check(findBackendLeftovers("").length === 0 && findBackendLeftovers(null).length === 0, "and so does no argument at all");

console.log("\n  offered, not deleted");

const serve = read("scripts", "server", "serve.cjs");
check(/require\("\.\/backend-leftovers\.cjs"\)/.test(serve), "serve.cjs requires the scan");
check(/for \(const leftover of findBackendLeftovers\(path\.join\(ROOT, "app", "llm-backend"\)\)\)/.test(serve),
  "and scans the real backend folder when the cleanup list is built");
check(/backend-leftover-/.test(serve), "each one gets its own id, so the cleanup route can name it");
check(/A previous llama\.cpp backend left behind by an upgrade/.test(serve), "with a reason that says what it is");

const candidateAt = serve.indexOf("function addCleanupCandidate");
const scanAt = serve.indexOf("findBackendLeftovers(path.join(ROOT, \"app\", \"llm-backend\"))");
check(scanAt > candidateAt, "the scan feeds addCleanupCandidate, which also refuses user data");
check(/if \(!options\.allowUserData &&/.test(serve), "so a leftover can never be a model, an output or a conversation");

const leftoversSource = read("scripts", "server", "backend-leftovers.cjs");
check(!/fs\.rmSync|fs\.unlinkSync|fs\.rmdirSync/.test(leftoversSource), "the module never deletes anything itself");
check(!/rm -rf|execSync|spawnSync/.test(leftoversSource), "and never shells out to do it either");

fs.rmSync(temp, { recursive: true, force: true });
console.log(`\nPASS: ${checks} checks — a previous backend is found by name, sized, and offered, never deleted behind your back.`);
process.exit(0);
