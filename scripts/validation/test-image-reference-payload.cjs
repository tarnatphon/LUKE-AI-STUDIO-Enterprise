#!/usr/bin/env node
"use strict";

/**
 * What actually goes on the wire when a reference image is attached.
 *
 * The Generator used to attach every reference to every generate request as
 * base64 (`reference_images` / `reference_settings` / `reference_mode`). The
 * bundled backend reads none of those fields on `/v1/images/generations` or
 * `/sdapi/v1/img2img` — its native schema calls the same idea `ref_images`, and
 * only the native `/sdcpp/v1/*` routes and a `<sd_cpp_extra_args>` block inside
 * the prompt accept it — so each request carried about 30 MB for twenty photos
 * and the backend threw all of it away. The same bytes were also copied into
 * every output's metadata JSON, and the reference list itself was written to
 * localStorage as data URLs until the quota failed silently.
 *
 * This suite pins the contract that replaced it:
 *
 *   1. the generate request carries no reference blob and no dead field
 *   2. the reference that reaches the model is the init image (img2img), whose
 *      denoise and step budget are already covered by test-image-img2img-step-scaling
 *   3. output metadata names references by asset id + URL, never by bytes
 *   4. the server serves the stored bytes back on GET /api/reference-file, with
 *      a containment guard, and the upload route returns that URL
 *   5. the panel keeps the disk URL on the reference, so persistence can drop
 *      the base64 without losing the file
 *
 * The checks are source-level on purpose: they are about which fields exist,
 * not about runtime values, and they have to run in CI without a built frontend
 * or an installed server dependency tree (see run-all.cjs).
 *
 * Run: node scripts/validation/test-image-reference-payload.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const apiFile = path.join(root, "app", "frontend", "src", "services", "api.js");
const generatorFile = path.join(root, "app", "frontend", "src", "components", "Generator.jsx");
const managerFile = path.join(root, "app", "frontend", "src", "components", "ReferenceManager.jsx");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

function test(name, fn) {
  console.log(`\n${name}`);
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${error.message}`);
  }
}

const read = (file) => fs.readFileSync(file, "utf8");
/** Compare code, not formatting: the repo mixes wrapped and single-line styles. */
const flat = (text) => text.replace(/\s+/g, " ");

/** The slice of `generateImage` that builds and sends the request body. */
function generateImageSource() {
  const source = flat(read(apiFile));
  const start = source.indexOf("export async function generateImage(");
  assert(start >= 0, "api.js still exports generateImage");
  return source.slice(start, start + 9000);
}

test("the generate request carries no reference blob and no dead field", () => {
  const body = generateImageSource();

  for (const dead of ["reference_images:", "reference_settings:", "reference_mode:"]) {
    assert(!body.includes(dead), `the request body does not set ${dead.slice(0, -1)}`);
  }

  // The payload object itself: the reference parameters stay in the signature
  // (they feed the prompt boost, the step plan and the saved metadata) but must
  // not be copied into the object that becomes JSON on the wire.
  const payloadBlock = body.slice(body.indexOf("const payload = {"), body.indexOf("};", body.indexOf("const payload = {")));
  assert(!payloadBlock.includes("referenceImages"), "the wire payload does not carry the reference list");
  assert(!payloadBlock.includes("referenceSettings"), "the wire payload does not carry the reference settings");
  assert(payloadBlock.includes("image: inputImageBase64"), "the primary reference still travels as the init image");
});

test("output metadata names references without their bytes", () => {
  const generator = flat(read(generatorFile));

  const block = generator.slice(
    generator.indexOf("const referencePayload = activeReferences.map"),
    generator.indexOf("const handleUseReferenceAsBase")
  );
  assert(block.length > 0, "Generator.jsx still builds a reference payload for metadata");
  assert(!/\bsrc:/.test(block), "the metadata payload stores no image bytes");
  assert(block.includes("assetId: item.assetId"), "it records which asset was used");
  assert(block.includes("url: referenceUrlFromAsset(item)"), "it records where the file lives");
});

test("the server serves the stored bytes back", () => {
  const server = flat(read(serverFile));

  const route = server.slice(
    server.indexOf('req.url.startsWith("/api/reference-file")'),
    server.indexOf('req.url.startsWith("/sa-products/")')
  );
  assert(route.length > 0, "GET /api/reference-file exists");
  assert(route.includes('req.method === "GET"'), "and only answers GET");
  assert(route.includes("path.basename("), "the file name is reduced to a base name");
  assert(route.includes("pathInside(filePath, REFERENCE_OUTPUTS)"), "and the resolved path must stay inside the folder");
  assert(route.includes('"Cache-Control": "public, max-age=31536000, immutable"'), "content-addressed files are cached hard");

  assert(
    server.includes("const REFERENCE_OUTPUTS = path.join(OUTPUTS, \"references\")"),
    "the reference folder has one constant, shared by the route and the upload"
  );
  assert(
    server.includes("const outputDir = REFERENCE_OUTPUTS;"),
    "the upload writes into that same folder"
  );
  assert(
    server.includes("url: `/api/reference-file?filename=${encodeURIComponent(path.basename(outputPath))}`"),
    "the upload tells the client where the bytes can be fetched"
  );
});

test("the panel keeps the disk URL on the reference", () => {
  const manager = flat(read(managerFile));

  assert(
    manager.includes("import { referenceUrlFromAsset } from \"../lib/reference-storage.mjs\""),
    "the panel imports the same URL builder the Generator persists with"
  );
  const uploadBlock = manager.slice(
    manager.indexOf("const reference = normalizeReference({"),
    manager.indexOf("const reference = normalizeReference({") + 4000
  );
  assert(
    uploadBlock.includes("referenceUrlFromAsset( uploaded?.reference )") ||
      uploadBlock.includes("referenceUrlFromAsset(uploaded?.reference)"),
    "the uploaded reference record contributes its URL"
  );
  const normalizeBlock = manager.slice(
    manager.indexOf("function normalizeReference(item, index = 0)"),
    manager.indexOf("const ReferenceCard")
  );
  assert(normalizeBlock.includes("url: item.url || referenceUrlFromAsset(item) || \"\""), "normalizeReference keeps it");
  assert(normalizeBlock.includes("assetId: item.assetId || null"), "and keeps the asset id");
});

test("the Generator persists through the shared key, budget and hydration", () => {
  const generator = flat(read(generatorFile));

  assert(
    generator.includes("import { REFERENCE_SOURCE_BUDGET_BYTES, REFERENCE_STORAGE_KEY, blobToDataUrl, referenceUrlFromAsset, referencesNeedingHydration, toPersistedReferences, } from \"../lib/reference-storage.mjs\""),
    "the storage module is imported once, by name"
  );
  assert(
    generator.includes("const persisted = toPersistedReferences(referenceImages);") &&
      generator.includes("localStorage.setItem(REFERENCE_STORAGE_KEY, JSON.stringify(persisted.items));"),
    "the write goes through toPersistedReferences and the shared key"
  );
  assert(
    generator.includes("referencesNeedingHydration(referenceImages, { attempted: hydrationAttemptsRef.current })"),
    "only records that need their bytes are fetched back"
  );
  assert(
    generator.includes("const src = await blobToDataUrl(await res.blob());"),
    "the fetched bytes become a data URL again"
  );
  assert(
    generator.includes("const referencesMissingSource = activeReferences.filter("),
    "the panel can name the references that have no usable source"
  );
  assert(
    generator.includes("Could not persist reference images"),
    "a failed write is still reported instead of passing silently"
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
