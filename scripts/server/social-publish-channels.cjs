"use strict";

/**
 * Free publishing channels — one shared registry for the app.
 *
 * Luke AI Workflow uses this file for three things, so a channel is described
 * once instead of three times:
 *
 *   1. `compose()` builds the one-click post: the editor/share URL with the title
 *      and text already filled in, plus the text to paste when a site has no
 *      prefill support. Nothing secret is involved, so this is what the
 *      "publish" step runs in the browser.
 *   2. `plan()` builds the HTTP request(s) an API channel needs, so the "webhook"
 *      step can really post — the local server performs the request (no CORS),
 *      and only a channel listed here can be called.
 *   3. `list()` feeds the channel library in the UI (authority, link type,
 *      how hard signup is, what the free tier allows).
 *
 * Honesty rules for the numbers below, because they are the reason this list is
 * worth anything:
 *   - DA/PA are third-party estimates (Moz/Ahrefs-style), not a promise and not
 *     a ranking factor Google uses. They are rounded, and two tools rarely agree
 *     to the last point. `authority: "approx"` says exactly that.
 *   - Most of these links are `nofollow` or `ugc`, i.e. they do **not** pass
 *     link equity. What they do give you: a real indexable page on a high-trust
 *     domain, referral traffic, brand/entity signals, and a canonical target for
 *     syndication. `linkType` is stated per channel so nobody has to guess.
 *   - The state of every API was checked in October 2026 (see NOTES dates).
 *     Platforms change this without warning: Medium stopped issuing new API
 *     tokens in January 2025, and Hashnode made its GraphQL API paid in May
 *     2026. Both are marked accordingly instead of being advertised as API
 *     channels that no longer work.
 */

const MAX_TITLE = 200;
const MAX_BODY = 120000;
const MAX_TAGS = 8;

const NOTES_REVIEWED = "2026-10";

// ── helpers ─────────────────────────────────────────────────────────────────

const clean = (value, max = MAX_BODY) => String(value ?? "").slice(0, max);

