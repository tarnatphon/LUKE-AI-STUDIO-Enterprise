import { useEffect, useMemo, useState } from "react";
import { safeExternalUrl } from "../lib/safe-link.mjs";
import PostPreview from "./PostPreview.jsx";
import CaptionPresets from "./CaptionPresets.jsx";
import {
  X, Play, Check, Ban, Trash2, CalendarClock, ExternalLink, Image as ImageIcon, Film,
  MessageSquare, Copy, ShieldCheck, Settings, RefreshCw, Clock, Share2,
} from "lucide-react";
import {
  STATUS_META, PLATFORM_META, NODE_LABELS, NODE_STATUS_TH, TONES,
  formatDateTimeTh, formatDuration, scoreClass, weekdayTh, bangkokToday,
  PRODUCT_REF_MODE_LABEL, productRefNotice, ensureProductRef500,
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

function TikTokConsent({ entry, onCreatorInfo, onSaveCaption, onConsent, onStatus }) {
  const [creator, setCreator] = useState(null);
  const [captionDraft, setCaptionDraft] = useState(entry.caption || "");
  useEffect(() => setCaptionDraft(entry.caption || ""), [entry.id, entry.caption]);
  const [privacy, setPrivacy] = useState(""); // intentionally no default
  const [commercial, setCommercial] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);
  const [disableComment, setDisableComment] = useState(false);
  const [disableDuet, setDisableDuet] = useState(false);
  const [disableStitch, setDisableStitch] = useState(false);
  const [music, setMusic] = useState(false);
  const [upload, setUpload] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true); setError(""); setPrivacy(""); setCreator(null);
    try { setCreator(await onCreatorInfo(entry.id)); } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!entry.tiktokInitAttemptedAt && onCreatorInfo) load(); }, [entry.id]);
  const saveCaption = async () => {
    setLoading(true); setError("");
    try { await onSaveCaption(entry.id, captionDraft); await load(); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const submit = async () => {
    setLoading(true); setError("");
    try {
      await onConsent(entry.id, {
        creatorUsername: creator.creator_username, privacyLevel: privacy,
        previewCaption: creator.captionPreview,
        commercialContent: commercial, yourBrand, brandedContent: branded,
        disableComment, disableDuet, disableStitch,
        musicUsageConfirmed: music, uploadConsent: upload,
      });
      setMusic(false); setUpload(false); setPrivacy(""); // renewed consent must be explicit
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const done = Boolean(entry.tiktokInitAttemptedAt);
  return <section className="sa-drawer-section">
    <h4>TikTok · Direct Post วิดีโอ</h4>
    <p className="sa-form-hint">ใช้ไฟล์วิดีโอในเครื่อง (ไม่ใช้ URL) · ต้องมี app product Content Posting API, scope video.publish และ User Access Token ที่อนุญาตแล้ว · โทเค็นที่ใส่เองอาจหมดอายุ; ไม่มี OAuth/refresh ในแอปนี้ · แอปที่ไม่ผ่าน audit ส่งได้เฉพาะ SELF_ONLY ตามข้อจำกัดของ TikTok</p>
    {entry.tiktokPost && <p className="sa-muted">ยืนยันล่าสุด: @{entry.tiktokPost.creatorUsername} · {entry.tiktokPost.privacyLevel} · {entry.tiktokPost.consentedAt} (หากแก้แคปชัน/ไฟล์ต้องยืนยันใหม่)</p>}
    {entry.tiktokInitAttemptedAt && <div>
      <p className="sa-form-hint">คำขอ init เริ่มแล้ว ห้ามกดส่งซ้ำ แม้เครือข่ายขัดข้อง · publish_id ไม่ใช่โพสต์ที่เผยแพร่แล้ว</p>
      <p className="sa-muted">สถานะ: {entry.tiktokStatus || "ไม่ทราบ (init อาจสำเร็จแล้ว)"} {entry.tiktokPublishId && `· publish_id ${entry.tiktokPublishId}`}</p>
      {entry.tiktokStatusError && <p className="sa-form-error" role="alert">{entry.tiktokStatusError}</p>}
      {entry.tiktokPublicPostIds?.length > 0 && <p className="sa-muted">Public post IDs: {entry.tiktokPublicPostIds.join(", ")}</p>}
      {entry.tiktokPublishId && <button className="sa-btn ghost sm" disabled={loading} onClick={async () => {
        setLoading(true); setError(""); try { await onStatus(); } catch (err) { setError(err.message); } finally { setLoading(false); }
      }}>เช็กสถานะจาก TikTok</button>}
    </div>}
    {!done && <>
      <label className="sa-field"><span>แคปชัน TikTok (แก้ไขได้ก่อนยืนยัน)</span>
        <textarea rows={4} value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value)} disabled={loading || entry.inFlight} />
      </label>
      <button className="sa-btn ghost sm" disabled={loading || entry.inFlight || captionDraft === entry.caption} onClick={saveCaption}>บันทึกแคปชัน</button>
      <button className="sa-btn ghost sm" disabled={loading || captionDraft !== entry.caption} onClick={load}>รีเฟรชบัญชีและตัวเลือกจาก TikTok</button>
      {creator && <>
        <p className="sa-muted">บัญชี @{creator.creator_username} ({creator.creator_nickname}) · วิดีโอได้สูงสุด {creator.max_video_post_duration_sec} วินาที</p>
        <p className="sa-form-hint">แคปชันที่จะส่ง (รวม UTM):</p>
        <pre className="sa-caption small" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{creator.captionPreview}</pre>
        <label className="sa-field"><span>Privacy (ต้องเลือกเอง)</span>
          <select value={privacy} onChange={(e) => { setPrivacy(e.target.value); if (e.target.value === "SELF_ONLY") setBranded(false); }}>
            <option value="">— เลือก privacy —</option>
            {creator.privacy_level_options.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="sa-field"><input type="checkbox" checked={commercial} onChange={(e) => { setCommercial(e.target.checked); if (!e.target.checked) { setYourBrand(false); setBranded(false); } }} /> Commercial Content (ปิดเป็นค่าเริ่มต้น)</label>
        {commercial && <div>
          <label className="sa-field"><input type="checkbox" checked={yourBrand} onChange={(e) => setYourBrand(e.target.checked)} /> Your brand</label>
          <label className="sa-field"><input type="checkbox" checked={branded} disabled={privacy === "SELF_ONLY"} onChange={(e) => setBranded(e.target.checked)} /> Branded content (ห้าม SELF_ONLY)</label>
        </div>}
        {[ ["disableComment", disableComment, setDisableComment, creator.comment_disabled, "ปิดคอมเมนต์"], ["disableDuet", disableDuet, setDisableDuet, creator.duet_disabled, "ปิด Duet"], ["disableStitch", disableStitch, setDisableStitch, creator.stitch_disabled, "ปิด Stitch"] ].map(([id, value, setter, locked, label]) => <label className="sa-field" key={id}><input type="checkbox" checked={value || locked} disabled={locked} onChange={(e) => setter(e.target.checked)} /> {label}{locked ? " (บัญชีปิดไว้)" : ""}</label>)}
        <p className="sa-form-hint">แคปชันที่แก้ไขได้อยู่ในรายการนี้; ระบบอาจเติม UTM ให้ลิงก์ และจะระบุวิดีโอ AI-generated ใน TikTok · ตรวจเนื้อหา/เสียงก่อนยืนยัน</p>
        <label className="sa-field"><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} /> ฉันยืนยันว่ามีสิทธิ์ใช้เพลง/เสียงในวิดีโอนี้ (Music Usage Confirmation)</label>
        <label className="sa-field"><input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} /> ฉันยินยอมส่งไฟล์วิดีโอและแคปชันนี้ไปยังบัญชี @{creator.creator_username} ตาม privacy ที่เลือก เมื่อฉันสั่งรันหรือถึงเวลาที่ตั้งไว้</label>
        <button className="sa-btn sm" disabled={loading || !privacy || !music || !upload || !entry.video?.path || !entry.caption?.trim() || captionDraft !== entry.caption || (commercial && !yourBrand && !branded) || (branded && privacy === "SELF_ONLY")} onClick={submit}>บันทึกความยินยอม TikTok สำหรับรายการนี้</button>
      </>}
    </>}
    {error && <p className="sa-form-error" role="alert">{error}</p>}
  </section>;
}

