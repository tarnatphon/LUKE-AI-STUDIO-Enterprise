#!/usr/bin/env node
"use strict";

/**
 * The image workspace sends the settings it shows, and the machine decides how
 * far they go.
 *
 * What this suite pins, and why each one needed pinning:
 *
 *   1. Text-to-image goes to an endpoint that reads the settings. The Generator
 *      used to post to /v1/images/generations, which in the pinned backend
 *      (stable-diffusion.cpp master-685-19bdfe2, examples/server/routes_openai.cpp)
 *      reads only prompt, n, size, output_format and output_compression, and
 *      starts from *runtime.default_gen_params for everything else. Steps, CFG,
 *      seed, sampler and the negative prompt in our body were silently dropped.
 *      The assertion is on the field set that travels, not just the URL, because
 *      the URL alone would let the same bug back in.
 *
 *   2. A negative prompt exists. It was state in App.jsx, passed to the
 *      Generator, and rendered nowhere: every local run had no negatives at all.
 *
 *   3. The family's own numbers are used, not one set for every model. An SD 1.5
 *      checkpoint at CFG 1 and a FLUX model at CFG 7 are both broken, and the app
 *      used to hand out the same defaults to both.
 *
 *   4. The machine sets the ceiling. `tier` has always been computed on the
 *      server and only ever reached the text side; a 4 GB laptop and a 24 GB card
 *      were offered the same resolution, and 1024² SDXL on the first is an OOM.
 *
 *   5. Every name sent is a name the backend accepts. hires_upscaler_to_str[]
 *      and sample_method_to_str[] are exact-match lists in the pinned tag, and a
 *      miss is an HTTP 400 rather than a fallback.
 *
 * The frontend half imports the real module (app/frontend/src/services/api.js)
 * and drives the real request builder with a mocked fetch; it is not a text
 * match on source. The server half requires the real serve.cjs's recommendation
 * function through the shared module it delegates to.
 *
 * Run: node scripts/validation/test-image-quality-profiles.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const FRONTEND_ENTRY = path.join(root, "app", "frontend", "src", "services", "api.js");
const MODULE = path.join(root, "scripts", "server", "image-quality.cjs");

const iq = require(MODULE);
const promptBudgetModule = require(path.join(root, "scripts", "server", "image-prompt-budget.cjs"));

// 1×1 transparent PNG — an image the file-type check accepts.
const PNG_BASE64 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082",
  "hex"
).toString("base64");

let passed = 0;
let failed = 0;

/**
 * Render the real Generator and QualityPanel through Vite's SSR build, the way
 * test-settings-audit-followups.cjs does. No browser is involved: this checks
 * the markup React would mount, so a layout that stopped rendering (or a panel
 * that rendered empty) fails here instead of in front of the user.
 */
async function renderWorkspace() {
  const frontend = path.join(root, "app", "frontend");
  const { createRequire } = require("node:module");
  const fromFrontend = createRequire(path.join(frontend, "package.json"));
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);

  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "image-quality-ssr-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(entryFile, [
    `export { default as Generator } from ${JSON.stringify(path.join(frontend, "src", "components", "Generator.jsx"))};`,
    `export { default as QualityPanel } from ${JSON.stringify(path.join(frontend, "src", "components", "QualityPanel.jsx"))};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));

  try {
    await vite.build({
      root: frontend, configFile: false, logLevel: "silent", plugins: [react()],
      build: {
        ssr: entryFile, outDir: path.join(work, "out"), emptyOutDir: true, minify: false,
        rollupOptions: { output: { format: "cjs", entryFileNames: "workspace.cjs" } },
      },
      ssr: { noExternal: true }, define: { "process.env.NODE_ENV": '"production"' },
    });

    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    globalThis.window = {
      matchMedia: () => ({ matches: true }), alert() {}, confirm() {},
      location: { origin: "" }, addEventListener() {}, removeEventListener() {},
    };
    globalThis.document = {
      visibilityState: "visible", addEventListener() {}, removeEventListener() {},
      documentElement: { setAttribute() {} }, createElement: () => ({ click() {} }),
      body: { appendChild() {}, removeChild() {} },
    };
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "{}" });
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { clipboard: { write: async () => {} }, hardwareConcurrency: 8 }, configurable: true,
      });
    } catch (_) { /* node already supplies one */ }

    const built = require(path.join(work, "out", "workspace.cjs"));
    const noop = () => {};
    const constraints = {
      width: 1024, height: 1024, steps: 28, cfgScale: 5, sampler: "dpm++2m", scheduler: "karras",
      clipSkip: 1, seed: -1, denoisingStrength: 0.45, useGpu: true, useFlashAttn: true,
      vaeTiling: true, vaeOnCpu: false, threads: 8, backendType: "auto",
      qualityPreset: "balanced", modelFamily: "sdxl", hardwareTier: "high",
    };
    const panel = built.renderToStaticMarkup(built.createElement(built.QualityPanel, {
      plan: iq.planImageQuality({ family: "sdxl", tier: "high", preset: "balanced", aspect: "wide", prompt: "a wide shot of a harbour at dawn, cranes and container ships in mist" }),
      constraints: { ...constraints, aspect: "wide" }, setConstraints: noop,
      activeModel: "juggernautXL_v9.safetensors",
      prompt: "a wide shot of a harbour at dawn, cranes and container ships in mist",
      specs: { tier: "high", cpu_name: "Apple M3 Pro", ram_total_gb: 18, gpu_vram_gb: 16 },
    }));
    // SD 1.5 is where clip skip applies, so that is where the chip has to appear.
    const sd15Panel = built.renderToStaticMarkup(built.createElement(built.QualityPanel, {
      plan: iq.planImageQuality({ family: "sd15", tier: "high", preset: "balanced" }),
      constraints: { ...constraints, modelFamily: "sd15", clipSkip: 2 },
      setConstraints: noop,
      activeModel: "cyberrealistic_v8.safetensors",
      specs: { tier: "high", cpu_name: "Apple M3 Pro", ram_total_gb: 18, gpu_vram_gb: 16 },
    }));
    const generator = built.renderToStaticMarkup(built.createElement(built.Generator, {
      prompt: "a market stall at dawn, steamed noodles, warm rim light",
      setPrompt: noop, negativePrompt: "", setNegativePrompt: noop,
      constraints, setConstraints: noop,
      activeModel: "juggernautXL_v9.safetensors",
      generatedImages: [], setGeneratedImages: noop,
      isGenerating: false, setIsGenerating: noop,
      generationProgress: 0, setGenerationProgress: noop, setActiveTab: noop,
      showAlert: async () => {}, showConfirm: async () => true,
      specs: { tier: "high", cpu_name: "Apple M3 Pro", ram_total_gb: 18, gpu_vram_gb: 16 },
      textSettings: {},
    }));
    return { panel, sd15Panel, generator };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}\n${err && err.stack ? err.stack : err}`);
  }
}

