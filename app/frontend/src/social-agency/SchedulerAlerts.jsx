import { useMemo, useState } from "react";
import { AlarmClock, Check, Send, X, ExternalLink } from "lucide-react";
import { PLATFORM_META, pendingApprovals, missedPosts, relativeAgeTh, lateForTh } from "./lib.js";

/**
 * "ถึงเวลาแล้วแต่ยังไม่ขึ้น" — said out loud, with the fix one click away.
 *
 * Two situations look identical in the calendar and used to look identical here
 * (i.e. invisible):
 *
 *   1. The post reached its time, is still waiting for a human (`needs_review`),
 *      and nothing will happen until somebody approves it. The runtime has
 *      always been correct about this — the scheduler only picks up
 *      planned/ready — but silence reads as a bug.
 *   2. The post was already given up on (`missed`, more than 2 hours late). It
 *      can still go out, but only if the operator says so; the honest button is
 *      "ส่งเลยตอนนี้" (move it to now, then run), not "reschedule and hope".
 *
 * Cards are per active client, dismissible for this session only, and never
 * claim a live send when the connector is still on dry-run.
 */
export default function SchedulerAlerts({ client, scheduler, busy, onOpenEntry, onApprove, onSendNow }) {
  const [dismissed, setDismissed] = useState({});
  const nowMs = useMemo(() => Date.now(), [client?.id, scheduler?.lastTickAt]);
  const overdue = useMemo(() => pendingApprovals(client, scheduler, nowMs).filter((i) => !dismissed[i.entry.id]), [client, scheduler, nowMs, dismissed]);
  const missed = useMemo(() => missedPosts(client).filter((entry) => !dismissed[entry.id]).slice(0, 3), [client, dismissed]);
  const dismiss = (id) => setDismissed((prev) => ({ ...prev, [id]: true }));
  if (!overdue.length && !missed.length) return null;

  return (
    <div className="sa-alerts" role="region" aria-label="โพสต์ที่เลยเวลาแล้วยังไม่ขึ้น">
      {overdue.map(({ entry, lateMs, block }) => {
        const platform = PLATFORM_META[entry.platform] || PLATFORM_META.demo;
        return (
          <article key={entry.id} className="sa-alert-card overdue" data-entry-id={entry.id}>
            <header>
              <span className="sa-alert-title">
                <AlarmClock size={14} /> เลยเวลามา {lateForTh(lateMs)} — ยังไม่มีคนอนุมัติ
              </span>
              <button className="sa-icon-btn sm" aria-label="ปิดการแจ้งเตือนนี้" title="ซ่อนการ์ดนี้ (เฉพาะรอบนี้)" onClick={() => dismiss(entry.id)}>
                <X size={12} />
              </button>
            </header>
            <p className="sa-alert-body">
              <b>{entry.productName || entry.sku}</b> · {entry.date} {entry.time} · <span className={`sa-platform-chip ${platform.cls}`}>{platform.short}</span>{" "}
              {block.live
                ? "· อนุมัติแล้วระบบจะส่งขึ้นจริงทันที"
                : "· ตอนนี้เป็น dry-run อนุมัติแล้วจะยังไม่ส่งขึ้นจริง"}
              {entry.approvalReminderAt ? ` · เตือนครั้งแรก ${relativeAgeTh(Date.parse(entry.approvalReminderAt), nowMs)}` : ""}
            </p>
            {block.blocked && (
              <p className="sa-form-hint">
                ⛔ ด่านตรวจภาพ: {block.reason || "ยังไม่ได้ตรวจภาพ"} — อนุมัติตอนนี้ระบบก็ยังไม่ส่ง ต้องเปิดรายการไปตรวจภาพก่อน
              </p>
            )}
            <footer>
              <button className="sa-btn ghost sm" onClick={() => onOpenEntry(entry.id)}>
                <ExternalLink size={13} /> {block.blocked ? "เปิดรูป / ตรวจภาพ" : "เปิดรายการ"}
              </button>
              <div style={{ flex: 1 }} />
              {block.blocked ? (
                <button className="sa-btn success sm" disabled title="ต้องตรวจภาพในหน้ารายการก่อน" onClick={() => {}}>
                  <Check size={13} /> อนุมัติและเผยแพร่เลย
                </button>
              ) : (
                <button className="sa-btn success sm" disabled={busy} onClick={() => onApprove(entry.id)}>
                  <Check size={13} /> อนุมัติและเผยแพร่เลย
                </button>
              )}
            </footer>
          </article>
        );
      })}
      {missed.map((entry) => {
        const platform = PLATFORM_META[entry.platform] || PLATFORM_META.demo;
        return (
          <article key={entry.id} className="sa-alert-card missed" data-entry-id={entry.id}>
            <header>
              <span className="sa-alert-title">
                <AlarmClock size={14} /> พลาดโพสต์ — ระบบไม่ส่งให้แล้ว
              </span>
              <button className="sa-icon-btn sm" aria-label="ปิดการแจ้งเตือนนี้" title="ซ่อนการ์ดนี้ (เฉพาะรอบนี้)" onClick={() => dismiss(entry.id)}>
                <X size={12} />
              </button>
            </header>
            <p className="sa-alert-body">
              <b>{entry.productName || entry.sku}</b> · {entry.date} {entry.time} · <span className={`sa-platform-chip ${platform.cls}`}>{platform.short}</span> · เลยกำหนดเกิน 2 ชั่วโมง
            </p>
            <p className="sa-form-hint">“ส่งเลยตอนนี้” จะเลื่อนรายการนี้มาตอนนี้แล้วรันให้ทันที (เก็บวัน/เวลาเดิมไว้เป็นประวัติ) หรือจะเปิดรายการไปเลื่อนวันเองก็ได้</p>
            <footer>
              <button className="sa-btn ghost sm" onClick={() => onOpenEntry(entry.id)}>
                <ExternalLink size={13} /> เปิดรายการ
              </button>
              <div style={{ flex: 1 }} />
              <button className="sa-btn primary sm" disabled={busy || !onSendNow} onClick={() => onSendNow(entry.id)}>
                <Send size={13} /> ส่งเลยตอนนี้
              </button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
