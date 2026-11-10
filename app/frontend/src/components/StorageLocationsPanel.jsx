import { memo, useCallback, useEffect, useRef, useState } from "react";
import { HardDrive } from "lucide-react";

/**
 * Settings → Storage locations.
 *
 * The owner explicitly did NOT want to be told to move the whole app off an
 * external SSD; they wanted to decide, folder by folder, what stays on the
 * internal SSD and what may live on an external one. This panel is that
 * choice. It only edits a machine-local config — the launcher moves the data
 * on the next restart, before serve.cjs starts, so nothing is moved while the
 * app is using it.
 */

const VOLUME_TONE = {
  external: { bg: "rgba(34,211,238,.12)", color: "#67e8f9", label: "External SSD" },
  internal: { bg: "rgba(74,222,128,.12)", color: "#86efac", label: "Internal SSD" },
  unknown: { bg: "rgba(148,163,184,.12)", color: "#cbd5e1", label: "Unknown" },
};

const STATE_LABEL = {
  "in-checkout": "In checkout",
  applied: "Applied",
  "pending-restart": "Pending restart",
  "pending-reset": "Pending reset",
  "pending-move": "Pending move",
  // Two ids on one directory: the launcher will refuse both, so "Pending
  // restart" would be a promise it cannot keep.
  conflict: "Shares a folder",
};

function Badge({ tone, children }) {
  const t = VOLUME_TONE[tone] || VOLUME_TONE.unknown;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      background: t.bg, color: t.color, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    }}>{children || t.label}</span>
  );
}

function StorageLocationsPanel({ showAlert, onFoldersChange }) {
  // A ref keeps the effect stable even when the parent passes an inline callback.
  const onFoldersChangeRef = useRef(onFoldersChange);
  onFoldersChangeRef.current = onFoldersChange;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/storage/locations");
      if (response.status === 404) {
        throw new Error("The running server is older than this UI (no /api/storage/locations). Quit LUKE and start it again with ./mac.sh or ./linux.sh, then hard-refresh the browser.");
      }
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not read storage locations.");
      setData(body);
      onFoldersChangeRef.current?.(Array.isArray(body.folders) ? body.folders.length : 0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const post = useCallback(async (payload) => {
    const response = await fetch("/api/storage/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Could not save the choice.");
    await refresh();
  }, [refresh]);

  const choose = useCallback(async (folder) => {
    setBusy(folder.id);
    try {
      const picker = await fetch("/api/storage/choose-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `Choose where LUKE keeps ${folder.label}` }),
      });
      const picked = await picker.json();
      if (picked.cancelled) return;
      if (!picker.ok || !picked.selectedPath) throw new Error(picked.error || "No folder was chosen.");
      await post({ folder: folder.id, target: picked.selectedPath });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      showAlert?.({ title: "Storage locations", message });
    } finally {
      setBusy("");
    }
  }, [post, showAlert]);

  const reset = useCallback(async (folder) => {
    setBusy(folder.id);
    try { await post({ folder: folder.id, target: null }); }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      showAlert?.({ title: "Storage locations", message });
    } finally { setBusy(""); }
  }, [post, showAlert]);

  const folders = data?.folders || [];
  const pending = folders.filter((f) => f.requiresRestart);

  return (
    <div className="settings-expanded-content">
      <div className="settings-subsection">
        <div className="settings-subsection-title">
          <HardDrive size={16} /> Storage locations
        </div>
        <span className="settings-option-desc" style={{ display: "block", marginBottom: 12 }}>
          Choose where each folder lives — keep the app, built UI and chat state on the fast internal
          SSD, and put multi-gigabyte models or downloaded runtimes on an external SSD if you want.
          Nothing is moved while LUKE is running: close the app and open it again with{" "}
          <code>./mac.sh</code> or <code>./linux.sh</code> to apply. Code and dependencies always
          stay in the checkout.
        </span>

        {pending.length > 0 && (
          <div style={{
            margin: "0 0 12px", padding: "10px 12px", borderRadius: 8,
            background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.3)",
            fontSize: 12, lineHeight: 1.5,
          }}>
            {pending.length} choice{pending.length > 1 ? "s" : ""} waiting:{" "}
            {pending.map((f) => f.id).join(", ")}. Restart LUKE to move the data and create the link.
          </div>
        )}
        {error && <div style={{ color: "#fca5a5", fontSize: 12, marginBottom: 10 }}>{error}</div>}
        {!data && !error && <div className="settings-option-desc">Loading…</div>}

        {folders.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.7 }}>
                  <th style={{ padding: "6px 8px" }}>Folder</th>
                  <th style={{ padding: "6px 8px" }} title="The disk this folder is on right now">Current volume</th>
                  <th style={{ padding: "6px 8px" }} title="Where LUKE suggests keeping this folder">Suggested volume</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }} />
                </tr>
              </thead>
              <tbody>
                {folders.map((folder) => (
                  <tr key={folder.id} style={{ borderTop: "1px solid rgba(148,163,184,.15)" }}>
                    <td style={{ padding: "8px", verticalAlign: "top" }}>
                      <div style={{ fontWeight: 600 }}>{folder.label}</div>
                      <div className="settings-option-desc" style={{ fontSize: 11, wordBreak: "break-all" }}>
                        {folder.currentPath}
                      </div>
                      <div className="settings-option-desc" style={{ fontSize: 11, opacity: 0.75 }}>
                        {folder.note}
                      </div>
                    </td>
                    <td style={{ padding: "8px", verticalAlign: "top" }}>
                      <Badge tone={folder.volume.kind} />
                      {folder.volume.sameVolumeAsCheckout === false && (
                        <div className="settings-option-desc" style={{ fontSize: 10, marginTop: 4 }}>
                          different disk from the app
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", verticalAlign: "top" }}>
                      <Badge tone={folder.recommended}>{folder.recommended === "external" ? "External" : "Internal"}</Badge>
                    </td>
                    <td style={{ padding: "8px", verticalAlign: "top" }}>
                      <span style={{ color: folder.state === "conflict" ? "#fca5a5" : folder.requiresRestart ? "#fcd34d" : "#86efac" }}>
                        {STATE_LABEL[folder.state] || folder.state}
                      </span>
                      {folder.conflictWith && folder.conflictWith.length > 0 && (
                        <div className="settings-option-desc" style={{ fontSize: 10, marginTop: 4 }}>
                          also used by {folder.conflictWith.join(", ")} — give each folder its own directory
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="m3-btn m3-btn-filled"
                        disabled={busy === folder.id}
                        onClick={() => void choose(folder)}
                        style={{ marginRight: 6, padding: "5px 10px", fontSize: 11 }}
                      >{busy === folder.id ? "…" : "Choose…"}</button>
                      <button
                        type="button"
                        className="m3-btn m3-btn-outlined"
                        disabled={busy === folder.id || (!folder.target && folder.state === "in-checkout")}
                        style={{ padding: "5px 10px", fontSize: 11 }}
                        onClick={() => void reset(folder)}
                      >Reset</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="settings-option-desc" style={{ display: "block", marginTop: 12, fontSize: 11 }}>
          Terminal equivalent: <code>bash scripts/setup/storage-layout.sh --list</code> ·{" "}
          <code>--set &lt;id&gt; &lt;path&gt;</code> · <code>--reset &lt;id&gt;</code> · <code>--choose</code>.
          Choices live in <code>{data?.layoutFile || "storage-layout.conf"}</code> (machine-local, not committed).
        </div>
      </div>
    </div>
  );
}

export default memo(StorageLocationsPanel);
