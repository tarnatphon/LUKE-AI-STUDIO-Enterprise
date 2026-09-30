"use strict";

/*
 * How many steps an img2img request should put on the wire.
 *
 * Shared by the two places that drive the bundled image backend: the Generator
 * workspace (app/frontend/src/services/api.js) and the Social Agency calendar
 * images (scripts/server/social-agency-runtime.cjs). Both send
 * `denoising_strength` to the same stable-diffusion.cpp server, so both have to
 * scale `steps` the same way — otherwise one of them quietly loses the prompt.
 *
 * Why scaling is needed. The backend implements img2img the way sd-webui does:
 * `denoising_strength` trims the schedule instead of lengthening it. In
 * stable-diffusion.cpp, src/pipeline/image.cpp, prepare_image_generation_latents():
 *
 *     t_enc = static_cast<size_t>(plan->sample_steps * request->strength);
 *     ...
 *     sigma_sched.assign(plan->sigmas.begin() + plan->sample_steps - t_enc - 1, plan->sigmas.end());
 *     plan->sample_steps = static_cast<int>(plan->sigmas.size() - 1);
 *
 * so `steps` on the wire is a *budget*, and only floor(steps x denoise) of it is
 * really sampled: 20 steps at denoise 0.38 runs 7 steps. Seven steps cannot
 * restyle a scene — the picture keeps the init photo's structure and the prompt
 * barely shows, which is exactly the "denoise 0.38 still ignores my prompt"
 * report. Raising denoise is one fix; scaling the steps is the other, and it
 * keeps the product photo identical while giving the prompt the full budget.
 *
 * Upstream already scales this way for hires fix — src/pipeline/request.cpp:
 *
 *     // sd-webui behavior: scale up total steps so trimming by
 *     // denoising_strength yields exactly hires_steps effective steps,
 *     int scheduler_steps = static_cast<int>(effective_steps / hires.denoising_strength);
 *
 * This module does the same for img2img: `steps` keeps meaning "how many real
 * denoising steps to spend", and the number sent is inflated so the trim lands
 * back on it. What denoise controls — how far from the original photo the
 * sampling starts — is unchanged, so the image still keeps as much of the init
 * picture as before; it is the prompt's influence and the sample quality that
 * grow. The honest cost is time: the request takes about 1/denoise times longer
 * to sample (6.7x at denoise 0.15, 2.6x at 0.38).
 */

// Same default the Social Agency ships with (PRODUCT_REF_DENOISE.def) and the
// same one the Generator's reference settings use.
const DEFAULT_DENOISE = 0.38;
// A caller that hands us 0 or a negative denoise would ask for infinite steps.
// Nothing below the app's own 0.15 slider can be reached with a real setting.
const MIN_DENOISE = 0.01;
// sd-webui's own ceiling. A request that never finishes is worse than a short
// one, so the scaling stops here and reports that it was capped.
const MAX_SENT_STEPS = 150;
const DEFAULT_STEPS = 20;

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampDenoise(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(1, Math.max(MIN_DENOISE, n));
}

/**
 * @param {number} requestedSteps steps the caller wants the sampler to run
 * @param {number} denoise        denoising_strength the request will carry
 * @returns {{steps:number, sent:number, strength:number, effective:number,
 *            scaled:boolean, capped:boolean}}
 *   `steps`   what the caller asked for (also what the UI shows)
 *   `sent`    the value for the request's `steps` field
 *   `effective` what the backend will really sample: floor(sent x strength)
 *   `scaled`  sent > steps, i.e. the scaling did something
 *   `capped`  the ceiling stopped us short of `steps` (the run will be shorter)
 */
function planImg2ImgSteps(requestedSteps, denoise) {
  const wanted = clampInt(requestedSteps, 1, MAX_SENT_STEPS, DEFAULT_STEPS);
  const strength = clampDenoise(denoise, DEFAULT_DENOISE);

  let sent = wanted;
  if (strength < 1) {
    sent = Math.ceil(wanted / strength);
    // ceil() alone can still undershoot, because the backend truncates:
    // 19 x 0.38 is 7.219... and truncates to 7 steps, not 8.
    while (sent < MAX_SENT_STEPS && Math.floor(sent * strength) < wanted) sent += 1;
    sent = Math.min(sent, MAX_SENT_STEPS);
  }

  const effective = Math.min(wanted, Math.floor(sent * strength));
  return {
    steps: wanted,
    sent,
    strength,
    effective,
    scaled: sent > wanted,
    capped: effective < wanted,
  };
}

module.exports = {
  planImg2ImgSteps,
  MAX_IMG2IMG_SENT_STEPS: MAX_SENT_STEPS,
  DEFAULT_IMG2IMG_DENOISE: DEFAULT_DENOISE,
};
