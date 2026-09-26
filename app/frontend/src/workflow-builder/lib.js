// Luke AI Workflow Builder — step metadata, template engine, and the run engine.
// Execution happens in the frontend: steps call the SAME local APIs used by the
// Chat / Create Image / TTS / Speech workspaces, then results are reported to
// the backend runtime for run history (app/runtime-state/ai-workflow/).

import {
  Type, MessageSquare, Image as ImageIcon, Volume2, Mic, Wand2, GitBranch, Flag,
} from "lucide-react";
import { chatWithLlm, generateImage, speakTts, transcribeSpeech } from "../services/api";

export const STEP_TYPES = {
  input: { label: "ข้อความตั้งต้น", short: "Input", icon: Type, desc: "จุดเริ่มของเวิร์กโฟลว์ — หัวข้อ โจทย์ หรือข้อมูลดิบ", hasOutput: true },
  chat: { label: "AI Chat (LLM)", short: "Chat", icon: MessageSquare, desc: "เขียน แปล สรุป หรือร่างไอเดียด้วยโมเดลแชทในเครื่อง", hasOutput: true },
  image: { label: "สร้างภาพ", short: "Image", icon: ImageIcon, desc: "สร้างภาพจากข้อความด้วย Stable Diffusion", hasOutput: true },
  tts: { label: "อ่านออกเสียง (TTS)", short: "TTS", icon: Volume2, desc: "แปลงข้อความเป็นเสียงพูดด้วย Kokoro", hasOutput: true },
  stt: { label: "เสียง → ข้อความ (STT)", short: "STT", icon: Mic, desc: "ถอดเสียงจากผลลัพธ์ TTS ก่อนหน้าเป็นข้อความ (Whisper)", hasOutput: true },
  transform: { label: "จัดข้อความ", short: "Transform", icon: Wand2, desc: "ใส่แม่แบบ ค้นหา/แทนที่ หรือตัดให้สั้น", hasOutput: true },
  condition: { label: "เงื่อนไข", short: "If", icon: GitBranch, desc: "เช็คข้อความ — ไม่ผ่านจะหยุดเวิร์กโฟลว์", hasOutput: false },
  output: { label: "ผลลัพธ์", short: "Output", icon: Flag, desc: "ปลายทาง — แสดงและเก็บผลรวมของเวิร์กโฟลว์", hasOutput: true },
};

export function newStep(type) {
  const base = { id: `s-${Math.random().toString(36).slice(2, 10)}`, type, name: STEP_TYPES[type]?.label || type };
  switch (type) {
    case "input": return { ...base, config: { text: "" } };
    case "chat": return { ...base, name: "AI Chat", config: { system: "", prompt: "{{input}}", temperature: 0.7, maxTokens: 1024 } };
    case "image": return { ...base, name: "สร้างภาพ", config: { prompt: "{{input}}", negativePrompt: "", width: 1024, height: 1024, steps: 20, cfgScale: 7, sampler: "euler_a" } };
    case "tts": return { ...base, name: "อ่านออกเสียง", config: { text: "{{input}}", voice: "", speed: 1 } };
    case "stt": return { ...base, name: "ถอดเสียง", config: { fromStep: "", language: "" } };
    case "transform": return { ...base, name: "จัดข้อความ", config: { template: "{{input}}", find: "", replace: "", truncate: 0 } };
    case "condition": return { ...base, name: "เงื่อนไข", config: { mode: "contains", value: "" } };
    case "output": return { ...base, name: "ผลลัพธ์", config: {} };
    default: return { ...base, config: {} };
  }
}

// ── Template engine ─────────────────────────────────────────────────────────
// {{input}} = output of the previous step · {{ชื่อโหนด}} = output of any named step
export function resolveTemplate(template, ctx) {
  return String(template ?? "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, rawKey) => {
    const key = rawKey.trim();
    if (key === "input") return ctx.input == null ? "" : String(ctx.input);
    const byName = ctx.byName[key];
    if (byName != null) return String(byName);
    return ""; // unknown variable resolves to empty (validated visually in UI)
  });
}