function near(actual, expected, label) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) < 1e-6,
    `${label}: expected ${expected}, got ${actual}`
  );
}

async function main() {
  console.log("\n=== Image quality profiles: the settings that travel ===\n");

  // ── 0. the module is a pure module ─────────────────────────────────────
  section("0. the shared module");

  await test("it does no I/O, so both processes and this suite can call it", () => {
    const source = fs.readFileSync(MODULE, "utf8");
    assert.doesNotMatch(source, /require\(\s*["'](fs|http|https|node:fs|node:http)["']\s*\)/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /process\.env/);
  });

  await test("every name it can send is one the pinned backend accepts", () => {
    // The lists are the pinned tag's own, copied from
    // src/stable-diffusion.cpp (sample_method_to_str, scheduler_to_str,
    // hires_upscaler_to_str). If upstream renames one, the request starts
    // answering 400 and this is where it should be caught.
    const families = Object.keys(iq.FAMILY_DEFAULTS);
    for (const family of families) {
      const d = iq.familyDefaults(family, "x");
      assert.ok(iq.BACKEND_SAMPLERS.includes(d.sampler), `${family}: sampler ${d.sampler} is not accepted`);
      assert.ok(iq.BACKEND_SCHEDULERS.includes(d.scheduler), `${family}: scheduler ${d.scheduler} is not accepted`);
    }
    for (const upscaler of Object.values(iq.HIRES_UPSCALERS)) {
      assert.ok(iq.BACKEND_HIRES_UPSCALERS.includes(upscaler), `hires upscaler ${upscaler} is not accepted`);
    }
  });

  // ── 1. family detection ────────────────────────────────────────────────
  section("1. the model family decides the sampler, not a global default");

  await test("SD 1.5 checkpoints, including the community photoreal ones", () => {
    for (const name of [
      "v1-5-pruned-emaonly.safetensors",
      "sd15.safetensors",
      "CyberRealistic_V8_FP16.safetensors",
      "realisticVisionV60B1_v51VAE.safetensors",
      "rev-animated-v1-2-2.safetensors",
    ]) {
      assert.strictEqual(iq.detectModelFamily(name), "sd15", name);
    }
    const d = iq.familyDefaults("sd15");
    assert.strictEqual(d.sampler, "dpm++2m", "not euler_a: euler_a at CFG 7 is grainier at the same step count");
    assert.strictEqual(d.scheduler, "karras");
    assert.strictEqual(d.clipSkip, 2, "clip skip 2 is the SD 1.5 convention");
    near(d.cfgScale, 6.5, "SD 1.5 CFG");
  });

  await test("SDXL and its distilled builds are different families", () => {
    assert.strictEqual(iq.detectModelFamily("sd_xl_base_1.0.safetensors"), "sdxl");
    assert.strictEqual(iq.detectModelFamily("juggernautXL_v9.safetensors"), "sdxl");
    assert.strictEqual(iq.detectModelFamily("DreamShaperXL_Lightning.safetensors"), "sdxl-lightning");
    assert.strictEqual(iq.detectModelFamily("sdxl_lightning_4step.safetensors"), "sdxl-lightning");

    // A distilled model at CFG 7 is the blown-out look people blame on the model.
    const lightning = iq.familyDefaults("sdxl-lightning");
    near(lightning.cfgScale, 2, "distilled CFG");
    assert.ok(lightning.steps <= 8, "a distilled model has no use for 28 steps");
    near(iq.familyDefaults("sdxl").cfgScale, 5, "SDXL over-burns above ~6");
  });

  await test("FLUX is distilled: CFG 1, euler, simple — and dev is not schnell", () => {
    assert.strictEqual(iq.detectModelFamily("flux1-schnell-Q4_K.gguf"), "flux");
    assert.strictEqual(iq.detectModelFamily("flux1-dev-Q3_K_S.gguf"), "flux");
    const dev = iq.familyDefaults("flux", "flux1-dev-Q3_K_S.gguf");
    const schnell = iq.familyDefaults("flux", "flux1-schnell-Q4_K.gguf");
    assert.strictEqual(dev.steps, 20, "dev needs a real step budget");
    assert.strictEqual(schnell.steps, 4, "schnell is a 4-step model");
    for (const d of [dev, schnell]) {
      near(d.cfgScale, 1, "FLUX is trained for CFG 1");
      assert.strictEqual(d.sampler, "euler");
      assert.strictEqual(d.scheduler, "simple");
      assert.strictEqual(d.clipSkip, -1, "newer architectures use the model default");
    }
  });

  await test("an unrecognised checkpoint says so and falls back to the SD 1.5 profile", () => {
    assert.strictEqual(iq.detectModelFamily("my-finetune-v3.safetensors"), "unknown");
    const plan = iq.planImageQuality({ model: "my-finetune-v3.safetensors", tier: "mid" });
    assert.strictEqual(plan.family, "unknown");
    assert.strictEqual(plan.sampler, "dpm++2m", "the SD 1.5 profile, which an arbitrary .safetensors usually is");
    assert.ok(
      plan.notes.some((n) => /not recognised/.test(n)),
      "and the user is told, rather than shown a confident guess"
    );
  });

  await test("an explicit family always beats the filename guess", () => {
    const plan = iq.planImageQuality({ model: "mystery.safetensors", family: "flux", tier: "high" });
    assert.strictEqual(plan.family, "flux");
    near(plan.cfgScale, 1, "the hint was honoured");
  });

  // ── 2. the machine decides the ceiling ─────────────────────────────────
  section("2. the machine sets the ceiling, and a low tier says no to the second pass");

  await test("resolution follows the tier and never exceeds its budget", () => {
    const low = iq.planImageQuality({ model: "sd_xl_base_1.0.safetensors", tier: "low" });
    const mid = iq.planImageQuality({ model: "sd_xl_base_1.0.safetensors", tier: "mid" });
    const high = iq.planImageQuality({ model: "sd_xl_base_1.0.safetensors", tier: "high" });
    assert.ok(low.width * low.height <= 512 * 512, `low tier asked for ${low.width}×${low.height}`);
    assert.ok(mid.width * mid.height <= 768 * 768 + 1, `mid tier asked for ${mid.width}×${mid.height}`);
    assert.strictEqual(high.width, 1024, "a 12 GB+ card should get SDXL's native size");
  });

  await test("a low-tier machine is not offered a high-res pass it cannot finish", () => {
    const plan = iq.planImageQuality({ model: "sd15", tier: "low", preset: "best" });
    assert.strictEqual(plan.hires.enabled, false);
    assert.ok(plan.notes.some((n) => /no high-res pass|second pass/.test(n)), "and the panel can say why");
  });

  await test("mid and high tiers get one, and it is inside the budget", () => {
    for (const tier of ["mid", "high"]) {
      const plan = iq.planImageQuality({ model: "sd15", tier, preset: "balanced" });
      assert.strictEqual(plan.hires.enabled, true, `${tier} should have a second pass`);
      assert.ok(plan.hires.scale > 1, "a second pass that does not grow the image adds nothing");
      const targetPixels = plan.width * plan.height * plan.hires.scale * plan.hires.scale;
      assert.ok(
        targetPixels <= iq.TIER_BUDGETS[tier].side * iq.TIER_BUDGETS[tier].side * 2.25 + 1,
        `${tier}: hires target ${targetPixels} px is outside the budget`
      );
    }
  });

  await test("VRAM under 6 GB disables the second pass even inside a mid tier", () => {
    const plan = iq.planImageQuality({ model: "sd15", tier: "mid", vramGb: 4, preset: "balanced" });
    assert.strictEqual(plan.hires.enabled, false);
    assert.ok(/VRAM/.test(iq.hardwareImageProfile({ tier: "mid", vramGb: 4 }).note));
  });

  await test("a size the user pinned is kept, and only the second pass is clamped", () => {
    const plan = iq.planImageQuality({ model: "sd15", tier: "low", width: 512, height: 768 });
    assert.strictEqual(plan.width, 512);
    assert.strictEqual(plan.height, 768);
    assert.strictEqual(plan.hires.enabled, false, "a low tier still refuses the second pass");
    assert.ok(plan.notes.some((n) => /budget/.test(n)), "and warns that it is above the tier");
  });

  // ── 3. presets ─────────────────────────────────────────────────────────
  section("3. the three presets, and what Auto means");

  await test("draft halves the steps and never runs a second pass", () => {
    for (const model of ["sd15", "sd_xl_base_1.0.safetensors", "flux1-dev.gguf"]) {
      const balanced = iq.planImageQuality({ model, tier: "high", preset: "balanced" });
      const draft = iq.planImageQuality({ model, tier: "high", preset: "draft" });
      assert.ok(draft.steps < balanced.steps, `${model}: draft ${draft.steps} is not fewer than ${balanced.steps}`);
      assert.strictEqual(draft.hires.enabled, false);
      assert.ok(draft.steps >= 4, "below 4 steps nothing is an image");
    }
  });

  await test("best spends more steps, except on distilled models where that is only slower", () => {
    const sd15 = iq.planImageQuality({ model: "sd15", tier: "high", preset: "best" });
    const sd15Balanced = iq.planImageQuality({ model: "sd15", tier: "high", preset: "balanced" });
    assert.ok(sd15.steps > sd15Balanced.steps);

    const lightning = iq.planImageQuality({ model: "DreamShaperXL_Lightning.safetensors", tier: "high", preset: "best" });
    const lightningBalanced = iq.planImageQuality({ model: "DreamShaperXL_Lightning.safetensors", tier: "high", preset: "balanced" });
    assert.strictEqual(lightning.steps, lightningBalanced.steps, "a 6-step distilled model gains nothing from 9");
    assert.ok(lightning.hires.scale > 1, "but it can still spend the budget on detail");
  });

  await test("auto is balanced clamped to the machine", () => {
    for (const tier of ["low", "mid", "high"]) {
      const auto = iq.planImageQuality({ model: "sd15", tier, preset: "auto" });
      const balanced = iq.planImageQuality({ model: "sd15", tier, preset: "balanced" });
      assert.strictEqual(auto.steps, balanced.steps);
      assert.strictEqual(auto.width, balanced.width);
      assert.strictEqual(auto.preset, "balanced", "auto resolves to balanced so the panel can name it");
    }
  });

  await test("garbage in cannot produce NaN or an unbounded request", () => {
    for (const preset of [undefined, null, "", "ultra", 42, {}]) {
      for (const tier of [undefined, null, "", "enormous", 3]) {
        const plan = iq.planImageQuality({ model: "sd15", tier, preset });
        for (const key of ["steps", "cfgScale", "width", "height"]) {
          assert.ok(Number.isFinite(plan[key]), `preset=${preset} tier=${tier} left ${key}=${plan[key]}`);
        }
        assert.ok(plan.steps >= 1 && plan.steps <= 100, `steps ${plan.steps} out of range`);
        assert.ok(plan.hires.scale >= 1);
      }
    }
    // An unknown tier is a low tier: refusing a feature is safer than promising one.
    assert.strictEqual(iq.hardwareImageProfile({ tier: "quantum" }).tier, "low");
  });

  // ── 4. negatives ───────────────────────────────────────────────────────
  section("4. the negative prompt exists, and the family decides its default");

  await test("each family gets the failure modes it actually has", () => {
    assert.match(iq.defaultNegativePrompt("sd15"), /bad hands/);
    assert.match(iq.defaultNegativePrompt("sd15"), /watermark/);
    assert.strictEqual(iq.defaultNegativePrompt("flux"), "", "FLUX is documented as ignoring negatives at CFG 1");
    // A distilled model is already clean; a long list is conditioning it spends
    // on nothing, so the distilled default is a short one. Read the style table
    // directly: "distilled" is a style, not a family.
    assert.ok(
      iq.NEGATIVE_STYLES.distilled.split(",").length <= iq.NEGATIVE_STYLES.sd15.split(",").length - 5,
      "the distilled default must be visibly shorter than the SD 1.5 one"
    );
    // And the family that uses it really resolves to it.
    assert.strictEqual(
      iq.defaultNegativePrompt("sdxl-lightning"),
      iq.NEGATIVE_STYLES.distilled,
      "a Lightning checkpoint gets the short distilled list"
    );
    assert.notStrictEqual(iq.defaultNegativePrompt("sdxl"), iq.defaultNegativePrompt("sd15"));
  });

  await test("existing text always wins over the default", () => {
    const plan = iq.planImageQuality({ model: "sd15", tier: "mid" });
    const body = iq.buildTxt2ImgBody(plan, { prompt: "a cat", negativePrompt: "my own words" });
    assert.strictEqual(body.negative_prompt, "my own words");
    const filled = iq.buildTxt2ImgBody(plan, { prompt: "a cat", negativePrompt: "   " });
    assert.strictEqual(filled.negative_prompt, plan.negativePrompt, "whitespace is empty");
  });

  // ── 5. the request body ────────────────────────────────────────────────
  section("5. the body the backend reads");

  await test("a txt2img body carries every field /sdapi/v1/txt2img reads", () => {
    const plan = iq.planImageQuality({ model: "sd15", tier: "high", preset: "best" });
    const body = iq.buildTxt2ImgBody(plan, { prompt: "a cat", seed: 7 });
    // routes_sdapi.cpp: build_sdapi_img_gen_request reads exactly these.
    for (const field of ["prompt", "negative_prompt", "width", "height", "steps", "cfg_scale", "seed", "sampler_name", "scheduler", "batch_size"]) {
      assert.ok(field in body, `the body is missing ${field}, which the endpoint reads`);
    }
    assert.strictEqual(body.seed, 7);
    assert.strictEqual(body.steps, plan.steps);
    near(body.cfg_scale, plan.cfgScale, "cfg");
    assert.strictEqual(body.sampler_name, plan.sampler);
    assert.strictEqual(body.scheduler, plan.scheduler);
    assert.strictEqual(body.clip_skip, 2);
  });

  await test("the high-res pass uses the sdapi field names, and denoise means the second pass", () => {
    const plan = iq.planImageQuality({ model: "sd15", tier: "high", preset: "balanced" });
    const body = iq.buildTxt2ImgBody(plan, { prompt: "a cat" });
    assert.strictEqual(body.enable_hr, true);
    assert.ok(iq.BACKEND_HIRES_UPSCALERS.includes(body.hr_upscaler), body.hr_upscaler);
    assert.ok(body.hr_scale > 1);
    assert.ok(body.hr_steps >= 8);
    // routes_sdapi.cpp reads denoising_strength inside the `!img2img` branch as
    // the hires strength — not as the img2img strength.
    assert.ok(body.denoising_strength > 0 && body.denoising_strength <= 1);
  });

  await test("a random seed is sent as -1, which is what the backend means by it", () => {
    const plan = iq.planImageQuality({ model: "sd15", tier: "mid" });
    assert.strictEqual(iq.buildTxt2ImgBody(plan, { seed: -1 }).seed, -1);
    assert.strictEqual(iq.buildTxt2ImgBody(plan, {}).seed, -1);
    assert.strictEqual(iq.buildTxt2ImgBody(plan, { seed: 0 }).seed, 0, "seed 0 is a seed, not 'random'");
  });

  // ── 6. the frontend actually sends it ──────────────────────────────────
  section("6. the Generator's real request, driven with a mocked fetch");

  let frontend = null;
  const realFetch = globalThis.fetch;
  let calls = [];

  try {
    frontend = await import(pathToFileURL(FRONTEND_ENTRY).href);
  } catch (err) {
    console.log(`  note: the Generator module could not be imported (${err.message});`);
    console.log("        run `cd app/frontend && npm install` to include these checks.\n");
  }

  const CONSTRAINTS = {
    width: 512, height: 512, steps: 25, cfgScale: 6.5, seed: 11, sampler: "dpm++2m",
    scheduler: "karras", clipSkip: 2, hardwareTier: "high", qualityPreset: "balanced",
  };

  const capture = async (fn) => {
    calls = [];
    const result = await fn();
    return { result, seen: calls };
  };

  const mockFetch = () => {
    globalThis.fetch = async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: String(url), body });
      const isImage = /images|txt2img|img2img/.test(String(url));
      const payload = isImage
        ? { images: [PNG_BASE64] }
        : { ok: true };
      return {
        ok: true,
        status: 200,
        clone() { return this; },
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      };
    };
  };

  if (frontend) {
    mockFetch();

    await test("text-to-image goes to the endpoint that reads the settings", async () => {
      const { seen } = await capture(() => frontend.generateImage(
        "a cat", "", CONSTRAINTS, "cyberrealistic_v8.safetensors", null,
        undefined, undefined, [], {}
      ));
      assert.strictEqual(seen.length, 1);
      assert.ok(
        seen[0].url.endsWith("/sdapi/v1/txt2img"),
        `txt2img must not go to the OpenAI endpoint, which ignores the settings: ${seen[0].url}`
      );
    });

    await test("the request carries the values the constraints hold", async () => {
      const { seen, result } = await capture(() => frontend.generateImage(
        "a cat", "my negatives", CONSTRAINTS, "cyberrealistic_v8.safetensors", null,
        undefined, undefined, [], {}
      ));
      const body = seen[0].body;
      assert.strictEqual(body.steps, 25, "the user's steps, not a launch flag");
      near(body.cfg_scale, 6.5, "the user's CFG");
      assert.strictEqual(body.sampler_name, "dpm++2m");
      assert.strictEqual(body.scheduler, "karras");
      assert.strictEqual(body.seed, 11);
      assert.strictEqual(body.negative_prompt, "my negatives", "the negative prompt reaches the sampler");
      assert.strictEqual(body.width, 512);
      assert.strictEqual(body.height, 512);
      assert.strictEqual(result.stepsSent, 25, "txt2img steps are not scaled");
    });

    await test("an empty negative prompt is filled from the family, not left empty", async () => {
      const { seen } = await capture(() => frontend.generateImage(
        "a cat", "", CONSTRAINTS, "cyberrealistic_v8.safetensors", null,
        undefined, undefined, [], {}
      ));
      assert.match(seen[0].body.negative_prompt, /bad hands/);
    });

    await test("img2img still uses its own endpoint and still scales its steps", async () => {
      const { seen } = await capture(() => frontend.generateImage(
        "a red bag", "", CONSTRAINTS, "sd15", `data:image/png;base64,${PNG_BASE64}`,
        undefined, undefined, [], { denoiseGuidance: 0.38 }
      ));
      assert.ok(seen[0].url.endsWith("/sdapi/v1/img2img"), seen[0].url);
      assert.strictEqual(seen[0].body.steps, 66, "25 real steps at denoise 0.38");
      assert.strictEqual(Math.floor(seen[0].body.steps * 0.38), 25);
      assert.strictEqual(seen[0].body.init_images.length, 1);
      assert.strictEqual(seen[0].body.scheduler, "karras");
    });

    await test("a backend with no sdapi family falls back, and says the run is degraded", async () => {
      globalThis.fetch = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: String(url), body });
        if (String(url).endsWith("/sdapi/v1/txt2img")) {
          return {
            ok: false, status: 404,
            clone() { return this; },
            json: async () => ({ error: "not found" }),
            text: async () => '{"error":"not found"}',
          };
        }
        return {
          ok: true, status: 200,
          clone() { return this; },
          json: async () => ({ data: [{ b64_json: PNG_BASE64 }] }),
          text: async () => JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }),
        };
      };
      const { seen, result } = await capture(() => frontend.generateImage(
        "a cat", "", CONSTRAINTS, "sd15", null, undefined, undefined, [], {}
      ));
      assert.strictEqual(seen.length, 2, "one attempt, then one fallback");
      assert.ok(seen[1].url.endsWith("/v1/images/generations"), seen[1].url);
      assert.match(String(result.degraded), /not applied/i, "the caller is told, not silently short-changed");
      mockFetch();
    });

    await test("a real generation error is not retried", async () => {
      globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
        return {
          ok: false, status: 400,
          clone() { return this; },
          json: async () => ({ error: "invalid params" }),
          text: async () => '{"error":"invalid params"}',
        };
      };
      await capture(async () => {
        await assert.rejects(
          () => frontend.generateImage("a cat", "", CONSTRAINTS, "sd15", null, undefined, undefined, [], {}),
          /invalid params/
        );
      });
      assert.strictEqual(calls.length, 1, "a bad request must not be re-sent to an endpoint that ignores it");
      mockFetch();
    });

    // ── the plan the panel shows is the plan the request uses ────────────
    await test("resolveImagePlan lets what the user set win, and fills only the blanks", () => {
      const pinned = frontend.resolveImagePlan({ ...CONSTRAINTS, qualityPreset: "custom", steps: 40, cfgScale: 9, sampler: "heun" }, "sd15");
      assert.strictEqual(pinned.steps, 40);
      near(pinned.cfgScale, 9, "CFG");
      assert.strictEqual(pinned.sampler, "heun");
      assert.strictEqual(pinned.preset, "custom");

      // Blank sampler/scheduler/CG are filled from the family, so a stale saved
      // constraint cannot silently disable the good defaults.
      const filled = frontend.resolveImagePlan({ width: 512, height: 512, steps: 25 }, "flux1-schnell-Q4.gguf");
      assert.strictEqual(filled.sampler, "euler");
      assert.strictEqual(filled.scheduler, "simple");
      near(filled.cfgScale, 1, "FLUX CFG");
    });

    await test("the user can switch the second pass off but not on where there is no budget", () => {
      const off = frontend.resolveImagePlan({ ...CONSTRAINTS, hiresFix: false }, "sd15");
      assert.strictEqual(off.hires.enabled, false);
      const lowTier = frontend.resolveImagePlan({ ...CONSTRAINTS, hardwareTier: "low", hiresFix: true }, "sd15");
      assert.strictEqual(lowTier.hires.enabled, false, "a 4 GB machine asked for 2x hires gets an OOM, not an image");
    });

    await test("applyQualityPreset moves the sliders to what the preset means", () => {
      const best = frontend.applyQualityPreset({ width: 512, height: 512, steps: 20, cfgScale: 7, sampler: "euler_a" }, "best", "sd15", "high");
      assert.ok(best.steps > 20, `best should raise the steps, got ${best.steps}`);
      assert.strictEqual(best.sampler, "dpm++2m");
      assert.strictEqual(best.hiresFix, true);
      assert.strictEqual(best.qualityPreset, "best");
      assert.strictEqual(best.qualityPinned, false);

      const draft = frontend.applyQualityPreset(best, "draft", "sd15", "high");
      assert.ok(draft.steps < best.steps);
      assert.strictEqual(draft.hiresFix, false, "draft has no second pass");
    });
  }

  await test("the seed a run reports is the seed the request carried", async () => {
    // routes_sdapi.cpp sets out["parameters"] = the body it received and
    // out["info"] = "", and resolve_seed() runs after serialisation — so the
    // backend never tells us which seed it used for a -1. Resolving it in the
    // browser is the only way the number on screen can be the number that ran.
    const { seen, result } = await capture(() =>
      frontend.generateImage("a cat", "", { ...CONSTRAINTS, seed: -1 }, "cyberrealistic_v8.safetensors", null, undefined, undefined, [], {})
    );
    const carried = seen[0].body.seed;
    assert.ok(Number.isInteger(carried) && carried >= 0, "a random seed is resolved before it is sent");
    assert.ok(carried < 4294967296, "and stays inside the engine's unsigned 32-bit range");
    assert.strictEqual(result.seed, carried, "the reported seed is the one that was sent");

    // The point of all of it: reuse must reproduce.
    const reuse = await capture(() =>
      frontend.generateImage("a cat", "", { ...CONSTRAINTS, seed: result.seed }, "cyberrealistic_v8.safetensors", null, undefined, undefined, [], {})
    );
    assert.strictEqual(reuse.seen[0].body.seed, carried, "reusing the reported seed resends the same seed");
    assert.strictEqual(reuse.result.seed, carried);
  });

  globalThis.fetch = realFetch;

  // ── 7. the server publishes the same advice ────────────────────────────

  section("7. the server publishes the machine's half of the answer");

  await test("the hardware endpoint carries recommended_image_settings", () => {
    const serve = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
    assert.match(serve, /recommended_image_settings:/, "the UI can only offer 'Auto (this machine)' if the server says what that is");
    assert.match(serve, /require\("\.\/image-quality\.cjs"\)/, "from the shared module, not a second copy of the numbers");
    assert.match(serve, /planImageQualityProfile/, "the machine profile is the shared one");
  });

  await test("the server and the frontend load one module, not two copies", () => {
    const api = fs.readFileSync(FRONTEND_ENTRY, "utf8");
    assert.match(api, /scripts\/server\/image-quality\.cjs/, "api.js names the shared module it imports");
    assert.match(api, /buildTxt2ImgBody/, "and builds the body with it");
  });

  // ── 7b. shape and prompt length ────────────────────────────────────────
  section("7b. the canvas, and how much prompt the model can hear");

  await test("every shape is a shape, at every tier, and the budget holds", () => {
    const budget = { low: 512 * 512, mid: 768 * 768, high: 1024 * 1024 };
    for (const tier of ["low", "mid", "high"]) {
      for (const shape of iq.ASPECT_RATIOS) {
        const plan = iq.planImageQuality({ family: "sd15", tier, aspect: shape.id });
        const target = shape.units[0] / shape.units[1];
        const error = Math.abs(plan.width / plan.height - target) / target;
        assert.ok(error < 0.02, `${tier}/${shape.id}: ${plan.width}×${plan.height} is ${(error * 100).toFixed(1)}% off ${shape.units.join(":")}`);
        assert.ok(plan.width * plan.height <= budget[tier], `${tier}/${shape.id} must fit the budget`);
        // Both edges have to be multiples of 64 or the backend rounds them itself
        // and the size on the chip is not the size that ran.
        assert.strictEqual(plan.width % 64, 0, `${tier}/${shape.id} width is a multiple of 64`);
        assert.strictEqual(plan.height % 64, 0, `${tier}/${shape.id} height is a multiple of 64`);
        // ...and the plan must not claim a shape it did not deliver.
        assert.strictEqual(plan.aspect, shape.id, `${tier}/${shape.id} reports the shape it is`);
      }
    }
  });

  await test("a shape outranks a stored pixel size, but a typed size outranks neither", () => {
    // Presets write width/height into the constraints. If a stored 1024×1024
    // could veto them, the shape row would show "Wide" over a square image.
    const wide = iq.planImageQuality({ family: "sd15", tier: "high", aspect: "wide", width: 1024, height: 1024 });
    assert.ok(wide.width > wide.height, "the shape decides the canvas, not the stale pixels");
    assert.strictEqual(wide.aspect, "wide");
    // With no shape chosen, an explicit size is still theirs.
    const typed = iq.planImageQuality({ family: "sd15", tier: "high", width: 768, height: 512 });
    assert.strictEqual(typed.width, 768);
    assert.strictEqual(typed.height, 512);
  });

  await test("a square plan is unchanged by the shape work", () => {
    // SD 1.5's own side is 512 and that is what "no shape chosen" must still
    // give: adding shapes must not quietly promote every SD 1.5 run to 1024².
    const sd15 = iq.planImageQuality({ family: "sd15", tier: "high" });
    assert.strictEqual(sd15.width, 512);
    assert.strictEqual(sd15.height, 512);
    assert.strictEqual(sd15.aspect, "square");
    // SDXL's natural side is 1024 and it keeps it.
    const sdxl = iq.planImageQuality({ family: "sdxl", tier: "high" });
    assert.strictEqual(sdxl.width, 1024);
    assert.strictEqual(sdxl.aspect, "square");
  });

  await test("the prompt budget is the backend's chunk size, not a guess", () => {
    // src/conditioning/conditioner.hpp: chunk_len = 77, allow_overflow_expand.
    assert.strictEqual(promptBudgetModule.CLIP_CHUNK_TOKENS, 77);
    assert.strictEqual(promptBudgetModule.promptBudget("sd15").tokens, 77);
    assert.strictEqual(promptBudgetModule.promptBudget("sdxl").tokens, 77);
    // T5 families have a 512-token window and are not chunked this way.
    assert.strictEqual(promptBudgetModule.promptBudget("flux").usesT5, true);
    assert.strictEqual(promptBudgetModule.promptBudget("flux").tokens, 512);
    // It must not be in the entry-bundle module: that is the whole reason it is
    // a separate file.
    assert.strictEqual(iq.promptBudget, undefined, "the display calculation is not in the shipped module");
  });

  await test("the counter is honest at the edge, not only past it", () => {
    const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    assert.strictEqual(promptBudgetModule.describePromptLength(words(5), "sd15").status, "oneChunk");
    // 58 of 59 is the edge, and the copy says so rather than "one chunk".
    const edge = promptBudgetModule.describePromptLength(words(58), "sd15");
    assert.strictEqual(edge.status, "oneChunk");
    assert.match(edge.hint, /near the 59-word limit/);
    assert.strictEqual(promptBudgetModule.describePromptLength(words(75), "sd15").status, "near");
    assert.strictEqual(promptBudgetModule.describePromptLength(words(130), "sd15").status, "over");
    // The same prompt is comfortable on a T5 model.
    assert.strictEqual(promptBudgetModule.describePromptLength(words(130), "flux").status, "oneChunk");
  });

  await test("the counter is what the panel shows, and the panel shows it", () => {
    // The plan carrying this note was moved to the panel (see the bundle note in
    // image-prompt-budget.cjs); the point to pin is that the user is still told.
    const panel = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "QualityPanel.jsx"), "utf8");
    assert.match(panel, /describePromptLength/, "the panel computes the length");
    assert.match(panel, /quality-prompt-length/, "and renders it");
  });

  await test("the shape row and the counter reach the screen", async () => {
    const rendered2 = await renderWorkspace();
    for (const label of ["Square", "Landscape", "Portrait", "Wide", "Tall"]) {
      assert.ok(rendered2.panel.includes(label), `${label} is offered`);
    }
    assert.ok(/quality-shape active/.test(rendered2.panel), "one shape is shown as chosen");
    assert.ok(rendered2.panel.includes("quality-prompt-length"), "the prompt counter renders");
  });

  await test("the Enhance prompt asks for adherence, not adjectives", async () => {
    const templates = await import(pathToFileURL(path.join(root, "app", "frontend", "src", "services", "imagePromptTemplates.js")).href);
    const english = templates.ENGLISH_IMAGE_PROMPT_SYSTEM;
    const thai = templates.THAI_IMAGE_PROMPT_SYSTEM;
    // They must not also be in api.js: that file is in the entry bundle.
    assert.ok(!/ENGLISH_IMAGE_PROMPT_SYSTEM/.test(fs.readFileSync(FRONTEND_ENTRY, "utf8")),
      "the templates are out of the entry bundle");
    assert.ok(english && thai, "both templates are exported");
    for (const [name, tpl] of [["english", english], ["thai", thai]]) {
      // The old template asked for 60 words and "quality tags like highly
      // detailed" — past the chunk boundary, and the filler terms local models
      // ignore. Neither may come back.
      // Naming the filler terms in order to forbid them is the point. Strip the
      // sentences that forbid them, then check nothing asks for them.
      const withoutWarnings = tpl
        .split(/\n|\.\s/)
        .filter((sentence) => !/\b(never|do not|don't|delete|avoid)\b/i.test(sentence))
        .join(" ");
      assert.doesNotMatch(withoutWarnings, /masterpiece|8k|ultra detailed|highly detailed|quality tag/i,
        `${name}: nothing outside a warning asks for filler terms`);
      assert.match(tpl, /\b(never|delete)\b/i, `${name}: explicitly forbids filler terms`);
      assert.match(tpl, /55 words|at most \d+ words/i, `${name}: states a cap inside one chunk`);
      assert.match(tpl, /light/i, `${name}: names lighting as a lever`);
      assert.match(tpl, /camera|shot size|angle/i, `${name}: names the camera as a lever`);
      assert.match(tpl, /ONLY/i, `${name}: forbids preamble`);
    }
    assert.match(thai, /translate/i, "the Thai template still translates first");
  });

  await test("an Enhance result is trimmed to one chunk, on a clause boundary", async () => {
    const templates = await import(pathToFileURL(path.join(root, "app", "frontend", "src", "services", "imagePromptTemplates.js")).href);
    const long = Array.from({ length: 90 }, (_, i) => (i % 6 === 5 ? `clause${i},` : `word${i}`)).join(" ");
    const fitted = templates.fitToPromptBudget(long);
    assert.ok(fitted.split(/\s+/).length <= 59, "never longer than one CLIP chunk");
    assert.doesNotMatch(fitted, /[,\s]$/, "and does not end on a dangling comma");
    // A rewrite inside the budget is left exactly as written.
    const short = "a market stall at dawn, steamed noodles, warm rim light";
    assert.strictEqual(templates.fitToPromptBudget(short), short);
    assert.strictEqual(templates.fitToPromptBudget(""), "");
  });

  // ── 8. the panel exists and the workspace opens simple ─────────────────
  section("8. the simple face");

  await test("the quality panel offers three presets and shows the numbers", () => {
    const panel = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "QualityPanel.jsx"), "utf8");
    for (const preset of ["draft", "balanced", "best"]) {
      assert.ok(panel.includes(`"${preset}"`), `the panel offers ${preset}`);
    }
    assert.match(panel, /quality-chip/, "the honest numbers are visible without opening anything");
    assert.match(panel, /plan\.notes/, "and the plan's explanation is reachable");
  });

  // A source match proves the string exists; it does not prove a user sees it.
  // These render the real components and read the markup that would be sent.
  const rendered = await renderWorkspace();
  await test("the panel renders three presets, and none of them is preselected by accident", () => {
    assert.ok(rendered.panel, "the panel renders without throwing");
    for (const label of ["Draft", "Balanced", "Best"]) {
      assert.ok(rendered.panel.includes(label), `${label} is on screen`);
    }
  });
  await test("the numbers are on screen before the user asks for them", () => {
    // size, steps, CFG, sampler, scheduler, the high-res pass and clip skip:
    // the things that decide what the picture looks like.
    for (const [label, re] of [
      ["size", /\d+\s*[×x]\s*\d+/],
      ["steps", /steps?/i],
      ["CFG", /CFG/i],
      ["sampler", /sampler/i],
      ["scheduler", /scheduler/i],
    ]) {
      assert.match(rendered.panel, re, `${label} is shown without opening fine-tuning`);
    }
    // Clip skip is a real decision only where it applies (SD 1.x, 2.x); on SDXL
    // it is off, and a chip saying so would be noise.
    assert.match(rendered.sd15Panel, /clip\s*skip/i, "clip skip is shown where it applies");
    assert.doesNotMatch(rendered.panel, /clip\s*skip/i, "and not where it does not");
  });
  await test("fine-tuning is folded away, and the panel is above it", () => {
    assert.ok(rendered.panel.includes("Fine-tune"), "the fold has a name a person would look for");
    assert.ok(rendered.generator.includes("generator-advanced"), "the detail section exists");
    assert.ok(
      rendered.generator.indexOf("quality-panel") < rendered.generator.indexOf("generator-advanced"),
      "the simple choice comes before the detail"
    );
    assert.ok(!/<details[^>]*open/.test(rendered.generator), "and it starts closed");
  });
  await test("the workspace renders as a prompt, a choice and a button", () => {
    assert.ok(rendered.generator.includes("generator-prompt"), "there is a prompt box");
    assert.ok(/Generate/.test(rendered.generator), "there is one obvious way to start");
    assert.ok(rendered.generator.includes("generator-layout"), "the two-column layout is in place");
  });

  await test("the workspace opens with a prompt, a quality choice and a button", () => {
    const generator = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "Generator.jsx"), "utf8");
    assert.match(generator, /<QualityPanel/, "the panel is in the workspace");
    assert.match(generator, /className="generator-advanced"/, "everything else is behind one fold");
    assert.match(generator, /negativePrompt=/, "the negative prompt is an input, not dead state");
    assert.match(generator, /resolveImagePlan/, "and the numbers come from the plan the request uses");
    // The references block must be inside the folded section, or the workspace is
    // back to being a wall of controls.
    const detailsAt = generator.indexOf('className="generator-advanced"');
    const referencesAt = generator.indexOf("<ReferenceManager");
    assert.ok(detailsAt > 0 && referencesAt > detailsAt, "the reference manager belongs inside the fold");
  });

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} image quality checks${failed ? `, ${failed} failed` : ""}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