const IMAGE_GATE_LABEL = {
  approved: "ตรวจภาพแล้ว — พร้อมส่งจริง",
  unreviewed: "ยังไม่ได้ตรวจภาพ — ระบบจะไม่ส่งจริง",
  stale: "ภาพ / Public URL / สินค้า เปลี่ยนหลังตรวจ — ต้องตรวจใหม่",
  generating: "กำลังสร้างภาพทดแทน — ระบบจะไม่ส่งจริงจนกว่าจะตรวจภาพใหม่",
  unreadable: "อ่านไฟล์ภาพไม่ได้ — ตรวจและส่งจริงไม่ได้",
  rejected: "รูปนี้ถูกปฏิเสธ — ห้ามใช้รูปนี้ ต้องสร้างภาพใหม่",
};

// Human image review — separate from caption approval. Recording it never
// starts a workflow and never publishes; dry-run works without it.
function ImageReviewGate({ entry, busy, onReviewImage, onRejectImage }) {
  const gate = entry.imageGate;
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { setConfirmed(false); }, [entry.id, gate?.status]);
  if (!gate?.required || !entry.image) return null;
  const approved = gate.status === "approved";
  const canReview = ["unreviewed", "stale"].includes(gate.status);
  const refNotice = productRefNotice(entry);
  return (
    <div className={`sa-image-gate ${approved ? "ok" : "blocked"}`} role="group" aria-label="ด่านตรวจภาพ">
      <strong>{approved ? "✅" : "⛔"} ด่านตรวจภาพ: {IMAGE_GATE_LABEL[gate.status] || gate.reason}</strong>
      {approved && gate.reviewedAt && <span className="sa-muted"> · ตรวจเมื่อ {formatDateTimeTh(gate.reviewedAt)}</span>}
      {refNotice && (
        <p className={refNotice.level === "warn" ? "sa-warn-banner" : "sa-form-hint"} role="status">
          {refNotice.level === "warn" ? "⚠️ รูปสินค้าอ้างอิง: " : "ℹ️ "}{refNotice.text}
        </p>
      )}
      {canReview && (
        <>
          <label className="sa-image-gate-confirm">
            <input type="checkbox" className="sa-image-gate-check" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>ฉันดูภาพนี้เทียบกับรูปสินค้าจริงของ SKU {entry.sku} แล้ว และภาพเหมาะจะโพสต์จริง</span>
          </label>
          <button className="sa-btn success sm" disabled={busy || !confirmed} onClick={() => onReviewImage?.(entry.id, true)}>
            <ShieldCheck size={13} /> ตรวจภาพแล้ว
          </button>
        </>
      )}
      {gate.status === "rejected" && (
        <p className="sa-form-hint">กด "สร้างภาพใหม่" ด้านล่างเพื่อสร้างภาพทดแทน — รูปที่ปฏิเสธไว้จะถูกจดจำไว้ ถ้าภาพใหม่ออกมาเหมือนเดิมระบบจะบล็อกซ้ำ</p>
      )}
      {onRejectImage && ["unreviewed", "stale", "approved"].includes(gate.status) && (
        <button className="sa-btn ghost sm danger" disabled={busy} onClick={() => onRejectImage(entry.id)}>
          <Ban size={13} /> ไม่ใช่ — ห้ามใช้รูปนี้
        </button>
      )}
      {approved && (
        <button className="sa-btn ghost sm" disabled={busy} onClick={() => onReviewImage?.(entry.id, false)}>ยกเลิกการตรวจภาพ</button>
      )}
      <p className="sa-form-hint">การกดตรวจภาพไม่เริ่ม workflow และไม่เผยแพร่เอง · กด "ไม่ใช่ — ห้ามใช้รูปนี้" จะล็อกรูปนี้และสร้างภาพใหม่ให้อัตโนมัติ · ด่านนี้ใช้กับการส่งจริงเท่านั้น dry-run ใช้งานได้ตามปกติ</p>
    </div>
  );
}

// Which product photo actually reached the backend for the image on screen, so
// nobody approves a wrong-product picture without being told.
function ImageRefLine({ entry }) {
  const job = entry?.imageJob;
  if (!job || !job.status || job.status === "running" || job.status === "idle") return null;
  const label = PRODUCT_REF_MODE_LABEL[job.refMode];
  if (!label) return null;
  const denoise = job.refMode === "img2img" && Number.isFinite(Number(job.denoise))
    ? ` · denoise ${Number(job.denoise).toFixed(2)}`
    : "";
  // The backend trims an img2img schedule by denoise, so the request carries more
  // steps than the number of real ones the operator asked for. Show both, and say
  // when the 150-step ceiling stopped the run short.
  const steps = job.refMode === "img2img" && Number.isFinite(Number(job.steps))
    ? ` · steps ${Number(job.steps)}→${Number(job.stepsSent ?? job.steps)}` +
      (job.stepsCapped ? " (แตะเพดาน 150 — รอบนี้ได้สเต็ปจริงน้อยกว่าที่ตั้งไว้)" : "")
    : "";
  return <p className="sa-form-hint">โหมดรูปอ้างอิงของภาพล่าสุด: {label}{denoise}{steps}</p>;
}

