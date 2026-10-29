#!/usr/bin/env node
"use strict";

/*
 * Social Agency — image review, one post at a time, from the terminal.
 *
 * After "วางแผนอัตโนมัติทั้งเดือน" a month can hold 20–30 posts, and every post
 * that carries an AI image stays blocked until a human confirms the image
 * matches the real product. Doing that in the app means opening each post, one
 * drawer at a time; this script lists exactly which posts are still waiting, the
 * file to look at, and the one command that clears each of them.
 *
 *   --list              (default) which posts still need a decision, per client
 *   --confirm ENTRY_ID  record "ตรวจภาพแล้ว" for one post (same code path as the
 *                       button: reviewEntryImage → imageReview + fingerprint)
 *   --open ENTRY_ID     open the image in the OS viewer before deciding
 *
 * Unlike scripts/verify-linkedin-post-readiness.cjs (read-only by design), this
 * command DOES write state — but only when --confirm is given, only the
 * imageReview field of one entry, and it never starts a workflow, never changes
 * a post's status and never publishes anything.
 *
 * The gate itself is not bypassed: a post with no image, a post whose file
 * changed after review, a rejected image and a post that is already publishing
 * are all refused with the reason the runtime gives the app.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { SocialAgencyRuntime } = require("./server/social-agency-runtime.cjs");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const SCRIPT = "node scripts/social-agency-review-images.cjs";
// Mirrors IMAGE_REVIEW_PLATFORMS in social-agency-runtime.cjs: the platforms
// whose posts need a human look at the picture before they can go live.
const REVIEW_PLATFORMS = ["facebook", "instagram", "line", "linkedin"];
const LIST_LIMIT = 30;
// Only flags that stand alone. `--open ENTRY_ID` and `--confirm ENTRY_ID` take a
// value: listing them here made "open" consume the flag and turn the id into the
// string "true", so the tool answered "ไม่พบรายการ true".
const BOOLEAN_FLAGS = new Set(["help", "json", "list"]);

const HELP = `
Social Agency — ลิสต์โพสต์ที่ยังไม่ยืนยันภาพ และยืนยันทีละรายการ

  --list                   ลิสต์รายการที่ยังไม่ยืนยันภาพ (ค่าเริ่มต้นเมื่อไม่ใส่คำสั่ง)
  --confirm ENTRY_ID       ยืนยันว่า "ตรวจภาพแล้ว" ให้รายการนั้น (ใช้ ID จริงจาก --list)
  --open ENTRY_ID          เปิดไฟล์รูปของรายการนั้นให้ดูก่อนตัดสินใจ
  --platform PLATFORM      จำกัดแพลตฟอร์ม: linkedin, facebook, instagram, line, all (ค่าเริ่มต้น all)
  --client CLIENT_ID       ระบุลูกค้า (ค่าเริ่มต้น: ลูกค้าที่เลือกอยู่ในแอป)
  --root PATH              พาธรากของโปรเจกต์ (ค่าเริ่มต้น: โฟลเดอร์ repo นี้)
  --json                   แสดงผลเป็น JSON
  -h, --help               แสดงวิธีใช้งานนี้

คำพิมพ์ใหญ่ (ENTRY_ID, CLIENT_ID) คือช่องที่ต้องแทนด้วยค่าจริง — ไม่ต้องใส่ < >
เพราะ shell (zsh) จะอ่าน < เป็นการ redirect แล้วขึ้นว่า no such file or directory

ต่างจากตัวตรวจ (verify-linkedin-post-readiness.cjs) ที่อ่านอย่างเดียว:
คำสั่งนี้เขียนสถานะเมื่อสั่ง --confirm เท่านั้น — เขียนแค่ผลตรวจภาพของรายการนั้น
ไม่เปลี่ยนสถานะโพสต์ ไม่เริ่มเวิร์กโฟลว์ และไม่เผยแพร่จริง

ตัวอย่าง
  ${SCRIPT} --list
  ${SCRIPT} --platform linkedin
  ${SCRIPT} --open ENTRY_ID
  ${SCRIPT} --confirm ENTRY_ID
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

// The app has always kept its single state file under this legacy name.
function stateFileFor(root) {
  return path.join(root, "app", "runtime-state", "social-agency", "thai-modern-bags.json");
}

function platformsFor(platform) {
  const wanted = String(platform || "all").trim().toLowerCase();
  if (!wanted || wanted === "all") return REVIEW_PLATFORMS.slice();
  if (!REVIEW_PLATFORMS.includes(wanted)) {
    throw new Error(`ไม่รู้จักแพลตฟอร์ม "${wanted}" — เลือกได้: ${REVIEW_PLATFORMS.join(", ")}, all`);
  }
  return [wanted];
}

function relativeTo(root, file) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith("..") ? rel : file;
}

// One read of the state, so --list and --confirm always describe the same file.
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
  const all = Array.isArray(raw.clients) ? raw.clients : [];
  const selected = clientId ? all.filter((c) => c.id === clientId) : all;
  if (clientId && !selected.length) {
    const known = all.map((c) => `${c.id} (${c.name})`).join(", ") || "(ไม่มี)";
    return { ok: false, error: `ไม่พบลูกค้า "${clientId}" — ลูกค้าที่มี: ${known}`, clients: [] };
  }
  return { ok: true, rt, activeClientId: raw.activeClientId || null, clients: selected, state: raw };
}

// What the gate says about one entry, in the words the operator needs.
function describeEntry(rt, root, entry) {
  const gate = rt._imageGateInfo(entry);
  const image = entry.image || {};
  const filePath = image.path && fs.existsSync(image.path) ? image.path : "";
  const publicUrl = String(image.publicUrl || image.url || "");
  const dueMs = Date.parse(`${entry.date || ""}T${String(entry.time || "00:00").slice(0, 5)}:00+07:00`);
  return {
    id: entry.id,
    date: entry.date,
    time: entry.time,
    platform: entry.platform,
    sku: entry.sku || "",
    status: entry.status,
    // A past-due post is still worth confirming — but the operator should know
    // that approving it sends it now, not at the scheduled time.
    overdue: Number.isFinite(dueMs) && dueMs <= Date.now(),
    hasImage: Boolean(filePath || publicUrl || (image.buffer && image.buffer.length)),
    imagePath: filePath ? relativeTo(root, filePath) : "",
    imageAbsolutePath: filePath,
    publicUrl,
    required: Boolean(gate.required),
    ok: Boolean(gate.ok),
    gateStatus: gate.status,
    reason: gate.reason || "",
    reviewedAt: entry.imageReview?.reviewedAt || "",
  };
}

function buildReviewPlan(root, { clientId, platform } = {}) {
  const platforms = platformsFor(platform);
  const loaded = loadState(root, { clientId });
  if (!loaded.ok) return { ok: false, root, error: loaded.error, clients: [], pending: 0, withoutImage: 0, reviewed: 0 };
  const clients = loaded.clients.map((c) => {
    const entries = (c.calendar || [])
      .filter((e) => e && platforms.includes(e.platform) && !e.abTestSource)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)))
      .map((e) => describeEntry(loaded.rt, root, e));
    const pending = entries.filter((e) => e.required && !e.ok);
    // No image at all: nothing to review yet, so it is not "pending" — the next
    // action is generating one, which lives in the app. Listed separately so a
    // post that was meant to carry a picture does not look finished.
    const withoutImage = entries.filter((e) => !e.hasImage);
    return {
      id: c.id,
      name: c.name,
      entries,
      pending,
      withoutImage,
      reviewed: entries.filter((e) => e.required && e.ok).length,
      active: loaded.activeClientId === c.id,
    };
  });
  return {
    ok: true,
    root,
    activeClientId: loaded.activeClientId,
    platforms,
    clients,
    pending: clients.reduce((n, c) => n + c.pending.length, 0),
    withoutImage: clients.reduce((n, c) => n + c.withoutImage.length, 0),
    reviewed: clients.reduce((n, c) => n + c.reviewed, 0),
  };
}

function clientArgFor(plan, client) {
  return plan.activeClientId === client.id ? "" : ` --client ${client.id}`;
}

function confirmCommand(plan, client, entry) {
  return `${SCRIPT}${clientArgFor(plan, client)} --confirm ${entry.id}`;
}

function openCommand(plan, client, entry) {
  return `${SCRIPT}${clientArgFor(plan, client)} --open ${entry.id}`;
}

function statusLabel(entry) {
  if (entry.gateStatus === "unreviewed") return "ยังไม่ได้ตรวจภาพ";
  if (entry.gateStatus === "stale") return "ภาพเปลี่ยนหลังตรวจ — ต้องตรวจใหม่";
  if (entry.gateStatus === "rejected") return "รูปนี้ถูกปฏิเสธไว้ — ต้องสร้างภาพใหม่";
  if (entry.gateStatus === "generating") return "กำลังสร้างภาพ — รอให้เสร็จก่อน";
  if (entry.gateStatus === "unreadable") return "อ่านไฟล์ภาพไม่ได้";
  return entry.reason || entry.gateStatus || "ยังไม่ผ่านด่านตรวจภาพ";
}

function formatPlan(plan) {
  const lines = [];
  lines.push("══ ด่านตรวจภาพ: รายการที่ยังไม่ยืนยัน ═══════════════════════════════");
  if (!plan.ok) {
    lines.push(`  ✗ ${plan.error}`);
    return lines.join("\n");
  }
  if (!plan.clients.length) {
    lines.push("  (ไม่พบลูกค้า — ระบุ --client CLIENT_ID โดยใช้ id ที่แสดงใน --list)");
    return lines.join("\n");
  }
  let explainedEmpty = false;
  for (const client of plan.clients) {
    const head = `  ลูกค้า: ${client.name} (${client.id})${client.active ? " · กำลังใช้งาน" : ""}`;
    if (!client.entries.length) {
      // Five empty demo clients should not each repeat the same paragraph.
      if (!explainedEmpty) {
        explainedEmpty = true;
        lines.push(head);
        lines.push("    ยังไม่มีรายการในปฏิทิน — เปิดแอป → ปฏิทิน → “วางแผนอัตโนมัติทั้งเดือน” แล้วกลับมารัน --list");
      } else {
        lines.push(`${head} · ยังไม่มีรายการ`);
      }
      lines.push("");
      continue;
    }
    lines.push(head);
    lines.push(
      `  รายการที่มีภาพ (${plan.platforms.join(", ")}): ${client.entries.length} · ยืนยันแล้ว ${client.reviewed} · รอการยืนยัน ${client.pending.length}`,
    );
    if (!client.pending.length) {
      lines.push("    ✓ ยืนยันภาพครบทุกใบที่ต้องใช้แล้ว");
    } else {
      const shown = client.pending.slice(0, LIST_LIMIT);
      for (const entry of shown) {
        lines.push(`    - ${entry.id} · ${entry.date} ${entry.time} · ${entry.platform} · ${entry.sku || "(ไม่มี SKU)"} · ${statusLabel(entry)}${entry.overdue ? " · เลยกำหนดแล้ว" : ""}`);
        if (entry.imagePath) lines.push(`      รูป: ${entry.imagePath}`);
        else if (entry.publicUrl) lines.push(`      รูป: ${entry.publicUrl}`);
        lines.push(`      → ${confirmCommand(plan, client, entry)}`);
      }
      if (client.pending.length > shown.length) {
        lines.push(`    … อีก ${client.pending.length - shown.length} รายการ (ใช้ --json เพื่อดูทั้งหมด)`);
      }
      lines.push(`    ดูรูปก่อนตัดสินใจได้ด้วย: ${openCommand(plan, client, client.pending[0])}`);
    }
    if (client.withoutImage.length) {
      lines.push(`  ยังไม่มีภาพ (${client.withoutImage.length}) — ถ้าโพสต์นี้ควรมีรูป ให้สร้างภาพในแอปก่อน:`);
      for (const entry of client.withoutImage.slice(0, 10)) {
        lines.push(`    - ${entry.id} · ${entry.date} ${entry.time} · ${entry.platform} · ${entry.sku || "(ไม่มี SKU)"}`);
      }
      if (client.withoutImage.length > 10) lines.push(`    … อีก ${client.withoutImage.length - 10} รายการ`);
    }
    lines.push("");
  }
  if (plan.clients.some((c) => c.pending.some((e) => e.overdue))) {
    lines.push("รายการที่ “เลยกำหนดแล้ว” ยังยืนยันได้ แต่ถ้าอนุมัติภายหลังระบบจะส่งทันที ไม่ใช่ตามเวลาเดิม");
  }
  if (plan.pending) {
    lines.push("ทุกบรรทัด “→” รันได้เลย — ยืนยันแล้วระบบจะบอกคำสั่งของรายการถัดไปให้");
    lines.push("คำสั่งนี้เขียนเฉพาะผลตรวจภาพของรายการที่สั่ง --confirm · ไม่เปลี่ยนสถานะโพสต์ · ไม่เผยแพร่");
  }
  lines.push("══════════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

function findEntry(loaded, entryId, { clientId, platform } = {}) {
  const platforms = platformsFor(platform);
  if (clientId && !loaded.clients.some((c) => c.id === clientId)) {
    throw new Error(`ไม่พบลูกค้า "${clientId}"`);
  }
  for (const client of loaded.clients) {
    const entry = (client.calendar || []).find((e) => e && e.id === entryId);
    if (!entry) continue;
    if (!platforms.includes(entry.platform)) {
      throw new Error(`รายการ ${entryId} เป็นแพลตฟอร์ม ${entry.platform} — ถ้าต้องการยืนยันด้วย ให้ใส่ --platform ${entry.platform} หรือ --platform all`);
    }
    return { client, entry };
  }
  throw new Error(`ไม่พบรายการ "${entryId}" — ใช้ ID จริงจาก ${SCRIPT} --list`);
}

function openFile(file) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : "";
  if (!opener) return false;
  execFile(opener, [file], () => {});
  return true;
}

async function runOpen(root, entryId, options = {}) {
  const say = options.say || ((line = "") => process.stdout.write(`${line}\n`));
  const loaded = loadState(root, { clientId: options.clientId });
  if (!loaded.ok) throw new Error(loaded.error);
  const { entry } = findEntry(loaded, entryId, options);
  const info = describeEntry(loaded.rt, root, entry);
  if (!info.imageAbsolutePath) {
    throw new Error(info.publicUrl
      ? `รายการ ${entryId} ใช้รูปจาก URL (${info.publicUrl}) — เปิดในเบราว์เซอร์แทน`
      : `รายการ ${entryId} ยังไม่มีไฟล์ภาพให้เปิด — สร้างภาพในแอปก่อน`);
  }
  const opened = options.openFile ? options.openFile(info.imageAbsolutePath) : openFile(info.imageAbsolutePath);
  say(`รูปของ ${entryId}: ${info.imagePath}`);
  say(opened ? "  เปิดในโปรแกรมดูรูปให้แล้ว — ตรวจเทียบรูปสินค้าจริงแล้วค่อยยืนยัน" : "  เปิดอัตโนมัติไม่ได้บนระบบนี้ — เปิดพาธด้านบนเอง");
  if (info.reason) say(`  สถานะด่าน: ${info.reason}`);
  return info;
}

async function runConfirm(root, entryId, options = {}) {
  const say = options.say || ((line = "") => process.stdout.write(`${line}\n`));
  const loaded = loadState(root, { clientId: options.clientId });
  if (!loaded.ok) throw new Error(loaded.error);
  const { client, entry } = findEntry(loaded, entryId, options);
  const result = loaded.rt.reviewEntryImage(client.id, entryId, { confirmed: true });
  say(`✓ ยืนยันภาพแล้ว: ${entryId} · ${entry.sku || "(ไม่มี SKU)"} · ${entry.platform} · ${entry.date} ${entry.time}`);
  const plan = buildReviewPlan(root, { clientId: client.id, platform: options.platform });
  const current = plan.clients[0];
  const remaining = current ? current.pending.length : 0;
  if (remaining) {
    say(`  เหลืออีก ${remaining} รายการที่ยังไม่ยืนยัน`);
    say(`  → ${confirmCommand(plan, current, current.pending[0])}`);
  } else {
    say("  ✓ ยืนยันภาพครบทุกใบที่ต้องใช้แล้ว");
    say(`  ดูรายการทั้งหมดอีกครั้ง: ${SCRIPT} --list`);
  }
  if (entry.platform === "linkedin") {
    say(`  ตรวจด่านที่เหลือของรายการนี้: node scripts/verify-linkedin-post-readiness.cjs${plan.activeClientId === client.id ? "" : ` --client ${client.id}`} --entry ${entryId}`);
  }
  return { entryId, clientId: client.id, imageGate: result.imageGate, remaining };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const say = (line = "") => process.stdout.write(`${line}\n`);
  const root = path.resolve(args.root || process.env.LUKE_SA_ROOT || DEFAULT_ROOT);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.confirm) {
    const result = await runConfirm(root, args.confirm, { clientId: args.client, platform: args.platform, say });
    if (args.json) process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    return 0;
  }
  if (args.open) {
    const info = await runOpen(root, args.open, { clientId: args.client, platform: args.platform, say });
    if (args.json) process.stdout.write(`${JSON.stringify({ ok: true, ...info }, null, 2)}\n`);
    return 0;
  }
  const plan = buildReviewPlan(root, { clientId: args.client, platform: args.platform });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatPlan(plan)}\n`);
  }
  if (!plan.ok) return 1;
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
  buildReviewPlan,
  formatPlan,
  findEntry,
  describeEntry,
  statusLabel,
  confirmCommand,
  main,
  runConfirm,
  runOpen,
  REVIEW_PLATFORMS,
};
