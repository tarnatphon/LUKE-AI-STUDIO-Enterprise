// Luke Social Agency — shared helpers, constants, Bangkok-time utilities
export async function api(url, options) {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error("Local Social Agency runtime is unavailable.");
  }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export function postJson(url, body, method = "POST") {
  return api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}

export const STATUS_META = {
  planned: { label: "วางแผนไว้", cls: "planned" },
  in_workflow: { label: "กำลังรัน", cls: "in-workflow" },
  ready: { label: "พร้อมโพสต์", cls: "ready" },
  publishing: { label: "กำลังเผยแพร่", cls: "publishing" },
  published: { label: "เผยแพร่แล้ว", cls: "published" },
  failed: { label: "ล้มเหลว", cls: "failed" },
  needs_review: { label: "รออนุมัติ", cls: "needs-review" },
  missed: { label: "พลาดโพสต์", cls: "missed" },
  rejected: { label: "ยกเลิกแล้ว", cls: "rejected" },
};

export const PLATFORM_META = {
  demo: { label: "เว็บ (Demo)", short: "WEB", cls: "demo" },
  facebook: { label: "Facebook", short: "f", cls: "facebook" },
  instagram: { label: "Instagram", short: "IG", cls: "instagram" },
  line: { label: "LINE", short: "LINE", cls: "line" },
  tiktok: { label: "TikTok", short: "TT", cls: "tiktok" },
  linkedin: { label: "LinkedIn", short: "in", cls: "linkedin" },
};

export const TONES = ["เจ้าของแบรนด์", "แอดมินเพจ", "พนักงานขาย"];
export const ANGLES = ["เปิดตัวสินค้า", "เบื้องหลังการผลิต", "เคล็ดลับการใช้งาน", "เรื่องจากลูกค้า", "โปรโมชัน/ข้อเสนอ OEM"];
export const NODE_KEYS = ["schedule", "research", "brief", "create", "check", "autofix", "score", "gate", "publish", "result"];
export const NODE_LABELS = {
  schedule: "ตั้งเวลา",
  research: "วิจัย",
  brief: "ร่าง Brief",
  create: "เขียนคอนเทนต์",
  check: "AI Check",
  autofix: "แก้อัตโนมัติ",
  score: "คะแนนไวรัล",
  gate: "ประตูอนุมัติ",
  publish: "เผยแพร่",
  result: "ผลลัพธ์",
};
export const NODE_STATUS_TH = {
  idle: "รอสั่ง",
  running: "กำลังรัน",
  done: "เสร็จแล้ว",
  failed: "ล้มเหลว",
  waiting: "รออนุมัติ",
};

const bangkokFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
const bangkokTimeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });

export function bangkokToday() {
  return bangkokFormatter.format(new Date());
}
export function bangkokNowTime() {
  return bangkokTimeFormatter.format(new Date());
}
export function currentMonth() {
  return bangkokToday().slice(0, 7);
}

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

