"use strict";

/*
 * Which settings actually produce a good image, for the model you loaded and the
 * machine you own.
 *
 * Shared by two processes, the same way scripts/server/img2img-steps.cjs is:
 *
 *   - scripts/server/serve.cjs publishes `recommended_image_settings` from it on
 *     GET /api/hardware-specs, so the UI can offer "Auto (this machine)".
 *   - app/frontend/src/services/api.js imports it and uses it to build the
 *     request, so the numbers on screen are the numbers on the wire.
 *
 * It is deliberately pure: no fs, no fetch, no environment. A validation suite
 * calls these functions directly.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists (measured, not assumed)
 * ---------------------------------------------------------------------------
 *
 * 1. Every txt2img setting used to be discarded by the backend.
 *
 *    The Generator posted text-to-image to /v1/images/generations. In the pinned
 *    backend (stable-diffusion.cpp master-685-19bdfe2, the tag setup.sh
 *    downloads) examples/server/routes_openai.cpp reads exactly five fields:
 *
 *        prompt, n, size, output_format, output_compression
 *
 *    and starts from `*runtime.default_gen_params` for everything else. So
 *    `steps`, `cfg_scale`, `seed`, `sample_method` and `negative_prompt` in the
 *    request body were ignored — the process's launch flags decided them, and a
 *    negative prompt never reached the sampler at all.
 *
 *    /sdapi/v1/txt2img does read them (routes_sdapi.cpp, build_sdapi_img_gen_
 *    request): steps, cfg_scale, seed, negative_prompt, sampler_name,
 *    scheduler, clip_skip, and a high-res fix pass.
 *
 *    The img2img path already used /sdapi/v1/img2img and was correct; only
 *    text-to-image was lossy. Same server, same port, verified in the same tag.
 *
 * 2. The negative prompt had no input at all in the workspace. A local model run
 *    with no negatives is the single largest quality gap against a hosted
 *    product, which is steered by an invisible prompt layer.
 *
 * 3. `getHardwareSpecs()` has always computed a `tier`; nothing published image
 *    recommendations per tier, so a 4 GB laptop and a 24 GB card were offered
 *    the same resolution and the wrong one for both.
 */

// ── Model families ──────────────────────────────────────────────────────────
//
// Ordered most-specific-first: "sdxl-lightning" must win over "sdxl", which
// must win over "sd". Detection is by filename because that is all the app has
// without reading the checkpoint header, and it is what the user named it.
const FAMILY_RULES = [
  { family: "flux", re: /(flux|schnell|flux1|flux\.1|flux-2|flux2)/i },
  { family: "sd3", re: /(sd[-_. ]?3|sd3\.5|sd_3|stable[-_. ]?diffusion[-_. ]?3)/i },
  // "DreamShaperXL_Lightning" and "sdxl_lightning_4step" are both XL distillations:
  // either the word Lightning/Turbo appears anywhere next to an XL marker, or the
  // name is one of the well-known distil builds. Checked before plain `sdxl`.
  { family: "sdxl-lightning", re: /(lightning|turbo|hyper|tcd)/i },
  { family: "sdxl", re: /(sdxl|sd_xl|sd-xl|xl[_-]?base|xl[_-]?refiner|juggernaut[^/\\]*xl|dreamshaper[^/\\]*xl|pony)/i },
  { family: "lcm", re: /(lcm|dreamshaper[^/\\]*lcm)/i },
  { family: "sd15", re: /(sd[-_. ]?1\.?5|sd15|sd_1|v1-5|v1\.5|1[._-]5[-_. ]pruned|cyberrealistic|realistic[_-]?vision|epicrealism|rev[_-]?animated|dreamshaper|absolute[_-]?reality|majicmix|chilloutmix)/i },
];

/**
 * The architecture behind a checkpoint filename.
 *
 * `unknown` (not `sd15`) is returned for anything unrecognised so callers can
 * say "I could not tell" — the *settings* for unknown deliberately fall back to
 * the SD 1.5 profile, because an arbitrary `.safetensors` usually is one, but a
 * caller that wants to warn the user can still see the difference.
 */
function detectModelFamily(modelName) {
  const name = String(modelName || "");
  if (!name.trim()) return "unknown";
  for (const rule of FAMILY_RULES) {
    if (rule.re.test(name)) return rule.family;
  }
  return "unknown";
}

