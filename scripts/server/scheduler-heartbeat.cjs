"use strict";

/**
 * The scheduler's heartbeat, on disk.
 *
 * The publishing scheduler lives inside the app process: it only ticks while the
 * app is running. That makes "ทำไมโพสต์ไม่ขึ้น" answerable only if something
 * outside the process remembers when the process was alive. This file is that
 * memory — a tiny JSON record written on start, on every tick and on stop:
 *
 *   {
 *     version: 1, pid, tickMs, timezone,
 *     startedAt, lastTickAt, stoppedAt,
 *     gaps: [{ from, to, ms }]      // windows the app was demonstrably not running
 *   }
 *
 * Gaps are discovered on the next start: if the previous record's last tick is
 * older than `gapMinMs`, the stretch between the two is a window where nothing
 * could have published. Keeping only the last `MAX_GAPS` windows keeps the file
 * small forever.
 *
 * Nothing here writes secrets, and nothing here can throw into the scheduler:
 * callers wrap the write. The rules are pure so a test — or the
 * `social-agency-why-not-posted.cjs` CLI — can ask "was the app up at 08:05?"
 * without starting an app.
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TICK_MS = 60 * 1000;
// The tick is 60s. Three missed ticks is past any plausible GC pause, sleep
// wake-up or disk hiccup, so the stretch counts as "the app was not running".
const GAP_MIN_MS = 3 * 60 * 1000;
// How late a single tick may be and still count as "covering" an instant. Same
// three minutes the app itself calls stale — one number for one question.
const TICK_TOLERANCE_MS = 3 * 60 * 1000;
const MAX_GAPS = 20;
const VERSION = 1;

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

function isoOrNull(value) {
  return Number.isFinite(toMs(value)) ? new Date(toMs(value)).toISOString() : null;
}

function normaliseRun(raw) {
  if (!raw || typeof raw !== "object") return null;
  const startedAt = isoOrNull(raw.startedAt);
  const lastTickAt = isoOrNull(raw.lastTickAt);
  if (!startedAt && !lastTickAt) return null;
  return { startedAt: startedAt || lastTickAt, lastTickAt: lastTickAt || startedAt, stoppedAt: isoOrNull(raw.stoppedAt) };
}

function normaliseGaps(gaps) {
  if (!Array.isArray(gaps)) return [];
  return gaps
    .map((g) => {
      const from = Number.isFinite(toMs(g && g.from)) ? toMs(g.from) : null;
      const to = Number.isFinite(toMs(g && g.to)) ? toMs(g.to) : null;
      if (from === null || to === null || to <= from) return null;
      return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), ms: to - from };
    })
    .filter(Boolean)
    .sort((a, b) => toMs(a.from) - toMs(b.from))
    .slice(-MAX_GAPS);
}

/** Coerce whatever was read from disk into a record the rest of the code trusts. */
function normaliseHeartbeat(raw) {
  if (!raw || typeof raw !== "object") return null;
  const startedAt = isoOrNull(raw.startedAt);
  const lastTickAt = isoOrNull(raw.lastTickAt);
  if (!startedAt && !lastTickAt) return null;
  return {
    version: VERSION,
    pid: Number.isFinite(Number(raw.pid)) ? Number(raw.pid) : null,
    tickMs: Number(raw.tickMs) > 0 ? Number(raw.tickMs) : DEFAULT_TICK_MS,
    timezone: String(raw.timezone || "Asia/Bangkok"),
    startedAt: startedAt || lastTickAt,
    lastTickAt: lastTickAt || startedAt,
    stoppedAt: isoOrNull(raw.stoppedAt),
    // The run that ended just before this one. Kept so "was the app running at
    // 08:05?" still has an answer after a restart, without keeping every run.
    previousRun: normaliseRun(raw.previousRun),
    gaps: normaliseGaps(raw.gaps),
  };
}

/**
 * `startScheduler()`: a new run begins. The stretch since the previous record's
 * last tick is only recorded as a gap when it is long enough to mean the process
 * was gone — a quick restart is not an outage worth reporting.
 */
function recordStart(prev, nowIso, options = {}) {
  const tickMs = Number(options.tickMs) > 0 ? Number(options.tickMs) : DEFAULT_TICK_MS;
  const gapMinMs = Number(options.gapMinMs) > 0 ? Number(options.gapMinMs) : GAP_MIN_MS;
  const now = toMs(nowIso) || Date.now();
  const base = normaliseHeartbeat(prev);
  const gaps = base ? base.gaps.slice() : [];
  const prevTick = base ? toMs(base.lastTickAt) : NaN;
  if (Number.isFinite(prevTick) && now - prevTick > gapMinMs) {
    gaps.push({ from: new Date(prevTick).toISOString(), to: new Date(now).toISOString(), ms: now - prevTick });
  }
  return {
    version: VERSION,
    pid: Number.isFinite(Number(options.pid)) ? Number(options.pid) : process.pid,
    tickMs,
    timezone: String(options.timezone || (base && base.timezone) || "Asia/Bangkok"),
    startedAt: new Date(now).toISOString(),
    lastTickAt: new Date(now).toISOString(),
    stoppedAt: null,
    previousRun: base ? { startedAt: base.startedAt, lastTickAt: base.lastTickAt, stoppedAt: base.stoppedAt } : null,
    gaps: normaliseGaps(gaps),
  };
}

