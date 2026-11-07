#!/usr/bin/env node
/**
 * Reference images stay inside the localStorage quota, and nothing is lost
 * quietly.
 *
 * The Generator used to write every reference to localStorage as a base64 data
 * URL. localStorage is about 5 MB per origin, so three or four phone photos
 * filled it; the write threw, the catch only logged a warning, and the whole
 * reference panel was gone after the next reload. The same bytes were also
 * re-sent with every generate request and copied into every output's metadata.
 *
 * The upload route already stores each file on disk, so the browser should keep
 * a URL and fetch the bytes back on load. This suite pins that behaviour on the
 * pure module the Generator calls (app/frontend/src/lib/reference-storage.mjs):
 *
 *   1. a disk-backed reference persists without its `src`
 *   2. a reference with no disk copy keeps its `src` while it fits
 *   3. over budget, the newest sources survive and the dropped ones say so
 *   4. hydration names exactly the records that need their bytes fetched back
 *   5. the URL is built from whatever the upload route returned
 *
 * Run: node scripts/validation/test-image-reference-storage.mjs
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const modulePath = path.join(root, "app", "frontend", "src", "lib", "reference-storage.mjs");

const {
  REFERENCE_SOURCE_BUDGET_BYTES,
  REFERENCE_STORAGE_KEY,
  blobToDataUrl,
  referenceFileUrl,
  referenceFileName,
  referenceUrlFromAsset,
  referencesNeedingHydration,
  toPersistedReferences,
} = await import(pathToFileURL(modulePath).href);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

async function test(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${error.message}`);
  }
}

function dataUrl(size = 64, fill = "A") {
  return `data:image/png;base64,${fill.repeat(size)}`;
}

function reference(overrides = {}) {
  return {
    id: overrides.id || `ref-${Math.random().toString(16).slice(2)}`,
    name: "Portrait",
    src: dataUrl(64),
    weight: 1,
    enabled: true,
    createdAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

await test("a disk-backed reference is persisted without its bytes", () => {
  const item = reference({
    id: "ref-disk",
    url: "/api/reference-file?filename=ref-abc.png",
    assetId: "asset-1",
  });
  const result = toPersistedReferences([item]);

  assert(result.items.length === 1, "the reference is still listed");
  assert(result.items[0].src === undefined, "the base64 source is not written to localStorage");
  assert(result.items[0].url === "/api/reference-file?filename=ref-abc.png", "the disk URL is kept");
  assert(result.items[0].assetId === "asset-1", "the asset id is kept");
  assert(result.items[0].sourceMissing === undefined, "a disk-backed reference is not marked missing");
  assert(item.src !== undefined, "the in-memory item is not mutated");
  assert(result.droppedSourceIds.length === 0, "nothing was reported as dropped");
});

await test("a reference that never reached the disk keeps its source", () => {
  const offline = reference({ id: "ref-local" });
  const result = toPersistedReferences([offline]);

  assert(result.items[0].src === offline.src, "the source survives, so the reference still works");
  assert(result.items[0].sourceMissing === undefined, "nothing is marked missing while it fits");
  assert(result.keptSourceIds.includes("ref-local"), "it is reported as kept");
  assert(result.sourceBytes === offline.src.length, "the kept bytes are counted");
});

await test("over budget, the newest sources survive and the rest say so", () => {
  const budget = 200;
  const oldest = reference({ id: "ref-old", src: dataUrl(120, "O"), createdAt: "2026-10-01T00:00:00.000Z" });
  const newest = reference({ id: "ref-new", src: dataUrl(120, "N"), createdAt: "2026-10-08T00:00:00.000Z" });

  const result = toPersistedReferences([oldest, newest], { budgetBytes: budget });

  assert(result.items.find((item) => item.id === "ref-new").src !== undefined, "the newest source is kept");
  assert(result.items.find((item) => item.id === "ref-new").sourceMissing === undefined, "the newest is not flagged");
  const dropped = result.items.find((item) => item.id === "ref-old");
  assert(dropped.src === undefined, "the oldest source is left out of the write");
  assert(dropped.sourceMissing === true, "the oldest is flagged, so the panel can ask for the file again");
  assert(dropped.name === "Portrait", "its metadata is kept either way");
  assert(result.droppedSourceIds.join(",") === "ref-old", "the report names what was left out");
  assert(result.sourceBytes <= budget, "the write stays inside the budget");
});

await test("a reference with neither a disk copy nor a source changes nothing", () => {
  const empty = reference({ id: "ref-empty", src: "" });
  const result = toPersistedReferences([empty]);
  assert(result.items[0].src === undefined, "an empty source is not written");
  assert(result.items[0].sourceMissing === undefined, "an empty source is not called missing");
  assert(result.sourceBytes === 0, "it costs nothing");
  assert(result.items[0].id === "ref-empty", "the reference itself is still listed");
});

await test("hydration names only the records that need their bytes back", () => {
  const list = [
    reference({ id: "ready", src: dataUrl(8), url: "/api/reference-file?filename=ref-a.png" }),
    reference({ id: "url-only", src: "", url: "/api/reference-file?filename=ref-b.png" }),
    reference({ id: "asset-only", src: "", assetId: "asset-9" }),
    reference({ id: "nothing", src: "" }),
  ];

  const pending = referencesNeedingHydration(list).map((item) => item.id);
  assert(pending.join(",") === "url-only,asset-only", "exactly the URL/asset records are pending");

  const afterAttempt = referencesNeedingHydration(list, { attempted: ["url-only"] }).map((item) => item.id);
  assert(afterAttempt.join(",") === "asset-only", "an id that was already tried is not retried in a loop");
});

await test("the disk URL is built from whatever the upload route returned", () => {
  assert(referenceFileName("/x/y/ref-deadbeef.png") === "ref-deadbeef.png", "a POSIX path is reduced to its name");
  assert(referenceFileName("C:\\\\out\\\\ref-deadbeef.png") === "ref-deadbeef.png", "a Windows path too");
  assert(referenceFileName("/api/reference-file?filename=ref-a.png") === "ref-a.png", "a query string is dropped");

  assert(
    referenceFileUrl("/out/ref-1.png") === "/api/reference-file?filename=ref-1.png",
    "a plain path becomes the reference-file URL"
  );
  assert(referenceFileUrl("") === "", "an empty path produces no URL rather than a broken one");

  assert(
    referenceUrlFromAsset({ url: "/api/reference-file?filename=ref-2.png" }) ===
      "/api/reference-file?filename=ref-2.png",
    "an explicit url wins"
  );
  assert(
    referenceUrlFromAsset({ existingPath: "/out/references/ref-3.png" }) ===
      "/api/reference-file?filename=ref-3.png",
    "an asset's existingPath is accepted"
  );
  assert(referenceUrlFromAsset(null) === "", "a missing record produces no URL");
  assert(referenceUrlFromAsset({ url: "blob:http://localhost/1234" }) === "", "a non-disk url is not trusted");
});

await test("a blob is read back as a data URL", async () => {
  const blob = { size: 4 };
  const src = await blobToDataUrl(blob, () => ({
    readAsDataURL() {
      this.result = "data:image/png;base64,AAAA";
      this.onload();
    },
  }));
  assert(src === "data:image/png;base64,AAAA", "the reader result is returned as-is");

  const failure = blobToDataUrl(blob, () => ({
    readAsDataURL() {
      this.error = new Error("boom");
      this.onerror();
    },
  }));
  let rejected = false;
  await failure.catch(() => {
    rejected = true;
  });
  assert(rejected, "a read error rejects instead of resolving empty");
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`storage key: ${REFERENCE_STORAGE_KEY} · budget: ${REFERENCE_SOURCE_BUDGET_BYTES} bytes`);
process.exit(failed === 0 ? 0 : 1);