// ── Per-family sampling ─────────────────────────────────────────────────────
//
// The values below are the ones each architecture's own authors publish, not
// one set of "good settings" applied to seven different models:
//
//   SD 1.5      dpm++ 2M + karras at CFG 6.5 and clip skip 2 is the combination
//               the photoreal SD 1.5 community settled on; euler_a at CFG 7
//               (the old default) is grainier and flatter at the same step count.
//   SDXL        the same sampler at lower CFG — SDXL over-burns above ~6.
//   Lightning /   distilled 4–8 step models. CFG must stay low (2–2.5); at CFG 7
//   Turbo         a distilled model produces the blown-out, over-saturated look
//                 that people blame on the model.
//   SD 3.5      flow matching wants `simple` or `sgm_uniform`, and euler.
//   FLUX        CFG 1.0 by definition (it is distilled), euler, `simple`.
//               Schnell is 4 steps; dev is 20.
//   LCM         lcm sampler with the lcm scheduler, 4–8 steps, CFG ~1.5.
//
// `clipSkip: -1` means "leave it to the backend", which is the correct answer
// for every architecture except SD 1.x.
const FAMILY_DEFAULTS = {
  sd15: {
    label: "SD 1.5",
    steps: 25,
    cfgScale: 6.5,
    sampler: "dpm++2m",
    scheduler: "karras",
    clipSkip: 2,
    baseSide: 512,
    negativeStyle: "sd15",
  },
  sdxl: {
    label: "SDXL",
    steps: 28,
    cfgScale: 5,
    sampler: "dpm++2m",
    scheduler: "karras",
    clipSkip: -1,
    baseSide: 1024,
    negativeStyle: "sdxl",
  },
  "sdxl-lightning": {
    label: "SDXL Lightning / Turbo",
    steps: 6,
    cfgScale: 2,
    sampler: "euler_a",
    scheduler: "karras",
    clipSkip: -1,
    baseSide: 1024,
    negativeStyle: "distilled",
  },
  sd3: {
    label: "SD 3.x",
    steps: 28,
    cfgScale: 4.5,
    sampler: "euler",
    scheduler: "simple",
    clipSkip: -1,
    baseSide: 1024,
    negativeStyle: "modern",
  },
  flux: {
    label: "FLUX",
    steps: 4,
    cfgScale: 1,
    sampler: "euler",
    scheduler: "simple",
    clipSkip: -1,
    baseSide: 1024,
    negativeStyle: "none",
  },
  lcm: {
    label: "LCM",
    steps: 6,
    cfgScale: 1.5,
    sampler: "lcm",
    scheduler: "lcm",
    clipSkip: 2,
    baseSide: 512,
    negativeStyle: "distilled",
  },
  unknown: {
    label: "Unknown (SD 1.5 profile)",
    steps: 25,
    cfgScale: 6.5,
    sampler: "dpm++2m",
    scheduler: "karras",
    clipSkip: 2,
    baseSide: 512,
    negativeStyle: "sd15",
  },
};

/**
 * FLUX dev and other non-distilled flow models need a real step budget; Schnell
 * and the quantised `*-Q4`/`*-Q8` Schnell conversions do not. Detected from the
 * name because the step count is the one number a user will not guess.
 */
function familyDefaults(family, modelName = "") {
  const base = FAMILY_DEFAULTS[family] || FAMILY_DEFAULTS.unknown;
  if (family === "flux") {
    const name = String(modelName || "");
    // "dev" is the 20-step model; "schnell"/"krea" and anything without "dev"
    // are treated as distilled, which is the safe direction (too few steps on a
    // distilled model is fine; too few on dev is mush).
    const isDev = /(flux[^/\\]*dev|dev[^/\\]*flux)/i.test(name) && !/schnell/i.test(name);
    if (isDev) return { ...base, steps: 20, cfgScale: 1, label: "FLUX dev" };
    return { ...base, steps: 4, label: "FLUX schnell" };
  }
  return base;
}