export function EntryDrawer({ entry, client, onClose, onRunNow, onApprove, onReject, onReschedule, onDelete, onOpenInWorkflow, onOpenStyle, onCreateImage, onCreateVideo, onOpenChat, onGenerateImage, onReviewImage, onRejectImage, onSaveTags, onCaptionApplied, generatingImage, imageGenError, onGenerateVideo, generatingVideo, videoGenError, onUseHook, onCreateExperiment, onCancelExperiment, onRepurpose, onSaveMetrics, onRefreshMetrics, onSaveMediaUrls, onTikTokCreatorInfo, onTikTokSaveCaption, onTikTokConsent, onTikTokStatus, busy }) {
  const [date, setDate] = useState(entry.date);
  const [repurposing, setRepurposing] = useState(false);
  const [abDate, setAbDate] = useState(() => new Date(Date.parse(`${bangkokToday()}T00:00:00Z`) + 86400000).toISOString().slice(0, 10));
  const [abMorning, setAbMorning] = useState("09:00");
  const [abEvening, setAbEvening] = useState("18:30");
  const [abFirst, setAbFirst] = useState(() => String(Math.max(0, (entry.hookVariants || []).findIndex((h) => h.used))));
  const [abSecond, setAbSecond] = useState(() => String((entry.hookVariants || []).findIndex((_, i) => i !== Math.max(0, (entry.hookVariants || []).findIndex((h) => h.used)))));
  const [abBusy, setAbBusy] = useState(false);
  const [abError, setAbError] = useState("");

  const [metricsForm, setMetricsForm] = useState({
    likes: entry.metrics?.likes ?? "",
    comments: entry.metrics?.comments ?? "",
    shares: entry.metrics?.shares ?? "",
    views: entry.metrics?.views ?? "",
  });
  const [videoPublicUrl, setVideoPublicUrl] = useState(entry.video?.publicUrl || "");
  const [previewImagePublicUrl, setPreviewImagePublicUrl] = useState(entry.image?.publicUrl || "");
  const [mediaUrlError, setMediaUrlError] = useState("");
  const [mediaUrlSaved, setMediaUrlSaved] = useState(false);
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [refreshMetricsBusy, setRefreshMetricsBusy] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const saveMetrics = async () => {
    if (!onSaveMetrics) return;
    setMetricsBusy(true);
    setMetricsError("");
    try {
      await onSaveMetrics(entry.id, metricsForm);
    } catch (err) {
      setMetricsError(err.message);
    } finally {
      setMetricsBusy(false);
    }
  };
  useEffect(() => {
    setMetricsForm({
      likes: entry.metrics?.likes ?? "", comments: entry.metrics?.comments ?? "",
      shares: entry.metrics?.shares ?? "", views: entry.metrics?.views ?? "",
    });
  }, [entry.id, entry.metrics?.recordedAt]);
  const [time, setTime] = useState(entry.time);
  const [copied, setCopied] = useState("");
  const run = useMemo(
    () => (client.workflowRuns || []).find((r) => r.id === entry.workflowRunId) || null,
    [client, entry]
  );
  const product = (client.products || []).find((p) => p.sku === entry.sku);
  // ป้ายกำกับรายการ (เช่น concept / pencil case) — แก้จากหน้าโพสต์นี้
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const [tagDraft, setTagDraft] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState("");
  const knownTags = useMemo(() => {
    const counts = new Map();
    for (const e of client.calendar || []) {
      for (const t of e.tags || []) {
        if (tags.includes(t)) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  }, [client.calendar, entry.id, tags]);
  const saveTags = async (next) => {
    if (!onSaveTags || tagBusy) return;
    setTagBusy(true);
    setTagError("");
    try {
      await onSaveTags(entry.id, next);
    } catch (err) {
      setTagError(err.message);
    } finally {
      setTagBusy(false);
    }
  };
  const addTag = async (raw) => {
    const t = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!t) return;
    if (t.length > 24) { setTagError(`ป้าย "${t.slice(0, 12)}…" ยาวเกิน 24 ตัวอักษร`); return; }
    if (tags.length >= 8) { setTagError("ป้ายได้สูงสุด 8 ป้ายต่อรายการ"); return; }
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    setTagDraft("");
    await saveTags([...tags, t]);
  };
  // Facebook multi-photo posts carry the real product photo as the second
  // image; opening an entry quietly makes sure the ≤500px derivative exists.
  useEffect(() => {
    if (!client?.id || !product?.sku) return;
    ensureProductRef500(client.id, product).catch(() => {});
  }, [client?.id, product?.sku, product?.image]);
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
          {!entry.abTestSource && ["planned", "needs_review", "failed", "missed", "rejected", "ready"].includes(entry.status) && (
            <button className="sa-btn primary" disabled={busy || (entry.platform === "tiktok" && !entry.tiktokPost)} onClick={() => onRunNow(entry.id)}>
              <Play size={14} /> รันเลยตอนนี้
            </button>
          )}
          {!entry.abTestSource && entry.status === "needs_review" && (
            <>
              <button className="sa-btn success" disabled={busy || (entry.platform === "tiktok" && !entry.tiktokPost)} onClick={() => onApprove(entry.id)}><Check size={14} /> อนุมัติและเผยแพร่</button>
              <button className="sa-btn danger ghost" disabled={busy} onClick={() => onReject(entry.id)}><Ban size={14} /> ปฏิเสธ</button>
            </>
          )}
          <button className="sa-btn ghost" onClick={() => onOpenInWorkflow(entry.id)}><Clock size={14} /> เปิดใน Workflow</button>
          {onOpenStyle && (
            <button className="sa-btn ghost" onClick={() => onOpenStyle(entry.id)}><Copy size={14} /> ฉบับต่อแพลตฟอร์ม</button>
          )}
          {entry.caption && onRepurpose && (
            <button
              className="sa-btn ghost"
              disabled={busy || repurposing}
              onClick={async () => { setRepurposing(true); try { await onRepurpose(entry.id); } finally { setRepurposing(false); } }}
            >
              <Share2 size={14} /> {repurposing ? "กำลังแตก…" : "แตกทุกแพลตฟอร์ม"}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="sa-icon-btn danger"
            title="ลบรายการ"
            disabled={busy || entry.inFlight || entry.tiktokInitAttemptedAt}
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
        {entry.pillar && <span className="sa-pill">{entry.pillar}</span>}
        {entry.repurposedFrom && <span className="sa-muted">แตกจาก {String(entry.repurposedFrom).slice(-6)}</span>}
        {entry.abTest && <span className="sa-pill">A/B {entry.abTest.variant}</span>}
        {entry.abTestSource && <span className="sa-muted">ต้นฉบับ A/B — เก็บแล้ว ไม่เผยแพร่</span>}
        {entry.late && <span className="sa-pill late">รันช้า</span>}
        {entry.publishMode && entry.publishMode !== "live" && <span className="sa-pill dry">{entry.publishMode === "pending" ? "รอ TikTok ประมวลผล" : entry.publishMode === "failed" ? "TikTok ล้มเหลว" : entry.publishMode === "demo" ? "Demo" : "Dry-run"}</span>}
      </div>

      {/* The real post comes first: image and full caption are what has to be
          checked before approving, so they sit at the top of the details
          instead of below the scheduling and prompt sections. */}
      <section className="sa-drawer-section sa-post-preview-section">
        <div className="sa-post-preview-section-head">
          <h4>พรีวิวโพสต์เต็ม {entry.captionManual ? <span className="sa-muted">(แก้เอง)</span> : ""}</h4>
          {(entry.publishedCaption || entry.caption) && (
            <button className="sa-btn ghost sm" onClick={() => copy(entry.publishedCaption || entry.caption, "caption")}>
              <Copy size={13} /> {copied === "caption" ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
            </button>
          )}
        </div>
        <PostPreview entry={entry} client={client} product={product} />
        <p className="sa-form-hint">ตัวอย่างนี้แสดงข้อความเต็มและสื่อที่เตรียมไว้ เลย์เอาต์จริงอาจต่างกันเล็กน้อยตามแอปและบัญชีปลายทาง</p>
      </section>

      <CaptionPresets entry={entry} client={client} product={product} busy={busy} onApplied={onCaptionApplied} />

      {onSaveTags && (
        <div className="sa-tags-row">
          <span className="sa-tags-label">ป้าย</span>
          <div className="sa-tag-list">
            {tags.map((t) => (
              <span key={t} className="sa-tag">
                {t}
                <button aria-label={`เอาป้าย ${t} ออก`} title={`เอาป้าย ${t} ออก`} disabled={tagBusy} onClick={() => saveTags(tags.filter((x) => x !== t))}>×</button>
              </span>
            ))}
            <input
              className="sa-tag-input"
              value={tagDraft}
              placeholder={tags.length ? "+ ป้าย" : "ติดป้าย เช่น concept / pencil case"}
              aria-label="เพิ่มป้ายให้รายการนี้"
              disabled={tagBusy || tags.length >= 8}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagDraft); } }}
            />
          </div>
          {knownTags.length > 0 && (
            <div className="sa-tag-suggest">
              {knownTags.map((t) => (
                <button key={t} disabled={tagBusy || tags.length >= 8} onClick={() => addTag(t)}>+{t}</button>
              ))}
            </div>
          )}
          {tagError && <p className="sa-form-error" role="alert">{tagError}</p>}
        </div>
      )}

      <div className="sa-entry-facts">
        <div><span>สินค้า</span><b>{entry.productName}</b></div>
        <div><span>SKU</span><b>{entry.sku}</b></div>
        {product && <div><span>ขั้นต่ำ / เวลาผลิต</span><b>{product.minimumOrder} · {product.productionTime}</b></div>}
        {entry.publishedAt && <div><span>เผยแพร่เมื่อ</span><b>{formatDateTimeTh(entry.publishedAt)}</b></div>}
        {entry.postId && <div><span>{entry.platform === "tiktok" && entry.tiktokPublishId ? "publish_id (ไม่ใช่ public post ID)" : "Post ID"}</span><b className="sa-mono">{entry.postId}</b></div>}
        {entry.abTest && <div><span>Hook {entry.abTest.variant}</span><b>{entry.abTest.hook}</b></div>}
      </div>

      {(entry.abTest || entry.abTestSource) && (() => {
        const testId = entry.abTest?.id || entry.abTestSource?.id;
        const children = (client.calendar || []).filter((x) => x.abTest?.id === testId);
        const canCancel = children.length && children.every((x) => !x.inFlight && !["published", "publishing"].includes(x.status));
        return <section className="sa-drawer-section">
          <h4>ชุด A/B {testId}</h4>
          <p className="sa-form-hint">{entry.abTestSource ? "ต้นฉบับถูกเก็บเพื่อไม่ให้เผยแพร่เป็นโพสต์ที่สาม" : `แบบ ${entry.abTest.variant} ของชุดนี้`} · เทียบผลใน Insights หลังโพสต์ทั้งสองครบ 48 ชม.</p>
          {canCancel && onCancelExperiment && <button className="sa-btn ghost sm" disabled={busy || abBusy} onClick={async () => {
            if (!window.confirm("ยกเลิกโพสต์ A/B ทั้งคู่ แล้วคืนสถานะต้นฉบับ?")) return;
            setAbBusy(true); setAbError("");
            try { await onCancelExperiment(testId); } catch (err) { setAbError(err.message); }
            finally { setAbBusy(false); }
          }}>ยกเลิกชุด A/B และคืนต้นฉบับ</button>}
          {abError && <p className="sa-form-error">{abError}</p>}
        </section>;
      })()}

      {entry.platform === "tiktok" && <TikTokConsent entry={entry} onCreatorInfo={onTikTokCreatorInfo} onSaveCaption={onTikTokSaveCaption} onConsent={onTikTokConsent} onStatus={onTikTokStatus} />}

      <section className="sa-drawer-section">
        <h4>เลื่อนเวลา</h4>
        <div className="sa-reschedule">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button
            className="sa-btn"
            disabled={busy || entry.inFlight || entry.tiktokInitAttemptedAt || (date === entry.date && time === entry.time)}
            onClick={() => onReschedule(entry.id, date, time)}
          >
            <CalendarClock size={14} /> บันทึก
          </button>
        </div>
        {entry.status === "missed" && (
          <p className="sa-form-hint">พลาดโพสต์ไปแล้ว — เลื่อนไปวัน/เวลาใหม่เพื่อให้ระบบจัดคิวใหม่ หรือกด "รันเลยตอนนี้"</p>
        )}
      </section>

      {(entry.viralScore || (entry.hookVariants && entry.hookVariants.length > 0)) && (
        <section className="sa-drawer-section">
          <h4>🔥 ไวรัลสกอร์ {entry.viralScore ? (<><span className={`sa-score ${scoreClass(entry.viralScore.score)}`}>{entry.viralScore.score}</span><span className="sa-muted"> / เกณฑ์ {client.settings?.viralThreshold ?? 60}</span></>) : null}</h4>
          {entry.hookVariants && entry.hookVariants.length > 0 && (
            <ul className="sa-issues">
              {entry.hookVariants.map((h, i) => (
                <li key={i}>
                  {h.used ? "✅ " : ""}{h.text} <span className="sa-muted">({h.score})</span>
                  {!h.used && !entry.abTest && !entry.abTestSource && onUseHook ? (
                    <> <button className="sa-btn ghost sm" onClick={() => onUseHook(entry.id, i)}>ใช้ hook นี้</button></>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {onCreateExperiment && !entry.abTest && !entry.abTestSource && !entry.inFlight &&
            ["facebook", "instagram"].includes(entry.platform) && ["planned", "ready", "needs_review"].includes(entry.status) &&
            entry.caption && (entry.hookVariants || []).length >= 2 && (
            <div className="sa-drawer-section">
              <h4>ทดลอง A/B: hook เช้า / เย็น</h4>
              <p className="sa-form-hint">สร้างโพสต์ใหม่ 2 รายการ โดยใช้เนื้อหาและสื่อเดิม เปลี่ยนแค่ hook กับเวลา · ต้นฉบับจะถูกเก็บ ไม่ถูกโพสต์ · หากเปิด live และผ่าน AI Check ระบบอาจเผยแพร่ตามเวลาที่เลือก</p>
              <label className="sa-field"><span>Hook A (เช้า)</span><select value={abFirst} onChange={(e) => setAbFirst(e.target.value)}>{entry.hookVariants.map((h, i) => <option key={i} value={i}>{h.text}</option>)}</select></label>
              <label className="sa-field"><span>Hook B (เย็น)</span><select value={abSecond} onChange={(e) => setAbSecond(e.target.value)}>{entry.hookVariants.map((h, i) => <option key={i} value={i}>{h.text}</option>)}</select></label>
              <div className="sa-reschedule">
                <input type="date" value={abDate} min={bangkokToday()} onChange={(e) => setAbDate(e.target.value)} aria-label="วันทดลอง A/B" />
                <input type="time" value={abMorning} onChange={(e) => setAbMorning(e.target.value)} aria-label="เวลาตอนเช้า" />
                <input type="time" value={abEvening} onChange={(e) => setAbEvening(e.target.value)} aria-label="เวลาตอนเย็น" />
              </div>
              <button className="sa-btn ghost sm" disabled={busy || abBusy || abFirst === abSecond} onClick={async () => {
                if (!window.confirm(`สร้างโพสต์ A/B ${abDate} เวลา ${abMorning} และ ${abEvening}? ต้นฉบับจะถูกเก็บและไม่เผยแพร่ แต่สองโพสต์ใหม่อาจเผยแพร่จริงตามเวลา`)) return;
                setAbBusy(true); setAbError("");
                try { await onCreateExperiment(entry.id, { firstIndex: Number(abFirst), secondIndex: Number(abSecond), date: abDate, morning: abMorning, evening: abEvening }); }
                catch (err) { setAbError(err.message); }
                finally { setAbBusy(false); }
              }}>{abBusy ? "กำลังสร้าง…" : "สร้างโพสต์ทดสอบ A/B"}</button>
              {abError && <p className="sa-form-error" role="alert">{abError}</p>}
              <p className="sa-form-hint">เทียบผลงานใน Insights หลังทั้งคู่ live ≥48 ชม. การเปรียบเทียบนี้วัดชุด hook+เวลา ไม่ได้พิสูจน์ผลของ hook เพียงอย่างเดียว</p>
            </div>
          )}
          {entry.viralScore?.breakdown ? (
            <ul className="sa-issues">
              {entry.viralScore.breakdown.filter((b) => !b.pass).map((b, i) => (
                <li key={i}>💡 {b.label}</li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      {(entry.status === "published" || entry.metrics) && (
        <section className="sa-drawer-section">
          <h4>📊 ผลงานโพสต์</h4>
          {entry.status === "published" && entry.publishMode === "live" && ["facebook", "instagram"].includes(entry.platform) && entry.postId && onRefreshMetrics && (
            <button className="sa-btn ghost sm" disabled={refreshMetricsBusy} onClick={async () => {
              setRefreshMetricsBusy(true); setMetricsError("");
              try { await onRefreshMetrics(entry.id); }
              catch (err) { setMetricsError(err.message); }
              finally { setRefreshMetricsBusy(false); }
            }}><RefreshCw size={13} /> {refreshMetricsBusy ? "กำลังดึงยอด…" : "ดึงยอดจาก Meta"}</button>
          )}
          {entry.metrics ? (
            <p className="sa-muted">
              ❤️ {entry.metrics.likes ?? "—"} · 💬 {entry.metrics.comments ?? "—"} · 🔁 {entry.metrics.shares ?? "—"} · 👁️ {entry.metrics.views ?? "—"}
              {entry.metrics.recordedAt ? ` · บันทึก ${formatDateTimeTh(entry.metrics.recordedAt)}` : ""}
              {entry.metrics.source ? ` · ${entry.metrics.source === "meta" ? "Meta" : entry.metrics.source === "mixed" ? "Meta + กรอกเอง" : "กรอกเอง"}` : ""}
            </p>
          ) : (
            <p className="sa-muted">ยังไม่มีตัวเลข — FB/IG live จะดึงให้อัตโนมัติหลังเผยแพร่ประมาณ 5 นาที และซิงค์ซ้ำ (Meta อาจใช้เวลาถึง 48 ชม.) หรือกรอกเองด้านล่าง</p>
          )}
          {onSaveMetrics && (
            <div className="sa-style-row">
              {["likes", "comments", "shares", "views"].map((k) => (
                <input
                  key={k}
                  type="number"
                  min="0"
                  value={metricsForm[k]}
                  onChange={(e) => setMetricsForm({ ...metricsForm, [k]: e.target.value })}
                  placeholder={{ likes: "❤️ ไลก์", comments: "💬 คอมเมนต์", shares: "🔁 แชร์", views: "👁️ วิว" }[k]}
                  aria-label={k}
                />
              ))}
              <button className="sa-btn primary sm" disabled={metricsBusy} onClick={saveMetrics}>
                {metricsBusy ? "กำลังบันทึก…" : "บันทึกยอด"}
              </button>
            </div>
          )}
          {entry.metricsSync?.error && <p className="sa-form-hint">ซิงค์ล่าสุดไม่สำเร็จ: {entry.metricsSync.error}</p>}
          {entry.metricsSync?.warning && <p className="sa-form-hint">ข้อมูลบางรายการดึงไม่ได้: {entry.metricsSync.warning}</p>}
          <p className="sa-form-hint">ช่องที่กรอกเองจะไม่ถูก Meta เขียนทับ เว้นว่างแล้วบันทึกเพื่อกลับไปใช้ยอดอัตโนมัติ · — หมายถึง Meta ยังไม่ส่งค่านั้น (ไม่ใช่ศูนย์)</p>
          {metricsError && <p className="sa-error-banner">{metricsError}</p>}
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

      {(entry.imagePrompt || entry.image?.url) && (
        <section className="sa-drawer-section">
          <h4>Image prompt (ส่งต่อไป Image workspace)</h4>
          {entry.imagePrompt && <pre className="sa-caption small">{entry.imagePrompt}</pre>}
          {entry.image?.url && (
            <img className="sa-entry-image" src={entry.image.url} alt="พรีวิวภาพประกอบโพสต์" />
          )}
          <ImageRefLine entry={entry} />
          <ImageReviewGate entry={entry} busy={busy} onReviewImage={onReviewImage} />
          {generatingImage === entry.id && (
            <p className="sa-muted">⏳ กำลังสร้างภาพ… (ปกติ 1–4 นาที เสร็จแล้วรูปจะขึ้นตรงนี้เอง)</p>
          )}
          {imageGenError && (
            <p className="sa-error-banner" role="alert">{imageGenError}</p>
          )}
          <div className="sa-handoff">
            {entry.imagePrompt && (
              <button className="sa-btn ghost sm" onClick={() => copy(entry.imagePrompt, "prompt")}>
                <Copy size={13} /> {copied === "prompt" ? "คัดลอกแล้ว" : "คัดลอกพรอมต์"}
              </button>
            )}
            <button className="sa-btn ghost sm" disabled={generatingImage === entry.id || Boolean(entry.abTest || entry.abTestSource)} onClick={() => onGenerateImage?.(entry.id)}>
              <ImageIcon size={13} /> {generatingImage === entry.id ? "กำลังสร้าง…" : entry.image?.url ? "สร้างภาพใหม่" : "สร้างภาพ"}
            </button>
            <button className="sa-btn ghost sm" onClick={onCreateImage}><ExternalLink size={13} /> เปิดใน Generator</button>
            <button className="sa-btn ghost sm" onClick={onCreateVideo}><ExternalLink size={13} /> เปิดใน Animate</button>
            <button className="sa-btn ghost sm" onClick={onOpenChat}><MessageSquare size={13} /> คุยกับ LLM</button>
          </div>
        </section>
      )}

      {(entry.animatePrompt || entry.image?.url || entry.video?.url || generatingVideo === entry.id || videoGenError) && (
        <section className="sa-drawer-section">
          <h4>Animate prompt (ไอเดียวิดีโอ 5 วินาที)</h4>
          {entry.animateCameraLabel && (
            <p className="sa-muted">🎥 มุมกล้อง: {entry.animateCameraLabel}</p>
          )}
          {entry.animatePrompt && <pre className="sa-caption small">{entry.animatePrompt}</pre>}
          {entry.video?.url && (
            <>
              <video className="sa-entry-video" src={entry.video.url} controls preload="metadata" />
              <p className="sa-muted">📎 FB/IG ส่งไฟล์วิดีโอตรงไป Meta; LINE ต้องมี publicUrl HTTPS ของวิดีโอและภาพตัวอย่าง มิฉะนั้นการส่งจะล้มพร้อมแจ้งสาเหตุ (ไม่โพสต์รูปแทน)</p>
            </>
          )}
          {entry.platform === "line" && onSaveMediaUrls && (
            <div>
              <p className="sa-form-hint">LINE ต้องดาวน์โหลดวิดีโอและภาพตัวอย่างได้จาก URL HTTPS สาธารณะ ใส่ URL จากโฮสต์ของคุณก่อนเผยแพร่</p>
              <label className="sa-field"><span>วิดีโอสาธารณะ (HTTPS)</span><input type="url" value={videoPublicUrl} onChange={(e) => setVideoPublicUrl(e.target.value)} placeholder="https://media.example.com/clip.mp4" /></label>
              <label className="sa-field"><span>ภาพตัวอย่างสาธารณะ (HTTPS)</span><input type="url" value={previewImagePublicUrl} onChange={(e) => setPreviewImagePublicUrl(e.target.value)} placeholder="https://media.example.com/preview.jpg" /></label>
              <button className="sa-btn sm" disabled={busy || entry.inFlight} onClick={async () => {
                setMediaUrlError(""); setMediaUrlSaved(false);
                try { await onSaveMediaUrls(entry.id, videoPublicUrl, previewImagePublicUrl); setMediaUrlSaved(true); }
                catch (err) { setMediaUrlError(err.message); }
              }}>บันทึก URL สำหรับ LINE</button>
              {mediaUrlSaved && <span className="sa-muted"> บันทึกแล้ว ✓</span>}
              {mediaUrlError && <p className="sa-form-error" role="alert">{mediaUrlError}</p>}
            </div>
          )}
          {generatingVideo === entry.id && (
            <>
              <p className="sa-muted">⏳ กำลังสร้างวิดีโอ… {entry.videoJob?.progress ?? 0}% (SVD บน Mac ใช้เวลาหลายสิบนาที ประมาณ 45–60 นาที เสร็จแล้ววิดีโอจะขึ้นตรงนี้เอง)</p>
              <div className="sa-progress"><div className="sa-progress-fill" style={{ width: `${entry.videoJob?.progress ?? 0}%` }} /></div>
            </>
          )}
          {videoGenError && (
            <p className="sa-error-banner" role="alert">{videoGenError}</p>
          )}
          <div className="sa-handoff">
            {entry.animatePrompt && (
              <button className="sa-btn ghost sm" onClick={() => copy(entry.animatePrompt, "aprompt")}>
                <Copy size={13} /> {copied === "aprompt" ? "คัดลอกแล้ว" : "คัดลอก animate prompt"}
              </button>
            )}
            <button className="sa-btn ghost sm" disabled={generatingVideo === entry.id || !entry.image?.url || Boolean(entry.abTest || entry.abTestSource)} title={entry.image?.url ? "" : "สร้างภาพนิ่งก่อน"} onClick={() => onGenerateVideo?.(entry.id)}>
              <Film size={13} /> {generatingVideo === entry.id ? "กำลังสร้างวิดีโอ…" : entry.video?.url ? "สร้างวิดีโอใหม่" : "ทำภาพเคลื่อนไหว"}
            </button>
          </div>
        </section>
      )}

      {product?.sourceUrl && (
        <a className="sa-source-link" href={safeExternalUrl(product.sourceUrl) || undefined} target="_blank" rel="noreferrer">
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
    facebook: { pageId: connectors?.facebook?.pageId || "", accessToken: connectors?.facebook?.accessToken || "", apiVersion: connectors?.facebook?.apiVersion || "v25.0", dryRun: connectors?.facebook?.dryRun !== false },
    instagram: { igUserId: connectors?.instagram?.igUserId || "", accessToken: connectors?.instagram?.accessToken || "", imgbbApiKey: connectors?.instagram?.imgbbApiKey || "", insightsAccessToken: connectors?.instagram?.insightsAccessToken || "", apiVersion: connectors?.instagram?.apiVersion || "v25.0", dryRun: connectors?.instagram?.dryRun !== false },
    line: { channelAccessToken: connectors?.line?.channelAccessToken || "", dryRun: connectors?.line?.dryRun !== false, sendImageTextStack: connectors?.line?.sendImageTextStack !== false },
    tiktok: { accessToken: connectors?.tiktok?.accessToken || "", dryRun: connectors?.tiktok?.dryRun !== false, auditApproved: connectors?.tiktok?.auditApproved === true },
    settings: {
      threshold: connectors?.settings?.threshold ?? 80,
      postsPerWeek: connectors?.settings?.postsPerWeek ?? 5,
      timezone: "Asia/Bangkok",
      dryRun: connectors?.settings?.dryRun !== false,
      notify: Boolean(connectors?.settings?.notify),
      weeklySummaryLine: Boolean(connectors?.settings?.weeklySummaryLine),
      useProductRef: connectors?.settings?.useProductRef !== false,
      productRefMode: connectors?.settings?.productRefMode === "reference" ? "reference" : "img2img",
      productRefDenoise: Number.isFinite(Number(connectors?.settings?.productRefDenoise)) ? Number(connectors.settings.productRefDenoise) : 0.38,
      productRefInPost: connectors?.settings?.productRefInPost !== false,
      imageWidth: Number.isFinite(Number(connectors?.settings?.imageWidth)) ? Number(connectors.settings.imageWidth) : 1024,
      imageHeight: Number.isFinite(Number(connectors?.settings?.imageHeight)) ? Number(connectors.settings.imageHeight) : 600,
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
  const versionField = (platform) => {
    const expires = connectors?.[platform]?.apiVersion === form[platform].apiVersion
      ? connectors?.[platform]?.versionExpiresAt : {
        "v21.0": "2027-01-21", "v22.0": "2027-05-20", "v23.0": "2027-10-08",
        "v24.0": "2028-02-18", "v25.0": "2028-07-29",
      }[form[platform].apiVersion];
    const daysLeft = expires ? Math.ceil((Date.parse(`${expires}T00:00:00Z`) - Date.now()) / 86400000) : null;
    return <>
      <label className="sa-field"><span>Meta Graph API version</span>
        <select value={form[platform].apiVersion} onChange={setField(platform, "apiVersion")}>
          {["v21.0", "v22.0", "v23.0", "v24.0", "v25.0", "v26.0"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      {daysLeft !== null && daysLeft <= 120 && <p className="sa-form-error" role="alert">
        {daysLeft <= 0 ? "เวอร์ชันนี้หมดอายุแล้ว" : `เวอร์ชันนี้หมดอายุใน ${daysLeft} วัน (${expires})`} — เปลี่ยนเวอร์ชันและทดสอบการเชื่อมต่อ
      </p>}
    </>;
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
        {versionField("facebook")}
        <div className="sa-connector-row">
          <ConnectorToggle checked={form.facebook.dryRun} onChange={setFlag("facebook", "dryRun")} label="โหมดทดลอง (dry-run)" />
          <button className="sa-btn ghost sm" disabled={busy || tests.facebook?.loading} onClick={() => runTest("facebook")}>
            <RefreshCw size={13} /> ทดสอบการเชื่อมต่อ
          </button>
        </div>
        {tests.facebook?.message && <p className={`sa-test-msg ${tests.facebook.ok ? "ok" : "err"}`}>{tests.facebook.message}</p>}
        <p className="sa-form-hint">Text ไปที่ /feed · รูปไปที่ /photos · วิดีโอส่งตรงไป Meta /videos · เว้นจังหวะโพสต์อย่างน้อย 5 นาทีต่อเพจ</p>
      </section>

      <section className="sa-connector">
        <header>
          <h4>Instagram (Business/Creator)</h4>
          {connectors?.instagram?.configured ? testBadge("instagram") : <span className="sa-pill planned">ยังไม่ตั้งค่า</span>}
        </header>
        <label className="sa-field"><span>IG User ID (ผูกกับเพจ FB แอปเดียวกัน)</span><input value={form.instagram.igUserId} onChange={setField("instagram", "igUserId")} placeholder="1784…" /></label>
        <label className="sa-field"><span>Access Token (Meta app เดียวกับ Facebook)</span><input value={form.instagram.accessToken} onChange={setField("instagram", "accessToken")} placeholder="••••xxxx" autoComplete="off" /></label>
        {versionField("instagram")}
        <label className="sa-field"><span>User Access Token สำหรับอ่าน Insights (instagram_manage_insights; เว้นว่างเพื่อทดลองใช้ token เผยแพร่เดิม)</span><input value={form.instagram.insightsAccessToken} onChange={setField("instagram", "insightsAccessToken")} placeholder="••••xxxx" autoComplete="off" /></label>
        <label className="sa-field"><span>imgbb API key (อัปโหลดรูปเป็นสาธารณะ)</span><input value={form.instagram.imgbbApiKey} onChange={setField("instagram", "imgbbApiKey")} placeholder="••••xxxx" autoComplete="off" /></label>
        <div className="sa-connector-row">
          <ConnectorToggle checked={form.instagram.dryRun} onChange={setFlag("instagram", "dryRun")} label="โหมดทดลอง (dry-run)" />
          <button className="sa-btn ghost sm" disabled={busy || tests.instagram?.loading} onClick={() => runTest("instagram")}>
            <RefreshCw size={13} /> ทดสอบการเชื่อมต่อ
          </button>
        </div>
        {tests.instagram?.message && <p className={`sa-test-msg ${tests.instagram.ok ? "ok" : "err"}`}>{tests.instagram.message}</p>}
        <p className="sa-form-hint">Reels: สร้าง container → ส่งไฟล์ตรงไป Meta rupload → poll → publish (ไม่ต้องใช้โฮสต์วิดีโอภายนอก) · จำกัด 50 โพสต์/24 ชม. (นับในเครื่องให้) · ทดสอบสิทธิ์อ่าน Insights ด้วยปุ่มดึงยอดในโพสต์ live</p>
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
        <header><h4>TikTok (Content Posting API · วิดีโอเท่านั้น)</h4>
          {connectors?.tiktok?.configured ? testBadge("tiktok") : <span className="sa-pill planned">ยังไม่ตั้งค่า</span>}
        </header>
        <label className="sa-field"><span>User Access Token (scope video.publish)</span><input value={form.tiktok.accessToken} onChange={setField("tiktok", "accessToken")} placeholder="••••xxxx" autoComplete="off" /></label>
        <div className="sa-connector-row">
          <ConnectorToggle checked={form.tiktok.dryRun} onChange={setFlag("tiktok", "dryRun")} label="โหมดทดลอง (dry-run)" />
          <button className="sa-btn ghost sm" disabled={busy || tests.tiktok?.loading} onClick={() => runTest("tiktok")}><RefreshCw size={13} /> ทดสอบ creator info</button>
        </div>
        <ConnectorToggle checked={form.tiktok.auditApproved} onChange={setFlag("tiktok", "auditApproved")} label="ยืนยันว่า TikTok ตรวจ audit และอนุมัติแอปสำหรับ public Direct Post แล้ว (ไม่ใช่ผลจากปุ่มทดสอบ)" />
        {tests.tiktok?.message && <p className={`sa-test-msg ${tests.tiktok.ok ? "ok" : "err"}`}>{tests.tiktok.message}</p>}
        <p className="sa-form-hint">ต้องเปิด Content Posting API และขอสิทธิ์ video.publish ผ่าน OAuth ของ TikTok ก่อน · แอปนี้ยังไม่มี OAuth/refresh token ในตัว: ต้องใส่ token ที่ได้รับโดยชอบด้วยตนเองและอาจหมดอายุก่อนถึงเวลาตั้งโพสต์ · ค่าเริ่มต้น dry-run; unaudited จำกัด SELF_ONLY และข้อจำกัดการใช้ตาม TikTok · ทุกโพสต์ต้องยืนยัน privacy/สิทธิ์เสียง/การส่งก่อนรัน</p>
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
          <label className="sa-field">
            <span>ขนาดภาพปฏิทิน — กว้าง (px)</span>
            <input type="number" min="256" max="1536" step="8" value={form.settings.imageWidth} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, imageWidth: Number(e.target.value) } }))} />
          </label>
          <label className="sa-field">
            <span>ขนาดภาพปฏิทิน — สูง (px)</span>
            <input type="number" min="256" max="1536" step="8" value={form.settings.imageHeight} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, imageHeight: Number(e.target.value) } }))} />
          </label>
        </div>
        <p className="sa-form-hint">ขนาดภาพที่ขอจาก Image backend ตอนสร้างภาพปฏิทินของลูกค้านี้ — ค่าเริ่มต้น 1024×600 (แบนเนอร์) · ปัดเป็นจำนวนที่หารด้วย 8 ลงตัว ช่วง 256–1536</p>
        <label className="sa-field"><span>เขตเวลา</span><input value="Asia/Bangkok" disabled /></label>
        <ConnectorToggle checked={form.settings.notify} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, notify: v } }))} label="แจ้งเตือน macOS เมื่อเผยแพร่/ล้มเหลว (เฉพาะ Mac)" />
        <ConnectorToggle checked={form.settings.weeklySummaryLine} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, weeklySummaryLine: v } }))} label="สรุปรายสัปดาห์อัตโนมัติทาง LINE (ทุกวันจันทร์ 09:00 น.)" />
        <ConnectorToggle checked={form.settings.useProductRef} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, useProductRef: v } }))} label="ใช้รูปสินค้าจริง (ดึงจากเว็บตาม SKU) เป็น Reference ตอนสร้างภาพปฏิทิน" />
        <ConnectorToggle checked={form.settings.productRefInPost} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, productRefInPost: v } }))} label="แนบรูปสินค้าจริง (ย่อด้านยาว 500px แบบไม่แก้ไขอย่างอื่น) เป็นรูปที่ 2 ของโพสต์ Facebook — ภาพ AI เป็นรูปแรก" />
        {form.settings.useProductRef && (
          <>
            <label className="sa-field">
              <span>วิธีส่งรูปสินค้าไปให้ Image backend</span>
              <select
                value={form.settings.productRefMode}
                onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, productRefMode: e.target.value } }))}
              >
                <option value="img2img">img2img — ใช้รูปสินค้าเป็นภาพตั้งต้น (แนะนำ · สินค้าตรงที่สุด)</option>
                <option value="reference">reference_images — วิธีเดิม (backend อาจไม่ใช้รูปสินค้าจึงได้สินค้าผิด)</option>
              </select>
            </label>
            <p className="sa-form-hint">
              โหมด img2img ส่งรูปสินค้าเป็นภาพตั้งต้นให้โมเดลวาดทับ สินค้าจึงตรงกับของจริง — แต่ฉาก/พื้นหลังจะคล้ายรูปสินค้าเดิม
              {form.settings.productRefMode === "reference" && " · โหมดเดิม backend ที่แพ็กมาไม่ใช้รูปอ้างอิง (จะเห็นคำเตือนในหน้ารายการ)"}
            </p>
            {form.settings.productRefMode === "img2img" && (
              <>
                <label className="sa-field">
                  <span>Denoise ของ img2img — {Number(form.settings.productRefDenoise).toFixed(2)} (ต่ำ = สินค้าตรง แต่ฉากคล้ายรูปเดิม)</span>
                  <input
                    type="range" min="0.15" max="0.75" step="0.01"
                    value={form.settings.productRefDenoise}
                    onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, productRefDenoise: Number(e.target.value) } }))}
                  />
                </label>
                <p className="sa-form-hint">
                  backend ตัดสเต็ปตาม denoise (steps × denoise) ระบบจึงส่ง steps มากขึ้นเพื่อให้ได้สเต็ปจริงเท่าเดิม —
                  เช่น 20 สเต็ป ที่ denoise 0.38 จะส่ง 53 สเต็ป (ได้ 20 สเต็ปจริง) ภาพจึงเปลี่ยนตาม prompt มากขึ้น
                  แต่ใช้เวลาประมาณ 1/denoise เท่า (denoise 0.38 ≈ 2.6 เท่า) · สูงสุด 150 สเต็ป
                </p>
              </>
            )}
          </>
        )}
      </section>
    </Drawer>
  );
}

