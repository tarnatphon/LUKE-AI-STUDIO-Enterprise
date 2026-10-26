import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, ChevronDown, Sparkles, Plus, CalendarDays, Clock, Search, X, Trash2,
  ListChecks, Eye, SlidersHorizontal, Filter, GripVertical,
} from "lucide-react";
import {
  STATUS_META, PLATFORM_META, monthMatrix, thaiMonthLabel, shiftMonth, dayNumber,
  bangkokToday, currentMonth, entriesOfMonth,
} from "./lib.js";
import { NewEntryModal, AutoPlanModal } from "./modals.jsx";

const WEEKDAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const PLAN_PLATFORMS = ["facebook", "instagram", "line", "demo"];
// The statuses an operator actually scans for, in the order they matter: what
// needs a decision first, then what is live, then what is only planned.
const SUMMARY_STATUSES = ["needs_review", "failed", "publishing", "in_workflow", "published", "planned", "missed"];

function Chip({ entry, onOpen, onDelete, onToggle, selectMode, selected }) {
  const meta = STATUS_META[entry.status] || { label: entry.status, cls: "" };
  const platform = PLATFORM_META[entry.platform] || PLATFORM_META.demo;
  const productTitle = entry.productName || entry.angle || entry.sku || "โพสต์";
  const detail = `${entry.time} · ${platform.label} · ${meta.label} · ${productTitle} · ${entry.angle || "—"} · ${entry.pillar || "—"}`;
  // An eye on the card means there is something to look at before approving:
  // the entry already carries a caption and/or prepared media, and opening it
  // lands on the full post preview (it sits at the top of the details).
  const previewable = Boolean(entry.caption || entry.publishedCaption || entry.image?.url || entry.video?.url);
  // Second line: the angle/pillar the post belongs to, unless it already is the
  // title (a product-less entry falls back to its angle).
  const context = [entry.angle && entry.angle !== productTitle ? entry.angle : "", entry.pillar || ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={`sa-chip ${meta.cls} ${entry.inFlight ? "running" : ""}${selected ? " selected" : ""}`}
      data-entry-id={entry.id}
      draggable={!entry.inFlight && !selectMode}
      data-platform={platform.cls}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/sa-entry", entry.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={`${detail}${previewable ? " · มีพรีวิวให้ตรวจก่อนอนุมัติ" : ""}${entry.tags?.length ? ` · ป้าย: ${entry.tags.join(", ")}` : ""}`}
    >
      <button
        type="button"
        className="sa-chip-open"
        onClick={() => (selectMode && onToggle ? onToggle(entry.id) : onOpen(entry.id))}
        aria-label={`${selectMode ? "เลือกโพสต์" : "เปิดโพสต์"} ${detail}`}
        aria-pressed={selectMode ? selected : undefined}
      >
        <span className="sa-chip-meta">
          <span className="sa-chip-time">{entry.time}</span>
          <span className={`sa-platform-chip ${platform.cls}`} title={platform.label}>{platform.short}</span>
          {previewable && (
            <span className="sa-chip-eye" aria-hidden="true" title="เปิดดูพรีวิวภาพและข้อความก่อนอนุมัติ">
              <Eye size={11} />
            </span>
          )}
          {entry.inFlight && (
            <span className="sa-chip-live" title="กำลังทำงานอยู่">รัน</span>
          )}
        </span>
        <span className="sa-chip-title">{productTitle}</span>
        {context && <span className="sa-chip-context">{context}</span>}
        {(entry.tags?.length || 0) > 0 && (
          <span className="sa-chip-tags">
            {entry.tags.slice(0, 3).map((t) => <span key={t} className="sa-tag mini">{t}</span>)}
            {entry.tags.length > 3 && <span className="sa-tag mini more">+{entry.tags.length - 3}</span>}
          </span>
        )}
      </button>
      {!selectMode && onDelete && (
        <button
          type="button"
          className="sa-chip-del"
          aria-label={`ลบโพสต์ ${entry.time} · ${platform.label} · ${productTitle}`}
          title="ลบรายการนี้"
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
        >
          ×
        </button>
      )}
    </div>
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
  // ตัวเลือกการวางแผนถูกพับเก็บไว้เป็นค่าเริ่มต้น — หน้าปฏิทินจึงเหลือแค่
  // เดือน + สรุปสถานะ + ตาราง แต่ยังเห็นค่าที่ใช้อยู่ได้จากบรรทัดสรุป
  const [plannerOpen, setPlannerOpen] = useState(false);
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const today = bangkokToday();
  const weeks = useMemo(() => monthMatrix(month), [month]);
  const monthEntries = useMemo(() => entriesOfMonth(activeClient?.calendar || [], month), [activeClient, month]);
  const allTags = useMemo(
    () => [...new Set(monthEntries.flatMap((e) => e.tags || []))].sort((a, b) => a.localeCompare(b, "th")),
    [monthEntries]
  );
  const statusCounts = useMemo(() => {
    const counts = {};
    for (const entry of monthEntries) counts[entry.status] = (counts[entry.status] || 0) + 1;
    return counts;
  }, [monthEntries]);
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
  const activeFilterCount = [statusFilter !== "all", platformFilter !== "all", tagFilter !== "all", query.trim() !== ""]
    .filter(Boolean).length;
  const filtering = activeFilterCount > 0;
  const clearFilters = () => {
    setStatusFilter("all");
    setPlatformFilter("all");
    setTagFilter("all");
    setQuery("");
  };

  const gridRef = useRef(null);
  const [wantToday, setWantToday] = useState(false);
  useEffect(() => {
    if (!wantToday) return;
    const cell = gridRef.current?.querySelector?.(`.sa-day[data-date="${today}"]`);
    if (cell?.scrollIntoView) cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    setWantToday(false);
  }, [wantToday, month, today]);

  const toggleSetValue = (setter, value) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });

  const summaryText = [
    PLAN_PLATFORMS.filter((p) => planPlatforms.has(p)).map((p) => PLATFORM_META[p].label).join(" · ") || "ยังไม่เลือกแพลตฟอร์ม",
    onePerDay ? "ทุกวัน" : "เฉพาะวันที่ว่าง",
    planAngles.size ? `${planAngles.size} มุม` : "ทุกมุม",
    replacePlanned ? "แทนที่แผนเดิม" : "",
  ].filter(Boolean).join(" · ");

  const noProducts = !(activeClient?.products || []).length;
  const planBlocked = planBusy || busy || noProducts || !planPlatforms.size;
  const planBlockedReason = noProducts
    ? "เพิ่มสินค้าอย่างน้อย 1 ชิ้นในแท็บ “สินค้า” ก่อนวางแผน"
    : !planPlatforms.size
      ? "เลือกอย่างน้อย 1 แพลตฟอร์มในตัวเลือกการวางแผน"
      : "วางแผนอัตโนมัติทั้งเดือน — กดซ้ำได้เพื่อเติมช่องที่ยังว่าง";

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
      <div className="sa-calendar-head">
        <div className="sa-calendar-toolbar">
          <div className="sa-month-nav">
            <button className="sa-icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="เดือนก่อน"><ChevronLeft size={16} /></button>
            <b className="sa-month-label">{thaiMonthLabel(month)}</b>
            <button className="sa-icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="เดือนถัดไป"><ChevronRight size={16} /></button>
            <button
              className="sa-btn ghost sm"
              onClick={() => { setMonth(currentMonth()); setWantToday(true); }}
              title="กลับไปเดือนนี้และเลื่อนไปที่ช่องวันนี้"
            >
              <CalendarDays size={13} /> วันนี้
            </button>
          </div>

          <div className="sa-calendar-summary" aria-label="สรุปสถานะโพสต์ในเดือนนี้">
            <button
              type="button"
              className={`sa-summary-chip${statusFilter === "all" ? " active" : ""}`}
              onClick={() => setStatusFilter("all")}
              title="แสดงทุกสถานะ"
            >
              <b>{monthEntries.length}</b> โพสต์
            </button>
            {SUMMARY_STATUSES.filter((s) => statusCounts[s] || statusFilter === s).map((s) => (
              <button
                key={s}
                type="button"
                className={`sa-summary-chip ${STATUS_META[s].cls}${statusFilter === s ? " active" : ""}`}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                title={`กรองเฉพาะรายการ “${STATUS_META[s].label}” — กดอีกครั้งเพื่อดูทั้งหมด`}
                aria-pressed={statusFilter === s}
              >
                <span className={`sa-legend-dot ${STATUS_META[s].cls}`} />
                {STATUS_META[s].label}
                <b>{statusCounts[s] || 0}</b>
              </button>
            ))}
          </div>

          <div className="sa-calendar-actions">
            <button
              className="sa-btn ghost sm"
              onClick={() => setNewEntryDate(today)}
              title={`เพิ่มโพสต์ในวันนี้ (${today})`}
              disabled={!activeClient}
            >
              <Plus size={13} /> เพิ่มโพสต์
            </button>
            <button
              className="sa-btn primary"
              disabled={planBlocked}
              onClick={startAutoPlan}
              title={planBlockedReason}
            >
              <Sparkles size={14} /> {planBusy ? "กำลังวางแผน…" : "วางแผนอัตโนมัติทั้งเดือน"}
            </button>
          </div>
        </div>

        <div className="sa-calendar-options">
          <button
            type="button"
            className={`sa-planner-toggle${plannerOpen ? " open" : ""}`}
            aria-expanded={plannerOpen}
            onClick={() => setPlannerOpen((open) => !open)}
            title="แพลตฟอร์มที่โพสต์ในแต่ละวัน · มุมคอนเทนต์ของเดือนนี้ · โหมดวางแผน"
          >
            <SlidersHorizontal size={14} />
            <span className="sa-planner-toggle-label">ตัวเลือกการวางแผน</span>
            <span className="sa-planner-summary">{summaryText}</span>
            <ChevronDown size={14} className={`sa-caret${plannerOpen ? " open" : ""}`} />
          </button>
          <span className="sa-tz" title="ทุกเวลาในปฏิทินเป็นเวลาไทย และลากการ์ดไปวางในวันอื่นเพื่อเลื่อนนัดได้">
            <Clock size={12} /> Asia/Bangkok
            <span className="sa-tz-sep">·</span>
            <GripVertical size={12} /> ลากการ์ดเพื่อย้ายวัน
          </span>
        </div>

        {plannerOpen && (
          <div className="sa-planner-body">
            <span className="sa-plan-platforms" title="เลือกแพลตฟอร์มที่จะโพสต์ในแต่ละวัน — เลือกได้หลายอัน วันเดียวโพสต์ได้ทั้ง Facebook, Instagram, LINE และเว็บ">
              แพลตฟอร์ม/วัน:
              {["facebook", "instagram", "line", "demo"].map((p) => (
                <label key={p} className={`sa-check sa-plan-platform ${PLATFORM_META[p].cls}${planPlatforms.has(p) ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={planPlatforms.has(p)}
                    onChange={() => toggleSetValue(setPlanPlatforms, p)}
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
                      onChange={() => toggleSetValue(setPlanAngles, a)}
                    />
                    <span>{a}</span>
                  </label>
                ))}
              </span>
            )}
            <span className="sa-planner-switches">
              <label className="sa-check" title="เติมโพสต์ทุกวันที่ยังว่าง · แต่ละวันใช้สินค้าเดียวกันทุกแพลตฟอร์ม และสินค้าไม่ซ้ำกันระหว่างวัน">
                <input type="checkbox" checked={onePerDay} onChange={(e) => setOnePerDay(e.target.checked)} />
                <span>ทุกวัน</span>
              </label>
              <label className="sa-check" title="กดวางแผนซ้ำได้เรื่อย ๆ — แทนที่เฉพาะรายการที่ยังไม่เริ่มรัน (สถานะ วางแผนไว้) ในช่องเดียวกัน รายการที่รันแล้ว/เผยแพร่แล้วจะไม่ถูกแตะ">
                <input type="checkbox" checked={replacePlanned} onChange={(e) => setReplacePlanned(e.target.checked)} />
                <span>แทนที่แผนเดิม</span>
              </label>
            </span>
          </div>
        )}

        {error && <p className="sa-error-banner">{error}</p>}
      </div>

      <div className="sa-filterbar">
        <button
          type="button"
          className={`sa-filter-toggle${filtersOpen || filtering ? " on" : ""}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
          title="กรองตามสถานะ แพลตฟอร์ม ป้าย หรือค้นหาข้อความ"
        >
          <Filter size={13} /> ตัวกรอง
          {filtering && <span className="sa-filter-count">{activeFilterCount}</span>}
        </button>
        {(filtersOpen || filtering) && (
          <>
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
            {filtering && (
              <span className="sa-muted sa-filter-result">
                แสดง {filteredEntries.length} จาก {monthEntries.length}
                <button className="sa-btn ghost sm" onClick={clearFilters}>ล้างฟิลเตอร์</button>
              </span>
            )}
          </>
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
        <span className="sa-filter-actions">
          {selectMode ? (
            <>
              <span className="sa-muted">จิ้มการ์ดเพื่อเลือก ({sel.size})</span>
              <button className="sa-btn ghost sm danger" disabled={busy || !sel.size} onClick={deleteSelectedCal}>
                <Trash2 size={13} /> ลบที่เลือก ({sel.size})
              </button>
              <button className="sa-btn ghost sm" onClick={() => { setSel(new Set()); setSelectMode(false); }}>
                ยกเลิก
              </button>
            </>
          ) : (
            <>
              <button className="sa-btn ghost sm" onClick={() => setSelectMode(true)} title="เข้าโหมดเลือกหลายรายการเพื่อลบ">
                <ListChecks size={13} /> เลือกลบ
              </button>
              <button
                className="sa-btn ghost sm danger"
                disabled={busy || !filteredEntries.length}
                onClick={deleteVisible}
                title="ลบรายการที่เห็นอยู่ตอนนี้ทั้งหมด (ใช้ฟิลเตอร์กรองก่อนได้)"
              >
                <Trash2 size={13} /> ลบที่เห็น ({filteredEntries.length})
              </button>
            </>
          )}
        </span>
      </div>

      <div className="sa-grid" role="region" aria-label={`ปฏิทินโพสต์ ${thaiMonthLabel(month)}`} tabIndex={0} ref={gridRef}>
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
                className={`sa-day ${date ? "" : "empty"} ${isToday ? "today" : ""} ${date && dragOver === date ? "dragover" : ""}`}
                data-date={date || undefined}
                role={date ? "group" : undefined}
                aria-label={date ? `${dayNumber(date)} ${thaiMonthLabel(month)} · ${entries.length} โพสต์` : undefined}
                onDragOver={(e) => {
                  if (!date) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={() => date && setDragOver(date)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setDragOver((d) => (d === date ? null : d));
                }}
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
                      {isToday && <span className="sa-day-today-label">วันนี้</span>}
                      {entries.length > 0 && (
                        <span className="sa-day-count" title={entries.length > 4 ? "เลื่อนภายในช่องวันเพื่อดูโพสต์ทั้งหมด" : "จำนวนโพสต์ที่แสดงในวันนี้"}>
                          {entries.length > 4 ? "↕ " : ""}{entries.length} โพสต์
                        </span>
                      )}
                      <button
                        type="button"
                        className="sa-day-add"
                        aria-label={`เพิ่มโพสต์ ${dayNumber(date)} ${thaiMonthLabel(month)}`}
                        title="เพิ่มโพสต์ในวันนี้"
                        onClick={() => setNewEntryDate(date)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div
                      className="sa-day-chips"
                      role="group"
                      aria-label={`รายการโพสต์ ${dayNumber(date)} ${thaiMonthLabel(month)}`}
                      tabIndex={entries.length > 4 ? 0 : undefined}
                    >
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
