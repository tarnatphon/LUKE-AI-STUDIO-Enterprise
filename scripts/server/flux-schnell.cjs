"use strict";
// Fixed recipes: never accept arbitrary paths or URLs from the install request.
const base = "https://huggingface.co/";
const components = [
  { id: "flux-clip-l", kind: "clip_l", filename: "clip_l.safetensors", target: "llm-diffusion-encoders", url: base + "comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors" },
  { id: "flux-t5", kind: "t5xxl", filename: "t5-v1_1-xxl-encoder-Q5_K_M.gguf", target: "llm-diffusion-encoders", url: base + "city96/t5-v1_1-xxl-encoder-gguf/resolve/main/t5-v1_1-xxl-encoder-Q5_K_M.gguf" },
  { id: "flux-vae", kind: "vae", filename: "ae.safetensors", target: "models-vae", url: base + "black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors" },
];
const variants = {
  q4: { filename: "flux1-schnell-Q4_0.gguf", sizeGb: 12, label: "Q4_0", minRam: 24 },
  q8: { filename: "flux1-schnell-Q8_0.gguf", sizeGb: 18, label: "Q8_0", minRam: 48 },
};
function assessHardware(specs = {}) {
  const ram = Number(specs.ram_total_gb) || 0;
  const vram = Number(specs.gpu_vram_gb) || 0;
  const unified = /apple|\bm[1-9]\b/i.test(`${specs.cpu_name || ""} ${specs.gpu_name || ""}`);
  if (!ram) return { variant: null, reason: "ยังตรวจ RAM ไม่ได้ — กรุณาตรวจฮาร์ดแวร์ก่อน", unified };
  if (ram < 24) return { variant: null, reason: "แนะนำ SD 1.5/SDXL แทน: FLUX พร้อม encoders ต้องการ RAM อย่างน้อย 24 GB ตามเกณฑ์ประมาณการ", unified };
  const variant = ram >= 48 && (unified || vram >= 20) ? "q8" : "q4";
  return { variant, unified, reason: `${unified ? "Unified memory" : "RAM"} ${ram} GB${unified ? " (ไม่นับ VRAM ซ้ำ)" : ` / VRAM ${vram} GB`}: แนะนำ ${variants[variant].label}. ${!unified && vram < 12 ? "อาจต้อง offload ไป CPU และทำงานช้า. " : ""}เป็นการประมาณ ไม่รับประกันว่าจะไม่เกิด OOM; ปิดโมเดลอื่นก่อนโหลด` };
}
function recipe(variant) {
  const model = Object.hasOwn(variants, variant) ? variants[variant] : null;
  if (!model) return null;
  return [{ ...model, id: `flux-${variant}`, target: "models", url: base + `city96/FLUX.1-schnell-gguf/resolve/main/${model.filename}` }, ...components];
}
module.exports = { components, variants, assessHardware, recipe };