// ── Negative prompts ────────────────────────────────────────────────────────
//
// Filled in only when the user leaves the field empty. Existing text always
// wins: a negative prompt is creative intent, not a default to be overwritten.
//
// The listed words are the failure modes of each architecture, not a generic
// "ugly, blurry" pile. SD 1.5 produces hands, watermarks and JPEG mush; distilled
// models produce the opposite problem (they are usually clean, so long negative
// lists degrade them — hence the short list and the empty one for FLUX, which is
// documented as ignoring negative prompts entirely at CFG 1).
const NEGATIVE_STYLES = {
  sd15:
    "lowres, bad anatomy, bad hands, missing fingers, extra digits, watermark, signature, text, logo, jpeg artifacts, blurry, worst quality, low quality",
  sdxl:
    "watermark, signature, text, logo, jpeg artifacts, worst quality, low quality, deformed, disfigured, poorly drawn hands",
  distilled: "blurry, low quality, watermark",
  modern:
    "watermark, signature, text, logo, low quality, deformed, disfigured, extra limbs",
  none: "",
};

function defaultNegativePrompt(family, modelName = "") {
  const d = familyDefaults(family, modelName);
  return NEGATIVE_STYLES[d.negativeStyle] ?? NEGATIVE_STYLES.sd15;
}

// ── Presets: the simple face ────────────────────────────────────────────────
//
// Three choices. `auto`/`balanced` is the default and means "the family's own
// numbers, clamped to what this machine can actually finish".
const PRESETS = ["draft", "balanced", "best", "auto"];
const DEFAULT_PRESET = "auto";

function normalisePreset(preset) {
  const value = String(preset || "").trim().toLowerCase();
  return PRESETS.includes(value) ? value : DEFAULT_PRESET;
}

// ── Machine budget ──────────────────────────────────────────────────────────
//
// tier comes from getHardwareSpecs(): low = no strong GPU, mid = 6–11 GB VRAM or
// 8–15 GB unified, high = 12 GB+ VRAM or 16 GB+ unified.
//
// The side is a *square-equivalent* budget, not a limit on the longer edge, so
// 16:9 at 1024×576 counts as 576²-equivalent. That is the number that matters:
// attention cost grows with the square of the token count.
const TIER_BUDGETS = {
  low: { side: 512, hiresScale: 0, note: "512 px, no high-res pass — a second pass on this machine is slower than it is worth" },
  mid: { side: 768, hiresScale: 1.5, note: "768 px with a 1.5× high-res pass" },
  high: { side: 1024, hiresScale: 1.5, note: "1024 px, 1.5× high-res pass by default and 2× on Best" },
};

function normaliseTier(tier) {
  const value = String(tier || "").trim().toLowerCase();
  return TIER_BUDGETS[value] ? value : "low";
}

/**
 * What this machine can afford, independent of which model is loaded.
 *
 * `vramGb` is accepted for callers that have it (the server passes the driver's
 * figure), but the tier already encodes it; passing it again is only used to
 * refuse a hires pass on a machine that reported 4 GB and still landed in `mid`.
 */
function hardwareImageProfile({ tier = "low", vramGb = 0 } = {}) {
  const resolvedTier = normaliseTier(tier);
  const budget = TIER_BUDGETS[resolvedTier];
  const vram = Number(vramGb);
  const tight = Number.isFinite(vram) && vram > 0 && vram < 6;

  return {
    tier: resolvedTier,
    side: budget.side,
    // Largest pixel count a single pass should ask for at this tier.
    budgetPixels: budget.side * budget.side,
    // 0 means "no high-res pass on this machine".
    hiresScale: tight ? 0 : budget.hiresScale,
    note: tight && budget.hiresScale > 0 ? `${budget.note}, but VRAM under 6 GB disables the second pass` : budget.note,
    vaeTiling: resolvedTier !== "high",
  };
}

// ── Shape ───────────────────────────────────────────────────────────────────
// A hosted model reads shape from the sentence; a diffusion model does not, so
// the canvas is a setting. These are the shapes, as width:height units.

const ASPECT_RATIOS = [
  { id: "square", label: "Square", units: [1, 1] },
  { id: "landscape", label: "Landscape", units: [4, 3] },
  { id: "portrait", label: "Portrait", units: [3, 4] },
  { id: "wide", label: "Wide", units: [16, 9] },
  { id: "tall", label: "Tall", units: [9, 16] },
];

const DEFAULT_ASPECT = "square";

function normaliseAspect(aspect) {
  const value = String(aspect || "").trim().toLowerCase();
  return ASPECT_RATIOS.some((a) => a.id === value) ? value : null;
}

