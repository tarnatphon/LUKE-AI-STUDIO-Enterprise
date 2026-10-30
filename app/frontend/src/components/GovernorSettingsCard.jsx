import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save, ShieldCheck } from "lucide-react";

/**
 * The memory governor, made visible and adjustable.
 *
 * The governor decides when a loaded model is handed back so the machine stays
 * usable. Its thresholds were only reachable by editing a JSON file in
 * `app/runtime-state`, which meant the first time most people learned the
 * governor existed was when a chat model vanished mid-sentence and the only
 * explanation was a line in the terminal.
 *
 * This card answers three questions in order: what is the machine doing right
 * now, what did the governor do about it, and with which numbers. Every field
 * starts at the value shipped for this machine's memory tier — a saved override
 * is shown as such, and can be handed back to the default one field at a time.
 *
 * It is a presentation component on purpose: the data, the busy flag and the
 * note all arrive as props, so the whole card can be rendered and asserted on
 * without a server or a browser.
 */

const cardStyle = {
  marginTop: 12,
  padding: 12,
  border: "1px solid var(--md-sys-color-outline-variant)",
  borderRadius: 12,
  background: "var(--md-sys-color-surface-container)",
};

const headingStyle = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  margin: "0 0 4px",
  fontSize: ".78rem",
};

const descStyle = {
  display: "block",
  marginTop: 4,
  color: "var(--md-sys-color-outline)",
  fontSize: ".68rem",
  lineHeight: 1.5,
};

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  border: "1px solid var(--md-sys-color-outline-variant)",
  borderRadius: 8,
  background: "transparent",
  color: "var(--md-sys-color-on-surface)",
  cursor: "pointer",
  fontSize: ".7rem",
};

const GROUP_LABELS = {
  general: "When to act",
  swap: "Swap",
  memory: "Memory pressure",
};

const LEVEL_COLORS = {
  ok: "var(--md-sys-color-primary)",
  tight: "#f0a020",
  critical: "#d93025",
};

