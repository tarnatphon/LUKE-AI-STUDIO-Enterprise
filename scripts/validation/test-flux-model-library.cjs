#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const flux = require("../server/flux-schnell.cjs");
const support = require("../server/image-diffusion-support.cjs");
assert.equal(flux.assessHardware({}).variant, null);
assert.equal(flux.assessHardware({ ram_total_gb: 16, gpu_vram_gb: 24 }).variant, null);
assert.equal(flux.assessHardware({ ram_total_gb: 24, cpu_name: "Apple M4" }).variant, "q4");
assert.equal(flux.assessHardware({ ram_total_gb: 48, cpu_name: "Apple M4" }).variant, "q8");
assert.equal(flux.assessHardware({ ram_total_gb: 64, gpu_vram_gb: 8 }).variant, "q4");
assert.equal(flux.assessHardware({ ram_total_gb: 64, gpu_vram_gb: 24 }).variant, "q8");
assert.equal(flux.recipe("../../bad"), null);
assert.equal(flux.recipe("constructor"), null);
assert.equal(flux.recipe("q4").length, 4);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-flux-"));
try {
  const modelsDir = path.join(root, "models");
  const llmModelsDir = path.join(root, "llm");
  fs.mkdirSync(modelsDir); fs.mkdirSync(llmModelsDir);
  const modelPath = path.join(modelsDir, flux.recipe("q4")[0].filename);
  assert.equal(support.classifyImageModel(modelPath), support.FLUX_SCHNELL);
  assert.equal(support.classifyImageModel("flux1-schnell-Q8_0.gguf"), support.FLUX_SCHNELL);
  assert.equal(support.classifyImageModel("flux-dev-Q4_0.gguf"), "multi-component-diffusion");
  let plan = support.resolveImageModel({ modelPath, modelsDir, llmModelsDir });
  assert.equal(plan.missing.length, 3);
  assert.throws(() => support.buildModelComponentArgs(plan), /components missing/);
  for (const item of flux.components) {
    const dir = support.getComponentTarget(item.id, { modelsDir, llmModelsDir });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, item.filename + ".part"), "incomplete");
    assert.equal(support.getComponentStatus({ modelsDir, llmModelsDir })[item.id].installed, false);
    fs.writeFileSync(path.join(dir, item.filename), "test fixture");
  }
  plan = support.resolveImageModel({ modelPath, modelsDir, llmModelsDir });
  assert.equal(plan.ready, true);
  const args = support.buildModelComponentArgs(plan);
  for (const flag of ["--diffusion-model", "--vae", "--clip_l", "--t5xxl", "--offload-to-cpu"]) assert.ok(args.includes(flag));
  assert.ok(!args.includes("--llm")); assert.ok(!args.includes("--model"));
  for (const c of flux.components) assert.equal(support.getComponentStatus({ modelsDir, llmModelsDir })[c.id].installed, true);
  fs.writeFileSync(plan.components.vae, "");
  assert.equal(support.resolveImageModel({ modelPath, modelsDir, llmModelsDir }).ready, false);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
const source = fs.readFileSync(path.resolve(__dirname, "../../app/frontend/src/components/ModelManager.jsx"), "utf8");
assert.ok(source.includes("installFluxSchnell(model.fluxVariant)"));
assert.ok(source.includes("handleLoadModel(model.filename)"));
assert.ok(source.includes("fluxStatus?.assessment?.variant"));
console.log("PASS: FLUX recipes, hardware assessment, components, CLI args and library wiring");
