"use strict";

// Pure, shared by the local runtime and the browser. Drafts remain editable;
// the same deterministic footer is composed for preview, copy and live send.
const PLATFORM_RULES = Object.freeze({
  demo: { maxChars: 2200, maxHashtags: 5 },
  facebook: { maxChars: 2000, maxHashtags: 4 },
  instagram: { maxChars: 2200, maxHashtags: 8 },
  line: { maxChars: 400, maxHashtags: 2 },
  tiktok: { maxChars: 2200, maxHashtags: 5 },
});

const THAI_MODERN_BAGS_CONTACT = [
  "กว่า 40 ปี ที่ Thai Modern Bags มุ่งมั่นผลิตกระเป๋า OEM / ODM คุณภาพมาตรฐาน ให้กับองค์กรชั้นนำทั่วประเทศ",
  "",
  "📩 สอบถามรายละเอียดหรือขอใบเสนอราคา",
  "☎️ TEL: 0-2466-3312, 02-465-3355",
  "📱 MOBILE: 097-469-4656, 095-226-4565",
  "💬 LINE ID: @thaimodernbags",
  "📧 EMAIL: ekkaphon@thaimodernbags.com",
  "🌐 WEBSITE: https://www.thaimodernbags.com",
].join("\n");

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);

function plainSocialText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, (_match, _label, url) => url.replace(/^mailto:/i, ""))
    .replace(/`+/g, "")
    .trim();
}

function defaultCaptionFooters(client) {
  const result = Object.fromEntries(Object.keys(PLATFORM_RULES).map((platform) => [platform, ""]));
  // This is the user's named customer, NOT a default for goods/OEM businesses.
  if (client?.id === "thai-modern-bags") {
    result.facebook = THAI_MODERN_BAGS_CONTACT;
    result.instagram = THAI_MODERN_BAGS_CONTACT;
  }
  return result;
}

function captionFootersFor(client) {
  if (!own(client, "captionFooters")) return defaultCaptionFooters(client);
  const map = isMap(client.captionFooters) ? client.captionFooters : {};
  return Object.fromEntries(Object.keys(PLATFORM_RULES).map((platform) => [
    platform, typeof map[platform] === "string" ? plainSocialText(map[platform]) : "",
  ]));
}

function footerLimit(platform) {
  return Math.min(1500, (PLATFORM_RULES[platform]?.maxChars || 2000) - 80);
}

function sanitizeCaptionFooters(raw) {
  if (!isMap(raw)) throw new Error("ข้อความปิดท้ายต้องเป็นข้อมูลแยกตามแพลตฟอร์ม");
  for (const platform of Object.keys(raw)) {
    if (!own(PLATFORM_RULES, platform)) throw new Error(`ไม่รู้จักแพลตฟอร์ม ${platform}`);
    if (typeof raw[platform] !== "string") throw new Error(`ข้อความปิดท้าย ${platform} ต้องเป็นข้อความ (ใช้ค่าว่างเพื่อปิด)`);
  }
  const result = captionFootersFor({ captionFooters: raw });
  for (const [platform, text] of Object.entries(result)) {
    if (text.length > footerLimit(platform)) throw new Error(`ข้อความปิดท้าย ${platform} ยาวเกิน ${footerLimit(platform)} ตัวอักษร — ต้องเหลือที่ให้เนื้อหาโพสต์ด้วย`);
  }
  return result;
}

function managedFooters(client) {
  const maps = [captionFootersFor(client), ...(Array.isArray(client?.captionFooterHistory) ? client.captionFooterHistory.slice(-8) : [])];
  if (client?.id === "thai-modern-bags") maps.push(defaultCaptionFooters(client));
  return [...new Set(maps.flatMap((map) => isMap(map) ? Object.values(map).filter((value) => typeof value === "string" && value.trim()).map(plainSocialText) : []))]
    .sort((a, b) => b.length - a.length);
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stripCaptionFooters(value, client) {
  const footers = managedFooters(client);
  if (!footers.length) return String(value || "").trim();
  let text = plainSocialText(value);
  for (const footer of footers) {
    // Whitespace-insensitive matching also handles the user's original one-line
    // contact block. Tracking URLs from a previously copied post are equivalent.
    const pattern = footer.split(/\s+/).map((token) => /^https?:\/\//i.test(token)
      ? `${escapeRe(token.replace(/\/$/, ""))}/?(?:\\?utm_[^\\s]*)?`
      : escapeRe(token)).join("\\s+");
    text = text.replace(new RegExp(pattern, "gi"), "");
  }
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitTrailingHashtags(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:^|\s)(#[^\s#]+(?:[ \t\n]+#[^\s#]+)*)\s*$/u);
  return match ? { body: text.slice(0, match.index).trim(), tags: match[1] } : { body: text, tags: "" };
}

function clipBody(value, budget) {
  if (value.length <= budget) return value;
  if (budget < 2) return "";
  let cut = value.slice(0, budget - 1).replace(/[\uD800-\uDBFF]$/, "");
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (boundary > budget * 0.65) cut = cut.slice(0, boundary);
  return cut.trimEnd() + "…";
}

function formatPostCaption(client, platform, value, { truncateBody = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return ""; // Do not pretend the footer alone is a generated draft.
  const footer = captionFootersFor(client)[platform] || "";
  const stripped = stripCaptionFooters(raw, client);
  // Preserve unrelated customers' drafts byte-for-byte (apart from trim).
  if (!footer && stripped === raw && !truncateBody) return raw;
  let { body, tags } = splitTrailingHashtags(stripped);
  if (truncateBody) {
    const suffix = [footer, tags].filter(Boolean).join("\n\n");
    const budget = (PLATFORM_RULES[platform]?.maxChars || 2000) - (suffix ? suffix.length + 2 : 0);
    if (budget < 1) throw new Error(`ข้อความปิดท้ายและแฮชแท็ก ${platform} ยาวเกินพื้นที่ — ย่อก่อนสร้างฉบับแพลตฟอร์ม`);
    body = clipBody(body, budget);
  }
  return [body, footer, tags].filter(Boolean).join("\n\n");
}

module.exports = {
  PLATFORM_RULES, THAI_MODERN_BAGS_CONTACT, plainSocialText,
  defaultCaptionFooters, captionFootersFor, sanitizeCaptionFooters,
  footerLimit, stripCaptionFooters, formatPostCaption,
};
