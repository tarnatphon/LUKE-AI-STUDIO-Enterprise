#!/usr/bin/env node
"use strict";

/**
 * One containment rule, one home expansion, one streaming hash.
 *
 * `isPathInside` was defined three times: serve.cjs as (parent, child), the S3
 * adapter and the storage destination manager as (candidate, root) — the same
 * name, the opposite argument order, in the code that refuses a download
 * destination outside an approved root. `expandHome` existed four times and
 * `sha256File` four times, byte-identical.
 *
 * Copies that agree today are not the problem. The problem is the day one copy
 * is fixed: a containment check that exists in three shapes is one edit away
 * from not containing anything, and nothing in the suite would have noticed.
 * These checks pin the consolidation and the behaviour that must survive it,
 * including the argument order the two reversed callers now use.
 *
 * Run: node scripts/validation/test-shared-path-helpers.cjs
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const server = path.join(root, "scripts", "server");

let checks = 0;
function check(condition, message, detail = "") {
  if (!condition) throw new Error(`FAIL: ${message}${detail ? ` — ${detail}` : ""}`);
  checks += 1;
  console.log(`  PASS  ${message}`);
}

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

// Every .cjs under scripts/server, so a new copy anywhere is caught.
function serverFiles() {
  return fs.readdirSync(server)
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => ({ name, text: fs.readFileSync(path.join(server, name), "utf8") }));
}

const { expandHome, isPathInside } = require(path.join(server, "path-safety.cjs"));
const { sha256File } = require(path.join(server, "hash-file.cjs"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-path-safety-"));

(async () => {
  console.log("\n  one definition each");

  const files = serverFiles();
  for (const helper of ["isPathInside", "expandHome", "sha256File"]) {
    const definitions = files.filter((file) => new RegExp(`^(async )?function ${helper}\\(`, "m").test(file.text));
    check(definitions.length === 1, `${helper} is defined exactly once`, definitions.map((f) => f.name).join(", "));
    const home = helper === "sha256File" ? "hash-file.cjs" : "path-safety.cjs";
    check(definitions.length === 1 && definitions[0].name === home, `${helper} lives in ${home}`, definitions.map((f) => f.name).join(", "));
  }

  console.log("\n  isPathInside(parent, child)");

  check(isPathInside("/data/safe", "/data/safe/models/a.gguf"), "a file below the root is inside");
  check(isPathInside("/data/safe", "/data/safe"), "the root itself is inside");
  check(isPathInside("/data/safe/", "/data/safe/x"), "a trailing separator on the root changes nothing");
  check(isPathInside("/data/safe", "/data/safe/deep/er/still"), "depth does not matter");
  check(isPathInside("/data/safe", "/data/other/../safe/x"), "a path that resolves back inside is inside");

  // The bug a plain startsWith("/data/safe") writes.
  check(!isPathInside("/data/safe", "/data/safe-elsewhere/x"), "a sibling sharing the prefix is NOT inside");
  check(!isPathInside("/data/safe", "/data/safe2"), "and neither is the sibling itself");
  check(!isPathInside("/data/safe", "/data"), "a parent of the root is not inside it");
  check(!isPathInside("/data/safe", "/etc/passwd"), "an absolute path elsewhere is outside");
  check(!isPathInside("/data/safe", "/data/safe/../../etc/passwd"), "and .. cannot climb out of an accepted root");

  // Refusing on bad input is the only safe default for a guard used to deny.
  for (const [parent, child, label] of [
    [undefined, "/data/safe/x", "a missing root"],
    ["/data/safe", undefined, "a missing candidate"],
    ["", "/data/safe/x", "an empty root"],
    ["/data/safe", "", "an empty candidate"],
    ["", "", "two empty strings (path.resolve('') is the cwd)"],
    [null, null, "nulls"],
    [42, "/data/safe/x", "a number"],
    ["/data/safe", {}, "an object"],
  ]) {
    let threw = null;
    let answer = null;
    try {
      answer = isPathInside(parent, child);
    } catch (error) {
      threw = error;
    }
    check(threw === null && answer === false, `${label} answers false and does not throw`, threw ? threw.message : String(answer));
  }

  console.log("\n  expandHome");

  check(expandHome("~") === os.homedir(), "~ is the home directory");
  check(expandHome("~/models") === path.join(os.homedir(), "models"), "~/x is below the home directory");
  check(expandHome("/Volumes/AI/llm-models") === "/Volumes/AI/llm-models", "an absolute path is untouched");
  // Three of the four copies this replaces resolved, and their callers rely on
  // an absolute answer before comparing it with a mount or writing under it.
  check(expandHome("relative/path") === path.resolve("relative/path"), "a relative path is made absolute, as the storage stack needs");
  check(expandHome("/tmp/~foo") === "/tmp/~foo", "a ~ in the middle of a path is not a home directory");
  check(expandHome("~other") === path.resolve("~other"), "nor is ~user, which this never supported");
  // path.resolve("") is the working directory, so a provider with no root
  // configured used to arrive as the checkout and pass "is this usable?".
  check(expandHome(undefined) === "" && expandHome(null) === "", "nothing stays nothing, instead of becoming the working directory");
  check(expandHome("") === "", "and an empty string stays empty");

  console.log("\n  sha256File");

  const small = path.join(temp, "small.bin");
  fs.writeFileSync(small, "luke");
  const expected = crypto.createHash("sha256").update("luke").digest("hex");
  check((await sha256File(small)) === expected, "the digest is the sha256 of the content");

  const twin = path.join(temp, "twin.bin");
  fs.writeFileSync(twin, "luke");
  check((await sha256File(twin)) === (await sha256File(small)), "equal files hash equally");
  fs.writeFileSync(twin, "luke2");
  check((await sha256File(twin)) !== (await sha256File(small)), "one extra byte changes the digest");

  // 8 MB, larger than one read chunk, so the for-await path is really used.
  const big = path.join(temp, "big.bin");
  const payload = crypto.randomBytes(1024 * 1024);
  const fd = fs.openSync(big, "w");
  for (let i = 0; i < 8; i += 1) fs.writeSync(fd, payload);
  fs.closeSync(fd);
  check((await sha256File(big)) === crypto.createHash("sha256").update(Buffer.concat(Array(8).fill(payload))).digest("hex"),
    "a file spanning many chunks hashes correctly");

  const missing = await sha256File(path.join(temp, "not-there.bin")).then(() => null, (error) => error);
  check(missing && missing.code === "ENOENT", "a missing file rejects with ENOENT, so callers can say so", missing ? missing.code : "resolved");

  const hashSource = read("scripts", "server", "hash-file.cjs");
  check(!/readFile(Sync)?\(/.test(hashSource), "the hash never reads the whole file into memory");
  check(/for await/.test(hashSource), "it streams");

  console.log("\n  the guards that depend on it");

  // Both of these were already written to refuse a provider with no root. They
  // could never fire while expandHome turned "" into the cwd, so the provider
  // was reported reachable and the transfer wrote under the server's directory.
  const providerCore = read("scripts", "server", "unified-storage-provider-core.cjs");
  const transferQueue = read("scripts", "server", "unified-storage-transfer-queue.cjs");
  check(/if \(\s*!rootPath \|\|\s*!fs\.existsSync\(rootPath\)\s*\)/.test(providerCore.replace(/\s+/g, " ").replace(/if \( /g, "if (")),
    "a storage provider without a root is reported offline, not as the checkout");
  check(/if \(!rootPath\)/.test(transferQueue.replace(/\s+/g, " ")), "and a transfer without a destination root throws instead of writing");
  check(/ENOTFOUND/.test(transferQueue), "with a code the UI can show");

  console.log("\n  every caller uses the shared copy");

  for (const name of [
    "serve.cjs",
    "s3-compatible-storage-adapter.cjs",
    "storage-destination-manager.cjs",
    "text-runtime-installer.cjs",
    "unified-storage-provider-core.cjs",
    "unified-storage-transfer-queue.cjs",
  ]) {
    const text = read("scripts", "server", name);
    check(/require\("\.\/path-safety\.cjs"\)/.test(text), `${name} requires path-safety.cjs`);
  }
  for (const name of [
    "storage-archive-restore-manager.cjs",
    "storage-deep-cloud-integrity-manager.cjs",
    "storage-integrity-scanner.cjs",
    "storage-safe-archive-manager.cjs",
  ]) {
    const text = read("scripts", "server", name);
    check(/require\("\.\/hash-file\.cjs"\)/.test(text), `${name} requires hash-file.cjs`);
  }

  // The two files that had the arguments the other way round now pass the root
  // first, like everyone else. A silent swap here would invert a 403.
  const s3 = read("scripts", "server", "s3-compatible-storage-adapter.cjs");
  const destination = read("scripts", "server", "storage-destination-manager.cjs");
  check(/!isPathInside\(\s*approvedRoot,\s*destination\s*\)/.test(s3), "the S3 adapter asks (approvedRoot, destination)");
  check(/isPathInside\(\s*approvedRoot,\s*filePath\s*\)/.test(destination), "the destination manager asks (approvedRoot, filePath)");
  check(/!isPathInside\(\s*localRoot,\s*resolvedSource\s*\)/.test(destination), "and (localRoot, resolvedSource)");
  check(/!isPathInside\(\s*externalRoot,\s*destinationPath\s*\)/.test(destination), "and (externalRoot, destinationPath)");
  check(/!isPathInside\(\s*localRoot,\s*confirmation\.sourcePath\s*\)/.test(destination), "and (localRoot, confirmation.sourcePath)");

  // serve.cjs kept its own argument order; those call sites did not need to move.
  const serve = read("scripts", "server", "serve.cjs");
  check(/isPathInside\(candidate, protectedPath\)/.test(serve) && /isPathInside\(protectedPath, candidate\)/.test(serve),
    "serve.cjs still asks both directions, unchanged");

  console.log("\n  inline copies that remain (recorded, not rewritten)");

  // The survey that followed the consolidation. These are equivalent to
  // isPathInside() and are deliberately left alone — each is inside a larger
  // routine that is being changed for other reasons. The list is a ratchet: a
  // NEW file that hand-rolls containment fails here, so the sixth copy cannot
  // appear quietly the way the first five did.
  const knownInline = [
    "chat-history-archive.cjs", // history file inside HISTORY_DIR
    "serve.cjs",                // storagePathViolation, resolveInsideRoot, dist containment
    "storage-locations.cjs",    // the storage-path refusals
    "text-model-pool.cjs",      // a resolved model path under modelsDir
    "work-path-guard.cjs",      // realpath containment, plus a ".." check that is not containment
  ];
  const inline = serverFiles()
    .filter((file) => file.name !== "path-safety.cjs")
    .filter((file) => /startsWith\([^\n]*path\.sep/.test(file.text))
    .map((file) => file.name);
  check(
    inline.every((name) => knownInline.includes(name)),
    "no new hand-rolled containment check appeared",
    inline.filter((name) => !knownInline.includes(name)).join(", ")
  );
  for (const name of knownInline) {
    check(inline.includes(name), `${name} still contains its known inline check (update the list when it moves to isPathInside)`);
  }

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`\nPASS: ${checks} checks — one containment rule, one home expansion, one streaming hash.`);
  process.exit(0);
})().catch((error) => {
  fs.rmSync(temp, { recursive: true, force: true });
  console.error(`\n${error.message}`);
  process.exit(1);
});