/** `_tick()`: the only thing that proves the loop is alive. */
function recordTick(prev, nowIso, options = {}) {
  const now = toMs(nowIso) || Date.now();
  const base = normaliseHeartbeat(prev);
  const tickMs = Number(options.tickMs) > 0 ? Number(options.tickMs) : (base && base.tickMs) || DEFAULT_TICK_MS;
  return {
    version: VERSION,
    pid: Number.isFinite(Number(options.pid)) ? Number(options.pid) : (base && base.pid) || process.pid,
    tickMs,
    timezone: String((base && base.timezone) || options.timezone || "Asia/Bangkok"),
    startedAt: (base && base.startedAt) || new Date(now).toISOString(),
    lastTickAt: new Date(now).toISOString(),
    stoppedAt: null,
    previousRun: (base && base.previousRun) || null,
    gaps: base ? base.gaps.slice() : [],
  };
}

/** `stopScheduler()`: the loop is deliberately off from here on. */
function recordStop(prev, nowIso) {
  const now = toMs(nowIso) || Date.now();
  const base = normaliseHeartbeat(prev);
  if (!base) return null;
  return { ...base, stoppedAt: new Date(now).toISOString() };
}

/**
 * Was anything ticking at `atMs`?
 *
 * Returns { known, running, reason } — `known: false` when there is no record at
 * all, because "we have no evidence" and "the app was closed" are different
 * answers and the operator is owed the right one.
 */
function wasRunningAt(heartbeat, atMs, options = {}) {
  const tolerance = Number(options.tickToleranceMs) > 0 ? Number(options.tickToleranceMs) : TICK_TOLERANCE_MS;
  const hb = normaliseHeartbeat(heartbeat);
  if (!hb) {
    return {
      known: false,
      running: false,
      reason: "ยังไม่มีบันทึกการทำงานของตัวตั้งเวลา (ไฟล์ heartbeat ยังไม่ถูกเขียน — เปิดแอปค้างไว้หนึ่งรอบแล้วลองใหม่)",
    };
  }
  const t = Number(atMs);
  if (!Number.isFinite(t)) {
    return { known: false, running: false, reason: "เวลาที่จะตรวจไม่ถูกต้อง" };
  }
  for (const gap of hb.gaps) {
    const from = toMs(gap.from);
    const to = toMs(gap.to);
    if (t >= from && t <= to) {
      return {
        known: true,
        running: false,
        reason: `แอปไม่ได้เปิดอยู่ตอนนั้น (ปิด/ไม่ได้รันตั้งแต่ ${new Date(from).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} ถึง ${new Date(to).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })})`,
      };
    }
  }
  // The run before a restart is still evidence: a post due at 08:05 was covered
  // by a loop that ticked until 08:20, even though the app restarted at 09:00.
  const prev = hb.previousRun;
  if (prev) {
    const prevStart = toMs(prev.startedAt);
    const prevTick = toMs(prev.lastTickAt);
    if (t >= prevStart - tolerance && t <= prevTick + tolerance) {
      return {
        known: true,
        running: true,
        reason: `แอปเปิดอยู่และตัวตั้งเวลาเดินอยู่ (รอบก่อนหน้า tick ล่าสุด ${new Date(prevTick).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })})`,
      };
    }
  }
  const started = toMs(hb.startedAt);
  const lastTick = toMs(hb.lastTickAt);
  const stopped = hb.stoppedAt ? toMs(hb.stoppedAt) : null;
  if (t >= started - tolerance && t <= lastTick + tolerance) {
    if (stopped !== null && t > stopped) {
      return {
        known: true,
        running: false,
        reason: `ตัวตั้งเวลาถูกหยุดไปแล้วเมื่อ ${new Date(stopped).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`,
      };
    }
    return {
      known: true,
      running: true,
      reason: `แอปเปิดอยู่และตัวตั้งเวลาเดินอยู่ (tick ล่าสุด ${new Date(lastTick).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })})`,
    };
  }
  if (t > lastTick + tolerance) {
    if (stopped !== null && t > stopped) {
      return {
        known: true,
        running: false,
        reason: `ตัวตั้งเวลาถูกหยุดไปแล้วเมื่อ ${new Date(stopped).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`,
      };
    }
    return {
      known: true,
      running: false,
      reason: `ไม่มี tick ครอบเวลานั้น (tick สุดท้าย ${new Date(lastTick).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}) — แอปน่าจะปิดอยู่หรือค้าง`,
    };
  }
  return {
    known: true,
    running: false,
    reason: `เวลานั้นมาก่อนตัวตั้งเวลาจะเริ่ม (เริ่ม ${new Date(started).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })})`,
  };
}

function readHeartbeat(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const heartbeat = normaliseHeartbeat(raw);
    return heartbeat ? { ok: true, heartbeat } : { ok: false, heartbeat: null, error: "ไฟล์ heartbeat ว่างหรืออ่านไม่ได้" };
  } catch (err) {
    const missing = err && err.code === "ENOENT";
    return { ok: false, heartbeat: null, error: missing ? "ยังไม่มีไฟล์ heartbeat" : String((err && err.message) || err) };
  }
}

/** Atomic-ish write: never leave a half-written record for the CLI to read. */
function writeHeartbeat(file, heartbeat) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(heartbeat, null, 2));
  fs.renameSync(tmp, file);
  return heartbeat;
}

module.exports = {
  DEFAULT_TICK_MS,
  GAP_MIN_MS,
  TICK_TOLERANCE_MS,
  MAX_GAPS,
  normaliseHeartbeat,
  recordStart,
  recordTick,
  recordStop,
  wasRunningAt,
  readHeartbeat,
  writeHeartbeat,
};
