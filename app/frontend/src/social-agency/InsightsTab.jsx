import { useEffect, useRef, useState } from "react";
import { BarChart3, Send, Download, Save, Upload, ChevronLeft, ChevronRight, HardDrive } from "lucide-react";
import { api, postJson, bangkokToday } from "./lib.js";

export default function InsightsTab({ activeClient, refreshKey, onChanged }) {
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
