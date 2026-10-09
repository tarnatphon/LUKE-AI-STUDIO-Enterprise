/**
 * Recommended generation settings per model family.
 *
 * Most "the picture came out wrong" reports from a local Stable Diffusion UI are
 * not the model's fault: a Lightning/Turbo checkpoint at 28 steps and CFG 7
 * burns the image, and a standard SDXL checkpoint at 4 steps and CFG 1 comes
 * back as mush. The app's defaults are a single global pair (4 steps / CFG 1,
 * chosen for Flux-schnell-style models), so whichever checkpoint is loaded, one
 * of the two mistakes is waiting.
 *
 * This module holds the recipe per family: the values the model was trained to
 * be sampled with. It is deliberately *advisory* — `recipePlan` reports what it
 * would change, and the UI offers one button. Nothing is applied behind the
 * user's back, because a silently rewritten slider is worse than a wrong one.
 *
 * Values come from each model's own card (see docs/research/2026-10-08-…):
 * step-distilled models run at 4–8 steps with guidance off, full SDXL/SD1.5
 * checkpoints at 26–30 steps with CFG 5–7, Qwen-Image at CFG 2.5, and LCM at
 * 4–8 steps.
 */

/** The sampler names the backend accepts (kept in step with WorkflowBuilder). */
export const IMAGE_SAMPLERS = [
  "euler_a",
  "euler",
  "heun",
  "dpm2",
  "dpm++2s_a",
  "dpm++2m",
  "dpm++2m_sde",
  "lcm",
];

/**
 * Families, most specific first: the first match wins, so "juggernaut-xl-lightning"
 * lands on the Lightning recipe rather than the plain SDXL one.
 *
 * `needsExtraFiles` marks architectures that a single-file load cannot run yet —
 * the app knows this (see the model-load issue text in serve.cjs) and the UI says
 * so rather than pretending the recipe can be used today.
 */
export const IMAGE_RECIPES = [
  {
    id: "z-image",
    label: "Z-Image / Z-Image Turbo",
    keywords: ["z-image", "zimage", "z_image"],
    steps: 8,
    cfgScale: 1,
    sampler: "euler_a",
    note: "8 steps, CFG 1 — อย่าดัน CFG เพื่อ 'แก้' prompt",
    needsExtraFiles: true,
  },
  {
    id: "qwen-image",
    label: "Qwen-Image / Qwen-Image-Edit",
    keywords: ["qwen", "edit-2509", "edit-2511"],
    steps: 20,
    cfgScale: 2.5,
    sampler: "euler",
    note: "Qwen-Image ใช้ CFG 2.5 + flow-shift 3",
    needsExtraFiles: true,
  },
  {
    id: "flux-schnell",
    label: "FLUX.1 schnell / FLUX.2 klein",
    keywords: ["schnell", "klein", "flux-2", "flux2"],
    steps: 4,
    cfgScale: 1,
    sampler: "euler_a",
    note: "โมเดล step-distilled: 4 steps และปิด guidance (CFG 1)",
  },
  {
    id: "flux-dev",
    label: "FLUX.1 dev / Kontext",
    keywords: ["flux", "kontext"],
    steps: 20,
    cfgScale: 1,
    sampler: "euler",
    note: "FLUX ใช้ CFG 1 เท่านั้น; Kontext ต้องตั้ง CFG = 1 ไม่งั้นภาพเสีย",
    needsExtraFiles: true,
  },
  {
    id: "lcm",
    label: "LCM / LCM-LoRA",
    keywords: ["lcm"],
    steps: 6,
    cfgScale: 1.5,
    sampler: "lcm",
    note: "ใช้ sampler lcm และ CFG ต่ำ — CFG สูงจะได้ภาพแตก",
  },
  {
    id: "sdxl-lightning",
    label: "SDXL Lightning / Turbo / Hyper",
    // "turbo" also appears in Z-Image Turbo and "lightning" in FLUX LoRAs, so the
    // earlier families win first and these words are the last resort.
    keywords: ["lightning", "turbo", "hyper", "dmd", "sdxl-lightning", "flash"],
    exclude: ["z-image", "zimage", "qwen", "flux", "klein", "schnell"],
    steps: 6,
    cfgScale: 1.5,
    sampler: "euler_a",
    note: "ขั้นตอนถูกกลั่นมาแล้ว: เกิน 8 steps จะยิ่งไหม้ ไม่ต้องเพิ่ม CFG",
  },
  {
    id: "sdxl",
    label: "SDXL (มาตรฐาน)",
    // No bare "dreamshaper" here: DreamShaper 8 is an SD 1.5 checkpoint, and the
    // SDXL releases all carry "XL" in their name anyway.
    keywords: ["sdxl", "xl", "juggernaut", "realvis", "pony", "illustrious"],
    steps: 26,
    cfgScale: 6,
    sampler: "dpm++2m",
    note: "SDXL ให้รายละเอียดเต็มที่ราว 25–30 steps, CFG 5–7",
  },
  {
    id: "sd15",
    label: "SD 1.5",
    keywords: ["sd15", "v1-5", "1-5", "1.5", "rev-animated", "cyberrealistic", "dreamshaper", "anything", "meinamix"],
    steps: 28,
    cfgScale: 7,
    sampler: "dpm++2m",
    note: "SD 1.5 ทำงานที่ 512–768px; 28 steps CFG 7 คือค่ามาตรฐาน",
  },
];

