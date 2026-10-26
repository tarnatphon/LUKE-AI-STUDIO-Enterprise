// Luke AI Workflow — visual AI workflow builder runtime.
// Persistence + run history for /api/ai-workflow/* routes. Execution happens
// client-side (the frontend drives LLM / image / TTS / STT APIs and reports
// per-node results back here), mirroring how the Social Agency runtime keeps
// its state in app/runtime-state/.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const channels = require("./social-publish-channels.cjs");
const publishRelay = require("./ai-workflow-publish.cjs");

const MAX_WORKFLOWS = 60;
const MAX_RUNS = 120;
const MAX_STEPS_PER_WORKFLOW = 30;
const MAX_TEXT_FIELD = 20000;
const MAX_OUTPUT_SNIPPET = 8000;

const STEP_TYPES = [
  "input", "chat", "image", "tts", "stt", "transform", "condition", "output",
  // publishing: `publish` really posts through the local relay (API channels
  // only), `onepost` composes the same post for a channel that needs one click.
  "publish", "onepost",
];

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(value, { max = MAX_TEXT_FIELD, allowEmpty = true } = {}) {
  const s = String(value ?? "");
  if (!allowEmpty && !s.trim()) throw new Error("ต้องกรอกข้อความ");
  if (s.length > max) throw new Error(`ข้อความยาวเกินไป (สูงสุด ${max} ตัวอักษร)`);
  return s;
}

// Sanitize one step of a workflow. Throws on invalid input so the API returns
// a clear 400 instead of persisting junk.
function sanitizeStep(raw, index) {
  if (!raw || typeof raw !== "object") throw new Error(`โหนดที่ ${index + 1} ไม่ถูกต้อง`);
  const type = String(raw.type || "");
  if (!STEP_TYPES.includes(type)) throw new Error(`โหนดที่ ${index + 1}: ชนิด "${type}" ไม่รองรับ`);
  const name = cleanText(raw.name || STEP_DEFAULT_NAMES[type] || type, { max: 60, allowEmpty: false });
  const config = { ...(raw.config || {}) };
  switch (type) {
    case "input":
      config.text = cleanText(config.text);
      break;
    case "chat":
      config.system = cleanText(config.system);
      config.prompt = cleanText(config.prompt, { allowEmpty: false });
      config.temperature = clampNumber(config.temperature, 0, 2, 0.7);
      config.maxTokens = clampNumber(config.maxTokens, 32, 8192, 1024);
      break;
    case "image":
      config.prompt = cleanText(config.prompt, { allowEmpty: false });
      config.negativePrompt = cleanText(config.negativePrompt);
      config.width = clampNumber(config.width, 256, 2048, 1024);
      config.height = clampNumber(config.height, 256, 2048, 1024);
      config.steps = clampNumber(config.steps, 1, 60, 20);
      config.cfgScale = clampNumber(config.cfgScale, 1, 20, 7);
      config.sampler = cleanText(config.sampler, { max: 40 }) || "euler_a";
      break;
    case "tts":
      config.text = cleanText(config.text, { allowEmpty: false });
      config.voice = cleanText(config.voice, { max: 60 });
      config.speed = clampNumber(config.speed, 0.5, 2, 1);
      break;
    case "stt":
      config.fromStep = cleanText(config.fromStep, { max: 60 });
      config.language = cleanText(config.language, { max: 12 });
      break;
    case "transform":
      config.template = cleanText(config.template, { allowEmpty: false });
      config.find = cleanText(config.find, { max: 2000 });
      config.replace = cleanText(config.replace);
      config.truncate = clampNumber(config.truncate, 0, 20000, 0);
      break;
    case "condition":
      config.mode = ["contains", "not_contains", "regex", "min_length", "max_length"].includes(config.mode) ? config.mode : "contains";
      config.value = cleanText(config.value, { max: 2000 });
      break;
    case "publish":
    case "onepost": {
      const channelId = cleanText(config.channel, { max: 40, allowEmpty: false });
      const known = channels.listChannels().some((channel) => channel.id === channelId);
      if (!known) throw new Error(`โหนดที่ ${index + 1}: ไม่รู้จักช่องทางโพสต์ "${channelId}"`);
      if (type === "publish" && channels.getChannel(channelId).automation !== "api") {
        throw new Error(`โหนดที่ ${index + 1}: ${channels.getChannel(channelId).name} โพสต์อัตโนมัติไม่ได้ — ใช้โหนด “โพสต์คลิกเดียว” แทน`);
      }
      config.channel = channelId;
      config.title = cleanText(config.title, { max: 200 });
      config.body = cleanText(config.body, { max: 20000 });
      config.canonicalUrl = cleanText(config.canonicalUrl, { max: 500 });
      config.imageUrl = cleanText(config.imageUrl, { max: 500 });
      config.tags = (Array.isArray(config.tags) ? config.tags : [])
        .map((tag) => cleanText(tag, { max: 40 }).trim())
        .filter(Boolean)
        .slice(0, 8);
      config.appendCanonical = config.appendCanonical !== false;
      break;
    }
    case "output":
      break;
    default:
      break;
  }
  return { id: cleanText(raw.id, { max: 40, allowEmpty: false }), type, name, config };
}

function sanitizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) throw new Error("steps ต้องเป็นอาร์เรย์");
  if (rawSteps.length > MAX_STEPS_PER_WORKFLOW) throw new Error(`โหนดเยอะเกินไป (สูงสุด ${MAX_STEPS_PER_WORKFLOW} โหนด)`);
  const steps = rawSteps.map(sanitizeStep);
  const ids = new Set(steps.map((s) => s.id));
  if (ids.size !== steps.length) throw new Error("มีโหนดที่ id ซ้ำกัน");
  return steps;
}

// Trim a run node's output for storage — artifacts such as base64 images must
// never bloat the state file, so keep only small metadata.
function snippet(value) {
  const s = String(value ?? "");
  return s.length > MAX_OUTPUT_SNIPPET ? `${s.slice(0, MAX_OUTPUT_SNIPPET)}… (${s.length} ตัวอักษร)` : s;
}

function sanitizeRunNode(node) {
  if (!node || typeof node !== "object") return null;
  const artifact = node.artifact && typeof node.artifact === "object"
    ? {
        kind: cleanText(node.artifact.kind, { max: 20 }),
        url: typeof node.artifact.url === "string" ? node.artifact.url.slice(0, 500) : undefined,
        file: typeof node.artifact.file === "string" ? node.artifact.file.slice(0, 300) : undefined,
        seed: Number.isFinite(Number(node.artifact.seed)) ? Number(node.artifact.seed) : undefined,
        // A published post keeps its channel and the link that proves it. The
        // body itself is not copied into the state file — it is as long as the
        // post and the workflow already holds the template that made it.
        channel: typeof node.artifact.channel === "string" ? node.artifact.channel.slice(0, 40) : undefined,
        channelName: typeof node.artifact.channelName === "string" ? node.artifact.channelName.slice(0, 60) : undefined,
      }
    : null;
  return {
    id: cleanText(node.id, { max: 40 }),
    name: cleanText(node.name, { max: 60 }),
    type: cleanText(node.type, { max: 20 }),
    status: ["idle", "running", "done", "failed", "halted", "skipped"].includes(node.status) ? node.status : "idle",
    output: snippet(node.output),
    error: snippet(node.error),
    durationMs: Number.isFinite(Number(node.durationMs)) ? Number(node.durationMs) : null,
    artifact,
  };
}