export function thaiMonthLabel(monthStr) {
  const [y, m] = String(monthStr || currentMonth()).split("-").map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

// Build a Mon-first month matrix of date strings ("YYYY-MM-DD" or null)
export function monthMatrix(monthStr) {
  const [y, m] = String(monthStr || currentMonth()).split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(monthStr, delta) {
  const [y, m] = String(monthStr).split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function dayNumber(dateStr) {
  return Number(String(dateStr).slice(8, 10));
}

export function weekdayTh(dateStr) {
  const names = ["จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์", "อาทิตย์"];
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return names[(new Date(y, m - 1, d).getDay() + 6) % 7];
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function timeUntil(isoString, fromMs = Date.now()) {
  if (!isoString) return null;
  const diff = Date.parse(isoString) - fromMs;
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return "กำลังจะถึง";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
  const d = Math.floor(h / 24);
  return `${d} วัน`;
}

export function formatDateTimeTh(isoString) {
  if (!isoString) return "-";
  try {
    return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(isoString));
  } catch {
    return String(isoString);
  }
}

export function scoreClass(score) {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 80) return "good";
  if (score >= 60) return "mid";
  return "bad";
}

export function entriesOfMonth(entries, monthStr) {
  return (entries || []).filter((e) => e.date && e.date.startsWith(monthStr));
}

export function hasActiveWork(state) {
  return Boolean(
    state?.clients?.some(
      (c) =>
        (c.calendar || []).some((e) => e.inFlight || e.status === "in_workflow" || e.status === "publishing" || e.imageJob?.status === "running" || e.videoJob?.status === "running") ||
        (c.workflowRuns || []).some((r) => r.status === "running")
    )
  );
}

// ── product photo conditioning (see imageJob.refMode in the runtime) ────────
export const PRODUCT_REF_MODE_LABEL = {
  img2img: "img2img — ใช้รูปสินค้าเป็นภาพตั้งต้น (แนะนำ)",
  reference: "reference_images — วิธีเดิม (backend อาจไม่ใช้รูปสินค้า)",
  none: "ไม่มีรูปสินค้าอ้างอิง",
  off: "ปิดการใช้รูปอ้างอิงไว้ในการตั้งค่า",
};

// What an operator has to know before trusting a calendar image, derived from
// the job record the runtime wrote. `img2img` is the only mode where the
// backend was forced to paint over the real product, so it reports nothing.
// Returns null when there is nothing to say (or the job is still running).
export function productRefNotice(entry) {
  const job = entry?.imageJob;
  if (!job || job.status === "running" || !job.status || job.status === "idle") return null;
  if (job.warning) return { level: "warn", mode: job.refMode, text: job.warning };
  switch (job.refMode) {
    case "img2img":
      return null;
    case "reference":
      return {
        level: "warn",
        mode: job.refMode,
        text: "ภาพนี้ส่งรูปสินค้าแบบ reference_images (วิธีเดิม) ซึ่ง backend อาจไม่ใช้ — ตรวจภาพเทียบรูปสินค้าจริงก่อนอนุมัติ",
      };
    case "none":
      return {
        level: "warn",
        mode: job.refMode,
        text: "สินค้านี้ยังไม่มีรูปอ้างอิงในระบบ — ภาพอาจไม่ตรงสินค้า ดึงรูปจากเว็บที่แท็บสินค้าก่อนสร้างใหม่",
      };
    case "off":
      return { level: "info", mode: job.refMode, text: "ปิดการใช้รูปสินค้าอ้างอิงไว้ในการตั้งค่า — ภาพนี้ไม่ได้สร้างจากรูปสินค้า" };
    default:
      // No refMode at all: the image was generated before this was recorded, so
      // its provenance is unknown — exactly the case where a wrong product can
      // slip through a review that trusts the picture.
      return {
        level: "warn",
        mode: "",
        text: "ภาพนี้สร้างก่อนอัปเดตโหมด img2img — ไม่รู้ว่าใช้รูปสินค้าอ้างอิงหรือไม่ ควรตรวจเทียบรูปสินค้าจริงก่อนอนุมัติ",
      };
  }
}

// What still stands between this approval card and a real send.
//
// The approval queue used to offer "อนุมัติและเผยแพร่" on a post whose image had
// never been reviewed. The workflow parks such a post (correctly — the gate is
// the point), but the card looks exactly the same afterwards, so pressing the
// button again looks like nothing happened. The queue needs to know, before the
// click, that the image review is the missing step, and that the post's own time
// has already passed (with dry-run off, approving then sends immediately).
export function approvalBlock(entry, client, nowMs = Date.now()) {
  const gate = entry?.imageGate || null;
  const platform = entry?.platform || "";
  const meta = client?.connectors?.[platform] || null;
  const dueMs = Date.parse(`${entry?.date || ""}T${String(entry?.time || "00:00").slice(0, 5)}:00+07:00`);
  return {
    blocked: Boolean(gate?.required && !gate?.ok),
    status: gate?.status || "",
    reason: gate?.reason || "",
    // Only "dryRun === false" is a live connector: a missing flag is the default
    // (dry-run on), and claiming otherwise would panic people unnecessarily.
    live: meta ? meta.dryRun === false : false,
    overdue: Number.isFinite(dueMs) && dueMs <= nowMs,
    dueMs: Number.isFinite(dueMs) ? dueMs : null,
  };
}

export function clientMonthlyCounts(client, monthStr) {
  const entries = entriesOfMonth(client?.calendar || [], monthStr || currentMonth());
  return {
    scheduled: entries.filter((e) => ["planned", "in_workflow", "ready", "publishing"].includes(e.status)).length,
    awaiting: entries.filter((e) => e.status === "needs_review").length,
    published: entries.filter((e) => e.status === "published").length,
    failed: entries.filter((e) => ["failed", "missed"].includes(e.status)).length,
  };
}

// ── รูปสินค้าจริงแนบไปกับโพสต์ Facebook (500px) ──
// The server stays dependency-free, so the 500px long-edge derivative of the
// product photo is produced here with the browser canvas and cached on disk as
// <sku>.ref500.jpg next to the original. Nothing else about the photo changes.
export const PRODUCT_REF_POST_EDGE = 500;

export async function ensureProductRef500(clientId, product) {
  if (!clientId || !product?.sku) return null;
  const image = String(product.image || "");
  if (!image.startsWith("/sa-products/")) return null; // nothing local to derive from
  const qs = `clientId=${encodeURIComponent(clientId)}&sku=${encodeURIComponent(product.sku)}`;
  let status = null;
  try {
    const res = await api(`/api/social-agency/products/ref-image-500?${qs}`);
    status = res;
  } catch {
    return null; // server not reachable / product without a local photo yet
  }
  if (!status || status.exists) return status || null;
  // Derive the ≤500px JPEG with canvas: scale the long edge down, keep the
  // aspect ratio, never upscale, no other edits. Images already ≤500px are
  // drawn 1:1 (scale = 1) so <sku>.ref500.jpg always exists on disk.
  const img = new Image();
  img.src = `${image}${image.includes("?") ? "&" : "?"}t=${Date.now()}`;
  await img.decode();
  const long = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
  if (!long) return null;
  const scale = Math.min(1, PRODUCT_REF_POST_EDGE / long);
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปที่ย่อแล้วไม่ได้"));
    reader.readAsDataURL(blob);
  });
  try {
    return await postJson(`/api/social-agency/products/ref-image-500?${qs}`, { sku: product.sku, dataUrl });
  } catch {
    return null; // the publish path falls back to the original photo + a note
  }
}