// The five shapes at the three budgets the tiers produce. A table, not a search:
// a runtime search for the closest 64-multiple pair was 2.7 kB in the entry
// bundle for five constant answers. Area is what a budget limits, so each shape
// fills the same number of pixels (0.95 headroom absorbs rounding to 64).
const SHAPE_SIZES = {
  [512 * 512]: { square: [512, 512], landscape: [512, 384], portrait: [384, 512], wide: [576, 320], tall: [320, 576] },
  [768 * 768]: { square: [768, 768], landscape: [768, 576], portrait: [576, 768], wide: [1024, 576], tall: [576, 1024] },
  [1024 * 1024]: { square: [1024, 1024], landscape: [1024, 768], portrait: [768, 1024], wide: [1152, 640], tall: [640, 1152] },
};

function aspectSize(aspect, budgetPixels) {
  const chosen = ASPECT_RATIOS.find((a) => a.id === normaliseAspect(aspect));
  if (!chosen) return null;
  const budget = Number(budgetPixels) > 0 ? Number(budgetPixels) : 512 * 512;

  const known = SHAPE_SIZES[budget]?.[chosen.id];
  if (known) return { width: known[0], height: known[1], label: chosen.label };

  // Fallback for a budget the tiers do not produce: coarser, never over budget.
  const [uw, uh] = chosen.units;
  const scale = Math.sqrt((budget * 0.95) / (uw * uh));
  return {
    width: roundTo64(uw * scale),
    height: roundTo64(uh * scale),
    label: chosen.label,
  };
}

// ── The plan ────────────────────────────────────────────────────────────────

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function roundTo64(value) {
  return Math.max(64, Math.round(Number(value) / 64) * 64);
}

// Stable-diffusion.cpp accepts these hires upscalers (hires_upscaler_to_str[] in
// src/stable-diffusion.cpp). A name that is not on this list fails resolve() and
// the request answers HTTP 400, so nothing here is invented.
const HIRES_UPSCALERS = {
  latentSmooth: "Latent (bicubic antialiased)",
  latentFast: "Latent",
  lanczos: "Lanczos",
};

/**
 * The settings for one image.
 *
 * @param {object} options
 * @param {string} options.model      checkpoint filename, used for family detection
 * @param {string} [options.tier]     hardware tier from /api/hardware-specs
 * @param {number} [options.vramGb]   optional; refines the tier's hires decision
 * @param {string} [options.preset]   draft | balanced | best | auto
 * @param {number} [options.width]    when provided, kept (and hires scales it)
 * @param {number} [options.height]
 * @param {string} [options.aspect]   square | landscape | portrait | wide | tall
 * @returns {object} a plan the request is built from, with `notes` explaining it
 */
