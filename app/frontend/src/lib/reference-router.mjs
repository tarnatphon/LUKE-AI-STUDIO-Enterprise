/**
 * What a reference image actually *does* in this app, and how it should be prepared.
 *
 * The Reference Manager offers roles, weights and a Denoise Guidance slider, but
 * the only thing that reaches the sampler today is the primary reference sent as
 * an img2img init image. That leaves two questions the user should not have to
 * answer, and this module answers both:
 *
 *   1. Which route is in play? (`planReferenceRoute`) — with an honest label for
 *      the UI, including the routes the pinned engine cannot run yet.
 *   2. Does the init image need preparing? (`planReferenceFit`) — an init image
 *      smaller than the canvas, or with a different aspect, drags the result down
 *      no matter how good the prompt is. Fitting it is the cheapest quality win
 *      that needs no model, no VRAM and no user input.
 *
 * Both functions are pure so the branches can be tested without a browser; the
 * canvas work lives in the component (see `prepareInitImage` in Generator.jsx).
 */

import { matchImageRecipe } from "./image-recipes.mjs";

/** Routes in preference order, best first. `applies` decides what is in play. */
export const REFERENCE_ROUTES = [
  {
    id: "ip-adapter",
    label: "IP-Adapter Plus (ล็อกตัวตนจากรูป)",
    available: false,
    why: "แม่นกว่า img2img มาก แต่ไบนารีที่ปักหมุดไว้ยังไม่มีฟีเจอร์นี้ (Phase B)",
  },
  {
    id: "native-ref-images",
    label: "ref_images ของเอนจิน (แก้ภาพ/หลายภาพอ้างอิง)",
    available: false,
    why: "ต้องโหลดโมเดลแบบหลายไฟล์ก่อน (Phase B) — และต้องยืนยันช่อง <sd_cpp_extra_args> บนไบนารีที่ปักหมุด",
  },
  {
    id: "img2img-init",
    label: "img2img จากภาพอ้างอิงหลัก + ปรับ prompt",
    available: true,
    why: "เส้นทางเดียวที่ทำงานได้จริงบนเอนจินรุ่นปัจจุบัน: โครงภาพและสีตามต้นฉบับ ส่วน prompt ทำหน้าที่ล็อกหน้า/ทรงผม/เสื้อผ้า",
  },
  {
    id: "txt2img",
    label: "สร้างใหม่จากข้อความ (ไม่มีภาพอ้างอิง)",
    available: true,
    why: "ยังไม่มีภาพอ้างอิงที่เปิดใช้งาน",
  },
];

/** The route a set of references will actually take, plus why. */
export function planReferenceRoute({ modelName = "", referenceCount = 0, hasBaseImage = false } = {}) {
  const usable = Math.max(0, Number(referenceCount) || 0);
  if (usable === 0 && !hasBaseImage) {
    return { ...findRoute("txt2img"), referenceCount: 0, modelFamily: matchImageRecipe(modelName)?.id || null };
  }

  const route = findRoute("img2img-init");
  const recipe = matchImageRecipe(modelName);
  // An architecture that runs on ref_images natively (Qwen-Image-Edit, Kontext,
  // Z-Image, FLUX.2) is being used through the img2img fallback purely because the
  // app cannot load its multi-file set yet. Say so, instead of letting the user
  // believe they are getting the model's own reference editing.
  const stopgap = Boolean(recipe?.needsExtraFiles);

  return {
    ...route,
    referenceCount: usable,
    modelFamily: recipe?.id || null,
    stopgap,
    why: stopgap
      ? `${route.why} · โมเดลที่โหลดอยู่ (${recipe.label}) มีเส้นทาง ref_images ของตัวเองแต่ต้องติดตั้งแบบหลายไฟล์ก่อน จึงยังใช้ทางสำรองนี้อยู่`
      : route.why,
  };
}

function findRoute(id) {
  const found = REFERENCE_ROUTES.find((route) => route.id === id);
  return { ...found };
}

/** Tuning for `planReferenceFit`. Overscan keeps a little detail above canvas size. */
export const REFERENCE_FIT = {
  aspectTolerance: 0.12, // 12% — beyond this the init image visibly fights the canvas shape
  overscan: 1.15,        // prepare the init slightly larger than the output
  maxDimension: 2048,    // never build a monster canvas for a 512px output
};

