#!/usr/bin/env node
"use strict";

/**
 * Img2img steps are a budget the backend trims, so they have to be scaled.
 *
 * The bundled stable-diffusion backend implements img2img the way sd-webui does:
 * `denoising_strength` does not lengthen the schedule, it cuts it short. In
 * stable-diffusion.cpp, src/pipeline/image.cpp, prepare_image_generation_latents():
 *
 *     t_enc = static_cast<size_t>(plan->sample_steps * request->strength);
 *     ...
 *     plan->sample_steps = static_cast<int>(plan->sigmas.size() - 1);
 *
 * so a request of `steps` at denoise d really samples floor(steps x d) steps:
 * 20 steps at denoise 0.38 runs 7. That is why a low denoise "ignores the
 * prompt" — the product photo comes out right, but seven steps cannot restyle a
 * scene, so the picture keeps the init image's structure.
 *
 * The fix (one module shared by the Generator and the Social Agency runtime —
 * scripts/server/img2img-steps.cjs) sends a larger number so the trim lands back
 * on the steps the user asked for: 20 at 0.38 goes out as 53 and the sampler
 * still runs 20. What denoise controls — how far from the original photo the run
 * starts — does not change, so the fix is prompt influence and sample quality,
 * not a different picture.
 *
 * What is asserted here:
 *   - the rule itself: the number sent always leaves at least the requested
 *     steps to sample (unless the 150-step ceiling bites), it is the smallest
 *     such number, and garbage input cannot produce NaN or an endless request
 *   - the Social Agency: the calendar request carries the scaled steps, the job
 *     record keeps both numbers, a flux/lightning model is scaled from its own
 *     4-step baseline, and the legacy reference mode is not scaled at all
 *   - the Generator: its real module is imported and driven, so the request it
 *     builds for /sdapi/v1/img2img carries the scaled steps, txt2img is
 *     untouched, and the denoise window (0.15–0.75) did not move
 *
 * Everything is mocked: no network, no image backend, no real account.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const { planImg2ImgSteps, MAX_IMG2IMG_SENT_STEPS } = require("../server/img2img-steps.cjs");

const root = path.resolve(__dirname, "..", "..");
const FRONTEND_ENTRY = path.join(root, "app", "frontend", "src", "services", "api.js");
const MAX_SENT = MAX_IMG2IMG_SENT_STEPS;

// 1×1 transparent PNG — an image the file-type check accepts.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082",
  "hex"
);
const PNG_BASE64 = PNG.toString("base64");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function bangkokToday(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  console.log("\n=== Img2img steps are scaled to survive the denoise trim ===\n");

  // ── setup: a Social Agency runtime in a temp root, fetch mocked throughout ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img2img-steps-"));
  const realFetch = globalThis.fetch;
  const rt = new SocialAgencyRuntime({ root: tmp });
  const state = rt.getState();
  const clientId = state.activeClientId;
  const sku = state.clients.find((c) => c.id === clientId).products[0].sku;

  const photoDir = path.join(tmp, "app", "outputs", "sa-products", clientId);
  fs.mkdirSync(photoDir, { recursive: true });
  fs.writeFileSync(path.join(photoDir, `${sku}.png`), PNG);
  const stored = rt._read();
  stored.clients.find((c) => c.id === clientId).products.find((p) => p.sku === sku).image = `/sa-products/${clientId}/${sku}.png`;
  rt._write(stored);

  rt.setImageSaver(async (dataUrl) => {
    const name = `sa-img-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
    const file = path.join(tmp, name);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(",")[1], "base64"));
    return { image: name, url: `/api/output-file?filename=${name}`, absPath: file };
  });

  const okImage = () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_BASE64, seed: 42 }] }) });
  let responder = okImage;
  let calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return responder(String(url));
  };

  // The Generator's module: importable here (its only bare import,
  // @tauri-apps/api/core, resolves from app/frontend/node_modules), so the
  // request it *really* builds can be asserted instead of its source text.
  let frontend = null;
  try {
    frontend = await import(pathToFileURL(FRONTEND_ENTRY).href);
  } catch (err) {
    console.log(`  note: the Generator module could not be imported (${err.message});`);
    console.log("        run `cd app/frontend && npm install` to include those checks.\n");
  }

  const setSettings = (settings) => rt.saveConnectors(clientId, { settings });
  const getEntry = (id) => rt._read().clients.find((c) => c.id === clientId).calendar.find((e) => e.id === id);
  const waitJob = async (id) => {
    const t0 = Date.now();
    for (;;) {
      const job = getEntry(id).imageJob;
      if (job && job.status !== "running") return job;
      if (Date.now() - t0 > 15000) throw new Error("image job did not finish in 15s");
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const generate = async (time) => {
    calls = [];
    const entry = rt.createCalendarEntry(clientId, {
      entry: { date: bangkokToday(1), time, platform: "facebook", sku, angle: "เปิดตัวสินค้า" },
    });
    rt.startEntryImageGen(clientId, entry.id);
    const job = await waitJob(entry.id);
    return { job, calls };
  };

  const CONSTRAINTS = { width: 512, height: 512, steps: 20, cfgScale: 7, seed: 1, sampler: "euler_a" };

  try {
    // ── 1. the shared rule ────────────────────────────────────────────────
    test("20 steps at denoise 0.38 go out as 53 so 20 are really sampled", () => {
      const plan = planImg2ImgSteps(20, 0.38);
      assert.strictEqual(plan.steps, 20, "the user's number stays the budget");
      assert.strictEqual(plan.sent, 53, "53 x 0.38 = 20.14, which truncates to 20");
      assert.strictEqual(plan.effective, 20);
      assert.strictEqual(plan.scaled, true);
      assert.strictEqual(plan.capped, false);
    });

    test("the trim the backend applies never leaves fewer steps than asked for", () => {
      let checked = 0;
      for (let steps = 1; steps <= 40; steps += 1) {
        for (let d = 15; d <= 100; d += 1) {
          const plan = planImg2ImgSteps(steps, d / 100);
          // The backend's own arithmetic (src/pipeline/image.cpp).
          const sampledByBackend = Math.floor(plan.sent * plan.strength);
          checked += 1;
          assert.ok(plan.sent <= MAX_SENT, `sent ${plan.sent} exceeds the ceiling`);
          if (!plan.capped) {
            assert.ok(
              sampledByBackend >= plan.steps,
              `steps=${steps} denoise=${d / 100}: only ${sampledByBackend} of ${plan.steps} would be sampled`
            );
          }
          assert.strictEqual(plan.capped, sampledByBackend < plan.steps, "capped has to describe reality");
        }
      }
      assert.ok(checked > 3000, `the sweep ran (${checked} combinations)`);
    });

    test("the number sent is the smallest one that works (the backend truncates)", () => {
      // 7 / 0.38 = 18.4, and 18 would truncate to 6 steps: 19 is the answer. A
      // plain round() would have sent 18 and quietly lost a step.
      const plan = planImg2ImgSteps(7, 0.38);
      assert.strictEqual(plan.sent, 19);
      assert.strictEqual(Math.floor(plan.sent * plan.strength), 7);
      assert.strictEqual(Math.floor((plan.sent - 1) * plan.strength), 6, "one less would be short");
    });

    test("txt2img and denoise 1.0 are left alone", () => {
      const full = planImg2ImgSteps(20, 1);
      assert.strictEqual(full.sent, 20);
      assert.strictEqual(full.effective, 20);
      assert.strictEqual(full.scaled, false);
      assert.strictEqual(full.capped, false);
    });

    test("the 150-step ceiling holds and is reported rather than hanging a machine", () => {
      const plan = planImg2ImgSteps(50, 0.15);
      assert.strictEqual(plan.sent, MAX_SENT, "50 / 0.15 = 334, capped to 150");
      assert.strictEqual(plan.capped, true, "the run finishes short, and says so");
      assert.ok(plan.effective < plan.steps);

      const absurd = planImg2ImgSteps(100000, 0.001);
      assert.strictEqual(absurd.sent, MAX_SENT);
      assert.ok(Number.isFinite(absurd.sent) && Number.isFinite(absurd.effective));
    });

    test("garbage input cannot produce NaN, zero or an unbounded request", () => {
      for (const steps of [NaN, undefined, null, 0, -5, "abc", Infinity, ""]) {
        for (const denoise of [NaN, undefined, null, 0, -1, "abc", Infinity]) {
          const plan = planImg2ImgSteps(steps, denoise);
          for (const [key, value] of Object.entries(plan)) {
            if (typeof value === "number") {
              assert.ok(Number.isFinite(value), `steps=${steps} denoise=${denoise} left ${key}=${value}`);
            }
          }
          assert.ok(plan.steps >= 1 && plan.steps <= MAX_SENT, "steps stays in range");
          assert.ok(plan.sent >= 1 && plan.sent <= MAX_SENT, "sent stays in range");
          assert.ok(plan.strength > 0 && plan.strength <= 1, "strength stays in range");
        }
      }
      assert.strictEqual(planImg2ImgSteps(20, 0).strength, 0.38, "denoise 0 falls back to the app default");
    });

    test("a lower denoise never sends fewer steps", () => {
      let previous = 0;
      for (let d = 100; d >= 15; d -= 1) {
        const plan = planImg2ImgSteps(20, d / 100);
        assert.ok(plan.sent >= previous, `denoise ${d / 100} sent ${plan.sent}, below ${previous}`);
        previous = plan.sent;
      }
    });

    // ── 2. the Social Agency runtime sends it ─────────────────────────────
    test("the calendar request carries the scaled steps and the job keeps both numbers", async () => {
      const { job, calls: seen } = await generate("02:01");
      assert.strictEqual(job.status, "done", job.error);
      assert.strictEqual(seen.length, 1);
      assert.ok(seen[0].url.endsWith("/sdapi/v1/img2img"), seen[0].url);
      assert.strictEqual(seen[0].body.denoising_strength, 0.38);
      assert.strictEqual(seen[0].body.steps, 53, "the request spends the full budget, not 7 steps");
      assert.strictEqual(Math.floor(seen[0].body.steps * seen[0].body.denoising_strength), 20);
      assert.strictEqual(job.refMode, "img2img");
      assert.strictEqual(job.steps, 20, "what the operator asked for");
      assert.strictEqual(job.stepsSent, 53, "what the request carried");
      assert.strictEqual(job.stepsCapped, undefined, "nothing was capped here");
    });

    test("a flux/lightning model is scaled from its own 4-step baseline", async () => {
      rt.setImageGenDefaultsProvider(() => ({ model: "flux1-schnell-Q4", steps: 4, cfgScale: 1.0, width: 1024, height: 1024 }));
      const { job, calls: seen } = await generate("02:02");
      assert.strictEqual(seen[0].body.steps, 11, "4 / 0.38 = 10.5, and 10 would truncate to 3");
      assert.strictEqual(Math.floor(seen[0].body.steps * 0.38), 4);
      assert.strictEqual(job.steps, 4);
      assert.strictEqual(job.stepsSent, 11);
      rt.setImageGenDefaultsProvider(null);
    });

    test("the legacy reference mode is not scaled — nothing trims it", async () => {
      setSettings({ productRefMode: "reference" });
      const { job, calls: seen } = await generate("02:03");
      assert.ok(seen[0].url.endsWith("/v1/images/generations"), seen[0].url);
      assert.strictEqual(seen[0].body.steps, 20, "no denoise trim, no scaling");
      assert.strictEqual(job.refMode, "reference");
      assert.strictEqual(job.stepsSent, undefined, "the record only claims scaling where it happened");
      setSettings({ productRefMode: "img2img" });
    });

    test("hitting the 150-step ceiling is visible on the job", async () => {
      setSettings({ productRefDenoise: 0.15 });
      rt.setImageGenDefaultsProvider(() => ({ steps: 50 }));
      const { job, calls: seen } = await generate("02:04");
      assert.strictEqual(seen[0].body.steps, 150);
      assert.strictEqual(Math.floor(150 * 0.15), 22, "22 real steps is all the ceiling allows");
      assert.strictEqual(job.steps, 50);
      assert.strictEqual(job.stepsSent, 150);
      assert.strictEqual(job.stepsCapped, true, "an operator has to be told the run is short");
      rt.setImageGenDefaultsProvider(null);
      setSettings({ productRefDenoise: 0.38 });
    });

    // ── 3. the Generator sends it too, driven for real ────────────────────
    if (frontend) {
      const shared = require("../server/img2img-steps.cjs");
      const callOnce = async (inputImageBase64, referenceSettings) => {
        calls = [];
        const result = await frontend.generateImage(
          "a red bag on a beach", "", CONSTRAINTS, "sd15", inputImageBase64,
          undefined, undefined, [], referenceSettings
        );
        return { result, seen: calls };
      };

      test("the Generator's img2img request carries the scaled steps", async () => {
        const { result, seen } = await callOnce(`data:image/png;base64,${PNG_BASE64}`, { denoiseGuidance: 0.38 });
        assert.strictEqual(seen.length, 1);
        assert.ok(seen[0].url.endsWith("/sdapi/v1/img2img"), seen[0].url);
        assert.strictEqual(seen[0].body.steps, 53);
        assert.strictEqual(seen[0].body.denoising_strength, 0.38);
        assert.strictEqual(seen[0].body.init_images.length, 1);
        assert.strictEqual(result.steps, 20);
        assert.strictEqual(result.stepsSent, 53);
        assert.strictEqual(result.stepsCapped, false);
      });

      test("the Generator's txt2img request is untouched", async () => {
        const { result, seen } = await callOnce(null, {});
        assert.ok(seen[0].url.endsWith("/v1/images/generations"), seen[0].url);
        assert.strictEqual(seen[0].body.steps, 20, "nothing trims a txt2img run");
        assert.strictEqual(result.stepsSent, 20);
      });

      test("the Generator's denoise window did not move (0.15–0.75)", () => {
        assert.strictEqual(frontend.planImageSteps({ steps: 20, denoisingStrength: 0.9 }, {}, true).strength, 0.75);
        assert.strictEqual(frontend.planImageSteps({ steps: 20 }, { denoiseGuidance: 0.05 }, true).strength, 0.15);
        assert.strictEqual(frontend.planImageSteps({ steps: 20 }, { denoiseGuidance: 0.5 }, true).strength, 0.5);
        assert.strictEqual(frontend.planImageSteps({ steps: 20, denoisingStrength: 0.5 }, {}, true).strength, 0.5,
          "constraints.denoisingStrength is still read when no reference setting is present");
        assert.strictEqual(frontend.planImageSteps({ steps: 20 }, {}, false).sent, 20, "no init image, no scaling");
      });

      test("the Generator reuses the shared rule instead of keeping a copy of it", () => {
        let compared = 0;
        // 0.15–0.75 is the Generator's own window (it clamps there); inside it,
        // the two entry points have to answer identically to the shared rule.
        for (const steps of [1, 4, 7, 20, 25, 50, 150]) {
          for (let d = 15; d <= 75; d += 5) {
            const denoise = d / 100;
            assert.deepStrictEqual(
              frontend.planImageSteps({ steps }, { denoiseGuidance: denoise }, true),
              shared.planImg2ImgSteps(steps, denoise),
              `steps=${steps} denoise=${denoise}`
            );
            compared += 1;
          }
        }
        assert.ok(compared >= 90, `compared ${compared} cases`);
        const source = fs.readFileSync(FRONTEND_ENTRY, "utf8");
        assert.match(source, /scripts\/server\/img2img-steps\.cjs/, "api.js names the shared module it imports");
        assert.match(source, /steps:\s+img2imgSteps\.sent/, "the img2img body sends the scaled number");
      });

      test("both interfaces can show the two numbers, and the ceiling", () => {
        const drawers = fs.readFileSync(path.join(root, "app", "frontend", "src", "social-agency", "drawers.jsx"), "utf8");
        assert.match(drawers, /job\.stepsSent/, "the entry drawer shows what the request carried");
        assert.match(drawers, /job\.stepsCapped/, "and says when the ceiling made the run short");
        const generator = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "Generator.jsx"), "utf8");
        assert.match(generator, /planImageSteps/, "the Generator plans with the shared rule");
        assert.match(generator, /stepsSent/, "and records what was sent");
        assert.match(generator, /activeTotalSteps/, "the step counter follows the real run, not the requested count");
      });
    }

    for (const [name, fn] of tests) {
      try {
        await fn();
        passed += 1;
        console.log(`  ok - ${name}`);
      } catch (err) {
        console.error(`  FAIL - ${name}\n${err.stack || err}`);
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    rt.setImageSaver(null);
  }

  if (!process.exitCode) console.log(`PASS: ${passed} img2img step-scaling checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
