import { Clock, Timer, PlayCircle, AlertTriangle, ListChecks } from "lucide-react";
import { schedulerHealth, timeUntil } from "./lib.js";

/**
 * The scheduler's own state, in two sizes.
 *
 * `getSchedulerStatus()` has always been served by the runtime, but the UI only
 * ever said "Scheduler ทำงานอยู่" — not when it last ticked, not what it will do
 * next, and nothing at all when it was stuck. A timer object exists whether or
 * not the loop behind it is alive, so "on" alone is not evidence.
 */

export function SchedulerPill({ scheduler, nextPostIn }) {
  const health = schedulerHealth(scheduler);
  const next = nextPostIn || (health.nextPostAt ? timeUntil(health.nextPostAt) : null);
  return (
    <span
      className={`sa-scheduler ${health.running ? "on" : ""}${health.stale ? " stale" : ""}`}
      title={health.detail}
      role="status"
      data-scheduler-state={health.running ? (health.stale ? "stale" : "on") : "off"}
    >
      <Clock size={13} />
      <b>{health.label}</b>
      <span className="sa-scheduler-meta">
        · tick ล่าสุด {health.lastTickText}
        {health.running && health.nextPostAt ? ` · โพสต์ถัดไป ${next ? `ใน ${next}` : "กำลังจะถึง"}` : ""}
      </span>
    </span>
  );
}

export default function SchedulerStatusCard({ scheduler }) {
  const health = schedulerHealth(scheduler);
  const overdue = scheduler?.overdueApprovals || [];
  const nextIn = health.nextPostAt ? timeUntil(health.nextPostAt) : null;
  return (
    <section className={`sa-sched-card ${health.running ? (health.stale ? "stale" : "on") : "off"}`} data-scheduler-state={health.running ? (health.stale ? "stale" : "on") : "off"}>
      <header>
        <Timer size={15} />
        <b>{health.label}</b>
        <span className="sa-sched-card-state">{health.running ? (health.stale ? "⚠ ต้องตรวจ" : "▶ ทำงาน") : "■ หยุด"}</span>
      </header>
      <p className="sa-form-hint">{health.detail}</p>
      <div className="sa-sched-card-rows">
        <div><span>tick ล่าสุด</span><b>{health.lastTickText}</b></div>
        <div><span>รอบการทำงาน</span><b>ทุก {(scheduler?.tickMs || 60000) / 1000} วินาที</b></div>
        <div><span>กำลังรันอยู่</span><b>{health.activeCount} งาน</b></div>
        <div><span>เขตเวลา</span><b>{health.timezone}</b></div>
        {health.nextPostAt && (
          <div className="sa-sched-card-next">
            <span>โพสต์ถัดไป</span>
            <b>{health.nextPostLabel || "-"}{nextIn ? ` · ในอีก ${nextIn}` : ""}</b>
          </div>
        )}
        {!health.nextPostAt && health.running && (
          <div className="sa-sched-card-next"><span>โพสต์ถัดไป</span><b>ยังไม่มีคิวที่ตั้งเวลาไว้ในอนาคต</b></div>
        )}
      </div>
      {overdue.length > 0 && (
        <p className="sa-warn-banner" role="status">
          <AlertTriangle size={13} /> มี {overdue.length} รายการเลยเวลาแล้วแต่ยังรออนุมัติ — ตัวตั้งเวลาจะไม่ส่งให้เอง ต้องกดอนุมัติ (ดูการ์ดด้านบน)
        </p>
      )}
      {!health.running && (
        <p className="sa-form-hint">
          <PlayCircle size={13} /> โพสต์ที่ตั้งเวลาไว้จะไม่ขึ้นเองเลยจนกว่าจะกด ▶ (มุมขวาบน) และเปิดแอปค้างไว้ — ตัวตั้งเวลาทำงานอยู่ในตัวแอป ไม่ใช่บริการเบื้องหลัง
        </p>
      )}
      {health.running && health.stale && (
        <p className="sa-error-banner" role="alert">
          <ListChecks size={13} /> tick ล่าสุดนานเกิน 3 นาที — เซิร์ฟเวอร์หรือแท็บแอปอาจค้าง ตรวจก่อนรอโพสต์ (ปิด/เปิดตัวตั้งเวลาใหม่เพื่อทดสอบ)
        </p>
      )}
    </section>
  );
}