/* ── client intake ────────────────────────────────────────────────────────────
 * A new client is planned entirely from its own product: the product name goes
 * into captions, and its English name goes into every image prompt. So intake is
 * the one place where a vague answer costs the whole month ("สินค้า" produces 30
 * posts about nothing). The rules live here, once, so the form, the error text
 * under it and the tests all read from the same list.
 */

// Whole-word only: a real name such as "สินค้าทดสอบ A-001" is fine, the bare
// category word is not.
const VAGUE_PRODUCT_NAME = /^(?:สินค้า|ของ|ของใช้|ของฝาก|ของขวัญ|ของที่ระลึก|อื่นๆ|อื่น ๆ|ไม่มี|ไม่ระบุ|ทดสอบ|sample|product|item|n\/a)$/i;
const EMPTY_SUBJECT_WORDS = /^(?:product|products|item|items|thing|things|stuff|object|objects|sample|test|unknown|none|na|n\/a)$/i;

// The image model cannot read Thai, so the subject is ASCII only.
export function cleanEnglishSubject(text) {
  return String(text || "").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function isValidEnglishSubject(text) {
  const clean = cleanEnglishSubject(text);
  return /[A-Za-z]{2}/.test(clean) && !EMPTY_SUBJECT_WORDS.test(clean);
}

export const INDUSTRY_SUGGESTIONS = [
  "โรงงานรับผลิตกระเป๋า",
  "ร้านอาหารตามสั่ง",
  "ร้านเบเกอรี่",
  "ร้านกาแฟคั่วเอง",
  "สตูดิโอโยคะ",
  "ร้านขายต้นไม้",
  "ร้านเสริมสวย",
  "ผู้ผลิตเฟอร์นิเจอร์",
];

// A SKU an operator can keep or overwrite, derived from the Thai name (never the
// whole name): "ผัดกะเพราหมูสับ" → "PROD-4821".
export function suggestSku(name, taken = []) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  const ascii = words.find((w) => /^[A-Za-z][A-Za-z0-9-_]{1,}$/.test(w));
  for (let i = 0; i < 20; i += 1) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const sku = ascii ? `${ascii.toUpperCase().slice(0, 8)}-${suffix}` : `PROD-${suffix}`;
    if (!taken.includes(sku)) return sku;
  }
  return `PROD-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Everything wrong with the add-client form, in the operator's words.
 * `blockers` stop the create button; `hints` are guidance, not errors.
 */
export function clientIntakeIssues(form = {}) {
  const issues = [];
  const name = String(form.name || "").trim();
  const industry = String(form.industry || "").trim();
  const product = String(form.firstProduct || "").trim();
  const subject = cleanEnglishSubject(form.imageSubject);
  const sku = String(form.sku || "").trim();
  if (name.length < 2) issues.push({ field: "name", message: "กรอกชื่อลูกค้าอย่างน้อย 2 ตัวอักษร" });
  if (!industry) issues.push({ field: "industry", message: "ระบุประเภทธุรกิจ — ใช้ตัดสินมุมคอนเทนต์ คำในแคปชัน และแฮชแท็ก" });
  if (product.length < 3) issues.push({ field: "firstProduct", message: "ระบุชื่อสินค้าชิ้นแรก (อย่างน้อย 3 ตัวอักษร) — ปฏิทินทั้งเดือนสร้างจากสินค้านี้" });
  else if (VAGUE_PRODUCT_NAME.test(product)) issues.push({ field: "firstProduct", message: `“${product}” เป็นคำกว้าง — ใส่ชื่อสินค้าจริง เช่น “ผัดกะเพราหมูสับ”` });
  if (!subject) issues.push({ field: "imageSubject", message: "กรอกชื่อสินค้าภาษาอังกฤษ — ช่องนี้คือสิ่งที่โมเดลภาพจะวาด" });
  else if (!isValidEnglishSubject(subject)) issues.push({ field: "imageSubject", message: "ชื่ออังกฤษต้องเป็นชื่อจริง (ห้ามใช้คำอย่าง product / item / stuff)" });
  if (!sku) issues.push({ field: "sku", message: "ระบุรหัสสินค้า (SKU)" });
  else if (!/^[A-Za-z0-9][A-Za-z0-9-_]{0,31}$/.test(sku)) issues.push({ field: "sku", message: "SKU ใช้ได้แค่ตัวอักษร ตัวเลข - _ (ไม่เกิน 32 ตัว)" });
  return issues;
}

// What the create button is waiting for, for the line under it.
export function clientIntakeSummary(form = {}) {
  const issues = clientIntakeIssues(form);
  if (!issues.length) return "";
  return `ยังสร้างไม่ได้: ${issues.map((i) => i.message).join(" · ")}`;
}

/* ── “โพสต์นี้จะขึ้นเองไหม” ───────────────────────────────────────────────────
 * A planned post is not a promise. The scheduler only picks up `planned`/`ready`
 * entries while the app is open, the workflow parks anything whose AI score or
 * image gate is not satisfied, and a connector left on dry-run never sends.
 * Every one of those is invisible in a calendar cell, so the same rules live
 * here once and are used by the calendar chip, the post drawer, the app's
 * alerts and `scripts/social-agency-why-not-posted.cjs`.
 *
 * Keep in step with social-agency-runtime.cjs:
 *   SCHEDULER_TICK_MS = 60s       (setInterval)
 *   MISSED_AFTER_MS   = 2 hours   (older than this → status "missed")
 *   _tick() only considers statuses ["planned", "ready"], skips inFlight and
 *   TikTok entries without an explicit per-entry consent.
 */
export const SCHEDULER_TICK_MS = 60 * 1000;
export const MISSED_AFTER_MS = 2 * 60 * 60 * 1000;
// The app raises an alert when a post is this late and still needs a human.
export const APPROVAL_ALERT_AFTER_MS = 5 * 60 * 1000;
// A tick runs every minute; three missed ticks means the loop is not healthy.
export const SCHEDULER_STALE_MS = 3 * 60 * 1000;

/** When the post's Bangkok wall-clock time happens, in ms (NaN if unusable). */
export function bangkokDueMs(entry) {
  const date = String(entry?.date || "");
  const time = String(entry?.time || "").slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const ms = Date.parse(`${date}T${time}:00+07:00`);
  return Number.isFinite(ms) ? ms : NaN;
}

/** "12 วินาทีที่แล้ว" / "3 นาทีที่แล้ว" / "2 ชั่วโมงที่แล้ว" — for tick ages. */
export function relativeAgeTh(ms, nowMs = Date.now()) {
  if (!Number.isFinite(ms)) return "";
  const diff = Math.max(0, nowMs - ms);
  const sec = Math.round(diff / 1000);
  if (sec < 90) return `${sec} วินาทีที่แล้ว`;
  const mins = Math.round(sec / 60);
  if (mins < 90) return `${mins} นาทีที่แล้ว`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ชั่วโมงที่แล้ว`;
  return `${Math.round(hours / 24)} วันที่แล้ว`;
}