function planImageQuality(options = {}) {
  const model = String(options.model || "");
  // An explicit family (from a model library entry or a user override) always
  // wins: filename sniffing is a guess, and the guess must be overridable.
  const hinted = String(options.family || "").trim().toLowerCase();
  const family = hinted && FAMILY_DEFAULTS[hinted] ? hinted : detectModelFamily(model);
  const defaults = familyDefaults(family, model);
  const preset = normalisePreset(options.preset);
  const machine = hardwareImageProfile({ tier: options.tier, vramGb: options.vramGb });
  // "auto" is the balanced preset clamped to the machine; keeping the two names
  // separate lets the UI say "Auto" while a test asks for "balanced" explicitly.
  const effectivePreset = preset === "auto" ? "balanced" : preset;
  const notes = [];

  // ── steps ──
  const familySteps = Math.max(1, Math.round(defaults.steps));
  let steps;
  if (effectivePreset === "draft") {
    steps = Math.max(4, Math.round(familySteps * 0.5));
  } else if (effectivePreset === "best") {
    // Distilled models have nothing to gain above their own step count and lose
    // time; a distilled model asked for 1.4x is a slower identical image.
    steps = defaults.negativeStyle === "none" || family === "sdxl-lightning" || family === "lcm"
      ? familySteps
      : Math.round(familySteps * 1.4);
  } else {
    steps = familySteps;
  }

  // ── resolution ──
  const requestedWidth = Number(options.width);
  const requestedHeight = Number(options.height);
  const hasRequestedSize = Number.isFinite(requestedWidth) && requestedWidth > 0
    && Number.isFinite(requestedHeight) && requestedHeight > 0;

  // A picked shape outranks width/height: presets write pixels into the
  // constraints, so a stored 1024×1024 would otherwise veto every later shape
  // change and the row would read "Wide" over a square image. With no shape set,
  // an explicit pixel request is still honoured unchanged.
  const aspect = normaliseAspect(options.aspect);
  const shaped = aspect ? aspectSize(aspect, machine.budgetPixels) : null;

  let width;
  let height;
  if (shaped) {
    width = shaped.width;
    height = shaped.height;
  } else if (hasRequestedSize) {
    width = roundTo64(requestedWidth);
    height = roundTo64(requestedHeight);
  } else {
    // The family's natural side, but never more than the machine's budget: on a
    // 4 GB card a 1024² SDXL pass from `Auto` would OOM, and an OOM reads to the
    // user as "the app is broken".
    const side = Math.min(defaults.baseSide, machine.side);
    width = side;
    height = side;
  }

  const pixels = width * height;
  if (pixels > machine.budgetPixels * 1.05) {
    notes.push(
      `${width}×${height} is above this machine's ${machine.side} px budget — expect it to be slow or to fall back to CPU`
    );
  }

  // ── high-res fix ──
  // The honest quality lever. A single 512² pass cannot produce the fine detail
  // a hosted model returns; a second pass at a higher resolution, at moderate
  // denoise, is what local pipelines use to get it.
  let hires = { enabled: false, upscaler: HIRES_UPSCALERS.latentSmooth, scale: 1, steps: 0, denoise: 0.45 };
  if (effectivePreset !== "draft" && machine.hiresScale > 0) {
    let scale = machine.hiresScale;
    let denoise = 0.45;
    if (effectivePreset === "best") {
      // 2x only where the machine has room for four times the pixels.
      scale = Math.min(2, Math.max(machine.hiresScale, 2));
      denoise = 0.5;
      if (machine.budgetPixels * scale * scale > machine.budgetPixels * 4) scale = 1.5;
    }
    // Never scale past what the budget can carry: 1024² on `mid` (768 budget)
    // stays at 1x rather than asking a 6 GB card for 2304².
    const targetPixels = pixels * scale * scale;
    const ceiling = machine.budgetPixels * (effectivePreset === "best" ? 4 : 2.25);
    if (targetPixels > ceiling) {
      const allowed = Math.sqrt(ceiling / pixels);
      scale = Math.max(1, Math.min(scale, Number(allowed.toFixed(2))));
    }
    if (scale > 1) {
      hires = {
        enabled: true,
        // Lanczos for non-square crops under Best: latent upscalers tile, and
        // tiling is most visible on a long edge.
        upscaler: effectivePreset === "best" && Math.abs(width - height) / Math.max(width, height) > 0.2
          ? HIRES_UPSCALERS.lanczos
          : HIRES_UPSCALERS.latentSmooth,
        scale,
        // sd-webui's own rule: roughly half the first pass, at least 8 — fewer
        // adds no detail, more just costs time.
        steps: Math.max(8, Math.round(steps * 0.5)),
        denoise,
      };
      notes.push(`high-res pass ×${scale} at denoise ${denoise} adds the fine detail a single pass cannot`);
    } else {
      notes.push(`no high-res pass: ${width}×${height} already fills this machine's budget`);
    }
  } else if (effectivePreset === "draft") {
    notes.push("draft: half the steps and no high-res pass");
  } else {
    notes.push(machine.note);
  }

  if (family === "unknown") {
    notes.push("model family not recognised from its filename — using the SD 1.5 profile; set the sampler by hand if this is not an SD 1.x checkpoint");
  }


  return {
    family,
    familyLabel: defaults.label,
    preset: effectivePreset,
    requestedPreset: preset,
    tier: machine.tier,
    steps,
    cfgScale: defaults.cfgScale,
    sampler: defaults.sampler,
    scheduler: defaults.scheduler,
    clipSkip: defaults.clipSkip,
    width,
    height,
    // The shape actually in play: the user's pick, or "custom" when the pixels
    // are not one of the offered shapes (a typed size, a family default).
    aspect: shaped ? aspect : (aspectDetail(width, height) || "custom"),
    // Carried on the plan so the UI renders the row from the same table the
    // request is built from, instead of importing it into the entry bundle.
    shapes: ASPECT_RATIOS,
    hires,
    vaeTiling: machine.vaeTiling,
    negativePrompt: defaultNegativePrompt(family, model),
    notes,
  };
}

