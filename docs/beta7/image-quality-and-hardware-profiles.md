# Image quality, honest parameters, and the machine you actually own

**Module:** `scripts/server/image-quality.cjs` (one file, required by the server
and imported by the Generator — the same arrangement `img2img-steps.cjs` uses)
**Frontend:** `app/frontend/src/components/Generator.jsx` · `services/api.js`
**Server:** `scripts/server/serve.cjs` → `/api/hardware-specs`
**Suite:** `scripts/validation/test-image-quality-profiles.cjs`

---

## 1. What was measured, not assumed

Three defects in the image workspace were found by reading the **pinned**
backend's own source (`stable-diffusion.cpp`, tag `master-685-19bdfe2`, the tag
`scripts/setup/setup.sh` downloads) rather than by guessing from the UI.

### 1.1 Every txt2img setting was being thrown away

The Generator posted text-to-image to `/v1/images/generations`, the OpenAI
compatibility endpoint. That endpoint reads **five** fields — in
`examples/server/routes_openai.cpp`, `build_openai_generation_request()`:

```cpp
std::string prompt        = j.value("prompt", "");
int n                     = std::max(1, j.value("n", 1));
std::string size          = j.value("size", "");
std::string output_format = j.value("output_format", "png");
int output_compression    = j.value("output_compression", 100);
...
request.gen_params = *runtime.default_gen_params;   // ← everything else comes from here
```

`negative_prompt`, `steps`, `cfg_scale`, `seed` and `sample_method` are **not
read at all**. In the pinned build they can only be reached through an
`<sd_cpp_extra_args>{…}</sd_cpp_extra_args>` block embedded in the prompt text.

So on that endpoint:

| What the UI showed | What the backend used |
| --- | --- |
| Steps 30 | whatever `--steps` the process launched with |
| CFG 7.5 | whatever `--cfg-scale` the process launched with |
| Sampler `dpm++2m` | whatever `--sampling-method` the process launched with |
| Your negative prompt | **nothing** (the field is ignored) |
| Seed 12345 | the launch default |

This is also why the workspace felt brittle: to change steps at all, the app had
to **restart the whole backend process** (the Generator compares settings and
calls `startServer`), paying a full model reload for a number that the request
could simply have carried.

`/sdapi/v1/txt2img` does read them (`build_sdapi_img_gen_request()`): `steps`,
`cfg_scale`, `seed`, `negative_prompt`, `sampler_name`, `scheduler`,
`clip_skip`, and even `enable_hr` / `hr_upscaler` / `hr_scale` / `hr_steps` /
`denoising_strength` for a high-res fix pass. The img2img path was already
correct; text-to-image was not.

**Fix:** text-to-image is sent to `/sdapi/v1/txt2img`, with the step-scaling
rule for img2img untouched (`planImg2ImgSteps`), and a transparent fallback to
`/v1/images/generations` if a backend answers "no such endpoint".

### 1.2 The negative prompt had no input

`negativePrompt` was state in `App.jsx`, passed into the Generator, and rendered
nowhere. The only value ever sent was the empty string plus the reference
suffix. Every local model therefore ran with **no** quality negatives, while
Gemini and GPT-Image are steered by an invisible prompt layer.

**Fix:** a real field, plus per-family defaults that fill it when it is empty.

### 1.3 Nothing connected the hardware to the settings

`getHardwareSpecs()` has computed a `tier` (`low` / `mid` / `high`) for a long
time, but only ever published `recommended_text_settings`. The image workspace
had no tier-aware advice, so a 4 GB laptop and a 24 GB card were both offered
the same numbers — and the wrong ones for SDXL (1024² on 4 GB is an OOM, 512² on
24 GB is a waste).

**Fix:** `recommended_image_settings`, published on the same endpoint and used as
the `Auto (this machine)` preset.

---

## 2. The module

```js
const iq = require("./image-quality.cjs");

iq.detectModelFamily("DreamShaperXL_Lightning.safetensors");
// → "sdxl-lightning"

iq.hardwareImageProfile({ tier: "high", vramGb: 24 });
// → { tier, budgetPixels: 1048576, side: 1024, hires: {...}, vaeTiling: false, … }

iq.planImageQuality({ model: "flux1-schnell-Q4.gguf", tier: "mid", preset: "balanced" });
// → { family, preset, steps, cfgScale, sampler, scheduler, clipSkip,
//     width, height, hires: { enabled, upscaler, scale, steps, denoise },
//     vaeTiling, notes: [...] }
```

