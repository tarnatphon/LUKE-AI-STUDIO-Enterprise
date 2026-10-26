import { useMemo, useState } from "react";
import {
  Clock, Search, FileText, PenLine, ShieldCheck, Wrench, UserCheck, Send, Flag, TrendingUp,
  Plus, Trash2, ChevronDown, ChevronRight, Users, Play, Check, X, Download, Filter,
  CalendarDays, ExternalLink, RotateCcw, Layers,
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
  score: TrendingUp,
  gate: UserCheck,
  publish: Send,
  result: Flag,
};

const RUN_FILTERS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "success", label: "สำเร็จ" },
  { id: "needs_review", label: "รออนุมัติ" },
  { id: "failed", label: "ล้มเหลว" },
];

const RUN_STATUS_LABEL = {
  running: "กำลังรัน",
  success: "สำเร็จ",
  needs_review: "รออนุมัติ",
  failed: "ล้มเหลว",
};

const RUN_STATUS_CLS = {
  running: "in-workflow",
  success: "published",
  needs_review: "needs-review",
  failed: "failed",
};

const TRIGGER_LABEL = {
  schedule: "ตามตาราง",
  approve: "อนุมัติ",
  manual: "กดรัน",
};

function NodeCard({ node, index, active, onClick }) {
  const Icon = NODE_ICONS[node.key] || Clock;
  const label = NODE_LABELS[node.key] || node.key;
  const status = NODE_STATUS_TH[node.status] || node.status;
  return (
    <button
      type="button"
      className={`sa-node ${node.status}${active ? " active" : ""}`}
      onClick={onClick}
      title={`ขั้น ${index} · ${label} · ${status}${node.output || node.error ? `\n${node.output || node.error}` : ""}`}
    >
      <span className="sa-node-step">{index}</span>
      <span className="sa-node-icon"><Icon size={17} /></span>
      <span className="sa-node-body">
        <span className="sa-node-title">
          <b>{label}</b>
          <span className={`sa-node-badge ${node.status}`}>{status}</span>
        </span>
        <span className="sa-node-output">{node.output || node.error || "—"}</span>
        <span className="sa-node-duration">{node.durationMs ? formatDuration(node.durationMs) : ""}</span>
      </span>
    </button>
  );
}

