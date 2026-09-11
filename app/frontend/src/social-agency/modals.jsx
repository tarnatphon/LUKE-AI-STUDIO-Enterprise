import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, Plus, CalendarPlus, AlertTriangle } from "lucide-react";
import { PLATFORM_META, TONES, ANGLES, thaiMonthLabel, dayNumber, weekdayTh } from "./lib.js";

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

export function AddClientModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: "", industry: "", tone: TONES[0], firstProduct: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
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
            disabled={busy || !form.name.trim()}
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
            {busy ? "กำลังสร้าง…" : "สร้างลูกค้า"}
          </button>
        </>
      }
    >
      <label className="sa-field">
        <span>ชื่อลูกค้า *</span>
        <input value={form.name} onChange={set("name")} placeholder="เช่น ครัวคุณหมูแม่บ้าน" autoFocus />
      </label>
      <label className="sa-field">
        <span>ประเภทธุรกิจ</span>
        <input value={form.industry} onChange={set("industry")} placeholder="เช่น ร้านอาหารตามสั่ง" />
      </label>
      <label className="sa-field">
        <span>โทนเริ่มต้น</span>
        <select value={form.tone} onChange={set("tone")}>
          {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="sa-field">
        <span>สินค้าชิ้นแรก (ไม่บังคับ)</span>
        <input value={form.firstProduct} onChange={set("firstProduct")} placeholder="เช่น ผัดกะเพราหมูสับ" />
      </label>
      {error && <p className="sa-form-error">{error}</p>}
      <p className="sa-form-hint">ลูกค้าใหม่จะเริ่มด้วยปฏิทินว่างเปล่า แล้วกด "วางแผนอัตโนมัติ" เพื่อวางแผนทั้งเดือนได้เลย</p>
    </Modal>
  );
}

export function NewEntryModal({ date, products, onClose, onCreate }) {
  const [form, setForm] = useState({
    date,
    time: "18:30",
    platform: "demo",
    sku: products[0]?.sku || "",
    angle: ANGLES[0],
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
        <select value={form.sku} onChange={set("sku")}>
          {products.map((p) => <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>)}
        </select>
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
  const toggle = (i) => setSelected((m) => new Map(m).set(i, !m.get(i)));
  return (
    <Modal
      title={`ตัวอย่างแผนเดือน ${thaiMonthLabel(preview?.month)}`}
      icon={<Sparkles size={17} />}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="sa-muted">เลือกแล้ว {selectedCount}/{slots.length} ช่อง · {preview?.source === "llm" ? "วางแผนโดย LLM ในเครื่อง" : "วางแผนด้วยแม่แบบในตัว"}</span>
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
      {slots.length === 0 ? (
        <p className="sa-muted">เดือนนี้ไม่มีช่องว่างเหลือ หรือยังไม่มีสินค้าให้วางแผน</p>
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
