import { useMemo, useState } from "react";
import {
  Clock, Search, FileText, PenLine, ShieldCheck, Wrench, UserCheck, Send, Flag,
  Plus, Trash2, ChevronDown, ChevronRight, Users,
} from "lucide-react";
import { NODE_LABELS, NODE_STATUS_TH, PLATFORM_META, STATUS_META, formatDateTimeTh, formatDuration, scoreClass } from "./lib.js";
import { NodeDetailDrawer } from "./drawers.jsx";

const NODE_ICONS = {
  schedule: Clock,
  research: Search,
  brief: FileText,
  create: PenLine,
  check: ShieldCheck,
  autofix: Wrench,
  gate: UserCheck,
  publish: Send,
  result: Flag,
};

function NodeCard({ node, onClick }) {
  const Icon = NODE_ICONS[node.key] || Clock;
  return (
    <button className={`sa-node ${node.status}`} onClick={onClick}>
      <div className="sa-node-icon"><Icon size={17} /></div>
      <div className="sa-node-body">
        <div className="sa-node-title">
          <b>{NODE_LABELS[node.key] || node.key}</b>
          <span className={`sa-node-badge ${node.status}`}>{NODE_STATUS_TH[node.status] || node.status}</span>
        </div>
        <p className="sa-node-output">{node.output || node.error || "—"}</p>
        <span className="sa-node-duration">{node.durationMs ? formatDuration(node.durationMs) : ""}</span>
      </div>
    </button>
  );
}

function Connector({ active }) {
  return <div className={`sa-flow ${active ? "active" : ""}`}><span /></div>;
}

