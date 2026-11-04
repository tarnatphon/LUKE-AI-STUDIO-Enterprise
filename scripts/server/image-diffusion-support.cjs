"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: defaultSpawnSync } = require("node:child_process");

const QWEN_IMAGE_21_TURBO = "qwen-image-21-turbo";
const COMPONENT_DEFINITIONS = Object.freeze({
  "qwen-image-21-vae": Object.freeze({
    id: "qwen-image-21-vae",
    kind: "vae",
    filename: "qwen_image_2.1_vae_bf16.safetensors",
    label: "Qwen Image 2.1 VAE",
    target: "models-vae",
    required: true,
  }),
  "qwen-image-21-llm": Object.freeze({
    id: "qwen-image-21-llm",
    kind: "llm",
    filename: "Qwen3VL-8B-Instruct-Q4_K_M.gguf",
    label: "Qwen3-VL 8B text encoder",
    target: "llm-diffusion-encoders",
    required: true,
  }),
  "qwen-image-21-vision": Object.freeze({
    id: "qwen-image-21-vision",
    kind: "vision",
    filename: "mmproj-Qwen3VL-8B-Instruct-F16.gguf",
    label: "Qwen3-VL vision projector",
    target: "llm-diffusion-encoders",
    required: false,
  }),
});

function normalizedName(value) {
  return path.basename(String(value || "")).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function classifyImageModel(modelPath) {
  const name = normalizedName(modelPath);
  if (name.includes("qwenimage21turbo")) return QWEN_IMAGE_21_TURBO;

  const lower = path.basename(String(modelPath || "")).toLowerCase();
  if (/\.(?:gguf|safetensors|ckpt)$/i.test(lower) && (
    lower.includes("z_image") || lower.includes("z-image") || lower.includes("zimage") ||
    lower.includes("qwen") || lower.includes("hidream") || lower.includes("hunyuan") ||
    lower.includes("wan") || lower.includes("flux")
  )) {
    return "multi-component-diffusion";
  }
  return "checkpoint";
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function modelFilesUnder(root, { maxDepth = 5 } = {}) {
  const files = [];
  const resolvedRoot = path.resolve(String(root || ""));
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return files;

  const pending = [{ dir: resolvedRoot, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.endsWith(".part") || entry.name.startsWith(".")) continue;
      const fullPath = path.join(current.dir, entry.name);
      if (!isInside(resolvedRoot, fullPath)) continue;
      // Do not follow symlinks in a model root. Apart from avoiding loops, this
      // keeps a component lookup from silently escaping its configured folder.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) pending.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile() && /\.(?:gguf|safetensors)$/i.test(entry.name)) files.push(fullPath);
    }
  }
  return files;
}

function preferCandidates(candidates, scores) {
  return candidates
    .map((filePath) => {
      const name = normalizedName(filePath);
      let score = 0;
      for (const [pattern, value] of scores) {
        if (pattern.test(name)) score += value;
      }
      return { filePath, score };
    })
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))[0]?.filePath || "";
}

function uniqueExistingRoots(roots) {
  return [...new Set(roots.filter(Boolean).map((root) => path.resolve(root)))];
}

function findQwenVae(modelsDir) {
  const roots = uniqueExistingRoots([
    path.join(modelsDir || "", "vae"),
    path.join(modelsDir || "", "diffusion-components", "vae"),
    modelsDir,
  ]);
  const candidates = roots.flatMap((root) => modelFilesUnder(root))
    .filter((filePath) => /\.safetensors$/i.test(filePath))
    .filter((filePath) => {
      const name = normalizedName(filePath);
      return name.includes("qwenimage21") && name.includes("vae");
    });
  return preferCandidates(candidates, [
    [/qwenimage21vaebf16/, 100],
    [/qwenimage21vae/, 50],
  ]);
}

function findQwenEncoder({ modelsDir, llmModelsDir } = {}) {
  const roots = uniqueExistingRoots([
    path.join(llmModelsDir || "", "diffusion-encoders"),
    path.join(modelsDir || "", "text_encoders"),
    llmModelsDir,
  ]);
  const candidates = roots.flatMap((root) => modelFilesUnder(root))
    .filter((filePath) => !/mmproj/i.test(path.basename(filePath)))
    .filter((filePath) => {
      const name = normalizedName(filePath);
      return name.includes("qwen3vl") && /\.(?:gguf|safetensors)$/i.test(filePath);
    });
  return preferCandidates(candidates, [
    [/qwen3vl8binstructq4km/, 100],
    [/qwen3vl8binstructq[345]/, 80],
    [/qwen3vl8binstruct/, 60],
    [/qwen3vl/, 40],
  ]);
}

function findQwenVisionProjector({ modelsDir, llmModelsDir } = {}) {
  const roots = uniqueExistingRoots([
    path.join(llmModelsDir || "", "diffusion-encoders"),
    path.join(modelsDir || "", "text_encoders"),
    llmModelsDir,
  ]);
  const candidates = roots.flatMap((root) => modelFilesUnder(root))
    .filter((filePath) => {
      const name = normalizedName(filePath);
      return name.includes("mmproj") && name.includes("qwen3vl") && /\.gguf$/i.test(filePath);
    });
  return preferCandidates(candidates, [
    [/mmprojqwen3vl8binstructf16/, 100],
    [/mmprojqwen3vl.*f16/, 80],
    [/mmprojqwen3vl/, 60],
  ]);
}

