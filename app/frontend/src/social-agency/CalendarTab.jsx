import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Plus, CalendarDays, Clock, Search, X, Trash2, ListChecks, Eye } from "lucide-react";
import {
  STATUS_META, PLATFORM_META, monthMatrix, thaiMonthLabel, shiftMonth, dayNumber,
  bangkokToday, currentMonth, entriesOfMonth,
} from "./lib.js";
import { NewEntryModal, AutoPlanModal } from "./modals.jsx";

const WEEKDAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

function Chip({ entry, onOpen, onDragStart, onDelete, onToggle, selectMode, selected }) {
  const meta = STATUS_META[entry.status] || { label: entry.status, cls: "" };
  const platform = PLATFORM_META[entry.platform] || PLATFORM_META.demo;
  // An eye on the card means there is something to look at before approving:
  // the entry already carries a caption and/or prepared media, and opening it
  // lands on the full post preview (it sits at the top of the details).
  const previewable = Boolean(entry.caption || entry.publishedCaption || entry.image?.url || entry.video?.url);
  return (
    <button
      className={`sa-chip ${meta.cls} ${entry.inFlight ? "running" : ""}${selected ? " selected" : ""}`}
      draggable={!entry.inFlight && !selectMode}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/sa-entry", entry.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => (selectMode && onToggle ? onToggle(entry.id) : onOpen(entry.id))}
      title={`${entry.time} · ${platform.label} · ${meta.label} · ${entry.productName} · ${entry.pillar || "—"}${previewable ? " · มีพรีวิวให้ตรวจก่อนอนุมัติ" : ""}`}
    >
      <span className="sa-chip-time">{entry.time}</span>
      {previewable && (
        <span className="sa-chip-eye" aria-hidden="true" title="เปิดดูพรีวิวภาพและข้อความก่อนอนุมัติ">
          <Eye size={11} />
        </span>
      )}
      <span className={`sa-platform-chip ${platform.cls}`}>{platform.short}</span>
      <span className="sa-chip-status">{meta.label}</span>
      {(entry.tags?.length || 0) > 0 && (
        <span className="sa-chip-tags">
          {entry.tags.slice(0, 3).map((t) => <span key={t} className="sa-tag mini">{t}</span>)}
          {entry.tags.length > 3 && <span className="sa-tag mini more">+{entry.tags.length - 3}</span>}
        </span>
      )}
      {!selectMode && onDelete && (
        <span
          className="sa-chip-del"
          role="button"
          aria-label="ลบรายการนี้"
          title="ลบรายการนี้"
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
        >
          ×
        </span>
      )}
    </button>
  );
}