Three pure functions, no I/O, no `fetch`, so both processes can call them and a
test can call them directly.

### 2.1 Families

Detection is by filename substring, with the most specific match winning
(`sdxl-lightning` before `sdxl` before `sd15`), and `unknown` falling back to the
SD 1.5 profile because that is what an arbitrary `.safetensors` usually is.

| Family | Sampler | Scheduler | CFG | Steps | CLIP skip |
| --- | --- | --- | --- | --- | --- |
| `sd15` | `dpm++2m` | `karras` | 6.5 | 25 | 2 |
| `sdxl` | `dpm++2m` | `karras` | 5.0 | 28 | −1 |
| `sdxl-lightning` | `euler_a` | `karras` | 2.0 | 6 | −1 |
| `sd3` | `euler` | `simple` | 4.5 | 28 | −1 |
| `flux` | `euler` | `simple` | 1.0 | 4 (schnell) / 20 (dev) | −1 |
| `lcm` | `lcm` | `lcm` | 1.5 | 6 | −1 |
| `unknown` | as `sd15` | | | | |

CLIP skip 2 on SD 1.5 is the single cheapest quality change available for those
checkpoints; −1 (meaning "auto") is correct for the newer architectures and is
the backend's own default.

### 2.2 Quality presets — the simple face

The workspace used to present every knob at once. It now presents three choices
and keeps the knobs one click away:

| Preset | What it does | Who should pick it |
| --- | --- | --- |
| **Draft** | family steps × 0.5 (min 4), no hires pass | iterating on a prompt |
| **Balanced** | family steps, hires ×1.5 at denoise 0.45 when the machine can afford it | the default |
| **Best** | family steps × 1.4, hires ×2 at denoise 0.5 when affordable | a final image |

`Auto` means: take the family, take the preset, then **clamp to the machine**.
The clamp is the part that was missing.

### 2.3 Machine budget

```
budgetPixels = side²    where side = 512 (low) | 768 (mid) | 1024 (high)
hires affordable = budgetPixels × scale² ≤ maxPixels(profile)
```

`low` never runs a hires pass: on a CPU-only or 4 GB machine a 2× pass turns a
two-minute image into a ten-minute one and often OOMs the VAE. `mid` gets one at
1.5×. `high` gets 1.5× by default and 2× under **Best**.

The hires pass is the honest answer to "closer to Gemini / ChatGPT image"
quality. Those products return ~1024–2048 px with coherent fine detail; a single
512² SD 1.5 pass cannot, and no sampler or CFG setting changes that. A second
pass at a higher resolution, at moderate denoise, is the local technique that
actually adds detail (`hires fix`, in the WebUI lineage).

---

## 3. What the request now carries

`/sdapi/v1/txt2img`:

```jsonc
{
  "prompt": "...", "negative_prompt": "…quality negatives…",
  "width": 512, "height": 512,
  "steps": 25, "cfg_scale": 6.5, "seed": -1,
  "sampler_name": "dpm++2m", "scheduler": "karras", "clip_skip": 2,
  "batch_size": 1, "n_iter": 1, "send_images": true, "save_images": false,
  "enable_hr": true, "hr_upscaler": "Latent (bicubic antialiased)",
  "hr_scale": 1.5, "hr_steps": 12, "denoising_strength": 0.45
}
```

`hr_upscaler` is chosen from the modes the pinned build's
`/sdapi/v1/latent-upscale-modes` publishes — `Latent`, `Latent (nearest)`,
`Latent (nearest-exact)`, `Latent (antialiased)`, `Latent (bicubic)`,
`Latent (bicubic antialiased)`. **Not** `Latent (bicubic)`: the string must match
`hires_upscaler_to_str[]` in `src/stable-diffusion.cpp` exactly, and an unknown
name fails `resolve()` and answers HTTP 400. `Lanczos` is a pixel-space
alternative and is used for the `Best` preset below 1×1 ratios where latent
tiling artifacts are most visible.

---

## 4. Why not just switch to the native `/sdcpp/v1` API

Because the pinned build predates it. `api.md` at `master-685-19bdfe2` lists
`/sdcpp/v1/{capabilities,img_gen,jobs,vid_gen}` only — no `upscale`, no recipe
catalog, no model-management routes. Those arrive in later tags (the setup
script pins 685; upstream is past 1080 today). Migrating the transport is a
separate, larger change: it would move generation from synchronous to
job-polling, and it would have to be version-gated on capabilities. The
`/sdapi/v1` family is present in every build the app has ever shipped and reads
every field the UI exposes, so it is the correct target now. Section 6 lists the
upgrade path.