export function templateVariables(template) {
  const out = new Set();
  String(template ?? "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, rawKey) => { out.add(rawKey.trim()); });
  return [...out];
}

// ── Run engine ──────────────────────────────────────────────────────────────
// Runs one step against the local AI APIs. Returns { output, artifact, meta }.
// Throws on failure; the caller marks the node failed.
export async function execStep(step, ctx) {
  const cfg = step.config || {};
  switch (step.type) {
    case "input": {
      return { output: resolveTemplate(cfg.text, ctx) };
    }
    case "chat": {
      const prompt = resolveTemplate(cfg.prompt, ctx);
      const messages = [];
      if (String(cfg.system || "").trim()) messages.push({ role: "system", content: String(cfg.system) });
      messages.push({ role: "user", content: prompt });
      const res = await chatWithLlm(messages, {
        temperature: Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : 0.7,
        maxTokens: Number.isFinite(Number(cfg.maxTokens)) ? Number(cfg.maxTokens) : 1024,
      });
      return { output: res.content, meta: res.usage };
    }
    case "image": {
      const prompt = resolveTemplate(cfg.prompt, ctx);
      const negativePrompt = resolveTemplate(cfg.negativePrompt, ctx);
      const constraints = {
        width: Number(cfg.width) || 1024,
        height: Number(cfg.height) || 1024,
        steps: Number(cfg.steps) || 20,
        cfgScale: Number(cfg.cfgScale) || 7,
        sampler: cfg.sampler || "euler_a",
        seed: -1,
      };
      const result = await generateImage(prompt, negativePrompt, constraints, null, null, null, null);
      return {
        output: prompt,
        artifact: { kind: "image", dataUrl: result.image, seed: result.seed },
      };
    }
    case "tts": {
      const text = resolveTemplate(cfg.text, ctx);
      const options = { speed: Number(cfg.speed) || 1 };
      if (cfg.voice) options.voice = cfg.voice;
      const output = await speakTts(text, options);
      return {
        output: text,
        artifact: { kind: "audio", url: output?.url || "", file: output?.audioFile || "" },
      };
    }
    case "stt": {
      const source = ctx.artifactsByStepId[cfg.fromStep] || ctx.lastAudioArtifact;
      if (!source || source.kind !== "audio" || !source.url) {
        throw new Error("ไม่พบเสียงสำหรับถอดข้อความ — ต้องมีโหนด TTS ก่อนหน้า (หรือเลือกโหนดเสียงในตั้งค่า)");
      }
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`โหลดไฟล์เสียงไม่สำเร็จ (HTTP ${res.status})`);
      const blob = await res.blob();
      const options = {};
      if (cfg.language) options.language = cfg.language;
      if (source.file) options.filename = source.file;
      const transcription = await transcribeSpeech(blob, options);
      return { output: transcription?.text || "" };
    }
    case "transform": {
      let text = resolveTemplate(cfg.template, ctx);
      if (String(cfg.find || "").length) {
        try {
          text = text.replace(new RegExp(cfg.find, "g"), cfg.replace ?? "");
        } catch {
          text = text.split(cfg.find).join(cfg.replace ?? "");
        }
      }
      const limit = Number(cfg.truncate) || 0;
      if (limit > 0 && text.length > limit) text = `${text.slice(0, limit)}…`;
      return { output: text };
    }
    case "condition": {
      const text = String(ctx.input ?? "");
      const value = String(cfg.value ?? "");
      let pass = true;
      let summary = "";
      switch (cfg.mode) {
        case "contains": pass = text.includes(value); summary = `มีคำว่า "${value}"`; break;
        case "not_contains": pass = !text.includes(value); summary = `ไม่มีคำว่า "${value}"`; break;
        case "regex": {
          try { pass = new RegExp(value).test(text); summary = `ตรงกับ /${value}/`; }
          catch { throw new Error("Regular expression ไม่ถูกต้อง"); }
          break;
        }
        case "min_length": pass = text.length >= (Number(value) || 0); summary = `ยาวอย่างน้อย ${Number(value) || 0} ตัวอักษร (ตอนนี้ ${text.length})`; break;
        case "max_length": pass = text.length <= (Number(value) || 0); summary = `ยาวไม่เกิน ${Number(value) || 0} ตัวอักษร (ตอนนี้ ${text.length})`; break;
        default: pass = true;
      }
      if (!pass) {
        const err = new Error(`เงื่อนไขไม่ผ่าน: ${summary}`);
        err.halted = true;
        throw err;
      }
      return { output: `${summary} — ผ่าน` };
    }
    case "output": {
      return { output: String(ctx.input ?? "") };
    }
    default:
      throw new Error(`ไม่รู้จักชนิดโหนด "${step.type}"`);
  }
}

