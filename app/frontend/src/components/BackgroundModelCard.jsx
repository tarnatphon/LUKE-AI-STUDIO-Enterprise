import React from "react";
import { AlertTriangle, CheckCircle2, Download, Sparkles } from "lucide-react";

/**
 * Which model runs the background chores, and what to do when there is none.
 *
 * Product-name translation used to borrow the chat model. On an 18 GB Mac that
 * meant a 9B model (5 GB) loaded next to SDXL, swap, and the resource governor
 * handing the chat model back before a single name was translated — with nothing
 * in the app to explain why the names were not arriving.
 *
 * The rule is "the smallest model under the cap", so the honest states are:
 *   - a small model exists and runs the chore;
 *   - none is downloaded, so the chat model does the work (and costs the RAM);
 *   - background chores are switched off.
 *
 * Presentation only: `data` is the payload of `GET /api/background-model`, so the
 * whole card can be rendered and asserted on without a server.
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
  lineHeight: 1.55,
};

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginTop: 8,
  padding: "6px 10px",
  border: "1px solid var(--md-sys-color-outline-variant)",
  borderRadius: 8,
  background: "transparent",
  color: "var(--md-sys-color-on-surface)",
  cursor: "pointer",
  fontSize: ".7rem",
};

const stateStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 7,
  marginTop: 8,
  fontSize: ".7rem",
  lineHeight: 1.55,
};

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 ** 3) return `${Math.round((value / 1024 ** 3) * 10) / 10} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}

/**
 * One line per queue state, in the words the user needs: queued behind what,
 * how fast, or what to do about a failure.
 */
function downloadLine(download) {
  if (!download) return "";
  const size = formatSize(download.totalBytes);
  switch (download.state) {
    case "completed":
      return "Downloaded — translations use it from the next product name, no restart needed.";
    case "failed":
      return download.error || "The download failed.";
    case "cancelled":
      return "The download was cancelled.";
    case "skipped":
      return "The download was skipped.";
    case "queued":
      return download.queuePosition > 1
        ? `Queued (position ${download.queuePosition})${size ? ` · ${size}` : ""}`
        : `Queued${size ? ` · ${size}` : ""} — starting now`;
    default: {
      const speed = Number(download.speedBytesPerSecond) > 0
        ? ` · ${formatSize(download.speedBytesPerSecond)}/s`
        : "";
      const done = formatSize(download.downloadedBytes);
      return `Downloading ${download.percent}%${done && size ? ` · ${done} of ${size}` : ""}${speed}`;
    }
  }
}

export default function BackgroundModelCard({ data, note = "", busy = "", onDownload = null }) {
  const enabled = data ? data.enabled !== false : true;
  const model = data?.model || null;
  const cap = Number(data?.maxSizeGb || 0);
  const mainReady = Boolean(data?.mainReady);
  const suggestion = data?.suggestion || null;
  const download = data?.download || null;
  const downloading = Boolean(download && download.active);

  return (
    <div style={cardStyle} data-testid="background-model-card">
      <div style={headingStyle}>
        <Sparkles size={15} />
        <strong>Background model (product names)</strong>
      </div>

      <span style={descStyle}>
        Translating a Thai product name into the English label an image prompt is built from is a
        dictionary job, not a conversation. It runs on the smallest local model you have downloaded,
        so the chat model never has to be loaded — or unloaded — to do it.
      </span>

      {!data && <span style={descStyle}>Reading the model folder…</span>}

      {data && !enabled && (
        <div style={{ ...stateStyle, color: "var(--md-sys-color-outline)" }}>
          <AlertTriangle size={14} />
          <span>
            Switched off in <code>app/config/social-agency/background-model.json</code>. Every
            translation goes to the chat model.
          </span>
        </div>
      )}

      {data && enabled && model && (
        <div style={stateStyle}>
          <CheckCircle2 size={14} />
          <span data-testid="background-model-chosen">
            <strong>{model.filename}</strong>
            {model.sizeGb ? ` · ${model.sizeGb} GB` : ""} — {data.reason}
          </span>
        </div>
      )}

      {data && enabled && !model && (
        <div style={{ ...stateStyle, color: "#f0a020" }}>
          <AlertTriangle size={14} />
          <span data-testid="background-model-missing">
            <strong>No small model is downloaded yet.</strong> Background translations fall back to
            the chat model{mainReady ? "" : ", which is not loaded right now"}, so the names wait and
            the machine carries a much larger model than this job needs.
            <br />
            Download a 1–3B model (a Q4 at roughly {cap || 3} GB or less) in <strong>Settings → Text
            Models</strong>; it is used for this automatically from the next translation, without
            changing which model answers your chats.
            {suggestion && (
              <>
                <br />
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => onDownload?.(suggestion)}
                  disabled={!onDownload || busy === "background-download"}
                  data-testid="background-model-download"
                >
                  <Download size={13} />
                  {busy === "background-download"
                    ? "Adding to the queue…"
                    : `Download ${suggestion.label} (${suggestion.sizeGb} GB)`}
                </button>
                <span style={{ display: "block", marginTop: 4, color: "var(--md-sys-color-outline)" }}>
                  {data.suggestionReason}
                </span>
              </>
            )}
            {!suggestion && data.suggestionReason && (
              <>
                <br />
                <span style={{ color: "var(--md-sys-color-outline)" }}>{data.suggestionReason}</span>
              </>
            )}
          </span>
        </div>
      )}

      {data && download && (
        <div style={{ marginTop: 8 }} data-testid="background-model-download-progress">
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: ".7rem" }}>
            {download.state === "completed" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span>
              <strong>{download.state.charAt(0).toUpperCase() + download.state.slice(1)}</strong> ·{" "}
              {downloadLine(download)}
            </span>
          </div>
          {downloading && (
            <div
              style={{
                marginTop: 4,
                height: 4,
                borderRadius: 999,
                background: "var(--md-sys-color-surface-container-highest)",
                overflow: "hidden",
              }}
              role="progressbar"
              aria-valuenow={download.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                style={{
                  width: `${Math.max(2, download.percent)}%`,
                  height: "100%",
                  background: "var(--md-sys-color-primary)",
                }}
              />
            </div>
          )}
        </div>
      )}

      {data?.preferredModel && (
        <span style={descStyle}>
          Preferred model is pinned to <code>{data.preferredModel}</code> in the same config file.
        </span>
      )}

      {note && (
        <span style={{ ...descStyle, color: "var(--md-sys-color-primary)" }}>{note}</span>
      )}
    </div>
  );
}