/** "12 นาที" / "1 ชม. 5 นาที" — for how late a post is. */
export function lateForTh(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "ไม่ถึง 1 นาที";
  if (mins < 60) return `${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

/**
 * The scheduler as the operator needs to see it: running or stopped, when it
 * last ticked, whether that tick is recent enough to trust, what is next.
 */
export function schedulerHealth(scheduler, nowMs = Date.now()) {
  if (!scheduler) {
    return {
      known: false,
      tone: "unknown",
      running: false,
      stale: false,
      label: "ไม่ทราบสถานะตัวตั้งเวลา",
      detail: "หน้านี้ยังไม่ได้รับสถานะจากเซิร์ฟเวอร์ — โหลดใหม่อีกครั้ง",
      lastTickAt: null,
      lastTickAgeMs: null,
      lastTickText: "ยังไม่มีบันทึก",
      nextPostAt: null,
      nextPostLabel: null,
      activeCount: 0,
      timezone: "Asia/Bangkok",
    };
  }
  const running = Boolean(scheduler.running);
  const lastTickMs = scheduler.lastTickAt ? Date.parse(scheduler.lastTickAt) : NaN;
  const hasTick = Number.isFinite(lastTickMs);
  const lastTickAgeMs = hasTick ? Math.max(0, nowMs - lastTickMs) : null;
  const stale = running && (!hasTick || lastTickAgeMs > SCHEDULER_STALE_MS);
  const lastTickText = hasTick ? relativeAgeTh(lastTickMs, nowMs) : "ยังไม่มีบันทึก";
  const label = !running
    ? "ตัวตั้งเวลาหยุดอยู่"
    : stale
      ? "ตัวตั้งเวลาทำงานอยู่ แต่ tick ล่าสุดนานเกิน 3 นาที"
      : "ตัวตั้งเวลาทำงานอยู่";
  const detail = !running
    ? "โพสต์ที่ตั้งเวลาไว้จะไม่ขึ้นเองเลยจนกว่าจะเริ่มตัวตั้งเวลา (ปุ่ม ▶ ข้าง ๆ) และเปิดแอปค้างไว้"
    : stale
      ? `tick ล่าสุด ${lastTickText} — ปกติ tick ทุก 1 นาที ถ้านานกว่านี้แปลว่าเซิร์ฟเวอร์หรือแท็บแอปอาจค้าง ตรวจก่อนรอโพสต์`
      : `tick ล่าสุด ${lastTickText} · ทำงานทุก 1 นาที (${scheduler.timezone || "Asia/Bangkok"})`;
  return {
    known: true,
    tone: !running ? "off" : stale ? "stale" : "on",
    running,
    stale,
    label,
    detail,
    lastTickAt: hasTick ? new Date(lastTickMs).toISOString() : null,
    lastTickAgeMs,
    lastTickText,
    nextPostAt: scheduler.nextPostAt || null,
    nextPostLabel: scheduler.nextPostLabel || null,
    activeCount: Number(scheduler.activeCount) || 0,
    timezone: scheduler.timezone || "Asia/Bangkok",
  };
}

/**
 * One honest answer to “จะขึ้นเองไหม” for a single post.
 *
 * `key` is stable (tests and the CLI switch on it), `short` is what fits in a
 * calendar cell, `title`/`detail` are the full sentence and the reason.
 */
export function postOutlook(entry, client, scheduler, nowMs = Date.now()) {
  const status = String(entry?.status || "planned");
  const platform = String(entry?.platform || "demo");
  const platformLabel = PLATFORM_META[platform]?.label || platform;
  const dueMs = bangkokDueMs(entry);
  const hasDue = Number.isFinite(dueMs);
  const health = schedulerHealth(scheduler, nowMs);
  const gate = entry?.imageGate || null;
  const gateBlocked = Boolean(gate?.required && gate?.ok === false);
  const block = approvalBlock(entry, client, nowMs);
  const threshold = client?.settings?.threshold ?? 80;
  const when = hasDue ? `${entry.date} ${entry.time}` : "ยังไม่มีวัน/เวลาที่ใช้ได้";
  const build = (key, tone, short, title, detail, actions = []) => ({
    key,
    tone,
    short,
    title,
    detail,
    actions,
    dueMs: hasDue ? dueMs : null,
    overdue: hasDue && dueMs <= nowMs,
    gateBlocked,
    live: block.live,
    platform,
    platformLabel,
  });
  // “ปิด dry-run แล้ว” still is not proof a send can happen: the connector has
  // never been tested, so the token may be missing. Say so instead of promising.
  const untested = Boolean(
    block.live && client?.connectors?.[platform] && !client.connectors[platform].testedAt
  );

  if (status === "published") {
    return build(
      "published",
      "ok",
      "ขึ้นแล้ว",
      `โพสต์นี้ออกแล้ว${entry.publishMode === "live" ? "" : ` (${entry.publishMode === "demo" ? "เว็บตัวอย่าง" : "dry-run"})`}`,
      entry.publishedAt ? `เผยแพร่เมื่อ ${formatDateTimeTh(entry.publishedAt)}${entry.postId ? ` · post ID ${entry.postId}` : ""}` : "ไม่มีบันทึกเวลาเผยแพร่",
    );
  }

  if (entry?.inFlight || status === "publishing" || status === "in_workflow") {
    return build(
      "running",
      "info",
      "กำลังขึ้น",
      "กำลังทำงานอยู่ — ไม่ต้องกดซ้ำ",
      "ระบบกำลังเขียน/เผยแพร่โพสต์นี้ รอให้จบก่อน แล้วสถานะจะเปลี่ยนเอง",
    );
  }

  if (status === "rejected") {
    return build("rejected", "info", "ยกเลิก", "รายการนี้ถูกยกเลิก — จะไม่ขึ้น", "ถ้ายังต้องการโพสต์ ให้สร้างรายการใหม่หรือเลื่อนเวลาแล้วรันใหม่");
  }

  if (status === "failed") {
    return build(
      "failed",
      "bad",
      "ไม่ขึ้น",
      "ล้มเหลว — จะไม่ขึ้นเอง",
      "รอบที่แล้วล้มเหลว ระบบจะไม่ลองใหม่เอง · กด “รันเลยตอนนี้” ที่หน้ารายการเพื่อลองอีกครั้ง",
      ["run-now"],
    );
  }

  if (status === "missed") {
    return build(
      "missed",
      "bad",
      "ไม่ขึ้น",
      "พลาดโพสต์ — ระบบไม่ส่งแล้ว",
      `เลยกำหนดเกิน 2 ชั่วโมง ระบบจึงตีเป็น “พลาดโพสต์” · กด “ส่งเลยตอนนี้” เพื่อลงทันที หรือเลื่อนวัน/เวลาใหม่`,
      ["send-now", "run-now"],
    );
  }

  if (status === "needs_review") {
    const lateMs = hasDue && dueMs <= nowMs ? nowMs - dueMs : 0;
    const lateText = hasDue && dueMs <= nowMs ? `เวลาของโพสต์นี้ผ่านมา ${lateForTh(lateMs)}แล้ว` : `ตั้งเวลาไว้ ${when}`;
    const gateText = gateBlocked ? ` · ติดด่านตรวจภาพ: ${gate.reason || "ยังไม่ได้ตรวจภาพ"}` : "";
    return build(
      "needs_approval",
      "warn",
      "ไม่อัตโนมัติ",
      "รออนุมัติ — จะไม่ขึ้นเองจนกว่าจะอนุมัติ",
      `${lateText}${gateText} · ${block.live ? "อนุมัติแล้วระบบจะส่งจริงทันที" : "ตอนนี้เป็น dry-run อนุมัติแล้วจะยังไม่ส่งขึ้นจริง"}`,
      gateBlocked ? ["review-image", "approve"] : ["approve"],
    );
  }

  // planned / ready — the statuses the scheduler actually considers.
  if (platform === "tiktok" && !entry?.tiktokPost) {
    return build(
      "tiktok_consent",
      "warn",
      "ไม่ขึ้น",
      "จะไม่ขึ้นเอง — ยังไม่ได้ให้ความยินยอม TikTok",
      "TikTok ต้องยินยอมเป็นรายโพสต์ก่อน ระบบตั้งใจไม่รันเองเพื่อไม่ให้ส่งโดยไม่มีสิทธิ์ · เปิดรายการแล้วทำขั้นยินยอมก่อน",
    );
  }

  if (gateBlocked) {
    return build(
      "gated",
      "warn",
      "ไม่ขึ้น",
      "จะไม่ขึ้นเอง — ด่านตรวจภาพยังไม่ผ่าน",
      `ถึงเวลาแล้วระบบจะรัน แต่จะหยุดรอคนตรวจภาพ: ${gate.reason || "ยังไม่ได้ตรวจภาพ"} · ตรวจภาพแล้วกด “ยืนยันภาพแล้ว + อนุมัติ”`,
      ["review-image", "approve"],
    );
  }

  if (!health.running) {
    return build(
      "scheduler_off",
      "warn",
      "ไม่ขึ้น",
      "จะไม่ขึ้นเอง — ตัวตั้งเวลาหยุดอยู่",
      `โพสต์นี้ตั้งเวลาไว้ ${when} แต่ตัวตั้งเวลาหยุดอยู่ (หรือแอปปิด) · เปิดแอปค้างไว้แล้วกด ▶ ที่มุมขวาบน`,
      ["start-scheduler"],
    );
  }

  if (health.stale) {
    return build(
      "scheduler_stale",
      "warn",
      "ไม่ขึ้น",
      "จะไม่ขึ้นเอง — ตัวตั้งเวลาอาจค้าง",
      `tick ล่าสุด ${health.lastTickText} นานเกิน 3 นาที · ตรวจว่าเซิร์ฟเวอร์ยังทำงานอยู่ แล้วเริ่มตัวตั้งเวลาใหม่`,
      ["start-scheduler"],
    );
  }

  if (!block.live) {
    return build(
      "dry_run",
      "warn",
      "ไม่ขึ้นจริง",
      "จะไม่ขึ้นบนเครือข่ายจริง — dry-run",
      `ระบบจะรันตามเวลา แต่ ${platformLabel} ยังเปิด dry-run อยู่ จึงไม่ส่งอะไรออกไป · ปิด dry-run ที่ Connectors เมื่อพร้อม${untested ? " (การเชื่อมต่อนี้ยังไม่เคยกดทดสอบ)" : ""}`,
    );
  }

  if (!hasDue) {
    return build("unknown_time", "warn", "ไม่ขึ้น", "จะไม่ขึ้นเอง — วัน/เวลาไม่ถูกต้อง", `อ่านวันเวลาไม่ได้ (${when}) · แก้ที่ช่อง “เลื่อนเวลา” ก่อน`);
  }

  if (dueMs <= nowMs) {
    const lateMs = nowMs - dueMs;
    if (lateMs > MISSED_AFTER_MS) {
      return build(
        "missed_soon",
        "bad",
        "เลยกำหนด",
        "เลยกำหนดเกิน 2 ชั่วโมง — tick ถัดไปจะตีเป็น “พลาดโพสต์”",
        `ตั้งเวลาไว้ ${when} (เลยมา ${lateForTh(lateMs)}) · กด “รันเลยตอนนี้” ถ้ายังต้องการให้ลง`,
        ["run-now"],
      );
    }
    return build(
      "late",
      "warn",
      "เลยเวลา",
      "เลยเวลาแล้ว — tick ถัดไปจะรันให้ (ช้ากว่ากำหนด)",
      `ตั้งเวลาไว้ ${when} (เลยมา ${lateForTh(lateMs)}) · ระบบยังรันให้ภายใน 2 ชั่วโมง${untested ? " · การเชื่อมต่อนี้ยังไม่เคยกดทดสอบ" : ""}`,
      ["run-now"],
    );
  }

  return build(
    "auto",
    "ok",
    "จะขึ้นเอง",
    `จะขึ้นเองตามเวลา ${entry.time} (${lateForTh(dueMs - nowMs)}ข้างหน้า)`,
    `ตัวตั้งเวลาทำงานอยู่และ ${platformLabel} ปิด dry-run ไว้ · ยังต้องผ่านด่านตอนรัน: คะแนน AI Check ≥ ${threshold} และด่านตรวจภาพ (ถ้าโพสต์มีรูป) ไม่อย่างนั้นจะหยุดรออนุมัติ${untested ? " · การเชื่อมต่อนี้ยังไม่เคยกดทดสอบ" : ""}`,
  );
}

/** Posts that already passed their time and still wait for a human (5+ min). */
export function pendingApprovals(client, scheduler, nowMs = Date.now()) {
  const withinMs = 7 * 24 * 60 * 60 * 1000; // a week-old queue is archaeology
  return (client?.calendar || [])
    .filter((entry) => entry && entry.status === "needs_review")
    .map((entry) => {
      const dueMs = bangkokDueMs(entry);
      return {
        entry,
        dueMs,
        minutesLate: Number.isFinite(dueMs) ? Math.max(0, Math.round((nowMs - dueMs) / 60000)) : 0,
        lateMs: Number.isFinite(dueMs) ? nowMs - dueMs : 0,
        outlook: postOutlook(entry, client, scheduler, nowMs),
        block: approvalBlock(entry, client, nowMs),
      };
    })
    .filter((item) => Number.isFinite(item.dueMs) && item.lateMs >= APPROVAL_ALERT_AFTER_MS && item.lateMs <= withinMs)
    .filter((item) => !item.entry.abTestSource)
    .sort((a, b) => a.dueMs - b.dueMs);
}

/** Posts the runtime already gave up on — still sendable, on purpose. */
export function missedPosts(client) {
  return (client?.calendar || [])
    .filter((entry) => entry && entry.status === "missed" && !entry.abTestSource)
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
}
