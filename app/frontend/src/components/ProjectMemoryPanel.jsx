import React, { useEffect, useState } from "react";
import { Bookmark, Check, Database, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";

const MEMORY_TYPES = ["fact", "decision", "task", "rule", "file"];
const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch (_) { return fallback; }
};

export function getProjectMemory(projectId) {
  return projectId ? readJson(`luke_project_memory:${projectId}`, []) : [];
}

export function createWorkCheckpoint(projectId, messages, label = "Automatic checkpoint") {
  if (!projectId || !Array.isArray(messages) || messages.length === 0) return [];
  const key = `luke_work_checkpoints:${projectId}`;
  const current = readJson(key, []);
  const checkpoint = { id: `checkpoint_${Date.now()}`, label, createdAt: new Date().toISOString(), messages };
  const next = [checkpoint, ...current].slice(0, 20);
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}

export default function ProjectMemoryPanel({ project, messages, onRestore, onClose }) {
  const memoryKey = `luke_project_memory:${project?.id || "none"}`;
  const checkpointKey = `luke_work_checkpoints:${project?.id || "none"}`;
  const [items, setItems] = useState(() => getProjectMemory(project?.id));
  const [checkpoints, setCheckpoints] = useState(() => readJson(checkpointKey, []));
  const [draft, setDraft] = useState("");
  const [type, setType] = useState("fact");

  useEffect(() => {
    setItems(getProjectMemory(project?.id));
    setCheckpoints(readJson(checkpointKey, []));
  }, [project?.id, checkpointKey]);

  const persistItems = (next) => { setItems(next); localStorage.setItem(memoryKey, JSON.stringify(next)); };
  const persistCheckpoints = (next) => { setCheckpoints(next); localStorage.setItem(checkpointKey, JSON.stringify(next)); };
  const addItem = () => {
    const text = draft.trim();
    if (!text) return;
    persistItems([{ id: `memory_${Date.now()}`, type, text, pinned: false, updatedAt: new Date().toISOString() }, ...items]);
    setDraft("");
  };
  const addCheckpoint = () => setCheckpoints(createWorkCheckpoint(project?.id, messages, "Manual conversation checkpoint"));

  const button = { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 7, background: "transparent", color: "inherit", cursor: "pointer" };
  return (
    <aside aria-label="Project Memory and checkpoints" style={{ width: 360, maxWidth: "42vw", borderLeft: "1px solid var(--border-color)", background: "var(--md-sys-color-surface-container)", padding: 14, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><strong style={{ display: "flex", gap: 7, alignItems: "center" }}><Database size={17} /> Project Memory</strong><button type="button" style={button} onClick={onClose} aria-label="Close Project Memory"><X size={15} /></button></div>
      {!project ? <p style={{ color: "var(--md-sys-color-outline)" }}>Select a Work project to store memory.</p> : <>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 6, marginBottom: 12 }}>
          <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Memory type">{MEMORY_TYPES.map((value) => <option value={value} key={value}>{value}</option>)}</select>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addItem()} placeholder="Add project memory…" aria-label="New project memory" />
          <button type="button" style={button} onClick={addItem} disabled={!draft.trim()} aria-label="Add project memory"><Plus size={15} /></button>
        </div>
        <div style={{ display: "grid", gap: 7 }}>
          {items.length === 0 && <small style={{ color: "var(--md-sys-color-outline)" }}>No saved memory yet.</small>}
          {[...items].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((item) => <div key={item.id} style={{ padding: 9, border: "1px solid var(--border-color)", borderRadius: 9, background: "var(--md-sys-color-surface)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><small style={{ textTransform: "uppercase", color: "var(--md-sys-color-primary)" }}>{item.type}</small><div style={{ display: "flex", gap: 2 }}>
              <button type="button" style={button} onClick={() => persistItems(items.map((entry) => entry.id === item.id ? { ...entry, pinned: !entry.pinned } : entry))} aria-label={`${item.pinned ? "Unpin" : "Pin"} memory`}><Bookmark size={13} fill={item.pinned ? "currentColor" : "none"} /></button>
              <button type="button" style={button} onClick={() => { const text = window.prompt("Edit project memory:", item.text); if (text?.trim()) persistItems(items.map((entry) => entry.id === item.id ? { ...entry, text: text.trim(), updatedAt: new Date().toISOString() } : entry)); }} aria-label="Edit project memory"><Pencil size={13} /></button>
              <button type="button" style={button} onClick={() => persistItems(items.filter((entry) => entry.id !== item.id))} aria-label="Delete project memory"><Trash2 size={13} /></button>
            </div></div><div style={{ marginTop: 5, overflowWrap: "anywhere" }}>{item.text}</div>
          </div>)}
        </div>
        <hr style={{ border: 0, borderTop: "1px solid var(--border-color)", margin: "18px 0 12px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><strong>Conversation checkpoints</strong><button type="button" style={button} onClick={addCheckpoint} disabled={!messages.length}><Plus size={14} /> Save</button></div>
        <div style={{ display: "grid", gap: 7 }}>{checkpoints.length === 0 && <small style={{ color: "var(--md-sys-color-outline)" }}>No checkpoints yet.</small>}{checkpoints.map((checkpoint) => <div key={checkpoint.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, alignItems: "center", padding: 8, border: "1px solid var(--border-color)", borderRadius: 8 }}><span><b style={{ display: "block", fontSize: ".78rem" }}>{checkpoint.label}</b><small>{new Date(checkpoint.createdAt).toLocaleString()} · {checkpoint.messages.length} messages</small></span><button type="button" style={button} onClick={() => onRestore(checkpoint)} aria-label="Restore checkpoint"><RotateCcw size={14} /></button><button type="button" style={button} onClick={() => persistCheckpoints(checkpoints.filter((entry) => entry.id !== checkpoint.id))} aria-label="Delete checkpoint"><Trash2 size={14} /></button></div>)}</div>
        <p style={{ marginTop: 12, color: "var(--md-sys-color-outline)", fontSize: ".72rem" }}><Check size={12} /> Checkpoints restore conversation state only. Project files are never changed.</p>
      </>}
    </aside>
  );
}
