import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Square, Plus, Trash2, Copy, ChevronUp, ChevronDown, History, Save,
  AlertTriangle, Workflow as WorkflowIcon, Variable, CheckCircle2, XCircle, MinusCircle, Loader2, Download,
  Megaphone, Webhook, ExternalLink, ClipboardCheck, KeyRound, ShieldCheck, Globe2, Search, Filter,
} from "lucide-react";
import "../workflow-builder.css";
import {
  STEP_TYPES, STEP_GROUPS, newStep, runWorkflowSteps, RUN_STATUS_TH, formatDuration, formatDateTimeTh,
  api, postJson, publishDraft, resolveTemplate,
} from "../workflow-builder/lib.js";
import {
  CHANNELS, CHANNEL_GROUPS, channelById, composeChannelPost, CHANNEL_AUTOMATION_LABEL,
  CHANNEL_LINK_TYPE_LABEL, CHANNELS_REVIEWED_AT,
} from "../workflow-builder/channels.js";
import { safeExternalUrl } from "../lib/safe-link.mjs";
import BuildStamp from "./BuildStamp";

const SAMPLERS = ["euler_a", "euler", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2m_sde", "lcm"];

// ── small pieces ────────────────────────────────────────────────────────────

function NodeStatusIcon({ status }) {
  if (status === "running") return <Loader2 size={13} className="awb-spin" />;
  if (status === "done") return <CheckCircle2 size={13} />;
  if (status === "failed") return <XCircle size={13} />;
  if (status === "halted") return <MinusCircle size={13} />;
  return null;
}

function CopyButton({ text, label = "คัดลอกข้อความ" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`awb-btn ghost sm ${done ? "ok" : ""}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(String(text || ""));
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
      title="คัดลอกข้อความโพสต์ไว้ไปวางในหน้าเขียน"
    >
      {done ? <CheckCircle2 size={12} /> : <ClipboardCheck size={12} />} {done ? "คัดลอกแล้ว" : label}
    </button>
  );
}

function PostArtifact({ artifact }) {
  const [showText, setShowText] = useState(false);
  return (
    <div className={`awb-post ${artifact.published ? "published" : ""}`}>
      <div className="awb-post-head">
        <b>{artifact.channelName || artifact.channel}</b>
        {Number.isFinite(artifact.da) && <span className="awb-post-da">DA {artifact.da}</span>}
        <span className="awb-post-state">{artifact.published ? "โพสต์แล้ว" : "พร้อมโพสต์"}</span>
      </div>
      <div className="awb-post-actions">
        {safeExternalUrl(artifact.url) && (
          <a className="awb-btn primary sm" href={safeExternalUrl(artifact.url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            <ExternalLink size={12} /> {artifact.published ? "เปิดโพสต์" : "เปิดหน้าเขียน"}
          </a>
        )}
        <CopyButton text={artifact.text} />
        <button className="awb-btn ghost sm" onClick={(e) => { e.stopPropagation(); setShowText((open) => !open); }}>
          {showText ? "ซ่อนข้อความ" : "ดูข้อความ"}
        </button>
      </div>
      {showText && <pre className="awb-post-text">{artifact.text}</pre>}
      {(artifact.warnings || []).length > 0 && (
        <ul className="awb-post-warnings">
          {artifact.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </div>
  );
}

function ArtifactView({ artifact }) {
  if (!artifact) return null;
  if (artifact.kind === "post") return <PostArtifact artifact={artifact} />;
  if (artifact.kind === "image" && artifact.dataUrl) {
    // The image is also the link you click to open or save it, so the value
    // meets the same guard as every other link in the interface. A value the
    // guard refuses renders as a picture with no link around it — a link with
    // an empty href would navigate the app to its own home page instead.
    const href = safeExternalUrl(artifact.dataUrl);
    if (!href) {
      return (
        <div className="awb-artifact">
          <img src={artifact.dataUrl} alt="ผลลัพธ์ภาพ" />
          <span className="awb-artifact-caption">seed {artifact.seed ?? "-"}</span>
        </div>
      );
    }
    return (
      <a className="awb-artifact" href={href} download="luke-workflow-image.png" target="_blank" rel="noreferrer">
        <img src={artifact.dataUrl} alt="ผลลัพธ์ภาพ" />
        <span className="awb-artifact-caption">seed {artifact.seed ?? "-"} · คลิกเพื่อเปิด/บันทึก</span>
      </a>
    );
  }
  if (artifact.kind === "audio" && artifact.url) {
    return (
      <div className="awb-artifact">
        <audio controls src={artifact.url} />
        {artifact.file ? <span className="awb-artifact-caption">{artifact.file}</span> : null}
      </div>
    );
  }
  return null;
}

function AddStepMenu({ onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div className="awb-add-menu" ref={ref}>
      {Object.entries(STEP_TYPES).map(([type, meta]) => {
        const Icon = meta.icon;
        return (
          <button key={type} className="awb-add-item" onClick={() => onPick(type)}>
            <Icon size={15} />
            <span>
              <b>{meta.label}</b>
              <small>{meta.desc}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Connector({ onAdd }) {
  return (
    <div className="awb-connector">
      <span className="awb-connector-line" />
      <button className="awb-connector-add" aria-label="เพิ่มโหนด" onClick={onAdd}><Plus size={12} /></button>
      <span className="awb-connector-line" />
    </div>
  );
}

function StepCard({ step, index, total, selected, runNode, onSelect, onMove, onDuplicate, onDelete, onInsertAfter }) {
  const meta = STEP_TYPES[step.type] || {};
  const Icon = meta.icon || WorkflowIcon;
  const status = runNode?.status || "idle";
  return (
    <div className={`awb-node-wrap ${selected ? "selected" : ""}`}>
      <div className={`awb-node awb-node-${step.type} status-${status}`} onClick={onSelect} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}>
        <div className="awb-node-head">
          <span className="awb-node-icon"><Icon size={16} /></span>
          <div className="awb-node-title">
            <b>{step.name}</b>
            <small>{meta.label}</small>
          </div>
          <div className="awb-node-tools">
            <button disabled={index === 0 || status === "running"} aria-label="ขึ้น" onClick={(e) => { e.stopPropagation(); onMove(-1); }}><ChevronUp size={13} /></button>
            <button disabled={index === total - 1 || status === "running"} aria-label="ลง" onClick={(e) => { e.stopPropagation(); onMove(1); }}><ChevronDown size={13} /></button>
            <button disabled={status === "running"} aria-label="สำเนา" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}><Copy size={13} /></button>
            <button className="danger" disabled={status === "running"} aria-label="ลบ" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={13} /></button>
          </div>
          {status !== "idle" && (
            <span className={`awb-node-status ${status}`}>
              <NodeStatusIcon status={status} />
              {RUN_STATUS_TH[status] || status}
              {runNode?.durationMs ? ` · ${formatDuration(runNode.durationMs)}` : ""}
            </span>
          )}
        </div>
        <p className="awb-node-summary">{summaryOf(step)}</p>
        {runNode?.error && <p className="awb-node-error"><AlertTriangle size={12} /> {runNode.error}</p>}
        {runNode?.output && status !== "failed" && <p className={`awb-node-output ${runNode.expanded ? "expanded" : ""}`}
          onClick={(e) => { e.stopPropagation(); runNode.onToggleExpand?.(); }}>{runNode.output}</p>}
        <ArtifactView artifact={runNode?.artifact} />
      </div>
      <button className="awb-add-after" aria-label="แทรกโหนดถัดจากนี้" onClick={onInsertAfter}><Plus size={12} /> แทรกโหนด</button>
    </div>
  );
}

function summaryOf(step) {
  const cfg = step.config || {};
  switch (step.type) {
    case "input": return cfg.text ? clip(cfg.text, 90) : "— ยังไม่ได้กรอกข้อความ —";
    case "chat": return `prompt: ${clip(cfg.prompt, 70)}`;
    case "image": return `${cfg.width || 1024}×${cfg.height || 1024} · ${cfg.steps || 20} steps · ${clip(cfg.prompt, 50)}`;
    case "tts": return `เสียง ${cfg.voice || "default"} · ${clip(cfg.text, 60)}`;
    case "stt": return cfg.fromStep ? `จากโหนด: ${cfg.fromStep}` : "ใช้เสียงล่าสุดอัตโนมัติ";
    case "transform": return clip(cfg.template, 80);
    case "condition": return conditionLabel(cfg);
    case "output": return "แสดงผลลัพธ์สุดท้ายของเวิร์กโฟลว์";
    default: return "";
  }
}

function conditionLabel(cfg) {
  switch (cfg.mode) {
    case "contains": return `ข้อความต้องมี "${clip(cfg.value, 30)}"`;
    case "not_contains": return `ข้อความต้องไม่มี "${clip(cfg.value, 30)}"`;
    case "regex": return `ตรงกับ /${clip(cfg.value, 30)}/`;
    case "min_length": return `ยาวอย่างน้อย ${cfg.value} ตัวอักษร`;
    case "max_length": return `ยาวไม่เกิน ${cfg.value} ตัวอักษร`;
    default: return "";
  }
}

function clip(s, n) {
  const t = String(s ?? "").replace(/\n+/g, " ");
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// ── inspector ───────────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <label className="awb-field">
      <span className="awb-field-label">{label}</span>
      {children}
      {hint && <small className="awb-field-hint">{hint}</small>}
    </label>
  );
}

function VariableChips({ names, onInsert }) {
  if (!names.length) return null;
  return (
    <div className="awb-vars">
      <Variable size={12} />
      <span>แทรกตัวแปร:</span>
      {names.map((n) => (
        <button key={n} className="awb-var-chip" onClick={() => onInsert(`{{${n}}}`)}>{`{{${n}}}`}</button>
      ))}
    </div>
  );
}

// The inspector cannot run the workflow, so it resolves what it can and shows
// the same text the run would produce (placeholders left as-is, not blank).
function renderDraftText(step, steps) {
  const draft = publishDraft(step.config || {}, { input: "", byName: {} });
  try {
    const channel = channelById(step.config?.channel);
    return channel ? composeChannelPost(channel.id, draft).text : draft.body;
  } catch {
    return draft.body;
  }
}

function Inspector({ step, steps, onChange, channelCredentials = {}, onSetCredential, onPreviewChannel, sending = null, onSendNow }) {
  const cfg = step.config || {};
  const set = (key, value) => onChange({ ...step, config: { ...cfg, [key]: value } });
  const priorNames = useMemo(() => {
    const idx = steps.findIndex((s) => s.id === step.id);
    return ["input", ...steps.slice(0, idx).map((s) => s.name)];
  }, [steps, step.id]);
  const textAreaRef = useRef(null);
  const insertInto = (field, value) => {
    const el = textAreaRef.current;
    const current = String(cfg[field] ?? "");
    if (el && document.activeElement === el && el.selectionStart != null) {
      const before = current.slice(0, el.selectionStart);
      const after = current.slice(el.selectionEnd);
      set(field, `${before}${value}${after}`);
    } else {
      set(field, `${current}${value}`);
    }
  };
  const tracked = (field, props) => ({
    ...props,
    ref: textAreaRef,
    value: cfg[field] ?? "",
    onChange: (e) => set(field, e.target.value),
  });

  switch (step.type) {
    case "input":
      return (
        <>
          <Field label="ข้อความตั้งต้น" hint="ใช้ตัวแปรได้ เช่น {{input}} (ถ้าอยู่หลังโหนดอื่น)">
            <textarea rows={7} {...tracked("text")} placeholder="หัวข้อ โจทย์ หรือข้อมูลดิบของเวิร์กโฟลว์…" />
          </Field>
        </>
      );
    case "chat":
      return (
        <>
          <Field label="System prompt (บทบาท AI)">
            <textarea rows={3} {...tracked("system")} placeholder="เช่น คุณคือนักเขียนคอนเทนต์…" />
          </Field>
          <Field label="Prompt" hint="ตัวแปร: {{input}} = ผลของโหนดก่อนหน้า">
            <textarea rows={6} {...tracked("prompt")} placeholder="เขียนแคปชันจากข้อมูลนี้:\n{{input}}" />
          </Field>
          <VariableChips names={priorNames.filter((n) => n !== step.name)} onInsert={(v) => insertInto("prompt", v)} />
          <div className="awb-field-row">
            <Field label={`Temperature: ${cfg.temperature ?? 0.7}`}>
              <input type="range" min="0" max="2" step="0.1" value={cfg.temperature ?? 0.7} onChange={(e) => set("temperature", Number(e.target.value))} />
            </Field>
            <Field label="Max tokens">
              <input type="number" min="32" max="8192" value={cfg.maxTokens ?? 1024} onChange={(e) => set("maxTokens", Number(e.target.value))} />
            </Field>
          </div>
          <p className="awb-req-hint">ต้องเปิดโมเดลแชทไว้ในหน้า Chat ก่อนรันโหนดนี้</p>
        </>
      );
    case "image":
      return (
        <>
          <Field label="Prompt ภาพ">
            <textarea rows={5} {...tracked("prompt")} placeholder="product photography of {{input}}, soft light…" />
          </Field>
          <VariableChips names={priorNames.filter((n) => n !== step.name)} onInsert={(v) => insertInto("prompt", v)} />
          <Field label="Negative prompt">
            <textarea rows={2} {...tracked("negativePrompt")} placeholder="blurry, low quality, watermark" />
          </Field>
          <div className="awb-field-row">
            <Field label="กว้าง"><input type="number" min="256" max="2048" step="64" value={cfg.width ?? 1024} onChange={(e) => set("width", Number(e.target.value))} /></Field>
            <Field label="สูง"><input type="number" min="256" max="2048" step="64" value={cfg.height ?? 1024} onChange={(e) => set("height", Number(e.target.value))} /></Field>
          </div>
          <div className="awb-field-row">
            <Field label="Steps"><input type="number" min="1" max="60" value={cfg.steps ?? 20} onChange={(e) => set("steps", Number(e.target.value))} /></Field>
            <Field label="CFG"><input type="number" min="1" max="20" step="0.5" value={cfg.cfgScale ?? 7} onChange={(e) => set("cfgScale", Number(e.target.value))} /></Field>
          </div>
          <Field label="Sampler">
            <select value={cfg.sampler || "euler_a"} onChange={(e) => set("sampler", e.target.value)}>
              {SAMPLERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <p className="awb-req-hint">ต้องโหลดโมเดลภาพไว้ในหน้า Create Image ก่อนรันโหนดนี้</p>
        </>
      );
    case "tts":
      return (
        <>
          <Field label="ข้อความที่จะอ่าน">
            <textarea rows={6} {...tracked("text")} placeholder="{{input}}" />
          </Field>
          <VariableChips names={priorNames.filter((n) => n !== step.name)} onInsert={(v) => insertInto("text", v)} />
          <div className="awb-field-row">
            <Field label="เสียง (voice)" hint="เว้นว่าง = เสียง default">
              <input value={cfg.voice ?? ""} onChange={(e) => set("voice", e.target.value)} placeholder="เช่น af_heart" />
            </Field>
            <Field label="ความเร็ว"><input type="number" min="0.5" max="2" step="0.1" value={cfg.speed ?? 1} onChange={(e) => set("speed", Number(e.target.value))} /></Field>
          </div>
          <p className="awb-req-hint">ใช้เอนจิน Kokoro TTS ในเครื่อง (หน้า Text to Speech)</p>
        </>
      );
    case "stt": {
      const audioSteps = steps.slice(0, steps.findIndex((s) => s.id === step.id)).filter((s) => s.type === "tts");
      return (
        <>
          <Field label="เสียงที่จะถอดข้อความ" hint="เลือกโหนด TTS ก่อนหน้า หรือใช้เสียงล่าสุดอัตโนมัติ">
            <select value={cfg.fromStep ?? ""} onChange={(e) => set("fromStep", e.target.value)}>
              <option value="">— เสียงล่าสุดอัตโนมัติ —</option>
              {audioSteps.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="ภาษา (ไม่ระบุ = auto)" hint="เช่น th, en">
            <input value={cfg.language ?? ""} onChange={(e) => set("language", e.target.value)} />
          </Field>
          <p className="awb-req-hint">ใช้ Whisper ในเครื่อง — ต้องมีโหนด TTS ก่อนหน้าในเวิร์กโฟลว์</p>
        </>
      );
    }
    case "transform":
      return (
        <>
          <Field label="แม่แบบผลลัพธ์" hint="สร้างข้อความใหม่จากตัวแปร เช่น “แคปชัน: {{เขียนแคปชัน}}”">
            <textarea rows={6} {...tracked("template")} placeholder="{{input}}" />
          </Field>
          <VariableChips names={priorNames.filter((n) => n !== step.name)} onInsert={(v) => insertInto("template", v)} />
          <div className="awb-field-row">
            <Field label="ค้นหา (ข้อความ/regex)"><input value={cfg.find ?? ""} onChange={(e) => set("find", e.target.value)} /></Field>
            <Field label="แทนที่ด้วย"><input value={cfg.replace ?? ""} onChange={(e) => set("replace", e.target.value)} /></Field>
          </div>
          <Field label="ตัดความยาวสูงสุด (0 = ไม่ตัด)">
            <input type="number" min="0" max="20000" value={cfg.truncate ?? 0} onChange={(e) => set("truncate", Number(e.target.value))} />
          </Field>
        </>
      );
    case "condition":
      return (
        <>
          <Field label="โหมดเงื่อนไข">
            <select value={cfg.mode || "contains"} onChange={(e) => set("mode", e.target.value)}>
              <option value="contains">ข้อความต้องมี…</option>
              <option value="not_contains">ข้อความต้องไม่มี…</option>
              <option value="regex">ตรงกับ regex…</option>
              <option value="min_length">ความยาวอย่างน้อย…</option>
              <option value="max_length">ความยาวไม่เกิน…</option>
            </select>
          </Field>
          <Field label="ค่าที่ใช้เช็ค" hint="เช็คกับผลลัพธ์ของโหนดก่อนหน้า ({{input}})">
            <input value={cfg.value ?? ""} onChange={(e) => set("value", e.target.value)} />
          </Field>
          <p className="awb-req-hint">ถ้าไม่ผ่าน เวิร์กโฟลว์จะหยุด และโหนดหลังจากนี้ถูกข้าม</p>
        </>
      );
    case "publish":
    case "onepost": {
      const isAuto = step.type === "publish";
      const available = isAuto ? CHANNELS.filter((channel) => channel.automation === "api") : CHANNELS;
      const channel = channelById(cfg.channel) || available[0];
      const fields = channel?.credentialFields || [];
      const status = channelCredentials[channel?.id] || {};
      const missing = fields.filter((field) => field.type !== "toggle" && !status[field.key]);
      return (
        <>
          <Field label="ช่องทางที่โพสต์" hint={channel?.why || ""}>
            <select value={channel?.id || ""} onChange={(e) => set("channel", e.target.value)}>
              {CHANNEL_GROUPS.map((group) => {
                const list = available.filter((entry) => entry.group === group.id);
                if (!list.length) return null;
                return (
                  <optgroup key={group.id} label={group.label}>
                    {list.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} · DA {entry.da} · {CHANNEL_AUTOMATION_LABEL[entry.automation]}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>
          {channel && (
            <div className="awb-channel-facts">
              <span className={`awb-badge ${channel.automation}`}>{CHANNEL_AUTOMATION_LABEL[channel.automation]}</span>
              <span className="awb-badge">DA {channel.da} · PA {channel.pa}</span>
              <span className="awb-badge">{CHANNEL_LINK_TYPE_LABEL[channel.linkType]}</span>
              {channel.supportsCanonical && <span className="awb-badge ok">ใส่ canonical ได้</span>}
              <span className="awb-badge">≤ {channel.rate.perDay}/วัน · ห่าง ≥ {channel.rate.minIntervalSeconds}s</span>
              {channel.localAllowed && <span className="awb-badge">เซิร์ฟเวอร์ของเราเอง</span>}
              <a className="awb-link" href={safeExternalUrl(channel.signupUrl) || undefined} target="_blank" rel="noreferrer">{channel.signup}</a>
            </div>
          )}
          <Field label="หัวข้อโพสต์" hint="ใช้ตัวแปรได้ — เว้นว่าง = ใช้บรรทัดแรกของเนื้อหา">
            <input value={cfg.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="{{ชื่อโหนด}}" />
          </Field>
          <Field label="เนื้อหาโพสต์" hint={channel?.limits?.body ? `ลิมิตของช่องนี้ ~${channel.limits.body} ตัวอักษร` : ""}>
            <textarea rows={5} {...tracked("body")} placeholder="{{input}}" />
          </Field>
          <VariableChips names={priorNames.filter((n) => n !== step.name)} onInsert={(v) => insertInto("body", v)} />
          <div className="awb-field-row">
            <Field label="canonical URL" hint="ลิงก์ต้นฉบับบนเว็บเรา (กันอันดับชนกัน)">
              <input value={cfg.canonicalUrl ?? ""} onChange={(e) => set("canonicalUrl", e.target.value)} placeholder="https://www.your-site.com/blog/post" />
            </Field>
            <Field label="รูปประกอบ (URL)">
              <input value={cfg.imageUrl ?? ""} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…/cover.jpg" />
            </Field>
          </div>
          <Field label="แท็ก/แฮชแท็ก (คั่นด้วยจุลภาค)">
            <input
              value={(cfg.tags || []).join(", ")}
              onChange={(e) => set("tags", e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))}
              placeholder="thai, handmade, oem"
            />
          </Field>

          {isAuto ? (
            <div className="awb-credential-box">
              <header><KeyRound size={13} /> คีย์ของ {channel?.name}</header>
              {fields.length === 0 && <p className="awb-req-hint">ช่องนี้ไม่ต้องใช้คีย์ — รันแล้วโพสต์ได้เลย</p>}
              {fields.map((field) => (field.type === "toggle" ? (
                <label key={field.key} className="awb-credential-row toggle">
                  <span>{field.label}{status[field.key] ? <em className="awb-set">• เปิดอยู่</em> : null}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(status[field.key])}
                    onChange={(e) => onSetCredential?.(channel.id, { [field.key]: e.target.checked ? "1" : "" })}
                  />
                  {field.hint ? <em className="awb-field-hint">{field.hint}</em> : null}
                </label>
              ) : (
                <label key={field.key} className="awb-credential-row">
                  <span>{field.label}{status[field.key] ? <em className="awb-set">• ตั้งไว้แล้ว</em> : null}</span>
                  <input
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={field.hint || "วางค่าแล้วกดบันทึก"}
                    onBlur={async (e) => {
                      const input = e.target;
                      const value = input.value.trim();
                      if (!value) return;
                      const ok = await onSetCredential?.(channel.id, { [field.key]: value });
                      if (ok !== false) input.value = "";
                    }}
                  />
                </label>
              )))}
              <div className="awb-post-actions">
                <button
                  className="awb-btn ghost sm"
                  disabled={Boolean(sending)}
                  onClick={() => onSendNow?.(step, { dryRun: true })}
                  title="ตรวจคำขอที่จะส่ง โดยไม่โพสต์จริง"
                >
                  <ShieldCheck size={12} /> ทดสอบ (dry-run)
                </button>
                <button
                  className="awb-btn primary sm"
                  disabled={Boolean(sending) || missing.length > 0}
                  onClick={() => onSendNow?.(step, { dryRun: false })}
                  title={missing.length ? `ยังขาด: ${missing.map((field) => field.label).join(", ")}` : "โพสต์จริงทันที"}
                >
                  {sending ? <Loader2 size={12} className="awb-spin" /> : <Megaphone size={12} />} โพสต์เลยตอนนี้
                </button>
              </div>
              <p className="awb-field-hint">คีย์เก็บไว้ในเครื่องนี้ที่ app/runtime-state/ai-workflow/publish-credentials.json (ไม่ขึ้น git และไม่ส่งออกในรายงาน)</p>
            </div>
          ) : (
            <div className="awb-credential-box">
              <header><Globe2 size={13} /> โพสต์แบบคลิกเดียว</header>
              <p className="awb-req-hint">
                ตอนรัน ระบบจะประกอบข้อความ + เปิดหน้าเขียน/หน้าแชร์ที่กรอกให้แล้ว — กด Publish บนเว็บนั้นอีกครั้งเดียว
              </p>
              <div className="awb-post-actions">
                <button className="awb-btn primary sm" onClick={() => onPreviewChannel?.(step)}>
                  <ExternalLink size={12} /> เปิดหน้าโพสต์เลย
                </button>
                <CopyButton text={renderDraftText(step, steps)} />
              </div>
            </div>
          )}
        </>
      );
    }
    case "output":
      return <p className="awb-req-hint">โหนดปลายทาง — แสดงผลลัพธ์ล่าสุดของเวิร์กโฟลว์ ไม่มีค่าที่ต้องตั้ง</p>;
    default:
      return null;
  }
}

// ── channel library (free, high-authority sites) ────────────────────────────

const CHANNEL_FILTERS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "api", label: "โพสต์อัตโนมัติได้" },
  { id: "manual", label: "คลิกเดียว" },
  { id: "easy", label: "สมัครง่าย" },
  // One tab per registry group, added here so a new group (forum/self-hosted)
  // shows up without touching this file again.
  ...CHANNEL_GROUPS.map((group) => ({ id: `group:${group.id}`, label: group.label })),
];

function ChannelCard({ channel, credentials, rates = {}, onSetCredential, onAddStep }) {
  const [openKeys, setOpenKeys] = useState(false);
  const fields = channel.credentialFields || [];
  const status = credentials[channel.id] || {};
  const rate = rates[channel.id] || null;
  // A toggle is a setting, not a missing credential — it must not block "ready".
  const required = fields.filter((field) => field.type !== "toggle");
  const ready = channel.automation === "api" && required.every((field) => status[field.key]);
  return (
    <article className={`awb-channel-card ${channel.automation}`}>
      <header>
        <b>{channel.name}</b>
        <span className="awb-channel-da">DA {channel.da} <em>PA {channel.pa}</em></span>
      </header>
      <p className="awb-channel-why">{channel.why}</p>
      <div className="awb-channel-facts">
        <span className={`awb-badge ${channel.automation}`}>{CHANNEL_AUTOMATION_LABEL[channel.automation]}</span>
        <span className="awb-badge">{CHANNEL_LINK_TYPE_LABEL[channel.linkType]}</span>
        <span className="awb-badge">{channel.signup}</span>
        <span className="awb-badge" title="ขีดจำกัดที่ระบบเราบังคับก่อนแพลตฟอร์มจะบังคับ">
          ≤ {channel.rate.perDay}/วัน · ห่าง ≥ {channel.rate.minIntervalSeconds}s
        </span>
        {rate && (
          <span className={`awb-badge ${rate.blocked ? "warn" : "ok"}`}>
            {rate.blocked
              ? `รออีก ${rate.intervalLeftSeconds > 0 ? `${rate.intervalLeftSeconds}s` : "ถึงพรุ่งนี้"}`
              : `เหลืออีก ${rate.remainingToday} โพสต์วันนี้`}
          </span>
        )}
        {channel.automation === "api" && (
          <span className={`awb-badge ${ready ? "ok" : "warn"}`}>{ready ? "พร้อมโพสต์อัตโนมัติ" : "ยังไม่ได้ใส่คีย์"}</span>
        )}
      </div>
      <ol className="awb-channel-steps">
        {channel.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      {channel.rules.length > 0 && (
        <ul className="awb-channel-rules">
          {channel.rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      )}
      <footer>
        <a className="awb-btn ghost sm" href={safeExternalUrl(channel.signupUrl) || undefined} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> สมัครฟรี
        </a>
        {channel.automation === "api" ? (
          <button className="awb-btn ghost sm" onClick={() => onAddStep("publish", channel.id)}>
            <Webhook size={12} /> เพิ่มโหนดโพสต์อัตโนมัติ
          </button>
        ) : null}
        <button className="awb-btn ghost sm" onClick={() => onAddStep("onepost", channel.id)}>
          <Megaphone size={12} /> เพิ่มโหนดคลิกเดียว
        </button>
        {fields.length > 0 && (
          <button className="awb-btn ghost sm" onClick={() => setOpenKeys((open) => !open)}>
            <KeyRound size={12} /> {openKeys ? "ซ่อนคีย์" : ready ? "แก้คีย์" : "ใส่คีย์"}
          </button>
        )}
      </footer>
      {openKeys && fields.length > 0 && (
        <div className="awb-credential-box">
          {fields.map((field) => (field.type === "toggle" ? (
            <label key={field.key} className="awb-credential-row toggle">
              <span>{field.label}{status[field.key] ? <em className="awb-set">• เปิดอยู่</em> : null}</span>
              <input
                type="checkbox"
                checked={Boolean(status[field.key])}
                onChange={(e) => onSetCredential(channel.id, { [field.key]: e.target.checked ? "1" : "" })}
              />
              {field.hint ? <em className="awb-field-hint">{field.hint}</em> : null}
            </label>
          ) : (
            <label key={field.key} className="awb-credential-row">
              <span>{field.label}{status[field.key] ? <em className="awb-set">• ตั้งไว้แล้ว</em> : null}</span>
              <input
                // A key is typed blind; a URL/handle/user id is meant to be read
                // back by eye, so it is a plain text field.
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                placeholder={field.hint || "วางค่าแล้วกด Enter"}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const value = e.target.value.trim();
                  if (!value) return;
                  onSetCredential(channel.id, { [field.key]: value });
                  e.target.value = "";
                }}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (!value) return;
                  onSetCredential(channel.id, { [field.key]: value });
                  e.target.value = "";
                }}
              />
            </label>
          )))}
          <p className="awb-field-hint">เก็บในเครื่องนี้เท่านั้น (app/runtime-state/ai-workflow/publish-credentials.json)</p>
        </div>
      )}
    </article>
  );
}

function ChannelsPanel({ credentials, rates = {}, onSetCredential, onAddStep, error }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CHANNELS.filter((channel) => {
      if (filter === "api" && channel.automation !== "api") return false;
      if (filter === "manual" && channel.automation === "api") return false;
      if (filter === "easy" && !/ไม่ต้องสมัคร|1 คลิก|ใช้บัญชี|ฟรี/.test(channel.signup)) return false;
      if (filter.startsWith("group:") && channel.group !== filter.slice(6)) return false;
      if (!needle) return true;
      return [channel.name, channel.domain, channel.signup, channel.why]
        .join(" ").toLowerCase().includes(needle);
    }).sort((a, b) => b.da - a.da);
  }, [query, filter]);
  return (
    <div className="awb-channels">
      <p className="awb-channels-intro">
        ช่องทางฟรีที่ใช้ได้จริง — เรียงตาม Domain Authority (ตัวเลขเป็นค่าประมาณจากเครื่องมือ SEO ไม่ใช่ปัจจัยจัดอันดับของ Google)
        ตัวเลข DA/PA สูงไม่ได้แปลว่าลิงก์จะส่งพลัง เพราะหลายช่องเป็น <b>nofollow</b> · สิ่งที่ได้จริงคือหน้าเนื้อหาที่ค้นเจอ
        คนอ่านจริง และ canonical ที่ชี้กลับเว็บเรา · ตรวจสถานะ API ล่าสุด {CHANNELS_REVIEWED_AT}
      </p>
      <div className="awb-channels-tools">
        <span className="awb-search">
          <Search size={12} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาช่องทาง…" aria-label="ค้นหาช่องทางโพสต์" />
        </span>
        <span className="awb-wf-filter">
          <Filter size={12} />
          {CHANNEL_FILTERS.map((entry) => (
            <button key={entry.id} className={`awb-filter-chip ${filter === entry.id ? "active" : ""}`} onClick={() => setFilter(entry.id)}>
              {entry.label}
            </button>
          ))}
        </span>
      </div>
      {error && <p className="awb-error-banner">{error}</p>}
      <div className="awb-channel-list">
        {list.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            credentials={credentials}
            rates={rates}
            onSetCredential={onSetCredential}
            onAddStep={onAddStep}
          />
        ))}
      </div>
    </div>
  );
}

// ── run history row ─────────────────────────────────────────────────────────

function RunRow({ run, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`awb-run-row ${open ? "open" : ""}`}>
      <button className="awb-run-head" onClick={() => setOpen((o) => !o)}>
        <span className={`awb-pill ${run.status}`}>{RUN_STATUS_TH[run.status] || run.status}</span>
        <span className="awb-run-when">{formatDateTimeTh(run.startedAt)}</span>
        <span className="awb-muted">{formatDuration(run.durationMs)}</span>
        <span
          className="awb-link danger"
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
          onKeyDown={() => onDelete(run.id)}
        >
          ลบ
        </span>
      </button>
      {open && (
        <div className="awb-run-nodes">
          {(run.nodes || []).map((n) => (
            <div key={n.id} className={`awb-run-node ${n.status}`}>
              <b>{n.name}</b>
              <span className="awb-muted">{RUN_STATUS_TH[n.status] || n.status}{n.durationMs ? ` · ${formatDuration(n.durationMs)}` : ""}</span>
              {n.error ? <span className="awb-node-error-text">{n.error}</span> : <span className="awb-run-node-output">{clip(n.output, 140)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── main component ──────────────────────────────────────────────────────────

export default function WorkflowBuilder() {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeWfId, setActiveWfId] = useState(null);
  const [steps, setSteps] = useState([]);
  const [wfName, setWfName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [rightTab, setRightTab] = useState("inspector");
  const [paletteGroup, setPaletteGroup] = useState(STEP_GROUPS[0].id);
  const [addMenuAt, setAddMenuAt] = useState(null);
  const [runNodes, setRunNodes] = useState({});
  const [runStatus, setRunStatus] = useState(null); // null | { status, startedAt, durationMs }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [channelCredentials, setChannelCredentials] = useState({});
  // How much of each channel's allowance is left, as the server counts it.
  const [publishRates, setPublishRates] = useState({});
  const [channelError, setChannelError] = useState("");
  const [sendingStep, setSendingStep] = useState(null);
  const [publishResults, setPublishResults] = useState([]);
  const cancelRef = useRef(false);
  const running = runStatus?.status === "running";

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/ai-workflow/state");
      setState(data.state);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // The server is the only place that knows which keys are set; the values
  // themselves never reach this component.
  useEffect(() => {
    if (state?.channelCredentials) setChannelCredentials(state.channelCredentials);
    if (state?.publishRates) setPublishRates(state.publishRates);
  }, [state?.channelCredentials]);

  // pick the first workflow once state arrives
  useEffect(() => {
    if (state && !activeWfId && state.workflows.length) {
      setActiveWfId(state.workflows[0].id);
    }
  }, [state, activeWfId]);

  const activeWf = useMemo(
    () => state?.workflows?.find((w) => w.id === activeWfId) || null,
    [state, activeWfId]
  );

  // load steps when switching workflows (or reset when none is active)
  useEffect(() => {
    if (activeWf) {
      setSteps(activeWf.steps || []);
      setWfName(activeWf.name || "");
      setDirty(false);
      setSelectedStepId(null);
      setRunNodes({});
      setRunStatus(null);
    } else {
      setSteps([]);
      setWfName("");
      setDirty(false);
      setSelectedStepId(null);
      setRunNodes({});
      setRunStatus(null);
    }
  }, [activeWfId]); // eslint-disable-line react-hooks/exhaustive-deps

  // debounced autosave
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!activeWfId || !dirty || running) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const data = await postJson(`/api/ai-workflow/workflows/${encodeURIComponent(activeWfId)}`, { name: wfName, steps }, "PATCH");
        setDirty(false);
        setSavedAt(new Date());
        setState((prev) => prev ? { ...prev, workflows: prev.workflows.map((w) => (w.id === activeWfId ? data.workflow : w)) } : prev);
      } catch (err) {
        setError(`บันทึกไม่สำเร็จ: ${err.message}`);
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [steps, wfName, dirty, activeWfId, running]);

  const flushSave = async () => {
    if (!activeWfId || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    try {
      const data = await postJson(`/api/ai-workflow/workflows/${encodeURIComponent(activeWfId)}`, { name: wfName, steps }, "PATCH");
      setDirty(false);
      setSavedAt(new Date());
      setState((prev) => prev ? { ...prev, workflows: prev.workflows.map((w) => (w.id === activeWfId ? data.workflow : w)) } : prev);
    } catch (err) {
      setError(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── workflow CRUD ──
  const createWorkflow = async () => {
    setBusy(true);
    try {
      const name = prompt("ชื่อเวิร์กโฟลว์ใหม่:", "เวิร์กโฟลว์ใหม่");
      if (name == null) return;
      const data = await postJson("/api/ai-workflow/workflows", { name: name || "เวิร์กโฟลว์ใหม่" });
      await refresh();
      setActiveWfId(data.workflow.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const duplicateWorkflow = async () => {
    if (!activeWfId) return;
    setBusy(true);
    try {
      const data = await postJson(`/api/ai-workflow/workflows/${encodeURIComponent(activeWfId)}/duplicate`, {});
      await refresh();
      setActiveWfId(data.workflow.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!activeWfId) return;
    setBusy(true);
    setConfirmDelete(false);
    try {
      await api(`/api/ai-workflow/workflows/${encodeURIComponent(activeWfId)}`, { method: "DELETE" });
      setActiveWfId(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── step editing ──
  const mutateSteps = (fn) => { setSteps((prev) => fn([...prev])); setDirty(true); };

  const addStepAt = (type, index) => {
    const step = newStep(type);
    mutateSteps((prev) => { prev.splice(index, 0, step); return prev; });
    setSelectedStepId(step.id);
    setRightTab("inspector");
    setAddMenuAt(null);
  };

  const moveStep = (id, delta) => {
    mutateSteps((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      [prev[i], prev[j]] = [prev[j], prev[i]];
      return prev;
    });
  };

  const duplicateStep = (id) => {
    mutateSteps((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      if (i < 0) return prev;
      const copy = { ...prev[i], id: `s-${Math.random().toString(36).slice(2, 10)}`, name: `${prev[i].name} (สำเนา)`, config: { ...(prev[i].config || {}) } };
      prev.splice(i + 1, 0, copy);
      return prev;
    });
  };

  const deleteStep = (id) => {
    mutateSteps((prev) => prev.filter((s) => s.id !== id));
    if (selectedStepId === id) setSelectedStepId(null);
  };

  const updateStep = (patched) => {
    setSteps((prev) => prev.map((s) => (s.id === patched.id ? patched : s)));
    setDirty(true);
  };

  // ── running ──
  const run = async () => {
    if (!activeWfId || running || !steps.length) return;
    setError("");
    await flushSave();
    cancelRef.current = false;
    const startedAt = new Date().toISOString();
    setRunStatus({ status: "running", startedAt });
    setRunNodes(Object.fromEntries(steps.map((s) => [s.id, { id: s.id, status: "idle", output: "", error: "", durationMs: null, artifact: null, expanded: false }])));
    try {
      const result = await runWorkflowSteps(steps, {
        onNodeUpdate: (id, patch) => setRunNodes((prev) => ({ ...prev, [id]: { ...prev[id], ...patch, expanded: prev[id]?.expanded || false } })),
        shouldCancel: () => cancelRef.current,
      });
      setRunStatus({ status: result.status, startedAt, durationMs: result.durationMs });
      // report to backend (strip heavy data URLs — keep small artifact metadata only)
      const reportNodes = result.nodes.map((n) => ({
        ...n,
        artifact: n.artifact ? {
          kind: n.artifact.kind, url: n.artifact.url, file: n.artifact.file, seed: n.artifact.seed,
          channel: n.artifact.channel, channelName: n.artifact.channelName,
        } : null,
      }));
      try {
        await postJson("/api/ai-workflow/runs", { workflowId: activeWfId, status: result.status, nodes: reportNodes, startedAt, finishedAt: new Date().toISOString(), durationMs: result.durationMs });
        refresh();
      } catch (err) {
        console.warn("[ai-workflow] failed to record run:", err.message);
      }
    } catch (err) {
      setRunStatus({ status: "failed", startedAt, durationMs: null });
      setError(`รันเวิร์กโฟลว์ไม่สำเร็จ: ${err.message}`);
    }
  };

  const cancelRun = () => { cancelRef.current = true; };

  const exportReport = () => {
    const report = {
      exportedAt: new Date().toISOString(),
      workflow: { id: activeWfId, name: wfName },
      run: runStatus,
      nodes: steps.map((s) => ({
        id: s.id, name: s.name, type: s.type, config: s.config,
        result: runNodes[s.id] ? { status: runNodes[s.id].status, output: runNodes[s.id].output, error: runNodes[s.id].error, durationMs: runNodes[s.id].durationMs } : null,
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `luke-ai-workflow-${(wfName || "run").replace(/\s+/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteRun = async (id) => {
    try {
      await api(`/api/ai-workflow/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  // Returns true only when the server accepted the value, so the inspector can
  // keep what the user typed (instead of clearing it) after a failed save.
  const setCredential = async (channelId, values) => {
    setChannelError("");
    try {
      await postJson("/api/ai-workflow/publish/credentials", { channelId, values }, "PATCH");
      const status = await api("/api/ai-workflow/publish/credentials");
      setChannelCredentials(status.credentials || {});
      setPublishRates(status.rates || {});
      return true;
    } catch (err) {
      setChannelError(err.message);
      return false;
    }
  };

  // Add a publishing step already pointed at the channel that was clicked in
  // the library — "add a step, then hunt for the channel again" is the kind of
  // friction that makes a builder feel useless.
  const addChannelStep = (type, channelId) => {
    const step = newStep(type);
    step.config = { ...step.config, channel: channelId };
    const channel = channelById(channelId);
    if (channel) step.name = `${type === "publish" ? "โพสต์อัตโนมัติ" : "โพสต์"} ${channel.name}`.slice(0, 60);
    mutateSteps((prev) => { prev.push(step); return prev; });
    setSelectedStepId(step.id);
    setRightTab("inspector");
  };

  // Resolve a step's templates from the latest run (so "post now" sends the real
  // text, not "{{input}}"), falling back to empty strings before the first run.
  const resolveDraftFor = (step) => {
    const idx = steps.findIndex((s) => s.id === step.id);
    const byName = {};
    steps.slice(0, Math.max(0, idx)).forEach((s) => { byName[s.name] = runNodes[s.id]?.output || ""; });
    const previous = idx > 0 ? steps[idx - 1] : null;
    return publishDraft(step.config || {}, { input: previous ? (runNodes[previous.id]?.output || "") : "", byName });
  };

  const previewChannel = (step) => {
    const draft = resolveDraftFor(step);
    const channel = channelById(step.config?.channel);
    if (!channel) return;
    const composed = composeChannelPost(channel.id, draft);
    // The open URL comes from the channel library, but it is still a URL we did
    // not write in this file — parse it like any other external link.
    const href = safeExternalUrl(composed.openUrl);
    if (href) window.open(href, "_blank", "noopener");
  };

  const sendNow = async (step, { dryRun = false } = {}) => {
    setSendingStep(step.id);
    setChannelError("");
    try {
      const draft = resolveDraftFor(step);
      const data = await postJson("/api/ai-workflow/publish/send", { channelId: step.config?.channel, draft, dryRun });
      const result = data.result || {};
      setPublishResults((prev) => [{ ...result, at: new Date().toISOString(), dryRun }, ...prev].slice(0, 10));
      // A real post consumes part of the channel's allowance: refresh the
      // counter so the next click shows the truth instead of a stale badge.
      if (result.ok && !dryRun) api("/api/ai-workflow/publish/credentials")
        .then((status) => setPublishRates(status.rates || {}))
        .catch(() => {});
      setRunNodes((prev) => ({
        ...prev,
        [step.id]: {
          ...(prev[step.id] || { id: step.id, status: "idle", output: "", error: "", durationMs: null }),
          status: result.ok ? "done" : "failed",
          output: result.message || "",
          error: result.ok ? "" : (result.message || "ส่งไม่สำเร็จ"),
          artifact: result.ok ? {
            kind: "post", channel: result.channel, channelName: result.channelName,
            automation: "api", url: result.url || result.openUrl || "",
            text: draft.body, published: !dryRun && Boolean(result.url || result.status), warnings: result.warnings || [],
          } : null,
        },
      }));
    } catch (err) {
      setChannelError(err.message);
    } finally {
      setSendingStep(null);
    }
  };

  const postNodes = useMemo(
    () => steps
      .filter((s) => runNodes[s.id]?.artifact?.kind === "post")
      .map((s) => ({ step: s, artifact: runNodes[s.id].artifact })),
    [steps, runNodes]
  );

  const selectedStep = steps.find((s) => s.id === selectedStepId) || null;
  const wfRuns = useMemo(
    () => (state?.runs || []).filter((r) => r.workflowId === activeWfId),
    [state, activeWfId]
  );
  const doneCount = Object.values(runNodes).filter((n) => n.status === "done").length;

  if (!state) {
    return (
      <section className="awb-shell loading">
        <p>{error || "กำลังโหลด Luke AI Workflow…"} {error ? <button className="awb-btn ghost sm" onClick={refresh}>ลองใหม่</button> : null}</p>
      </section>
    );
  }

  return (
    <section className="awb-shell">
      <header className="awb-header">
        <div className="awb-header-title">
          <WorkflowIcon size={18} />
          <div>
            <h2>Luke AI Workflow</h2>
            <span className="awb-muted">ต่อ AI หลายขั้นเป็นสายงานเดียว — ทำงานในเครื่อง 100%</span>
          </div>
        </div>
        <div className="awb-header-main">
          <select value={activeWfId || ""} onChange={(e) => setActiveWfId(e.target.value)} disabled={running}>
            {state.workflows.length === 0 && <option value="">— ยังไม่มีเวิร์กโฟลว์ —</option>}
            {state.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input
            className="awb-name-input"
            value={wfName}
            onChange={(e) => { setWfName(e.target.value); setDirty(true); }}
            disabled={!activeWfId || running}
            aria-label="ชื่อเวิร์กโฟลว์"
          />
          <span className="awb-save-state" title={savedAt ? `บันทึกล่าสุด ${formatDateTimeTh(savedAt.toISOString())}` : ""}>
            {saving ? <><Save size={12} /> กำลังบันทึก…</> : dirty ? <><Save size={12} /> ยังไม่บันทึก</> : savedAt ? <><Save size={12} /> บันทึกแล้ว</> : null}
          </span>
          <div className="awb-header-actions">
            <button className="awb-btn ghost sm" onClick={createWorkflow} disabled={busy || running}><Plus size={13} /> ใหม่</button>
            <button className="awb-btn ghost sm" onClick={duplicateWorkflow} disabled={busy || running || !activeWfId}><Copy size={13} /> สำเนา</button>
            <button className="awb-btn ghost sm danger" onClick={() => setConfirmDelete(true)} disabled={busy || running || !activeWfId}><Trash2 size={13} /> ลบ</button>
            {running ? (
              <button className="awb-btn danger sm" onClick={cancelRun}><Square size={13} /> หยุด</button>
            ) : (
              <button className="awb-btn primary sm" onClick={run} disabled={!activeWfId || !steps.length || busy}>
                <Play size={13} /> รันเวิร์กโฟลว์
              </button>
            )}
            {runStatus && !running && (
              <button className="awb-btn ghost sm" onClick={exportReport} title="ดาวน์โหลดรายงานการรัน (JSON)"><Download size={13} /> รายงาน</button>
            )}
          </div>
        </div>
        <div className="awb-header-chips">
          {running && <span className="awb-chip run"><Loader2 size={12} className="awb-spin" /> กำลังรัน {doneCount}/{steps.length} โหนด</span>}
          {runStatus && !running && (
            <span className={`awb-chip ${runStatus.status}`}>
              {RUN_STATUS_TH[runStatus.status] || runStatus.status}{runStatus.durationMs ? ` · ${formatDuration(runStatus.durationMs)}` : ""}
            </span>
          )}
          <span className="awb-chip"><b>{state.stats.workflowCount}</b> เวิร์กโฟลว์</span>
          <span className="awb-chip ok"><b>{state.stats.successCount}</b> รันสำเร็จ</span>
          {/* A way in, not just a number: jump straight to the publishing
              nodes and the channel library from here. */}
          <button
            type="button"
            className="awb-chip action"
            onClick={() => { setPaletteGroup("publish"); setRightTab("channels"); }}
            title="เปิดโหนดเผยแพร่และคลังช่องทางฟรี"
          >
            <Megaphone size={12} /> <b>{CHANNELS.length}</b> ช่องทางฟรี
          </button>
          {/* The question behind every "the new feature is not there" report. */}
          <BuildStamp compact />
        </div>
      </header>

      {error && <p className="awb-error-banner" role="alert">{error} <button className="awb-btn ghost sm" onClick={() => setError("")}>ปิด</button></p>}

      {confirmDelete && (
        <div className="awb-confirm">
          <AlertTriangle size={15} />
          <span>ลบเวิร์กโฟลว์ “{wfName}” และประวัติการรันทั้งหมดของมัน?</span>
          <button className="awb-btn danger sm" onClick={deleteWorkflow} disabled={busy}>ลบ</button>
          <button className="awb-btn ghost sm" onClick={() => setConfirmDelete(false)}>ยกเลิก</button>
        </div>
      )}

      <div className="awb-body">
        <aside className="awb-palette">
          <header>
            <b>โหนด AI</b>
            <span className="awb-muted">เลือกกลุ่ม แล้วคลิกโหนดเพื่อเพิ่มท้ายสาย</span>
          </header>
          {/* One group at a time. Stacked, the ten nodes did not fit the column
              and the publishing group fell below the fold unseen. */}
          <div className="awb-palette-tabs" role="tablist" aria-label="กลุ่มโหนด">
            {STEP_GROUPS.map((group) => {
              const count = Object.values(STEP_TYPES).filter((meta) => meta.group === group.id).length;
              const active = paletteGroup === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  id={`awb-tab-${group.id}`}
                  aria-selected={active}
                  aria-controls={`awb-panel-${group.id}`}
                  className={`awb-palette-tab ${active ? "active" : ""}`}
                  onClick={() => setPaletteGroup(group.id)}
                  title={`${group.label} — ${count} โหนด`}
                >
                  <span>{group.short || group.label}</span>
                  <em>{count}</em>
                  {group.isNew && <i className="awb-tab-new">ใหม่</i>}
                </button>
              );
            })}
          </div>
          {(() => {
            const group = STEP_GROUPS.find((entry) => entry.id === paletteGroup) || STEP_GROUPS[0];
            const entries = Object.entries(STEP_TYPES).filter(([, meta]) => meta.group === group.id);
            return (
              <section
                key={group.id}
                id={`awb-panel-${group.id}`}
                role="tabpanel"
                aria-labelledby={`awb-tab-${group.id}`}
                className="awb-palette-group"
              >
                <h4>{group.label}</h4>
                {group.hint && <p className="awb-palette-hint">{group.hint}</p>}
                {entries.map(([type, meta]) => {
                  const Icon = meta.icon;
                  return (
                    <button key={type} className="awb-palette-item" onClick={() => addStepAt(type, steps.length)} disabled={running}>
                      <Icon size={15} />
                      <span><b>{meta.label}</b><small>{meta.desc}</small></span>
                    </button>
                  );
                })}
              </section>
            );
          })()}
          <footer className="awb-palette-foot">
            <span className="awb-muted">เชื่อมต่อกับ Chat / Create Image / TTS / Speech ที่รันอยู่ในเครื่อง — และโพสต์ออกไปช่องฟรีได้จริง</span>
          </footer>
        </aside>

        <div className="awb-canvas">
          {postNodes.length > 0 && (
            <section className="awb-post-strip" aria-label="ช่องทางที่พร้อมโพสต์จากการรันล่าสุด">
              <header>
                <Megaphone size={14} />
                <b>{postNodes.length} ช่องทางจากการรันนี้</b>
                <span className="awb-muted">กดช่องทางเพื่อเปิดหน้าโพสต์ที่กรอกข้อความไว้แล้ว (ช่องที่โพสต์อัตโนมัติแล้วมีลิงก์โพสต์จริง)</span>
              </header>
              <div className="awb-post-strip-list">
                {postNodes.map(({ step, artifact }) => (
                  <span key={step.id} className={`awb-post-chip ${artifact.published ? "published" : ""}`}>
                    <b>{artifact.channelName}</b>
                    {Number.isFinite(artifact.da) && <em>DA {artifact.da}</em>}
                    {safeExternalUrl(artifact.url) && (
                      <a href={safeExternalUrl(artifact.url)} target="_blank" rel="noreferrer" title={artifact.published ? "เปิดโพสต์ที่เผยแพร่แล้ว" : "เปิดหน้าเขียนที่กรอกข้อความไว้"}>
                        <ExternalLink size={12} />
                      </a>
                    )}
                    <CopyButton text={artifact.text} label="" />
                  </span>
                ))}
              </div>
            </section>
          )}
          {steps.length === 0 ? (
            <div className="awb-canvas-empty">
              <WorkflowIcon size={30} />
              <p>ยังไม่มีโหนด — เริ่มจาก “ข้อความตั้งต้น” ทางซ้าย แล้วต่อด้วย AI Chat, สร้างภาพ หรือ TTS</p>
            </div>
          ) : (
            <div className="awb-chain">
              {steps.map((step, i) => (
                <div key={step.id} className="awb-chain-item">
                  {i > 0 && <Connector onAdd={() => setAddMenuAt(i)} />}
                  <StepCard
                    step={step}
                    index={i}
                    total={steps.length}
                    selected={selectedStepId === step.id}
                    runNode={{
                      ...runNodes[step.id],
                      onToggleExpand: () => setRunNodes((prev) => ({ ...prev, [step.id]: { ...prev[step.id], expanded: !prev[step.id]?.expanded } })),
                    }}
                    onSelect={() => { setSelectedStepId(step.id); setRightTab("inspector"); }}
                    onMove={(d) => moveStep(step.id, d)}
                    onDuplicate={() => duplicateStep(step.id)}
                    onDelete={() => deleteStep(step.id)}
                    onInsertAfter={() => setAddMenuAt(i + 1)}
                  />
                  {i === steps.length - 1 && <Connector onAdd={() => setAddMenuAt(steps.length)} />}
                </div>
              ))}
            </div>
          )}
          {addMenuAt != null && (
            <AddStepMenu
              onPick={(type) => addStepAt(type, addMenuAt)}
              onClose={() => setAddMenuAt(null)}
            />
          )}
        </div>

        <aside className="awb-right">
          <nav className="awb-right-tabs">
            <button className={rightTab === "inspector" ? "active" : ""} onClick={() => setRightTab("inspector")}>ตั้งค่าโหนด</button>
            <button className={rightTab === "history" ? "active" : ""} onClick={() => setRightTab("history")}>
              ประวัติการรัน {wfRuns.length ? `(${wfRuns.length})` : ""}
            </button>
            <button className={rightTab === "channels" ? "active" : ""} onClick={() => setRightTab("channels")}>
              ช่องทางฟรี
            </button>
          </nav>
          {rightTab === "inspector" && (
            <div className="awb-inspector">
              {selectedStep ? (
                <>
                  <Field label="ชื่อโหนด (ใช้อ้างเป็นตัวแปรได้)">
                    <input value={selectedStep.name} onChange={(e) => updateStep({ ...selectedStep, name: e.target.value })} disabled={running} />
                  </Field>
                  <Inspector
                    step={selectedStep}
                    steps={steps}
                    onChange={updateStep}
                    channelCredentials={channelCredentials}
                    onSetCredential={setCredential}
                    onPreviewChannel={previewChannel}
                    sending={sendingStep === selectedStep.id}
                    onSendNow={sendNow}
                  />
                </>
              ) : (
                <p className="awb-muted awb-inspector-empty">คลิกโหนดบน canvas เพื่อแก้การตั้งค่า — ใช้ตัวแปร {"{{input}}"} หมายถึงผลของโหนดก่อนหน้า และ {"{{ชื่อโหนด}}"} ดึงผลของโหนดที่ระบุ</p>
              )}
            </div>
          )}
          {rightTab === "channels" && (
            <ChannelsPanel
              credentials={channelCredentials}
              rates={publishRates}
              onSetCredential={setCredential}
              onAddStep={addChannelStep}
              error={channelError}
            />
          )}
          {rightTab === "history" && (
            <div className="awb-history">
              {wfRuns.length ? (
                wfRuns.map((r) => <RunRow key={r.id} run={r} onDelete={deleteRun} />)
              ) : (
                <p className="awb-muted awb-inspector-empty">ยังไม่มีประวัติการรันของเวิร์กโฟลว์นี้</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
