import { useMemo, useState } from "react";
import { Check, Ban, Inbox, Activity, ChevronRight } from "lucide-react";
import {
  PLATFORM_META, STATUS_META, formatDateTimeTh, formatDuration, scoreClass, currentMonth,
} from "./lib.js";

const RUN_STATUS_TH = {
  success: { label: "สำเร็จ", cls: "published" },
  running: { label: "กำลังรัน", cls: "in-workflow" },
  needs_review: { label: "รออนุมัติ", cls: "needs-review" },
  failed: { label: "ล้มเหลว", cls: "failed" },
};

export default function RunsTab({ state, activeClient, busy, onApprove, onReject, onOpenEntry, onOpenInWorkflow }) {
  const [showAllClients, setShowAllClients] = useState(true);
  const month = currentMonth();

  const queue = useMemo(
    () => (activeClient?.calendar || []).filter((e) => e.status === "needs_review").sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
    [activeClient]
  );
  const runsWithCaption = useMemo(() => {
    const map = new Map();
    for (const c of state?.clients || []) {
      for (const r of c.workflowRuns || []) map.set(r.id, { run: r, clientName: c.name });
    }
    return map;
  }, [state]);
  const runLog = useMemo(() => {
    const log = state?.runLog || [];
    return showAllClients ? log : log.filter((r) => r.clientId === activeClient?.id);
  }, [state, showAllClients, activeClient]);

  return (
    <div className="sa-runs">
      <section className="sa-panel">
        <header className="sa-panel-head">
          <h4><Inbox size={15} /> คิวอนุมัติ — {activeClient?.name}</h4>
          <span className="sa-muted">{queue.length} รายการรอคนตัดสิน</span>
        </header>
        <p className="sa-form-hint">คอนเทนต์ที่ AI Check ให้ไม่ผ่าน (ต่ำกว่าเกณฑ์ / ล้มเหลวหลังแก้ 2 รอบ / อ่านผลไม่ได้) จะมาอยู่ที่นี่ — กดอนุมัติเพื่อเผยแพร่ หรือปฏิเสธเพื่อยกเลิก</p>
        {queue.length === 0 && <p className="sa-muted">ไม่มีรายการรออนุมัติ — ทุกโพสต์ผ่านเกณฑ์และเผยแพร่อัตโนมัติ 🎉</p>}
        {queue.map((entry) => {
          const run = (activeClient.workflowRuns || []).find((r) => r.id === entry.workflowRunId);
          const check = run?.check;
          return (
            <article key={entry.id} className="sa-approval-card">
              <header>
                <div>
                  <b>{entry.productName}</b>
                  <span className="sa-muted"> · {entry.date} {entry.time} · {PLATFORM_META[entry.platform]?.label} · {entry.angle}</span>
                </div>
                {check && (
                  <span className={`sa-score ${scoreClass(check.score)}`}>
                    {check.score ?? "-"} / {activeClient.settings?.threshold ?? 80}
                  </span>
                )}
              </header>
              <pre className="sa-caption">{entry.caption || "(ยังไม่มีคอนเทนต์)"}</pre>
              {check?.issues?.length > 0 && (
                <ul className="sa-issues">
                  {check.issues.slice(0, 5).map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              )}
              <footer>
                <button className="sa-btn ghost sm" onClick={() => onOpenEntry(entry.id)}>ดูเวิร์กโฟลว์เต็ม</button>
                <div style={{ flex: 1 }} />
                <button className="sa-btn danger ghost sm" disabled={busy} onClick={() => onReject(entry.id)}><Ban size={13} /> ปฏิเสธ</button>
                <button className="sa-btn success sm" disabled={busy} onClick={() => onApprove(entry.id)}><Check size={13} /> อนุมัติและเผยแพร่</button>
              </footer>
            </article>
          );
        })}
      </section>

      <section className="sa-panel">
        <header className="sa-panel-head">
          <h4><Activity size={15} /> บันทึกการรัน (200 ครั้งล่าสุดทุกลูกค้า)</h4>
          <label className="sa-check">
            <input type="checkbox" checked={!showAllClients} onChange={(e) => setShowAllClients(!e.target.checked)} />
            <span>เฉพาะ{activeClient?.name || "ลูกค้านี้"}</span>
          </label>
        </header>
        {runLog.length === 0 && <p className="sa-muted">ยังไม่มีการรัน — เริ่มจากกด “รันเลยตอนนี้” ที่ปฏิทิน หรือรอตารางเดินเอง</p>}
        <div className="sa-runlog">
          {runLog.map((r) => {
            const meta = RUN_STATUS_TH[r.status] || { label: r.status, cls: "" };
            const detail = runsWithCaption.get(r.runId);
            return (
              <button key={r.runId} className="sa-runlog-row" onClick={() => detail && onOpenInWorkflow(r.clientId, r.entryId)}>
                <ChevronRight size={13} className="sa-muted" />
                <span className={`sa-pill ${meta.cls}`}>{meta.label}</span>
                <b className="sa-runlog-label">{r.label}</b>
                <span className="sa-muted">{r.clientName}{r.late ? " · ช้ากว่ากำหนด" : ""}</span>
                <span className="sa-runlog-when">{formatDateTimeTh(r.startedAt)}</span>
                <span className="sa-muted">{formatDuration(r.durationMs)}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