function seedWorkflows() {
  const now = new Date().toISOString();
  return [
    {
      id: newId("wf"),
      name: "ตัวอย่าง: โพสต์จากหัวข้อ → ภาพ → เสียงอ่าน",
      steps: [
        { id: newId("s"), type: "input", name: "หัวข้อสินค้า", config: { text: "กระเป๋าผ้ามือสองรีไซเคิล รุ่น Bangkok Noon\nจุดขาย: ทนทาน กันน้ำ พิมพ์ลายไทยร่วมสมัย" } },
        { id: newId("s"), type: "chat", name: "เขียนแคปชัน", config: { system: "คุณคือนักเขียนคอนเทนต์โซเชียลมาร์เก็ตติ้งคนไทย เขียนกระชับ เป็นกันเอง", prompt: "เขียนแคปชันโพสต์ Facebook จากข้อมูลสินค้านี้ 3-4 บรรทัด พร้อมแฮชแท็ก 3 อัน:\n{{input}}", temperature: 0.7, maxTokens: 1024 } },
        { id: newId("s"), type: "image", name: "ภาพประกอบ", config: { prompt: "product photography of {{input}} on wooden table, soft morning light, minimal thai modern style, high detail", negativePrompt: "blurry, low quality, text, watermark", width: 1024, height: 1024, steps: 20, cfgScale: 7, sampler: "euler_a" } },
        { id: newId("s"), type: "tts", name: "เสียงอ่านแคปชัน", config: { text: "{{เขียนแคปชัน}}", voice: "", speed: 1 } },
        { id: newId("s"), type: "output", name: "ผลลัพธ์", config: {} },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: newId("wf"),
      name: "ตัวอย่าง: ครีเอทีฟบรีฟอัตโนมัติ",
      steps: [
        { id: newId("s"), type: "input", name: "โจทย์แคมเปญ", config: { text: "แคมเปญเปิดตัวคอลเลกชันฤดูร้อน กลุ่มเป้าหมาย Gen Z กรุงเทพฯ งบเบา แต่อยากไวรัล" } },
        { id: newId("s"), type: "chat", name: "ร่างบรีฟ", config: { system: "คุณคือ creative director ที่เก่งงานแคมเปญโซเชียล", prompt: "จากโจทย์นี้ ร่างครีเอทีฟบรีฟ:  big idea, key message, tone, แนวคอนเทนต์ 3 แนว\n{{input}}", temperature: 0.8, maxTokens: 1024 } },
        { id: newId("s"), type: "condition", name: "เช็คความยาว", config: { mode: "min_length", value: "120" } },
        { id: newId("s"), type: "output", name: "ส่งมอบบรีฟ", config: {} },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      // The "write once, publish to free high-authority sites" recipe. Two nodes
      // really publish (dev.to via API, Telegraph with no account at all); the
      // other two need one click, with the text already composed.
      id: newId("wf"),
      name: "โพสต์ฟรีหลายเว็บ (High DA) — เขียนครั้งเดียว",
      steps: [
        { id: newId("s"), type: "input", name: "หัวข้อ/สินค้า", config: { text: "กระเป๋าผ้า OEM รุ่น Bangkok Noon\nจุดขาย: กันน้ำ ทนทาน พิมพ์ลายไทยร่วมสมัย สั่งขั้นต่ำ 100 ใบ" } },
        {
          id: newId("s"), type: "chat", name: "เขียนบทความ", config: {
            system: "คุณคือนักเขียนคอนเทนต์ SEO ภาษาไทย เขียนจริง ไม่ใส่คำโฆษณาเกินจริง ไม่แต่งราคาที่ไม่มีข้อมูล",
            prompt: "เขียนบทความสั้น 400-600 คำ จากข้อมูลนี้ ขึ้นต้นด้วยบรรทัดชื่อเรื่องที่ขึ้นต้นด้วย # แล้วเว้นบรรทัด:\n{{input}}",
            temperature: 0.7, maxTokens: 1400,
          },
        },
        { id: newId("s"), type: "transform", name: "ตัดเอาเนื้อหา", config: { template: "{{เขียนบทความ}}", find: "^#.*\n+", replace: "", truncate: 8000 } },
        { id: newId("s"), type: "publish", name: "DEV Community", config: { channel: "devto", title: "{{หัวข้อ/สินค้า}}", body: "{{ตัดเอาเนื้อหา}}", tags: ["thai", "smallbusiness", "ecommerce"], canonicalUrl: "", imageUrl: "", appendCanonical: true } },
        { id: newId("s"), type: "publish", name: "อัตโนมัติ: Telegraph (ไม่ต้องสมัคร)", config: { channel: "telegraph", title: "{{หัวข้อ/สินค้า}}", body: "{{ตัดเอาเนื้อหา}}", tags: [], canonicalUrl: "", imageUrl: "", appendCanonical: true } },
        { id: newId("s"), type: "onepost", name: "คลิกเดียว: Medium (นำเข้า)", config: { channel: "medium", title: "{{หัวข้อ/สินค้า}}", body: "{{ตัดเอาเนื้อหา}}", tags: [], canonicalUrl: "", imageUrl: "", appendCanonical: true } },
        { id: newId("s"), type: "onepost", name: "คลิกเดียว: LinkedIn", config: { channel: "linkedin", title: "{{หัวข้อ/สินค้า}}", body: "{{ตัดเอาเนื้อหา}}", tags: [], canonicalUrl: "", imageUrl: "", appendCanonical: true } },
        { id: newId("s"), type: "output", name: "ผลลัพธ์", config: {} },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      // Automation-only recipe: the two chat channels really post, because a bot
      // token or webhook URL needs no developer app and no review.
      id: newId("wf"),
      name: "ประกาศโปรโมชัน → Telegram + Discord อัตโนมัติ",
      steps: [
        { id: newId("s"), type: "input", name: "โปรโมชัน", config: { text: "ลด 10% กระเป๋าผ้า OEM เมื่อสั่ง 300 ใบขึ้นไป ถึงสิ้นเดือนนี้เท่านั้น" } },
        {
          id: newId("s"), type: "chat", name: "เขียนประกาศ", config: {
            system: "คุณคือแอดมินเพจ เขียนประกาศสั้น กระชับ มีอีโมจิ ไม่เกิน 400 ตัวอักษร",
            prompt: "เขียนประกาศจากข้อมูลนี้:\n{{input}}",
            temperature: 0.6, maxTokens: 400,
          },
        },
        { id: newId("s"), type: "condition", name: "เช็คความยาว", config: { mode: "max_length", value: "900" } },
        { id: newId("s"), type: "publish", name: "Telegram", config: { channel: "telegram", title: "ประกาศโปรโมชัน", body: "{{เขียนประกาศ}}", tags: [], canonicalUrl: "", imageUrl: "", appendCanonical: true } },
        { id: newId("s"), type: "publish", name: "Discord", config: { channel: "discord", title: "ประกาศโปรโมชัน", body: "{{เขียนประกาศ}}", tags: [], canonicalUrl: "", imageUrl: "", appendCanonical: true } },
        { id: newId("s"), type: "output", name: "ผลลัพธ์", config: {} },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

const STEP_DEFAULT_NAMES = {};

class AiWorkflowRuntime {
  constructor({ root }) {
    this.root = root;
    this.stateDir = path.join(root, "app", "runtime-state", "ai-workflow");
    this.filePath = path.join(this.stateDir, "state.json");
    // Publishing keys live in their own file and never travel in a workflow or
    // a run record: /state does not expose them, only "which fields are set".
    this.credentialsPath = path.join(this.stateDir, "publish-credentials.json");
    this._read(); // load or seed eagerly
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      };
    } catch {
      this.state = { workflows: seedWorkflows(), runs: [] };
      this._write(this.state);
    }
    return this.state;
  }

  _write(state) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.filePath);
    this.state = state;
  }

  _readCredentials() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.credentialsPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  _writeCredentials(map) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const tmp = `${this.credentialsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.credentialsPath);
    try { fs.chmodSync(this.credentialsPath, 0o600); } catch { /* best effort on non-POSIX */ }
  }

  // What the UI may see: field names that exist, never their values.
  credentialStatus() {
    const stored = this._readCredentials();
    const status = {};
    for (const channel of channels.listChannels()) {
      const fields = channels.credentialFields(channel);
      if (!fields.length) continue;
      const values = stored[channel.id] || {};
      status[channel.id] = Object.fromEntries(fields.map((field) => [field.key, Boolean(values[field.key])]));
    }
    return status;
  }

  updateCredentials(channelId, values) {
    const channel = channels.getChannel(channelId);
    if (channel.automation !== "api") throw new Error(`${channel.name} ไม่ได้ใช้คีย์ (โพสต์ด้วยมือ)`);
    const fields = channels.credentialFields(channel);
    if (!fields.length) throw new Error(`${channel.name} ไม่ต้องใช้คีย์`);
    if (!values || typeof values !== "object") throw new Error("ต้องส่งค่าเป็น object");
    const stored = this._readCredentials();
    const current = { ...(stored[channel.id] || {}) };
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(values, field.key)) continue;
      const raw = String(values[field.key] ?? "").trim();
      if (!raw) delete current[field.key];
      else current[field.key] = raw.slice(0, 2000);
    }
    stored[channel.id] = current;
    this._writeCredentials(stored);
    return { channelId, fields: Object.fromEntries(fields.map((field) => [field.key, Boolean(current[field.key])])) };
  }

  credentialsFor(channelId) {
    const stored = this._readCredentials();
    return { ...(stored[channelId] || {}) };
  }

  /** Compose the one-click post for a channel (no network, no secrets). */
  previewPublish({ channelId, draft }) {
    return channels.composePost(channelId, draft || {});
  }

  /**
   * Build and (unless dry-run) execute the request(s) a channel needs.
   * A dry run returns the plan with every stored secret replaced by [set], so
   * it can be shown in the UI and pasted into a bug report safely.
   */
  async sendPublish({ channelId, draft, dryRun = false }) {
    const channel = channels.getChannel(channelId);
    const credentials = this.credentialsFor(channelId);
    let plan;
    try {
      plan = channels.buildPlan(channelId, { draft: draft || {}, credentials });
    } catch (error) {
      if (error.unsupported) {
        const fallback = channels.composePost(channelId, draft || {});
        return {
          channel: channelId, channelName: channel.name, ok: false, manual: true,
          message: error.message,
          openUrl: fallback.openUrl,
          text: fallback.text,
          warnings: fallback.warnings,
        };
      }
      throw error;
    }
    const mask = (value) => {
      let out = String(value);
      for (const secret of Object.values(credentials)) {
        if (secret && secret.length >= 4) out = out.split(secret).join("[set]");
      }
      return out;
    };
    const redacted = plan.map((request) => ({
      channel: request.channel,
      method: request.method || "POST",
      url: mask(request.url),
      headers: Object.fromEntries(Object.entries(request.headers || {}).map(([key, value]) => [key, mask(value)])),
      body: mask(request.body),
    }));
    if (dryRun) {
      return {
        channel: channelId, channelName: channel.name, dryRun: true, ok: true,
        requests: redacted,
        message: `พร้อมส่ง ${redacted.length} คำขอ — ยังไม่ได้ส่งจริง (dry-run)`,
      };
    }
    const { results } = await publishRelay.runPlan(plan, { variables: {} });
    const last = results[results.length - 1] || {};
    const url = channels.publishedUrl(channelId, last.json) || "";
    return {
      channel: channelId,
      channelName: channel.name,
      ok: true,
      url,
      status: last.status,
      steps: results.map((entry, index) => ({
        url: redacted[index]?.url || entry.url,
        status: entry.status,
        ok: entry.ok,
      })),
      message: url ? `โพสต์แล้ว: ${url}` : `ส่งสำเร็จ (HTTP ${last.status})`,
    };
  }

  getState() {
    const state = this._read();
    return {
      workflows: state.workflows,
      runs: state.runs.slice(0, 30),
      stats: {
        workflowCount: state.workflows.length,
        runCount: state.runs.length,
        successCount: state.runs.filter((r) => r.status === "success").length,
        failedCount: state.runs.filter((r) => r.status === "failed").length,
      },
      channels: channels.listChannels(),
      channelGroups: channels.channelGroups(),
      channelCredentials: this.credentialStatus(),
      channelsReviewedAt: channels.NOTES_REVIEWED,
      serverNow: new Date().toISOString(),
    };
  }

  createWorkflow({ name }) {
    const cleanName = cleanText(name, { max: 80, allowEmpty: false });
    const state = this._read();
    if (state.workflows.length >= MAX_WORKFLOWS) throw new Error(`เวิร์กโฟลว์เยอะเกินไป (สูงสุด ${MAX_WORKFLOWS} อัน)`);
    const now = new Date().toISOString();
    const wf = {
      id: newId("wf"),
      name: cleanName,
      steps: [
        { id: newId("s"), type: "input", name: "ข้อความตั้งต้น", config: { text: "" } },
        { id: newId("s"), type: "output", name: "ผลลัพธ์", config: {} },
      ],
      createdAt: now,
      updatedAt: now,
    };
    state.workflows.unshift(wf);
    this._write(state);
    return wf;
  }

  updateWorkflow(id, patch) {
    const state = this._read();
    const wf = state.workflows.find((w) => w.id === id);
    if (!wf) throw new Error("ไม่พบเวิร์กโฟลว์นี้");
    if (patch.name !== undefined) wf.name = cleanText(patch.name, { max: 80, allowEmpty: false });
    if (patch.steps !== undefined) wf.steps = sanitizeSteps(patch.steps);
    wf.updatedAt = new Date().toISOString();
    this._write(state);
    return wf;
  }

  duplicateWorkflow(id) {
    const state = this._read();
    if (state.workflows.length >= MAX_WORKFLOWS) throw new Error(`เวิร์กโฟลว์เยอะเกินไป (สูงสุด ${MAX_WORKFLOWS} อัน)`);
    const wf = state.workflows.find((w) => w.id === id);
    if (!wf) throw new Error("ไม่พบเวิร์กโฟลว์นี้");
    const now = new Date().toISOString();
    const copy = {
      id: newId("wf"),
      name: `${wf.name} (สำเนา)`.slice(0, 80),
      steps: (wf.steps || []).map((s) => ({ ...s, id: newId("s"), config: { ...(s.config || {}) } })),
      createdAt: now,
      updatedAt: now,
    };
    const idx = state.workflows.findIndex((w) => w.id === id);
    state.workflows.splice(idx + 1, 0, copy);
    this._write(state);
    return copy;
  }

  deleteWorkflow(id) {
    const state = this._read();
    const before = state.workflows.length;
    state.workflows = state.workflows.filter((w) => w.id !== id);
    if (state.workflows.length === before) throw new Error("ไม่พบเวิร์กโฟลว์นี้");
    state.runs = state.runs.filter((r) => r.workflowId !== id);
    this._write(state);
    return { deleted: true };
  }

  listRuns({ workflowId, limit = 30 } = {}) {
    const state = this._read();
    let runs = state.runs;
    if (workflowId) runs = runs.filter((r) => r.workflowId === workflowId);
    return runs.slice(0, clampNumber(limit, 1, 100, 30));
  }

  recordRun(payload) {
    const state = this._read();
    if (!payload || typeof payload !== "object") throw new Error("ข้อมูล run ไม่ถูกต้อง");
    const workflowId = cleanText(payload.workflowId, { max: 40, allowEmpty: false });
    const wf = state.workflows.find((w) => w.id === workflowId);
    if (!wf) throw new Error("ไม่พบเวิร์กโฟลว์ของ run นี้");
    const nodes = Array.isArray(payload.nodes) ? payload.nodes.map(sanitizeRunNode).filter(Boolean) : [];
    const run = {
      id: newId("run"),
      workflowId,
      workflowName: wf.name,
      status: ["success", "failed", "halted"].includes(payload.status) ? payload.status : "failed",
      input: snippet(payload.input),
      startedAt: cleanText(payload.startedAt, { max: 40 }) || new Date().toISOString(),
      finishedAt: cleanText(payload.finishedAt, { max: 40 }),
      durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : null,
      nodes,
    };
    state.runs.unshift(run);
    state.runs = state.runs.slice(0, MAX_RUNS);
    this._write(state);
    return run;
  }

  deleteRun(id) {
    const state = this._read();
    const before = state.runs.length;
    state.runs = state.runs.filter((r) => r.id !== id);
    if (state.runs.length === before) throw new Error("ไม่พบ run นี้");
    this._write(state);
    return { deleted: true };
  }

  // ── HTTP API router (all /api/ai-workflow/* routes) ──
  async handleApiRequest(req, res, { readJsonRequestBody, json }) {
    const parsed = new URL(req.url, "http://localhost");
    const pathname = parsed.pathname;
    const method = req.method;
    const fail = (error, code = 400) => json(res, code, { ok: false, error: error.message || String(error) });
    const readBody = async () => (await readJsonRequestBody(req)) || {};

    try {
      if (pathname === "/api/ai-workflow/state" && method === "GET") {
        return json(res, 200, { ok: true, state: this.getState() });
      }

      const wfMatch = pathname.match(/^\/api\/ai-workflow\/workflows\/([^/]+)(\/duplicate)?$/);
      if (wfMatch && method === "POST" && wfMatch[2] === "/duplicate") {
        return json(res, 201, { ok: true, workflow: this.duplicateWorkflow(decodeURIComponent(wfMatch[1])) });
      }
      if (wfMatch && method === "PATCH") {
        const body = await readBody();
        return json(res, 200, { ok: true, workflow: this.updateWorkflow(decodeURIComponent(wfMatch[1]), body) });
      }
      if (wfMatch && method === "DELETE") {
        return json(res, 200, { ok: true, ...this.deleteWorkflow(decodeURIComponent(wfMatch[1])) });
      }

      if (pathname === "/api/ai-workflow/workflows" && method === "POST") {
        const body = await readBody();
        return json(res, 201, { ok: true, workflow: this.createWorkflow(body) });
      }

      if (pathname === "/api/ai-workflow/runs" && method === "GET") {
        const workflowId = parsed.searchParams.get("workflowId") || undefined;
        const limit = Number(parsed.searchParams.get("limit")) || 30;
        return json(res, 200, { ok: true, runs: this.listRuns({ workflowId, limit }) });
      }
      if (pathname === "/api/ai-workflow/runs" && method === "POST") {
        const body = await readBody();
        return json(res, 201, { ok: true, run: this.recordRun(body) });
      }

      // ── publishing channels ──
      if (pathname === "/api/ai-workflow/channels" && method === "GET") {
        return json(res, 200, {
          ok: true,
          groups: channels.channelGroups(),
          channels: channels.listChannels(),
          credentials: this.credentialStatus(),
          reviewedAt: channels.NOTES_REVIEWED,
        });
      }
      if (pathname === "/api/ai-workflow/publish/credentials" && method === "GET") {
        return json(res, 200, { ok: true, credentials: this.credentialStatus() });
      }
      if (pathname === "/api/ai-workflow/publish/credentials" && (method === "PATCH" || method === "POST")) {
        const body = await readBody();
        const channelId = cleanText(body.channelId, { max: 40, allowEmpty: false });
        return json(res, 200, { ok: true, ...this.updateCredentials(channelId, body.values || body.credentials || {}) });
      }
      if (pathname === "/api/ai-workflow/publish/preview" && method === "POST") {
        const body = await readBody();
        return json(res, 200, { ok: true, preview: this.previewPublish(body) });
      }
      if (pathname === "/api/ai-workflow/publish/send" && method === "POST") {
        const body = await readBody();
        const result = await this.sendPublish(body);
        return json(res, 200, { ok: true, result });
      }

      const runMatch = pathname.match(/^\/api\/ai-workflow\/runs\/([^/]+)$/);
      if (runMatch && method === "DELETE") {
        return json(res, 200, { ok: true, ...this.deleteRun(decodeURIComponent(runMatch[1])) });
      }

      return false; // not handled
    } catch (error) {
      return fail(error, 400);
    }
  }
}

module.exports = { AiWorkflowRuntime, STEP_TYPES };