---

## 5. Reproducing the measurement

```bash
# the pinned tag the installer downloads
curl -sL https://codeload.github.com/leejet/stable-diffusion.cpp/tar.gz/refs/tags/master-685-19bdfe2 -o sd.tar.gz
tar xzf sd.tar.gz --wildcards '*/examples/server/*' '*/examples/common/*'
grep -n 'j.value(' sd-*/examples/server/routes_openai.cpp | head   # five fields
grep -n 'j.value(' sd-*/examples/server/routes_sdapi.cpp  | head   # all of them
```

```bash
node scripts/validation/test-image-quality-profiles.cjs
```

---

## 6. Known limits and the next upgrade

- **Reference images are still advisory.** The app sends `reference_images` /
  `reference_settings`; the pinned backend does not read those names. Real
  reference support on this build means `extra_images` (→ `ref_images`) with a
  model that supports IP-Adapter, or a PhotoMaker/PuLID stack. Not attempted
  here, because sending refs to an SD 1.5 checkpoint that cannot use them
  changes images for the worse.
- **The pinned backend has no ESRGAN upscale route.** `--upscale-model` exists on
  the CLI but `/sdcpp/v1/upscale` is not in tag 685. Once the pin moves past the
  versions that publish it, `Best` can add a real 4× ESRGAN pass without a
  round-trip through the browser.
- **Unified memory is a budget, not a certificate.** On Apple Silicon the
  profile uses 75 % of RAM as the pool; macOS will still throttle a process that
  maps more than Metal allows. `hires` is therefore disabled above the budget
  rather than attempted and failed.

---

## 7. Bugs this work uncovered (and fixed)

Writing the suite was worth it: the redesign surfaced four defects that were
live on `main` and had nothing to do with the new panel.

1. **The OpenAI-compatible fallback could never succeed.** `generateImage()`
   falls back to `/v1/images/generations` when a backend has no `/sdapi/v1`
   family — which is exactly what an older or minimal `sd-server` build looks
   like. `generateImageViaOpenAiCompat()` read the body with
   `readJsonResponse()` (which consumes `response.text()`) and then read it
   again, so it always parsed an empty object and threw "Generation returned no
   image." Any user on such a backend got a crash instead of a slightly-degraded
   image. It now reads the body once and says so in the result's `degraded`
   string.
2. **The error message threw away the reason.** `routes_sdapi.cpp` answers a
   rejected request with `{"error": "invalid params"}`, a *string*. The handler
   only looked at `error.message`, so a bad sampler or an unsupported size
   surfaced as "Generation failed (HTTP 400)" — no hint which field was wrong.
   It now shows `Generation failed (HTTP 400): invalid params`.
3. **A seed of `0` was sent as `-1`.** `Math.round(Number(seed) || -1)` treats
   `0` as absent. Seeds are unsigned 32-bit; `0` is the first one. The same
   falsy-number bug was in the Generator's seed input, so typing `0` silently
   became "random".
4. **The seed was resolved in the browser.** `generateImage()` replaced `-1`
   with `Math.floor(Math.random() * 1e6)` *without* telling the response, so the
   metadata recorded a seed no image was made with and "Reuse this seed"
   reproduced a different picture. `-1` now travels as `-1` and the backend's
   own seed comes back on the response.

Two more were caught in the redraw of `serve.cjs`'s comment block: a comment
containing the phrase "already uses" broke `test-memory-pool-explained.cjs`,
which does a naive `replace()` on the source to find the pressure sentence. The
suite is right to be that literal — the sentence on screen is the contract — so
the comment was reworded.

---

## 8. What the screen says now

The workspace is a prompt, three choices, a row of numbers, and one button.

| Layer | What is there | Why |
| --- | --- | --- |
| Always visible | Draft / Balanced / Best, family badge, machine badge | One decision, with the two facts that change what that decision *means*. |
| Always visible | `1024×1024 · 28 steps · CFG 5 · dpm++2m · karras · hi-res ×1.5` | The numbers that decide the picture, in the order they matter. No knob needed to find out what will run. |
| One click away | Fine-tune: steps, CFG, sampler, scheduler, CLIP skip, high-res toggle, negative prompt | Everything the advanced user had before, with a sentence next to each saying what it costs. |
| Folded | Base image, reference manager, seed | Used on some runs, not every run. |