function resolveImageModel({ modelPath, modelsDir, llmModelsDir } = {}) {
  const kind = classifyImageModel(modelPath);
  if (kind !== QWEN_IMAGE_21_TURBO) return { kind, modelPath: String(modelPath || ""), components: null };

  const components = {
    vae: findQwenVae(modelsDir),
    llm: findQwenEncoder({ modelsDir, llmModelsDir }),
    llmVision: findQwenVisionProjector({ modelsDir, llmModelsDir }),
  };
  const missing = [];
  if (!components.vae) missing.push("Qwen Image 2.1 VAE");
  if (!components.llm) missing.push("Qwen3-VL-8B-Instruct text encoder");
  return {
    kind,
    modelPath: String(modelPath || ""),
    components,
    missing,
    ready: missing.length === 0,
  };
}

function loadIssue(plan, filename = path.basename(String(plan?.modelPath || ""))) {
  if (!plan) return null;
  if (plan.kind === QWEN_IMAGE_21_TURBO) {
    if (plan.missing?.length) {
      const absent = plan.missing.join(" and ");
      return `${filename} is a Qwen Image 2.1 Turbo diffusion component, not a complete checkpoint. Download the matching ${absent} from Model Manager → Image Models → Qwen Image 2.1 Components, or place them in app/models/vae/ and app/llm-models/diffusion-encoders/. The Qwen 2.1 VAE is not interchangeable with older Qwen Image or Wan VAEs.`;
    }
    return null;
  }
  if (plan.kind === "multi-component-diffusion") {
    return `${filename} looks like a multi-file diffusion component. LUKE can load Qwen Image 2.1 Turbo with its VAE and Qwen3-VL text encoder; other multi-file families such as Flux, Z-Image, HiDream, Hunyuan, and Wan still need their own model recipe and are not standalone checkpoints.`;
  }
  return null;
}

function buildModelComponentArgs(plan, loadPath = plan?.modelPath) {
  if (plan?.kind !== QWEN_IMAGE_21_TURBO) return ["--model", loadPath];
  if (!plan.ready || !plan.components?.vae || !plan.components?.llm) {
    throw new Error(loadIssue(plan) || "Qwen Image 2.1 model components are incomplete.");
  }
  const args = [
    "--diffusion-model", loadPath,
    "--vae", plan.components.vae,
    "--llm", plan.components.llm,
  ];
  if (plan.components.llmVision) args.push("--llm_vision", plan.components.llmVision);
  return args;
}

function supportsMultiFileDiffusionFlags(helpOutput) {
  const text = String(helpOutput || "");
  return /--diffusion-model\b/.test(text) && /--vae\b/.test(text) && /--llm\b/.test(text);
}

function backendSupportsMultiFileDiffusion(binaryPath, { spawnSync = defaultSpawnSync, env = process.env, timeout = 8000 } = {}) {
  if (!binaryPath || !fs.existsSync(binaryPath)) return false;
  try {
    const result = spawnSync(binaryPath, ["--help"], {
      encoding: "utf8",
      timeout,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return supportsMultiFileDiffusionFlags(`${result?.stdout || ""}\n${result?.stderr || ""}`);
  } catch {
    return false;
  }
}

function getComponentDefinition(componentId) {
  return COMPONENT_DEFINITIONS[String(componentId || "")] || null;
}

function getComponentTarget(componentId, { modelsDir, llmModelsDir } = {}) {
  const definition = getComponentDefinition(componentId);
  if (!definition) return null;
  if (definition.target === "models-vae") return path.join(modelsDir, "vae");
  if (definition.target === "llm-diffusion-encoders") return path.join(llmModelsDir, "diffusion-encoders");
  return null;
}

function getComponentStatus({ modelsDir, llmModelsDir } = {}) {
  const plan = resolveImageModel({
    modelPath: "Qwen-Image-2.1-Turbo.gguf",
    modelsDir,
    llmModelsDir,
  });
  return {
    "qwen-image-21-vae": {
      ...COMPONENT_DEFINITIONS["qwen-image-21-vae"],
      installed: Boolean(plan.components.vae),
      path: plan.components.vae || "",
    },
    "qwen-image-21-llm": {
      ...COMPONENT_DEFINITIONS["qwen-image-21-llm"],
      installed: Boolean(plan.components.llm),
      path: plan.components.llm || "",
    },
    "qwen-image-21-vision": {
      ...COMPONENT_DEFINITIONS["qwen-image-21-vision"],
      installed: Boolean(plan.components.llmVision),
      path: plan.components.llmVision || "",
    },
  };
}

module.exports = {
  COMPONENT_DEFINITIONS,
  QWEN_IMAGE_21_TURBO,
  backendSupportsMultiFileDiffusion,
  buildModelComponentArgs,
  classifyImageModel,
  getComponentDefinition,
  getComponentStatus,
  getComponentTarget,
  loadIssue,
  modelFilesUnder,
  resolveImageModel,
  supportsMultiFileDiffusionFlags,
};
