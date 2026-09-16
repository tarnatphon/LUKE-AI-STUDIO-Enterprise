import React, { useState } from "react";
import { Check, CircleDashed, LoaderCircle, RotateCcw, X } from "lucide-react";

/**
 * The Work agent's control surface: what it plans to do, and everything it has
 * changed in this run with one button to undo the lot.
 *
 * Codex hands back a diff for review before anything is merged; this is the
 * same idea, kept on the user's machine.
 */

const panelStyle = {
  width: "min(390px, 42vw)",
  minWidth: 310,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid var(--md-sys-color-outline-variant)",
  background: "var(--md-sys-color-surface-container-low)",
  color: "var(--md-sys-color-on-surface)",
};

const headingStyle = {
  minHeight: 54,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px 0 16px",
  borderBottom: "1px solid var(--md-sys-color-outline-variant)",
  fontSize: ".8rem",
};

const sectionStyle = {
  padding: 12,
  borderBottom: "1px solid var(--md-sys-color-outline-variant)",
};

const labelStyle = {
  display: "block",
  margin: "0 0 7px",
  color: "var(--md-sys-color-outline)",
  fontSize: ".61rem",
  textTransform: "uppercase",
  letterSpacing: ".06em",
};

const muted = "var(--md-sys-color-outline)";
const strong = "var(--md-sys-color-on-surface)";
const ok = "#67d391";
const bad = "#e5736b";
const warn = "#e0b64a";



export default function WorkAgentPanel({ tasks = [], review = null, onRevert, onClose, busy = false }) {
  const [openDiffs, setOpenDiffs] = useState({});
  const changes = review?.changes || [];
  const totals = review?.totals || { additions: 0, deletions: 0, files: 0 };

  return (
    <aside style={panelStyle} aria-label="Work agent run">
      <div style={headingStyle}>
        <strong style={{ flex: 1 }}>Agent run</strong>
        <button type="button" onClick={onClose} aria-label="Close agent panel" style={{ background: "transparent", border: 0, color: muted, cursor: "pointer", display: "grid", placeItems: "center" }}>
          <X size={15} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={sectionStyle}>
          <span style={labelStyle}>Plan</span>
          {tasks.length === 0 ? (
            <p style={{ margin: 0, color: muted, fontSize: ".72rem" }}>
              The agent posts its plan here as it works.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 5 }}>
              {tasks.slice(0, 24).map((task, index) => (
                <li key={task.id || index} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 7, alignItems: "start", color: task.status === "done" ? muted : strong, fontSize: ".72rem" }}>
                  <span style={{ marginTop: 1, color: task.status === "done" ? ok : task.status === "doing" ? warn : muted }}>
                    {task.status === "done" ? <Check size={13} /> : task.status === "doing" ? <LoaderCircle size={13} /> : <CircleDashed size={13} />}
                  </span>
                  <span style={{ textDecoration: task.status === "done" ? "line-through" : "none" }}>{task.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={sectionStyle}>
          <span style={labelStyle}>Changes {totals.files > 0 ? `(${totals.files})` : ""}</span>
          {changes.length === 0 ? (
            <p style={{ margin: 0, color: muted, fontSize: ".72rem" }}>
              Nothing has been changed yet. Every file the agent edits is backed up first and listed here.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: ".7rem", color: "var(--md-sys-color-on-surface-variant)" }}>
                <span style={{ color: ok }}>+{totals.additions}</span>
                <span style={{ color: bad }}>−{totals.deletions}</span>
                <span style={{ color: muted }}>in {totals.files} file{totals.files === 1 ? "" : "s"}</span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                {changes.map((change) => {
                  const open = openDiffs[change.path] !== false;
                  return (
                    <li key={change.path} style={{ border: "1px solid var(--md-sys-color-outline-variant)", borderRadius: 8, overflow: "hidden" }}>
                      <button
                        type="button"
                        onClick={() => setOpenDiffs((current) => ({ ...current, [change.path]: !open }))}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: "var(--md-sys-color-surface-container)", border: 0, color: "var(--md-sys-color-on-surface-variant)", cursor: "pointer", fontSize: ".68rem", textAlign: "left" }}
                      >
                        <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{change.path}</code>
                        <span style={{ color: ok }}>+{change.additions}</span>
                        <span style={{ color: bad }}>−{change.deletions}</span>
                      </button>
                      {open && (
                        <pre style={{ margin: 0, padding: "7px 9px", maxHeight: 260, overflow: "auto", background: "var(--md-sys-color-surface)", fontSize: ".63rem", lineHeight: 1.45, whiteSpace: "pre" }}>
                          {String(change.diff || "").split("\n").map((line, lineIndex) => (
                            <span
                              key={lineIndex}
                              style={{
                                display: "block",
                                color: line.startsWith("+") && !line.startsWith("+++") ? "#67d391" : line.startsWith("-") && !line.startsWith("---") ? bad : line.startsWith("@@") ? muted : "#b9c4bf",
                              }}
                            >
                              {line || " "}
                            </span>
                          ))}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={onRevert}
                disabled={busy}
                style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1px solid rgba(229,115,107,.35)", borderRadius: 7, background: "rgba(229,115,107,.12)", color: "#e5736b", cursor: "pointer", fontSize: ".7rem" }}
              >
                <RotateCcw size={13} />
                {busy ? "Reverting…" : "Revert everything this run"}
              </button>
            </>
          )}
        </div>

        {review?.git?.isRepo && (
          <div style={sectionStyle}>
            <span style={labelStyle}>Git</span>
            <p style={{ margin: 0, color: "var(--md-sys-color-on-surface-variant)", fontSize: ".7rem" }}>
              {review.git.branch ? `On ${review.git.branch}` : "Repository"}
              {review.git.lastCommit ? ` · ${review.git.lastCommit}` : ""}
            </p>
            <p style={{ margin: "4px 0 0", color: muted, fontSize: ".66rem" }}>
              LUKE AI never commits, pushes or cleans your repository. It only reads status to help you review.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