function RunHistoryRow({ run, isOnCanvas, onShow, onOpenEntry }) {
  const [open, setOpen] = useState(false);
  const statusMeta = STATUS_META[run.status === "success" ? "published" : run.status === "needs_review" ? "needs_review" : run.status === "running" ? "in_workflow" : run.status === "failed" ? "failed" : run.status] || { label: run.status, cls: "" };
  return (
    <div className={`sa-run-row ${open ? "open" : ""}`}>
      <button className="sa-run-row-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className={`sa-pill ${statusMeta.cls}`}>{run.status === "success" ? "สำเร็จ" : statusMeta.label}</span>
        <span className="sa-run-trigger">{run.trigger === "schedule" ? "ตามตาราง" : run.trigger === "approve" ? "อนุมัติ" : "กดรัน"}</span>
        <span className="sa-run-when">{formatDateTimeTh(run.startedAt)}</span>
        {run.check?.score != null && <span className={`sa-score sm ${scoreClass(run.check.score)}`}>{run.check.score}</span>}
        <span className="sa-muted">{formatDuration(run.durationMs)}</span>
        {!isOnCanvas && (
          <span
            className="sa-link"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onShow(run.id);
            }}
            onKeyDown={() => onShow(run.id)}
          >
            แสดงบน canvas
          </span>
        )}
        <span
          className="sa-link"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onOpenEntry(run.entryId);
          }}
          onKeyDown={() => onOpenEntry(run.entryId)}
        >
          เปิดโพสต์
        </span>
      </button>
      {open && (
        <div className="sa-run-nodes">
          {run.nodes.map((n) => (
            <div key={n.key} className={`sa-run-node ${n.status}`}>
              <span className="sa-node-mini-dot" />
              <b>{NODE_LABELS[n.key]}</b>
              <span className="sa-muted">{NODE_STATUS_TH[n.status] || n.status}{n.durationMs ? ` · ${formatDuration(n.durationMs)}` : ""}</span>
              <span className="sa-run-node-output">{n.output || n.error || ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkflowTab({ state, activeClient, selectedEntryId, onSelectEntry, onOpenEntry, onSaveRoles }) {
  const [nodeDetail, setNodeDetail] = useState(null);
  const [canvasRunId, setCanvasRunId] = useState(null);
  const [roleForm, setRoleForm] = useState(null);
  const [roleError, setRoleError] = useState("");

  const entries = useMemo(
    () => [...(activeClient?.calendar || [])].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)),
    [activeClient]
  );
  const entry = entries.find((e) => e.id === selectedEntryId) || entries[0] || null;
  const entryRuns = useMemo(
    () => (activeClient?.workflowRuns || []).filter((r) => r.entryId === entry?.id),
    [activeClient, entry]
  );
  const run = entryRuns.find((r) => r.id === canvasRunId) || entryRuns[0] || null;
  const running = run?.status === "running";

  const startAddRole = () => setRoleForm({ name: "", questions: "" });
  const submitRole = async () => {
    setRoleError("");
    try {
      const questions = roleForm.questions.split("\n").map((q) => q.trim()).filter(Boolean);
      if (!roleForm.name.trim() || !questions.length) throw new Error("กรอกชื่อนักวิจัยและคำถามอย่างน้อย 1 ข้อ");
      await onSaveRoles([...(activeClient.researcherRoles || []), { name: roleForm.name.trim(), questions }]);
      setRoleForm(null);
    } catch (err) {
      setRoleError(err.message);
    }
  };

  return (
    <div className="sa-workflow">
      <div className="sa-wf-topbar">
        <label className="sa-wf-entry-picker">
          <span>โพสต์ที่กำลังดู</span>
          <select value={entry?.id || ""} onChange={(e) => onSelectEntry(e.target.value)}>
            {entries.length === 0 && <option value="">— ยังไม่มีรายการในปฏิทิน —</option>}
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.date} {e.time} · {e.productName} · {PLATFORM_META[e.platform]?.label}
              </option>
            ))}
          </select>
        </label>
        {entry && (
          <div className="sa-wf-entry-badges">
            <span className={`sa-pill ${STATUS_META[entry.status]?.cls}`}>{STATUS_META[entry.status]?.label}</span>
            {run?.check?.score != null && <span className={`sa-score ${scoreClass(run.check.score)}`}>AI Check {run.check.score}</span>}
            {running && <span className="sa-pill publishing">กำลังรัน…</span>}
          </div>
        )}
      </div>

      <div className="sa-canvas-wrap">
        <div className="sa-canvas">
          {run ? (
            run.nodes.map((node, i) => (
              <div className="sa-canvas-item" key={node.key}>
                {i > 0 && <Connector active={running || node.status === "running"} />}
                <NodeCard node={node} onClick={() => setNodeDetail(node)} />
              </div>
            ))
          ) : (
            <div className="sa-canvas-empty">
              <p>{entries.length ? "โพสต์นี้ยังไม่เคยรัน — กด \"รันเลยตอนนี้\" จากปฏิทินหรือ drawer ของโพสต์" : "ยังไม่มีรายการในปฏิทินของลูกค้านี้ — ไปแท็บปฏิทินเพื่อวางแผนอัตโนมัติ"}</p>
            </div>
          )}
        </div>
      </div>

      <div className="sa-wf-lower">
        <section className="sa-panel">
          <header className="sa-panel-head">
            <h4>ประวัติการรันของโพสต์นี้</h4>
            <span className="sa-muted">{entryRuns.length} ครั้ง</span>
          </header>
          {entryRuns.length ? (
            entryRuns.map((r) => (
              <RunHistoryRow key={r.id} run={r} isOnCanvas={r.id === run?.id} onShow={setCanvasRunId} onOpenEntry={onOpenEntry} />
            ))
          ) : (
            <p className="sa-muted">ยังไม่มีประวัติ — เมื่อรันแล้วผลแต่ละโหนดจะขึ้นที่นี่</p>
          )}
        </section>

        <section className="sa-panel">
          <header className="sa-panel-head">
            <h4><Users size={15} /> นักวิจัย AI ของ {activeClient.name}</h4>
            <button className="sa-btn ghost sm" onClick={startAddRole}><Plus size={13} /> เพิ่มนักวิจัย</button>
          </header>
          <div className="sa-roles">
            {(activeClient.researcherRoles || []).map((role) => (
              <div key={role.id} className="sa-role">
                <div className="sa-role-head">
                  <b>{role.name}</b>
                  {role.builtIn ? <span className="sa-pill planned">built-in</span> : (
                    <button
                      className="sa-icon-btn danger sm"
                      aria-label="ลบนักวิจัย"
                      onClick={() => onSaveRoles((activeClient.researcherRoles || []).filter((r) => r.id !== role.id))}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <ul>
                  {role.questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            ))}
          </div>
          {roleForm && (
            <div className="sa-role-form">
              <input placeholder="ชื่อนักวิจัย เช่น นักวิจัยคู่แข่ง" value={roleForm.name} onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
              <textarea
                placeholder="คำถาม (บรรทัดละ 1 ข้อ) เช่น&#10;คู่แข่งในหมวดนี้พูดอะไรบ้าง&#10;เราต่างจากเขาตรงไหน"
                rows={3}
                value={roleForm.questions}
                onChange={(e) => setRoleForm((f) => ({ ...f, questions: e.target.value }))}
              />
              {roleError && <p className="sa-form-error">{roleError}</p>}
              <div className="sa-role-form-actions">
                <button className="sa-btn ghost sm" onClick={() => setRoleForm(null)}>ยกเลิก</button>
                <button className="sa-btn primary sm" onClick={submitRole}>เพิ่มนักวิจัย</button>
              </div>
            </div>
          )}
          <p className="sa-form-hint">โน้ตวิจัยจะป้อนเข้าโหนด Brief ก่อนเขียนคอนเทนต์ — เก็บแยกต่อลูกค้า (ร้านเบเกอรี่กับสตูดิโอโยคะได้มุมวิจัยต่างกัน)</p>
        </section>
      </div>

      {nodeDetail && <NodeDetailDrawer node={nodeDetail} onClose={() => setNodeDetail(null)} />}
    </div>
  );
}
