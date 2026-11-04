import { memo, useCallback, useEffect, useRef, useState } from "react";

/**
 * Settings → Storage administration.
 *
 * The Settings audit found eleven /api/storage/* routes that existed on the
 * server but had no UI caller at all. Those controls were effectively missing
 * features, not just dead endpoints. This panel connects every one of them in
 * one place, using real classes and plain fetch. Read-only GETs are loaded on
 * mount; mutating actions always require an explicit button press.
 *
 * Route payloads mirror scripts/server/serve.cjs exactly:
 *   capability, path, credentialReference, providerId, intervalMs.
 */

export const STORAGE_ADMIN_ACTIONS = Object.freeze([
  { id: "status", route: "/api/storage/status", method: "GET", label: "Read destination status", hint: "Current storage destination manager state.", fields: [] },
  { id: "resolve", route: "/api/storage/resolve", method: "POST", label: "Resolve active destination", hint: "Recompute which destination is active now.", fields: [] },
  { id: "certification", route: "/api/storage/recovery-certification", method: "GET", label: "Read recovery certification", hint: "Last recovery-readiness certification.", fields: [] },
  { id: "certification-run", route: "/api/storage/recovery-certification/run", method: "POST", label: "Run certification", hint: "Certify recovery readiness from the current subsystems.", fields: [] },
  { id: "credentials-status", route: "/api/storage/credentials/status", method: "POST", label: "Check credential status", hint: "Asks the server about a stored reference, never returns the secret.", fields: [{ key: "credentialReference", label: "Credential reference", required: true }] },
  { id: "credentials-delete", route: "/api/storage/credentials/delete", method: "POST", label: "Delete credential", hint: "Removes a stored provider credential. This cannot be undone.", fields: [{ key: "providerId", label: "Provider id", required: true }, { key: "credentialReference", label: "Credential reference", required: true }] },
  { id: "health-select", route: "/api/storage/health/select", method: "POST", label: "Select healthiest provider", hint: "Uses the health score for a capability.", fields: [{ key: "capability", label: "Capability", defaultValue: "write", required: true }] },
  { id: "providers-select", route: "/api/storage/providers/select", method: "POST", label: "Select storage provider", hint: "Chooses a provider for a capability.", fields: [{ key: "capability", label: "Capability", defaultValue: "write", required: true }] },
  { id: "lifecycle-protect", route: "/api/storage/lifecycle/protect", method: "POST", label: "Protect path", hint: "Mark a path as protected from lifecycle cleanup.", fields: [{ key: "path", label: "Path", required: true }] },
  { id: "lifecycle-unprotect", route: "/api/storage/lifecycle/unprotect", method: "POST", label: "Unprotect path", hint: "Remove lifecycle protection from a path.", fields: [{ key: "path", label: "Path", required: true }] },
  { id: "watcher-interval", route: "/api/storage/watcher/interval", method: "POST", label: "Set watcher interval", hint: "Milliseconds between availability scans.", fields: [{ key: "intervalMs", label: "Interval (ms)", defaultValue: "60000", required: true, numeric: true }] },
]);

const inputStyle = { width: "100%", boxSizing: "border-box", marginTop: 4 };
const cardStyle = {
  border: "1px solid rgba(148,163,184,.18)", borderRadius: 12,
  padding: "12px 14px", marginBottom: 10,
};

function fieldKey(action, field) { return `${action.id}:${field.key}`; }

function StorageAdminPanel() {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const call = useCallback(async (action) => {
    const payload = {};
    for (const field of action.fields) {
      const key = fieldKey(action, field);
      const raw = form[key] ?? field.defaultValue ?? "";
      const value = String(raw).trim();
      if (field.required && !value) {
        setError(`${action.label}: ${field.label} is required.`);
        return null;
      }
      if (!value) continue;
      payload[field.key] = field.numeric ? Number(value) : value;
      if (field.numeric && !Number.isFinite(payload[field.key])) {
        setError(`${action.label}: ${field.label} must be a number.`);
        return null;
      }
    }
    setBusy(action.id);
    setError("");
    try {
      const response = await fetch(action.route, {
        method: action.method,
        headers: action.method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: action.method === "POST" ? JSON.stringify(payload) : undefined,
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setResult({ route: action.route, body });
      return body;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return null;
    } finally {
      setBusy("");
    }
  }, [form]);

  // `call` depends on the form; a ref keeps the mount-only effect honest
  // without re-loading read-only state on every keystroke.
  const callRef = useRef(call);
  callRef.current = call;
  useEffect(() => {
    const readOnly = STORAGE_ADMIN_ACTIONS.filter((a) => a.method === "GET");
    let cancelled = false;
    const load = async () => {
      for (const action of readOnly) {
        await callRef.current(action);
        if (cancelled) return;
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="settings-expanded-content">
      <div className="settings-subsection">
        <div className="settings-subsection-title">Storage administration</div>
        <span className="settings-option-desc" style={{ display: "block", marginBottom: 12 }}>
          These controls talk to storage endpoints that previously had no button in the app.
          Read-only status loads automatically; every action that changes state needs a click.
          The server still owns all validation and path containment.
        </span>

        {error && <div role="alert" style={{ color: "#fca5a5", fontSize: 12, marginBottom: 10 }}>{error}</div>}

        {STORAGE_ADMIN_ACTIONS.map((action) => (
          <div key={action.id} style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{action.label}</div>
            <div className="settings-option-desc" style={{ fontSize: 11, marginBottom: 8 }}>
              {action.hint} · <code>{action.method} {action.route}</code>
            </div>
            {action.fields.map((field) => (
              <label key={field.key} className="settings-option-desc" style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
                {field.label}
                <input
                  className="m3-input"
                  style={inputStyle}
                  value={form[fieldKey(action, field)] ?? field.defaultValue ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, [fieldKey(action, field)]: event.target.value }))}
                  placeholder={field.defaultValue ? `Default: ${field.defaultValue}` : ""}
                  aria-label={`${action.label}: ${field.label}`}
                />
              </label>
            ))}
            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              data-testid={`storage-admin-${action.id}`}
              disabled={busy === action.id}
              onClick={() => void call(action)}
              style={{ padding: "6px 12px", fontSize: 11 }}
            >
              {busy === action.id ? "…" : action.method === "GET" ? "Refresh" : "Run"}
            </button>
          </div>
        ))}

        {result && (
          <div className="settings-option-desc" style={{ marginTop: 12, fontSize: 11 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Last result · <code>{result.route}</code></div>
            <pre data-testid="storage-admin-result" style={{
              maxHeight: 220, overflow: "auto", padding: 10, borderRadius: 8,
              background: "rgba(148,163,184,.08)", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>{JSON.stringify(result.body, null, 2).slice(0, 3000)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(StorageAdminPanel);