function RunHistoryRow({ run, isOnCanvas, onShow, onOpenEntry }) {
  const [open, setOpen] = useState(false);
  const statusLabel = RUN_STATUS_LABEL[run.status] || run.status;
  return (
    <div className={`sa-run-row ${open ? "open" : ""}`}>
      <div className="sa-run-row-head">
        <button
          type="button"
          className="sa-run-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? "ย่อ" : "ขยาย"}รายละเอียดการรัน ${formatDateTimeTh(run.startedAt)}`}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className={`sa-pill ${RUN_STATUS_CLS[run.status] || ""}`}>{statusLabel}</span>
          <span className="sa-run-trigger">{TRIGGER_LABEL[run.trigger] || "กดรัน"}</span>
          <span className="sa-run-when">{formatDateTimeTh(run.startedAt)}</span>
          {run.check?.score != null && <span className={`sa-score sm ${scoreClass(run.check.score)}`}>{run.check.score}</span>}
          <span className="sa-muted">{formatDuration(run.durationMs)}</span>
        </button>
        <span className="sa-run-actions">
          {!isOnCanvas && (
            <button
              type="button"
              className="sa-run-action"
              onClick={() => onShow(run.id)}
              title="แสดงการรันครั้งนี้บนผังด้านบน"
            >
              <Layers size={12} /> ผัง
            </button>
          )}
          <button
            type="button"
            className="sa-run-action"
            onClick={() => onOpenEntry(run.entryId)}
            title="เปิดรายละเอียดโพสต์ของรันนี้"
          >
            <ExternalLink size={12} /> โพสต์
          </button>
        </span>
      </div>
      {open && (
        <div className="sa-run-nodes">
          {run.nodes.map((n) => (
            <div key={n.key} className={`sa-run-node ${n.status}`}>
              <span className="sa-node-mini-dot" />
              <b>{NODE_LABELS[n.key] || n.key}</b>
              <span className="sa-muted">{NODE_STATUS_TH[n.status] || n.status}{n.durationMs ? ` · ${formatDuration(n.durationMs)}` : ""}</span>
              <span className="sa-run-node-output">{n.output || n.error || ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function exportRunReport(run, entry, clientName) {
  if (!run) return;
  const report = {
    exportedAt: new Date().toISOString(),
    client: clientName,
    entry: entry
      ? {
          id: entry.id, date: entry.date, time: entry.time, platform: entry.platform,
          productName: entry.productName, status: entry.status, angle: entry.angle, pillar: entry.pillar,
        }
      : null,
    run: {
      id: run.id, label: run.label, trigger: run.trigger, status: run.status,
      startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs,
      check: run.check, gate: run.gate, publish: run.publish,
      nodes: (run.nodes || []).map((n) => ({
        key: n.key, label: NODE_LABELS[n.key] || n.key, status: n.status,
        startedAt: n.startedAt, finishedAt: n.finishedAt, durationMs: n.durationMs,
        output: n.output, detail: n.detail, error: n.error,
      })),
    },
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = (run.startedAt || "").replace(/[:.]/g, "-").slice(0, 16);
  a.download = `luke-workflow-run-${run.id}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function WorkflowTab({
  state, activeClient, selectedEntryId, onSelectEntry, onOpenEntry, onSaveRoles,
  busy = false, onRunNow, onApprove, onReject, onOpenCalendar,
}) {
  const [nodeDetail, setNodeDetail] = useState(null);
  const [canvasRunId, setCanvasRunId] = useState(null);
  const [roleForm, setRoleForm] = useState(null);
  const [roleError, setRoleError] = useState("");
  const [historyFilter, setHistoryFilter] = useState("all");

  const entries = useMemo(
    () => [...(activeClient?.calendar || [])].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)),
    [activeClient]
  );
  const entry = entries.find((e) => e.id === selectedEntryId) || entries[0] || null;
  const entryRuns = useMemo(
    () => (activeClient?.workflowRuns || []).filter((r) => r.entryId === entry?.id),
    [activeClient, entry]
  );
  const latestRun = entryRuns[0] || null;
  const run = entryRuns.find((r) => r.id === canvasRunId) || latestRun;
  const viewingOlderRun = Boolean(run && latestRun && run.id !== latestRun.id);
  const running = run?.status === "running";
  const awaitingReview = run?.status === "needs_review" && entry?.status === "needs_review";
  const canRunNow = Boolean(entry && onRunNow && !busy && !entry.inFlight && !running);
  const nodes = run?.nodes || [];
  const doneNodes = nodes.filter((n) => n.status === "done" || n.status === "waiting").length;
  const totalNodes = nodes.length;
  const progressPct = totalNodes ? Math.round((doneNodes / totalNodes) * 100) : 0;
  const runStatusLabel = RUN_STATUS_LABEL[run?.status] || "";
  const filteredRuns = useMemo(
    () => (historyFilter === "all" ? entryRuns : entryRuns.filter((r) => r.status === historyFilter)),
    [entryRuns, historyFilter]
  );
  const platform = PLATFORM_META[entry?.platform] || null;
  const entryStatus = STATUS_META[entry?.status] || null;

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
      <header className="sa-wf-header">
        <div className="sa-wf-topbar">
          <label className="sa-wf-entry-picker">
            <span>โพสต์ที่กำลังดู</span>
            <select value={entry?.id || ""} onChange={(e) => onSelectEntry(e.target.value)}>
              {entries.length === 0 && <option value="">— ยังไม่มีรายการในปฏิทิน —</option>}
              {entries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.date} {e.time} · {e.productName || e.angle || "โพสต์"} · {PLATFORM_META[e.platform]?.label || e.platform}
                </option>
              ))}
            </select>
          </label>

          {entry && (
            <div className="sa-wf-entry-facts">
              <span className="sa-wf-entry-when"><CalendarDays size={13} /> {entry.date} · {entry.time}</span>
              {platform && <span className={`sa-platform-chip ${platform.cls}`}>{platform.label}</span>}
              {entryStatus && <span className={`sa-pill ${entryStatus.cls}`}>{entryStatus.label}</span>}
              <span className="sa-wf-entry-product" title={entry.productName || entry.angle || ""}>
                {entry.productName || entry.angle || "—"}
              </span>
              {run?.check?.score != null && <span className={`sa-score ${scoreClass(run.check.score)}`} title="คะแนน AI Check">AI {run.check.score}</span>}
              {(run?.entry?.viralScore?.score ?? entry.viralScore?.score) != null && (
                <span className={`sa-score ${scoreClass(run?.entry?.viralScore?.score ?? entry.viralScore?.score)}`} title="คะแนนไวรัล">
                  ไวรัล {run?.entry?.viralScore?.score ?? entry.viralScore?.score}
                </span>
              )}
            </div>
          )}

          <div className="sa-wf-topbar-actions">
            {entry && (
              <button className="sa-btn ghost sm" onClick={() => onOpenEntry(entry.id)} title="เปิดรายละเอียดและพรีวิวโพสต์นี้">
                <ExternalLink size={13} /> เปิดโพสต์
              </button>
            )}
            {canRunNow && (
              <button className="sa-btn primary sm" onClick={() => onRunNow(entry.id)}>
                <Play size={13} /> รันเลยตอนนี้
              </button>
            )}
            {running && <span className="sa-pill publishing">กำลังรัน…</span>}
            {awaitingReview && (
              <>
                <button className="sa-btn primary sm" disabled={busy} onClick={() => onApprove(entry.id)}>
                  <Check size={13} /> อนุมัติ & เผยแพร่
                </button>
                <button className="sa-btn ghost sm danger" disabled={busy} onClick={() => onReject(entry.id)}>
                  <X size={13} /> ยกเลิก
                </button>
              </>
            )}
            {run && (
              <button className="sa-btn ghost sm" title="ดาวน์โหลดรายงานการรัน (JSON)" onClick={() => exportRunReport(run, entry, activeClient?.name)}>
                <Download size={13} /> รายงาน
              </button>
            )}
          </div>
        </div>

        {run && (
          <>
            <div className="sa-wf-progress-row">
              <span className="sa-wf-progress-label">ความคืบหน้า</span>
              <span
                className="sa-wf-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalNodes || 0}
                aria-valuenow={doneNodes}
                aria-label="ความคืบหน้าของ workflow"
              >
                <span className="sa-wf-progress-fill" style={{ width: `${progressPct}%` }} />
              </span>
              <span className="sa-muted">{doneNodes}/{totalNodes} ขั้น</span>
              {runStatusLabel && <span className="sa-wf-progress-state">{runStatusLabel}</span>}
              <span className="sa-wf-run-meta">
                เริ่ม {formatDateTimeTh(run.startedAt)}
                {run.durationMs ? ` · ใช้เวลา ${formatDuration(run.durationMs)}` : ""}
              </span>
              {viewingOlderRun && latestRun && (
                <button className="sa-btn ghost sm" onClick={() => setCanvasRunId(null)} title="กลับไปดูการรันล่าสุดของโพสต์นี้">
                  <RotateCcw size={12} /> ดูรันล่าสุด
                </button>
              )}
            </div>
            <ol className="sa-wf-stepper" aria-label="ลำดับขั้นตอนของ workflow">
              {nodes.map((node, i) => {
                const Icon = NODE_ICONS[node.key] || Clock;
                return (
                  <li key={node.key}>
                    <button
                      type="button"
                      className={`sa-step ${node.status}${nodeDetail?.key === node.key ? " active" : ""}`}
                      onClick={() => setNodeDetail(node)}
                      aria-current={node.status === "running" ? "step" : undefined}
                      title={`ขั้น ${i + 1} · ${NODE_LABELS[node.key] || node.key} · ${NODE_STATUS_TH[node.status] || node.status}`}
                    >
                      <span className="sa-step-num">{i + 1}</span>
                      <Icon size={12} />
                      <span className="sa-step-label">{NODE_LABELS[node.key] || node.key}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {awaitingReview && run?.gate && (
          <div className="sa-wf-gate-note">
            <UserCheck size={15} />
            <span>
              รอการอนุมัติจากคน — {run.gate.reason || "คะแนนยังไม่ถึงเกณฑ์"} · กด “อนุมัติ & เผยแพร่” เพื่อบังคับผ่านประตู หรือ “ยกเลิก” เพื่อส่งกลับไปแก้
            </span>
          </div>
        )}
      </header>

      <div className="sa-canvas-wrap">
        {run ? (
          <div className="sa-canvas" role="list" aria-label={`ผังขั้นตอนทั้งหมด ${totalNodes} ขั้น`}>
            {nodes.map((node, i) => (
              <span className="sa-canvas-item" role="listitem" key={node.key}>
                <NodeCard node={node} index={i + 1} active={nodeDetail?.key === node.key} onClick={() => setNodeDetail(node)} />
              </span>
            ))}
          </div>
        ) : (
          <div className="sa-canvas-empty">
            {entries.length ? (
              <>
                <p>โพสต์นี้ยังไม่เคยรัน — กด “รันเลยตอนนี้” เพื่อให้ AI ทำครบทุกขั้น แล้วผลของแต่ละขั้นจะขึ้นที่นี่</p>
                {canRunNow && (
                  <button className="sa-btn primary sm" onClick={() => onRunNow(entry.id)}>
                    <Play size={13} /> รันเลยตอนนี้
                  </button>
                )}
              </>
            ) : (
              <>
                <p>ลูกค้ารายนี้ยังไม่มีโพสต์ในปฏิทิน — วางแผนโพสต์ก่อน แล้วค่อยกลับมาดูขั้นตอนการทำงาน</p>
                {onOpenCalendar && (
                  <button className="sa-btn primary sm" onClick={onOpenCalendar}>
                    <CalendarDays size={13} /> ไปวางแผนที่ปฏิทิน
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="sa-wf-lower">
        <section className="sa-panel">
          <header className="sa-panel-head">
            <h4>ประวัติการรันของโพสต์นี้</h4>
            <div className="sa-panel-head-right">
              <span className="sa-muted">{filteredRuns.length}/{entryRuns.length} ครั้ง</span>
              <span className="sa-wf-filter">
                <Filter size={12} />
                {RUN_FILTERS.map((f) => (
                  <button key={f.id} className={`sa-wf-filter-chip ${historyFilter === f.id ? "active" : ""}`} onClick={() => setHistoryFilter(f.id)}>
                    {f.label}
                  </button>
                ))}
              </span>
            </div>
          </header>
          {entryRuns.length ? (
            filteredRuns.length ? (
              filteredRuns.map((r) => (
                <RunHistoryRow key={r.id} run={r} isOnCanvas={r.id === run?.id} onShow={setCanvasRunId} onOpenEntry={onOpenEntry} />
              ))
            ) : (
              <p className="sa-muted">
                ไม่มีรันที่ตรงตัวกรอง “{RUN_FILTERS.find((f) => f.id === historyFilter)?.label}”
                <button className="sa-btn ghost sm" onClick={() => setHistoryFilter("all")}>ดูทั้งหมด</button>
              </p>
            )
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
                  <span className="sa-role-meta">{(role.questions || []).length} คำถาม</span>
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
                  {(role.questions || []).map((q, i) => <li key={i}>{q}</li>)}
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
