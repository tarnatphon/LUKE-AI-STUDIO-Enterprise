import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, Plus, CalendarPlus, AlertTriangle, Dices } from "lucide-react";
import {
  PLATFORM_META,
  TONES,
  ANGLES,
  thaiMonthLabel,
  dayNumber,
  weekdayTh,
  postJson,
  clientIntakeIssues,
  clientIntakeSummary,
  INDUSTRY_SUGGESTIONS,
  cleanEnglishSubject,
  isValidEnglishSubject,
  suggestSku,
} from "./lib.js";

export function Modal({ title, icon, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`sa-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <header>
          <h3>{icon} {title}</h3>
          <button className="sa-icon-btn" onClick={onClose} aria-label="ปิด"><X size={16} /></button>
        </header>
        <div className="sa-modal-body">{children}</div>
        {footer && <footer className="sa-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmModal({ message, detail, confirmLabel = "ยืนยัน", onConfirm, onClose }) {
  return (
    <Modal
      title="โปรดยืนยัน"
      icon={<AlertTriangle size={17} className="sa-warn-icon" />}
      onClose={onClose}
      footer={
        <>
          <button className="sa-btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="sa-btn danger"
            onClick={async () => {
              onClose?.();
              await onConfirm?.();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="sa-confirm-text">{message}</p>
      {detail && <p className="sa-confirm-detail">{detail}</p>}
    </Modal>
  );
}

/**
 * Add a client — the one form where a vague answer costs the whole month.
 *
 * Everything a client is later planned with comes from this dialog: the product
 * name goes into every caption, and its English name goes into every image
 * prompt. "สินค้า" as a product, or a missing English name, used to be accepted
 * silently and then produced a month of posts about nothing (and prompts the
 * image model painted as an empty table). So the create button stays disabled
 * until the product is real and named in English, and the line under the button
 * says exactly which field is still missing.
 */
export function AddClientModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: "",
    industry: "",
    tone: TONES[0],
    firstProduct: "",
    imageSubject: "",
    sku: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translateNote, setTranslateNote] = useState("");
  // Which fields the operator has touched: the auto-fill never overwrites a
  // value someone typed themselves.
  const [touched, setTouched] = useState({});
  const issues = clientIntakeIssues(form);
  const issueFor = (field) => issues.find((i) => i.field === field)?.message || "";
  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setTouched((t) => ({ ...t, [key]: true }));
  };

  const proposeSubject = async () => {
    const product = form.firstProduct.trim();
    if (product.length < 3) {
      setTranslateNote("พิมพ์ชื่อสินค้าก่อน แล้วค่อยกดแปล");
      return;
    }
    setTranslating(true);
    setTranslateNote("");
    try {
      const res = await postJson("/api/social-agency/products/propose-image-subject", { name: product });
      if (res?.subject) {
        setForm((f) => ({ ...f, imageSubject: res.subject }));
        setTranslateNote(`แปลให้แล้ว: ${res.subject} — แก้ได้ถ้าไม่ตรง`);
      } else {
        setTranslateNote(res?.reason || "แปลอัตโนมัติไม่ได้ — พิมพ์ชื่อสินค้าภาษาอังกฤษเอง");
      }
    } catch (err) {
      setTranslateNote(err.message || "แปลอัตโนมัติไม่ได้ — พิมพ์ชื่อสินค้าภาษาอังกฤษเอง");
    } finally {
      setTranslating(false);
    }
  };

  // Leaving the product field fills the two fields that can be derived from it:
  // the English name (once, saved on the product) and a SKU to keep or replace.
  const onProductBlur = () => {
    const product = form.firstProduct.trim();
    if (product.length < 3) return;
    if (!form.sku.trim()) setForm((f) => ({ ...f, sku: suggestSku(product) }));
    if (!touched.imageSubject && !form.imageSubject.trim()) proposeSubject();
  };

  return (
    <Modal
      title="เพิ่มลูกค้าใหม่"
      icon={<Plus size={17} />}
      onClose={onClose}
      footer={
        <>
          <button className="sa-btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="sa-btn primary"
            disabled={busy || issues.length > 0}
            title={issues.length ? clientIntakeSummary(form) : ""}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onCreate({
                  name: form.name.trim(),
                  industry: form.industry.trim(),
                  tone: form.tone,
                  firstProduct: form.firstProduct.trim(),
                  imageSubject: cleanEnglishSubject(form.imageSubject),
                  sku: form.sku.trim() || undefined,
                  category: form.industry.trim(),
                });
                onClose();
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังสร้าง…" : "สร้างลูกค้า"}
          </button>
        </>
      }
    >
      <label className="sa-field">
        <span>ชื่อลูกค้า *</span>
        <input value={form.name} onChange={set("name")} placeholder="เช่น ครัวคุณหมูแม่บ้าน" autoFocus />
        {issueFor("name") && touched.name && <span className="sa-form-hint">{issueFor("name")}</span>}
      </label>
      <label className="sa-field">
        <span>ประเภทธุรกิจ *</span>
        <input
          value={form.industry}
          onChange={set("industry")}
          placeholder="เช่น ร้านอาหารตามสั่ง"
          list="sa-industry-suggestions"
        />
        <datalist id="sa-industry-suggestions">
          {INDUSTRY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
        </datalist>
        {issueFor("industry") && touched.industry && <span className="sa-form-hint">{issueFor("industry")}</span>}
      </label>
      <label className="sa-field">
        <span>โทนเริ่มต้น</span>
        <select value={form.tone} onChange={set("tone")}>
          {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <p className="sa-form-hint">
        สินค้าชิ้นแรกคือสิ่งที่ปฏิทินทั้งเดือน แคปชัน และพรอมป์ภาพจะอ้างถึง — ต้องเป็นชื่อสินค้าจริง ไม่ใช่คำกว้างอย่าง “สินค้า”
      </p>
      <label className="sa-field">
        <span>ชื่อสินค้าชิ้นแรก (ไทย) *</span>
        <input
          value={form.firstProduct}
          onChange={set("firstProduct")}
          onBlur={onProductBlur}
          placeholder="เช่น ผัดกะเพราหมูสับ"
        />
        {issueFor("firstProduct") && touched.firstProduct && <span className="sa-form-hint">{issueFor("firstProduct")}</span>}
      </label>
      <label className="sa-field">
        <span>ชื่อสินค้าภาษาอังกฤษ (ใช้ในพรอมป์ภาพ) *</span>
        <span className="sa-inline-field">
          <input
            value={form.imageSubject}
            onChange={set("imageSubject")}
            placeholder="เช่น stir-fried basil pork"
            aria-describedby="sa-subject-hint"
          />
          <button type="button" className="sa-btn ghost sm" disabled={translating} onClick={proposeSubject}>
            <Sparkles size={13} /> {translating ? "กำลังแปล…" : "แปลให้"}
          </button>
        </span>
        <span className="sa-form-hint" id="sa-subject-hint">
          {translateNote || "ช่องนี้คือสิ่งที่โมเดลภาพจะวาดจริง ๆ — ถ้าเว้นว่าง ระบบจะไม่ยอมสร้างภาพ"}
        </span>
        {issueFor("imageSubject") && (touched.imageSubject || touched.firstProduct) && (
          <span className="sa-form-hint">{issueFor("imageSubject")}</span>
        )}
      </label>
      <label className="sa-field">
        <span>รหัสสินค้า (SKU) *</span>
        <input value={form.sku} onChange={set("sku")} placeholder="เช่น KHM-001" />
        {issueFor("sku") && touched.sku && <span className="sa-form-hint">{issueFor("sku")}</span>}
      </label>

      {error && <p className="sa-form-error">{error}</p>}
      <p className="sa-form-hint">
        {issues.length
          ? clientIntakeSummary(form)
          : "ครบแล้ว — ลูกค้าใหม่จะเริ่มด้วยปฏิทินว่างเปล่า แล้วกด “วางแผนอัตโนมัติ” เพื่อวางแผนทั้งเดือนได้เลย"}
      </p>
    </Modal>
  );
}

export function NewEntryModal({ date, products, pillars = [], onClose, onCreate }) {
  const [form, setForm] = useState({
    date,
    time: "18:30",
    platform: "demo",
    sku: products[0]?.sku || "",
    angle: ANGLES[0],
    pillar: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Modal
      title={`เพิ่มโพสต์ — ${dayNumber(date)} ${weekdayTh(date)}`}
      icon={<CalendarPlus size={17} />}
      onClose={onClose}
      footer={
        <>
          <button className="sa-btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="sa-btn primary"
            disabled={busy || !form.sku}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onCreate(form);
                onClose();
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังเพิ่ม…" : "เพิ่มเข้าปฏิทิน"}
          </button>
        </>
      }
    >
      <div className="sa-field-row">
        <label className="sa-field">
          <span>วันที่</span>
          <input type="date" value={form.date} onChange={set("date")} />
        </label>
        <label className="sa-field">
          <span>เวลา (Asia/Bangkok)</span>
          <input type="time" value={form.time} onChange={set("time")} />
        </label>
      </div>
      <label className="sa-field">
        <span>สินค้า</span>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={form.sku} onChange={set("sku")} style={{ flex: 1 }}>
            {products.map((p) => <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>)}
          </select>
          <button
            type="button"
            className="sa-btn ghost sm"
            title="สุ่มสินค้า"
            disabled={products.length < 2}
            onClick={() => setForm((f) => ({ ...f, sku: products[Math.floor(Math.random() * products.length)].sku }))}
          >
            <Dices size={14} /> สุ่ม
          </button>
        </div>
      </label>
      <label className="sa-field">
        <span>แพลตฟอร์ม</span>
        <select value={form.platform} onChange={set("platform")}>
          {Object.entries(PLATFORM_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
      </label>
      <label className="sa-field">
        <span>มุมคอนเทนต์</span>
        <select value={form.angle} onChange={set("angle")}>
          {ANGLES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label className="sa-field">
        <span>เสาหลัก (ว่าง = อัตโนมัติ)</span>
        <select value={form.pillar} onChange={set("pillar")}>
          <option value="">— เลือกอัตโนมัติตามน้ำหนัก —</option>
          {pillars.map((p) => <option key={p.id} value={p.name}>{p.name} (×{p.weight})</option>)}
        </select>
      </label>
      {error && <p className="sa-form-error">{error}</p>}
    </Modal>
  );
}

export function AutoPlanModal({ preview, onClose, onApply }) {
  const [selected, setSelected] = useState(() => new Map((preview?.slots || []).map((s, i) => [i, true])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slots = preview?.slots || [];
  const selectedCount = useMemo(() => [...selected.values()].filter(Boolean).length, [selected]);
  const selectedDays = useMemo(() => new Set(slots.filter((_, i) => selected.get(i)).map((s) => s.date)).size, [slots, selected]);
  const toggle = (i) => setSelected((m) => new Map(m).set(i, !m.get(i)));
  const onePerDay = preview?.mode === "one-per-day";
  const planPlatforms = preview?.platforms || [];
  const productMix = useMemo(() => {
    const m = {};
    slots.forEach((s, i) => {
      if (!selected.get(i)) return;
      const k = s.productName || s.sku || "?";
      m[k] = (m[k] || 0) + 1;
    });
    const rows = Object.entries(m).map(([k, n]) => `${k}×${n}`);
    return rows.length > 6 ? `${rows.slice(0, 6).join(" ")} +${rows.length - 6} อื่น ๆ` : rows.join(" ");
  }, [slots, selected]);
  return (
    <Modal
      title={`ตัวอย่างแผนเดือน ${thaiMonthLabel(preview?.month)}`}
      icon={<Sparkles size={17} />}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="sa-muted">
            เลือกแล้ว {selectedCount}/{slots.length} ช่อง
            {onePerDay
              ? ` · ${planPlatforms.length || 1} ช่อง/วัน (${planPlatforms.map((p) => PLATFORM_META[p]?.short || p).join(" · ")}) · ครอบคลุม ${selectedDays}/${preview?.openDays ?? selectedDays} วันที่ว่าง`
              : preview?.source === "llm" ? " · วางแผนโดย LLM ในเครื่อง" : " · วางแผนด้วยแม่แบบในตัว"}
            {productMix ? ` · สินค้า: ${productMix}` : ""}
          </span>
          <div style={{ flex: 1 }} />
          <button className="sa-btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="sa-btn primary"
            disabled={busy || selectedCount === 0}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onApply(preview.month, slots.filter((_, i) => selected.get(i)));
                onClose();
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังเพิ่ม…" : `เพิ่ม ${selectedCount} รายการเข้าปฏิทิน`}
          </button>
        </>
      }
    >
      {preview?.strategy && <p className="sa-form-hint">
        แผนแพลตฟอร์ม: {preview.strategy.platformSource === "default" ? "ค่าเริ่มต้น (ข้อมูลยังไม่พอ)" : preview.strategy.platformSource}
        {` · จ-ศ ${preview.strategy.weekdayTime} / ส-อา ${preview.strategy.weekendTime}`}
        {` · เวลา: ${preview.strategy.timeSource === "default" ? "ค่าเริ่มต้น" : "อิงผลงานจริง"}`}
        {` · โพสต์ live ที่มีข้อมูล ≥48 ชม. ${preview.strategy.samples} รายการ`}
        {onePerDay && planPlatforms.length > 1 ? " · หลายช่อง/วัน เวลาจะกระจายกันไม่ให้ชนกัน" : ""}
      </p>}
      {preview?.angleMix?.length ? (
        <p className="sa-form-hint">
          <b>มุมคอนเทนต์เดือนนี้</b> ({preview.contentKindLabel || "ทั่วไป"} · {preview.angleMix.length} มุม): {preview.angleMix.map((a) => `${a.angle} ×${a.count}`).join(" · ")}
          {" — มาจากธุรกิจของลูกค้ารายนี้และเสาหลักที่ตั้งไว้ เปลี่ยนมุมที่เลือกได้ที่แถบเครื่องมือ ปฏิทินก่อนกดวางแผน"}
        </p>
      ) : null}
      {onePerDay && preview?.horizon?.days ? (
        <p className="sa-form-hint">
          <b>ช่วงที่วางแผน:</b> {preview.horizon.days} วัน ({preview.horizon.from} → {preview.horizon.to})
          {preview.productPool ? ` · สินค้าในคลัง ${preview.productPool} ชิ้น` : ""}
          {preview.cycles > 1
            ? ` · ใช้ครบทุกชิ้นแล้ววนรอบที่ ${preview.cycles} (สินค้าเดิมจะกลับมาหลังจากครบรอบ และไม่ซ้ำวันติดกัน)`
            : " · ยังไม่ต้องใช้สินค้าซ้ำ"}
        </p>
      ) : null}
      {preview?.replacePlanned ? (
        <p className="sa-form-hint">
          โหมดแทนที่แผนเดิม: รายการที่ยังไม่เริ่มรัน (สถานะ วางแผนไว้) ในช่องเดียวกันจะถูกแทนที่ด้วยแผนใหม่
          ส่วนรายการที่รันแล้ว/เผยแพร่แล้ว/อยู่ระหว่างรันจะไม่ถูกแตะ
        </p>
      ) : null}
      {onePerDay && preview?.shortBy > 0 ? (
        <p className="sa-probe-note warn">
          สินค้าในคลังมีไม่พอสำหรับ {preview.openDays} วันที่ยังว่าง — ขาดอีก {preview.shortBy} สินค้า (แต่ละวันใช้ 1 สินค้า ไม่ซ้ำกันระหว่างวัน)
          ให้ไปกด “สุ่ม 1 สินค้า/วัน” ในแท็บ สินค้า เพื่ออ่านสินค้าเพิ่มจากหน้าแคตตาล็อก
        </p>
      ) : null}
      {slots.length === 0 ? (
        <p className="sa-muted">เดือนนี้ยังไม่มีช่องว่างให้วางแผน — ทุกวันมีครบทุกแพลตฟอร์มที่เลือกแล้ว ลองเพิ่มแพลตฟอร์ม เลือก “แทนที่แผนเดิม” หรือลบบางรายการก่อนวางแผนใหม่</p>
      ) : (
        <div className="sa-autoplan-list">
          <div className="sa-autoplan-head">
            <label className="sa-check">
              <input
                type="checkbox"
                checked={selectedCount === slots.length}
                onChange={(e) => setSelected(new Map(slots.map((_, i) => [i, e.target.checked])))}
              />
              <span>เลือกทั้งหมด</span>
            </label>
          </div>
          {slots.map((slot, i) => (
            <label key={`${slot.date}-${slot.time}-${i}`} className={`sa-autoplan-row ${selected.get(i) ? "on" : ""}`}>
              <input type="checkbox" checked={Boolean(selected.get(i))} onChange={() => toggle(i)} />
              <span className="sa-autoplan-date">{dayNumber(slot.date)} {weekdayTh(slot.date)}</span>
              <span className="sa-autoplan-time">{slot.time}</span>
              <span className="sa-autoplan-product">{slot.productName}</span>
              <span className="sa-autoplan-angle">{slot.angle}</span>
              <span className={`sa-platform-chip ${PLATFORM_META[slot.platform]?.cls || "demo"}`}>{PLATFORM_META[slot.platform]?.short}</span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="sa-form-error">{error}</p>}
    </Modal>
  );
}
