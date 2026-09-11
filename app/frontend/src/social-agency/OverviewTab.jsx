import { useEffect, useState } from "react";
import { CalendarClock, AlertTriangle, History, LayoutGrid, RefreshCw } from "lucide-react";
import { api, STATUS_META, PLATFORM_META, weekdayTh, formatDateTimeTh } from "./lib.js";

function StatCard({ label, value, cls }) {
  return (
    <div className={`sa-ov-stat ${cls || ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export default function OverviewTab({ activeClient, refreshKey, onOpenEntry }) {
  const clientId = activeClient?.id;
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    api(`/api/social-agency/overview?clientId=${encodeURIComponent(clientId)}`)
      .then((data) => {
        if (cancelled) return;
        setOverview(data.overview);
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  if (!clientId) return <div className="sa-ov"><p className="sa-muted">ยังไม่ได้เลือกลูกค้า</p></div>;
  if (loading && !overview) return <div className="sa-ov"><p className="sa-muted">กำลังโหลดภาพรวม…</p></div>;
  if (error && !overview) {
    return (
      <div className="sa-ov">
        <p className="sa-error-banner" role="alert">{error}</p>
      </div>
    );
  }

  const counts = overview?.counts || { scheduled: 0, awaiting: 0, published: 0, failed: 0 };
  const byPlatform = overview?.byPlatform || {};
  const upcoming = overview?.upcoming || [];
  const needsReview = overview?.needsReview || [];
  const recentRuns = overview?.recentRuns || [];

  return (
    <div className="sa-ov">
      <div className="sa-ov-stats">
        <StatCard label="คิวไว้แล้ว (เดือนนี้)" value={counts.scheduled} />
        <StatCard label="รออนุมัติ" value={counts.awaiting} cls="warn" />
        <StatCard label="เผยแพร่แล้ว" value={counts.published} cls="ok" />
        <StatCard label="ล้มเหลว/พลาด" value={counts.failed} cls="err" />
      </div>

      <div className="sa-ov-grid">
        <section className="sa-ov-card">
          <header>
            <CalendarClock size={15} />
            <b>7 วันข้างหน้า</b>
            <span className="sa-muted">{upcoming.length} รายการ</span>
          </header>
          {upcoming.length === 0 && <p className="sa-muted">ไม่มีคิวโพสต์ใน 7 วันนี้</p>}
          <ul className="sa-ov-list">
            {upcoming.map((e) => {
              const meta = STATUS_META[e.status] || { label: e.status };
              const pf = PLATFORM_META[e.platform] || PLATFORM_META.demo;
              return (
                <li key={e.id}>
                  <button className="sa-ov-row" onClick={() => onOpenEntry(e.id)}>
                    <span className="sa-ov-date">{weekdayTh(e.date)} {e.date.slice(8)}/{e.date.slice(5, 7)} · {e.time}</span>
                    <span className={`sa-platform-chip ${pf.cls}`}>{pf.short}</span>
                    <span className="sa-ov-name">{e.productName}</span>
                    <span className="sa-muted">{meta.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="sa-ov-card">
          <header>
            <AlertTriangle size={15} />
            <b>คิวรออนุมัติ</b>
            <span className="sa-muted">{needsReview.length} รายการ</span>
          </header>
          {needsReview.length === 0 && <p className="sa-muted">ไม่มีงานค้างอนุมัติ 🎉</p>}
          <ul className="sa-ov-list">
            {needsReview.map((e) => {
              const pf = PLATFORM_META[e.platform] || PLATFORM_META.demo;
              return (
                <li key={e.id}>
                  <button className="sa-ov-row" onClick={() => onOpenEntry(e.id)}>
                    <span className="sa-ov-date">{e.date.slice(8)}/{e.date.slice(5, 7)} · {e.time}</span>
                    <span className={`sa-platform-chip ${pf.cls}`}>{pf.short}</span>
                    <span className="sa-ov-name">{e.productName} · {e.angle}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="sa-ov-card">
          <header>
            <LayoutGrid size={15} />
            <b>สัดส่วนแพลตฟอร์ม (เดือนนี้)</b>
          </header>
          {Object.keys(byPlatform).length === 0 && <p className="sa-muted">ยังไม่มีคอนเทนต์เดือนนี้</p>}
          <ul className="sa-ov-list">
            {Object.entries(byPlatform).map(([platform, count]) => {
              const pf = PLATFORM_META[platform] || PLATFORM_META.demo;
              return (
                <li key={platform} className="sa-ov-row static">
                  <span className={`sa-platform-chip ${pf.cls}`}>{pf.short}</span>
                  <span className="sa-ov-name">{pf.label}</span>
                  <b>{count}</b>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="sa-ov-card">
          <header>
            <History size={15} />
            <b>การรันล่าสุด</b>
            {loading && <RefreshCw size={13} className="sa-spin" />}
          </header>
          {recentRuns.length === 0 && <p className="sa-muted">ยังไม่มีประวัติการรัน</p>}
          <ul className="sa-ov-list">
            {recentRuns.map((r) => (
              <li key={r.id} className="sa-ov-row static">
                <span className="sa-ov-date">{formatDateTimeTh(r.createdAt)}</span>
                <span className="sa-muted">{r.trigger === "schedule" ? "อัตโนมัติ" : r.trigger === "manual" ? "สั่งรันเอง" : r.trigger || "-"}</span>
                <span className="sa-muted">{r.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
