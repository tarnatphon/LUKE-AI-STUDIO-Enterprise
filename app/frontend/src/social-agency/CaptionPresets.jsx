import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Check, RotateCcw, Eye } from "lucide-react";
import PostPreview from "./PostPreview.jsx";
import { api, postJson, PLATFORM_META } from "./lib.js";

// Ready-made caption examples (ตัวอย่างสำเร็จรูป).
//
// The few-shot library in "สไตล์ & ฉบับ" keeps text the client wrote; these
// three are complete first drafts the runtime fills with this entry's own
// product evidence. Each one previews with the post's own image and the real
// per-platform layout, the text stays editable, and applying one replaces the
// caption and nothing else — no image, no date, no time, no status, and no
// publish. When the entry has no post media yet the preview falls back to the
// product photo and says so instead of pretending it is the post image.
export default function CaptionPresets({ entry, client, product, busy, onApplied }) {
  const clientId = client?.id;
  const entryId = entry?.id;
  const platform = entry?.platform || "demo";
  const [data, setData] = useState(null);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [appliedId, setAppliedId] = useState("");

  const load = useCallback(async () => {
    if (!clientId || !entryId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api(
        `/api/social-agency/caption-presets?clientId=${encodeURIComponent(clientId)}&entryId=${encodeURIComponent(entryId)}`
      );
      setData(res);
      setActiveId((current) =>
        (res.drafts || []).some((item) => item.id === current) ? current : res.drafts?.[0]?.id || ""
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [clientId, entryId]);

  // Reload when the entry (or its platform) changes, not on every state poll —
  // the drafts follow the platform's caption rules.
  useEffect(() => { load(); }, [load, platform]);
  useEffect(() => { setAppliedId(""); }, [entryId]);

  const active = useMemo(
    () => (data?.drafts || []).find((item) => item.id === activeId) || null,
    [data, activeId]
  );
  // The textarea starts from the server draft; "ย้อนกลับ" puts it back.
  useEffect(() => { if (active) setDraft(active.text); }, [active?.id, active?.text]);

  const editable = Boolean(data?.editable);
  const limit = active?.limit || data?.limit || 0;
  const tooLong = limit > 0 && draft.length > limit;
  const unchanged = draft.trim() === String(entry?.caption || "").trim();
  const hasPostMedia = Boolean(
    entry?.video?.url || entry?.video?.publicUrl || entry?.image?.url || entry?.image?.publicUrl
  );
  const productFallback = !hasPostMedia && Boolean(product?.image);

  const apply = async () => {
    if (!active || saving || !editable) return;
    setSaving(true);
    setError("");
    try {
      const res = await postJson("/api/social-agency/entry-caption/preset", {
        entryId,
        presetId: active.id,
        caption: draft,
      });
      setAppliedId(active.id);
      await onApplied?.(res.entry);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sa-drawer-section sa-caption-presets">
      <div className="sa-post-preview-section-head">
        <h4><Sparkles size={15} /> ตัวอย่างสำเร็จรูป {data?.drafts?.length ? `(${data.drafts.length} แบบ)` : ""}</h4>
        <button className="sa-btn ghost sm" disabled={loading} onClick={load}>
          <RotateCcw size={13} /> {loading ? "กำลังโหลด…" : "ดึงข้อความตัวอย่างใหม่"}
        </button>
      </div>
      <p className="sa-form-hint">
        เลือกตัวอย่าง แก้ข้อความให้เข้ากับโพสต์นี้ แล้วกดใช้ · การใช้ตัวอย่าง<strong>แทนที่เฉพาะแคปชัน</strong>ของรายการนี้
        ไม่เปลี่ยนรูป วัน เวลา หรือสถานะ และ<strong>ไม่เผยแพร่ทันที</strong> (ยังต้องกดรัน/อนุมัติตามปกติ)
      </p>

      {data && !editable && (
        <p className="sa-warn-banner" role="status">⚠️ รายการนี้ใช้ตัวอย่างไม่ได้: {data.reason}</p>
      )}

      {data?.drafts?.length ? (
        <div className="sa-preset-tabs" role="tablist" aria-label="ตัวอย่างแคปชันสำเร็จรูป">
          {data.drafts.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === activeId}
              className={`sa-preset-tab${item.id === activeId ? " active" : ""}`}
              onClick={() => setActiveId(item.id)}
              disabled={loading}
            >
              <b>{item.label}</b>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      {active && (
        <>
          <PostPreview entry={entry} client={client} product={product} caption={draft} />
          {productFallback && (
            <p className="sa-form-hint" role="status">
              <Eye size={12} /> ยังไม่มีภาพ/วิดีโอของโพสต์นี้ — พรีวิว (และตัวอย่างนี้) ใช้<strong>รูปสินค้าต้นฉบับ</strong>
              เป็นภาพอ้างอิงเท่านั้น ระบบจะไม่ส่งรูปนี้แทนสื่อโพสต์
            </p>
          )}
          <label className="sa-field">
            <span>ข้อความตัวอย่าง — แก้ได้ก่อนใช้</span>
            <textarea
              rows={7}
              value={draft}
              disabled={!editable || loading}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="ข้อความตัวอย่างแคปชัน"
            />
          </label>
          <div className="sa-preset-actions">
            <span className="sa-muted">
              {draft.length.toLocaleString()} ตัวอักษร{limit ? ` / ${limit} ของ ${PLATFORM_META[platform]?.label || platform}` : ""}
            </span>
            <button className="sa-btn ghost sm" disabled={!active || loading || draft === active.text} onClick={() => setDraft(active.text)}>
              ย้อนกลับเป็นข้อความตัวอย่าง
            </button>
            <button
              className="sa-btn primary sm"
              disabled={!editable || saving || busy || !draft.trim() || tooLong || unchanged}
              title={unchanged ? "ข้อความนี้เป็นแคปชันของรายการอยู่แล้ว" : ""}
              onClick={apply}
            >
              <Check size={13} /> {saving ? "กำลังใช้…" : "ใช้ตัวอย่างนี้เป็นแคปชัน"}
            </button>
          </div>
          {appliedId === active.id && (
            <p className="sa-form-hint" role="status">ใช้ตัวอย่างแล้ว ✓ — แคปชันของรายการนี้ถูกแทนที่แล้ว และยังไม่ถูกเผยแพร่</p>
          )}
          {tooLong && (
            <p className="sa-form-error" role="alert">
              ข้อความยาว {draft.length} ตัวอักษร เกินสำหรับ {PLATFORM_META[platform]?.label || platform} (ไม่เกิน {limit}) — ย่อก่อนใช้
            </p>
          )}
        </>
      )}

      {loading && !data && <p className="sa-muted">⏳ กำลังโหลดตัวอย่าง…</p>}
      {error && <p className="sa-form-error" role="alert">{error}</p>}
    </section>
  );
}
