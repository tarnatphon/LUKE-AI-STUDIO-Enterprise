import { useEffect, useRef, useState } from "react";
import { BarChart3, Send, Download, Save, Upload, ChevronLeft, ChevronRight, HardDrive, TrendingUp, RefreshCw } from "lucide-react";
import { api, postJson, bangkokToday } from "./lib.js";
import { safeExternalUrl } from "../lib/safe-link.mjs";

export default function InsightsTab({ activeClient, refreshKey, onChanged, onOpenEntry }) {
  const clientId = activeClient?.id;
  const [weekOffset, setWeekOffset] = useState(0);
  const [summary, setSummary] = useState(null);
  const [summaryText, setSummaryText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendNote, setSendNote] = useState("");
  const [backups, setBackups] = useState([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState("");
  const [perf, setPerf] = useState(null);
  const [perfError, setPerfError] = useState("");
  const [perfBusy, setPerfBusy] = useState(false);
  const [perfNote, setPerfNote] = useState("");
  const [tracking, setTracking] = useState(null);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [trackingPlatform, setTrackingPlatform] = useState("all");
  const fileRef = useRef(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setSummaryBusy(true);
    setSummaryError("");
    api(`/api/social-agency/weekly-summary?clientId=${encodeURIComponent(clientId)}&weekOffset=${weekOffset}`)
      .then((data) => {
        if (cancelled) return;
        setSummary(data.summary);
        setSummaryText(data.text || "");
      })
      .catch((err) => {
        if (!cancelled) setSummaryError(err.message);
      })
      .finally(() => {
        if (!cancelled) setSummaryBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, weekOffset, refreshKey]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api("/api/social-agency/backups")
      .then((data) => {
        if (!cancelled) setBackups(data.backups || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api(`/api/social-agency/performance?clientId=${encodeURIComponent(clientId)}`)
      .then((data) => {
        if (cancelled) return;
        setPerf(data.performance);
        setPerfError("");
      })
      .catch((err) => {
        if (!cancelled) setPerfError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api(`/api/social-agency/tracking?clientId=${encodeURIComponent(clientId)}`)
      .then((data) => { if (!cancelled) setTracking(data.tracking); })
      .catch(() => { if (!cancelled) setTracking(null); });
    return () => { cancelled = true; };
  }, [clientId, refreshKey]);

  const syncRecent = async () => {
    if (!clientId || perfBusy) return;
    setPerfBusy(true); setPerfNote("");
    try {
      const { result } = await postJson(`/api/social-agency/metrics/refresh-recent?clientId=${encodeURIComponent(clientId)}`, {});
      setPerfNote(result.attempted ? `ซิงค์ ${result.updated}/${result.attempted} โพสต์${result.results.some((r) => r.error) ? " — ดูสาเหตุใน drawer โพสต์" : ""}` : "ยังไม่มีโพสต์ FB/IG live ที่ครบ 5 นาทีภายใน 30 วันที่ซิงค์ได้");
      const data = await api(`/api/social-agency/performance?clientId=${encodeURIComponent(clientId)}`);
      setPerf(data.performance);
      onChanged?.();
    } catch (err) { setPerfNote(`ซิงค์ไม่สำเร็จ: ${err.message}`); }
    finally { setPerfBusy(false); }
  };

  const sendLine = async () => {
    if (!clientId || sendBusy) return;
    const ok = window.confirm(
      `ส่งสรุปสัปดาห์ ${summary?.start} – ${summary?.end} ทาง LINE broadcast ถึงผู้ติดตามทุกคน?\n\n${summaryText.slice(0, 300)}${summaryText.length > 300 ? "…" : ""}`
    );
    if (!ok) return;
    setSendBusy(true);
    setSendNote("");
    try {
      const data = await postJson(`/api/social-agency/weekly-summary/send?clientId=${encodeURIComponent(clientId)}`, { weekOffset });
      if (data.sent) setSendNote("ส่งสรุปทาง LINE แล้ว ✓");
      else if (data.reason === "dryRun") setSendNote("ยังอยู่ในโหมด dryRun — ปิด dryRun ของ LINE ใน Connectors ก่อนส่งจริง (ดูตัวอย่างด้านล่างได้เลย)");
      else setSendNote(`ยังไม่ส่ง (${data.reason || "unknown"})`);
    } catch (err) {
      setSendNote(`ส่งไม่สำเร็จ: ${err.message}`);
    } finally {
      setSendBusy(false);
    }
  };

  const downloadBackup = async () => {
    if (!clientId || backupBusy) return;
    setBackupBusy(true);
    setBackupNote("");
    try {
      const data = await api(`/api/social-agency/backup?clientId=${encodeURIComponent(clientId)}`);
      const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `social-agency-${clientId}-${bangkokToday()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setBackupNote("ดาวน์โหลดไฟล์สำรองแล้ว ✓");
    } catch (err) {
      setBackupNote(`ดาวน์โหลดไม่สำเร็จ: ${err.message}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const snapshotToServer = async () => {
    if (!clientId || backupBusy) return;
    setBackupBusy(true);
    setBackupNote("");
    try {
      const data = await postJson(`/api/social-agency/backup/snapshot?clientId=${encodeURIComponent(clientId)}`, {});
      setBackupNote(`บันทึก snapshot ลงเซิร์ฟเวอร์แล้ว: ${data.snapshot.file}`);
      const list = await api("/api/social-agency/backups");
      setBackups(list.backups || []);
    } catch (err) {
      setBackupNote(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreFromFile = async (file) => {
    if (!file || backupBusy) return;
    const ok = window.confirm(
      `กู้ข้อมูลลูกค้านี้จากไฟล์ "${file.name}"?\nข้อมูลปัจจุบันจะถูกแทนที่ (ระบบจะเก็บ safety copy ไว้ให้อัตโนมัติ)`
    );
    if (!ok) return;
    setBackupBusy(true);
    setBackupNote("");
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);
      const data = await postJson(`/api/social-agency/backup/restore?clientId=${encodeURIComponent(clientId)}`, { snapshot });
      setBackupNote(`กู้ข้อมูลสำเร็จ: ${data.restored.join(", ")}`);
      onChanged?.();
    } catch (err) {
      setBackupNote(`กู้ข้อมูลไม่สำเร็จ: ${err.message}`);
    } finally {
      setBackupBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (!clientId) return <div className="sa-insights"><p className="sa-muted">ยังไม่ได้เลือกลูกค้า</p></div>;

  return (
    <div className="sa-insights">
      <section className="sa-insights-card">
        <header>
          <TrendingUp size={15} />
          <b>ผลงานโพสต์</b>
          <span className="sa-muted">{perf ? `วัดผลแล้ว ${perf.measured}/${perf.total} โพสต์` : "…"}</span>
          <button className="sa-btn ghost sm" disabled={perfBusy} onClick={syncRecent}>
            <RefreshCw size={13} /> {perfBusy ? "กำลังซิงค์…" : "ซิงค์ Meta สูงสุด 3 โพสต์"}
          </button>
        </header>
        {perfNote && <p className="sa-muted">{perfNote}</p>}
        {perfError && <p className="sa-error-banner">{perfError}</p>}
        {perf && perf.measured === 0 && (
          <p className="sa-muted">ยังไม่มีตัวเลข — FB/IG live จะซิงค์ให้อัตโนมัติหลังโพสต์ 5 นาที (อาจรอ Meta ประมวลผลถึง 48 ชม.) หรือกดซิงค์ด้านบน / กรอกเองใน drawer โพสต์</p>
        )}
        {perf && perf.measured > 0 && (
          <>
            <div className="sa-insights-stats">
              {perf.pillars.map((p) => (
                <span key={p.name}><b>{p.avg}</b> {p.name} ({p.count})</span>
              ))}
            </div>
            {perf.suggestions.map((s, i) => (
              <p key={i} className="sa-muted">💡 {s}</p>
            ))}
            <p><b>🏆 ท็อปโพสต์</b></p>
            <ul className="sa-insights-backups">
              {perf.top.map((t) => (
                <li key={t.id}>
                  <span className="sa-ov-name">{t.excerpt}</span>
                  <span className="sa-muted">{t.engagement} · {t.platform} · {t.pillar}</span>
                </li>
              ))}
            </ul>
            <p><b>📉 ต้องปรับปรุง</b></p>
            <ul className="sa-insights-backups">
              {perf.bottom.map((t) => (
                <li key={t.id}>
                  <span className="sa-ov-name">{t.excerpt}</span>
                  <span className="sa-muted">{t.engagement} · {t.platform} · {t.pillar}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="sa-insights-card">
        <header><TrendingUp size={15} /><b>A/B hook + เวลา</b><span className="sa-muted">{perf?.experiments?.length || 0} ชุด</span></header>
        {!perf?.experiments?.length && <p className="sa-muted">เลือก 2 hook ใน drawer ของโพสต์ FB/IG ที่ยังไม่เผยแพร่ เพื่อสร้างโพสต์เช้า/เย็นแยกกัน</p>}
        {(perf?.experiments || []).map((test) => (
          <div key={test.id} className="sa-drawer-section">
            <p><b>{test.platform} · {test.winner ? `ผล: ${test.winner === "tie" ? "เสมอ" : `แบบ ${test.winner} ได้ไลก์+คอมเมนต์มากกว่า`}` : "รอทั้งสองโพสต์ live และครบ 48 ชม. พร้อมยอดไลก์+คอมเมนต์"}</b></p>
            {(test.variants || []).map((v) => <p key={v.entryId} className="sa-muted">
              <button className="sa-btn ghost sm" onClick={() => onOpenEntry?.(v.entryId)}>ดูโพสต์ {v.variant}</button>
              {` ${v.date} ${v.time} · ${v.hook} · ${v.ready ? `${v.engagement} ไลก์+คอมเมนต์` : v.status}`}
            </p>)}
          </div>
        ))}
        {!!perf?.experiments?.length && <p className="sa-form-hint">A/B นี้ทดสอบ hook พร้อมกับช่วงเวลา จึงไม่แยกผลของ hook เพียงอย่างเดียว; ช่วงเวลาและผู้ชมอาจมีผล</p>}
      </section>

      <section className="sa-insights-card">
        <header><TrendingUp size={15} /><b>รายงานลิงก์ UTM ตามแพลตฟอร์ม</b>
          <button className="sa-btn ghost sm" onClick={() => setTrackingOpen((v) => !v)}>{trackingOpen ? "ซ่อนรายงาน" : "เปิดรายงาน"}</button>
        </header>
        {trackingOpen && <>
          <p className="sa-form-hint">แสดงลิงก์ที่ส่งออกจริงพร้อม utm_source / utm_medium / utm_campaign / utm_content · ยอดคลิกต้องดูในเครื่องมือ Analytics ของเว็บไซต์ ไม่ใช่ยอด engagement จาก Meta (ลิงก์ในแคปชัน IG กดไม่ได้)</p>
          <div className="sa-insights-actions">
            <button className="sa-btn ghost sm" onClick={() => setTrackingPlatform("all")}>ทั้งหมด ({tracking?.rows?.length || 0})</button>
            {["facebook", "instagram", "line"].map((p) => <button key={p} className="sa-btn ghost sm" onClick={() => setTrackingPlatform(p)}>{p} ({tracking?.byPlatform?.[p] || 0})</button>)}
          </div>
          <ul className="sa-insights-backups">
            {(tracking?.rows || []).filter((r) => trackingPlatform === "all" || r.platform === trackingPlatform).map((r, i) => (
              <li key={`${r.entryId}-${i}`}><span className="sa-muted">{r.platform} · {r.date} · </span>
                <a href={safeExternalUrl(r.url) || undefined} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{r.url.slice(0, 150)}{r.url.length > 150 ? "…" : ""}</a>
                <button className="sa-btn ghost sm" onClick={() => onOpenEntry?.(r.entryId)}>ดูโพสต์</button>
              </li>
            ))}
          </ul>
          {!tracking?.rows?.length && <p className="sa-muted">ยังไม่มีลิงก์ติด UTM ในโพสต์ live</p>}
        </>}
      </section>

      <section className="sa-insights-card">
        <header>
          <BarChart3 size={15} />
          <b>สรุปรายสัปดาห์</b>
          <span style={{ flex: 1 }} />
          <button className="sa-icon-btn sm" disabled={weekOffset >= 8} onClick={() => setWeekOffset((w) => w + 1)} aria-label="สัปดาห์ก่อนหน้า">
            <ChevronLeft size={14} />
          </button>
          <span className="sa-muted">{summary ? `${summary.start} – ${summary.end}` : "…"}</span>
          <button className="sa-icon-btn sm" disabled={weekOffset <= 0} onClick={() => setWeekOffset((w) => w - 1)} aria-label="สัปดาห์ถัดไป">
            <ChevronRight size={14} />
          </button>
        </header>
        {summaryError && <p className="sa-error-banner">{summaryError}</p>}
        {summary && (
          <div className="sa-insights-stats">
            <span><b>{summary.counts.published}</b> เผยแพร่แล้ว</span>
            <span><b>{summary.counts.total}</b> ทั้งหมด</span>
            <span><b>{summary.counts.failed}</b> ล้มเหลว/พลาด</span>
            <span><b>{summary.counts.runs}</b> รัน</span>
          </div>
        )}
        <pre className="sa-insights-text">{summaryBusy ? "กำลังโหลด…" : summaryText || "—"}</pre>
        <div className="sa-insights-actions">
          <button className="sa-btn primary sm" disabled={sendBusy || summaryBusy || !summary} onClick={sendLine}>
            <Send size={13} /> {sendBusy ? "กำลังส่ง…" : "ส่งสรุปทาง LINE"}
          </button>
          {sendNote && <span className="sa-muted">{sendNote}</span>}
        </div>
        <p className="sa-muted sa-insights-hint">
          เคล็ดลับ: เปิด “สรุปรายสัปดาห์อัตโนมัติ” ต่อลูกค้าได้ใน Settings (settings.weeklySummaryLine) — ระบบจะส่งทุกวันจันทร์ 09:00 น. เมื่อตั้งค่า LINE และปิด dryRun แล้ว
        </p>
      </section>

      <section className="sa-insights-card">
        <header>
          <HardDrive size={15} />
          <b>สำรอง & กู้ข้อมูล</b>
        </header>
        <div className="sa-insights-actions">
          <button className="sa-btn sm" disabled={backupBusy} onClick={downloadBackup}>
            <Download size={13} /> ดาวน์โหลดข้อมูลลูกค้านี้
          </button>
          <button className="sa-btn sm" disabled={backupBusy} onClick={snapshotToServer}>
            <Save size={13} /> เก็บ snapshot ลงเซิร์ฟเวอร์
          </button>
          <button className="sa-btn ghost sm" disabled={backupBusy} onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> กู้จากไฟล์…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => restoreFromFile(e.target.files?.[0])}
          />
        </div>
        {backupNote && <p className="sa-muted">{backupNote}</p>}
        <ul className="sa-insights-backups">
          {backups.map((b) => (
            <li key={b.file}>
              <span className="sa-ov-name">{b.file}</span>
              <span className="sa-muted">{(b.size / 1024).toFixed(1)} KB</span>
            </li>
          ))}
        </ul>
        {backups.length === 0 && <p className="sa-muted">ยังไม่มี snapshot บนเซิร์ฟเวอร์</p>}
      </section>
    </div>
  );
}
