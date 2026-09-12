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
  demo: { label: "Demo", short: "DM", cls: "demo" },
  facebook: { label: "Facebook", short: "f", cls: "facebook" },
  instagram: { label: "Instagram", short: "IG", cls: "instagram" },
  line: { label: "LINE", short: "LINE", cls: "line" },
};

export const TONES = ["เจ้าของแบรนด์", "แอดมินเพจ", "พนักงานขาย"];
export const ANGLES = ["เปิดตัวสินค้า", "เบื้องหลังการผลิต", "เคล็ดลับการใช้งาน", "เรื่องจากลูกค้า", "โปรโมชัน/ข้อเสนอ OEM"];
export const NODE_KEYS = ["schedule", "research", "brief", "create", "check", "autofix", "gate", "publish", "result"];
export const NODE_LABELS = {
  schedule: "ตั้งเวลา",
  research: "วิจัย",
  brief: "ร่าง Brief",
  create: "เขียนคอนเทนต์",
  check: "AI Check",
  autofix: "แก้อัตโนมัติ",
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
        (c.calendar || []).some((e) => e.inFlight || e.status === "in_workflow" || e.status === "publishing" || e.imageJob?.status === "running") ||
        (c.workflowRuns || []).some((r) => r.status === "running")
    )
  );
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
