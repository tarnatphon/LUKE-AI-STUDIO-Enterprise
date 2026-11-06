#!/usr/bin/env node
"use strict";

// Catalog-only until the image backend supports multi-file FLUX bundles.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "app/frontend/src/components/ModelManager.jsx"), "utf8");
const catalog = source.match(/const MODEL_LIBRARY = (\[[\s\S]*?\n\]);/);
assert.ok(catalog, "Image model catalog exists");
const sections = Function(`return (${catalog[1]});`)();
const flux = sections.flatMap(section => section.items).find(model => model.filename === "flux1-schnell-Q4_0.gguf");
assert.ok(flux, "Quantized Schnell is listed in the image library");
assert.equal(flux.actionType, "open-page", "Unsupported bundle must not trigger a single-file download");
assert.equal(flux.pageUrl, "https://huggingface.co/city96/FLUX.1-schnell-gguf");
assert.equal(flux.url, undefined);
assert.equal(flux.recommendedFit, false);
for (const component of ["CLIP-L", "T5-XXL", "VAE", "not supported", "RAM/VRAM"]) {
  assert.ok(flux.notes.includes(component), `Explains ${component}`);
}
assert.ok(source.includes('model.actionLabel || "View Official Model"'), "Community quantization gets an accurate action label");
console.log("PASS: FLUX Schnell quantized catalog entry and unsupported-loader safeguards");
