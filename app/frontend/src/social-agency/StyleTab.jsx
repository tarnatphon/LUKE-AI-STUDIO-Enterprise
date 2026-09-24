import { useEffect, useMemo, useState } from "react";
import { Sparkles, Trash2, Copy, Check, Plus } from "lucide-react";
import { api, postJson, STATUS_META, PLATFORM_META, ANGLES } from "./lib.js";

const PLATFORM_ORDER = ["facebook", "instagram", "line", "demo"];

export default function StyleTab({ activeClient, refreshKey, initialEntryId }) {
  const clientId = activeClient?.id;
  const [shots, setShots] = useState([]);
  const [shotsError, setShotsError] = useState("");
  const [form, setForm] = useState({ platform: "facebook", angle: "", caption: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [pillars, setPillars] = useState([]);
  const [pillarsError, setPillarsError] = useState("");
  const [pform, setPform] = useState({ name: "", angles: [], weight: 1 });
  const [psaving, setPsaving] = useState(false);

  const [entryId, setEntryId] = useState(initialEntryId || "");
  const [captionOverride, setCaptionOverride] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const entries = useMemo(
    () =>
      [...(activeClient?.calendar || [])].sort((a, b) =>
        `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
      ),
    [activeClient]
  );

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api(`/api/social-agency/few-shots?clientId=${encodeURIComponent(clientId)}`)
      .then((data) => {
        if (cancelled) return;
        setShots(data.fewShots || []);
        setShotsError("");
      })
      .catch((err) => {
        if (!cancelled) setShotsError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api(`/api/social-agency/pillars?clientId=${encodeURIComponent(clientId)}`)
      .then((data) => {
        if (cancelled) return;
        setPillars(data.pillars || []);
        setPillarsError("");
      })
      .catch((err) => {
        if (!cancelled) setPillarsError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  const addShot = async () => {
    if (!clientId || saving) return;
    setSaving(true);
    setShotsError("");
    try {
      const data = await postJson(`/api/social-agency/few-shots?clientId=${encodeURIComponent(clientId)}`, {
        platform: form.platform,
        angle: form.angle || undefined,
        caption: form.caption,
        note: form.note || undefined,
      });
      setShots((list) => [data.fewShot, ...list]);
      setForm({ platform: "facebook", angle: "", caption: "", note: "" });
    } catch (err) {
      setShotsError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeShot = async (id) => {
    try {
      await api(`/api/social-agency/few-shots/${encodeURIComponent(id)}?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      setShots((list) => list.filter((s) => s.id !== id));
    } catch (err) {
      setShotsError(err.message);
    }
  };

  const togglePAngle = (a) => setPform((f) => ({ ...f, angles: f.angles.includes(a) ? f.angles.filter((x) => x !== a) : [...f.angles, a] }));

  const addPillar = async () => {
    if (!clientId || psaving) return;
    setPsaving(true);
    setPillarsError("");
    try {
      const data = await postJson(`/api/social-agency/pillars?clientId=${encodeURIComponent(clientId)}`, {
        name: pform.name.trim(),
        angles: pform.angles,
        weight: pform.weight,
      });
      setPillars((list) => [...list, data.pillar]);
      setPform({ name: "", angles: [], weight: 1 });
    } catch (err) {
      setPillarsError(err.message);
    } finally {
      setPsaving(false);
    }
  };

  const removePillar = async (id) => {
    try {
      await api(`/api/social-agency/pillars/${encodeURIComponent(id)}?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      setPillars((list) => list.filter((p) => p.id !== id));
    } catch (err) {
      setPillarsError(err.message);
    }
  };

  const bumpWeight = async (p, d) => {
    const w = Math.min(5, Math.max(1, (p.weight || 1) + d));
    if (w === p.weight) return;
    try {
      const data = await postJson(`/api/social-agency/pillars/${encodeURIComponent(p.id)}?clientId=${encodeURIComponent(clientId)}`, { weight: w }, "PATCH");
      setPillars((list) => list.map((x) => (x.id === p.id ? data.pillar : x)));
    } catch (err) {
      setPillarsError(err.message);
    }
  };

  const generate = async () => {
    if (!clientId || previewBusy) return;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const body = {};
      if (entryId) body.entryId = entryId;
      if (captionOverride.trim()) body.caption = captionOverride.trim();
      const data = await postJson(`/api/social-agency/platform-versions?clientId=${encodeURIComponent(clientId)}`, body);
      setPreview(data.preview);
    } catch (err) {
      setPreviewError(err.message);
      setPreview(null);
    } finally {
      setPreviewBusy(false);
    }
  };

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text || "");
      setCopied(what);
      setTimeout(() => setCopied(""), 1600);
    } catch {}
  };

  if (!clientId) return <div className="sa-style"><p className="sa-muted">ยังไม่ได้เลือกลูกค้า</p></div>;

  return (
    <div className="sa-style">
      <section className="sa-style-card">
        <header>
          <Sparkles size={15} />
          <b>เสาหลักคอนเทนต์ (Pillars)</b>
          <span className="sa-muted">{pillars.length}/8 · กระจายมุมโพสต์อัตโนมัติตามน้ำหนัก</span>
        </header>
        {pillarsError && <p className="sa-error-banner">{pillarsError}</p>}
        <div className="sa-style-form">
          <div className="sa-style-row">
            <input
              value={pform.name}
              onChange={(e) => setPform({ ...pform, name: e.target.value })}
              placeholder="ชื่อเสาใหม่ (เช่น รีวิวลูกค้า)"
            />
            <select value={pform.weight} onChange={(e) => setPform({ ...pform, weight: Number(e.target.value) })} aria-label="น้ำหนัก">
              {[1, 2, 3, 4, 5].map((w) => (
                <option key={w} value={w}>น้ำหนัก {w}</option>
              ))}
            </select>
          </div>
          <div className="sa-style-row">
            {ANGLES.map((a) => (
              <label key={a} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={pform.angles.includes(a)} onChange={() => togglePAngle(a)} /> {a}
              </label>
            ))}
          </div>
          <div>
            <button className="sa-btn primary sm" disabled={psaving || !pform.name.trim() || !pform.angles.length} onClick={addPillar}>
              <Plus size={13} /> {psaving ? "กำลังบันทึก…" : "เพิ่มเสาหลัก"}
            </button>
          </div>
        </div>
        <ul className="sa-style-shots">
          {pillars.map((p) => (
            <li key={p.id} className="sa-style-shot">
              <div className="sa-style-shot-head">
                <b>{p.name}</b>
                <span className="sa-muted">{(p.angles || []).join(" · ")}</span>
                <span style={{ flex: 1 }} />
                <button className="sa-icon-btn sm" title="ลดน้ำหนัก" onClick={() => bumpWeight(p, -1)}>−</button>
                <span className="sa-muted">×{p.weight}</span>
                <button className="sa-icon-btn sm" title="เพิ่มน้ำหนัก" onClick={() => bumpWeight(p, 1)}>+</button>
                <button className="sa-icon-btn sm danger" title="ลบเสาหลัก" onClick={() => removePillar(p.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {pillars.length === 0 && <p className="sa-muted">ยังไม่มีเสาหลัก — เพิ่ม 3-4 เสาเพื่อให้ปฏิทินกระจายมุมอัตโนมัติ</p>}
      </section>

      <section className="sa-style-card">
        <header>
          <Sparkles size={15} />
          <b>ตัวอย่างสไตล์ (Few-shot)</b>
          <span className="sa-muted">{shots.length}/20 · ใช้สอน AI ตอนเขียนแคปชัน</span>
        </header>
        {shotsError && <p className="sa-error-banner">{shotsError}</p>}
        <div className="sa-style-form">
          <div className="sa-style-row">
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} aria-label="แพลตฟอร์มตัวอย่าง">
              {Object.entries(PLATFORM_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
            <select value={form.angle} onChange={(e) => setForm({ ...form, angle: e.target.value })} aria-label="มุมคอนเทนต์ (ถ้ามี)">
              <option value="">ทุกมุม</option>
              {ANGLES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="โน้ตสั้น ๆ (เช่น โพสต์ที่ขายดี)"
            />
          </div>
          <textarea
            value={form.caption}
            onChange={(e) => setForm({ ...form, caption: e.target.value })}
            placeholder="วางแคปชันตัวอย่างที่เขียนดี / สไตล์ที่อยากให้ AI เลียนแบบ (อย่างน้อย 20 ตัวอักษร)…"
            rows={4}
          />
          <div>
            <button className="sa-btn primary sm" disabled={saving || form.caption.trim().length < 20} onClick={addShot}>
              <Plus size={13} /> {saving ? "กำลังบันทึก…" : "บันทึกตัวอย่าง"}
            </button>
          </div>
        </div>
        <ul className="sa-style-shots">
          {shots.map((s) => {
            const pf = PLATFORM_META[s.platform] || PLATFORM_META.demo;
            return (
              <li key={s.id} className="sa-style-shot">
                <div className="sa-style-shot-head">
                  <span className={`sa-platform-chip ${pf.cls}`}>{pf.short}</span>
                  {s.angle && <span className="sa-muted">{s.angle}</span>}
                  {s.note && <span className="sa-style-note">{s.note}</span>}
                  <span style={{ flex: 1 }} />
                  <button className="sa-icon-btn sm danger" title="ลบตัวอย่าง" onClick={() => removeShot(s.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <p>{s.caption}</p>
              </li>
            );
          })}
        </ul>
        {shots.length === 0 && <p className="sa-muted">ยังไม่มีตัวอย่าง — เพิ่ม 2-3 ชิ้นเพื่อให้ AI เขียนได้ตรงสไตล์แบรนด์มากขึ้น</p>}
      </section>

      <section className="sa-style-card">
        <header>
          <Copy size={15} />
          <b>ฉบับต่อแพลตฟอร์ม</b>
          <span className="sa-muted">Facebook / IG / LINE / Demo</span>
        </header>
        {previewError && <p className="sa-error-banner">{previewError}</p>}
        <div className="sa-style-form">
          <select value={entryId} onChange={(e) => setEntryId(e.target.value)} aria-label="เลือกรายการในปฏิทิน">
            <option value="">— เขียนจากแคปชันด้านล่าง —</option>
            {entries.map((e) => {
              const meta = STATUS_META[e.status] || { label: e.status };
              const pf = PLATFORM_META[e.platform] || PLATFORM_META.demo;
              return (
                <option key={e.id} value={e.id}>
                  {e.date} {e.time} · {pf.label} · {e.productName} · {meta.label}
                </option>
              );
            })}
          </select>
          <textarea
            value={captionOverride}
            onChange={(e) => setCaptionOverride(e.target.value)}
            placeholder="วางแคปชันต้นฉบับตรงนี้ (ถ้าไม่เลือกจากปฏิทิน)…"
            rows={3}
          />
          <div>
            <button className="sa-btn primary sm" disabled={previewBusy} onClick={generate}>
              <Sparkles size={13} /> {previewBusy ? "กำลังสร้าง…" : "สร้างฉบับ 4 แพลตฟอร์ม"}
            </button>
          </div>
        </div>
        {preview && (
          <div className="sa-style-versions">
            {PLATFORM_ORDER.map((platform) => {
              const pf = PLATFORM_META[platform];
              const text = preview.versions?.[platform] || "";
              const meta = preview.meta?.[platform] || {};
              return (
                <div key={platform} className="sa-style-version">
                  <div className="sa-style-shot-head">
                    <span className={`sa-platform-chip ${pf.cls}`}>{pf.short}</span>
                    <b>{pf.label}</b>
                    <span className="sa-muted">{meta.chars} ตัวอักษร{meta.truncated ? " · ตัดทอนแล้ว" : ""} · #{meta.hashtags}</span>
                    <span style={{ flex: 1 }} />
                    <button className="sa-icon-btn sm" title={`คัดลอกฉบับ ${pf.label}`} onClick={() => copy(text, platform)}>
                      {copied === platform ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  <p>{text}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
