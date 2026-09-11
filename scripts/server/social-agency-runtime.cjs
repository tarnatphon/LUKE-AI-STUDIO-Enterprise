"use strict";

/*
 * Luke Social Agency — multi-client AI social media autopilot (v2.2)
 * All /api/social-agency/* endpoints, state, workflow engine, publishers
 * and the scheduler live here. serve.cjs only wires routes + the local LLM
 * bridge (llama-server on 127.0.0.1:PORT_LLM) + starts the scheduler.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { exec } = require("child_process");

// ── Constants ────────────────────────────────────────────────────────────────
const TZ_LABEL = "Asia/Bangkok";
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const CONTENT_ANGLES = [
  "เปิดตัวสินค้า",
  "เบื้องหลังการผลิต",
  "เคล็ดลับการใช้งาน",
  "เรื่องจากลูกค้า",
  "โปรโมชัน/ข้อเสนอ OEM",
];
const TONE_PRESETS = ["เจ้าของแบรนด์", "แอดมินเพจ", "พนักงานขาย"];
const PLATFORMS = ["demo", "facebook", "instagram", "line"];
const ENTRY_STATUSES = [
  "planned",
  "in_workflow",
  "ready",
  "publishing",
  "published",
  "failed",
  "needs_review",
  "missed",
  "rejected",
];
const NODE_DEFS = [
  { key: "schedule", label: "ตั้งเวลา" },
  { key: "research", label: "วิจัย" },
  { key: "brief", label: "ร่าง Brief" },
  { key: "create", label: "เขียนคอนเทนต์" },
  { key: "check", label: "AI Check" },
  { key: "autofix", label: "แก้อัตโนมัติ" },
  { key: "gate", label: "ประตูอนุมัติ" },
  { key: "publish", label: "เผยแพร่" },
  { key: "result", label: "ผลลัพธ์" },
];
const MAX_RUNS_PER_CLIENT = 40;
const MAX_FEWSHOTS_PER_CLIENT = 20;
const PLATFORM_VERSION_RULES = {
  demo: { maxChars: 2200, maxHashtags: 5 },
  facebook: { maxChars: 2000, maxHashtags: 4 },
  instagram: { maxChars: 2200, maxHashtags: 8 },
  line: { maxChars: 400, maxHashtags: 2 },
};
const RUN_LOG_LIMIT = 200;
const SCHEDULER_TICK_MS = 60 * 1000;
const MISSED_AFTER_MS = 2 * 60 * 60 * 1000;
const MAX_GLOBAL_CONCURRENCY = 2;
const FB_GRAPH_HOST = "graph.facebook.com";
const FB_API_VERSION = "v21.0";
const FB_MIN_INTERVAL_MS = 5 * 60 * 1000;
const IG_24H_LIMIT = 50;
const LINE_HOST = "api.line.me";
const IMGBB_HOST = "api.imgbb.com";
const HTTP_TIMEOUT_MS = 30 * 1000;

// ── Time helpers (Asia/Bangkok) ─────────────────────────────────────────────
function bangkokDateStr(d = new Date()) {
  return new Date(d.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}
function bangkokTimeStr(d = new Date()) {
  return new Date(d.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(11, 16);
}
function bangkokMonthStr(d = new Date()) {
  return bangkokDateStr(d).slice(0, 7);
}
// Monday-start week range in Bangkok wall-clock; weekOffset=1 → last week
function bangkokWeekRange(weekOffset = 0) {
  const nowBkk = new Date(Date.now() + BANGKOK_OFFSET_MS);
  const dow = (nowBkk.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(nowBkk.getUTCFullYear(), nowBkk.getUTCMonth(), nowBkk.getUTCDate() - dow - weekOffset * 7));
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return { weekKey: monday.toISOString().slice(0, 10), start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}
function bangkokToUtcMs(dateStr, timeStr) {
  const time = String(timeStr || "18:30").slice(0, 5);
  const ms = Date.parse(`${dateStr}T${time}:00+07:00`);
  return Number.isFinite(ms) ? ms : NaN;
}
function currentMonthWeeks(monthStr) {
  const [y, m] = String(monthStr || bangkokMonthStr()).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = [];
  let current = null;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDow = (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7; // 0=Mon..6=Sun
    if (isoDow === 0 || !current) {
      current = { weekdays: [], weekend: [] };
      weeks.push(current);
    }
    if (isoDow >= 5) current.weekend.push(day);
    else current.weekdays.push(day);
  }
  return { year: y, month: m, daysInMonth, weeks };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 13)}`;
}
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ── Seed data (5 sample clients, demo out of the box) ──────────────────────
const seedProducts = [
  {
    sku: "CAM-009",
    name: "กระเป๋ากล้อง CAM-009",
    category: "Camera bags",
    minimumOrder: "100–200 ใบ",
    productionTime: "30–45 วัน",
    decoration: "ซิลค์สกรีน, โลโก้ยาง, ปัก, ป้ายทอ",
    status: "verified-source",
    sourceUrl:
      "https://www.thaimodernbags.com/รายการสินค้าและผลิตภัณฑ์กระเป๋า/กระเป๋ากล้อง/ผลิตภัณฑ์/กระเป๋ากล้อง-cam-009.html",
  },
  {
    sku: "SGB-012",
    name: "กระเป๋าเชือกรูด SGB-012",
    category: "Drawstring bags",
    minimumOrder: "100–200 ใบ",
    productionTime: "30–45 วัน",
    decoration: "ซิลค์สกรีน, โลโก้ยาง, ปัก, ป้ายทอ",
    status: "verified-source",
    sourceUrl:
      "https://www.thaimodernbags.com/รายการสินค้าและผลิตภัณฑ์กระเป๋า/กระเป๋าเชือกรูด/ผลิตภัณฑ์/กระเป๋าเชือกรูด-sgb-012.html",
  },
];

function seedClients() {
  const now = new Date().toISOString();
  return [
    {
      id: "thai-modern-bags",
      name: "Thai Modern Bags Co.,Ltd.",
      industry: "ผู้ผลิตถุงแบรนด์",
      tone: "เจ้าของแบรนด์",
      website: "https://www.thaimodernbags.com",
      createdAt: now,
      products: seedProducts.map((item) => ({ ...item })),
    },
    {
      id: "oven-ban-bakery",
      name: "บ้านขนมอบ Oven บ้านๆ",
      industry: "เบเกอรี่/ขนมเค้กสั่งทำ",
      tone: "แอดมินเพจ",
      createdAt: now,
      products: [
        {
          sku: "CK-BD01",
          name: "เค้กวันเกิดสั่งทำ",
          category: "Birthday cakes",
          minimumOrder: "1 ชิ้น",
          productionTime: "สั่งล่วงหน้า 3 วัน",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/ovenbanba",
        },
        {
          sku: "CK-GF02",
          name: "คุกกี้ของขวัญ",
          category: "Gift cookies",
          minimumOrder: "6 กล่อง",
          productionTime: "สั่งล่วงหน้า 2 วัน",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/ovenbanba",
        },
      ],
    },
    {
      id: "doi-hom-coffee",
      name: "กาแฟดอยหอม",
      industry: "ร้านกาแฟ/เมล็ดกาแฟคั่ว",
      tone: "เจ้าของแบรนด์",
      createdAt: now,
      products: [
        {
          sku: "CF-GR250",
          name: "กาแฟคั่วบด 250g",
          category: "Ground coffee",
          minimumOrder: "1 ถุง",
          productionTime: "คั่วสดทุกสัปดาห์",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/doihomcoffee",
        },
        {
          sku: "CF-BEAN",
          name: "เมล็ดอาราบิก้าดอย",
          category: "Arabica beans",
          minimumOrder: "1 กิโลกรัม",
          productionTime: "คั่วสดทุกสัปดาห์",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/doihomcoffee",
        },
      ],
    },
    {
      id: "plai-fon-yoga",
      name: "สตูดิโอโยคะปลายฝน",
      industry: "สตูดิโอโยคะ/ฟิตเนส",
      tone: "พนักงานขาย",
      createdAt: now,
      products: [
        {
          sku: "YG-B01",
          name: "คลาสโยคะสำหรับมือใหม่",
          category: "Yoga classes",
          minimumOrder: "1 คลาส",
          productionTime: "เปิดคลาสทุกสัปดาห์",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/plaifonyoga",
        },
        {
          sku: "YG-A01",
          name: "คลาสเย็นบนเตียง",
          category: "Aerial yoga classes",
          minimumOrder: "1 คลาส",
          productionTime: "นัดเวลาล่วงหน้า 1 วัน",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/plaifonyoga",
        },
      ],
    },
    {
      id: "plant-club",
      name: "คนรักต้นไม้ Plant Club",
      industry: "ร้านต้นไม้/กระถาง",
      tone: "แอดมินเพจ",
      createdAt: now,
      products: [
        {
          sku: "PL-MS01",
          name: "มอนสเตอร่า",
          category: "Indoor plants",
          minimumOrder: "1 ต้น",
          productionTime: "มีต้นสวยๆ ทุกสัปดาห์",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/plantclubth",
        },
        {
          sku: "PL-PT02",
          name: "กระถางพ่นทราย",
          category: "Sand pots",
          minimumOrder: "1 ใบ",
          productionTime: "สั่งทำได้เลย",
          status: "verified-source",
          sourceUrl: "https://www.facebook.com/plantclubth",
        },
      ],
    },
  ];
}

function defaultResearcherRoles() {
  return [
    {
      id: "role-market",
      name: "นักวิจัยตลาด",
      builtIn: true,
      questions: [
        "กลุ่มเป้าหมายหลักของสินค้านี้คือใคร",
        "จุดขายที่ควรเน้นย้ำในช่วงนี้คืออะไร",
        "มุมที่คู่แข่งยังไม่ได้พูดถึงคืออะไร",
      ],
    },
    {
      id: "role-trend",
      name: "นักวิจัยเทรนด์",
      builtIn: true,
      questions: [
        "แฮชแท็กไทยที่เกี่ยวกับสินค้าและกำลังมาแรง",
        "รูปแบบคอนเทนต์ที่คนอ่านง่ายในตอนนี้",
        "ช่วงเวลาที่คนออนไลน์พร้อมเห็นโพสต์",
      ],
    },
  ];
}

function defaultConnectorMeta() {
  return {
    demo: { dryRun: false, testedAt: null, testOk: true },
    facebook: { dryRun: true, testedAt: null, testOk: false, lastPublishAt: null },
    instagram: { dryRun: true, testedAt: null, testOk: false, lastPublishAt: null, counter: null },
    line: { dryRun: true, testedAt: null, testOk: false, lastPublishAt: null, sendImageTextStack: true },
  };
}

function defaultSettings() {
  return {
    threshold: 80,
    postsPerWeek: 5,
    timezone: TZ_LABEL,
    dryRun: true,
    notify: false,
    weeklySummaryLine: false,
  };
}

// THE built-in sample post template (Thai product-launch post).
function templateHashtags(product, platform) {
  const cat = String(product?.category || "").toLowerCase();
  const name = String(product?.name || "");
  const table = [
    [/bag|กระเป๋า/, ["#กระเป๋าผ้า", "#ผลิตกระเป๋า", "#OEMกระเป๋า", "#กระเป๋าสั่งทำ", "#โรงงานกระเป๋า"]],
    [/cake|เค้ก|คุกกี้|ขนม|bakery/, ["#เค้กสั่งทำ", "#เบเกอรี่บ้านๆ", "#คุกกี้ของขวัญ", "#ขนมฝีมือบ้าน", "#เค้กวันเกิด"]],
    [/coffee|กาแฟ/, ["#กาแฟคั่วบด", "#กาแฟดอย", "#กาแฟสด", "#ร้านกาแฟ", "#เมล็ดกาแฟ"]],
    [/yoga|โยคะ|fitness|ฟิต/, ["#โยคะ", "#คลาสโยคะ", "#โยคะมือใหม่", "#ออกกำลังกาย", "#สุขภาพดี"]],
    [/plant|ต้นไม้|กระถาง|monstera/, ["#ต้นไม้", "#มอนสเตอร่า", "#กระถางสวยๆ", "#ต้นไม้ฟอกอากาศ", "#คนรักต้นไม้"]],
  ];
  let tags = ["#สั่งทำ", "#ฝีมือคนไทย", "#ของดีแนะนำ", "#ร้านน่าติดตาม", "#ช้อปสบายๆ"];
  const hit = table.find(([re]) => re.test(cat) || re.test(name));
  if (hit) tags = hit[1];
  if (platform === "line") return tags.slice(0, 2);
  if (platform === "instagram") return tags.slice(0, 5);
  return tags.slice(0, 4);
}

function buildTemplateCaption(product, { angle, platform, tone } = {}) {
  const name = product?.name || "สินค้าใหม่";
  const minOrder = product?.minimumOrder || "";
  const leadText =
    angle === "เบื้องหลังการผลิต"
      ? "วันนี้พาไปดูเบื้องหลังการทำงานจริงๆ กันนะครับ ทุกชิ้นเราใส่ใจตั้งแต่เลือกวัสดุจนส่งมอบ 🙌"
      : angle === "เคล็ดลับการใช้งาน"
        ? "ขอแนะนำวิธีดูแลให้ใช้ได้นานๆ แบบเข้าใจง่าย อ่านจบใช้ได้เลยครับ ✨"
        : angle === "เรื่องจากลูกค้า"
          ? "เมื่อสัปดาห์ที่ผ่านมามีลูกค้าเอาไปใช้แล้วส่งรูปมาให้ดู ขอบคุณมากๆ นะครับ 🥰"
          : angle === "โปรโมชัน/ข้อเสนอ OEM"
            ? "ทีมรับปรึกษางาน OEM พร้อมช่วยดูแบบให้เหมาะกับแบรนด์ของคุณ ทักมาคุยกันก่อนได้เลยครับ 💬"
            : `${name} ตัวใหม่ของเรา มาแล้วนะครับ 🎉`;
  const orderLine = [minOrder ? `สั่งขั้นต่ำ ${minOrder}` : "", product?.productionTime ? `ผลิต ${product.productionTime}` : ""]
    .filter(Boolean)
    .join(" · ");
  const toneLine =
    tone === "พนักงานขาย"
      ? "สนใจสอบถามรายละเอียดเพิ่มเติม ทักมาได้ทุกวันครับ ยินดีช่วยเลือกให้ครับ 🙏"
      : tone === "แอดมินเพจ"
        ? "ทักมาแชทได้เลยนะ แอดมินตอบไวมากจ้า 💬"
        : "อยากให้ลองดูของจริงแล้วตัดสินใจเองนะครับ ทักมาคุยกันได้เสมอ";
  const hashtags = templateHashtags(product, platform).join(" ");
  const body = [`${name}`, "", leadText, orderLine, "", toneLine, "", hashtags].filter((line, i) => !(line === "" && (i === 0 || i === 7))).join("\n");
  if (platform === "line") {
    return [`${name} นะครับ 😊`, leadText, orderLine, toneLine, hashtags].filter(Boolean).join("\n");
  }
  return body;
}

function buildTemplateImagePrompt(product, { angle } = {}) {
  const name = product?.name || "สินค้า";
  return `ภาพถ่ายสินค้า ${name} วางบนโต๊ะไม้โทนอบอุ่น แสงธรรมชาติจากหน้าต่าง มุมมองสวยงามเห็นรายละเอียดงาน สไตล์ ${angle || "เปิดตัวสินค้า"} พื้นหลังเรียบๆ ไม่มีตัวหนังสือ`;
}

// ── group 4 helpers: per-platform caption versions ──
function splitHashtags(text) {
  const tags = String(text || "").match(/#[^\s#]+/g) || [];
  const body = String(text || "")
    .replace(/#[^\s#]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, tags: [...new Set(tags)] };
}

function truncateAtBoundary(text, max) {
  const t = String(text || "");
  if (t.length <= max) return { text: t, truncated: false };
  const cut = t.slice(0, max);
  const idx = Math.max(
    cut.lastIndexOf("\n"),
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?"),
    cut.lastIndexOf("…"),
    cut.lastIndexOf(" ")
  );
  const base = (idx > max * 0.5 ? cut.slice(0, idx) : cut).trim();
  return { text: `${base}…`, truncated: true };
}


// ── Sample calendar (pre-filled demo month for the FIRST client only) ──────
function buildSampleCalendar(client) {
  const todayStr = bangkokDateStr();
  const { year, month, daysInMonth } = currentMonthWeeks(todayStr.slice(0, 7));
  const pad = (n) => String(n).padStart(2, "0");
  const todayDay = Number(todayStr.slice(8, 10));
  const pickDay = (offset) => Math.min(daysInMonth, Math.max(1, todayDay + offset));
  const dateOf = (day) => `${year}-${pad(month)}-${pad(day)}`;
  const timeOf = (day) => {
    const isoDow = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    return isoDow >= 5 ? "11:00" : "18:30";
  };
  const products = client.products.length ? client.products : seedProducts;
  const pick = (i) => products[i % products.length];
  const now = new Date().toISOString();
  const entries = [];
  const offsets = [1, 3, 6, 9, 12];
  offsets.forEach((offset, i) => {
    const day = pickDay(offset);
    const product = pick(i);
    entries.push({
      id: newId("cal"),
      date: dateOf(day),
      time: timeOf(day),
      platform: "demo",
      sku: product.sku,
      productName: product.name,
      angle: CONTENT_ANGLES[i % CONTENT_ANGLES.length],
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
  });
  // One already-published demo entry so the calendar shows a success chip OOTB.
  const pubDay = Math.max(1, todayDay - 1);
  const pubProduct = pick(0);
  entries.push({
    id: newId("cal"),
    date: dateOf(pubDay),
    time: timeOf(pubDay),
    platform: "demo",
    sku: pubProduct.sku,
    productName: pubProduct.name,
    angle: CONTENT_ANGLES[0],
    status: "published",
    publishedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    postId: `demo-${crypto.randomBytes(4).toString("hex")}`,
    caption: buildTemplateCaption(pubProduct, { angle: CONTENT_ANGLES[0], platform: "demo", tone: client.tone }),
    createdAt: now,
    updatedAt: now,
  });
  // One needs_review entry (deliberately bad draft) to demo the approval queue.
  const reviewDay = pickDay(2);
  const reviewProduct = pick(1);
  const badCaption =
    `ในยุคที่ทุกคนมองหาความคุ้มค่า ${reviewProduct.name} คือคำตอบที่สำคัญอย่างยิ่งครับ ราคาเพียง 1,200 บาท พร้อมส่งทันทีทุกชิ้น #กระเป๋า #แบรนด์`;
  const reviewEntry = {
    id: newId("cal"),
    date: dateOf(reviewDay),
    time: timeOf(reviewDay),
    platform: "demo",
    sku: reviewProduct.sku,
    productName: reviewProduct.name,
    angle: CONTENT_ANGLES[4],
    status: "needs_review",
    caption: badCaption,
    createdAt: now,
    updatedAt: now,
  };
  const reviewRun = {
    id: newId("run"),
    clientId: client.id,
    entryId: reviewEntry.id,
    label: `${reviewProduct.name} · demo · ${reviewEntry.date} ${reviewEntry.time}`,
    trigger: "schedule",
    status: "needs_review",
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45000).toISOString(),
    durationMs: 45000,
    nodes: NODE_DEFS.map((def, index) => {
      if (def.key === "schedule") {
        return { ...def, status: "done", durationMs: 5, output: `กำหนดเผยแพร่ ${reviewEntry.date} ${reviewEntry.time} (Asia/Bangkok)`, detail: "" };
      }
      if (def.key === "research") {
        return { ...def, status: "done", durationMs: 8200, output: "โน้ตวิจัยตลาด + เทรนด์ (ตัวอย่างสาธิต)", detail: "นักวิจัยตลาด: เน้นกลุ่มผู้ผลิตแบรนด์ที่มองหาโรงงานที่ทำได้จริง\nนักวิจัยเทรนด์: รูปงานจริง + คอนเทนต์สั้นตอบคอมเมนต์ไว" };
      }
      if (def.key === "brief") {
        return { ...def, status: "done", durationMs: 600, output: "Brief: เปิดตัวสินค้า + ข้อเสนอ OEM (ตัวอย่างสาธิต)", detail: "สินค้า: " + reviewProduct.name + "\nมุม: " + CONTENT_ANGLES[4] };
      }
      if (def.key === "create") {
        return { ...def, status: "done", durationMs: 15400, output: badCaption.slice(0, 80) + "…", detail: badCaption };
      }
      if (def.key === "check") {
        return {
          ...def,
          status: "done",
          durationMs: 9100,
          output: "score 48 · verdict review",
          detail: "ปัญหา: อ้างราคาที่ไม่มีในหลักฐาน · ใช้คำต้องห้าม (ในยุคที่, สำคัญอย่างยิ่ง) · สัญญาการส่งที่ไม่ได้รับอนุมัติ · แฮชแท็กน้อยเกินไป · ไม่มีอีโมจิ",
          check: { score: 48, verdict: "review", issues: ["อ้างราคาที่ไม่มีในหลักฐานสินค้า", "ใช้คำต้องห้าม: ในยุคที่ / สำคัญอย่างยิ่ง", "สัญญา 'พร้อมส่งทันที' ที่ไม่ได้รับอนุมัติ", "แฮชแท็กน้อยกว่า 3 อัน", "ไม่มีอีโมจิเลย อ่านแข็งไป"], categories: { evidence: 20, natural: 45, tone: 55, platform: 60, accuracy: 65 } },
        };
      }
      if (def.key === "autofix") {
        return { ...def, status: "waiting", durationMs: 0, output: "คะแนนต่ำกว่า 60 ไม่เข้าเงื่อนไข auto-fix", detail: "" };
      }
      if (def.key === "gate") {
        return { ...def, status: "waiting", durationMs: 0, output: "รอการอนุมัติจากคน (score 48 < 80)", detail: "" };
      }
      return { ...def, status: "idle", durationMs: 0, output: "", detail: "" };
    }),
    check: { score: 48, verdict: "review", issues: ["อ้างราคาที่ไม่มีในหลักฐานสินค้า", "ใช้คำต้องห้าม: ในยุคที่ / สำคัญอย่างยิ่ง", "สัญญา 'พร้อมส่งทันที' ที่ไม่ได้รับอนุมัติ", "แฮชแท็กน้อยกว่า 3 อัน", "ไม่มีอีโมจิเลย อ่านแข็งไป"] },
    gate: { decision: "review", reason: "score 48 ต่ำกว่าเกณฑ์ 80" },
    publish: null,
  };
  reviewEntry.workflowRunId = reviewRun.id;
  entries.push(reviewEntry);
  return { entries, reviewRun };
}

// ── The runtime ─────────────────────────────────────────────────────────────
class SocialAgencyRuntime {
  constructor({ root }) {
    this.root = root;
    this.stateDir = path.join(root, "app", "runtime-state", "social-agency");
    this.filePath = path.join(this.stateDir, "thai-modern-bags.json");
    this.connectorsFile = path.join(this.stateDir, "connectors.json");
    this.backupDir = path.join(this.stateDir, "backups");
    this.llm = null; // injected by serve.cjs: { isReady(), chat(messages, opts) }
    this.schedulerTimer = null;
    this.schedulerLastTickAt = null;
    this.activeRunCount = 0;
    this.activeByClientPlatform = new Set();
    this._slotByRunId = new Map();
    this.knownVersion = null;
    this._recovered = false;
    this._read(); // load / migrate eagerly
  }

  // ── persistence ──
  _readRaw() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return null;
    }
  }

  _read() {
    const raw = this._readRaw();
    if (!raw) {
      const state = this._buildFreshState();
      this._write(state);
      return state;
    }
    if (raw && raw.version === 2 && Array.isArray(raw.clients)) {
      this._ensureClientShapes(raw);
      return raw;
    }
    const state = this._migrateV1(raw);
    this._write(state);
    return state;
  }

  _write(state) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    // never persist the response-only legacy mirror / runtime summary fields
    const clean = { ...state };
    delete clean.client;
    delete clean.products;
    delete clean.drafts;
    delete clean.selectionHistory;
    delete clean.scheduler;
    delete clean.serverNow;
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  _buildFreshState() {
    const now = new Date().toISOString();
    const clients = seedClients().map((seed) => ({
      ...seed,
      drafts: [],
      calendar: [],
      workflowRuns: [],
      researcherRoles: defaultResearcherRoles(),
      connectors: defaultConnectorMeta(),
      settings: defaultSettings(),
    }));
    const { entries, reviewRun } = buildSampleCalendar(clients[0]);
    clients[0].calendar = entries;
    clients[0].workflowRuns = [reviewRun];
    return {
      version: 2,
      activeClientId: clients[0].id,
      clients,
      runLog: [],
      createdAt: now,
    };
  }

  // v1 single-client state becomes client #1 VERBATIM, then samples 2-5 are added.
  _migrateV1(raw) {
    const now = new Date().toISOString();
    const v1Client = raw && typeof raw === "object" ? raw.client : null;
    const first = {
      id: (v1Client && v1Client.id) || "thai-modern-bags",
      name: (v1Client && v1Client.name) || "Thai Modern Bags Co.,Ltd.",
      industry: "ผู้ผลิตถุงแบรนด์",
      tone: "เจ้าของแบรนด์",
      website: (v1Client && v1Client.website) || "https://www.thaimodernbags.com",
      createdAt: (raw && raw.createdAt) || now,
      products: Array.isArray(raw && raw.products) && raw.products.length ? raw.products : seedProducts.map((item) => ({ ...item })),
      drafts: Array.isArray(raw && raw.drafts) ? raw.drafts : [],
      selectionHistory: Array.isArray(raw && raw.selectionHistory) ? raw.selectionHistory : [],
      calendar: [],
      workflowRuns: [],
      researcherRoles: defaultResearcherRoles(),
      connectors: defaultConnectorMeta(),
      settings: defaultSettings(),
    };
    const others = seedClients()
      .filter((seed) => seed.id !== first.id)
      .map((seed) => ({
        ...seed,
        drafts: [],
        calendar: [],
        workflowRuns: [],
        researcherRoles: defaultResearcherRoles(),
        connectors: defaultConnectorMeta(),
        settings: defaultSettings(),
      }));
    const clients = [first, ...others];
    const { entries, reviewRun } = buildSampleCalendar(first);
    first.calendar = entries;
    first.workflowRuns = [reviewRun];
    return {
      version: 2,
      activeClientId: first.id,
      clients,
      runLog: [],
      createdAt: (raw && raw.createdAt) || now,
      migratedAt: now,
      migratedFromVersion: (raw && raw.version) || 1,
    };
  }

  _ensureClientShapes(state) {
    for (const client of state.clients) {
      if (!Array.isArray(client.products)) client.products = [];
      if (!Array.isArray(client.drafts)) client.drafts = [];
      if (!Array.isArray(client.calendar)) client.calendar = [];
      if (!Array.isArray(client.workflowRuns)) client.workflowRuns = [];
      if (!Array.isArray(client.researcherRoles) || !client.researcherRoles.length) client.researcherRoles = defaultResearcherRoles();
      if (!Array.isArray(client.fewShots)) client.fewShots = [];
      client.connectors = { ...defaultConnectorMeta(), ...(client.connectors || {}) };
      client.settings = { ...defaultSettings(), ...(client.settings || {}) };
      if (!client.tone || !TONE_PRESETS.includes(client.tone)) client.tone = "เจ้าของแบรนด์";
    }
    if (!Array.isArray(state.runLog)) state.runLog = [];
    if (!state.clients.find((c) => c.id === state.activeClientId)) state.activeClientId = state.clients[0]?.id || null;
    return state;
  }

  // ── client helpers ──
  _resolveClient(clientId) {
    const state = this._read();
    const id = clientId || state.activeClientId;
    const client = state.clients.find((c) => c.id === id);
    if (!client) throw new Error("ไม่พบลูกค้ารายนี้ (client not found)");
    return { state, client };
  }

  _mirrorLegacy(state) {
    // Legacy top-level fields always mirror the ACTIVE client so v1 keeps working.
    const active = state.clients.find((c) => c.id === state.activeClientId) || state.clients[0];
    state.client = {
      id: active.id,
      name: active.name,
      website: active.website || "",
      industry: active.industry || "",
      tone: active.tone || "เจ้าของแบรนด์",
    };
    state.products = active.products;
    state.drafts = active.drafts;
    state.selectionHistory = active.selectionHistory || [];
    return state;
  }

  getState() {
    const state = this._read();
    this._mirrorLegacy(state);
    state.scheduler = this.getSchedulerStatus();
    state.serverNow = new Date().toISOString();
    return state;
  }

  // ── clients CRUD ──
  listClients() {
    const state = this._read();
    return state.clients.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      tone: c.tone,
      createdAt: c.createdAt,
      productCount: (c.products || []).length,
      scheduledThisMonth: (c.calendar || []).filter(
        (e) => e.date && e.date.startsWith(bangkokMonthStr()) && ["planned", "in_workflow", "ready", "publishing", "needs_review"].includes(e.status)
      ).length,
    }));
  }

  createClient({ name, industry, tone, firstProduct }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("กรุณากรอกชื่อลูกค้า");
    const state = this._read();
    const now = new Date().toISOString();
    const id = `client-${crypto.randomUUID().slice(0, 8)}`;
    const products = [];
    const productName = String(firstProduct || "").trim();
    if (productName) {
      products.push({
        sku: `SKU-${String(state.clients.length + 1).padStart(2, "0")}-01`,
        name: productName,
        category: String(industry || "").trim() || "สินค้า",
        minimumOrder: "1 ชิ้น",
        productionTime: "สอบถามรายละเอียดก่อนสั่ง",
        status: "verified-source",
        sourceUrl: "",
      });
    }
    const client = {
      id,
      name: cleanName,
      industry: String(industry || "").trim() || "ทั่วไป",
      tone: TONE_PRESETS.includes(tone) ? tone : "เจ้าของแบรนด์",
      createdAt: now,
      products,
      drafts: [],
      calendar: [],
      workflowRuns: [],
      researcherRoles: defaultResearcherRoles(),
      connectors: defaultConnectorMeta(),
      settings: defaultSettings(),
    };
    state.clients.push(client);
    state.activeClientId = id;
    this._write(state);
    return client;
  }

  updateClient(clientId, patch) {
    const { state, client } = this._resolveClient(clientId);
    if (patch && typeof patch.name === "string" && patch.name.trim()) client.name = patch.name.trim();
    if (patch && typeof patch.industry === "string" && patch.industry.trim()) client.industry = patch.industry.trim();
    if (patch && patch.tone && TONE_PRESETS.includes(patch.tone)) client.tone = patch.tone;
    if (patch && Array.isArray(patch.researcherRoles)) {
      client.researcherRoles = patch.researcherRoles
        .filter((r) => r && typeof r === "object" && String(r.name || "").trim())
        .slice(0, 8)
        .map((r) => ({
          id: String(r.id || newId("role")),
          name: String(r.name).trim(),
          builtIn: Boolean(r.builtIn),
          questions: Array.isArray(r.questions) ? r.questions.map((q) => String(q)).filter(Boolean).slice(0, 6) : [],
        }));
      // always keep the two built-in roles
      for (const builtIn of defaultResearcherRoles()) {
        if (!client.researcherRoles.find((r) => r.id === builtIn.id || r.name === builtIn.name)) client.researcherRoles.push(builtIn);
      }
    }
    this._write(state);
    return client;
  }

  deleteClient(clientId) {
    const state = this._read();
    if (state.clients.length <= 1) throw new Error("ต้องมีลูกค้าอย่างน้อย 1 ราย ลบรายอื่นก่อนได้เลย");
    const index = state.clients.findIndex((c) => c.id === clientId);
    if (index === -1) throw new Error("ไม่พบลูกค้ารายนี้");
    state.clients.splice(index, 1);
    if (state.activeClientId === clientId) state.activeClientId = state.clients[0].id;
    this._write(state);
    this._deleteConnectorSecrets(clientId);
    return { deleted: clientId, activeClientId: state.activeClientId };
  }

  activateClient(clientId) {
    const state = this._read();
    const client = state.clients.find((c) => c.id === clientId);
    if (!client) throw new Error("ไม่พบลูกค้ารายนี้");
    state.activeClientId = clientId;
    this._write(state);
    return state;
  }

  // ── v1 draft endpoints (active client) ──
  createDailyDraft() {
    const { state, client } = this._resolveClient();
    const recent = new Set((client.selectionHistory || []).slice(-14).map((item) => item.sku));
    const eligible = client.products.filter((item) => item.status === "verified-source" && !recent.has(item.sku));
    const candidates = eligible.length ? eligible : client.products.filter((item) => item.status === "verified-source");
    if (!candidates.length) throw new Error("No verified product is eligible for a daily draft.");
    const product = candidates[Math.floor(Math.random() * candidates.length)];
    const draft = {
      id: crypto.randomUUID(),
      sku: product.sku,
      productName: product.name,
      sourceUrl: product.sourceUrl,
      status: "needs-approval",
      evidence: "verified-source",
      createdAt: new Date().toISOString(),
      caption: `${product.name}\n\nออกแบบให้เหมาะกับแบรนด์ การใช้งาน และงบประมาณของคุณ พร้อมเลือกการตกแต่งโลโก้ได้\n\nขั้นต่ำ ${product.minimumOrder} · ระยะเวลาผลิต ${product.productionTime}\n\nทักเพื่อขอคำแนะนำและใบเสนอราคา`,
    };
    client.drafts.unshift(draft);
    client.selectionHistory = [...(client.selectionHistory || []), { sku: product.sku, selectedAt: draft.createdAt }];
    this._write(state);
    return draft;
  }

  updateDraftStatus(id, status) {
    if (!["needs-approval", "approved", "rejected"].includes(status)) throw new Error("Unsupported draft status.");
    const { state, client } = this._resolveClient();
    const draft = (client.drafts || []).find((item) => item.id === id);
    if (!draft) throw new Error("Draft not found.");
    draft.status = status;
    draft.updatedAt = new Date().toISOString();
    this._write(state);
    return draft;
  }

  // ── calendar CRUD ──
  listCalendar(clientId, filters = {}) {
    const { client } = this._resolveClient(clientId);
    let entries = [...(client.calendar || [])];
    const { status, platform, q, from, to } = filters || {};
    if (status) {
      const set = new Set(String(status).split(",").map((s) => s.trim()).filter(Boolean));
      if (set.size) entries = entries.filter((e) => set.has(e.status));
    }
    if (platform) {
      const set = new Set(String(platform).split(",").map((s) => s.trim()).filter(Boolean));
      if (set.size) entries = entries.filter((e) => set.has(e.platform));
    }
    if (from) entries = entries.filter((e) => e.date && e.date >= String(from));
    if (to) entries = entries.filter((e) => e.date && e.date <= String(to));
    if (q && String(q).trim()) {
      const needle = String(q).trim().toLowerCase();
      entries = entries.filter((e) =>
        [e.productName, e.angle, e.caption, e.brief, e.id, e.sku]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      );
    }
    entries.sort((a, b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`));
    return entries;
  }

  // ── overview dashboard (group 3: month stats, upcoming, review queue) ──
  getOverview(clientId) {
    const { client } = this._resolveClient(clientId);
    const month = bangkokMonthStr();
    const today = bangkokDateStr();
    const in7 = bangkokDateStr(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    const entries = client.calendar || [];
    const inMonth = entries.filter((e) => e.date && e.date.startsWith(month));
    const byStatus = {};
    for (const e of inMonth) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    const byPlatform = {};
    for (const e of inMonth) byPlatform[e.platform] = (byPlatform[e.platform] || 0) + 1;
    const slim = (e) => ({
      id: e.id,
      date: e.date,
      time: e.time,
      platform: e.platform,
      productName: e.productName,
      angle: e.angle,
      status: e.status,
    });
    const upcoming = entries
      .filter((e) => ["planned", "ready"].includes(e.status) && e.date >= today && e.date <= in7)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .slice(0, 10)
      .map(slim);
    const needsReview = entries
      .filter((e) => e.status === "needs_review")
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .slice(0, 10)
      .map((e) => ({ ...slim(e), caption: e.caption || "" }));
    const recentRuns = [...(client.workflowRuns || [])]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        entryId: r.entryId,
        status: r.status,
        trigger: r.trigger,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt || null,
      }));
    return {
      clientId: client.id,
      month,
      counts: {
        scheduled: (byStatus.planned || 0) + (byStatus.in_workflow || 0) + (byStatus.ready || 0) + (byStatus.publishing || 0),
        awaiting: byStatus.needs_review || 0,
        published: byStatus.published || 0,
        failed: (byStatus.failed || 0) + (byStatus.missed || 0),
        total: inMonth.length,
      },
      byStatus,
      byPlatform,
      upcoming,
      needsReview,
      recentRuns,
      serverNow: new Date().toISOString(),
    };
  }

  // ── per-platform caption versions (group 4) ──
  buildPlatformVersions({ caption, product, angle, tone } = {}) {
    const base = (caption && String(caption).trim()) || buildTemplateCaption(product, { angle, platform: "facebook", tone });
    const { body, tags } = splitHashtags(base);
    const fallbackTags = templateHashtags(product, "instagram");
    const fill = (have, max) => {
      const out = [...have];
      for (const t of fallbackTags) {
        if (out.length >= max) break;
        if (!out.includes(t)) out.push(t);
      }
      return out.slice(0, max);
    };
    const assemble = (textBody, tagList) => (tagList.length ? `${textBody}\n\n${tagList.join(" ")}` : textBody);
    const versions = { demo: base };
    const meta = { demo: { chars: base.length, truncated: false, hashtags: tags.length } };
    const jobs = [
      { platform: "facebook", tagList: fill(tags, PLATFORM_VERSION_RULES.facebook.maxHashtags) },
      { platform: "instagram", tagList: fill(tags, PLATFORM_VERSION_RULES.instagram.maxHashtags) },
      { platform: "line", tagList: tags.slice(0, PLATFORM_VERSION_RULES.line.maxHashtags) },
    ];
    for (const { platform, tagList } of jobs) {
      const rules = PLATFORM_VERSION_RULES[platform];
      let textBody = body;
      // LINE broadcast budget: reserve room for hashtags, then truncate the body
      const tagSuffix = tagList.length ? tagList.join(" ").length + 2 : 0;
      const bodyBudget = platform === "line" ? Math.max(80, rules.maxChars - tagSuffix) : rules.maxChars;
      const cut = truncateAtBoundary(textBody, bodyBudget);
      textBody = cut.text;
      let text = assemble(textBody, tagList);
      let truncated = cut.truncated;
      if (text.length > rules.maxChars) {
        const recut = truncateAtBoundary(text, rules.maxChars);
        text = recut.text;
        truncated = true;
      }
      versions[platform] = text;
      meta[platform] = { chars: text.length, truncated, hashtags: (text.match(/#[^\s#]+/g) || []).length };
    }
    return { base, versions, meta };
  }

  previewPlatformVersions(clientId, body = {}) {
    const { client } = this._resolveClient(clientId || body.clientId);
    let caption = body.caption ? String(body.caption) : "";
    let product = client.products.find((p) => p.sku === body.sku) || client.products[0];
    let angle = CONTENT_ANGLES.includes(body.angle) ? body.angle : CONTENT_ANGLES[0];
    let entryId = null;
    if (body.entryId) {
      const entry = (client.calendar || []).find((e) => e.id === body.entryId);
      if (!entry) throw new Error("ไม่พบรายการในปฏิทิน");
      entryId = entry.id;
      caption = caption || entry.caption || "";
      product = client.products.find((p) => p.sku === entry.sku) || product;
      angle = entry.angle || angle;
    }
    if (!product) throw new Error("ลูกค้ารายนี้ยังไม่มีสินค้า กรุณาเพิ่มสินค้าก่อน");
    if (!caption) caption = buildTemplateCaption(product, { angle, platform: "facebook", tone: client.tone });
    return {
      entryId,
      sku: product.sku,
      productName: product.name,
      angle,
      ...this.buildPlatformVersions({ caption, product, angle, tone: client.tone }),
    };
  }

  // ── few-shot style examples (group 4) ──
  listFewShots(clientId) {
    const { client } = this._resolveClient(clientId);
    return [...(client.fewShots || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  addFewShot(clientId, body = {}) {
    const { state, client } = this._resolveClient(clientId || body.clientId);
    const platform = PLATFORMS.includes(body.platform) ? body.platform : "facebook";
    const caption = String(body.caption || "").trim();
    if (caption.length < 20) throw new Error("ตัวอย่างสั้นเกินไป (อย่างน้อย 20 ตัวอักษร)");
    if (caption.length > 2000) throw new Error("ตัวอย่างยาวเกินไป (ไม่เกิน 2000 ตัวอักษร)");
    if ((client.fewShots || []).length >= MAX_FEWSHOTS_PER_CLIENT) {
      throw new Error(`เก็บตัวอย่างได้สูงสุด ${MAX_FEWSHOTS_PER_CLIENT} ชิ้นต่อลูกค้า ลบของเก่าออกก่อนนะ`);
    }
    const shot = {
      id: newId("fs"),
      platform,
      caption,
      note: body.note ? String(body.note).slice(0, 200) : "",
      angle: CONTENT_ANGLES.includes(body.angle) ? body.angle : null,
      createdAt: new Date().toISOString(),
    };
    client.fewShots = [...(client.fewShots || []), shot];
    this._write(state);
    return shot;
  }

  deleteFewShot(clientId, shotId) {
    const { state, client } = this._resolveClient(clientId);
    const before = (client.fewShots || []).length;
    client.fewShots = (client.fewShots || []).filter((s) => s.id !== shotId);
    if (client.fewShots.length === before) throw new Error("ไม่พบตัวอย่างสไตล์นี้");
    this._write(state);
    return { deleted: shotId };
  }

  _fewShotExamples(client, platform, limit = 3) {
    const shots = (client?.fewShots || []).filter((s) => s && s.caption);
    return [...shots]
      .sort((a, b) => {
        const score = (s) => (s.platform === platform ? 0 : 1);
        return score(a) - score(b) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      })
      .slice(0, limit);
  }

  _findEntry(clientId, entryId) {
    const state = this._read();
    const c = state.clients.find((x) => x.id === (clientId || state.activeClientId));
    if (!c) throw new Error("ไม่พบลูกค้ารายนี้");
    const entry = (c.calendar || []).find((e) => e.id === entryId);
    if (!entry) throw new Error("ไม่พบรายการในปฏิทิน");
    return { state, client: c, entry };
  }

  createCalendarEntry(clientId, body) {
    const { state, client } = this._resolveClient(clientId);
    const entry = body && body.entry ? body.entry : body || {};
    const date = String(entry.date || "").trim();
    const time = String(entry.time || "18:30").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)");
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("เวลาไม่ถูกต้อง (ต้องเป็น HH:mm)");
    const platform = PLATFORMS.includes(entry.platform) ? entry.platform : "demo";
    const product = client.products.find((p) => p.sku === entry.sku) || client.products[0];
    if (!product) throw new Error("ลูกค้ารายนี้ยังไม่มีสินค้า กรุณาเพิ่มสินค้าก่อน");
    if ((client.calendar || []).some((e) => e.date === date && e.time === time)) {
      throw new Error("ช่องเวลานี้มีคอนเทนต์อยู่แล้ว เลือกเวลาอื่นนะ");
    }
    const now = new Date().toISOString();
    const record = {
      id: newId("cal"),
      date,
      time,
      platform,
      sku: product.sku,
      productName: product.name,
      angle: CONTENT_ANGLES.includes(entry.angle) ? entry.angle : CONTENT_ANGLES[0],
      status: "planned",
      createdAt: now,
      updatedAt: now,
    };
    if (entry.brief) record.brief = String(entry.brief);
    client.calendar = [...(client.calendar || []), record];
    this._write(state);
    return record;
  }

  updateCalendarEntry(clientId, entryId, patch) {
    const { state, client, entry } = this._findEntry(clientId, entryId);
    if (!patch || typeof patch !== "object") throw new Error("ไม่มีข้อมูลที่ต้องการแก้ไข");
    if (patch.date !== undefined || patch.time !== undefined) {
      if (entry.inFlight) throw new Error("รายการนี้กำลังรันอยู่ รอเสร็จก่อนแล้วค่อยเลื่อนเวลา");
      const date = patch.date !== undefined ? String(patch.date) : entry.date;
      const time = patch.time !== undefined ? String(patch.time) : entry.time;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("วันที่ไม่ถูกต้อง");
      if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("เวลาไม่ถูกต้อง");
      const dup = client.calendar.find((e) => e.id !== entry.id && e.date === date && e.time === time);
      if (dup) throw new Error("ช่องเวลานั้นมีคอนเทนต์อยู่แล้ว");
      entry.date = date;
      entry.time = time;
      // rescheduling a missed entry re-arms it
      if (entry.status === "missed" || entry.status === "rejected") entry.status = "planned";
      delete entry.missedAt;
    }
    if (patch.platform !== undefined && PLATFORMS.includes(patch.platform)) entry.platform = patch.platform;
    if (patch.sku !== undefined) {
      const product = client.products.find((p) => p.sku === patch.sku);
      if (product) {
        entry.sku = product.sku;
        entry.productName = product.name;
      }
    }
    if (patch.angle !== undefined && CONTENT_ANGLES.includes(patch.angle)) entry.angle = patch.angle;
    if (patch.brief !== undefined) entry.brief = String(patch.brief);
    if (patch.caption !== undefined) {
      entry.caption = String(patch.caption); // manual override (deliberate bad-draft test path)
      entry.captionManual = true;
    }
    if (patch.status !== undefined && ENTRY_STATUSES.includes(patch.status) && !entry.inFlight) {
      entry.status = patch.status;
    }
    entry.updatedAt = new Date().toISOString();
    this._write(state);
    return entry;
  }

  deleteCalendarEntry(clientId, entryId) {
    const { state, client, entry } = this._findEntry(clientId, entryId);
    if (entry.inFlight) throw new Error("รายการนี้กำลังรันอยู่ ลบไม่ได้ตอนนี้");
    client.calendar = client.calendar.filter((e) => e.id !== entryId);
    this._write(state);
    return { deleted: entryId };
  }

  // ── auto-plan ──
  _buildFallbackSlots(client, monthStr, postsPerWeek) {
    const { year, month, daysInMonth, weeks } = currentMonthWeeks(monthStr);
    const pad = (n) => String(n).padStart(2, "0");
    const todayStr = bangkokDateStr();
    const isCurrentMonth = todayStr.startsWith(`${year}-${pad(month)}`);
    const todayDay = Number(todayStr.slice(8, 10));
    const existing = new Set((client.calendar || []).filter((e) => e.date && e.date.startsWith(monthStr)).map((e) => `${e.date} ${e.time}`));
    const products = client.products || [];
    if (!products.length) return [];
    const perWeek = clampNumber(postsPerWeek, 1, 7, 5);
    const platformRotation = ["demo", "demo", "facebook", "instagram", "line"];
    const slots = [];
    let productIdx = 0;
    let angleIdx = 0;
    let platformIdx = 0;
    const pushSlot = (day, time) => {
      if (!day) return;
      if (isCurrentMonth && day < todayDay) return;
      const date = `${year}-${pad(month)}-${pad(day)}`;
      if (existing.has(`${date} ${time}`)) return;
      const product = products[productIdx % products.length];
      const angle = CONTENT_ANGLES[angleIdx % CONTENT_ANGLES.length];
      const platform = platformRotation[platformIdx % platformRotation.length];
      existing.add(`${date} ${time}`);
      slots.push({ date, time, sku: product.sku, productName: product.name, angle, platform });
      productIdx += 1;
      angleIdx += 1;
      platformIdx += 1;
    };
    for (const week of weeks) {
      const weekdayCount = Math.max(0, perWeek - 1);
      week.weekdays.slice(0, weekdayCount).forEach((day) => pushSlot(day, "18:30"));
      if (perWeek >= 1) {
        const weekendDay = week.weekend.find((d) => new Date(Date.UTC(year, month - 1, d)).getUTCDay() === 6) ?? week.weekend[0];
        pushSlot(weekendDay, "11:00");
      }
    }
    return slots;
  }

  async autoPlanPreview(clientId, body) {
    const { client } = this._resolveClient(clientId);
    if (!(client.products || []).length) throw new Error("ลูกค้ารายนี้ยังไม่มีสินค้า เพิ่มสินค้าก่อนวางแผนอัตโนมัติ");
    const month = /^\d{4}-\d{2}$/.test(String(body?.month || "")) ? String(body.month) : bangkokMonthStr();
    const postsPerWeek = clampNumber(body?.postsPerWeek, 1, 7, client.settings?.postsPerWeek || 5);
    const fallback = this._buildFallbackSlots(client, month, postsPerWeek);
    let slots = fallback;
    let source = "template";
    if (this._llmReady()) {
      try {
        const llmSlots = await this._llmPlanSlots(client, month, postsPerWeek, fallback.length);
        if (Array.isArray(llmSlots) && llmSlots.length) {
          const valid = new Set(fallback.map((s) => `${s.date} ${s.time}`));
          const seen = new Set();
          const merged = [];
          for (const slot of llmSlots) {
            const key = `${slot.date} ${slot.time}`;
            if (!valid.has(key) || seen.has(key)) continue; // only safe, free, in-month slots
            seen.add(key);
            merged.push(slot);
          }
          for (const slot of fallback) {
            if (merged.length >= Math.max(fallback.length, 1)) break;
            if (!seen.has(`${slot.date} ${slot.time}`)) merged.push(slot);
          }
          if (merged.length) {
            slots = merged;
            source = "llm";
          }
        }
      } catch (err) {
        console.warn("[social-agency] auto-plan LLM fallback:", err.message);
      }
    }
    slots = slots.slice(0, 22);
    return {
      clientId: client.id,
      clientName: client.name,
      month,
      postsPerWeek,
      source,
      slots,
    };
  }

  applyAutoPlan(clientId, body) {
    const { state, client } = this._resolveClient(clientId);
    const month = /^\d{4}-\d{2}$/.test(String(body?.month || "")) ? String(body.month) : bangkokMonthStr();
    const incoming = Array.isArray(body?.slots) ? body.slots : [];
    if (!incoming.length) throw new Error("ยังไม่ได้เลือกช่วงเวลาใด");
    const existing = new Set((client.calendar || []).map((e) => `${e.date} ${e.time}`));
    const now = new Date().toISOString();
    const created = [];
    for (const slot of incoming.slice(0, 30)) {
      const date = String(slot?.date || "");
      const time = String(slot?.time || "18:30");
      if (!date.startsWith(month) || !/^\d{2}:\d{2}$/.test(time)) continue;
      if (existing.has(`${date} ${time}`)) continue;
      const product = client.products.find((p) => p.sku === slot.sku) || client.products[0];
      if (!product) continue;
      const entry = {
        id: newId("cal"),
        date,
        time,
        platform: PLATFORMS.includes(slot.platform) ? slot.platform : "demo",
        sku: product.sku,
        productName: product.name,
        angle: CONTENT_ANGLES.includes(slot.angle) ? slot.angle : CONTENT_ANGLES[0],
        status: "planned",
        createdAt: now,
        updatedAt: now,
      };
      existing.add(`${date} ${time}`);
      client.calendar.push(entry);
      created.push(entry);
    }
    this._write(state);
    return { created, count: created.length };
  }

  // ── local LLM bridge (injected by serve.cjs — same llama-server as Chat) ──
  setLlmClient(llm) {
    this.llm = llm;
  }
  _llmReady() {
    try {
      return Boolean(this.llm && this.llm.isReady && this.llm.isReady());
    } catch {
      return false;
    }
  }
  async _llmChat(messages, options = {}) {
    if (!this._llmReady()) throw new Error("โมเดลภาษาท้องถิ่นยังไม่พร้อม (โหลดโมเดลในแท็บ Text Models ก่อน)");
    return this.llm.chat(messages, options);
  }

  static extractJson(text) {
    if (typeof text !== "string") return null;
    const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  _toneGuide(tone) {
    if (tone === "แอดมินเพจ") {
      return "โทนแอดมินเพจ: เป็นกันเอง กระตือรือร้น ตอบเร็ว ใช้คำลงท้าย นะ/จ้า/เลย อย่างเป็นธรรมชาติ ชวนคุย";
    }
    if (tone === "พนักงานขาย") {
      return "โทนพนักงานขาย: สุภาพ มั่นใจ เน้นประโยชน์ที่ลูกค้าได้ ชวนสอบถาม/ทักแชทแบบไม่เกรงใจ";
    }
    return "โทนเจ้าของแบรนด์: เล่าเรื่องแบบคนทำงานจริง ภูมิใจในงาน เห็นเบื้องหลัง ใช้คำลงท้าย ครับ/ค่ะ/นะ";
  }

  _platformGuide(platform) {
    if (platform === "line") {
      return "แพลตฟอร์ม LINE Official Account (broadcast): ข้อความกระชับไม่เกิน 400 ตัวอักษร เปิดด้วยประโยคทักทายฉันทะมิตร แฮชแท็กไม่เกิน 2 อัน (หรือไม่ใส่ก็ได้) เพราะส่งพร้อมรูปภาพ";
    }
    if (platform === "instagram") {
      return "แพลตฟอร์ม Instagram: บรรทัดแรกต้องเป็น hook สั้นๆ ดึงดูด ไม่เกิน 1 บรรทัด ตามด้วยเนื้อหาสั้นๆ ปิดท้ายแฮชแท็กไทยที่เกี่ยวข้อง 3-8 อัน";
    }
    if (platform === "facebook") {
      return "แพลตฟอร์ม Facebook Page: เนื้อโพสต์ไม่ควรเกิน ~300 ตัวอักษรก่อนถูกตัดด้วย 'ดูเพิ่มเติม' แฮชแท็กไทยที่เกี่ยวข้อง 3-8 อัน";
    }
    return "โพสต์สาธิต (Demo): เนื้อโพสต์อ่านสบายไม่เกิน ~300 ตัวอักษร แฮชแท็กไทยที่เกี่ยวข้อง 3-8 อัน";
  }

  async _llmResearchNotes(client, product, angle) {
    const roles = (client.researcherRoles || []).slice(0, 5);
    const payload = roles.map((r) => ({ role: r.name, questions: r.questions }));
    const raw = await this._llmChat(
      [
        {
          role: "system",
          content:
            "คุณเป็นทีมนักวิจัยคอนเทนต์โซเชียลมีเดียสายไทย ตอบกลับเป็น JSON ล้วนห้ามมีข้อความอื่น รูปแบบ {\"notes\":[{\"role\":\"ชื่อนักวิจัย\",\"notes\":\"โน้ตสั้น 2-4 ประโยค\"}]} โน้ตเป็นภาษาไทยพูดจริง กระชับ เอาไปใช้เขียนโพสต์ได้ทันที",
        },
        {
          role: "user",
          content: `ลูกค้า: ${client.name} (${client.industry})\nสินค้า: ${product?.name || ""} หมวด ${product?.category || ""}\nมุมคอนเทนต์: ${angle}\nนักวิจัยและคำถาม: ${JSON.stringify(payload, null, 0)}`,
        },
      ],
      { json: true, temperature: 0.6, maxTokens: 500, timeoutMs: 240000 }
    );
    const parsed = SocialAgencyRuntime.extractJson(raw);
    const notes = Array.isArray(parsed?.notes) ? parsed.notes : null;
    if (!notes || !notes.length) throw new Error("รูปแบบโน้ตวิจัยไม่ถูกต้อง");
    return notes
      .filter((n) => n && String(n.notes || "").trim())
      .map((n) => ({ role: String(n.role || "นักวิจัย"), notes: String(n.notes).trim().slice(0, 600) }));
  }

  _staticResearchNotes(client, angle) {
    return [
      {
        role: "นักวิจัยตลาด",
        notes: `กลุ่มเป้าหมายของ${client.industry}ส่วนใหญ่ชอบดูของจริงก่อนตัดสินใจ เน้นเล่าจุดที่ทีมใส่ใจ และกรณีใช้งานจริงของ ${angle}`,
      },
      {
        role: "นักวิจัยเทรนด์",
        notes: "คอนเทนต์สั้น + รูปงานจริงเวิร์กสุดตอนนี้ แฮชแท็กควรเกี่ยวกับสินค้าโดยตรง และควรตอบคอมเมนต์เร็วๆ",
      },
    ];
  }

  _composeBrief(client, product, angle, platform, researchNotes) {
    const notes = (researchNotes || []).map((n) => `- ${n.role}: ${n.notes}`).join("\n");
    return [
      `ลูกค้า: ${client.name} (${client.industry}) · โทน: ${client.tone}`,
      `สินค้า: ${product?.name || ""} · หมวด: ${product?.category || ""}`,
      `ขั้นต่ำ: ${product?.minimumOrder || "-"} · เวลาผลิต: ${product?.productionTime || "-"}`,
      `มุมคอนเทนต์: ${angle} · แพลตฟอร์ม: ${platform}`,
      `ข้อมูลที่อ้างได้ (verified): ชื่อสินค้า หมวด ขั้นต่ำ เวลาผลิต${product?.sourceUrl ? " และลิงก์แหล่งที่มา" : ""} เท่านั้น`,
      `โน้ตวิจัย:\n${notes || "(ไม่มี)"}`,
    ].join("\n");
  }

  async _llmCreateCaption({ client, product, angle, platform, brief }) {
    const system = [
      "คุณเป็นแอดมินเพจโซเชียลมีเดียไทยตัวจริงที่เขียนโพสต์ให้แบรนด์ทุกวัน เขียนภาษาไทยแบบคนพูดจริง",
      this._toneGuide(client.tone),
      this._platformGuide(platform),
      "กฎเหล็ก:",
      "- ห้ามใช้วลี: \"ในยุคที่\", \"สำคัญอย่างยิ่ง\", คำโฆษณาโบราณ หรือ buzzword ใส่ๆ",
      "- ห้ามเขียนเป็น bullet list ทั้งโพสต์ และห้ามย่อหน้าสมมาตรซ้ำกันทุกย่อหน้า",
      "- ประโยคสั้น-ยาวสลับกัน ใช้คำลงท้าย ครับ/ค่ะ/นะ ตามธรรมชาติ ใส่อีโมจิที่แอดมินจริงใช้",
      "- ห้ามอ้างราคา ขนาด จำนวนสต๊อก ใบรับรอง หรือสัญญาการจัดส่ง ถ้าไม่มีอยู่ในข้อมูลสินค้าที่ให้มา",
      "- ตอบกลับเฉพาะเนื้อโพสต์เท่านั้น ไม่มีคำอธิบาย ไม่มีเครื่องหมายคำพูด",
    ];
    const examples = this._fewShotExamples(client, platform);
    if (examples.length) {
      system.push(
        "ตัวอย่างสไตล์ที่เจ้าของแบรนด์ชอบ (เขียนให้ใกล้เคียงสไตล์นี้ แต่ห้ามคัดลอกประโยคเดิม):",
        ...examples.map((ex, i) => `--- ตัวอย่างที่ ${i + 1} (${ex.platform || platform}) ---\n${String(ex.caption).slice(0, 400)}`)
      );
    }
    const systemPrompt = system.join("\n");
    const user = `Brief:\n${brief}\n\nเขียนโพสต์ 1 ชิ้นสำหรับมุม "${angle}" ของสินค้านี้`;
    const raw = await this._llmChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
      ],
      { temperature: 0.8, maxTokens: 600, timeoutMs: 300000 }
    );
    const caption = String(raw || "").trim().replace(/^["“]+|["”]+$/g, "");
    if (!caption || caption.length < 20) throw new Error("โมเดลสร้างคำบรรยายไม่สำเร็จ");
    return caption;
  }

  async _llmFixCaption({ caption, issues, client, product, platform, angle }) {
    const raw = await this._llmChat(
      [
        {
          role: "system",
          content: [
            "คุณเป็นบรรณาธิการโพสต์โซเชียลไทย แก้โพสต์ให้ผ่าน AI Check โดยเอาปัญหาที่ระบุมาเป็นเงื่อนไขการแก้ทั้งหมด",
            this._toneGuide(client.tone),
            this._platformGuide(platform),
            "ตอบกลับเฉพาะโพสต์ที่แก้แล้ว ไม่มีคำอธิบาย",
          ].join("\n"),
        },
        {
          role: "user",
          content: `โพสต์เดิม:\n${caption}\n\nปัญหาจาก AI Check ที่ต้องแก้ทั้งหมด:\n- ${issues.join("\n- ")}\n\nข้อมูลสินค้า (อ้างได้เฉพาะสิ่งนี้): ${product?.name || ""} · ${product?.category || ""} · ขั้นต่ำ ${product?.minimumOrder || "-"} · เวลาผลิต ${product?.productionTime || "-"}\nมุมคอนเทนต์: ${angle}`,
        },
      ],
      { temperature: 0.7, maxTokens: 600, timeoutMs: 300000 }
    );
    const fixed = String(raw || "").trim().replace(/^["“]+|["”]+$/g, "");
    if (!fixed || fixed.length < 20) throw new Error("แก้คำบรรยายไม่สำเร็จ");
    return fixed;
  }

  async _llmJudgeCaption({ caption, client, product, platform, threshold }) {
    const rubric = [
      "1) Evidence guardrails: ราคา ขนาด สต๊อก ใบรับรอง คำสัญญาการส่ง ต้องมีในข้อมูลสินค้าเท่านั้น ถ้าอ้างเกินให้ลดคะแนนหนักมาก",
      "2) ภาษาไทยธรรมชาติ: ต้องมี ครับ/ค่ะ/นะ หรือคำลงท้ายธรรมชาติ ประโยคสั้นยาวสลับกัน คำใช้ในชีวิตประจำวัน มีอีโมจิพอดี ห้ามวลี \"ในยุคที่\" \"สำคัญอย่างยิ่ง\" ห้าง buzzword",
      `3) โทนต้องตรง: ${this._toneGuide(client.tone)}`,
      `4) ความเหมาะกับแพลตฟอร์ม: ${this._platformGuide(platform)}`,
      `5) ความถูกต้องของสินค้า: ต้องตรงกับข้อมูลสินค้า (ชื่อ ${product?.name || ""} หมวด ${product?.category || ""} ขั้นต่ำ ${product?.minimumOrder || "-"} เวลาผลิต ${product?.productionTime || "-"})`,
    ].join("\n");
    const ask = (stricter) =>
      this._llmChat(
        [
          {
            role: "system",
            content:
              "คุณเป็นกรรมการตรวจคอนเทนต์ (AI Check) ตอบกลับเป็น JSON ล้วน ห้ามมีข้อความอื่นเด็ดขาด" +
              (stricter ? " ย้ำอีกครั้ง: ตอบเฉพาะ JSON บรรทัดเดียว ไม่มี markdown ไม่มีคำอธิบาย" : ""),
          },
          {
            role: "user",
            content: `ประเมินโพสต์นี้ตามเกณฑ์:\n${rubric}\n\nเกณฑ์ผ่าน: score >= ${threshold} = pass, 60-${threshold - 1} = fix, < 60 = review\n\nโพสต์:\n${caption}\n\nตอบ JSON: {"score":0-100,"categories":{"evidence":0-100,"natural":0-100,"tone":0-100,"platform":0-100,"accuracy":0-100},"issues":["ปัญหาเป็นภาษาไทย"],"verdict":"pass"|"fix"|"review"}`,
          },
        ],
        { json: true, temperature: 0.2, maxTokens: 420, timeoutMs: 240000 }
      );
    const parsed = SocialAgencyRuntime.extractJson(await ask(false));
    if (!parsed || typeof parsed.score !== "number" || !Array.isArray(parsed.issues)) {
      const retry = SocialAgencyRuntime.extractJson(await ask(true));
      if (!retry || typeof retry.score !== "number" || !Array.isArray(retry.issues)) {
        const err = new Error("AI Check อ่านผลไม่ได้ (JSON ไม่ถูกต้อง)");
        err.failSafe = true;
        throw err;
      }
      return retry;
    }
    return parsed;
  }

  async _llmPlanSlots(client, month, postsPerWeek, targetCount) {
    const raw = await this._llmChat(
      [
        {
          role: "system",
          content:
            "คุณเป็นแพลนเนอร์คอนเทนต์โซเชียลมีเดียไทย ตอบกลับเป็น JSON ล้วน รูปแบบ {\"slots\":[{\"date\":\"YYYY-MM-DD\",\"time\":\"HH:mm\",\"sku\":\"...\",\"angle\":\"...\",\"platform\":\"demo|facebook|instagram|line\"}]}",
        },
        {
          role: "user",
          content: `วางแผนโพสต์เดือน ${month} สำหรับ ${client.name} (${client.industry}) ประมาณ ${targetCount} ช่วงเวลา สัปดาห์ละ ${postsPerWeek} โพสต์ (จ-ศ ประมาณ 18:30 + สุดสัปดาห์ 1 ช่อง 11:00)\nสินค้า: ${client.products.map((p) => `${p.sku}=${p.name} (${p.category})`).join(", ")}\nมุมคอนเทนต์ให้หมุนเวียน: ${CONTENT_ANGLES.join(" / ")}\nแพลตฟอร์มส่วนใหญ่ใช้ demo แล้วสลับ facebook/instagram/line บ้าง\nเว้นวันที่เหล่านี้ที่มีคอนเทนต์อยู่แล้ว: ${(client.calendar || []).filter((e) => e.date && e.date.startsWith(month)).map((e) => `${e.date} ${e.time}`).join(", ") || "(ไม่มี)"}`,
        },
      ],
      { json: true, temperature: 0.5, maxTokens: 1400, timeoutMs: 240000 }
    );
    const parsed = SocialAgencyRuntime.extractJson(raw);
    const slots = Array.isArray(parsed?.slots) ? parsed.slots : [];
    const skuSet = new Set(client.products.map((p) => p.sku));
    const monthPrefix = `${month}-`;
    return slots
      .map((s) => ({
        date: String(s?.date || ""),
        time: /^\d{2}:\d{2}$/.test(String(s?.time || "")) ? String(s.time) : "18:30",
        sku: skuSet.has(s?.sku) ? s.sku : client.products[0].sku,
        angle: CONTENT_ANGLES.includes(s?.angle) ? s.angle : CONTENT_ANGLES[Math.floor(Math.random() * CONTENT_ANGLES.length)],
        platform: PLATFORMS.includes(s?.platform) ? s.platform : "demo",
      }))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.date.startsWith(monthPrefix));
  }

  // ── AI Check (local deterministic rules + local LLM judge) ──
  static BANNED_PATTERNS = [
    { re: /ในยุคที่/, label: "ในยุคที่" },
    { re: /สำคัญอย่างยิ่ง/, label: "สำคัญอย่างยิ่ง" },
    { re: /ครบวงจร/, label: "ครบวงจร" },
    { re: /หนึ่งเดียวในตลาด|หนึ่งเดียวในโลก/, label: "หนึ่งเดียวในตลาด/โลก" },
    { re: /ประสบการณ์ระดับพรีเมียม|สุดยอดประสบการณ์/, label: "buzzword พรีเมียม" },
  ];

  _localEvidenceIssues(caption, product) {
    const text = String(caption || "");
    const issues = [];
    const evidenceText = [product?.name, product?.category, product?.minimumOrder, product?.productionTime, product?.decoration]
      .filter(Boolean)
      .join(" ");
    const priceMatch = text.match(/฿\s*\d|\d[\d,]*\s*บาท|ราคา[\s:]*[\d,]+/);
    if (priceMatch && !/บาท/.test(evidenceText)) issues.push(`อ้างราคา "${priceMatch[0].trim()}" ที่ไม่มีในหลักฐานสินค้า`);
    const dimMatch = text.match(/\d+(?:\.\d+)?\s*(?:ซม\.?|เซนติเมตร|cm|มม\.?|mm|นิ้ว|inch)/i);
    if (dimMatch) issues.push(`อ้างขนาด "${dimMatch[0]}" ที่ไม่มีในหลักฐานสินค้า`);
    const stockMatch = text.match(/สต๊อก|คลังสินค้า|พร้อมส่งทันที|เหลือ\s*\d+|มีสินค้าพร้อมส่ง|ส่งฟรี/);
    if (stockMatch) issues.push(`อ้างสต๊อก/คำสัญญาการจัดส่ง "${stockMatch[0]}" ที่ไม่ได้รับอนุมัติ`);
    const certMatch = text.match(/\bISO\s?\d+\b|\bSGS\b|\bFDA\b|\bHACCP\b|\bGMP\b|ได้รับการรับรอง/);
    if (certMatch) issues.push(`อ้างใบรับรอง "${certMatch[0]}" ที่ไม่มีในหลักฐานสินค้า`);
    return issues;
  }

  _localCheck(caption, product, platform, client) {
    const text = String(caption || "");
    const issues = [];
    const evidenceIssues = this._localEvidenceIssues(text, product);
    issues.push(...evidenceIssues);
    const banned = SocialAgencyRuntime.BANNED_PATTERNS.filter((p) => p.re.test(text)).map((p) => `ใช้คำต้องห้าม: "${p.label}"`);
    issues.push(...banned);
    const hasParticles = /(ครับ|ค่ะ|คะ|นะ|จ้า|จ๊ะ|น่ะ)/.test(text);
    if (!hasParticles) issues.push("ไม่มีคำลงท้ายธรรมชาติ (ครับ/ค่ะ/นะ) อ่านเป็นหุ่นยนต์");
    const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}]/u.test(text);
    if (!hasEmoji) issues.push("ไม่มีอีโมจิเลย แอดมินจริงใช้บ้าง");
    const hashtags = text.match(/(^|\s)#[^\s#]+/g) || [];
    const hashtagCount = hashtags.length;
    const bodyOnly = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n")
      .trim();
    let platformIssue = null;
    if (platform === "line") {
      if (text.length > 420) platformIssue = `ข้อความยาว ${text.length} ตัวอักษร เกินสำหรับ LINE broadcast (~400)`;
      else if (hashtagCount > 2) platformIssue = `แฮชแท็ก ${hashtagCount} อัน เกินกว่าที่ LINE ควรใช้ (0-2)`;
    } else if (platform === "instagram") {
      const firstLine = text.split("\n")[0] || "";
      if (firstLine.length > 90) platformIssue = "hook บรรทัดแรกยาวเกินไป ควรสั้นและดึงดูด";
      else if (hashtagCount < 3 || hashtagCount > 8) platformIssue = `แฮชแท็ก ${hashtagCount} อัน ควรเป็น 3-8 อัน`;
    } else {
      if (bodyOnly.length > 320) platformIssue = `เนื้อโพสต์ ${bodyOnly.length} ตัวอักษร โดนตัดด้วย "ดูเพิ่มเติม" (ควร ≤ ~300)`;
      else if (hashtagCount < 3 || hashtagCount > 8) platformIssue = `แฮชแท็ก ${hashtagCount} อัน ควรเป็น 3-8 อัน`;
    }
    if (platformIssue) issues.push(platformIssue);
    const sentences = text
      .replace(/#[^\s#]+/g, "")
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3);
    const lengths = sentences.map((s) => s.length);
    const monotone = lengths.length >= 3 && Math.max(...lengths) - Math.min(...lengths) < 8;
    if (monotone) issues.push("ประโยคความยาวเดียวกันเกือบหมด ควรสั้น-ยาวสลับกัน");
    const nameWords = String(product?.name || "")
      .replace(/[A-Z]{2,4}-\d{3}/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    const mentionsProduct = !nameWords.length || nameWords.some((w) => text.includes(w)) || text.includes(String(product?.name || "\u0000"));
    if (!mentionsProduct) issues.push("ไม่กล่าวถึงชื่อสินค้าเลย");
    const foreignSku = text.match(/\b[A-Z]{2,4}-\d{3}\b/g) || [];
    const wrongSku = foreignSku.find((sku) => sku !== product?.sku);
    if (wrongSku) issues.push(`กล่าวถึง SKU อื่น (${wrongSku}) ไม่ตรงกับสินค้าของโพสต์นี้`);

    // score
    let score = 85;
    if (evidenceIssues.length) score -= 35;
    score -= Math.min(24, banned.length * 12);
    if (!hasParticles) score -= 15;
    if (!hasEmoji) score -= 6;
    if (monotone) score -= 5;
    if (platformIssue) score -= 12;
    if (!mentionsProduct) score -= 12;
    if (wrongSku) score -= 15;
    score = Math.max(0, Math.min(100, score));
    return {
      score,
      issues,
      evidenceViolation: evidenceIssues.length > 0,
      hasParticles,
      hashtagCount,
      bodyLength: bodyOnly.length,
      categories: {
        evidence: evidenceIssues.length ? 20 : 90,
        natural: (hasParticles ? 85 : 50) + (hasEmoji ? 5 : 0) - (monotone ? 10 : 0),
        tone: 82,
        platform: platformIssue ? 55 : 88,
        accuracy: (mentionsProduct ? 88 : 50) - (wrongSku ? 30 : 0),
      },
    };
  }

  async _aiCheck({ caption, client, product, platform }) {
    const threshold = clampNumber(client.settings?.threshold, 50, 95, 80);
    const local = this._localCheck(caption, product, platform, client);
    let score = local.score;
    let issues = [...local.issues];
    let categories = local.categories;
    let llmUsed = false;
    if (this._llmReady()) {
      try {
        const judged = await this._llmJudgeCaption({ caption, client, product, platform, threshold });
        llmUsed = true;
        score = Math.max(0, Math.min(100, Math.round(Number(judged.score) || 0)));
        const llmIssues = (judged.issues || []).map((i) => String(i)).filter(Boolean).slice(0, 8);
        const merged = [...issues];
        for (const issue of llmIssues) if (!merged.includes(issue)) merged.push(issue);
        issues = merged;
        if (judged.categories && typeof judged.categories === "object") categories = judged.categories;
      } catch (err) {
        if (err.failSafe) {
          // malformed judge JSON twice → fail safe to needs_review, never crash the run
          return {
            score: null,
            verdict: "review",
            issues: ["AI Check อ่านผลจากโมเดลไม่ได้ (JSON ไม่ถูกต้อง) — ส่งเข้าคิวอนุมัติเพื่อความปลอดภัย", ...issues],
            categories,
            llmUsed: false,
            failSafe: true,
          };
        }
        console.warn("[social-agency] judge fallback to local rules:", err.message);
      }
    }
    // Hard guardrails always apply, even on top of the LLM judge.
    if (local.evidenceViolation) {
      score = Math.min(score, 50);
      issues = Array.from(new Set([...issues]));
    }
    if (SocialAgencyRuntime.BANNED_PATTERNS.some((p) => p.re.test(caption))) score = Math.min(score, 60);
    if (!local.hasParticles) score = Math.min(score, 55);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const verdict = score >= threshold ? "pass" : score >= 60 ? "fix" : "review";
    if (local.evidenceViolation) {
      return { score, verdict: "review", issues, categories, llmUsed, hardFail: true };
    }
    return { score, verdict, issues, categories, llmUsed };
  }

  // ── run log (ring buffer across all clients) ──
  _pushRunLog(state, run, clientName) {
    state.runLog = state.runLog || [];
    state.runLog.unshift({
      runId: run.id,
      clientId: run.clientId,
      clientName,
      entryId: run.entryId,
      label: run.label,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      late: Boolean(run.late),
    });
    state.runLog = state.runLog.slice(0, RUN_LOG_LIMIT);
  }

  _syncRunLog(state, run, clientName) {
    state.runLog = state.runLog || [];
    const item = state.runLog.find((r) => r.runId === run.id);
    const summary = {
      runId: run.id,
      clientId: run.clientId,
      clientName,
      entryId: run.entryId,
      label: run.label,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      late: Boolean(run.late),
    };
    if (item) Object.assign(item, summary);
    else state.runLog.unshift(summary);
    state.runLog = state.runLog.slice(0, RUN_LOG_LIMIT);
  }

  _mutateRun(clientId, runId, mutator) {
    const state = this._read();
    const client = state.clients.find((c) => c.id === clientId);
    if (!client) return null;
    const run = (client.workflowRuns || []).find((r) => r.id === runId);
    if (!run) return null;
    const entry = (client.calendar || []).find((e) => e.id === run.entryId);
    const result = mutator(run, client, entry, state);
    if (["success", "failed", "needs_review"].includes(run.status)) this._releaseRun(run.id);
    this._syncRunLog(state, run, client.name);
    this._write(state);
    return result;
  }

  async _nodeStep(clientId, runId, nodeKey, fn) {
    const t0 = Date.now();
    this._mutateRun(clientId, runId, (run) => {
      const node = run.nodes.find((n) => n.key === nodeKey);
      if (node) {
        node.status = "running";
        node.startedAt = new Date().toISOString();
      }
    });
    try {
      const result = (await fn()) || {};
      this._mutateRun(clientId, runId, (run, client, entry) => {
        const node = run.nodes.find((n) => n.key === nodeKey);
        if (node) {
          node.status = "done";
          node.finishedAt = new Date().toISOString();
          node.durationMs = Date.now() - t0;
          if (result.output !== undefined) node.output = String(result.output);
          if (result.detail !== undefined) node.detail = String(result.detail ?? "");
          if (result.check) {
            node.check = result.check;
            run.check = result.check;
          }
        }
        if (result.entryPatch && entry) {
          Object.assign(entry, result.entryPatch);
          entry.updatedAt = new Date().toISOString();
        }
      });
      return result;
    } catch (err) {
      this._mutateRun(clientId, runId, (run, client, entry) => {
        const node = run.nodes.find((n) => n.key === nodeKey);
        if (node) {
          node.status = "failed";
          node.finishedAt = new Date().toISOString();
          node.durationMs = Date.now() - t0;
          node.error = err.message;
        }
        run.status = "failed";
        run.error = err.message;
        run.finishedAt = new Date().toISOString();
        run.durationMs = Date.now() - new Date(run.startedAt).getTime();
        if (entry) {
          entry.status = "failed";
          entry.inFlight = false;
          entry.updatedAt = new Date().toISOString();
        }
      });
      throw err;
    }
  }

  _failRun(clientId, runId, message) {
    this._mutateRun(clientId, runId, (run, client, entry) => {
      run.status = "failed";
      run.error = message;
      run.finishedAt = new Date().toISOString();
      run.durationMs = Date.now() - new Date(run.startedAt).getTime();
      if (entry) {
        entry.status = "failed";
        entry.inFlight = false;
        entry.updatedAt = new Date().toISOString();
      }
    });
  }

  // ── the workflow engine (nodes 2-8 of the chain) ──
  runWorkflow(clientId, entryId, options = {}) {
    const { trigger = "manual", force = false, late = false } = options;
    const { state, client, entry } = this._findEntry(clientId, entryId);
    if (entry.inFlight) throw new Error("เวิร์กโฟลว์นี้กำลังรันอยู่แล้ว");
    const nowIso = new Date().toISOString();
    entry.inFlight = true;
    entry.status = "in_workflow";
    entry.updatedAt = nowIso;
    const run = {
      id: newId("run"),
      clientId: client.id,
      entryId: entry.id,
      label: `${entry.productName} · ${entry.platform} · ${entry.date} ${entry.time}`,
      trigger,
      late,
      status: "running",
      startedAt: nowIso,
      finishedAt: null,
      durationMs: null,
      nodes: NODE_DEFS.map((d) => ({ key: d.key, label: d.label, status: "idle", startedAt: null, finishedAt: null, durationMs: 0, output: "", detail: "" })),
      check: null,
      gate: null,
      publish: null,
    };
    entry.workflowRunId = run.id;
    client.workflowRuns = [run, ...(client.workflowRuns || [])].slice(0, MAX_RUNS_PER_CLIENT);
    this._pushRunLog(state, run, client.name);
    this._write(state); // persist the transition BEFORE any work starts (idempotency)
    this._executeWorkflow(client.id, entry.id, run.id, { trigger, force, late }).catch((err) => {
      console.error("[social-agency] workflow crashed:", err);
      this._failRun(client.id, run.id, err.message || "workflow crashed");
    });
    return { runId: run.id, status: "running", entryId: entry.id };
  }

  async _executeWorkflow(clientId, entryId, runId, ctx) {
    const startedMs = Date.now();
    const fresh = () => {
      const state = this._read();
      const client = state.clients.find((c) => c.id === clientId);
      const entry = (client.calendar || []).find((e) => e.id === entryId);
      const run = (client.workflowRuns || []).find((r) => r.id === runId);
      const product = client.products.find((p) => p.sku === entry.sku) || client.products[0];
      return { state, client, entry, run, product };
    };

    // 1. schedule trigger
    await this._nodeStep(clientId, runId, "schedule", async () => {
      const { entry } = fresh();
      return {
        output: `กำหนดเผยแพร่ ${entry.date} ${entry.time} (Asia/Bangkok)${ctx.late ? " · รันช้ากว่ากำหนด" : ""}`,
        detail: `trigger: ${ctx.trigger}${ctx.late ? " · late" : ""}`,
      };
    });

    // 2. research
    let researchNotes = [];
    await this._nodeStep(clientId, runId, "research", async () => {
      const { client, entry, product } = fresh();
      let source = "template";
      try {
        researchNotes = await this._llmResearchNotes(client, product, entry.angle);
        source = "llm";
      } catch (err) {
        console.warn("[social-agency] research fallback:", err.message);
        researchNotes = this._staticResearchNotes(client, entry.angle);
      }
      return {
        output: researchNotes.map((n) => `${n.role}: ${n.notes.slice(0, 60)}${n.notes.length > 60 ? "…" : ""}`).join(" · ").slice(0, 160),
        detail: researchNotes.map((n) => `【${n.role}】\n${n.notes}`).join("\n\n") + `\n\n(แหล่ง: ${source})`,
      };
    });

    // 3. brief
    await this._nodeStep(clientId, runId, "brief", async () => {
      const { client, entry, product } = fresh();
      const brief = entry.brief && String(entry.brief).trim() ? entry.brief : this._composeBrief(client, product, entry.angle, entry.platform, researchNotes);
      return {
        output: `Brief ${brief.length} ตัวอักษร${entry.brief ? " (ใช้ฉบับที่แก้เอง)" : " (สร้างอัตโนมัติ)"}`,
        detail: brief,
        entryPatch: { brief },
      };
    });

    // 4. create
    await this._nodeStep(clientId, runId, "create", async () => {
      const { client, entry, product } = fresh();
      let caption;
      let source = "llm";
      if (entry.captionManual && entry.caption) {
        caption = entry.caption;
        source = "manual";
      } else {
        try {
          caption = await this._llmCreateCaption({ client, product, angle: entry.angle, platform: entry.platform, brief: entry.brief });
        } catch (err) {
          console.warn("[social-agency] create fallback to template:", err.message);
          caption = buildTemplateCaption(product, { angle: entry.angle, platform: entry.platform, tone: client.tone });
          source = "template";
        }
      }
      const imagePrompt = buildTemplateImagePrompt(product, { angle: entry.angle });
      return {
        output: caption.replace(/\n+/g, " ").slice(0, 110) + (caption.length > 110 ? "…" : ""),
        detail: `${caption}\n\n— image prompt สำหรับ Image workspace —\n${imagePrompt}\n(แหล่ง: ${source})`,
        entryPatch: { caption, imagePrompt, captionSource: source },
      };
    });

    // 5. AI Check (+ 6. auto-fix loop, max 2 passes)
    let check = null;
    const runCheck = async (passLabel) => {
      const { client, entry, product } = fresh();
      check = await this._aiCheck({ caption: entry.caption, client, product, platform: entry.platform });
      return check;
    };
    await this._nodeStep(clientId, runId, "check", async () => {
      const check1 = await runCheck("หลังเขียน");
      const detail = `ผ่านที่ 1 · score ${check1.score ?? "-"} · verdict ${check1.verdict}\nปัญหา:\n- ${(check1.issues || []).join("\n- ") || "(ไม่มี)"}`;
      return {
        output: `score ${check1.score ?? "-"} · verdict ${check1.verdict}`,
        detail,
        check: check1,
      };
    });
    if (check && check.verdict === "fix" && !check.failSafe) {
      for (let pass = 1; pass <= 2; pass += 1) {
        let fixedCaption = null;
        try {
          await this._nodeStep(clientId, runId, "autofix", async () => {
            const { client, entry, product } = fresh();
            const currentCheck = check;
            fixedCaption = await this._llmFixCaption({ caption: entry.caption, issues: currentCheck.issues, client, product, platform: entry.platform, angle: entry.angle });
            return {
              output: `แก้รอบที่ ${pass} ตาม ${currentCheck.issues.length} ปัญหา`,
              detail: `รอบที่ ${pass} แก้จากปัญหา:\n- ${currentCheck.issues.join("\n- ")}\n\nผลลัพธ์:\n${fixedCaption}`,
              entryPatch: { caption: fixedCaption },
            };
          });
        } catch (err) {
          // auto-fix unavailable (e.g. no LLM) → go to human review
          this._mutateRun(clientId, runId, (run, client, entry) => {
            const node = run.nodes.find((n) => n.key === "autofix");
            if (node) {
              node.status = "waiting";
              node.output = "แก้อัตโนมัติไม่สำเร็จ ส่งเข้าคิวอนุมัติ";
              node.detail = String(err.message || err);
            }
          });
          check = { ...check, verdict: "review", issues: [...(check.issues || []), `แก้อัตโนมัติไม่สำเร็จ: ${err.message}`] };
          break;
        }
        const recheck = await runCheck(`หลังแก้รอบที่ ${pass}`);
        this._mutateRun(clientId, runId, (run) => {
          const node = run.nodes.find((n) => n.key === "check");
          if (node) {
            node.detail += `\n\nผ่านที่ ${pass + 1} (หลัง auto-fix) · score ${recheck.score ?? "-"} · verdict ${recheck.verdict}`;
            node.output = `score ${recheck.score ?? "-"} · verdict ${recheck.verdict}`;
            node.check = recheck;
            run.check = recheck;
          }
        });
        check = recheck;
        if (check.verdict !== "fix") break;
        if (pass === 2) {
          check = { ...check, verdict: "review", issues: [...(check.issues || []), "แก้ 2 รอบแล้วคะแนนยังไม่ผ่าน ส่งเข้าคิวอนุมัติ"] };
        }
      }
    }

    // 7. gate
    const { client: gateClient } = fresh();
    const threshold = clampNumber(gateClient.settings?.threshold, 50, 95, 80);
    const gatePass = ctx.force || (check && check.score !== null && check.score >= threshold);
    if (!gatePass) {
      this._mutateRun(clientId, runId, (run, client, entry) => {
        const node = run.nodes.find((n) => n.key === "gate");
        if (node) {
          node.status = "waiting";
          node.output = `รอการอนุมัติจากคน (score ${check?.score ?? "-"} < ${threshold})`;
          node.detail = `คะแนน ${check?.score ?? "-"} ยังไม่ถึงเกณฑ์ ${threshold} — เข้าคิวอนุมัติ\nปัญหา:\n- ${(check?.issues || []).join("\n- ") || "(ไม่มี)"}`;
        }
        const publishNode = run.nodes.find((n) => n.key === "publish");
        if (publishNode) publishNode.status = "waiting";
        run.status = "needs_review";
        run.gate = { decision: "review", reason: `score ${check?.score ?? "-"} < ${threshold}` };
        run.finishedAt = new Date().toISOString();
        run.durationMs = Date.now() - startedMs;
        if (entry) {
          entry.status = "needs_review";
          entry.inFlight = false;
          entry.updatedAt = new Date().toISOString();
        }
      });
      return { outcome: "needs_review" };
    }
    await this._nodeStep(clientId, runId, "gate", async () => ({
      output: ctx.force ? "ผ่าน — อนุมัติโดยคน" : `ผ่านอัตโนมัติ (score ${check?.score} >= ${threshold})`,
      detail: ctx.force ? "ผู้ใช้อนุมัติเองจากคิวอนุมัติ" : `คะแนน ${check?.score} ถึงเกณฑ์ ${threshold} → เผยแพร่อัตโนมัติ`,
    }));

    // 8. publisher
    await this._mutateRun(clientId, runId, (run, client, entry) => {
      if (entry) {
        entry.status = "publishing";
        entry.updatedAt = new Date().toISOString();
      }
    });
    await this._nodeStep(clientId, runId, "publish", async () => {
      const { client, entry } = fresh();
      const result = await this._publishWithRetry(client, entry, ctx);
      const patch = {
        status: "published",
        publishedAt: new Date().toISOString(),
        postId: result.postId,
        publishMode: result.mode,
        dryRun: result.mode !== "live",
      };
      this._mutateRun(clientId, runId, (run) => {
        run.publish = { ...result, at: patch.publishedAt };
      });
      const platformLabel = { demo: "Demo", facebook: "Facebook Page", instagram: "Instagram", line: "LINE OA" }[entry.platform] || entry.platform;
      return {
        output: `${platformLabel} · โหมด ${result.mode} · ID ${result.postId} · ${result.latencyMs}ms`,
        detail: `แพลตฟอร์ม: ${platformLabel}\nโหมด: ${result.mode}${result.note ? `\nหมายเหตุ: ${result.note}` : ""}\npost/message ID: ${result.postId}\nเวลาที่ใช้: ${result.latencyMs}ms`,
        entryPatch: patch,
      };
    });

    // 9. result
    await this._nodeStep(clientId, runId, "result", async () => {
      const { entry, run } = fresh();
      const summary = `เผยแพร่สำเร็จ · ${entry.productName} · ${entry.platform}${run.publish ? ` · ${run.publish.mode}` : ""} · ใช้เวลารวม ${Math.round((Date.now() - startedMs) / 100) / 10}s`;
      return { output: summary, detail: summary };
    });
    this._mutateRun(clientId, runId, (run, client, entry) => {
      run.status = "success";
      run.finishedAt = new Date().toISOString();
      run.durationMs = Date.now() - startedMs;
      if (entry) {
        entry.inFlight = false;
        entry.updatedAt = run.finishedAt;
      }
    });
    this._maybeNotify(clientId, "เผยแพร่สำเร็จ", `${runId}`);
    return { outcome: "published" };
  }

  // transient errors (5xx/network) retry once after 30s, then failed
  async _publishWithRetry(client, entry, ctx) {
    try {
      return await this._publishEntry(client, entry, ctx);
    } catch (err) {
      if (this._isTransientError(err)) {
        await sleep(30 * 1000);
        return await this._publishEntry(client, entry, ctx);
      }
      throw err;
    }
  }

  _isTransientError(err) {
    const msg = String(err?.message || "");
    return /network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|HTTP 5\d\d|timeout/i.test(msg);
  }

  approveEntry(clientId, entryId) {
    const { client, entry } = this._findEntry(clientId, entryId);
    if (entry.inFlight) throw new Error("รายการนี้กำลังรันอยู่");
    if (entry.status === "published") throw new Error("รายการนี้เผยแพร่แล้ว");
    return this.runWorkflow(client.id, entry.id, { trigger: "approve", force: true });
  }

  rejectEntry(clientId, entryId) {
    const { state, client, entry } = this._findEntry(clientId, entryId);
    if (entry.inFlight) throw new Error("รายการนี้กำลังรันอยู่");
    entry.status = "rejected";
    entry.updatedAt = new Date().toISOString();
    this._write(state);
    return entry;
  }

  listRuns(clientId, entryId) {
    const { client } = this._resolveClient(clientId);
    let runs = client.workflowRuns || [];
    if (entryId) runs = runs.filter((r) => r.entryId === entryId);
    return runs;
  }

  listRunLog() {
    const state = this._read();
    return state.runLog || [];
  }

  // ── HTTPS helpers ──
  static async _https({ method = "GET", host, path: urlPath, headers = {}, body = null, timeoutMs = HTTP_TIMEOUT_MS }) {
    return new Promise((resolve, reject) => {
      const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
      const finalHeaders = data ? { ...headers, "Content-Length": data.length } : { ...headers };
      const req = https.request({ method, host, path: urlPath, headers: finalHeaders, timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode || 0, json: parsed, text });
        });
      });
      req.on("timeout", () => req.destroy(new Error("network timeout")));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  static _multipart(fields, fileField, fileBuffer, filename) {
    const boundary = `----LukeSocialAgency${crypto.randomBytes(8).toString("hex")}`;
    const parts = [];
    for (const [key, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`, "utf8"));
    }
    if (fileBuffer) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`, "utf8"));
      parts.push(fileBuffer);
      parts.push(Buffer.from("\r\n", "utf8"));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  _mutateClient(clientId, mutator) {
    const state = this._read();
    const client = state.clients.find((c) => c.id === clientId);
    if (!client) return;
    mutator(client, state);
    this._write(state);
  }

  // ── connector secrets (server-side only, gitignored file, masked in API) ──
  _readSecrets() {
    try {
      const data = JSON.parse(fs.readFileSync(this.connectorsFile, "utf8"));
      if (data && typeof data === "object" && data.clients) return data;
    } catch {}
    return { version: 1, clients: {} };
  }

  _writeSecrets(data) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const tmp = `${this.connectorsFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, this.connectorsFile);
  }

  _getSecrets(clientId) {
    const all = this._readSecrets();
    return all.clients[clientId] || {};
  }

  _setSecrets(clientId, platforms) {
    const all = this._readSecrets();
    all.clients[clientId] = { ...(all.clients[clientId] || {}), ...platforms };
    this._writeSecrets(all);
  }

  _deleteConnectorSecrets(clientId) {
    const all = this._readSecrets();
    if (all.clients[clientId]) {
      delete all.clients[clientId];
      this._writeSecrets(all);
    }
  }

  static _maskToken(value) {
    const v = String(value || "");
    if (!v) return "";
    return `••••${v.slice(-4)}`;
  }

  static _isMasked(value) {
    return typeof value === "string" && value.startsWith("••••");
  }

  _connectorConfigured(platform, secrets) {
    const s = secrets || {};
    if (platform === "facebook") return Boolean(s.pageId && s.accessToken);
    if (platform === "instagram") return Boolean(s.igUserId && s.accessToken);
    if (platform === "line") return Boolean(s.channelAccessToken);
    return platform === "demo";
  }

  getConnectorsView(clientId) {
    const { client } = this._resolveClient(clientId);
    const secrets = this._getSecrets(client.id);
    const meta = client.connectors || defaultConnectorMeta();
    const mask = SocialAgencyRuntime._maskToken;
    return {
      clientId: client.id,
      settings: client.settings,
      demo: { available: true, ...meta.demo },
      facebook: {
        configured: this._connectorConfigured("facebook", secrets.facebook),
        pageId: secrets.facebook?.pageId || "",
        accessToken: mask(secrets.facebook?.accessToken),
        hasToken: Boolean(secrets.facebook?.accessToken),
        ...meta.facebook,
      },
      instagram: {
        configured: this._connectorConfigured("instagram", secrets.instagram),
        igUserId: secrets.instagram?.igUserId || "",
        accessToken: mask(secrets.instagram?.accessToken),
        hasToken: Boolean(secrets.instagram?.accessToken),
        imgbbApiKey: mask(secrets.instagram?.imgbbApiKey),
        hasImgbbKey: Boolean(secrets.instagram?.imgbbApiKey),
        ...meta.instagram,
      },
      line: {
        configured: this._connectorConfigured("line", secrets.line),
        channelAccessToken: mask(secrets.line?.channelAccessToken),
        hasToken: Boolean(secrets.line?.channelAccessToken),
        ...meta.line,
      },
    };
  }

  saveConnectors(clientId, body) {
    const { state, client } = this._resolveClient(clientId);
    const incoming = (body && body.connectors) || {};
    const platformSecretFields = {
      facebook: ["pageId", "accessToken"],
      instagram: ["igUserId", "accessToken", "imgbbApiKey"],
      line: ["channelAccessToken"],
    };
    const secrets = this._getSecrets(client.id);
    for (const [platform, fields] of Object.entries(platformSecretFields)) {
      const patch = incoming[platform] || {};
      const current = secrets[platform] || {};
      for (const field of fields) {
        if (patch[field] === undefined) continue;
        if (SocialAgencyRuntime._isMasked(patch[field])) continue; // masked echo → keep existing
        current[field] = String(patch[field] || "").trim();
      }
      secrets[platform] = current;
      if (typeof patch.dryRun === "boolean") client.connectors[platform].dryRun = patch.dryRun;
      if (platform === "line" && typeof patch.sendImageTextStack === "boolean") {
        client.connectors.line.sendImageTextStack = patch.sendImageTextStack;
      }
    }
    this._setSecrets(client.id, secrets);
    if (body && body.settings && typeof body.settings === "object") {
      const s = body.settings;
      const merged = { ...client.settings };
      if (s.threshold !== undefined) merged.threshold = clampNumber(s.threshold, 50, 95, 80);
      if (s.postsPerWeek !== undefined) merged.postsPerWeek = clampNumber(s.postsPerWeek, 1, 7, 5);
      if (s.timezone !== undefined) merged.timezone = TZ_LABEL; // scheduler is Asia/Bangkok
      if (typeof s.dryRun === "boolean") merged.dryRun = s.dryRun;
      if (typeof s.notify === "boolean") merged.notify = s.notify && process.platform === "darwin";
      if (typeof s.weeklySummaryLine === "boolean") merged.weeklySummaryLine = s.weeklySummaryLine;
      client.settings = merged;
    }
    this._write(state);
    return this.getConnectorsView(client.id);
  }

  async testConnector(clientId, platform, fieldsOverride) {
    const { client } = this._resolveClient(clientId);
    if (!PLATFORMS.includes(platform)) throw new Error("ไม่รู้จักแพลตฟอร์มนี้");
    const secrets = this._getSecrets(client.id);
    const override = fieldsOverride || {};
    const merged = { ...(secrets[platform] || {}) };
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined || SocialAgencyRuntime._isMasked(value)) continue;
      merged[key] = String(value || "").trim();
    }
    let result;
    try {
      if (platform === "demo") {
        result = { ok: true, message: "Demo publisher พร้อมใช้งานเสมอ — จำลองการเผยแพร่ให้ทุกลูกค้า" };
      } else if (platform === "facebook") {
        if (!merged.pageId || !merged.accessToken) throw new Error("กรอก Page ID และ Page Access Token ก่อนทดสอบ");
        const res = await SocialAgencyRuntime._https({
          host: FB_GRAPH_HOST,
          path: `/${FB_API_VERSION}/${encodeURIComponent(merged.pageId)}?fields=name&access_token=${encodeURIComponent(merged.accessToken)}`,
        });
        if (res.status >= 300 || res.json?.error) throw new Error(res.json?.error?.message || `Facebook ตอบ HTTP ${res.status}`);
        result = { ok: true, message: `เชื่อมต่อสำเร็จ — หน้า "${res.json?.name || merged.pageId}"`, name: res.json?.name };
      } else if (platform === "instagram") {
        if (!merged.igUserId || !merged.accessToken) throw new Error("กรอก IG User ID และ Access Token ก่อนทดสอบ");
        const res = await SocialAgencyRuntime._https({
          host: FB_GRAPH_HOST,
          path: `/${FB_API_VERSION}/${encodeURIComponent(merged.igUserId)}?fields=username&access_token=${encodeURIComponent(merged.accessToken)}`,
        });
        if (res.status >= 300 || res.json?.error) throw new Error(res.json?.error?.message || `Instagram ตอบ HTTP ${res.status}`);
        const imgbbNote = merged.imgbbApiKey ? "" : " (ยังไม่ได้ใส่ imgbb API key — จะอัปโหลดรูปเป็นสาธารณะไม่ได้)";
        result = { ok: true, message: `เชื่อมต่อสำเร็จ — บัญชี @${res.json?.username || merged.igUserId}${imgbbNote}`, name: res.json?.username };
      } else if (platform === "line") {
        if (!merged.channelAccessToken) throw new Error("กรอก Messaging API Channel Access Token ก่อนทดสอบ");
        const res = await SocialAgencyRuntime._https({
          host: LINE_HOST,
          path: "/v2/bot/info",
          headers: { Authorization: `Bearer ${merged.channelAccessToken}` },
        });
        if (res.status >= 300 || res.json?.message) throw new Error(res.json?.message || `LINE ตอบ HTTP ${res.status}`);
        result = { ok: true, message: `เชื่อมต่อสำเร็จ — บัญชี "${res.json?.displayName || "LINE OA"}"`, name: res.json?.displayName };
      } else {
        throw new Error("ไม่รู้จักแพลตฟอร์มนี้");
      }
    } catch (err) {
      this._mutateClient(client.id, (c) => {
        c.connectors[platform].testedAt = new Date().toISOString();
        c.connectors[platform].testOk = false;
      });
      throw err;
    }
    this._mutateClient(client.id, (c) => {
      c.connectors[platform].testedAt = new Date().toISOString();
      c.connectors[platform].testOk = true;
    });
    return result;
  }

  // ── publishers ──
  async _dryPublish(platform, configured) {
    const t0 = Date.now();
    await sleep(800);
    return {
      platform,
      mode: "dry",
      postId: `dry-${crypto.randomBytes(4).toString("hex")}`,
      latencyMs: Date.now() - t0,
      note: configured ? "โหมดทดลอง (dry-run) ยังไม่ได้ส่งจริง — ปิด dry-run ใน Connectors เมื่อพร้อม" : "ยังไม่ได้ตั้งค่า connector จึงจำลองการเผยแพร่",
    };
  }

  async _imgbbUpload(image, apiKey) {
    let buffer = image.buffer;
    if (!buffer && image.path) buffer = fs.readFileSync(image.path);
    if (!buffer) throw new Error("ไม่มีไฟล์รูปภาพให้อัปโหลด");
    const { body, contentType } = SocialAgencyRuntime._multipart({ key: apiKey }, "image", buffer, image.filename || "post.jpg");
    const res = await SocialAgencyRuntime._https({
      method: "POST",
      host: IMGBB_HOST,
      path: "/1/upload",
      headers: { "Content-Type": contentType },
      body,
      timeoutMs: 60 * 1000,
    });
    if (res.status >= 300 || !res.json?.data) throw new Error(`อัปโหลดรูปไป imgbb ไม่สำเร็จ (HTTP ${res.status})`);
    return res.json.data.display_url || res.json.data.url;
  }

  async _publicImageUrl(client, entry) {
    const image = entry.image || {};
    if (image.publicUrl && /^https:\/\//.test(image.publicUrl)) return image.publicUrl;
    const secrets = this._getSecrets(client.id);
    const apiKey = secrets.instagram?.imgbbApiKey || secrets.line?.imgbbApiKey;
    if (!apiKey) throw new Error("ต้องมี URL รูปแบบสาธารณะ (https) หรือใส่ imgbb API key เพื่ออัปโหลดรูปก่อน");
    if (!image.path && !image.buffer) throw new Error("ไม่มีรูปภาพแนบอยู่ในรายการนี้");
    return this._imgbbUpload(image, apiKey);
  }

  async _publishEntry(client, entry, ctx) {
    const platform = entry.platform;
    if (platform === "demo") {
      const t0 = Date.now();
      await sleep(800);
      return { platform, mode: "demo", postId: `demo-${crypto.randomBytes(4).toString("hex")}`, latencyMs: Date.now() - t0, note: "Demo publisher — จำลองการเผยแพร่ 800ms" };
    }
    const secrets = this._getSecrets(client.id);
    const secret = secrets[platform] || {};
    const meta = (client.connectors || {})[platform] || {};
    // NOTE: _connectorConfigured expects per-platform secrets (secret), NOT the whole-client map (secrets).
    // Passing the whole map made `configured` always false, so publishing silently dry-ran forever.
    const configured = this._connectorConfigured(platform, secret);
    const dueMs = bangkokToUtcMs(entry.date, entry.time);
    const manualEarly = ctx.trigger === "manual" && Number.isFinite(dueMs) && dueMs > Date.now();
    const live = configured && meta.dryRun === false && !manualEarly;
    if (!live) return this._dryPublish(platform, configured);

    const t0 = Date.now();
    if (platform === "facebook") {
      if (meta.lastPublishAt && Date.now() - Date.parse(meta.lastPublishAt) < FB_MIN_INTERVAL_MS) {
        throw new Error("Facebook Page ควรเว้นจังหวะโพสต์อย่างน้อย 5 นาที — ลองอีกครั้งเร็วๆ นี้");
      }
      let postId;
      if (entry.image && (entry.image.publicUrl || entry.image.path)) {
        let buffer = entry.image.buffer;
        if (!buffer && entry.image.path) buffer = fs.readFileSync(entry.image.path);
        const { body, contentType } = SocialAgencyRuntime._multipart(
          { caption: entry.caption || "", access_token: secret.accessToken },
          "source",
          buffer,
          entry.image.filename || "post.jpg"
        );
        const res = await SocialAgencyRuntime._https({
          method: "POST",
          host: FB_GRAPH_HOST,
          path: `/${FB_API_VERSION}/${encodeURIComponent(secret.pageId)}/photos`,
          headers: { "Content-Type": contentType },
          body,
          timeoutMs: 60 * 1000,
        });
        if (res.status >= 300 || res.json?.error) throw new Error(res.json?.error?.message || `Facebook ตอบ HTTP ${res.status}`);
        postId = res.json?.post_id || res.json?.id;
      } else {
        const res = await SocialAgencyRuntime._https({
          method: "POST",
          host: FB_GRAPH_HOST,
          path: `/${FB_API_VERSION}/${encodeURIComponent(secret.pageId)}/feed`,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: entry.caption || "", access_token: secret.accessToken }),
          timeoutMs: 60 * 1000,
        });
        if (res.status >= 300 || res.json?.error) throw new Error(res.json?.error?.message || `Facebook ตอบ HTTP ${res.status}`);
        postId = res.json?.id;
      }
      this._mutateClient(client.id, (c) => {
        c.connectors.facebook.lastPublishAt = new Date().toISOString();
      });
      return { platform, mode: "live", postId, latencyMs: Date.now() - t0, note: `โพสต์บนเพจ ${secret.pageId}` };
    }

    if (platform === "instagram") {
      const counter = meta.counter || null;
      const now = Date.now();
      if (counter && counter.count >= IG_24H_LIMIT && now - Date.parse(counter.windowStart) < 24 * 60 * 60 * 1000) {
        throw new Error("ถึงขีดจำกัด Instagram 50 โพสต์/24 ชม. แล้ว — รอให้หน้าต่าง 24 ชม. ผ่านไปก่อน");
      }
      const imageUrl = await this._publicImageUrl(client, entry);
      const create = await SocialAgencyRuntime._https({
        method: "POST",
        host: FB_GRAPH_HOST,
        path: `/${FB_API_VERSION}/${encodeURIComponent(secret.igUserId)}/media`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, caption: entry.caption || "", access_token: secret.accessToken }),
        timeoutMs: 60 * 1000,
      });
      if (create.status >= 300 || create.json?.error) throw new Error(create.json?.error?.message || `Instagram ตอบ HTTP ${create.status}`);
      const containerId = create.json?.id;
      let statusCode = "IN_PROGRESS";
      for (let i = 0; i < 20 && statusCode === "IN_PROGRESS"; i += 1) {
        await sleep(3000);
        const poll = await SocialAgencyRuntime._https({
          host: FB_GRAPH_HOST,
          path: `/${FB_API_VERSION}/${containerId}?fields=status_code&access_token=${encodeURIComponent(secret.accessToken)}`,
        });
        if (poll.status >= 300 || poll.json?.error) throw new Error(poll.json?.error?.message || `Instagram poll ตอบ HTTP ${poll.status}`);
        statusCode = poll.json?.status_code || "IN_PROGRESS";
      }
      if (statusCode !== "FINISHED") throw new Error(`คอนเทนเนอร์ Instagram ยังไม่พร้อม (สถานะ ${statusCode})`);
      const publish = await SocialAgencyRuntime._https({
        method: "POST",
        host: FB_GRAPH_HOST,
        path: `/${FB_API_VERSION}/${encodeURIComponent(secret.igUserId)}/media_publish`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: containerId, access_token: secret.accessToken }),
        timeoutMs: 60 * 1000,
      });
      if (publish.status >= 300 || publish.json?.error) throw new Error(publish.json?.error?.message || `Instagram publish ตอบ HTTP ${publish.status}`);
      this._mutateClient(client.id, (c) => {
        const m = c.connectors.instagram;
        const prev = m.counter;
        if (prev && now - Date.parse(prev.windowStart) < 24 * 60 * 60 * 1000) m.counter = { count: prev.count + 1, windowStart: prev.windowStart };
        else m.counter = { count: 1, windowStart: new Date().toISOString() };
        m.lastPublishAt = new Date().toISOString();
      });
      return { platform, mode: "live", postId: publish.json?.id, latencyMs: Date.now() - t0, note: `โพสต์ IG ${secret.igUserId} (คอนเทนเนอร์ ${containerId})` };
    }

    if (platform === "line") {
      const messages = [];
      const wantsImage = entry.image && (entry.image.publicUrl || entry.image.path) && meta.sendImageTextStack !== false;
      if (wantsImage) {
        const url = await this._publicImageUrl(client, entry);
        messages.push({ type: "image", originalContentUrl: url, previewImageUrl: url });
        messages.push({ type: "text", text: entry.caption || "" });
      } else {
        messages.push({ type: "text", text: entry.caption || "" });
      }
      const { quotaNote } = await this._lineBroadcast(secret, messages);
      this._mutateClient(client.id, (c) => {
        c.connectors.line.lastPublishAt = new Date().toISOString();
      });
      return { platform, mode: "live", postId: `line-broadcast-${crypto.randomBytes(4).toString("hex")}`, latencyMs: Date.now() - t0, note: `ส่ง broadcast ถึงผู้ติดตามทุกคน${quotaNote}` };
    }

    throw new Error(`ไม่รู้จักแพลตฟอร์ม "${platform}"`);
  }

  // ── LINE broadcast primitive (quota-guarded; shared by publish + weekly summary) ──
  async _lineBroadcast(secret, messages) {
    const quota = await SocialAgencyRuntime._https({
      host: LINE_HOST,
      path: "/v2/bot/message/quota",
      headers: { Authorization: `Bearer ${secret.channelAccessToken}` },
    });
    const consumption = await SocialAgencyRuntime._https({
      host: LINE_HOST,
      path: "/v2/bot/message/quota/consumption",
      headers: { Authorization: `Bearer ${secret.channelAccessToken}` },
    });
    const total = Number(quota.json?.value);
    const used = Number(consumption.json?.totalUsage);
    if (Number.isFinite(total) && Number.isFinite(used) && total - used < 1) {
      throw new Error(`โควตาข้อความรายเดือนของ LINE OA เหลือ ${Math.max(0, total - used)} ข้อความ — broadcast ถูกบล็อกเพื่อกันเกินโควตา`);
    }
    const res = await SocialAgencyRuntime._https({
      method: "POST",
      host: LINE_HOST,
      path: "/v2/bot/message/broadcast",
      headers: { Authorization: `Bearer ${secret.channelAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      timeoutMs: 60 * 1000,
    });
    if (res.status >= 300 || res.json?.message) throw new Error(res.json?.message || `LINE ตอบ HTTP ${res.status}`);
    const quotaNote = Number.isFinite(total) && Number.isFinite(used) ? ` (โควตาเหลือ ${Math.max(0, total - used)} ข้อความ)` : "";
    return { quotaNote };
  }

  // ── backup & restore (group 5) ──
  exportBackup(clientId) {
    const state = this._read();
    const clients = clientId ? state.clients.filter((c) => c.id === clientId) : state.clients;
    if (clientId && !clients.length) throw new Error("ไม่พบลูกค้ารายนี้ (client not found)");
    const clean = JSON.parse(JSON.stringify(clients)).map((c) => ({
      ...c,
      calendar: (c.calendar || []).map((e) => ({ ...e, inFlight: false })),
    }));
    return { app: "luke-social-agency", version: 2, scope: clientId ? "client" : "all", exportedAt: new Date().toISOString(), clients: clean };
  }

  listBackups() {
    try {
      return fs.readdirSync(this.backupDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const stat = fs.statSync(path.join(this.backupDir, f));
          return { file: f, size: stat.size, createdAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.file.localeCompare(a.file));
    } catch {
      return [];
    }
  }

  saveBackupSnapshot(clientId) {
    const snapshot = this.exportBackup(clientId);
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = clientId ? `backup-${clientId}-${stamp}.json` : `backup-all-${stamp}.json`;
    fs.writeFileSync(path.join(this.backupDir, name), JSON.stringify(snapshot, null, 2), "utf8");
    for (const extra of this.listBackups().slice(20)) {
      try { fs.unlinkSync(path.join(this.backupDir, extra.file)); } catch {}
    }
    return { file: name, scope: snapshot.scope, clients: snapshot.clients.length, exportedAt: snapshot.exportedAt };
  }

  restoreBackup(clientId, snapshot) {
    if (!snapshot || !Array.isArray(snapshot.clients) || !snapshot.clients.length) {
      throw new Error("ไฟล์สำรองไม่ถูกต้อง (ต้องมี clients อย่างน้อย 1 ราย)");
    }
    for (const c of snapshot.clients) {
      if (!c || typeof c.id !== "string" || !Array.isArray(c.calendar)) throw new Error("ไฟล์สำรองไม่ถูกต้อง (โครงลูกค้าไม่ครบ)");
    }
    this.saveBackupSnapshot(); // safety copy of current state before overwriting
    const state = this._read();
    const wanted = clientId ? snapshot.clients.filter((c) => c.id === clientId) : snapshot.clients;
    if (clientId && !wanted.length) throw new Error("ไฟล์สำรองไม่มีข้อมูลของลูกค้ารายนี้");
    const restored = [];
    for (const incoming of wanted) {
      const clean = JSON.parse(JSON.stringify(incoming));
      clean.calendar = (clean.calendar || []).map((e) => ({ ...e, inFlight: false }));
      const idx = state.clients.findIndex((c) => c.id === incoming.id);
      if (idx >= 0) state.clients[idx] = clean;
      else state.clients.push(clean);
      restored.push(incoming.id);
    }
    this._ensureClientShapes(state);
    if (!state.clients.find((c) => c.id === state.activeClientId)) state.activeClientId = state.clients[0]?.id || null;
    this._write(state);
    return { restored };
  }

  // ── weekly summary + LINE push (group 5) ──
  buildWeeklySummary(clientId, weekOffset = 0) {
    const { client } = this._resolveClient(clientId);
    const { weekKey, start, end } = bangkokWeekRange(Number(weekOffset) || 0);
    const entries = (client.calendar || []).filter((e) => e.date >= start && e.date <= end);
    const published = entries.filter((e) => e.status === "published");
    const failed = entries.filter((e) => ["failed", "missed"].includes(e.status));
    const byPlatform = {};
    for (const e of published) byPlatform[e.platform] = (byPlatform[e.platform] || 0) + 1;
    const angles = [...new Set(published.map((e) => e.angle).filter(Boolean))];
    const runs = (client.workflowRuns || []).filter((r) => {
      const day = String(r.createdAt || "").slice(0, 10);
      return day >= start && day <= end;
    });
    return {
      clientId: client.id,
      clientName: client.name,
      weekKey,
      start,
      end,
      counts: { total: entries.length, published: published.length, failed: failed.length, runs: runs.length },
      byPlatform,
      angles,
      publishedPosts: published.map((e) => ({ date: e.date, time: e.time, platform: e.platform, productName: e.productName, caption: (e.caption || "").slice(0, 160) })),
      failedPosts: failed.map((e) => ({ date: e.date, time: e.time, platform: e.platform, productName: e.productName, status: e.status })),
    };
  }

  formatWeeklySummaryText(summary) {
    const lines = [
      `📊 สรุปสัปดาห์ ${summary.start} – ${summary.end}`,
      `${summary.clientName}`,
      `เผยแพร่แล้ว ${summary.counts.published} / ทั้งหมด ${summary.counts.total} โพสต์${summary.counts.failed ? ` (พลาด ${summary.counts.failed})` : ""}`,
    ];
    const pfEntries = Object.entries(summary.byPlatform || {});
    if (pfEntries.length) lines.push(pfEntries.map(([p, n]) => `• ${p}: ${n}`).join("  "));
    if (summary.angles?.length) lines.push(`มุมที่ใช้: ${summary.angles.join(" / ")}`);
    for (const p of (summary.publishedPosts || []).slice(0, 5)) {
      const first = String(p.caption || "").split("\n").filter(Boolean)[0] || p.productName;
      lines.push(`✓ ${p.date.slice(5)} ${p.platform} — ${first.slice(0, 60)}`);
    }
    const text = lines.join("\n");
    return text.length > 900 ? `${text.slice(0, 897)}…` : text;
  }

  async sendWeeklySummary(clientId, { weekOffset = 0 } = {}) {
    const { client } = this._resolveClient(clientId);
    const summary = this.buildWeeklySummary(client.id, weekOffset);
    const text = this.formatWeeklySummaryText(summary);
    const secrets = this._getSecrets(client.id);
    if (!this._connectorConfigured("line", secrets.line)) {
      throw new Error("ลูกค้ารายนี้ยังไม่ได้ตั้งค่า LINE channelAccessToken");
    }
    if ((client.connectors?.line || {}).dryRun !== false) {
      return { sent: false, reason: "dryRun", text, summary };
    }
    await this._lineBroadcast({ channelAccessToken: secrets.line.channelAccessToken }, [{ type: "text", text }]);
    this._mutateClient(client.id, (c) => {
      c.connectors.line.lastPublishAt = new Date().toISOString();
    });
    return { sent: true, text, summary };
  }

  // ── scheduler (automation core) ──
  // ── serve.cjs wiring: health + scheduler lifecycle controls ──
  getHealth() {
    const state = this._read();
    let llmReady = false;
    try {
      llmReady = Boolean(this.llm && typeof this.llm.isReady === "function" && this.llm.isReady());
    } catch {
      llmReady = false;
    }
    return {
      version: 2,
      scheduler: this.getSchedulerStatus(),
      clients: state.clients.length,
      activeClientId: state.activeClientId,
      llmReady,
      stateFile: this.filePath,
      serverNow: new Date().toISOString(),
    };
  }

  startScheduler() {
    if (this.schedulerTimer) return this.getSchedulerStatus();
    this._recoverInFlightOnce();
    const tick = async () => {
      try {
        await this._tick();
      } catch (err) {
        console.error("[social-agency] scheduler tick failed:", err.message);
      }
    };
    tick();
    this.schedulerTimer = setInterval(tick, SCHEDULER_TICK_MS);
    console.log("  [social-agency] Scheduler active (every 60s, Asia/Bangkok)");
    return this.getSchedulerStatus();
  }

  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    return this.getSchedulerStatus();
  }

  _recoverInFlightOnce() {
    if (this._recovered) return;
    this._recovered = true;
    const state = this._read();
    let changed = false;
    const now = new Date().toISOString();
    for (const client of state.clients) {
      for (const entry of client.calendar || []) {
        if (entry.inFlight) {
          // crash recovery: re-arm so the scheduler can pick it up again
          entry.inFlight = false;
          entry.status = "planned";
          entry.recoveredAt = now;
          entry.updatedAt = now;
          changed = true;
        }
      }
    }
    if (changed) {
      this._write(state);
      console.log("  [social-agency] Recovered in-flight entries after restart.");
    }
  }

  _releaseRun(runId) {
    const slotKey = this._slotByRunId.get(runId);
    if (!slotKey) return;
    this._slotByRunId.delete(runId);
    this.activeByClientPlatform.delete(slotKey);
    this.activeRunCount = Math.max(0, this.activeRunCount - 1);
  }

  // safety sweep: free slots whose runs are no longer running (crash/race guard)
  _sweepSlots() {
    if (this._slotByRunId.size === 0) return;
    const state = this._read();
    for (const runId of [...this._slotByRunId.keys()]) {
      const slotKey = this._slotByRunId.get(runId);
      const clientId = slotKey.slice(0, slotKey.lastIndexOf(":"));
      const client = state.clients.find((c) => c.id === clientId);
      const run = (client?.workflowRuns || []).find((r) => r.id === runId);
      if (!run || run.status !== "running") this._releaseRun(runId);
    }
  }

  async _tick() {
    this.schedulerLastTickAt = new Date().toISOString();
    this._sweepSlots();
    const state = this._read();
    const now = Date.now();
    let stateChanged = false;
    const due = [];
    for (const client of state.clients) {
      for (const entry of client.calendar || []) {
        if (entry.inFlight || !["planned", "ready"].includes(entry.status)) continue;
        const dueMs = bangkokToUtcMs(entry.date, entry.time);
        if (!Number.isFinite(dueMs) || dueMs > now) continue;
        const ageMs = now - dueMs;
        if (ageMs > MISSED_AFTER_MS) {
          entry.status = "missed";
          entry.missedAt = new Date().toISOString();
          entry.updatedAt = entry.missedAt;
          stateChanged = true;
          continue;
        }
        due.push({ client, entry, late: ageMs > 5 * 60 * 1000 });
      }
    }
    if (stateChanged) this._write(state);
    for (const item of due) {
      const slotKey = `${item.client.id}:${item.entry.platform}`;
      if (this.activeRunCount >= MAX_GLOBAL_CONCURRENCY || this.activeByClientPlatform.has(slotKey)) continue;
      this.activeRunCount += 1;
      this.activeByClientPlatform.add(slotKey);
      try {
        const started = this.runWorkflow(item.client.id, item.entry.id, { trigger: "schedule", late: item.late });
        this._slotByRunId.set(started.runId, slotKey);
      } catch (err) {
        this.activeByClientPlatform.delete(slotKey);
        this.activeRunCount = Math.max(0, this.activeRunCount - 1);
        console.warn("[social-agency] scheduled run failed to start:", err.message);
      }
    }
    try {
      await this._maybeWeeklySummary();
    } catch (err) {
      console.warn("[social-agency] weekly summary skipped:", err.message);
    }
  }

  async _maybeWeeklySummary() {
    // Bangkok wall-clock: Monday 09:00+ local time, once per week, opt-in per client
    const bkk = new Date(Date.now() + BANGKOK_OFFSET_MS);
    if ((bkk.getUTCDay() + 6) % 7 !== 0) return; // Monday only
    if (bkk.getUTCHours() < 9) return;
    const { weekKey } = bangkokWeekRange(0);
    const seen = this._read().weeklySummary || {};
    if (seen.sentFor === weekKey) return;
    const results = [];
    for (const client of this._read().clients) {
      if (!client.settings?.weeklySummaryLine) continue;
      const secrets = this._getSecrets(client.id);
      if (!this._connectorConfigured("line", secrets.line) || (client.connectors?.line || {}).dryRun !== false) {
        results.push({ clientId: client.id, sent: false, reason: "not-configured-or-dryRun" });
        continue;
      }
      try {
        await this.sendWeeklySummary(client.id, { weekOffset: 1 }); // summarize last week
        results.push({ clientId: client.id, sent: true });
      } catch (err) {
        results.push({ clientId: client.id, sent: false, reason: err.message });
      }
    }
    const fresh = this._read();
    fresh.weeklySummary = { sentFor: weekKey, lastAt: new Date().toISOString(), results };
    this._write(fresh);
  }

  getSchedulerStatus() {
    const state = this._read();
    let next = null;
    for (const client of state.clients) {
      for (const entry of client.calendar || []) {
        if (entry.inFlight || !["planned", "ready"].includes(entry.status)) continue;
        const ms = bangkokToUtcMs(entry.date, entry.time);
        if (!Number.isFinite(ms) || ms <= Date.now()) continue;
        if (!next || ms < next.at) {
          next = {
            at: ms,
            label: `${client.name} · ${entry.productName} · ${entry.date} ${entry.time}`,
            clientId: client.id,
            entryId: entry.id,
          };
        }
      }
    }
    return {
      running: Boolean(this.schedulerTimer),
      lastTickAt: this.schedulerLastTickAt,
      activeCount: this.activeRunCount,
      nextPostAt: next ? new Date(next.at).toISOString() : null,
      nextPostLabel: next ? next.label : null,
      timezone: TZ_LABEL,
      serverNow: new Date().toISOString(),
    };
  }

  _maybeNotify(clientId, title, message) {
    try {
      const state = this._read();
      const client = state.clients.find((c) => c.id === clientId);
      if (!client || !client.settings?.notify) return;
      if (process.platform !== "darwin") return; // darwin-gated, off by default
      const safe = (s) => String(s || "").replace(/[\"\\]/g, "");
      exec(`osascript -e 'display notification "${safe(message)}" with title "Luke Social Agency — ${safe(client.name)}" subtitle "${safe(title)}"'`, () => {});
    } catch {}
  }

  // ── HTTP API router (all /api/social-agency/* routes) ──
  async handleApiRequest(req, res, { readJsonRequestBody, json }) {
    const parsed = new URL(req.url, "http://localhost");
    const pathname = parsed.pathname;
    const clientId = parsed.searchParams.get("clientId") || undefined;
    const method = req.method;
    const fail = (error, code = 400) => json(res, code, { ok: false, error: error.message || String(error) });
    const readBody = async () => (await readJsonRequestBody(req)) || {};

    try {
      // legacy v1 endpoints (kept verbatim in behavior)
      if (pathname === "/api/social-agency/state" && method === "GET") {
        return json(res, 200, { ok: true, state: this.getState() });
      }
      if (pathname === "/api/social-agency/daily-drafts" && method === "POST") {
        try {
          return json(res, 201, { ok: true, draft: this.createDailyDraft() });
        } catch (error) {
          return fail(error, 409);
        }
      }
      if (pathname === "/api/social-agency/draft-status" && method === "POST") {
        try {
          const body = await readBody();
          return json(res, 200, { ok: true, draft: this.updateDraftStatus(body.id, body.status) });
        } catch (error) {
          return fail(error, 409);
        }
      }

      // clients
      if (pathname === "/api/social-agency/clients" && method === "GET") {
        return json(res, 200, { ok: true, clients: this.listClients() });
      }
      if (pathname === "/api/social-agency/clients" && method === "POST") {
        const body = await readBody();
        const client = this.createClient(body);
        return json(res, 201, { ok: true, client, state: this.getState() });
      }
      let match = pathname.match(/^\/api\/social-agency\/clients\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (method === "PATCH") {
          const body = await readBody();
          return json(res, 200, { ok: true, client: this.updateClient(id, body) });
        }
        if (method === "DELETE") {
          return json(res, 200, { ok: true, ...this.deleteClient(id), state: this.getState() });
        }
      }
      match = pathname.match(/^\/api\/social-agency\/clients\/([^/]+)\/activate$/);
      if (match && method === "POST") {
        const state = this.activateClient(decodeURIComponent(match[1]));
        return json(res, 200, { ok: true, activeClientId: state.activeClientId, state: this.getState() });
      }

      // calendar
      if (pathname === "/api/social-agency/calendar" && method === "GET") {
        const filters = {
          status: parsed.searchParams.get("status") || undefined,
          platform: parsed.searchParams.get("platform") || undefined,
          q: parsed.searchParams.get("q") || undefined,
          from: parsed.searchParams.get("from") || undefined,
          to: parsed.searchParams.get("to") || undefined,
        };
        return json(res, 200, { ok: true, entries: this.listCalendar(clientId, filters) });
      }
      // overview dashboard (group 3)
      if (pathname === "/api/social-agency/overview" && method === "GET") {
        return json(res, 200, { ok: true, overview: this.getOverview(clientId) });
      }
      // platform versions + few-shot (group 4)
      if (pathname === "/api/social-agency/platform-versions" && method === "POST") {
        const body = await readBody();
        return json(res, 200, { ok: true, preview: this.previewPlatformVersions(clientId || body.clientId, body) });
      }
      if (pathname === "/api/social-agency/few-shots" && method === "GET") {
        return json(res, 200, { ok: true, fewShots: this.listFewShots(clientId) });
      }
      if (pathname === "/api/social-agency/few-shots" && method === "POST") {
        const body = await readBody();
        return json(res, 201, { ok: true, fewShot: this.addFewShot(clientId || body.clientId, body) });
      }
      match = pathname.match(/^\/api\/social-agency\/few-shots\/([^/]+)$/);
      if (match && method === "DELETE") {
        return json(res, 200, { ok: true, ...this.deleteFewShot(clientId, decodeURIComponent(match[1])) });
      }
      if (pathname === "/api/social-agency/calendar" && method === "POST") {
        const body = await readBody();
        return json(res, 201, { ok: true, entry: this.createCalendarEntry(clientId || body.clientId, body) });
      }
      match = pathname.match(/^\/api\/social-agency\/calendar\/([^/]+)$/);
      if (match) {
        const entryId = decodeURIComponent(match[1]);
        if (method === "PATCH") {
          const body = await readBody();
          return json(res, 200, { ok: true, entry: this.updateCalendarEntry(clientId, entryId, body) });
        }
        if (method === "DELETE") {
          return json(res, 200, { ok: true, ...this.deleteCalendarEntry(clientId, entryId) });
        }
      }

      // auto-plan
      if (pathname === "/api/social-agency/auto-plan" && method === "POST") {
        const body = await readBody();
        const preview = await this.autoPlanPreview(clientId || body.clientId, body);
        return json(res, 200, { ok: true, preview });
      }
      if (pathname === "/api/social-agency/auto-plan/apply" && method === "POST") {
        const body = await readBody();
        return json(res, 201, { ok: true, ...this.applyAutoPlan(clientId || body.clientId, body) });
      }

      // runs
      if (pathname === "/api/social-agency/run" && method === "POST") {
        const body = await readBody();
        if (!body.entryId) return fail(new Error("ต้องระบุ entryId"), 400);
        return json(res, 202, { ok: true, ...this.runWorkflow(clientId || body.clientId, body.entryId, { trigger: "manual", force: Boolean(body.force) }) });
      }
      if (pathname === "/api/social-agency/runs" && method === "GET") {
        const entryId = parsed.searchParams.get("entryId") || undefined;
        return json(res, 200, { ok: true, runs: this.listRuns(clientId, entryId) });
      }
      if (pathname === "/api/social-agency/run-log" && method === "GET") {
        return json(res, 200, { ok: true, runs: this.listRunLog() });
      }
      if (pathname === "/api/social-agency/approve" && method === "POST") {
        const body = await readBody();
        if (!body.entryId) return fail(new Error("ต้องระบุ entryId"), 400);
        return json(res, 202, { ok: true, ...this.approveEntry(clientId || body.clientId, body.entryId) });
      }
      if (pathname === "/api/social-agency/reject" && method === "POST") {
        const body = await readBody();
        if (!body.entryId) return fail(new Error("ต้องระบุ entryId"), 400);
        return json(res, 200, { ok: true, entry: this.rejectEntry(clientId || body.clientId, body.entryId) });
      }

      // connectors
      if (pathname === "/api/social-agency/connectors" && method === "GET") {
        return json(res, 200, { ok: true, connectors: this.getConnectorsView(clientId) });
      }
      if (pathname === "/api/social-agency/connectors" && method === "PUT") {
        const body = await readBody();
        return json(res, 200, { ok: true, connectors: this.saveConnectors(clientId || body.clientId, body) });
      }
      match = pathname.match(/^\/api\/social-agency\/connectors\/([^/]+)\/test$/);
      if (match && method === "POST") {
        const body = await readBody();
        const result = await this.testConnector(clientId || body.clientId, decodeURIComponent(match[1]), body.fields);
        return json(res, 200, { ok: true, result });
      }

      // scheduler
      if (pathname === "/api/social-agency/scheduler" && method === "GET") {
        return json(res, 200, { ok: true, scheduler: this.getSchedulerStatus() });
      }
      // health + scheduler lifecycle (serve.cjs wiring)
      if (pathname === "/api/social-agency/health" && method === "GET") {
        return json(res, 200, { ok: true, health: this.getHealth() });
      }
      if (pathname === "/api/social-agency/scheduler/start" && method === "POST") {
        return json(res, 200, { ok: true, scheduler: this.startScheduler() });
      }
      if (pathname === "/api/social-agency/scheduler/stop" && method === "POST") {
        return json(res, 200, { ok: true, scheduler: this.stopScheduler() });
      }
      // backup + weekly summary (group 5)
      if (pathname === "/api/social-agency/backup" && method === "GET") {
        return json(res, 200, { ok: true, backup: this.exportBackup(clientId) });
      }
      if (pathname === "/api/social-agency/backups" && method === "GET") {
        return json(res, 200, { ok: true, backups: this.listBackups() });
      }
      if (pathname === "/api/social-agency/backup/snapshot" && method === "POST") {
        const body = await readBody();
        return json(res, 201, { ok: true, snapshot: this.saveBackupSnapshot(clientId || body.clientId || undefined) });
      }
      if (pathname === "/api/social-agency/backup/restore" && method === "POST") {
        const body = await readBody();
        return json(res, 200, { ok: true, ...this.restoreBackup(clientId || body.clientId || undefined, body.snapshot) });
      }
      if (pathname === "/api/social-agency/weekly-summary" && method === "GET") {
        const weekOffset = Number(parsed.searchParams.get("weekOffset") || 0) || 0;
        const summary = this.buildWeeklySummary(clientId, weekOffset);
        return json(res, 200, { ok: true, summary, text: this.formatWeeklySummaryText(summary) });
      }
      if (pathname === "/api/social-agency/weekly-summary/send" && method === "POST") {
        const body = await readBody();
        const result = await this.sendWeeklySummary(clientId || body.clientId, { weekOffset: Number(body.weekOffset) || 0 });
        return json(res, result.sent ? 200 : 202, { ok: true, ...result });
      }
    } catch (error) {
      const code = /ไม่พบ/.test(error.message || "") ? 404 : 400;
      return fail(error, code);
    }
    return false; // not handled
  }
}

module.exports = { SocialAgencyRuntime, NODE_DEFS, CONTENT_ANGLES, TONE_PRESETS, PLATFORMS, ENTRY_STATUSES };