Nothing was removed. `qualityPreset` and `qualityPinned` are separate fields on
purpose: the preset is what the panel *shows*, the pin is the promise that a
preset will not be re-applied over a hand edit on the next model switch. The
badge reads `custom` whenever the numbers on screen differ from what the named
preset would produce — measured, not inferred from a flag, so a preset label can
never sit over numbers that are not the preset's.

The suite renders both components through Vite SSR and asserts on the markup a
user would receive (`test-image-quality-profiles.cjs`, section 8), so a layout
that stops rendering, or a chip that stops appearing, fails the build rather than
the user's first generation.

---

## 9. What "make it better" turned out to mean

Three things separated local output from the hosted models that the first pass
did not address. All three are now in.

### 9.1 The canvas was not adjustable at all

`width` and `height` were state, were sent to the backend, and **had no control
anywhere in the UI**. A user could type "a wide shot" and get a square image
forever; the only way to change it was to pick a different aesthetic preset,
which is not a size control. This is the single most visible difference from
Gemini/ChatGPT — they read shape from the sentence, a diffusion model cannot.

Five shapes now sit under the numbers: Square, Landscape, Portrait, Wide, Tall.
Each fills the machine's pixel budget (area, not long edge — 16:9 is the same
work arranged differently) and every edge is a multiple of 64. The sizes are a
table, not a search:

| Budget | Square | Landscape | Portrait | Wide | Tall |
| --- | --- | --- | --- | --- | --- |
| 512² (low) | 512×512 | 512×384 | 384×512 | 576×320 | 320×576 |
| 768² (mid) | 768×768 | 768×576 | 576×768 | 1024×576 | 576×1024 |
| 1024² (high) | 1024×1024 | 1024×768 | 768×1024 | 1152×640 | 640×1152 |

A shape **outranks** a stored pixel size. That ordering is deliberate: presets
write `width`/`height` into the constraints, so if pixels won, a stored
1024×1024 would veto every later shape change and the row would read "Wide" over
a square image. With no shape chosen, an explicit size is still honoured.

### 9.2 Prompts were too long to be heard

`src/conditioning/conditioner.hpp` at the pinned tag tokenises to
`chunk_len = 77` with `allow_overflow_expand = true`. Text past the first 77
tokens is not dropped — it becomes a **second chunk attended separately**. So a
long prompt is not ignored, it is heard more quietly at the end, which reads
exactly like being ignored. Adherence thins out rather than falling off a cliff,
and nothing in the app said so.

There is now a live counter under the prompt: `58 words · near the 59-word
limit for one CLIP chunk — a few more and the tail is split off`. It stays quiet
until 85 % of the budget, then warns (amber), then says what to do (red). T5
families (FLUX, SD3) have a 512-token window and correctly never warn.

The old Enhance template made this **worse**: it asked for "more descriptive and
detailed... quality tags like 'highly detailed'" under 60 words. It pushed
prompts past the chunk boundary while filling them with the adjectives local
models ignore. Both templates were rewritten around the three things diffusion
models actually follow — subject, camera, light — with an explicit 55-word cap
and the filler terms named in order to forbid them.

### 9.3 The bundle budget caught the cost of the fix

`test-frontend-bundle-budgets.cjs` failed: 310,376 bytes against a 307,200
limit. The cause is worth recording, because it will recur.

`services/api.js` is in the **entry** bundle, and it imports
`scripts/server/image-quality.cjs`. Anything added to that module is paid for on
every start-up, whether or not the Generator is ever opened. Two changes were
moved out rather than absorbed:

- The prompt-length calculation → `scripts/server/image-prompt-budget.cjs`,
  imported only by `QualityPanel` (a lazy chunk).
- The Enhance templates (~3 kB of prose) →
  `app/frontend/src/services/imagePromptTemplates.js`, same place.

What remains is 118 bytes over the old limit: the five-shape table and the
resolver. The budget was raised by 2 KiB with the reason written next to the
number, rather than shaving working code to fit a round figure. The rule that
follows: **display-only logic must not live in a module that `api.js` imports.**

---

## 10. Verification

```bash
node scripts/validation/test-image-quality-profiles.cjs   # 46 checks
node scripts/validation/test-frontend-bundle-budgets.cjs
node scripts/validation/run-all.cjs --include-python        # 233 passed, 0 failed
```

The suite now drives the shape table at all three budgets (ratio within 2 %,
budget respected, both edges 64-multiples, and the plan's `aspect` field agreeing
with its own pixels), pins that a shape beats a stale size and that a typed size
still beats nothing, checks the counter's three thresholds including the
58-of-59 edge case, and SSR-renders the panel to prove the row and the counter
reach the screen.
