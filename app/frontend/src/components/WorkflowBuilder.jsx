import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Square, Plus, Trash2, Copy, ChevronUp, ChevronDown, History, Save,
  AlertTriangle, Workflow as WorkflowIcon, Variable, CheckCircle2, XCircle, MinusCircle, Loader2, Download,
} from "lucide-react";
import "../workflow-builder.css";
import {
  STEP_TYPES, newStep, runWorkflowSteps, RUN_STATUS_TH, formatDuration, formatDateTimeTh,
  api, postJson,
} from "../workflow-builder/lib.js";

const SAMPLERS = ["euler_a", "euler", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2m_sde", "lcm"];

// ── small pieces ────────────────────────────────────────────────────────────

function NodeStatusIcon({ status }) {
  if (status === "running") return <Loader2 size={13} className="awb-spin" />;
  if (status === "done") return <CheckCircle2 size={13} />;
  if (status === "failed") return <XCircle size={13} />;
  if (status === "halted") return <MinusCircle size={13} />;
  return null;
}

function ArtifactView({ artifact }) {
  if (!artifact) return null;
  if (artifact.kind === "image" && artifact.dataUrl) {
    return (
      <a className="awb-artifact" href={artifact.dataUrl} download="luke-workflow-image.png" target="_blank" rel="noreferrer">
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

function Inspector({ step, steps, onChange }) {
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
    case "output":
      return <p className="awb-req-hint">โหนดปลายทาง — แสดงผลลัพธ์ล่าสุดของเวิร์กโฟลว์ ไม่มีค่าที่ต้องตั้ง</p>;
    default:
      return null;
  }
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
  const [addMenuAt, setAddMenuAt] = useState(null);
  const [runNodes, setRunNodes] = useState({});
  const [runStatus, setRunStatus] = useState(null); // null | { status, startedAt, durationMs }
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        artifact: n.artifact ? { kind: n.artifact.kind, url: n.artifact.url, file: n.artifact.file, seed: n.artifact.seed } : null,
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
            <span className="awb-muted">คลิกเพื่อเพิ่มท้ายสาย</span>
          </header>
          {Object.entries(STEP_TYPES).map(([type, meta]) => {
            const Icon = meta.icon;
            return (
              <button key={type} className="awb-palette-item" onClick={() => addStepAt(type, steps.length)} disabled={running}>
                <Icon size={15} />
                <span><b>{meta.label}</b><small>{meta.desc}</small></span>
              </button>
            );
          })}
          <footer className="awb-palette-foot">
            <span className="awb-muted">เชื่อมต่อกับ Chat / Create Image / TTS / Speech ที่รันอยู่ในเครื่อง</span>
          </footer>
        </aside>

        <div className="awb-canvas">
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
          </nav>
          {rightTab === "inspector" && (
            <div className="awb-inspector">
              {selectedStep ? (
                <>
                  <Field label="ชื่อโหนด (ใช้อ้างเป็นตัวแปรได้)">
                    <input value={selectedStep.name} onChange={(e) => updateStep({ ...selectedStep, name: e.target.value })} disabled={running} />
                  </Field>
                  <Inspector step={selectedStep} steps={steps} onChange={updateStep} />
                </>
              ) : (
                <p className="awb-muted awb-inspector-empty">คลิกโหนดบน canvas เพื่อแก้การตั้งค่า — ใช้ตัวแปร {"{{input}}"} หมายถึงผลของโหนดก่อนหน้า และ {"{{ชื่อโหนด}}"} ดึงผลของโหนดที่ระบุ</p>
              )}
            </div>
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