// Sequential runner over a workflow's steps. onNodeUpdate(id, patch) is called
// as each node transitions, so the UI can render live progress.
export async function runWorkflowSteps(steps, { onNodeUpdate, shouldCancel }) {
  const byName = {};
  const artifactsByStepId = {};
  const nodes = steps.map((s) => ({ id: s.id, name: s.name, type: s.type, status: "idle", output: "", error: "", durationMs: null, artifact: null }));
  const startedMs = Date.now();
  let input = "";
  let lastAudioArtifact = null;
  let status = "success";

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const node = nodes.find((n) => n.id === step.id);
    if (shouldCancel()) {
      status = "halted";
      node.status = "skipped";
      onNodeUpdate(step.id, { status: "skipped" });
      markFrom(nodes, step.id, "skipped");
      for (const n of nodes) if (n.status === "skipped") onNodeUpdate(n.id, { status: "skipped" });
      return { nodes, status, durationMs: Date.now() - startedMs };
    }
    onNodeUpdate(step.id, { status: "running", error: "", output: "" });
    node.status = "running";
    const t0 = Date.now();
    try {
      const ctx = { input, byName, artifactsByStepId, lastAudioArtifact };
      const result = await execStep(step, ctx);
      node.status = "done";
      node.output = String(result.output ?? "");
      node.durationMs = Date.now() - t0;
      node.artifact = result.artifact || null;
      onNodeUpdate(step.id, { status: "done", output: node.output, durationMs: node.durationMs, artifact: node.artifact });
      if (node.artifact?.kind === "audio") lastAudioArtifact = node.artifact;
      artifactsByStepId[step.id] = node.artifact;
      byName[step.name] = node.output;
      // condition nodes are pass-through gates — downstream keeps the input as-is
      if (step.type !== "condition") input = node.output;
    } catch (err) {
      node.status = err.halted ? "halted" : "failed";
      node.error = err.message || String(err);
      node.durationMs = Date.now() - t0;
      onNodeUpdate(step.id, { status: node.status, error: node.error, durationMs: node.durationMs });
      status = err.halted ? "halted" : "failed";
      markFrom(nodes, step.id, "skipped");
      for (const n of nodes) if (n.status === "skipped") onNodeUpdate(n.id, { status: "skipped" });
      return { nodes, status, durationMs: Date.now() - startedMs };
    }
  }
  return { nodes, status, durationMs: Date.now() - startedMs };
}

// Mark every idle node after `stopId` as skipped (chain stopped early).
function markFrom(nodes, stopId, status) {
  const idx = nodes.findIndex((n) => n.id === stopId);
  for (let i = idx + 1; i < nodes.length; i += 1) {
    if (nodes[i].status === "idle") nodes[i].status = status;
  }
}

export const RUN_STATUS_TH = {
  success: "สำเร็จ",
  failed: "ล้มเหลว",
  halted: "หยุดตามเงื่อนไข",
  running: "กำลังรัน",
  idle: "รอสั่ง",
  done: "เสร็จแล้ว",
  skipped: "ข้าม",
};

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function formatDateTimeTh(isoString) {
  if (!isoString) return "-";
  try {
    return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(isoString));
  } catch {
    return String(isoString);
  }
}

export async function api(url, options) {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error("Local AI Workflow runtime is unavailable.");
  }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export function postJson(url, body, method = "POST") {
  return api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}
