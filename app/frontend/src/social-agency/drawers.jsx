import { useEffect, useMemo, useState } from "react";
import {
  X, Play, Check, Ban, Trash2, CalendarClock, ExternalLink, Image as ImageIcon, Film,
  MessageSquare, Copy, ShieldCheck, Settings, RefreshCw, Clock,
} from "lucide-react";
import {
  STATUS_META, PLATFORM_META, NODE_LABELS, NODE_STATUS_TH, TONES,
  formatDateTimeTh, formatDuration, scoreClass, weekdayTh,
} from "./lib.js";

function Drawer({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sa-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside className="sa-drawer" role="dialog" aria-modal="true">
        <header>
          <h3>{title}</h3>
          <button className="sa-icon-btn" onClick={onClose} aria-label="ปิด"><X size={16} /></button>
        </header>
        <div className="sa-drawer-body">{children}</div>
        {footer && <footer className="sa-drawer-footer">{footer}</footer>}
      </aside>
    </div>
  );
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || { label: status, cls: "" };
  return <span className={`sa-pill ${meta.cls}`}>{meta.label}</span>;
}

function NodeTimeline({ run }) {
  if (!run) return null;
  return (
    <div className="sa-node-mini">
      {run.nodes.map((n) => (
        <div key={n.key} className={`sa-node-mini-step ${n.status}`}>
          <span className="sa-node-mini-dot" />
          <span className="sa-node-mini-label">{NODE_LABELS[n.key] || n.key}</span>
          <span className="sa-node-mini-status">{NODE_STATUS_TH[n.status] || n.status}</span>
        </div>
      ))}
    </div>
  );
}

