#!/usr/bin/env node
"use strict";

/**
 * The cloud SDK is loaded by the call that needs it, not by every start-up.
 *
 * Measured with one probe on both sides (server booted, left idle, same
 * machine): 89 modules / 77.4 MB RSS / 16.0 MB heap with the SDK required at the
 * top of the adapter, 61 modules / 63.2 MB RSS / 9.4 MB heap with it required on
 * first use. serve.cjs loads that adapter at boot, so an offline studio was
 * carrying an S3 client in its working set on every machine, including the ones
 * that never open cloud storage.
 *
 * `work-project-search.cjs` already requires jszip/mammoth/read-excel-file from
 * inside the functions that use them; this suite holds that line for the whole
 * server tree, and then proves the lazy path still works when a provider is
 * really contacted — laziness that never loads anything is just a broken
 * feature.
 *
 * Nothing here needs network access or credentials: constructing an S3 client
 * is local, and the checks stop there.
 *
 * Run: node scripts/validation/test-lazy-cloud-sdk.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const serverDir = path.join(root, "scripts", "server");

// Packages that cost tens of megabytes to load and that a plain local run never
// touches. pdfjs-dist is in the list even though nothing in scripts/ requires it
// today: the rule is about start-up cost, and it should stay true if it arrives.
const HEAVY_PACKAGES = ["@aws-sdk/client-s3", "@aws-sdk/lib-storage", "jszip", "mammoth", "pdfjs-dist", "read-excel-file"];

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

function awsInCache() {
  return Object.keys(require.cache).filter((key) => key.includes("@aws-sdk"));
}

section("1. No heavy package is required at module load, anywhere in scripts/");
{
  const offenders = [];
  // scripts/server only: that is the tree the server loads at boot. The
  // validation suites are exempt on purpose — several of them assert on source
  // text that *mentions* `require("mammoth")`, which is not a require.
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!/\.cjs$/.test(entry.name)) continue;
      const lines = fs.readFileSync(full, "utf8").split("\n");
      lines.forEach((line, index) => {
        const wanted = HEAVY_PACKAGES.find((pkg) => line.includes(`require("${pkg}`) || line.includes(`require('${pkg}`));
        if (!wanted) return;
        // A top-level require starts at column 0, either as `require(...)` or as
        // the closing `} = require(...)` of a destructured one. Anything indented
        // is inside a function, which is where these belong.
        if (/^\S/.test(line)) {
          offenders.push(`${path.relative(root, full)}:${index + 1} ${wanted}`);
        }
      });
    }
  };
  walk(serverDir);
  check("every heavy require sits inside a function", offenders.length === 0, offenders.join(" · "));
}

section("2. Requiring the adapter loads no SDK");
{
  const before = Object.keys(require.cache).length;
  const { S3CompatibleStorageAdapter } = require("../server/s3-compatible-storage-adapter.cjs");
  const loaded = Object.keys(require.cache).length - before;
  check("the adapter itself loads", typeof S3CompatibleStorageAdapter === "function");
  check("and it is a small module graph", loaded < 40, `${loaded} modules`);
  check("no @aws-sdk package came with it", awsInCache().length === 0, awsInCache().slice(0, 3).join(" · "));
}

section("3. Building an adapter loads no SDK either");
{
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "luke-lazy-sdk-")), "state.json");
  const adapter = new (require("../server/s3-compatible-storage-adapter.cjs").S3CompatibleStorageAdapter)({
    providerCore: {},
    credentialVault: {},
    statePath,
  });
  check("the default factories are deferred, not built", typeof adapter.clientFactory === "function" && typeof adapter.uploadFactory === "function");
  check("constructing it kept the SDK out of memory", awsInCache().length === 0, awsInCache().slice(0, 3).join(" · "));
  fs.rmSync(path.dirname(statePath), { recursive: true, force: true });
}

section("4. Using it does load the SDK — the feature still works");
{
  const { S3CompatibleStorageAdapter } = require("../server/s3-compatible-storage-adapter.cjs");
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "luke-lazy-sdk-")), "state.json");
  const adapter = new S3CompatibleStorageAdapter({ providerCore: {}, credentialVault: {}, statePath });

  let client = null;
  try {
    client = adapter.clientFactory({ region: "us-east-1", credentials: { accessKeyId: "x", secretAccessKey: "y" } });
  } catch (error) {
    check("the client factory works when a provider is contacted", false, String(error && error.message));
  }
  check("contacting a provider loads @aws-sdk/client-s3", awsInCache().some((key) => key.includes("client-s3")));
  check("and builds a usable client", Boolean(client) && typeof client.send === "function");

  try {
    adapter.uploadFactory({ client, params: { Bucket: "bucket", Key: "key", Body: Buffer.from("payload") } });
  } catch (_) {
    // The point of this call is the require, which happens before the
    // constructor can object to anything.
  }
  check("uploading loads @aws-sdk/lib-storage", awsInCache().some((key) => key.includes("lib-storage")));

  // Requiring twice must not cost twice.
  const afterFirst = awsInCache().length;
  adapter.clientFactory({ region: "us-east-1", credentials: { accessKeyId: "x", secretAccessKey: "y" } });
  check("the SDK is loaded once and then cached by node", awsInCache().length === afterFirst);

  try { client?.destroy?.(); } catch (_) {}
  fs.rmSync(path.dirname(statePath), { recursive: true, force: true });
}

section("5. The reason is written down where the next reader will look");
{
  const source = fs.readFileSync(path.join(serverDir, "s3-compatible-storage-adapter.cjs"), "utf8");
  check("the file says why the SDK is deferred", /required on first use, not at boot/i.test(source));
  check(
    "and it records the measured before and after, so the claim can be re-checked",
    /77\.4 MB/.test(source) && /63\.2 MB/.test(source) && /41% of the heap/.test(source)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