/**
 * The comparable key for a model file: `Juggernaut-XL-v9.safetensors` →
 * `juggernaut-xl-v9`, with the directory part dropped on both separators so a
 * Windows path from a Windows backend behaves like a POSIX one.
 *
 * The extension may be long (`safetensors` is eleven characters), and a version
 * suffix such as `v1.5` is *not* an extension: it is one character after the
 * dot, and stripping it would turn a real version into a different model.
 */
export function normalizeModelKey(modelName) {
  return String(modelName || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z][a-z0-9]{1,11}$/i, "")
    .toLowerCase();
}

/**
 * The recipe for a model file, or null when the family is unknown.
 *
 * Order matters, and so does `exclude`: "turbo" describes a Z-Image Turbo, an
 * SDXL Turbo and an SD1.5 Turbo checkpoint alike, so a family that owns the word
 * is matched before the generic one, and the generic one refuses names that
 * belong to a family already handled.
 */
export function matchImageRecipe(modelName) {
  const key = normalizeModelKey(modelName);
  if (!key) return null;
  for (const recipe of IMAGE_RECIPES) {
    if (recipe.exclude && recipe.exclude.some((keyword) => key.includes(keyword))) continue;
    if (recipe.keywords.some((keyword) => key.includes(keyword))) return recipe;
  }
  return null;
}

/** Only the keys a recipe is allowed to speak about. */
const RECIPE_KEYS = ["steps", "cfgScale", "sampler"];

/**
 * What applying a recipe would change.
 *
 * @param {object|null} recipe        from `matchImageRecipe`
 * @param {object} constraints        the app's current constraints
 * @returns {null|{recipe:object, patch:object, changedKeys:string[], alreadyMatches:boolean, note:string}}
 */
export function recipePlan(recipe, constraints = {}) {
  if (!recipe) return null;

  const patch = {};
  const changedKeys = [];

  for (const key of RECIPE_KEYS) {
    const current = constraints[key];
    const wanted = recipe[key];
    if (wanted === undefined) continue;
    const same =
      key === "sampler"
        ? String(current || "") === String(wanted)
        : Number(current) === Number(wanted);
    if (!same) {
      patch[key] = wanted;
      changedKeys.push(key);
    }
  }

  const baseNote = recipe.note || "";
  const note = recipe.needsExtraFiles
    ? `${baseNote} · ต้องติดตั้งโมเดลแบบหลายไฟล์ก่อน (Phase B)`
    : baseNote;

  return {
    recipe,
    patch,
    changedKeys,
    alreadyMatches: changedKeys.length === 0,
    note,
  };
}

/** `{steps: 26, cfgScale: 6}` → `"steps 26 · CFG 6"`, for a button label. */
export function describeRecipePatch(patch = {}) {
  const labels = { steps: "steps", cfgScale: "CFG", sampler: "sampler" };
  return Object.keys(labels)
    .filter((key) => patch[key] !== undefined)
    .map((key) => `${labels[key]} ${patch[key]}`)
    .join(" · ");
}