export function EntryDrawer({ entry, client, onClose, onRunNow, onApprove, onReject, onReschedule, onDelete, onOpenInWorkflow, onOpenStyle, onCreateImage, onCreateVideo, onOpenChat, busy }) {
  const [date, setDate] = useState(entry.date);
  const [time, setTime] = useState(entry.time);
  const [copied, setCopied] = useState("");
  const run = useMemo(
    () => (client.workflowRuns || []).find((r) => r.id === entry.workflowRunId) || null,
    [client, entry]
  );
  const product = (client.products || []).find((p) => p.sku === entry.sku);
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text || "");
      setCopied(what);
      setTimeout(() => setCopied(""), 1600);
    } catch {}
  };
  return (
    <Drawer
      title={`โพสต์ ${weekdayTh(entry.date)} ${entry.date.slice(8)} ${entry.time}`}
      onClose={onClose}
      footer={
        <div className="sa-drawer-actions">
          {["planned", "needs_review", "failed", "missed", "rejected", "ready"].includes(entry.status) && (
            <button className="sa-btn primary" disabled={busy} onClick={() => onRunNow(entry.id)}>
              <Play size={14} /> รันเลยตอนนี้
            </button>
          )}
          {entry.status === "needs_review" && (
            <>
              <button className="sa-btn success" disabled={busy} onClick={() => onApprove(entry.id)}><Check size={14} /> อนุมัติและเผยแพร่</button>
              <button className="sa-btn danger ghost" disabled={busy} onClick={() => onReject(entry.id)}><Ban size={14} /> ปฏิเสธ</button>
            </>
          )}
          <button className="sa-btn ghost" onClick={() => onOpenInWorkflow(entry.id)}><Clock size={14} /> เปิดใน Workflow</button>
          {onOpenStyle && (
            <button className="sa-btn ghost" onClick={() => onOpenStyle(entry.id)}><Copy size={14} /> ฉบับต่อแพลตฟอร์ม</button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="sa-icon-btn danger"
            title="ลบรายการ"
            disabled={busy || entry.inFlight}
            onClick={() => onDelete(entry.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      }
    >
      <div className="sa-entry-meta">
        <StatusPill status={entry.status} />
        <span className={`sa-platform-chip ${PLATFORM_META[entry.platform]?.cls}`}>{PLATFORM_META[entry.platform]?.label}</span>
        <span className="sa-muted">{entry.angle}</span>
        {entry.late && <span className="sa-pill late">รันช้า</span>}
        {entry.publishMode && entry.publishMode !== "live" && <span className="sa-pill dry">{entry.publishMode === "demo" ? "Demo" : "Dry-run"}</span>}
      </div>

      <div className="sa-entry-facts">
        <div><span>สินค้า</span><b>{entry.productName}</b></div>
        <div><span>SKU</span><b>{entry.sku}</b></div>
        {product && <div><span>ขั้นต่ำ / เวลาผลิต</span><b>{product.minimumOrder} · {product.productionTime}</b></div>}
        {entry.publishedAt && <div><span>เผยแพร่เมื่อ</span><b>{formatDateTimeTh(entry.publishedAt)}</b></div>}
        {entry.postId && <div><span>Post ID</span><b className="sa-mono">{entry.postId}</b></div>}
      </div>

      <section className="sa-drawer-section">
        <h4>เลื่อนเวลา</h4>
        <div className="sa-reschedule">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button
            className="sa-btn"
            disabled={busy || entry.inFlight || (date === entry.date && time === entry.time)}
            onClick={() => onReschedule(entry.id, date, time)}
          >
            <CalendarClock size={14} /> บันทึก
          </button>
        </div>
        {entry.status === "missed" && (
          <p className="sa-form-hint">พลาดโพสต์ไปแล้ว — เลื่อนไปวัน/เวลาใหม่เพื่อให้ระบบจัดคิวใหม่ หรือกด "รันเลยตอนนี้"</p>
        )}
      </section>

      {entry.caption && (
        <section className="sa-drawer-section">
          <h4>คอนเทนต์ {entry.captionManual ? <span className="sa-muted">(แก้เอง)</span> : ""}</h4>
          <pre className="sa-caption">{entry.caption}</pre>
          <button className="sa-btn ghost sm" onClick={() => copy(entry.caption, "caption")}>
            <Copy size={13} /> {copied === "caption" ? "คัดลอกแล้ว" : "คัดลอก"}
          </button>
        </section>
      )}

      {run?.check && (
        <section className="sa-drawer-section">
          <h4><ShieldCheck size={15} /> AI Check</h4>
          <div className="sa-check-card">
            <div className="sa-check-score">
              <span className={`sa-score ${scoreClass(run.check.score)}`}>{run.check.score ?? "-"}</span>
              <span className="sa-muted">/ เกณฑ์ {client.settings?.threshold ?? 80}</span>
              <span className={`sa-pill ${run.check.verdict === "pass" ? "published" : run.check.verdict === "fix" ? "needs-review" : "failed"}`}>
                {run.check.verdict === "pass" ? "ผ่าน" : run.check.verdict === "fix" ? "ควรแก้" : "ต้องรีวิว"}
              </span>
            </div>
            {run.check.issues?.length ? (
              <ul className="sa-issues">
                {run.check.issues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            ) : (
              <p className="sa-muted">ไม่พบปัญหา — ผ่านเกณฑ์หลักฐาน ภาษา โทน แพลตฟอร์ม และความถูกต้องของสินค้า</p>
            )}
          </div>
        </section>
      )}

      {run && (
        <section className="sa-drawer-section">
          <h4>เวิร์กโฟลว์ล่าสุด <span className="sa-muted">{run.trigger === "schedule" ? "(ตามตาราง)" : run.trigger === "approve" ? "(อนุมัติ)" : "(กดรันเอง)"} · {formatDuration(run.durationMs)}</span></h4>
          <NodeTimeline run={run} />
        </section>
      )}

      {entry.imagePrompt && (
        <section className="sa-drawer-section">
          <h4>Image prompt (ส่งต่อไป Image workspace)</h4>
          <pre className="sa-caption small">{entry.imagePrompt}</pre>
          <div className="sa-handoff">
            <button className="sa-btn ghost sm" onClick={() => copy(entry.imagePrompt, "prompt")}>
              <Copy size={13} /> {copied === "prompt" ? "คัดลอกแล้ว" : "คัดลอกพรอมต์"}
            </button>
            <button className="sa-btn ghost sm" onClick={onCreateImage}><ImageIcon size={13} /> สร้างภาพ</button>
            <button className="sa-btn ghost sm" onClick={onCreateVideo}><Film size={13} /> ทำภาพเคลื่อนไหว</button>
            <button className="sa-btn ghost sm" onClick={onOpenChat}><MessageSquare size={13} /> คุยกับ LLM</button>
          </div>
        </section>
      )}

      {product?.sourceUrl && (
        <a className="sa-source-link" href={product.sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> หลักฐานสินค้าที่ตรวจแล้ว
        </a>
      )}
    </Drawer>
  );
}

export function NodeDetailDrawer({ node, onClose }) {
  if (!node) return null;
  return (
    <Drawer title={`${NODE_LABELS[node.key] || node.key} — ${NODE_STATUS_TH[node.status] || node.status}`} onClose={onClose}>
      <div className="sa-entry-meta">
        <span className={`sa-pill ${(STATUS_META[node.status] || {}).cls || node.status}`}>{NODE_STATUS_TH[node.status] || node.status}</span>
        {node.durationMs ? <span className="sa-muted">ใช้เวลา {formatDuration(node.durationMs)}</span> : null}
      </div>
      {node.error && <p className="sa-form-error">{node.error}</p>}
      {node.output && (
        <section className="sa-drawer-section">
          <h4>สรุปผล</h4>
          <pre className="sa-caption">{node.output}</pre>
        </section>
      )}
      {node.detail && (
        <section className="sa-drawer-section">
          <h4>ผลลัพธ์เต็ม / Log</h4>
          <pre className="sa-caption small">{node.detail}</pre>
        </section>
      )}
      {node.check && (
        <section className="sa-drawer-section">
          <h4>รายละเอียด AI Check</h4>
          <pre className="sa-caption small">{JSON.stringify(node.check, null, 2)}</pre>
        </section>
      )}
      {!node.output && !node.detail && <p className="sa-muted">โหนดนี้ยังไม่มีผลลัพธ์</p>}
    </Drawer>
  );
}

function ConnectorToggle({ checked, onChange, label }) {
  return (
    <label className="sa-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sa-toggle-track"><span className="sa-toggle-thumb" /></span>
      <span className="sa-toggle-label">{label}</span>
    </label>
  );
}

export function ConnectorsDrawer({ client, connectors, onClose, onSave, onTest, busy }) {
  const [form, setForm] = useState(() => ({
    facebook: { pageId: connectors?.facebook?.pageId || "", accessToken: connectors?.facebook?.accessToken || "", dryRun: connectors?.facebook?.dryRun !== false },
    instagram: { igUserId: connectors?.instagram?.igUserId || "", accessToken: connectors?.instagram?.accessToken || "", imgbbApiKey: connectors?.instagram?.imgbbApiKey || "", dryRun: connectors?.instagram?.dryRun !== false },
    line: { channelAccessToken: connectors?.line?.channelAccessToken || "", dryRun: connectors?.line?.dryRun !== false, sendImageTextStack: connectors?.line?.sendImageTextStack !== false },
    settings: {
      threshold: connectors?.settings?.threshold ?? 80,
      postsPerWeek: connectors?.settings?.postsPerWeek ?? 5,
      timezone: "Asia/Bangkok",
      dryRun: connectors?.settings?.dryRun !== false,
      notify: Boolean(connectors?.settings?.notify),
      weeklySummaryLine: Boolean(connectors?.settings?.weeklySummaryLine),
    },
  }));
  const [tests, setTests] = useState({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const setField = (platform, key) => (e) => setForm((f) => ({ ...f, [platform]: { ...f[platform], [key]: e.target.value } }));
  const setFlag = (platform, key) => (value) => setForm((f) => ({ ...f, [platform]: { ...f[platform], [key]: value } }));
  const runTest = async (platform) => {
    setTests((t) => ({ ...t, [platform]: { loading: true } }));
    try {
      const res = await onTest(platform, form[platform]);
      setTests((t) => ({ ...t, [platform]: { ok: true, message: res.message } }));
    } catch (err) {
      setTests((t) => ({ ...t, [platform]: { ok: false, message: err.message } }));
    }
  };
  const testBadge = (platform) => {
    const t = tests[platform];
    if (!t) return null;
    if (t.loading) return <span className="sa-pill in-workflow">กำลังทดสอบ…</span>;
    return <span className={`sa-pill ${t.ok ? "published" : "failed"}`}>{t.ok ? "เชื่อมต่อได้" : "ไม่สำเร็จ"}</span>;
  };
  return (
    <Drawer
      title={`Connectors — ${client.name}`}
      onClose={onClose}
      footer={
        <div className="sa-drawer-actions">
          {error && <span className="sa-form-error">{error}</span>}
          {saved && !error && <span className="sa-muted">บันทึกแล้ว ✓</span>}
          <div style={{ flex: 1 }} />
          <button
            className="sa-btn primary"
            disabled={busy}
            onClick={async () => {
              setError("");
              try {
                await onSave(form);
                setSaved(true);
                setTimeout(() => setSaved(false), 1800);
              } catch (err) {
                setError(err.message);
              }
            }}
          >
            <Settings size={14} /> บันทึกการตั้งค่า
          </button>
        </div>
      }
    >
      <p className="sa-form-hint">
        โทเค็นทุกตัวถูกเก็บไว้ในเครื่องฝั่งเซิร์ฟเวอร์เท่านั้น (ไฟล์ <code>connectors.json</code> ที่ไม่ถูกส่งขึ้น git) และแสดงบนหน้าจอแบบปิดบัง 4 หลักสุดท้าย
      </p>

      <section className="sa-connector">
        <header>
          <h4>Demo Publisher</h4>
          <span className="sa-pill published">พร้อมใช้เสมอ</span>
        </header>
        <p className="sa-muted">จำลองการเผยแพร่ 800ms พร้อม post ID สมมติ — ทุกลูกค้าใช้ได้ทันทีโดยไม่ต้องตั้งค่า โหมดนี้ทำให้ทั้งไปป์ไลน์รันได้ครบโดยไม่เสียโทเค็นใดๆ</p>
      </section>

      <section className="sa-connector">
        <header>
          <h4>Facebook Page</h4>
          {connectors?.facebook?.configured ? testBadge("facebook") : <span className="sa-pill planned">ยังไม่ตั้งค่า</span>}
        </header>
        <label className="sa-field"><span>Page ID</span><input value={form.facebook.pageId} onChange={setField("facebook", "pageId")} placeholder="1234567890" /></label>
        <label className="sa-field"><span>Page Access Token (long-lived)</span><input value={form.facebook.accessToken} onChange={setField("facebook", "accessToken")} placeholder="••••xxxx" autoComplete="off" /></label>
        <div className="sa-connector-row">
          <ConnectorToggle checked={form.facebook.dryRun} onChange={setFlag("facebook", "dryRun")} label="โหมดทดลอง (dry-run)" />
          <button className="sa-btn ghost sm" disabled={busy || tests.facebook?.loading} onClick={() => runTest("facebook")}>
            <RefreshCw size={13} /> ทดสอบการเชื่อมต่อ
          </button>
disabled={busy || tests.facebook?.loading} onClick={() => runTest("facebook")}>
            <RefreshCw size={13} /> ทดสอบการเชื่อมต่อ
          </button>
        </div>
        {tests.facebook?.message && <p className={`sa-test-msg ${tests.facebook.ok ? "ok" : "err"}`}>{tests.facebook.message}</p>}
        <p className="sa-form-hint">Text ไปที่ /feed · รูปไปที่ /photos · เว้นจังหวะโพสต์อย่างน้อย 5 นาทีต่อเพจ</p>
      </section>

      <section className="sa-connector">
        <header>
          <h4>Instagram (Business/Creator)</h4>
          {connectors?.instagram?.configured ? testBadge("instagram") : <span className="sa-pill planned">ยังไม่ตั้งค่า</span>}
        </header>
        <label className="sa-field"><span>IG User ID (ผูกกับเพจ FB แอปเดียวกัน)</span><input value={form.instagram.igUserId} onChange={setField("instagram", "igUserId")} placeholder="1784…" /></label>
        <label className="sa-field"><span>Access Token (Meta app เดียวกับ Facebook)</span><input value={form.instagram.accessToken} onChange={setField("instagram", "accessToken")} placeholder="••••xxxx" autoComplete="off" /></label>
        <label className="sa-field"><span>imgbb API key (อัปโหลดรูปเป็นสาธารณะ)</span><input value={form.instagram.imgbbApiKey} onChange={setField("instagram", "imgbbApiKey")} placeholder="••••xxxx" autoComplete="off" /></label>
        <div className="sa-connector-row">
          <ConnectorToggle checked={form.instagram.dryRun} onChange={setFlag("instagram", "dryRun")} label="โหมดทดลอง (dry-run)" />
          <button className="sa-btn ghost sm" disabled={busy || tests.instagram?.loading} onClick={() => runTest("instagram")}>
            <RefreshCw size={13} /> ทดสอบการเชื่อมต่อ
          </button>
        </div>
        {tests.instagram?.message && <p className={`sa-test-msg ${tests.instagram.ok ? "ok" : "err"}`}>{tests.instagram.message}</p>}
        <p className="sa-form-hint">โพสต์ 2 ขั้น: สร้าง container → poll จน FINISHED → publish · จำกัด 50 โพสต์/24 ชม. (นับในเครื่องให้)</p>
      </section>

      <section className="sa-connector">
        <header>
          <h4>LINE Official Account (LINE@)</h4>
          {connectors?.line?.configured ? testBadge("line") : <span className="sa-pill planned">ยังไม่ตั้งค่า</span>}
        </header>
        <label className="sa-field"><span>Messaging API Channel Access Token</span><input value={form.line.channelAccessToken} onChange={setField("line", "channelAccessToken")} placeholder="••••xxxx" autoComplete="off" /></label>
        <div className="sa-connector-row">
          <ConnectorToggle checked={form.line.dryRun} onChange={setFlag("line", "dryRun")} label="โหมดทดลอง (dry-run)" />
          <button className="sa-btn ghost sm" disabled={busy || tests.line?.loading} onClick={() => runTest("line")}>
            <RefreshCw size={13} /> ทดสอบการเชื่อมต่อ
          </button>
        </div>
        <ConnectorToggle checked={form.line.sendImageTextStack} onChange={setFlag("line", "sendImageTextStack")} label="ส่งรูป+ข้อความพร้อมกัน (ถ้ามีรูป)" />
        {tests.line?.message && <p className={`sa-test-msg ${tests.line.ok ? "ok" : "err"}`}>{tests.line.message}</p>}
        <p className="sa-form-hint">Publish = broadcast ถึงผู้ติดตามทุกคน · เช็คโควตารายเดือนก่อนส่งเสมอ (แพ็กเกจฟรีมีจำกัด) · โพสต์ไปไทม์ไลน์ส่วนตัว/กลุ่มส่วนตัวไม่ได้ด้วย API ทางการ</p>
      </section>

      <section className="sa-connector">
        <header><h4>การตั้งค่าอื่นๆ (ต่อลูกค้านี้)</h4></header>
        <div className="sa-field-row">
          <label className="sa-field">
            <span>เกณฑ์ AI Check (ผ่านอัตโนมัติ)</span>
            <input type="number" min="50" max="95" value={form.settings.threshold} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, threshold: Number(e.target.value) } }))} />
          </label>
          <label className="sa-field">
            <span>โพสต์ต่อสัปดาห์</span>
            <input type="number" min="1" max="7" value={form.settings.postsPerWeek} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, postsPerWeek: Number(e.target.value) } }))} />
          </label>
        </div>
        <label className="sa-field"><span>เขตเวลา</span><input value="Asia/Bangkok" disabled /></label>
        <ConnectorToggle checked={form.settings.notify} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, notify: v } }))} label="แจ้งเตือน macOS เมื่อเผยแพร่/ล้มเหลว (เฉพาะ Mac)" />
        <ConnectorToggle checked={form.settings.weeklySummaryLine} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, weeklySummaryLine: v } }))} label="สรุปรายสัปดาห์อัตโนมัติทาง LINE (ทุกวันจันทร์ 09:00 น.)" />
      </section>
    </Drawer>
  );
}

