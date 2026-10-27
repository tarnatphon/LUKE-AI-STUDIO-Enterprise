/**
 * Which build is on screen?
 *
 * The bundle is stamped at build time (see vite.config.js). Comparing that
 * stamp with what the server reports is the difference between "the feature is
 * broken" and "you are looking at last week's bundle", which is otherwise a
 * twenty-minute conversation. Two different failures look identical from the
 * outside, so both are named separately:
 *
 *   - the tab is running an older bundle than the file on disk
 *     (a cached index.html / hard reload fixes it),
 *   - the file on disk is older than the source
 *     (the frontend was never rebuilt after a pull; npx vite build fixes it).
 */

const FALLBACK = Object.freeze({
  available: false,
  commit: "",
  shortCommit: "",
  branch: "",
  dirty: false,
  commitDate: "",
  version: "",
});

function parseStamp(raw) {
  if (!raw) return { ...FALLBACK };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed.commit !== "string" || !parsed.commit) return { ...FALLBACK };
    return { ...FALLBACK, ...parsed };
  } catch {
    return { ...FALLBACK };
  }
}

// import.meta.env is replaced at build time; in plain node (tests) it is
// undefined, and the module still has to load.
const rawStamp = typeof import.meta !== "undefined" && import.meta.env
  ? import.meta.env.VITE_LUKE_BUILD
  : "";

export const BUILD_INFO = parseStamp(rawStamp);

/** "1.0.0-beta.16 · main@562a58d" — falls back to Thai when nothing is known. */
export function buildLabel(info = BUILD_INFO) {
  if (!info.available) return "ไม่ทราบรุ่นที่ build";
  const branch = info.branch && info.branch !== "HEAD" ? info.branch : "";
  const where = branch ? `${branch}@${info.shortCommit}` : info.shortCommit;
  return info.version ? `${info.version} · ${where}` : where;
}

/** The commit date, in Bangkok time, for a tooltip. Empty when unknown. */
export function buildDateLabel(info = BUILD_INFO) {
  if (!info.commitDate) return "";
  const date = new Date(info.commitDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

/**
 * Compare the running bundle with what the server says it is serving.
 *
 * `health` is the /api/health payload: `source` is the checkout the server runs
 * from, `frontend` is the stamp of the files on disk. Anything missing is
 * "unknown" — never "up to date" and never "stale", because inventing an answer
 * here is worse than admitting we do not have one.
 */
export function diagnoseBuild({ build = BUILD_INFO, health = null } = {}) {
  const source = health?.source || null;
  const dist = health?.frontend || null;

  if (!build.available) {
    return {
      state: "unknown",
      label: buildLabel(build),
      detail: "bundle นี้ไม่มีข้อมูล build (สร้างก่อนเปิดใช้การตรวจรุ่น)",
      hint: "",
    };
  }

  const label = buildLabel(build);
  const dateLabel = buildDateLabel(build);

  // No health payload means no server to compare with. Say what this bundle is
  // and stop there: a green tick with nothing behind it is worse than silence.
  if (!source && !dist) {
    return {
      state: "info",
      label,
      detail: [dateLabel && `build ${dateLabel}`, build.dirty && "มีไฟล์ที่ยังไม่ commit"]
        .filter(Boolean)
        .join(" · "),
      hint: "",
    };
  }

  // 1. The tab is not running the file the server has on disk.
  if (dist?.commit && dist.commit !== build.commit) {
    return {
      state: "cached",
      label,
      detail: `เบราว์เซอร์โหลด bundle เก่า (บนดิสก์คือ ${dist.shortCommit || dist.commit.slice(0, 7)})`,
      hint: "กด Cmd+Shift+R เพื่อโหลดใหม่",
    };
  }

  // 2. The file on disk was built before the source moved.
  if (source?.available && source.commit && (dist?.commit || build.commit) !== source.commit) {
    return {
      state: "stale",
      label,
      detail: `frontend เก่ากว่าซอร์ส (โค้ดคือ ${source.shortCommit})`,
      hint: "cd app/frontend && npx vite build",
    };
  }

  return {
    state: "ok",
    label,
    detail: [dateLabel && `build ${dateLabel}`, build.dirty && "มีไฟล์ที่ยังไม่ commit"]
      .filter(Boolean)
      .join(" · "),
    hint: "",
  };
}

export const BUILD_STATE_TH = {
  ok: "ตรงกับซอร์ส",
  info: "รุ่นที่ build",
  stale: "ต้อง build ใหม่",
  cached: "ต้องรีเฟรช",
  unknown: "ไม่ทราบรุ่น",
};