function formatGb(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number * 100) / 100} GB`;
}

function describeStatus(status) {
  if (!status) return null;
  const pressure = status.pressure || null;
  const decision = status.decision || null;
  return {
    level: pressure?.level || "ok",
    reason: pressure?.reason || "no sweep has run yet",
    decision: decision?.reason || null,
    released: status.lastRelease || null,
    lastSweepAt: status.lastSweepAt || null,
  };
}

function fieldValue(draft, policy, key) {
  if (draft && Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
  return policy ? policy[key] : "";
}

export default function GovernorSettingsCard({ data, busy = "", note = "", onSave, onReset }) {
  const [edited, setEdited] = useState(null);

  // A new payload (after a save, or a sweep) is the truth about what is stored;
  // unsaved typing is dropped rather than silently merged into it.
  useEffect(() => {
    setEdited(null);
  }, [data]);

  const fields = Array.isArray(data?.fields) ? data.fields : [];
  const policy = data?.policy || null;
  const stored = data?.overrides || {};
  const draft = edited === null ? stored : edited;
  const status = useMemo(() => describeStatus(data?.status), [data]);

  const groups = useMemo(() => {
    const byGroup = new Map();
    for (const field of fields) {
      const key = field.group || "general";
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(field);
    }
    return Array.from(byGroup.entries());
  }, [fields]);

  const changed = useMemo(() => {
    const keys = new Set([...Object.keys(stored), ...Object.keys(draft || {})]);
    for (const key of Array.from(keys)) {
      const before = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : undefined;
      const after = Object.prototype.hasOwnProperty.call(draft || {}, key) ? draft[key] : undefined;
      if (before === after) keys.delete(key);
    }
    return Array.from(keys);
  }, [stored, draft]);

  // A value equal to the shipped default is stored as "no override" rather than
  // as a number that happens to look the same, so a later change to the shipped
  // value is not silently pinned. An emptied field is an explicit null: it must
  // clear the override on the server, not leave the old number behind.
  const setValue = (key, value) => {
    const next = { ...(edited === null ? stored : edited) };
    const shipped = data?.defaults ? data.defaults[key] : undefined;
    if (typeof value === "boolean") {
      if (value === shipped) delete next[key];
      else next[key] = value;
    } else if (value === "") {
      next[key] = null;
    } else {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) next[key] = null;
      else if (numeric === shipped) delete next[key];
      else next[key] = numeric;
    }
    setEdited(next);
  };

  const clearValue = (key) => {
    const next = { ...(edited === null ? stored : edited) };
    delete next[key];
    next[key] = null;
    setEdited(next);
  };

  return (
    <div style={cardStyle}>
      <div style={headingStyle}>
        <ShieldCheck size={15} />
        <strong>Memory governor</strong>
        {status && (
          <span
            style={{
              marginLeft: "auto",
              padding: "1px 8px",
              borderRadius: 999,
              fontSize: ".62rem",
              textTransform: "uppercase",
              letterSpacing: ".04em",
              color: LEVEL_COLORS[status.level] || "inherit",
              border: `1px solid ${LEVEL_COLORS[status.level] || "currentColor"}`,
            }}
          >
            {status.level}
          </span>
        )}
      </div>

      <span style={descStyle}>
        When this machine runs short of memory, the governor hands back a model that can reload by itself, so the next
        request starts it again. It never touches the image model, because nothing could start that again behind your
        back.
      </span>

      {status ? (
        <div data-testid="governor-status" style={{ marginTop: 8, fontSize: ".7rem", lineHeight: 1.55 }}>
          <div>
            <strong>Now:</strong> {status.reason}
          </div>
          {status.decision && (
            <div style={{ color: "var(--md-sys-color-outline)" }}>
              <strong>Last decision:</strong> {status.decision}
            </div>
          )}
          {status.released && (
            <div data-testid="governor-release" style={{ color: "var(--md-sys-color-outline)" }}>
              <strong>Released:</strong> {status.released.engine || status.released.engine} · {formatGb(status.released.sizeGb)}
              {status.released.at ? ` · ${new Date(status.released.at).toLocaleString()}` : ""}
            </div>
          )}
        </div>
      ) : (
        <span style={descStyle}>Reading the governor…</span>
      )}

      {groups.map(([group, groupFields]) => (
        <div key={group} style={{ marginTop: 10 }}>
          <div style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--md-sys-color-outline)" }}>
            {GROUP_LABELS[group] || group}
          </div>
          {groupFields.map((field) => {
            const value = fieldValue(draft, policy, field.key);
            const overridden = Object.prototype.hasOwnProperty.call(stored, field.key) ||
              Object.prototype.hasOwnProperty.call(draft || {}, field.key);
            const shipped = data?.defaults ? data.defaults[field.key] : undefined;
            if (field.kind === "boolean") {
              return (
                <label
                  key={field.key}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: ".7rem", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={value !== false}
                    onChange={(event) => setValue(field.key, event.target.checked)}
                  />
                  {field.label}
                </label>
              );
            }
            return (
              <div key={field.key} style={{ marginTop: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ flex: 1, fontSize: ".7rem" }} htmlFor={`governor-${field.key}`}>
                    {field.label}
                  </label>
                  <input
                    id={`governor-${field.key}`}
                    className="m3-input"
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={value === null || value === undefined ? "" : value}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    style={{ width: 96, fontSize: ".7rem" }}
                  />
                  <span style={{ width: 44, fontSize: ".62rem", color: "var(--md-sys-color-outline)" }}>
                    {field.unit === "ratio" ? "" : field.unit}
                  </span>
                  {overridden && (
                    <button
                      type="button"
                      style={{ ...buttonStyle, padding: "3px 7px", fontSize: ".62rem" }}
                      onClick={() => clearValue(field.key)}
                      title={`Back to the shipped value${shipped !== undefined ? ` (${shipped})` : ""}`}
                    >
                      reset
                    </button>
                  )}
                </div>
                <span style={{ ...descStyle, marginTop: 2 }}>{field.help}</span>
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => onSave?.(draft)}
          disabled={busy === "governor-save" || changed.length === 0}
        >
          <Save size={13} />
          {busy === "governor-save" ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Saved"}
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => onReset?.()}
          disabled={busy === "governor-reset" || Object.keys(stored).length === 0}
        >
          <RotateCcw size={13} />
          {busy === "governor-reset" ? "Resetting…" : "Back to this machine's defaults"}
        </button>
        {data?.file && (
          <code style={{ fontSize: ".6rem", color: "var(--md-sys-color-outline)" }}>{data.file}</code>
        )}
      </div>

      {note && (
        <span data-testid="governor-note" style={{ ...descStyle, color: "var(--md-sys-color-primary)" }}>
          {note}
        </span>
      )}
    </div>
  );
}
