"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const support = require("../server/image-diffusion-support.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-qwen-image-21-"));
const modelsDir = path.join(root, "models");
const llmModelsDir = path.join(root, "llm-models");
const modelPath = path.join(modelsDir, "Qwen-Image-2.1-Turbo-Uncensored-AD-Q6_K.gguf");

try {
  const vaePath = path.join(modelsDir, "vae", "qwen_image_2.1_vae_bf16.safetensors");
  const encoderPath = path.join(llmModelsDir, "diffusion-encoders", "Qwen3VL-8B-Instruct-Q4_K_M.gguf");
  const visionPath = path.join(llmModelsDir, "diffusion-encoders", "mmproj-Qwen3VL-8B-Instruct-F16.gguf");

  assert.equal(support.classifyImageModel(modelPath), support.QWEN_IMAGE_21_TURBO);
  assert.equal(support.classifyImageModel("sd_xl_base_1.0.safetensors"), "checkpoint");
  assert.equal(support.classifyImageModel("flux-dev-Q5_K.gguf"), "multi-component-diffusion");

  let plan = support.resolveImageModel({ modelPath, modelsDir, llmModelsDir });
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.missing, ["Qwen Image 2.1 VAE", "Qwen3-VL-8B-Instruct text encoder"]);
  assert.match(support.loadIssue(plan), /Model Manager.*Qwen Image 2\.1 Components/);
  assert.throws(() => support.buildModelComponentArgs(plan, modelPath), /not a complete checkpoint/);

  fs.mkdirSync(path.dirname(vaePath), { recursive: true });
  fs.mkdirSync(path.dirname(encoderPath), { recursive: true });
  fs.writeFileSync(vaePath, "vae");
  fs.writeFileSync(encoderPath, "encoder");

  plan = support.resolveImageModel({ modelPath, modelsDir, llmModelsDir });
  assert.equal(plan.ready, true);
  assert.equal(plan.components.vae, vaePath);
  assert.equal(plan.components.llm, encoderPath);
  assert.equal(plan.components.llmVision, "");

  let args = support.buildModelComponentArgs(plan, modelPath);
  assert.deepEqual(args, ["--diffusion-model", modelPath, "--vae", vaePath, "--llm", encoderPath]);
  assert.equal(args.includes("--model"), false);

  fs.writeFileSync(visionPath, "vision");
  plan = support.resolveImageModel({ modelPath, modelsDir, llmModelsDir });
  args = support.buildModelComponentArgs(plan, modelPath);
  assert.deepEqual(args.slice(-2), ["--llm_vision", visionPath]);

  assert.equal(support.supportsMultiFileDiffusionFlags("--diffusion-model PATH --vae PATH --llm PATH"), true);
  assert.equal(support.supportsMultiFileDiffusionFlags("--diffusion-model PATH --vae PATH --llm_vision PATH"), false);

  const fakeBackend = path.join(root, "sd-server");
  fs.writeFileSync(fakeBackend, "test binary placeholder");
  assert.equal(support.backendSupportsMultiFileDiffusion(fakeBackend, {
    spawnSync: () => ({ stdout: "--diffusion-model PATH --vae PATH --llm PATH", stderr: "" }),
  }), true);
  assert.equal(support.backendSupportsMultiFileDiffusion(fakeBackend, {
    spawnSync: () => ({ stdout: "--model PATH --vae PATH", stderr: "" }),
  }), false);

  const serveSource = fs.readFileSync(path.join(__dirname, "..", "server", "serve.cjs"), "utf8");
  const frontendApiSource = fs.readFileSync(path.join(__dirname, "..", "..", "app", "frontend", "src", "services", "api.js"), "utf8");
  const serverBuild = serveSource.match(/const SERVER_BUILD = "([^"]+)";/)?.[1];
  const expectedFrontendBuild = frontendApiSource.match(/EXPECTED_SERVER_BUILD = "([^"]+)";/)?.[1];
  assert.equal(serverBuild, "text-image-v6-llm-recovery", "the Qwen Turbo sigma compatibility fix changes the API build contract");
  assert.equal(expectedFrontendBuild, serverBuild, "the frontend must detect a stale pre-Qwen server");
  assert.match(serveSource, /imageDiffusionSupport\.buildModelComponentArgs\(imageModelPlan, imageLoadPath\)/);
  assert.match(serveSource, /backendSupportsMultiFileDiffusion\(backendPath\)/);
  assert.match(serveSource, /"--sigmas", "1\.0,0\.978453,0\.95418,0\.926626,0\.89508,0\.845148,0\.704534,0\.414568,0\.0"/);
  assert.match(serveSource, /currentSettings\.steps = 8;[\s\S]{0,120}?currentSettings\.cfgScale = 1;[\s\S]{0,120}?currentSettings\.sampler = "euler";/);

  const setupSh = fs.readFileSync(path.join(__dirname, "..", "setup", "setup.sh"), "utf8");
  const setupPs = fs.readFileSync(path.join(__dirname, "..", "setup", "setup.ps1"), "utf8");
  assert.match(setupSh, /SD_RELEASE="master-1043-3be2378"/);
  assert.match(setupSh, /backend_supports_multi_file_diffusion/);
  assert.match(setupSh, /mv "\$legacy_file" "\$legacy_file\.legacy-\$LEGACY_SUFFIX"/);
  assert.match(setupPs, /master-1043-3be2378/);
  assert.match(setupPs, /Test-MultiFileDiffusionBackend/);
  assert.match(setupPs, /function Move-LegacyCudaBackendFiles/);

  const status = support.getComponentStatus({ modelsDir, llmModelsDir });
  assert.equal(status["qwen-image-21-vae"].installed, true);
  assert.equal(status["qwen-image-21-llm"].installed, true);
  assert.equal(status["qwen-image-21-vision"].installed, true);
  assert.equal(support.getComponentTarget("qwen-image-21-vae", { modelsDir, llmModelsDir }), path.join(modelsDir, "vae"));
  assert.equal(support.getComponentTarget("qwen-image-21-llm", { modelsDir, llmModelsDir }), path.join(llmModelsDir, "diffusion-encoders"));
  assert.equal(support.getComponentDefinition("unknown"), null);

  console.log("Qwen Image 2.1 multi-file support tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