/**
 * How to prepare the init image for a canvas.
 *
 * The `fit` plan *contains* the reference — it is never cropped, because the part
 * a crop would cut off a portrait photo is the top of the head or the chin, which
 * is exactly what the reference is there to preserve. The canvas is filled around
 * it by a blurred, cover-drawn copy of the same photo (the component does that),
 * so the sampler sees no hard letterbox bars.
 *
 * @returns {{mode: "use"|"fit"|"unknown", width:number, height:number,
 *            contain: null|{x:number,y:number,width:number,height:number},
 *            upscaled: boolean, reason: string}}
 *   `use`  — send the reference untouched (same shape, large enough).
 *   `fit`  — draw the whole reference at `contain` on a `width`×`height` canvas
 *            that matches the output aspect, then send that.
 */
export function planReferenceFit(source = {}, target = {}, options = {}) {
  const sw = Math.round(Number(source.width) || 0);
  const sh = Math.round(Number(source.height) || 0);
  const tw = Math.round(Number(target.width) || 0);
  const th = Math.round(Number(target.height) || 0);
  const cfg = { ...REFERENCE_FIT, ...options };

  if (!sw || !sh || !tw || !th) {
    return { mode: "unknown", width: 0, height: 0, contain: null, upscaled: false, reason: "วัดขนาดภาพไม่สำเร็จ" };
  }

  const targetAspect = tw / th;
  const sourceAspect = sw / sh;
  const aspectOff = Math.abs(sourceAspect - targetAspect) / targetAspect;
  const longTarget = Math.max(tw, th);
  const longSource = Math.max(sw, sh);
  const bigEnough = longSource >= longTarget;

  if (aspectOff <= cfg.aspectTolerance && bigEnough) {
    return {
      mode: "use",
      width: sw,
      height: sh,
      contain: null,
      upscaled: false,
      reason: "สัดส่วนตรงกับภาพที่จะสร้างและความละเอียดพอ",
    };
  }

  const longSide = Math.min(cfg.maxDimension, Math.round(longTarget * cfg.overscan));
  const box = aspectBox(tw, th, longSide);
  const contain = containBox(sw, sh, box.width, box.height);

  const reasons = [];
  if (aspectOff > cfg.aspectTolerance) reasons.push(`สัดส่วนต่างจากภาพที่จะสร้าง ${(aspectOff * 100).toFixed(0)}%`);
  if (!bigEnough) reasons.push(`ภาพอ้างอิงเล็กกว่าภาพที่จะสร้าง (${sw}×${sh} → ${tw}×${th})`);

  return {
    mode: "fit",
    width: box.width,
    height: box.height,
    contain,
    upscaled: !bigEnough,
    reason: reasons.join(" · ") || "ปรับให้พอดีกับภาพที่จะสร้าง",
  };
}

/** A `{width, height}` box with the aspect of (w, h) and the given long side. */
function aspectBox(w, h, longSide) {
  return w >= h
    ? { width: Math.round(longSide), height: Math.max(1, Math.round((longSide * h) / w)), longSide: "width" }
    : { width: Math.max(1, Math.round((longSide * w) / h)), height: Math.round(longSide), longSide: "height" };
}

/** Where the whole source lands inside a `dw`×`dh` box, scaled without distortion. */
export function containBox(sw, sh, dw, dh) {
  const scale = Math.min(dw / sw, dh / sh);
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  return { x: Math.round((dw - width) / 2), y: Math.round((dh - height) / 2), width, height, scale };
}

/** One line for the UI chip and the output metadata. */
export function describeReferencePlan(route, fit) {
  const parts = [route?.label || "ไม่ทราบเส้นทาง"];
  if (fit?.mode === "fit") parts.push(`ปรับภาพตั้งต้นให้พอดีแล้ว (${fit.reason})`);
  if (fit?.upscaled) parts.push("ภาพอ้างอิงเล็กกว่าภาพที่จะสร้าง — รายละเอียดอาจไม่ขึ้น");
  return parts.join(" · ");
}
