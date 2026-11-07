#!/usr/bin/env node
"use strict";

/**
 * The Reference Router: which route a set of references takes, and how the init
 * image is prepared for the canvas.
 *
 * Both are pure functions, so every branch is checked here rather than by
 * generating a picture and squinting at it. The canvas drawing itself lives in
 * Generator.jsx and is asserted at source level (it must go through the plan, and
 * it must fall back to the untouched reference on any error).
 */

import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const modulePath = path.join(root, "app", "frontend", "src", "lib", "reference-router.mjs");
const generatorPath = path.join(root, "app", "frontend", "src", "components", "Generator.jsx");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

async function main() {
  console.log("\n=== Reference Router ===\n");

  const { planReferenceRoute, planReferenceFit, describeReferencePlan, REFERENCE_ROUTES } =
    await import(pathToFileURL(modulePath).href);

  console.log("the route says what actually happens to the picture");
  {
    const noRefs = planReferenceRoute({ modelName: "juggernaut-xl-v9.safetensors", referenceCount: 0 });
    assert(noRefs.id === "txt2img", "no references means plain text-to-image");
    assert(noRefs.referenceCount === 0, "and the count says so");

    const one = planReferenceRoute({ modelName: "juggernaut-xl-v9.safetensors", referenceCount: 1 });
    assert(one.id === "img2img-init", "references route through the img2img init image");
    assert(one.available === true, "and that route is available on the pinned engine");
    assert(one.modelFamily === "sdxl", "the model family is reported for the metadata");
    assert(one.stopgap === false, "a plain SDXL checkpoint is not a stopgap");

    const base = planReferenceRoute({ modelName: "", referenceCount: 0, hasBaseImage: true });
    assert(base.id === "img2img-init", "a chosen base image is a reference of its own");
  }

  console.log("a model that could do better is named, not hidden");
  {
    const kontext = planReferenceRoute({ modelName: "flux1-kontext-dev-Q4_K_M.gguf", referenceCount: 2 });
    assert(kontext.id === "img2img-init", "the stopgap route is still what runs");
    assert(kontext.stopgap === true, "but the answer is honest that the model can do better");
    assert(kontext.why.includes("หลายไฟล์"), "and says what is missing (multi-file loading)");
    assert(kontext.modelFamily === "flux-dev", "with the family named");
  }

  console.log("routes the engine cannot run yet are listed, not offered");
  {
    const ids = REFERENCE_ROUTES.map((route) => route.id);
    assert(ids.includes("ip-adapter"), "IP-Adapter is described");
    assert(REFERENCE_ROUTES.find((r) => r.id === "ip-adapter").available === false, "and marked unavailable");
    assert(REFERENCE_ROUTES.find((r) => r.id === "native-ref-images").available === false, "native ref_images too");
    assert(REFERENCE_ROUTES.every((route) => route.label && route.why), "every route carries a label and a reason");
    assert(REFERENCE_ROUTES.filter((r) => r.available).length === 2, "exactly two routes run today");
  }

  console.log("a reference that already fits the canvas is sent untouched");
  {
    const same = planReferenceFit({ width: 1200, height: 1200 }, { width: 1024, height: 1024 });
    assert(same.mode === "use", "same shape and large enough → use as-is");
    assert(same.contain === null, "the reference is not even redrawn");
    assert(same.upscaled === false, "and nothing is stretched");

    const close = planReferenceFit({ width: 1600, height: 1000 }, { width: 1344, height: 768 });
    assert(close.mode === "use", "an 8.6% aspect difference is inside the tolerance");
    const farOff = planReferenceFit({ width: 3000, height: 3000 }, { width: 1344, height: 768 });
    assert(farOff.mode === "fit", "a 43% difference is not");
  }

  console.log("a mismatched reference is fitted to the canvas shape");
  {
    const portraitRef = planReferenceFit({ width: 1200, height: 1600 }, { width: 1344, height: 768 });
    assert(portraitRef.mode === "fit", "portrait reference into a landscape canvas is fitted");
    assert(Math.abs(portraitRef.width / portraitRef.height - 1344 / 768) < 0.02, "the prepared canvas has the output shape");
    assert(portraitRef.width >= 1344 && portraitRef.height >= 768, "and is at least as large as the output");
    assert(portraitRef.contain !== null, "with an explicit placement for the reference");
    assert(portraitRef.contain.height === portraitRef.height, "a tall reference is drawn full height");
    assert(portraitRef.contain.width < portraitRef.width, "and narrower than the canvas — nothing is cropped off the face");
    assert(Math.abs(portraitRef.contain.width / portraitRef.contain.height - 0.75) < 0.02, "the reference keeps its own aspect (no stretching)");
    assert(portraitRef.reason.includes("สัดส่วน"), "the reason names the aspect mismatch");
  }

  console.log("a reference smaller than the canvas is called out");
  {
    const small = planReferenceFit({ width: 400, height: 400 }, { width: 1024, height: 1024 });
    assert(small.mode === "fit", "a 400px reference is prepared, not sent raw");
    assert(small.upscaled === true, "and flagged as a source that cannot add detail");
    assert(small.reason.includes("เล็กกว่า"), "the reason says the reference is too small");
    assert(small.width === 1178 && small.height === 1178, "the prepared canvas is 15% above the output, not 4× it");
  }

  console.log("the prepared canvas never runs away in size");
  {
    const big = planReferenceFit({ width: 4000, height: 3000 }, { width: 2048, height: 1024 });
    assert(big.mode === "fit", "a 4:3 reference into a 2:1 canvas is fitted");
    assert(big.width === 2048, "a 2048px output is not overscanned past the cap");
    assert(big.contain.width <= 2048 && big.contain.height <= 1024, "and the reference still lands inside it");
    const unknown = planReferenceFit({}, { width: 1024, height: 1024 });
    assert(unknown.mode === "unknown", "unmeasurable sizes produce a plan that says so");
    assert(unknown.contain === null, "and nothing to draw");
  }

  console.log("the chip line reads like a sentence");
  {
    const route = planReferenceRoute({ modelName: "sdxl.safetensors", referenceCount: 1 });
    const line = describeReferencePlan(route, planReferenceFit({ width: 1200, height: 1600 }, { width: 1344, height: 768 }));
    assert(line.startsWith(route.label), "it starts with the route");
    assert(line.includes("ปรับภาพตั้งต้น"), "and mentions the fitting");
    const clean = describeReferencePlan(route, planReferenceFit({ width: 1200, height: 1200 }, { width: 1024, height: 1024 }));
    assert(clean === route.label, "a clean reference adds no noise to the line");
  }

  console.log("the component goes through the plan and survives failure");
  {
    const jsx = fs.readFileSync(generatorPath, "utf8");
    assert(jsx.includes("planReferenceFit"), "Generator.jsx uses the fit plan");
    assert(jsx.includes("prepareInitImage"), "through a named helper");
    assert(/naturalWidth|createImageBitmap/.test(jsx), "which measures the real image before deciding");
    assert(/catch[\s\S]{0,200}return\s+src|catch[\s\S]{0,200}fallback/.test(jsx), "and returns the original reference when canvas work fails");
    assert(jsx.includes("planReferenceRoute"), "the route is computed for the metadata");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`${REFERENCE_ROUTES.length} routes · ${REFERENCE_ROUTES.filter((r) => r.available).length} usable today\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
