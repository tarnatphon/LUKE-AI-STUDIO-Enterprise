import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Plus, CalendarDays, Clock } from "lucide-react";
import {
  STATUS_META, PLATFORM_META, monthMatrix, thaiMonthLabel, shiftMonth, dayNumber,
  bangkokToday, currentMonth, entriesOfMonth,
} from "./lib.js";
import { NewEntryModal, AutoPlanModal } from "./modals.jsx";

const WEEKDAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

function Chip({ entry, onOpen, onDragStart }) {
  const meta = STATUS_META[entry.status] || { label: entry.status, cls: "" };
  const platform = PLATFORM_META[entry.platform] || PLATFORM_META.demo;
  return (
    <button
      className={`sa-chip ${meta.cls} ${entry.inFlight ? "running" : ""}`}
      draggable={!entry.inFlight}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/sa-entry", entry.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(entry.id)}
      title={`${entry.time} · ${platform.label} · ${meta.label} · ${entry.productName}`}
    >
      <span className="sa-chip-time">{entry.time}</span>
      <span className={`sa-platform-chip ${platform.cls}`}>{platform.short}</span>
      <span className="sa-chip-status">{meta.label}</span>
    </button>
  );
}

export default function CalendarTab({ state, activeClient, busy, onOpenEntry, onRunNow, onReschedule, onDeleteEntry, onCreateEntry, onAutoPlan, onApplyPlan }) {
  const [month, setMonth] = useState(currentMonth());
  const [newEntryDate, setNewEntryDate] = useState(null);
  const [planPreview, setPlanPreview] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [error, setError] = useState("");
  const today = bangkokToday();
  const weeks = useMemo(() => monthMatrix(month), [month]);
  const byDate = useMemo(() => {
    const map = new Map();
    for (const entry of entriesOfMonth(activeClient?.calendar || [], month)) {
      const list = map.get(entry.date) || [];
      list.push(entry);
      map.set(entry.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
  }, [activeClient, month]);

  const startAutoPlan = async () => {
    setPlanBusy(true);
    setError("");
    try {
      const preview = await onAutoPlan(month, activeClient?.settings?.postsPerWeek || 5);
      setPlanPreview(preview);
    } catch (err) {
      setError(err.message);
    } finally {
      setPlanBusy(false);
    }
  };

  return (
    <div className="sa-calendar">
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
          <button className="sa-btn primary" disabled={planBusy || busy || !(activeClient?.products || []).length} onClick={startAutoPlan}>
            <Sparkles size={14} /> {planBusy ? "กำลังวางแผน…" : "วางแผนอัตโนมัติทั้งเดือน"}
          </button>
        </div>
      </div>

      {error && <p className="sa-error-banner">{error}</p>}

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
                        <Chip key={entry.id} entry={entry} onOpen={onOpenEntry} />
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
          onApply={(m, slots) => onApplyPlan(activeClient.id, m, slots)}
        />
      )}
    </div>
  );
}