function normalizeTags(tags, max = MAX_TAGS) {
  const list = Array.isArray(tags)
    ? tags
    : String(tags ?? "").split(/[,،\n]/);
  return [...new Set(list
    .map((tag) => String(tag).trim().replace(/^#/, "").replace(/\s+/g, ""))
    .filter(Boolean))]
    .slice(0, max);
}

function hashtagLine(tags) {
  return tags.length ? tags.map((tag) => `#${tag}`).join(" ") : "";
}

// A draft is what every channel receives. `body` is markdown/plain text as the
// workflow produced it; each channel decides how to carry it.
function normalizeDraft(draft) {
  const title = clean(draft?.title ?? "", MAX_TITLE).trim();
  const body = stripLeadingTitle(clean(draft?.body ?? "", MAX_BODY), title);
  return {
    title: title || firstLine(body) || "โพสต์ใหม่",
    body,
    tags: normalizeTags(draft?.tags),
    canonicalUrl: clean(draft?.canonicalUrl ?? "", 500).trim(),
    imageUrl: clean(draft?.imageUrl ?? "", 500).trim(),
    siteUrl: clean(draft?.siteUrl ?? "", 500).trim(),
    language: clean(draft?.language ?? "th", 8).trim() || "th",
  };
}

// A generated article usually starts with its own "# Title" line. When that
// line is the title we already show, keeping it would put the heading in the
// post twice (and in a share text it turns into "#+Title").
function stripLeadingTitle(body, title) {
  const text = String(body || "");
  const match = text.match(/^\s*#{1,6}\s+(.+?)\s*\n+/);
  if (!match) return text;
  const heading = match[1].trim();
  if (!heading) return text;
  if (!title || normalizeHeading(heading) === normalizeHeading(title)) return text.slice(match[0].length);
  return text;
}

function normalizeHeading(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function firstLine(text) {
  return String(text || "").split("\n").map((line) => line.trim()).find(Boolean) || "";
}

function withHashtags(draft) {
  const line = hashtagLine(draft.tags);
  if (!line) return draft.body;
  return draft.body.includes(line) ? draft.body : `${draft.body.trimEnd()}\n\n${line}`;
}

function urlWith(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value) !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// Telegraph wants its own node tree, not raw HTML. Keep it deliberately small:
// paragraphs and blank-line separated blocks are enough for an article mirror.
function telegraphNodes(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const heading = block.match(/^#{1,3}\s+(.*)$/);
      if (heading) return { tag: "h3", children: [heading[1]] };
      if (/^[-*]\s+/m.test(block)) {
        return {
          tag: "ul",
          children: block.split("\n")
            .map((line) => line.replace(/^[-*]\s+/, "").trim())
            .filter(Boolean)
            .map((line) => ({ tag: "li", children: [line] })),
        };
      }
      return { tag: "p", children: [block.replace(/^\s*>\s?/gm, "").replace(/\*\*/g, "")] };
    });
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const basic = (token) => ({ Authorization: `Basic ${token}` });

function requireCredential(credentials, key, label) {
  const value = clean(credentials?.[key] ?? "", 2000).trim();
  if (!value) {
    const error = new Error(`ช่องนี้ต้องมี ${label} ก่อน — เปิดการ์ดช่องทางในแอปแล้ววางค่าไว้ในโหนด`);
    error.missingCredential = key;
    throw error;
  }
  return value;
}

// ── channel definitions ─────────────────────────────────────────────────────
//
// group      : how the library is ordered in the UI
// automation : "api"    = the local server can post it for you
//              "manual" = one click opens the prefilled editor; you paste & publish
//              "import" = no direct publish; hand the URL to the platform's importer
// signup     : how much work the free account is, in one line
// steps      : the whole manual route, in order, for someone doing it first time

const CHANNELS = [
  {
    id: "devto",
    group: "dev",
    name: "DEV Community",
    domain: "dev.to",
    authority: "approx",
    da: 85,
    pa: 74,
    linkType: "nofollow",
    automation: "api",
    signup: "สมัครด้วย GitHub/อีเมล 1 คลิก",
    signupUrl: "https://dev.to/enter",
    editorUrl: "https://dev.to/new",
    docsUrl: "https://developers.forem.com/api/v1",
    supportsCanonical: true,
    limits: { title: 128, body: 100000, tags: 4 },
    why: "ฟรีถาวร มี REST API เต็ม และตั้ง canonical กลับเว็บเราได้ — เหมาะกับคอนเทนต์สายเทค/ธุรกิจ B2B มากที่สุดในลิสต์นี้",
    steps: [
      "กดสมัครด้วยบัญชี GitHub หรืออีเมล (ไม่ต้องรออนุมัติ)",
      "ไปที่ Settings → Extensions → DEV Community API Keys → Generate",
      "วางคีย์ในโหนด “โพสต์อัตโนมัติ” แล้วรันได้เลยทุกครั้ง",
    ],
    compose(draft) {
      return { openUrl: "https://dev.to/new", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan({ draft, credentials }) {
      const apiKey = requireCredential(credentials, "apiKey", "API key ของ DEV Community");
      return [{
        method: "POST",
        url: "https://dev.to/api/articles",
        headers: { ...basic(apiKey), "Content-Type": "application/json", Accept: "application/json" },
        body: {
          article: {
            title: draft.title.slice(0, 128),
            body_markdown: withHashtags(draft),
            published: true,
            tags: draft.tags.slice(0, 4),
            ...(draft.canonicalUrl ? { canonical_url: draft.canonicalUrl } : {}),
            ...(draft.imageUrl ? { main_image: draft.imageUrl } : {}),
          },
        },
      }];
    },
    resultUrl: (json) => json?.url || json?.canonical_url || "",
  },
  {
    id: "telegraph",
    group: "instant",
    name: "Telegraph",
    domain: "telegra.ph",
    authority: "approx",
    da: 86,
    pa: 60,
    linkType: "nofollow",
    automation: "api",
    signup: "ไม่ต้องสมัครเลย",
    signupUrl: "https://telegra.ph/",
    editorUrl: "https://telegra.ph/",
    docsUrl: "https://telegra.ph/api",
    supportsCanonical: false,
    limits: { title: 256, body: 60000, tags: 0 },
    why: "แพลตฟอร์มของ Telegram ที่โพสต์ผ่าน API ได้โดยไม่ต้องมีบัญชี — เร็วที่สุดในลิสต์นี้ ใช้เป็นหน้าอ้างอิง/สำเนาบทความได้ทันที",
    steps: [
      "ไม่ต้องสมัคร: ระบบสร้าง account ให้อัตโนมัติเมื่อโพสต์ครั้งแรก",
      "รันเวิร์กโฟลว์ → ได้ลิงก์ telegra.ph กลับมาในผลลัพธ์",
    ],
    compose(draft) {
      return { openUrl: "https://telegra.ph/", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan({ draft }) {
      const content = telegraphNodes(withHashtags(draft));
      const body = {
        title: draft.title.slice(0, 256),
        author_name: "Luke AI Studio",
        content,
        return_content: false,
      };
      // account first (no auth), then the page using the returned token — two
      // requests, and the executor carries `access_token` forward.
      return [{
        method: "POST",
        url: "https://api.telegra.ph/createAccount",
        headers: { "Content-Type": "application/json" },
        body: { short_name: "luke", author_name: "Luke AI Studio" },
        save: { accessToken: "result.access_token" },
      }, {
        method: "POST",
        url: "https://api.telegra.ph/createPage",
        headers: { "Content-Type": "application/json" },
        body: { ...body, access_token: "{{accessToken}}" },
      }];
    },
    resultUrl: (json) => json?.result?.url || "",
  },
  {
    id: "gist",
    group: "dev",
    name: "GitHub Gist",
    domain: "gist.github.com",
    authority: "approx",
    da: 96,
    pa: 70,
    linkType: "nofollow",
    automation: "api",
    signup: "บัญชี GitHub (ฟรี)",
    signupUrl: "https://github.com/signup",
    editorUrl: "https://gist.github.com/",
    docsUrl: "https://docs.github.com/en/rest/gists",
    supportsCanonical: false,
    limits: { title: 200, body: 100000, tags: 0 },
    why: "โดเมนความน่าเชื่อถือสูงมาก ใช้เก็บ “ฉบับเต็ม” ของบทความ/โค้ด/เทมเพลต แล้วลิงก์จากโพสต์อื่นมาที่นี่ได้",
    steps: [
      "สร้าง Personal Access Token (scope: gist) ที่ github.com/settings/tokens",
      "วาง token ในโหนด แล้วรัน — gist จะถูกสร้างและได้ลิงก์กลับมา",
    ],
    compose(draft) {
      return { openUrl: "https://gist.github.com/", text: `${draft.title}\n\n${draft.body}` };
    },
    plan({ draft, credentials }) {
      const token = requireCredential(credentials, "token", "GitHub token (scope: gist)");
      const filename = `${(draft.title || "post").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 60) || "post"}.md`;
      return [{
        method: "POST",
        url: "https://api.github.com/gists",
        headers: { ...bearer(token), "Content-Type": "application/json", Accept: "application/vnd.github+json" },
        body: {
          description: draft.title.slice(0, 200),
          public: true,
          files: { [filename]: { content: withHashtags(draft) } },
        },
      }];
    },
    resultUrl: (json) => json?.html_url || "",
  },
  {
    id: "wordpresscom",
    group: "blog",
    name: "WordPress.com",
    domain: "wordpress.com",
    authority: "approx",
    da: 94,
    pa: 81,
    linkType: "nofollow",
    automation: "api",
    signup: "สมัครฟรี (แผนฟรีมีโฆษณา)",
    signupUrl: "https://wordpress.com/start",
    editorUrl: "https://wordpress.com/post",
    docsUrl: "https://developer.wordpress.com/docs/api/",
    supportsCanonical: false,
    limits: { title: 200, body: 100000, tags: 20 },
    why: "บล็อกฟรีบนโดเมนใหญ่ เหมาะกับการทำ “ศูนย์รวมบทความ” ของแบรนด์ แล้วชี้ canonical กลับเว็บหลักด้วยมือ",
    steps: [
      "สมัคร WordPress.com ฟรี → ได้เว็บย่อยอย่าง yourname.wordpress.com",
      "สร้าง OAuth token (หรือใช้ API key ที่มีสิทธิ์โพสต์) แล้ววางในโหนด",
      "ระบุ site = yourname.wordpress.com ในโหนด",
    ],
    compose(draft) {
      return { openUrl: "https://wordpress.com/post", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan({ draft, credentials }) {
      const token = requireCredential(credentials, "token", "WordPress.com OAuth token");
      const site = requireCredential(credentials, "site", "ชื่อเว็บ WordPress.com (เช่น yourname.wordpress.com)");
      return [{
        method: "POST",
        url: `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(site)}/posts/new`,
        headers: { ...bearer(token), "Content-Type": "application/json" },
        body: {
          title: draft.title,
          content: withHashtags(draft),
          status: "publish",
          tags: draft.tags.join(","),
        },
      }];
    },
    resultUrl: (json) => json?.URL || json?.short_URL || "",
  },
  {
    id: "telegram",
    group: "chat",
    name: "Telegram (บอท)",
    domain: "telegram.org",
    authority: "approx",
    da: 96,
    pa: 85,
    linkType: "nofollow",
    automation: "api",
    signup: "สร้างบอทใน 2 นาที (@BotFather)",
    signupUrl: "https://t.me/BotFather",
    editorUrl: null,
    docsUrl: "https://core.telegram.org/bots/api#sendmessage",
    supportsCanonical: true,
    limits: { title: 0, body: 4096, tags: 0 },
    why: "ช่องทางกระจายข่าวที่เร็วที่สุด — ลูกค้า/ทีมเห็นโพสต์ทันที ไม่ต้องพึ่งเพจ และลิงก์กลับเว็บได้",
    steps: [
      "คุยกับ @BotFather → /newbot → คัดลอก token",
      "เพิ่มบอทเข้ากลุ่ม/ช่อง หรือกด Start กับบอทเพื่อเอา chat_id",
      "วาง token + chat_id ในโหนดนี้",
    ],
    compose(draft) {
      const text = withHashtags(draft);
      return {
        openUrl: urlWith("https://t.me/share/url", { url: draft.canonicalUrl || draft.siteUrl, text: text.slice(0, 300) }),
        text,
        warnings: draft.canonicalUrl || draft.siteUrl ? [] : ["ยังไม่มีลิงก์ต้นฉบับ — ใส่ canonical/site URL เพื่อให้แชร์พร้อมลิงก์"],
      };
    },
    plan({ draft, credentials }) {
      const token = requireCredential(credentials, "token", "Bot token จาก @BotFather");
      const chatId = requireCredential(credentials, "chatId", "chat_id ปลายทาง");
      const text = [draft.title, "", withHashtags(draft), draft.canonicalUrl ? `\n🔗 ${draft.canonicalUrl}` : ""]
        .filter((line) => line !== undefined)
        .join("\n")
        .trim()
        .slice(0, 4096);
      return [{
        method: "POST",
        url: `https://api.telegram.org/bot${token}/sendMessage`,
        headers: { "Content-Type": "application/json" },
        body: {
          chat_id: chatId,
          text,
          disable_web_page_preview: false,
          ...(draft.imageUrl && /^https:\/\//.test(draft.imageUrl) ? { photo: draft.imageUrl } : {}),
        },
      }];
    },
    resultUrl: (json) => json?.result?.message_id
      ? `https://t.me/c/${json.result.chat?.id ?? ""}/${json.result.message_id}`
      : "",
  },
  {
    id: "discord",
    group: "chat",
    name: "Discord (webhook)",
    domain: "discord.com",
    authority: "approx",
    da: 96,
    pa: 84,
    linkType: "nofollow",
    automation: "api",
    signup: "มีเซิร์ฟเวอร์อยู่แล้ว = ใช้ได้เลย",
    signupUrl: "https://discord.com/",
    editorUrl: null,
    docsUrl: "https://discord.com/developers/docs/resources/webhook",
    supportsCanonical: true,
    limits: { title: 0, body: 2000, tags: 0 },
    why: "ประกาศลงคอมมิวนิตี้/ทีมงานได้ทันที และตั้งเป็นช่องแจ้งเตือนเวลาโพสต์ใหม่ได้",
    steps: [
      "Channel Settings → Integrations → Webhooks → New Webhook → Copy URL",
      "วาง URL ในโหนดนี้ (ไม่ต้องมี token อื่น)",
    ],
    compose(draft) {
      return { openUrl: null, text: withHashtags(draft) };
    },
    plan({ draft, credentials }) {
      const webhookUrl = requireCredential(credentials, "webhookUrl", "Discord webhook URL");
      const content = [withHashtags(draft), draft.canonicalUrl ? `🔗 ${draft.canonicalUrl}` : ""]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 2000);
      return [{
        method: "POST",
        url: webhookUrl,
        headers: { "Content-Type": "application/json" },
        body: { content, username: "Luke AI Studio" },
      }];
    },
    resultUrl: () => "",
  },
  {
    id: "mastodon",
    group: "social",
    name: "Mastodon",
    domain: "mastodon.social",
    authority: "approx",
    da: 92,
    pa: 70,
    linkType: "nofollow",
    automation: "api",
    signup: "สมัครฟรีบนอินสแตนซ์ที่เลือก",
    signupUrl: "https://joinmastodon.org/servers",
    editorUrl: null,
    docsUrl: "https://docs.joinmastodon.org/methods/statuses/",
    supportsCanonical: true,
    limits: { title: 0, body: 500, tags: 0 },
    why: "เชื่อมกับชุมชนเทค/โอเพนซอร์สได้ดี และโพสต์ผ่าน API ได้ด้วย token เดียว — ใช้เป็นช่องกระจายข่าวอัตโนมัติ",
    steps: [
      "Preferences → Development → New application → ได้ access token",
      "ใส่ instance (เช่น mastodon.social) + token ในโหนด",
    ],
    compose(draft) {
      const text = withHashtags(draft).slice(0, 400);
      return {
        openUrl: urlWith("https://mastodon.social/share", { text }),
        text,
      };
    },
    plan({ draft, credentials }) {
      const token = requireCredential(credentials, "token", "Mastodon access token");
      const instance = clean(credentials?.instance ?? "mastodon.social", 120).trim();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(instance)) throw new Error("ชื่ออินสแตนซ์ Mastodon ไม่ถูกต้อง (เช่น mastodon.social)");
      const status = [withHashtags(draft), draft.canonicalUrl].filter(Boolean).join("\n\n").slice(0, 500);
      return [{
        method: "POST",
        url: `https://${instance}/api/v1/statuses`,
        headers: { ...bearer(token), "Content-Type": "application/json" },
        body: { status, visibility: "public" },
      }];
    },
    resultUrl: (json) => json?.url || "",
  },
  {
    id: "medium",
    group: "blog",
    name: "Medium",
    domain: "medium.com",
    authority: "approx",
    da: 95,
    pa: 82,
    linkType: "nofollow",
    automation: "import",
    signup: "สมัครด้วย Google/อีเมล",
    signupUrl: "https://medium.com/m/signin",
    editorUrl: "https://medium.com/new-story",
    importUrl: "https://medium.com/p/import",
    docsUrl: "https://help.medium.com/hc/en-us/articles/213480228-API-Importing",
    supportsCanonical: true,
    limits: { title: 200, body: 100000, tags: 5 },
    why: "คนอ่านเยอะและค้นเจอง่าย — แต่ตั้งแต่ ม.ค. 2025 Medium ไม่ให้ API token ใหม่แล้ว จึงโพสต์ด้วยมือหรือใช้ “Import a story” (canonical ถูกตั้งให้)",
    steps: [
      "เขียนโพสต์ที่เว็บเราก่อน (หรือใช้โพสต์ที่ Dev.to/Telegraph)",
      "ที่ Medium เลือก Import a story → วางลิงก์ → Medium ตั้ง canonical ให้อัตโนมัติ",
      "หรือกดปุ่ม “เปิดหน้าเขียน” แล้ววางข้อความที่คัดลอกไว้",
    ],
    compose(draft) {
      return { openUrl: "https://medium.com/new-story", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan({ draft }) {
      const error = new Error(
        "Medium ปิด API สำหรับการโพสต์แล้ว (ไม่ให้ token ใหม่ตั้งแต่ ม.ค. 2025) — ใช้ปุ่ม “เปิดหน้าเขียน” หรือ Import a story พร้อมลิงก์ต้นฉบับ"
      );
      error.unsupported = { channel: "medium", fallback: "https://medium.com/p/import", draft };
      throw error;
    },
    resultUrl: () => "",
  },
  {
    id: "hashnode",
    group: "blog",
    name: "Hashnode",
    domain: "hashnode.com",
    authority: "approx",
    da: 79,
    pa: 68,
    linkType: "mixed",
    automation: "manual",
    signup: "สมัครฟรี (API ต้องอัปเกรด Pro)",
    signupUrl: "https://hashnode.com/onboard",
    editorUrl: "https://hashnode.com/dashboard",
    docsUrl: "https://hashnode.com/changelog/2026-05-13-graphql-api-paid-access",
    supportsCanonical: true,
    limits: { title: 200, body: 100000, tags: 5 },
    why: "บล็อกนักพัฒนาที่เชื่อมโดเมนตัวเองได้ฟรี — แต่ GraphQL API กลายเป็นแบบเสียเงินตั้งแต่ พ.ค. 2026 จึงใช้โพสต์ด้วยมือ",
    steps: [
      "สมัครแล้วสร้าง publication",
      "กดปุ่ม “เปิดหน้าเขียน” ในโหนด แล้ววางบทความ (หรือตั้ง canonical เอง)",
    ],
    compose(draft) {
      return { openUrl: "https://hashnode.com/dashboard", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan() {
      const error = new Error("Hashnode API ต้องใช้แผน Pro (ตั้งแต่ พ.ค. 2026) — โพสต์ด้วยมือผ่านปุ่มเปิดหน้าเขียนได้ฟรี");
      error.unsupported = { channel: "hashnode" };
      throw error;
    },
    resultUrl: () => "",
  },
  {
    id: "blogger",
    group: "blog",
    name: "Blogger (Blogspot)",
    domain: "blogger.com",
    authority: "approx",
    da: 96,
    pa: 80,
    linkType: "dofollow",
    automation: "api",
    signup: "ใช้บัญชี Google ที่มีอยู่",
    signupUrl: "https://www.blogger.com/",
    editorUrl: "https://www.blogger.com/",
    docsUrl: "https://developers.google.com/blogger/docs/3.0/reference/posts/insert",
    supportsCanonical: false,
    limits: { title: 200, body: 100000, tags: 20 },
    why: "โดเมนของ Google เอง ดัชนีเร็ว และค่าเริ่มต้นลิงก์เป็น dofollow — ต้องมี OAuth token ของ Google",
    steps: [
      "สร้างบล็อกที่ blogger.com (ใช้บัญชี Google)",
      "สร้าง OAuth access token ที่มี scope blogger (ผ่าน OAuth Playground)",
      "ใส่ blogId + token ในโหนด",
    ],
    compose(draft) {
      return { openUrl: "https://www.blogger.com/", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan({ draft, credentials }) {
      const token = requireCredential(credentials, "token", "Google OAuth token (scope blogger)");
      const blogId = requireCredential(credentials, "blogId", "Blog ID ของ Blogger");
      return [{
        method: "POST",
        url: `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/`,
        headers: { ...bearer(token), "Content-Type": "application/json" },
        body: { kind: "blogger#post", title: draft.title, content: draft.body.replace(/\n/g, "<br>") },
      }];
    },
    resultUrl: (json) => json?.url || "",
  },
  {
    id: "linkedin",
    group: "social",
    name: "LinkedIn",
    domain: "linkedin.com",
    authority: "approx",
    da: 98,
    pa: 88,
    linkType: "nofollow",
    automation: "manual",
    signup: "บัญชี LinkedIn ที่มีอยู่",
    signupUrl: "https://www.linkedin.com/signup",
    editorUrl: "https://www.linkedin.com/article/new/",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
    supportsCanonical: true,
    limits: { title: 200, body: 40000, tags: 3 },
    why: "โดเมนอันดับต้น ๆ ของโลก และเป็นที่ที่ลูกค้า B2B อ่านจริง — แต่ API โพสต์ต้องสร้างแอปและรออนุมัติ",
    steps: [
      "กด “เปิดหน้าเขียน” (โพสต์/บทความจะถูกคัดลอกไว้ให้แล้ว)",
      "วางข้อความ → Publish",
    ],
    compose(draft) {
      return {
        openUrl: urlWith("https://www.linkedin.com/feed/", { shareActive: "true", text: `${draft.title}\n\n${withHashtags(draft)}` }),
        text: `${draft.title}\n\n${withHashtags(draft)}`,
      };
    },
    plan() {
      const error = new Error("LinkedIn ต้องมีแอปที่ได้รับอนุมัติ (w_member_social) — ใช้ปุ่มเปิดหน้าเขียน/แชร์ที่มีข้อความกรอกไว้แล้ว");
      error.unsupported = { channel: "linkedin" };
      throw error;
    },
    resultUrl: () => "",
  },
  {
    id: "reddit",
    group: "social",
    name: "Reddit",
    domain: "reddit.com",
    authority: "approx",
    da: 91,
    pa: 85,
    linkType: "nofollow",
    automation: "manual",
    signup: "สมัครฟรี (ต้องมี karma ก่อนโพสต์บางซับ)",
    signupUrl: "https://www.reddit.com/register/",
    editorUrl: "https://www.reddit.com/submit",
    docsUrl: "https://www.reddit.com/dev/api/",
    supportsCanonical: true,
    limits: { title: 300, body: 40000, tags: 0 },
    why: "เป็นแหล่งอ้างอิงที่ AI ค้นหาบ่อย (Reddit ถูกอ้างในคำตอบ ChatGPT/Perplexity) — แต่วัฒนธรรมชุมชนเข้ม ต้องอ่านกฎซับก่อนโพสต์ทุกครั้ง",
    steps: [
      "เลือกซับที่ตรงหัวข้อ แล้วอ่านกฎ (หลายซับห้ามโปรโมต)",
      "กด “เปิดหน้าโพสต์” — หัวข้อและเนื้อความถูกกรอกไว้ให้",
      "ถ้าเป็นโปรโมต ใช้แท็ก/แฟลร์ให้ถูก",
    ],
    compose(draft) {
      return {
        openUrl: urlWith("https://www.reddit.com/submit", { title: draft.title, text: `${draft.body}\n\n${draft.canonicalUrl}`.trim() }),
        text: `${draft.title}\n\n${withHashtags(draft)}`,
        warnings: ["Reddit หลายซับไม่ต้อนรับโพสต์โปรโมต — ตรวจกฎซับก่อนกดโพสต์"],
      };
    },
    plan() {
      const error = new Error("Reddit ต้องมี OAuth app + karma และกฎชุมชนเข้ม — ใช้ปุ่มเปิดหน้าโพสต์ (กรอกหัวข้อ/เนื้อหาให้แล้ว)");
      error.unsupported = { channel: "reddit" };
      throw error;
    },
    resultUrl: () => "",
  },
  {
    id: "quora",
    group: "social",
    name: "Quora Spaces",
    domain: "quora.com",
    authority: "approx",
    da: 92,
    pa: 80,
    linkType: "nofollow",
    automation: "manual",
    signup: "สมัครฟรีด้วย Google",
    signupUrl: "https://www.quora.com/",
    editorUrl: "https://www.quora.com/",
    docsUrl: "",
    supportsCanonical: false,
    limits: { title: 200, body: 40000, tags: 0 },
    why: "คำถาม-คำตอบติดอันดับ Google ง่าย และพาคนอ่านกลับเว็บได้ — เหมาะกับการตอบคำถามที่ลูกค้าถามจริง",
    steps: [
      "หาคำถามที่เกี่ยวข้องกับสินค้า/บริการ",
      "กด “เปิดหน้าเขียน” แล้ววางคำตอบที่เตรียมไว้ (ใส่ลิงก์ต้นฉบับตอนท้าย)",
    ],
    compose(draft) {
      return { openUrl: "https://www.quora.com/", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan() {
      const error = new Error("Quora ไม่มี API สำหรับโพสต์ — ใช้ปุ่มเปิดหน้าเขียนแล้ววางข้อความ");
      error.unsupported = { channel: "quora" };
      throw error;
    },
    resultUrl: () => "",
  },
  {
    id: "tumblr",
    group: "blog",
    name: "Tumblr",
    domain: "tumblr.com",
    authority: "approx",
    da: 89,
    pa: 78,
    linkType: "nofollow",
    automation: "manual",
    signup: "สมัครฟรีด้วยอีเมล",
    signupUrl: "https://www.tumblr.com/register",
    editorUrl: "https://www.tumblr.com/new/text",
    docsUrl: "https://www.tumblr.com/docs/en/api/v2",
    supportsCanonical: false,
    limits: { title: 200, body: 40000, tags: 20 },
    why: "ดัชนีเร็วและแชร์ต่อง่าย โดยเฉพาะคอนเทนต์ภาพ/ไลฟ์สไตล์ — API เป็น OAuth 1.0 ซึ่งวุ่นวายกว่าช่องอื่น",
    steps: ["กด “เปิดหน้าเขียน” แล้ววางข้อความ", "ใส่แท็ก (Tumblr ใช้แท็กเป็นระบบค้นหา)"],
    compose(draft) {
      return {
        openUrl: urlWith("https://www.tumblr.com/widgets/share/tool", {
          canonicalUrl: draft.canonicalUrl || draft.siteUrl,
          title: draft.title,
          caption: withHashtags(draft),
          posttype: "text",
        }),
        text: `${draft.title}\n\n${withHashtags(draft)}`,
      };
    },
    plan() {
      const error = new Error("Tumblr API ใช้ OAuth 1.0 (ต้องมี consumer key/secret) — ใช้ปุ่มเปิดหน้าแชร์ที่กรอกให้แล้วได้เลย");
      error.unsupported = { channel: "tumblr" };
      throw error;
    },
    resultUrl: () => "",
  },
  {
    id: "substack",
    group: "blog",
    name: "Substack",
    domain: "substack.com",
    authority: "approx",
    da: 91,
    pa: 75,
    linkType: "dofollow",
    automation: "manual",
    signup: "สมัครฟรี (จ่ายเมื่อมีคนสมัครแบบเสียเงิน)",
    signupUrl: "https://substack.com/signup",
    editorUrl: "https://substack.com/publish/post",
    docsUrl: "",
    supportsCanonical: false,
    limits: { title: 200, body: 100000, tags: 0 },
    why: "จดหมายข่าวที่ลิงก์ในเนื้อหาเป็น dofollow และผู้อ่านสมัครรับได้ — เหมาะกับการสร้างฐานลูกค้าซ้ำ",
    steps: ["สร้าง publication ฟรี", "กด “เปิดหน้าเขียน” แล้ววางจดหมายข่าว"],
    compose(draft) {
      return { openUrl: "https://substack.com/publish/post", text: `${draft.title}\n\n${withHashtags(draft)}` };
    },
    plan() {
      const error = new Error("Substack ไม่มี public write API — ใช้ปุ่มเปิดหน้าเขียน");
      error.unsupported = { channel: "substack" };
      throw error;
    },
    resultUrl: () => "",
  },
  {
    id: "facebook",
    group: "social",
    name: "Facebook Page",
    domain: "facebook.com",
    authority: "approx",
    da: 96,
    pa: 85,
    linkType: "nofollow",
    automation: "manual",
    signup: "เพจที่มีอยู่ (โพสต์อัตโนมัติใช้ Social Agency ได้)",
    signupUrl: "https://www.facebook.com/pages/create",
    editorUrl: "https://www.facebook.com/",
    docsUrl: "",
    supportsCanonical: false,
    limits: { title: 0, body: 63206, tags: 0 },
    why: "ฐานลูกค้าไทยใหญ่ที่สุด — ถ้าต้องการโพสต์อัตโนมัติแบบมีด่านอนุมัติ ใช้หน้า Social Agency ของแอปนี้ได้เลย",
    steps: [
      "คัดลอกข้อความแล้วโพสต์ที่เพจ",
      "หรือใช้ Social Agency → ปฏิทิน → รัน เพื่อโพสต์พร้อมด่านตรวจภาพ",
    ],
    compose(draft) {
      return { openUrl: "https://www.facebook.com/", text: withHashtags(draft) };
    },
    plan() {
      const error = new Error("Facebook ต้องใช้เพจ + token ของ Meta — ใช้ Social Agency ในแอปนี้เพื่อโพสต์อัตโนมัติพร้อมด่านอนุมัติ");
      error.unsupported = { channel: "facebook", fallback: "social-agency" };
      throw error;
    },
    resultUrl: () => "",
  },
];

const BY_ID = new Map(CHANNELS.map((channel) => [channel.id, channel]));

const GROUP_LABEL = {
  blog: "บล็อก/บทความ",
  dev: "นักพัฒนา",
  social: "โซเชียล",
  chat: "แชท/คอมมิวนิตี้",
  instant: "ไม่ต้องสมัคร",
};

function getChannel(id) {
  const channel = BY_ID.get(String(id || ""));
  if (!channel) throw new Error(`ไม่รู้จักช่องทาง "${id}"`);
  return channel;
}

function listChannels() {
  return CHANNELS.map((channel) => ({
    id: channel.id,
    group: channel.group,
    groupLabel: GROUP_LABEL[channel.group] || channel.group,
    name: channel.name,
    domain: channel.domain,
    authority: channel.authority,
    da: channel.da,
    pa: channel.pa,
    linkType: channel.linkType,
    automation: channel.automation,
    signup: channel.signup,
    signupUrl: channel.signupUrl,
    editorUrl: channel.editorUrl || "",
    importUrl: channel.importUrl || "",
    docsUrl: channel.docsUrl || "",
    supportsCanonical: Boolean(channel.supportsCanonical),
    limits: channel.limits,
    why: channel.why,
    steps: channel.steps,
    credentialFields: channel.automation === "api" ? credentialFields(channel) : [],
  }));
}

// Which credentials a channel asks for, so the UI can draw the right inputs
// without a second switch statement that could drift from `plan()`.
function credentialFields(channel) {
  const fields = [];
  const add = (key, label, hint = "") => fields.push({ key, label, hint, secret: /token|key|secret/i.test(key) });
  if (channel.id === "telegraph") return fields; // no account needed
  if (channel.id === "discord") add("webhookUrl", "Discord webhook URL", "Channel → Integrations → Webhooks");
  if (channel.id === "telegram") {
    add("token", "Bot token", "@BotFather → /newbot");
    add("chatId", "chat_id", "เช่น -1001234567890 หรือ @channelname");
  }
  if (channel.id === "devto") add("apiKey", "DEV API key", "Settings → Extensions → DEV Community API Keys");
  if (channel.id === "gist") add("token", "GitHub token", "scope: gist");
  if (channel.id === "wordpresscom") {
    add("site", "เว็บ WordPress.com", "เช่น yourname.wordpress.com", false);
    add("token", "OAuth token", "developer.wordpress.com/apps");
  }
  if (channel.id === "mastodon") {
    add("instance", "อินสแตนซ์", "เช่น mastodon.social", false);
    add("token", "Access token", "Preferences → Development");
  }
  if (channel.id === "blogger") {
    add("blogId", "Blog ID", "จาก URL ของ Blogger", false);
    add("token", "Google OAuth token", "scope: blogger");
  }
  return fields;
}

/**
 * The one-click post: a URL that already carries the title/text where the site
 * supports it, plus the text to paste where it does not. Never throws — a
 * publish step must be able to prepare a post even with nothing configured.
 */
function composePost(channelId, draftInput) {
  const channel = getChannel(channelId);
  const draft = normalizeDraft(draftInput);
  const maxBody = channel.limits?.body || MAX_BODY;
  const clipped = draft.body.length > maxBody
    ? `${draft.body.slice(0, maxBody)}\n\n… (ตัดให้พอดีลิมิตของ ${channel.name})`
    : draft.body;
  const composed = channel.compose({ ...draft, body: clipped }) || {};
  const warnings = [...(composed.warnings || [])];
  if (draft.body.length > maxBody) warnings.push(`ข้อความยาวเกินลิมิตของ ${channel.name} (${maxBody} ตัวอักษร) — ถูกตัด`);
  if (channel.supportsCanonical && !draft.canonicalUrl) {
    warnings.push("ยังไม่ได้ใส่ canonical URL — ถ้าโพสต์สำเนา ควรชี้กลับเว็บต้นฉบับเพื่อไม่ให้แย่งอันดับกัน");
  }
  if (channel.automation === "manual") warnings.push("ช่องนี้ต้องกดโพสต์เองบนเว็บ (ระบบเตรียมข้อความและลิงก์ให้แล้ว)");
  if (channel.automation === "import") warnings.push("ช่องนี้ใช้วิธี Import/วางข้อความด้วยมือ — API ปิดแล้ว");
  return {
    channel: channel.id,
    channelName: channel.name,
    automation: channel.automation,
    linkType: channel.linkType,
    da: channel.da,
    pa: channel.pa,
    openUrl: composed.openUrl || channel.editorUrl || channel.signupUrl || "",
    text: composed.text || `${draft.title}\n\n${clipped}`,
    title: draft.title,
    warnings,
  };
}

/**
 * The requests a channel needs to really publish. Returns an array so a channel
 * that needs two calls (Telegraph: account → page) is not a special case.
 * `{{name}}` placeholders are filled by the executor from saved values.
 */
function buildPlan(channelId, { draft: draftInput, credentials = {} } = {}) {
  const channel = getChannel(channelId);
  if (channel.automation !== "api") {
    const error = new Error(`${channel.name} ไม่ได้เปิดให้โพสต์ผ่าน API — ใช้ปุ่ม “เปิดหน้าเขียน” แทน`);
    error.unsupported = { channel: channel.id };
    throw error;
  }
  const draft = normalizeDraft(draftInput);
  const requests = channel.plan({ draft, credentials }) || [];
  return requests.map((request) => ({
    ...request,
    channel: channel.id,
    channelName: channel.name,
    body: typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}, null, 2),
  }));
}

function publishedUrl(channelId, json) {
  try {
    const channel = getChannel(channelId);
    return channel.resultUrl?.(json) || "";
  } catch {
    return "";
  }
}

function channelGroups() {
  const groups = new Map();
  for (const channel of listChannels()) {
    const list = groups.get(channel.group) || { id: channel.group, label: channel.groupLabel, channels: [] };
    list.channels.push(channel);
    groups.set(channel.group, list);
  }
  return [...groups.values()];
}

module.exports = {
  CHANNELS,
  GROUP_LABEL,
  NOTES_REVIEWED,
  buildPlan,
  channelGroups,
  composePost,
  credentialFields,
  getChannel,
  listChannels,
  normalizeDraft,
  publishedUrl,
  telegraphNodes,
  // exported for tests and for the UI preview
  helpers: { normalizeTags, hashtagLine, urlWith, stripHtml, firstLine },
};
