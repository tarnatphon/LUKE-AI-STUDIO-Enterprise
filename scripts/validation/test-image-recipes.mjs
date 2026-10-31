#!/usr/bin/env node
/**
 * Recommended settings per model family.
 *
 * The app ships one global sampling default (4 steps / CFG 1, chosen for
 * step-distilled models). Loading a standard SDXL or SD 1.5 checkpoint under
 * that default is the most common reason a local UI produces mush, and loading a
 * Lightning checkpoint at 28 steps / CFG 7 is why the next user gets a burnt
 * image. Neither user is wrong; the defaults simply cannot fit both.
 *
 * `image-recipes.mjs` answers "what was this checkpoint trained to be sampled
 * with", and this suite pins the answers that matter:
 *
 *   1. the right family is picked from a real file name, most specific first
 *   2. the plan speaks only about steps / CFG / sampler, and says what changed
 *   3. a model that already matches is reported as matching, not as a no-op button
 *   4. architectures that need several files are marked as such, so the UI can
 *      say "not yet" instead of promising a recipe that cannot run
 *   5. an unknown model (or no model) produces no claim at all
 *
 * Run: node scripts/validation/test-image-recipes.mjs
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const modulePath = path.join(root, "app", "frontend", "src", "lib", "image-recipes.mjs");

const {
  IMAGE_RECIPES,
  IMAGE_SAMPLERS,
  describeRecipePatch,
  matchImageRecipe,
  normalizeModelKey,
  recipePlan,
} = await import(pathToFileURL(modulePath).href);

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

test("a model file name resolves to the right family", () => {
  const cases = [
    ["Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors", "sdxl-lightning"],
    ["DreamShaperXL_Lightning.safetensors", "sdxl-lightning"],
    ["sd_xl_base_1.0.safetensors", "sdxl"],
    ["Juggernaut-XL-v9.safetensors", "sdxl"],
    ["DreamShaper_8_pruned.safetensors", "sd15"],
    ["CyberRealistic_V8_FP16.safetensors", "sd15"],
    ["flux1-schnell-Q4_K_M.gguf", "flux-schnell"],
    ["flux1-kontext-dev-Q4_K_M.gguf", "flux-dev"],
    ["Qwen_Image_Edit-2509-Q4_K_M.gguf", "qwen-image"],
    ["z-image-turbo-Q4_K_M.gguf", "z-image"],
    ["lcm-dreamshaper-v7-fp16", "lcm"],
  ];

  for (const [file, expected] of cases) {
    const recipe = matchImageRecipe(file);
    assert(recipe && recipe.id === expected, `${file} → ${expected} (got ${recipe ? recipe.id : "nothing"})`);
  }

  // The more specific family has to win: "lightning" is listed before "xl".
  const lightning = matchImageRecipe("/Volumes/AI/app/models/DreamShaperXL_Lightning.safetensors");
  assert(lightning.steps === 6, "the Lightning recipe wins over the plain SDXL recipe");

  // "turbo" belongs to more than one family: the one that owns the name wins.
  assert(matchImageRecipe("z-image-turbo-Q4_K_M.gguf").id === "z-image", "Z-Image Turbo is not an SDXL Turbo");
  assert(matchImageRecipe("sd_turbo_v1.safetensors").id === "sdxl-lightning", "but a plain *turbo* checkpoint still is");
  assert(matchImageRecipe("DreamShaper_8_pruned.safetensors").id === "sd15", "DreamShaper 8 is SD 1.5, not SDXL");
  assert(
    normalizeModelKey("C:\\\\models\\\\SDXL\\\\Juggernaut-XL-v9.safetensors") === "juggernaut-xl-v9",
    "a Windows path and its extension are stripped"
  );
});

test("an unknown or empty model makes no claim", () => {
  assert(matchImageRecipe("my-finetune-v3.safetensors") === null, "a name that matches no family is unknown");
  assert(matchImageRecipe("") === null, "no model means no recipe");
  assert(matchImageRecipe(null) === null, "and a missing value does not throw");
  assert(recipePlan(null, { steps: 20 }) === null, "no recipe means no plan");
});

test("the plan speaks only about steps, CFG and sampler", () => {
  const recipe = matchImageRecipe("sd_xl_base_1.0.safetensors");
  const plan = recipePlan(recipe, {
    steps: 4,
    cfgScale: 1,
    sampler: "euler_a",
    width: 1024,
    height: 1024,
    seed: -1,
    denoisingStrength: 0.7,
  });

  assert(
    Object.keys(plan.patch).sort().join(",") === "cfgScale,sampler,steps",
    "only the three sampling keys are touched"
  );
  assert(plan.patch.steps === 26 && plan.patch.cfgScale === 6, "the SDXL values are the ones offered");
  assert(plan.changedKeys.length === 3, "all three changes are reported");
  assert(plan.alreadyMatches === false, "a plan that changes something says so");
  assert(plan.patch.width === undefined && plan.patch.seed === undefined, "canvas and seed are left alone");
});

test("a model that already matches is not offered as work", () => {
  const recipe = matchImageRecipe("z-image-turbo-Q4_K_M.gguf");
  const plan = recipePlan(recipe, { steps: 8, cfgScale: 1, sampler: "euler_a" });
  assert(plan.alreadyMatches === true, "nothing to change");
  assert(plan.changedKeys.length === 0, "and no keys are listed");
  assert(plan.patch && Object.keys(plan.patch).length === 0, "the patch is empty, not a rewrite");
});

test("architectures that need several files say so", () => {
  for (const id of ["flux-dev", "qwen-image", "z-image"]) {
    const recipe = IMAGE_RECIPES.find((item) => item.id === id);
    assert(Boolean(recipe), `${id} exists`);
    const plan = recipePlan(recipe, { steps: 20, cfgScale: 7, sampler: "euler_a" });
    assert(plan.note.includes("Phase B"), `${id} tells the user it cannot run as a single file yet`);
  }

  const sdxlPlan = recipePlan(matchImageRecipe("sd_xl_base_1.0.safetensors"), { steps: 4, cfgScale: 1, sampler: "euler_a" });
  assert(!sdxlPlan.note.includes("Phase B"), "a single-file model carries no such caveat");
});

test("every recommended sampler is one the backend accepts", () => {
  for (const recipe of IMAGE_RECIPES) {
    assert(
      IMAGE_SAMPLERS.includes(recipe.sampler),
      `${recipe.id} uses ${recipe.sampler}, which is in the sampler list`
    );
  }
  assert(IMAGE_SAMPLERS.includes("lcm"), "the LCM sampler the LCM recipe needs is listed");
});

test("the button label names the values it would apply", () => {
  assert(describeRecipePatch({ steps: 26, cfgScale: 6 }) === "steps 26 · CFG 6", "steps and CFG are named");
  assert(describeRecipePatch({ sampler: "dpm++2m" }) === "sampler dpm++2m", "a sampler-only change is named");
  assert(describeRecipePatch({}) === "", "an empty patch produces no label");
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`${IMAGE_RECIPES.length} recipes · ${IMAGE_SAMPLERS.length} samplers`);
process.exit(failed === 0 ? 0 : 1);
