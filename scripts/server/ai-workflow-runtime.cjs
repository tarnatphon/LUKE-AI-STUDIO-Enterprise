// Luke AI Workflow — visual AI workflow builder runtime.
// Persistence + run history for /api/ai-workflow/* routes. Execution happens
// client-side (the frontend drives LLM / image / TTS / STT APIs and reports
// per-node results back here), mirroring how the Social Agency runtime keeps
// its state in app/runtime-state/.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_WORKFLOWS = 60;
const MAX_RUNS = 120;
const MAX_STEPS_PER_WORKFLOW = 30;
const MAX_TEXT_FIELD = 20000;
const MAX_OUTPUT_SNIPPET = 8000;

const STEP_TYPES = ["input", "chat", "image", "tts", "stt", "transform", "condition", "output"];

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
  ];
}

const STEP_DEFAULT_NAMES = {};

class AiWorkflowRuntime {
  constructor({ root }) {
    this.root = root;
    this.stateDir = path.join(root, "app", "runtime-state", "ai-workflow");
    this.filePath = path.join(this.stateDir, "state.json");
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