export default function CalendarTab({ state, activeClient, busy, onOpenEntry, onRunNow, onReschedule, onDeleteEntry, onCreateEntry, onAutoPlan, onApplyPlan, onDeleteEntriesBatch }) {
  const [month, setMonth] = useState(currentMonth());
  const [newEntryDate, setNewEntryDate] = useState(null);
  const [planPreview, setPlanPreview] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  // P5w: 1 สินค้า/วัน ไม่ซ้ำระหว่างวัน — fanned out to every selected platform
  // so one day can carry Facebook + Instagram + LINE + web posts side by side.
  const [planPlatforms, setPlanPlatforms] = useState(() => new Set(["facebook", "instagram", "line", "demo"]));
  const [onePerDay, setOnePerDay] = useState(true);
  const [replacePlanned, setReplacePlanned] = useState(false); // วางแผนซ้ำได้เรื่อย ๆ
  // มุมคอนเทนต์ของเดือนนี้ — มาจากธุรกิจของลูกค้ารายนี้ (เสาหลัก/ประเภทธุรกิจ)
  // ไม่ใช่ชุดของโรงงานกระเป๋าโดยปริยาย · ไม่ติ๊กเลย = ใช้ทุกมุมของลูกค้ารายนี้
  const clientAngles = useMemo(
    () => (activeClient?.planAngles?.length ? activeClient.planAngles : activeClient?.contentAngles || []),
    [activeClient]
  );
  const [planAngles, setPlanAngles] = useState(() => new Set());
  useEffect(() => {
    setPlanAngles(new Set(clientAngles));
  }, [clientAngles]);
  const [dragOver, setDragOver] = useState(null);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [query, setQuery] = useState("");
  const today = bangkokToday();
  const weeks = useMemo(() => monthMatrix(month), [month]);
  const monthEntries = useMemo(() => entriesOfMonth(activeClient?.calendar || [], month), [activeClient, month]);
  const allTags = useMemo(
    () => [...new Set(monthEntries.flatMap((e) => e.tags || []))].sort((a, b) => a.localeCompare(b, "th")),
    [monthEntries]
  );
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return monthEntries.filter((entry) => {
      if (statusFilter !== "all" && entry.status !== statusFilter) return false;
      if (platformFilter !== "all" && entry.platform !== platformFilter) return false;
      if (tagFilter !== "all" && !(entry.tags || []).includes(tagFilter)) return false;
      if (needle) {
        const hay = [entry.productName, entry.angle, entry.caption, entry.brief, entry.pillar, entry.id, entry.sku, ...(entry.tags || [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [monthEntries, statusFilter, platformFilter, tagFilter, query]);
  const byDate = useMemo(() => {
    const map = new Map();
    for (const entry of filteredEntries) {
      const list = map.get(entry.date) || [];
      list.push(entry);
      map.set(entry.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
  }, [filteredEntries]);
  const filtering = statusFilter !== "all" || platformFilter !== "all" || tagFilter !== "all" || query.trim() !== "";

  const deleteVisible = () => {
    const ids = filteredEntries.map((e) => e.id);
    if (!ids.length || busy) return;
    if (!window.confirm(`ลบ ${ids.length} รายการที่เห็นอยู่ตอนนี้หรือไม่?\n(ใช้ฟิลเตอร์กรองก่อนได้ · ข้ามรายการที่กำลังรัน)`)) return;
    onDeleteEntriesBatch(ids);
  };

  const [selectMode, setSelectMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());

  const toggleChipSel = (id) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelectedCal = () => {
    const ids = [...sel];
    if (!ids.length || busy) return;
    if (!window.confirm(`ลบ ${ids.length} รายการที่เลือกหรือไม่?`)) return;
    setSel(new Set());
    setSelectMode(false);
    onDeleteEntriesBatch?.(ids);
  };

  const startAutoPlan = async () => {
    setPlanBusy(true);
    setError("");
    try {
      const preview = await onAutoPlan(month, activeClient?.settings?.postsPerWeek || 5, {
        onePerDay,
        platforms: ["facebook", "instagram", "line", "demo"].filter((p) => planPlatforms.has(p)),
        angles: [...planAngles],
        replacePlanned,
      });
      setPlanPreview(preview);
    } catch (err) {
      setError(err.message);
    } finally {
      setPlanBusy(false);
    }
  };

  return (
    <div className={`sa-calendar${selectMode ? " selecting" : ""}`}>
      <div className="sa-calendar-toolbar">
        <div className="sa-month-nav">
          <button className="sa-icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="เดือนก่อน"><ChevronLeft size={16} /></button>
          <button className="sa-icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="เดือนถัดไป"><ChevronRight size={16} /></button>
          <b className="sa-month-label">{thaiMonthLabel(month)}</b>
          {month !== currentMonth() && (
            <button className="sa-btn ghost sm" onClick={() => setMonth(currentMonth())}>
              <CalendarDays size={13} /> วันนี้
            </button>
          )}
        </div>
        <div className="sa-legend">
          {["planned", "in_workflow", "publishing", "published", "needs_review", "failed", "missed"].map((s) => (
            <span key={s} className="sa-legend-item"><span className={`sa-legend-dot ${STATUS_META[s].cls}`} />{STATUS_META[s].label}</span>
          ))}
        </div>
        <div className="sa-toolbar-right">
          <span className="sa-tz"><Clock size={12} /> Asia/Bangkok</span>
          <span className="sa-plan-platforms" title="เลือกแพลตฟอร์มที่จะโพสต์ในแต่ละวัน — เลือกได้หลายอัน วันเดียวโพสต์ได้ทั้ง Facebook, Instagram, LINE และเว็บ">
            แพลตฟอร์ม/วัน:
            {["facebook", "instagram", "line", "demo"].map((p) => (
              <label key={p} className={`sa-check sa-plan-platform ${PLATFORM_META[p].cls}${planPlatforms.has(p) ? " on" : ""}`}>
                <input
                  type="checkbox"
                  checked={planPlatforms.has(p)}
                  onChange={(e) => setPlanPlatforms((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(p);
                    else next.delete(p);
                    return next;
                  })}
                />
                <span>{PLATFORM_META[p].label}</span>
              </label>
            ))}
          </span>
          {clientAngles.length > 0 && (
            <span
              className="sa-plan-angles"
              title={`มุมคอนเทนต์ที่ใช้วางแผนเดือนนี้ — ตั้งต้นจากธุรกิจของลูกค้ารายนี้ (${activeClient?.contentKindLabel || "ทั่วไป"}) และเสาหลักที่ตั้งไว้ · ไม่เลือกเลย = ใช้ทุกมุมของลูกค้ารายนี้`}
            >
              มุมคอนเทนต์:
              {clientAngles.map((a) => (
                <label key={a} className={`sa-check sa-plan-angle${planAngles.has(a) ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={planAngles.has(a)}
                    onChange={(e) => setPlanAngles((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(a);
                      else next.delete(a);
                      return next;
                    })}
                  />
                  <span>{a}</span>
                </label>
              ))}
            </span>
          )}
          <label className="sa-check" title="เติมโพสต์ทุกวันที่ยังว่าง · แต่ละวันใช้สินค้าเดียวกันทุกแพลตฟอร์ม และสินค้าไม่ซ้ำกันระหว่างวัน">
            <input type="checkbox" checked={onePerDay} onChange={(e) => setOnePerDay(e.target.checked)} />
            <span>ทุกวัน</span>
          </label>
          <label className="sa-check" title="กดวางแผนซ้ำได้เรื่อย ๆ — แทนที่เฉพาะรายการที่ยังไม่เริ่มรัน (สถานะ วางแผนไว้) ในช่องเดียวกัน รายการที่รันแล้ว/เผยแพร่แล้วจะไม่ถูกแตะ">
            <input type="checkbox" checked={replacePlanned} onChange={(e) => setReplacePlanned(e.target.checked)} />
            <span>แทนที่แผนเดิม</span>
          </label>
          <button
            className="sa-btn primary"
            disabled={planBusy || busy || !(activeClient?.products || []).length || !planPlatforms.size}
            onClick={startAutoPlan}
            title="กดกี่ครั้งก็ได้ในหนึ่งเดือน — ระบบจะเติมเฉพาะช่องที่ยังว่าง หรือเลือก “แทนที่แผนเดิม” เพื่อวางแผนใหม่ทับรายการที่ยังไม่เริ่มรัน"
          >
            <Sparkles size={14} /> {planBusy ? "กำลังวางแผน…" : "วางแผนอัตโนมัติทั้งเดือน"}
          </button>
        </div>
      </div>

      {error && <p className="sa-error-banner">{error}</p>}

      <div className="sa-filterbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="กรองตามสถานะ">
          <option value="all">ทุกสถานะ</option>
          {Object.entries(STATUS_META).map(([value, meta]) => (
            <option key={value} value={value}>{meta.label}</option>
          ))}
        </select>
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} aria-label="กรองตามแพลตฟอร์ม">
          <option value="all">ทุกแพลตฟอร์ม</option>
          {Object.entries(PLATFORM_META).map(([value, meta]) => (
            <option key={value} value={value}>{meta.label}</option>
          ))}
        </select>
        {allTags.length > 0 && (
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="กรองตามป้าย">
            <option value="all">ทุกป้าย</option>
            {allTags.map((t) => (
              <option key={t} value={t}>ป้าย: {t}</option>
            ))}
          </select>
        )}
        <span className="sa-searchbox">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา สินค้า/มุม/แคปชัน…"
            aria-label="ค้นหารายการในปฏิทิน"
          />
          {query && (
            <button className="sa-icon-btn sm" onClick={() => setQuery("")} aria-label="ล้างคำค้น">
              <X size={12} />
            </button>
          )}
        </span>
        {filtering && (
          <span className="sa-muted">
            แสดง {filteredEntries.length} จาก {monthEntries.length} รายการ
            <button className="sa-btn ghost sm" onClick={() => { setStatusFilter("all"); setPlatformFilter("all"); setTagFilter("all"); setQuery(""); }}>
              ล้างฟิลเตอร์
            </button>
          </span>
        )}
        <button
          className="sa-btn ghost sm danger"
          disabled={busy || !filteredEntries.length}
          onClick={deleteVisible}
          title="ลบรายการที่เห็นอยู่ตอนนี้ทั้งหมด (ใช้ฟิลเตอร์กรองก่อนได้)"
        >
          <Trash2 size={13} /> ลบที่เห็น ({filteredEntries.length})
        </button>
        {selectMode ? (
          <>
            <button className="sa-btn ghost sm danger" disabled={busy || !sel.size} onClick={deleteSelectedCal}>
              <Trash2 size={13} /> ลบที่เลือก ({sel.size})
            </button>
            <button className="sa-btn ghost sm" onClick={() => { setSel(new Set()); setSelectMode(false); }}>
              ยกเลิก
            </button>
            <span className="sa-muted">จิ้มชิพเพื่อเลือก ({sel.size})</span>
          </>
        ) : (
          <button className="sa-btn ghost sm" onClick={() => setSelectMode(true)} title="เข้าโหมดเลือกหลายรายการเพื่อลบ">
            <ListChecks size={13} /> เลือกลบ
          </button>
        )}
      </div>

      <div className="sa-grid">
        <div className="sa-grid-head">
          {WEEKDAYS.map((d, i) => <div key={d} className={i >= 5 ? "weekend" : ""}>{d}</div>)}
        </div>
        <div className="sa-grid-body">
          {weeks.flat().map((date, i) => {
            const entries = date ? byDate.get(date) || [] : null;
            const isToday = date === today;
            return (
              <div
                key={date || `empty-${i}`}
                className={`sa-day ${date ? "" : "empty"} ${isToday ? "today" : ""} ${dragOver === date ? "dragover" : ""}`}
                onDragOver={(e) => {
                  if (!date) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={() => date && setDragOver(date)}
                onDragLeave={() => setDragOver((d) => (d === date ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  if (!date) return;
                  const entryId = e.dataTransfer.getData("text/sa-entry");
                  if (entryId) onReschedule(entryId, date, null);
                }}
              >
                {date && (
                  <>
                    <div className="sa-day-head">
                      <span className={`sa-day-num ${isToday ? "today" : ""}`}>{dayNumber(date)}</span>
                      <button
                        className="sa-day-add"
                        aria-label="เพิ่มโพสต์"
                        onClick={() => setNewEntryDate(date)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="sa-day-chips">
                      {entries.map((entry) => (
                        <Chip key={entry.id} entry={entry} onOpen={onOpenEntry} onDelete={onDeleteEntry} onToggle={toggleChipSel} selectMode={selectMode} selected={sel.has(entry.id)} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {newEntryDate && (
        <NewEntryModal
          date={newEntryDate}
          products={activeClient?.products || []}
          pillars={activeClient?.pillars || []}
          onClose={() => setNewEntryDate(null)}
          onCreate={async (form) => {
            await onCreateEntry({ ...form, clientId: activeClient.id });
          }}
        />
      )}
      {planPreview && (
        <AutoPlanModal
          preview={planPreview}
          onClose={() => setPlanPreview(null)}
          onApply={(m, slots) => onApplyPlan(activeClient.id, m, slots, {
            ...(planPreview?.mode === "one-per-day" ? { enforceUniqueProducts: true } : {}),
            ...(planPreview?.replacePlanned ? { replacePlanned: true } : {}),
          })}
        />
      )}
    </div>
  );
}
