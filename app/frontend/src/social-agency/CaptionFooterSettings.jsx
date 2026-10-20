import { useEffect, useState } from "react";
import { Save, MessageSquare } from "lucide-react";
import { postJson, PLATFORM_META } from "./lib.js";
import { captionFootersFor, footerLimit } from "./post-copy.js";

const PLATFORMS = ["facebook", "instagram", "line", "tiktok", "demo"];

export default function CaptionFooterSettings({ client, onChanged }) {
  const [footers, setFooters] = useState(() => captionFootersFor(client));
  const [platform, setPlatform] = useState("facebook");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Polling must not discard the operator's unsaved contact details. The parent
  // keys this component by client ID so edits cannot leak to another customer.
  useEffect(() => {
    if (!dirty) setFooters(captionFootersFor(client));
  }, [client.captionFooters, dirty]);

  const text = footers[platform] || "";
  const tooLong = text.length > footerLimit(platform);
  const update = (value) => {
    setFooters((current) => ({ ...current, [platform]: value }));
    setDirty(true);
    setSaved(false);
  };
  const save = async () => {
    if (saving || tooLong) return;
    setSaving(true);
    setError("");
    try {
      const result = await postJson(`/api/social-agency/clients/${encodeURIComponent(client.id)}`, { captionFooters: footers }, "PATCH");
      setFooters(result.client.captionFooters);
      await onChanged?.();
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sa-style-card sa-caption-footer-settings">
      <header><MessageSquare size={15} /><b>ข้อความแนะนำบริษัท / ติดต่อท้ายโพสต์</b></header>
      <p className="sa-form-hint">
        ของ <strong>{client.name}</strong> เท่านั้น · แนบอัตโนมัติก่อนแฮชแท็กในพรีวิว การคัดลอก และตอนเผยแพร่
        ไม่แก้โพสต์ที่เผยแพร่แล้ว · เว้นว่างเพื่อปิดเฉพาะแพลตฟอร์มนั้น
      </p>
      <label className="sa-field">
        <span>แพลตฟอร์มของข้อความปิดท้าย</span>
        <select value={platform} onChange={(event) => setPlatform(event.target.value)} disabled={saving}>
          {PLATFORMS.map((value) => <option key={value} value={value}>{PLATFORM_META[value].label}</option>)}
        </select>
      </label>
      <label className="sa-field">
        <span>ข้อความปิดท้าย {PLATFORM_META[platform].label}</span>
        <textarea
          rows={10}
          value={text}
          disabled={saving}
          onChange={(event) => update(event.target.value)}
          placeholder="ข้อมูลบริษัท / โทรศัพท์ / LINE / อีเมล / เว็บไซต์ของลูกค้ารายนี้"
        />
      </label>
      <p className="sa-form-hint">
        {text.length} / {footerLimit(platform)} ตัวอักษรของส่วนปิดท้าย · ใช้ข้อความธรรมดา ไม่ต้องใส่ backticks หรือลิงก์ Markdown
        · ข้อความนี้นับรวมในความยาวโพสต์ หากยาวเกินระบบจะให้ย่อเนื้อหาก่อนส่ง ไม่ตัดเบอร์โทรหรือข้อมูลติดต่อทิ้ง
      </p>
      <div className="sa-footer-settings-actions">
        <button type="button" className="sa-btn primary sm" disabled={saving || !dirty || tooLong} onClick={save}>
          <Save size={13} /> {saving ? "กำลังบันทึก…" : "บันทึกข้อความปิดท้าย"}
        </button>
        <button type="button" className="sa-btn ghost sm" disabled={saving || !text} onClick={() => update("")}>ล้างข้อความแพลตฟอร์มนี้</button>
        {saved && <span className="sa-muted" role="status">บันทึกแล้ว ✓</span>}
      </div>
      {tooLong && <p className="sa-form-error" role="alert">ข้อความปิดท้ายยาวเกินกำหนด — ย่อก่อนบันทึก</p>}
      {error && <p className="sa-form-error" role="alert">{error}</p>}
    </section>
  );
}