/** Which offered shape these pixels are, or null when they are not one. */
function aspectDetail(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = w / h;
  for (const candidate of ASPECT_RATIOS) {
    const [uw, uh] = candidate.units;
    if (Math.abs(ratio - uw / uh) < 0.02) return candidate.id;
  }
  return null;
}

// ── What the request carries ────────────────────────────────────────────────

/**
 * Turn a plan into the body of POST /sdapi/v1/txt2img.
 *
 * Kept here rather than in the frontend so the server, the frontend and the test
 * suite agree on field names. Only fields the pinned backend's
 * build_sdapi_img_gen_request() actually reads appear in the result; the ones it
 * does not read (scheduler is read, `n_iter` is not) are included only where a
 * WebUI-lineage server would also accept them harmlessly.
 */
function buildTxt2ImgBody(plan, { prompt = "", negativePrompt = "", seed = -1, batchSize = 1 } = {}) {
  const p = plan || planImageQuality({});
  const negative = String(negativePrompt || "").trim() || p.negativePrompt || "";
  const body = {
    prompt: String(prompt || ""),
    negative_prompt: negative,
    width: p.width,
    height: p.height,
    steps: p.steps,
    cfg_scale: p.cfgScale,
    // -1 is the backend's own "pick one for me". 0 is a perfectly good seed and
    // must not be swallowed by a falsy-number fallback.
    seed: Number.isFinite(Number(seed)) ? Math.round(Number(seed)) : -1,
    sampler_name: p.sampler,
    scheduler: p.scheduler,
    batch_size: Math.max(1, Math.round(Number(batchSize) || 1)),
    n_iter: 1,
    send_images: true,
    save_images: false,
  };
  // -1 is the backend's own "use the model's default"; sending it explicitly is
  // what build_sdapi_img_gen_request expects for clip_skip.
  if (Number.isFinite(Number(p.clipSkip)) && Number(p.clipSkip) > 0) {
    body.clip_skip = Number(p.clipSkip);
  }
  if (p.hires && p.hires.enabled) {
    body.enable_hr = true;
    body.hr_upscaler = p.hires.upscaler;
    body.hr_scale = p.hires.scale;
    body.hr_steps = p.hires.steps;
    // In sdapi this field is the *highres* denoise for txt2img, not the img2img
    // strength (routes_sdapi.cpp reads it inside the `!img2img` branch).
    body.denoising_strength = p.hires.denoise;
  }
  return body;
}

/**
 * The tools the pinned backend publishes, and which of them this plan uses.
 * Exposed so a test can assert we never send a name that is not in the list.
 */
const BACKEND_SAMPLERS = [
  "euler", "euler_a", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2mv2",
  "ipndm", "ipndm_v", "lcm", "ddim_trailing", "tcd", "res_multistep", "res_2s",
  "er_sde", "euler_cfg_pp", "euler_a_cfg_pp", "euler_ge",
];

const BACKEND_SCHEDULERS = [
  "discrete", "karras", "exponential", "ays", "gits", "sgm_uniform", "simple",
  "smoothstep", "kl_optimal", "lcm", "bong_tangent", "ltx2",
];

const BACKEND_HIRES_UPSCALERS = [
  "None", "Latent", "Latent (nearest)", "Latent (nearest-exact)",
  "Latent (antialiased)", "Latent (bicubic)", "Latent (bicubic antialiased)",
  "Lanczos", "Nearest", "Model",
];

module.exports = {
  ASPECT_RATIOS,
  DEFAULT_ASPECT,
  normaliseAspect,
  aspectSize,
  aspectDetail,
  detectModelFamily,
  familyDefaults,
  defaultNegativePrompt,
  hardwareImageProfile,
  planImageQuality,
  buildTxt2ImgBody,
  normalisePreset,
  FAMILY_DEFAULTS,
  NEGATIVE_STYLES,
  PRESETS,
  DEFAULT_PRESET,
  TIER_BUDGETS,
  HIRES_UPSCALERS,
  BACKEND_SAMPLERS,
  BACKEND_SCHEDULERS,
  BACKEND_HIRES_UPSCALERS,
};
