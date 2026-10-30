#!/usr/bin/env node
"use strict";

/**
 * Social Agency — "ทำไมโพสต์นี้ยังไม่ขึ้น" ตอบเป็นภาษาไทยจาก terminal
 *
 * A post that did not appear has one of a small number of causes, and the app
 * used to say none of them: the scheduler only runs while the app is open, the
 * workflow parks a post for a human when the AI score or the image gate says so,
 * a connector on dry-run silently sends nothing, and a post more than two hours
 * late is marked `missed` and never retried. This command reads the same state
 * file the app writes, plus the scheduler heartbeat, and prints which of those
 * is true — with the times, the thresholds, and the next command to run.
 *
 *   --entry ENTRY_ID   explain one post (ID from --list or the app)
 *   --list             (default) every post that is not going out by itself
 *   --client CLIENT_ID restrict to one client
 *   --json             machine-readable report
 *   --root PATH        project root (default: this repo)
 *
 * Read-only by design: it never approves, never publishes and never writes the
 * state file. Its sibling `scripts/social-agency-review-images.cjs --confirm`
 * is the one that records an image review.
 */

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { SocialAgencyRuntime } = require("./server/social-agency-runtime.cjs");
const { readHeartbeat, wasRunningAt } = require("./server/scheduler-heartbeat.cjs");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
// The rules live in the checkout, the state lives under --root. Keeping the two
// apart lets a test point --root at a fixture directory without also copying the
// frontend sources.
const SOURCE_ROOT = path.resolve(__dirname, "..");
const SCRIPT = "node scripts/social-agency-why-not-posted.cjs";
const BOOLEAN_FLAGS = new Set(["help", "json", "list"]);
const LIST_LIMIT = 30;
const STATUS_TH = {
  planned: "วางแผนไว้",
  ready: "พร้อมโพสต์",
  in_workflow: "กำลังรัน",
  publishing: "กำลังเผยแพร่",
  published: "เผยแพร่แล้ว",
  needs_review: "รออนุมัติ",
  missed: "พลาดโพสต์",
  failed: "ล้มเหลว",
  rejected: "ยกเลิกแล้ว",
};
const PLATFORM_TH = {
  demo: "เว็บ (Demo)",
  facebook: "Facebook",
  instagram: "Instagram",
  line: "LINE",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

const HELP = `
Social Agency — ทำไมโพสต์นี้ยังไม่ขึ้น (อ่านอย่างเดียว ไม่แก้อะไร)

  --entry ENTRY_ID     อธิบายทีละรายการ: สถานะ เวลาที่ควรโพสต์ แอปเปิดอยู่ไหมตอนนั้น
                       ด่านไหนติด คะแนนเท่าไร dry-run เปิดไหม และควรทำอะไรต่อ
  --list               (ค่าเริ่มต้นเมื่อไม่ใส่คำสั่ง) ลิสต์ทุกรายการที่ยังไม่ออกเอง
  --client CLIENT_ID   จำกัดเฉพาะลูกค้ารายหนึ่ง (id ดูได้จาก --list)
  --root PATH          พาธรากของโปรเจกต์ (ค่าเริ่มต้น: โฟลเดอร์ repo นี้)
  --json               แสดงผลเป็น JSON
  -h, --help           แสดงวิธีใช้งานนี้

คำพิมพ์ใหญ่ (ENTRY_ID, CLIENT_ID) คือช่องที่ต้องแทนด้วยค่าจริง — ไม่ต้องใส่ < >
เพราะ shell (zsh) จะอ่าน < เป็นการ redirect แล้วขึ้นว่า no such file or directory

คำสั่งนี้อ่านไฟล์สถานะของแอปเท่านั้น ไม่เปลี่ยนสถานะ ไม่เริ่มเวิร์กโฟลว์ ไม่เผยแพร่
ถ้าต้องยืนยันภาพ:  node scripts/social-agency-review-images.cjs --confirm ENTRY_ID

ตัวอย่าง
  ${SCRIPT} --list
  ${SCRIPT} --client thai-modern-bags
  ${SCRIPT} --entry cal-1234abcd-5678
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") { out.help = true; continue; }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`ต้องการค่าสำหรับ --${key}`);
      out[key] = next;
      i += 1;
      continue;
    }
    out._.push(arg);
  }
  return out;
}

function stateFileFor(root) {
  return path.join(root, "app", "runtime-state", "social-agency", "thai-modern-bags.json");
}

function heartbeatFileFor(root) {
  return path.join(root, "app", "runtime-state", "social-agency", "scheduler-heartbeat.json");
}

function relativeTo(root, file) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith("..") ? rel : file;
}

// "cal-…" / "ENTRY_ID" from the help text are examples, not ids. Saying so is
// friendlier than "ไม่พบรายการ".
function looksLikePlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(?:entr[yl][-_ ]?id|entry|id|cal|run)$/i.test(text)) return true;
  if (/^(?:cal|run)-?(?:…|\.\.\.|x{2,}|1234|<.*>)$/i.test(text)) return true;
  return /^<.*>$/.test(text);
}

function loadLib() {
  return import(pathToFileURL(path.join(SOURCE_ROOT, "app", "frontend", "src", "social-agency", "lib.js")).href);
}

function loadState(root, { clientId } = {}) {
  const stateFile = stateFileFor(root);
  if (!fs.existsSync(stateFile)) {
    return { ok: false, error: `ยังไม่มีไฟล์ ${relativeTo(root, stateFile)} — เปิดแอปแล้วเข้าแท็บ Social Agency อย่างน้อย 1 ครั้งก่อน`, clients: [] };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (err) {
    return { ok: false, error: `อ่านไฟล์สถานะไม่สำเร็จ: ${err.message}`, clients: [] };
  }
  const rt = new SocialAgencyRuntime({ root });
  rt._ensureClientShapes(raw);
  // The app decorates every entry with its image-gate verdict when it serves
  // state (getState → _decorateImageGate). Do the same here: without it the CLI
  // would call a post "จะขึ้นเอง" while the gate is about to park it.
  for (const client of raw.clients || []) {
    for (const entry of client.calendar || []) {
      try { rt._decorateImageGate(entry); } catch { /* badge only */ }
    }
  }
  const all = Array.isArray(raw.clients) ? raw.clients : [];
  const selected = clientId ? all.filter((c) => c.id === clientId) : all;
  if (clientId && !selected.length) {
    const known = all.map((c) => `${c.id} (${c.name})`).join(", ") || "(ไม่มี)";
    return { ok: false, error: `ไม่พบลูกค้า "${clientId}" — ลูกค้าที่มี: ${known}`, clients: [] };
  }
  const { heartbeat, error: heartbeatError } = readHeartbeat(heartbeatFileFor(root));
  // This process is not the app: `getSchedulerStatus()` can only report the
  // in-memory timer, which is always off here. The heartbeat on disk is the
  // evidence that the app's loop was alive moments ago, so trust it — and say
  // that is where the answer came from.
  const scheduler = withHeartbeat(rt.getSchedulerStatus(), heartbeat);
  return {
    ok: true,
    rt,
    stateFile,
    activeClientId: raw.activeClientId || null,
    clients: selected,
    scheduler,
    heartbeat,
    heartbeatError: heartbeatError || "",
  };
}

/**
 * "Is the scheduler running right now?" — asked from outside the app.
 * A fresh process has no timer, so without this every answer would be "หยุดอยู่"
 * even while the app is publishing. A heartbeat that ticked within tolerance is
 * proof of life; an older one is proof of the opposite.
 */
function withHeartbeat(status, heartbeat, nowMs = Date.now()) {
  if (!status || status.running) return status;
  const alive = wasRunningAt(heartbeat, nowMs);
  if (alive.known && alive.running) {
    return {
      ...status,
      running: true,
      observedVia: "heartbeat",
      lastTickAt: heartbeat.lastTickAt,
      startedAt: heartbeat.startedAt,
    };
  }
  return { ...status, observedVia: "heartbeat", lastTickAt: status.lastTickAt || (heartbeat && heartbeat.lastTickAt) || null };
}

function thaiDateTime(iso) {
  const ms = typeof iso === "number" ? iso : Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
}

function minutesBetween(a, b) {
  return Math.round((b - a) / 60000);
}

function lateText(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "ไม่ถึง 1 นาที";
  if (mins < 60) return `${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

function connectorSummary(client, platform) {
  const meta = (client?.connectors || {})[platform] || null;
  if (!meta) {
    return { known: false, dryRun: true, tested: false, text: "ยังไม่ได้ตั้งค่าช่องทางนี้ใน Connectors (ระบบจะไม่ส่งจริง)" };
  }
  const dryRun = meta.dryRun !== false; // missing flag = dry-run, same as the runtime
  const tested = Boolean(meta.testedAt);
  const dryText = dryRun ? "dry-run เปิดอยู่ → ระบบจะไม่ส่งขึ้นจริง" : "dry-run ปิด → ส่งจริงได้";
  const testText = !tested ? " · ยังไม่เคยกดทดสอบการเชื่อมต่อ" : ` · ทดสอบล่าสุด ${thaiDateTime(meta.testedAt)}${meta.testOk === false ? " (ครั้งล่าสุดไม่ผ่าน)" : ""}`;
  return { known: true, dryRun, tested, text: `${dryText}${testText}` };
}

function scoreSummary(client, entry, run) {
  const threshold = client?.settings?.threshold ?? 80;
  const viralThreshold = client?.settings?.viralThreshold ?? 60;
  const checkScore = run?.check?.score ?? null;
  const viral = entry?.viralScore?.score ?? null;
  const parts = [];
  if (checkScore !== null) parts.push(`AI Check ${checkScore} / เกณฑ์ ${threshold}${checkScore >= threshold ? " ✓" : " ✗"}`);
  if (viral !== null) parts.push(`ไวรัล ${viral} / เกณฑ์ ${viralThreshold}${viral >= viralThreshold ? " ✓" : " ✗"}`);
  if (!parts.length) parts.push("ยังไม่มีคะแนน — โพสต์นี้ยังไม่เคยรันเวิร์กโฟลว์");
  return { checkScore, viral, threshold, viralThreshold, text: parts.join(" · ") };
}

/**
 * Everything this command knows about one post, in data form.
 * `lines` is the Thai explanation; the data fields are for --json.
 */
async function explainEntry({ entry, client, scheduler, heartbeat, rt, activeClientId, nowMs = Date.now() }) {
  const lib = await loadLib();
  const outlook = lib.postOutlook(entry, client, scheduler, nowMs);
  const dueMs = lib.bangkokDueMs(entry);
  const hasDue = Number.isFinite(dueMs);
  const lateMs = hasDue ? nowMs - dueMs : NaN;
  const atDue = !hasDue
    ? { known: false, running: false, reason: "ไม่มีวัน/เวลาที่ใช้ได้" }
    : dueMs > nowMs
      // The question only has an answer once the time has passed; asking the
      // heartbeat about the future would always say "nothing was ticking".
      ? { known: false, running: null, reason: `ยังไม่ถึงเวลา (อีก ${lateText(dueMs - nowMs)}) — ตอนนี้${wasRunningAt(heartbeat, nowMs).running ? "ตัวตั้งเวลาเดินอยู่" : "ตัวตั้งเวลาไม่ได้เดินอยู่"}` }
      : wasRunningAt(heartbeat, dueMs);
  const gates = [];
  const runs = client.workflowRuns || [];
  const run = runs.find((r) => r.id === entry.workflowRunId) || runs.find((r) => r.entryId === entry.id) || null;
  const gate = (() => {
    try { return rt._imageGateInfo(entry); } catch { return { required: false, ok: true, status: "unknown", reason: "" }; }
  })();
  const connector = connectorSummary(client, entry.platform);
  const score = scoreSummary(client, entry, run);
  const health = lib.schedulerHealth(scheduler, nowMs);

  if (entry.status === "needs_review") {
    const since = entry.updatedAt ? ` (เข้าคิวเมื่อ ${thaiDateTime(entry.updatedAt)})` : "";
    const reminded = entry.approvalReminderAt ? ` · เตือนไปแล้ว ${thaiDateTime(entry.approvalReminderAt)}` : "";
    gates.push(`ยังไม่มีคนอนุมัติ — รายการอยู่ในคิวอนุมัติ${since}${reminded}`);
  }
  if (gate.required && gate.ok === false) {
    gates.push(`ด่านตรวจภาพ: ${gate.reason || gate.status} — ต้องเปิดรายการในแอป ตรวจภาพเทียบรูปสินค้าจริง แล้วกด "ยืนยันภาพแล้ว"`);
  }
  if (entry.status === "missed") {
    gates.push(`เลยกำหนดเกิน 2 ชั่วโมง ระบบจึงตีเป็น "พลาดโพสต์"${entry.missedAt ? ` (ตั้งแต่ ${thaiDateTime(entry.missedAt)})` : ""} — ระบบจะไม่ลองใหม่เอง`);
  }
  if (entry.status === "failed") {
    gates.push(`รอบที่แล้วล้มเหลว${entry.failedAt ? ` (${thaiDateTime(entry.failedAt)})` : ""} — ระบบไม่ลองใหม่เอง`);
  }
  if (entry.status === "rejected") gates.push("รายการนี้ถูกยกเลิกไว้");
  if (entry.platform === "tiktok" && !entry.tiktokPost) gates.push("TikTok: ยังไม่ได้ให้ความยินยอมเป็นรายโพสต์");
  if (["planned", "ready"].includes(entry.status)) {
    if (!health.running) gates.push(`ตัวตั้งเวลาหยุดอยู่${health.lastTickAt ? ` (tick ล่าสุด ${thaiDateTime(health.lastTickAt)})` : ""} — โพสต์จะไม่มีใครสั่งให้รัน`);
    else if (health.stale) gates.push(`ตัวตั้งเวลาทำงานอยู่แต่ tick ล่าสุด ${health.lastTickText} — อาจค้าง`);
    if (connector.dryRun) gates.push(`${PLATFORM_TH[entry.platform] || entry.platform}: dry-run เปิดอยู่ — ถึงเวลาก็ไม่ส่งขึ้นจริง`);
    if (hasDue && lateMs > 2 * 60 * 60 * 1000) gates.push("เลยกำหนดเกิน 2 ชั่วโมงแล้ว — tick ถัดไปจะเปลี่ยนเป็น \"พลาดโพสต์\"");
  }
  if (entry.status === "in_workflow" || entry.status === "publishing" || entry.inFlight) {
    gates.push("กำลังทำงานอยู่ — ยังไม่จบ ไม่ใช่ค้าง (ถ้านานผิดปกติให้ดูบันทึกการรันในแอป)");
  }
  if (entry.abTestSource) gates.push("ต้นฉบับ A/B ถูกเก็บไว้ — จะไม่ถูกโพสต์เอง");
  if (entry.imagePrompt && SocialAgencyRuntime._imagePromptMissesProductName(entry.imagePrompt)) {
    gates.push("พรอมป์ภาพยังไม่มีชื่อสินค้า — รูปที่ได้จะไม่มีตัวสินค้า (แก้ที่แท็บ สินค้า → ชื่ออังกฤษ)");
  }

  const verdict = verdictFor({ entry, outlook, gates, connector, health, atDue });
  const lines = [];
  lines.push("══ ทำไมโพสต์นี้ยังไม่ขึ้น ═══════════════════════════════════════════");
  lines.push(`  ลูกค้า: ${client.name} (${client.id})${client.id === activeClientId ? " · กำลังใช้งาน" : ""}`);
  lines.push(`  รายการ: ${entry.id} · ${entry.date} ${entry.time} · ${PLATFORM_TH[entry.platform] || entry.platform} · ${entry.sku || "(ไม่มี SKU)"} · ${entry.productName || ""}`);
  lines.push(`  สถานะ: ${STATUS_TH[entry.status] || entry.status} (${entry.status})`);
  lines.push(
    hasDue
      ? `  ควรโพสต์เมื่อ: ${thaiDateTime(dueMs)}${lateMs >= 0 ? ` (เลยมา ${lateText(lateMs)})` : ` (อีก ${lateText(-lateMs)})`}`
      : "  ควรโพสต์เมื่อ: ไม่มีวัน/เวลาที่ใช้ได้",
  );
  const atDueLead = atDue.running === null ? "" : atDue.known ? (atDue.running ? "ใช่ — " : "ไม่ใช่ — ") : "ไม่มีข้อมูล — ";
  lines.push(`  แอปเปิดอยู่ตอนนั้นไหม: ${atDueLead}${atDue.reason}`);
  lines.push(`  ตัวตั้งเวลาตอนนี้: ${health.label} · tick ล่าสุด ${health.lastTickText}${health.nextPostAt ? ` · คิวถัดไป ${thaiDateTime(health.nextPostAt)}` : ""}`);
  lines.push("");
  if (gates.length) {
    lines.push(`  ด่านที่ติด (${gates.length}):`);
    gates.forEach((g, i) => lines.push(`    ${i + 1}. ${g}`));
  } else {
    lines.push("  ด่านที่ติด: ไม่มี — ไม่มีอะไรขวางการโพสต์อยู่");
  }
  lines.push(`  คะแนน: ${score.text}`);
  lines.push(`  ช่องทาง ${PLATFORM_TH[entry.platform] || entry.platform}: ${connector.text}`);
  if (run) lines.push(`  การรันล่าสุด: ${run.trigger || "-"} · ${run.status}${run.gate?.decision ? ` · gate: ${run.gate.decision}` : ""}${run.startedAt ? ` · ${thaiDateTime(run.startedAt)}` : ""}`);
  lines.push("");
  lines.push(`  สรุป: ${outlook.tone === "ok" ? "✓" : "✗"} ${verdict.summary}`);
  if (verdict.next.length) {
    lines.push("  ทำอะไรต่อ:");
    for (const next of verdict.next) lines.push(`    → ${next}`);
  }
  lines.push("══════════════════════════════════════════════════════════════════");
  return {
    entryId: entry.id,
    clientId: client.id,
    clientName: client.name || client.id,
    status: entry.status,
    platform: entry.platform,
    date: entry.date || "",
    time: entry.time || "",
    dueLabel: hasDue ? thaiDateTime(dueMs) : `${entry.date || ""} ${entry.time || ""}`.trim(),
    sku: entry.sku || "",
    dueAt: hasDue ? new Date(dueMs).toISOString() : null,
    lateMs: hasDue ? lateMs : null,
    appRunningAtDue: atDue,
    scheduler: { running: health.running, stale: health.stale, lastTickAt: health.lastTickAt, nextPostAt: health.nextPostAt },
    gates,
    score,
    connector,
    outlook: { key: outlook.key, tone: outlook.tone, title: outlook.title, detail: outlook.detail },
    verdict,
    lines,
  };
}

function verdictFor({ entry, outlook, gates, connector, health, atDue }) {
  const approveCmd = `ในแอป: เปิดรายการนี้แล้วกด "อนุมัติและเผยแพร่" (ติดด่านตรวจภาพ → กด "ยืนยันภาพแล้ว + อนุมัติ")`;
  if (entry.status === "published") {
    return { code: "already_posted", summary: "โพสต์นี้ออกแล้ว ไม่มีอะไรต้องทำ", next: [] };
  }
  if (entry.inFlight || ["in_workflow", "publishing"].includes(entry.status)) {
    return { code: "in_progress", summary: "กำลังทำงานอยู่ — ยังไม่จบ", next: ["รอให้จบแล้วเปิดรายการดูผล · ถ้านานผิดปกติให้ดู “บันทึกการรัน” ในแท็บ อนุมัติ & การรัน"] };
  }
  if (entry.status === "needs_review") {
    return {
      code: "waiting_approval",
      summary: "ยังไม่มีคนอนุมัติ — ตัวตั้งเวลาไม่ส่งรายการที่รออนุมัติให้เอง",
      next: [approveCmd, `ตรวจ/ยืนยันภาพจาก terminal ได้ด้วย: node scripts/social-agency-review-images.cjs --confirm ${entry.id}`],
    };
  }
  if (entry.status === "missed") {
    return {
      code: "missed",
      summary: "เลยกำหนดเกิน 2 ชั่วโมง ระบบจึงตีเป็น “พลาดโพสต์” และไม่ลองใหม่เอง",
      next: [`ในแอป: เปิดรายการนี้แล้วกด "ส่งเลยตอนนี้" (เลื่อนมาตอนนี้แล้วรันทันที)`, `หรือเลื่อนวัน/เวลาที่ช่อง “เลื่อนเวลา” แล้วรอ tick ถัดไป`],
    };
  }
  if (entry.status === "failed") {
    return { code: "failed", summary: "รอบที่แล้วล้มเหลว ระบบไม่ลองใหม่เอง", next: [`ในแอป: กด "รันเลยตอนนี้" ที่หน้ารายการ`, `ดูสาเหตุใน “บันทึกการรัน” (แท็บ อนุมัติ & การรัน)`] };
  }
  if (entry.status === "rejected") {
    return { code: "rejected", summary: "รายการนี้ถูกยกเลิกไว้", next: ["สร้างรายการใหม่ที่ปฏิทินถ้ายังต้องการโพสต์"] };
  }
  if (outlook.key === "auto") {
    return {
      code: "will_post",
      summary: `ยังไม่ถึงเวลา — ตัวตั้งเวลาจะรันให้เอง (${outlook.title})`,
      next: ["เปิดแอปค้างไว้และเปิดตัวตั้งเวลา (▶) จนถึงเวลานั้น", "ถ้าไม่ต้องการให้ขึ้นเอง กดหยุดตัวตั้งเวลาหรือแก้เวลาในรายการ"],
    };
  }
  if (outlook.key === "scheduler_off" || outlook.key === "scheduler_stale") {
    return {
      code: outlook.key,
      summary: "ตัวตั้งเวลาไม่ได้เดินอยู่ โพสต์จึงไม่มีใครสั่งให้รัน",
      next: ["ในแอป: กด ▶ ที่มุมขวาบนเพื่อเริ่มตัวตั้งเวลา และเปิดแอปค้างไว้", "หรือกด \"รันเลยตอนนี้\" ในหน้ารายการถ้าต้องการให้ลงเดี๋ยวนี้"],
    };
  }
  if (outlook.key === "dry_run") {
    return {
      code: "dry_run",
      summary: "ช่องทางนี้ยังเปิด dry-run อยู่ ถึงเวลาก็จะไม่ส่งขึ้นจริง",
      next: ["ในแอป: Connectors → ปิด dry-run ของช่องทางนี้ แล้วกดทดสอบการเชื่อมต่อ", "ตรวจว่า token/สิทธิ์ยังใช้ได้ก่อนปิด dry-run"],
    };
  }
  if (outlook.key === "gated") {
    return {
      code: "image_gate",
      summary: "ด่านตรวจภาพยังไม่ผ่าน — ระบบจะหยุดรอคนตรวจภาพแทนการส่ง",
      next: [approveCmd, `ตรวจ/ยืนยันภาพจาก terminal: node scripts/social-agency-review-images.cjs --confirm ${entry.id}`],
    };
  }
  if (outlook.key === "tiktok_consent") {
    return { code: "tiktok_consent", summary: "TikTok ต้องยินยอมเป็นรายโพสต์ก่อน ระบบจึงไม่รันเอง", next: ["ในแอป: เปิดรายการนี้แล้วทำขั้นตอนยินยอม TikTok"] };
  }
  if (outlook.key === "late") {
    return { code: "late", summary: "เลยเวลาแล้ว แต่ยังอยู่ใน 2 ชั่วโมง — tick ถัดไปจะรันให้ช้า", next: ["รอ tick ถัดไป (ทุก 1 นาที) หรือกด \"รันเลยตอนนี้\""] };
  }
  if (outlook.key === "missed_soon") {
    return { code: "missed_soon", summary: "เลยกำหนดเกิน 2 ชั่วโมง — tick ถัดไปจะตีเป็นพลาดโพสต์", next: ["กด \"รันเลยตอนนี้\" ถ้ายังต้องการให้ลงวันนี้", "หรือเลื่อนวัน/เวลาใหม่"] };
  }
  if (!atDue.known) {
    return { code: "no_heartbeat", summary: `ไม่ขึ้น — ${outlook.title}`, next: ["เปิดแอปค้างไว้หนึ่งรอบเพื่อให้มีบันทึกการทำงานของตัวตั้งเวลา", ...(connector.dryRun ? ["และปิด dry-run ของช่องทางนี้เมื่อพร้อมส่งจริง"] : [])] };
  }
  return { code: "unknown", summary: outlook.title, next: ["เปิดรายการในแอปเพื่อดูรายละเอียดเพิ่มเติม"] };
}

async function buildReport(root, options = {}) {
  const loaded = loadState(root, { clientId: options.clientId });
  if (!loaded.ok) return { ok: false, root, error: loaded.error, entries: [], counts: { total: 0, auto: 0, blocked: 0 } };
  const lib = await loadLib();
  const scheduler = loaded.scheduler;
  const nowMs = options.nowMs || Date.now();
  const entries = [];
  for (const client of loaded.clients) {
    for (const entry of client.calendar || []) {
      const outlook = lib.postOutlook(entry, client, scheduler, nowMs);
      if (options.entryId && entry.id !== options.entryId) continue;
      if (!options.entryId && (outlook.key === "auto" || outlook.key === "published")) continue;
      const explained = await explainEntry({
        entry, client, scheduler, heartbeat: loaded.heartbeat, rt: loaded.rt,
        activeClientId: loaded.activeClientId, nowMs,
      });
      entries.push(explained);
    }
  }
  entries.sort((a, b) => {
    const am = a.dueAt ? Date.parse(a.dueAt) : 0;
    const bm = b.dueAt ? Date.parse(b.dueAt) : 0;
    return am - bm;
  });
  return {
    ok: true,
    root,
    stateFile: relativeTo(root, loaded.stateFile),
    heartbeatFile: relativeTo(root, heartbeatFileFor(root)),
    heartbeat: loaded.heartbeat,
    heartbeatError: loaded.heartbeatError,
    activeClientId: loaded.activeClientId,
    scheduler,
    serverNow: new Date(nowMs).toISOString(),
    entries,
    counts: {
      total: entries.length,
      auto: entries.filter((e) => e.outlook.key === "auto").length,
      blocked: entries.filter((e) => e.outlook.tone !== "ok" && e.outlook.key !== "published").length,
      waitingApproval: entries.filter((e) => e.outlook.key === "needs_approval").length,
      missed: entries.filter((e) => e.outlook.key === "missed").length,
      dryRun: entries.filter((e) => e.outlook.key === "dry_run").length,
    },
  };
}

function formatReport(report) {
  const lines = [];
  if (!report.ok) {
    lines.push("══ ทำไมโพสต์นี้ยังไม่ขึ้น ═══════════════════════════════════════════");
    lines.push(`  ✗ ${report.error}`);
    lines.push("══════════════════════════════════════════════════════════════════");
    return lines.join("\n");
  }
  if (!report.entries.length) {
    lines.push("══ ทำไมโพสต์นี้ยังไม่ขึ้น ═══════════════════════════════════════════");
    lines.push("  ✓ ไม่มีรายการที่ค้าง — ทุกโพสต์ที่ครบกำหนดขึ้นเองแล้ว หรือยังไม่ถึงเวลาและไม่มีอะไรขวาง");
    if (report.heartbeatError) lines.push(`  (บันทึกตัวตั้งเวลา: ${report.heartbeatError})`);
    lines.push("══════════════════════════════════════════════════════════════════");
    return lines.join("\n");
  }
  if (report.entries.length === 1) return report.entries[0].lines.join("\n");
  lines.push("══ รายการที่ยังไม่ขึ้น (ทำไม + ต้องทำอะไร) ═══════════════════════════");
  lines.push(`  ${report.entries.length} รายการ · รออนุมัติ ${report.counts.waitingApproval} · พลาด ${report.counts.missed} · dry-run ${report.counts.dryRun}`);
  if (report.heartbeatError) lines.push(`  (บันทึกตัวตั้งเวลา: ${report.heartbeatError})`);
  lines.push("");
  for (const item of report.entries.slice(0, LIST_LIMIT)) {
    // Time + full platform name + client name first: with several rows the id
    // and the raw platform key do not tell the user which post is which.
    const when = item.dueLabel || `${item.date || ""} ${item.time || ""}`.trim() || "ไม่มีวัน/เวลา";
    const platform = PLATFORM_TH[item.platform] || item.platform;
    lines.push(`  ✗ ${when} · ${platform} · ${item.clientName || item.clientId} · ${item.status}`);
    lines.push(`    ${item.verdict.summary}`);
    lines.push(`    → ${SCRIPT} --entry ${item.entryId}${item.clientId === report.activeClientId ? "" : ` --client ${item.clientId}`}`);
  }
  if (report.entries.length > LIST_LIMIT) lines.push(`  … อีก ${report.entries.length - LIST_LIMIT} รายการ (ใช้ --json เพื่อดูทั้งหมด)`);
  lines.push("══════════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2), options = {}) {
  const say = options.say || ((line = "") => process.stdout.write(`${line}\n`));
  const args = options.args || parseArgs(argv);
  const root = path.resolve(args.root || process.env.LUKE_SA_ROOT || DEFAULT_ROOT);
  if (args.help) {
    say(HELP);
    return 0;
  }
  if (args.entry && looksLikePlaceholder(args.entry)) {
    say(`✗ "${args.entry}" เป็นข้อความตัวอย่าง ไม่ใช่ ID จริง — ใช้ ${SCRIPT} --list เพื่อดู ID ที่มีอยู่`);
    return 1;
  }
  const report = await buildReport(root, { clientId: args.client, entryId: args.entry, nowMs: options.nowMs });
  if (args.entry && report.ok && !report.entries.length) {
    say(`✗ ไม่พบรายการ "${args.entry}" — ใช้ ${SCRIPT} --list เพื่อดู ID ที่มีอยู่`);
    return 1;
  }
  if (args.json) {
    say(JSON.stringify(report, null, 2));
  } else {
    say(formatReport(report));
  }
  if (!report.ok) return 1;
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code ?? 0; }).catch((err) => {
    process.stderr.write(`✗ ${err.message || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  looksLikePlaceholder,
  loadState,
  withHeartbeat,
  explainEntry,
  buildReport,
  formatReport,
  verdictFor,
  connectorSummary,
  scoreSummary,
  main,
  SCRIPT,
};
