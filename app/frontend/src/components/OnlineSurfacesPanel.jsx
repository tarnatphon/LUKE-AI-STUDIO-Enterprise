import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Globe2, Radio, Bot, Copy, RefreshCw } from "lucide-react";

/**
 * One panel for the online surfaces that remain. Everything here is opt-in and
 * owner-controlled; the panel never receives a key, a bot token or a pairing
 * token after the moment it is created.
 *
 * Online media generation was removed: images, video and audio are produced by
 * the local engines only. The badge text comes from the server, so the UI
 * cannot claim "air-gap" while the ledger says something went out.
 */

const SWITCHES = [
  { key: "cloudForChat", label: "Online-first Chat", hint: "Chat tries every free provider before the local model." },
  { key: "uncensoredMode", label: "No-filter lane (local only)", hint: "Every turn stays on the local GGUF model. Nothing leaves this machine." },
  { key: "airGapMode", label: "Air-gap proof mode", hint: "Blocks all cloud turns and records the refusal in the Egress Ledger." },
  { key: "gatewayEnabled", label: "External /v1 gateway", hint: "Other apps can point an OpenAI-compatible client at this machine." },
  { key: "mcpEnabled", label: "MCP tools for editors", hint: "Exposes read-only status and chat tools over JSON-RPC." },
  { key: "channelsEnabled", label: "Telegram / Discord / LINE relay", hint: "Webhook mode; tokens stay in a 0600 file on the server." },
  { key: "rateLimitRetry", label: "Retry a 429 once", hint: "Uses more of a free minute-quota before moving to the next link." },
];

const box = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
  padding: "12px",
  marginBottom: "12px",
};

const small = { display: "block", marginTop: "4px", opacity: 0.75, fontSize: "0.78rem" };

function Row({ title, children }) {
  return (
    <div style={box}>
      <strong style={{ fontSize: "0.9rem" }}>{title}</strong>
      {children}
    </div>
  );
}

export default function OnlineSurfacesPanel({ showAlert }) {
  const [status, setStatus] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [report, setReport] = useState(null);
  const [lan, setLan] = useState(null);
  const [pairToken, setPairToken] = useState("");
  const [channels, setChannels] = useState(null);
  const [channelPlatform, setChannelPlatform] = useState("telegram");
  const [channelToken, setChannelToken] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [busy, setBusy] = useState("");

  const post = useCallback(async (url, body) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed: ${url}`);
    }
    return data;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [statusResult, ledgerResult, lanResult, channelsResult, catalogResult] = await Promise.all([
        fetch("/api/online-surfaces/status").then((r) => r.json()),
        fetch("/api/egress/ledger").then((r) => r.json()),
        fetch("/api/lan/status").then((r) => r.json()),
        fetch("/api/channels/status").then((r) => r.json()),
        fetch("/api/online-surfaces/catalog").then((r) => r.json()),
      ]);
      setStatus(statusResult.status || statusResult);
      setLedger(ledgerResult.entries || []);
      setLan(lanResult.lan || null);
      setChannels(channelsResult.channels || null);
      setCatalog(catalogResult.catalog || null);
    } catch {
      // The server is not up yet; the panel simply stays unconfigured.
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async (key, value) => {
    setBusy(key);
    try {
      const result = await post("/api/online-surfaces/config", { [key]: value });
      setStatus(result.status || null);
    } catch (error) {
      showAlert?.({ title: "Online surfaces", message: error.message || String(error) });
    } finally {
      setBusy("");
    }
  };

  const loadReport = async () => {
    setBusy("report");
    try {
      const data = await fetch("/api/egress/report").then((r) => r.json());
      setReport(data.report || null);
    } catch {
      setReport(null);
    } finally {
      setBusy("");
    }
  };

  const clearLedger = async () => {
    setBusy("clear");
    try {
      await post("/api/egress/clear", { confirm: true });
      setReport(null);
      await refresh();
    } catch (error) {
      showAlert?.({ title: "Egress Ledger", message: error.message || String(error) });
    } finally {
      setBusy("");
    }
  };

  const pairDevice = async () => {
    setBusy("lan");
    try {
      const data = await post("/api/lan/pair", { confirm: true });
      setPairToken(data.token || "");
      await refresh();
    } catch (error) {
      showAlert?.({ title: "LAN pairing", message: error.message || String(error) });
    } finally {
      setBusy("");
    }
  };

  const revokeDevice = async () => {
    setBusy("lan");
    try {
      await post("/api/lan/revoke", {});
      setPairToken("");
      await refresh();
    } catch (error) {
      showAlert?.({ title: "LAN pairing", message: error.message || String(error) });
    } finally {
      setBusy("");
    }
  };

  const saveChannel = async () => {
    setBusy("channels");
    try {
      const data = await post("/api/channels/config", {
        platform: channelPlatform,
        enabled: true,
        token: channelToken,
        webhookSecret: channelSecret,
      });
      setChannels(data.channels || null);
      setChannelToken("");
      setChannelSecret("");
    } catch (error) {
      showAlert?.({ title: "Channels", message: error.message || String(error) });
    } finally {
      setBusy("");
    }
  };

  const testChannel = async () => {
    setBusy("channels");
    try {
      await post("/api/channels/test", { platform: channelPlatform });
      await refresh();
    } catch (error) {
      showAlert?.({ title: "Channels", message: error.message || String(error) });
    } finally {
      setBusy("");
    }
  };

  const config = status?.config || {};
  const badge = status?.badge || { label: "Offline by default", tone: "safe" };
  const egress = status?.egress || { entries: 0, allowed: 0, blocked: 0, paidCalls: 0 };

  return (
    <div className="settings-expanded-content">
      <div className="settings-subsection">
        <div className="settings-subsection-title">
          <Globe2 size={16} /> Online surfaces
        </div>
        <div className="m3-field-group">
          <span className="settings-option-desc" style={{ display: "block", marginBottom: "12px" }}>
            LUKE runs offline by default. When you turn a surface on, it uses free tiers first,
            never pays, and writes every departure to a ledger you can read. The badge is computed
            from that ledger — it cannot claim air-gap while something went out.
          </span>

          <Row title="Current state">
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
              <span className="settings-value-badge">
                {badge.tone === "online" ? "● " : "○ "}{badge.label}
              </span>
              <span className="settings-option-desc">
                {egress.allowed} outbound · {egress.blocked} blocked · {egress.paidCalls} paid
              </span>
            </div>
            <span style={small}>
              Catalogue: {catalog?.count ?? "—"} providers, verified {catalog?.verifiedAt || "—"}
            </span>
            <span style={small}>
              No paid provider is registered — billed, prepaid and card-backed services were removed
              from the code, so there is no switch that can bring one back.
            </span>
            <button type="button" className="m3-button-outlined" style={{ marginTop: "8px" }} onClick={refresh}>
              <RefreshCw size={14} /> Refresh
            </button>
          </Row>

          <Row title="Policy switches">
            {SWITCHES.map((item) => (
              <label key={item.key} style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginTop: "8px" }}>
                <input
                  type="checkbox"
                  checked={config[item.key] === true}
                  disabled={busy === item.key}
                  onChange={(event) => toggle(item.key, event.target.checked)}
                />
                <span className="settings-option-desc">
                  {item.label}
                  <span style={small}>{item.hint}</span>
                </span>
              </label>
            ))}
          </Row>

          <Row title="Egress Ledger — proof, not a promise">
            <span className="settings-option-desc">
              {ledger.length} recent entries. Keys and prompt text are never written here.
            </span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              <button type="button" className="m3-button-filled" disabled={busy === "report"} onClick={loadReport}>
                <ShieldCheck size={14} /> Air-gap report
              </button>
              <button type="button" className="m3-button-outlined" onClick={() => fetch("/api/egress/report?format=text").then((r) => r.text()).then((t) => navigator.clipboard?.writeText(t))}>
                <Copy size={14} /> Copy attestation
              </button>
              <button type="button" className="m3-button-outlined" disabled={busy === "clear"} onClick={clearLedger}>
                Clear window
              </button>
            </div>
            {report && (
              <pre style={{ marginTop: "10px", maxHeight: "180px", overflow: "auto", fontSize: "0.72rem", whiteSpace: "pre-wrap" }}>
                {report.attestation}
              </pre>
            )}
          </Row>

          <Row title="Other devices on this network">
            <span className="settings-option-desc">
              {lan?.enabled ? "Paired devices are allowed." : "Default-deny: other devices cannot call the API."}
            </span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              <button type="button" className="m3-button-filled" disabled={busy === "lan"} onClick={pairDevice}>
                <Radio size={14} /> Pair a device
              </button>
              <button type="button" className="m3-button-outlined" disabled={busy === "lan"} onClick={revokeDevice}>
                Revoke
              </button>
            </div>
            {pairToken && (
              <div style={{ marginTop: "8px" }}>
                <span className="settings-option-desc">Copy this token now — it is never shown again:</span>
                <code style={{ display: "block", marginTop: "4px", wordBreak: "break-all" }}>{pairToken}</code>
                <span style={small}>Send it as the x-luke-pair header from the other device.</span>
              </div>
            )}
          </Row>

          <Row title="Editors and other apps">
            <span className="settings-option-desc">
              OpenAI-compatible: <code>http://127.0.0.1:1420/v1</code> → <code>/chat/completions</code>
            </span>
            <span style={small}>
              MCP: POST /api/mcp with a JSON-RPC tools/list or tools/call request. Both surfaces obey free-only and air-gap mode.
            </span>
          </Row>

          <Row title="Channels (Telegram / Discord / LINE)">
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              <select className="m3-input" style={{ maxWidth: "160px" }} value={channelPlatform} onChange={(e) => setChannelPlatform(e.target.value)}>
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="line">LINE</option>
              </select>
              <input className="m3-input" type="password" style={{ maxWidth: "220px" }} placeholder="Bot token" value={channelToken} onChange={(e) => setChannelToken(e.target.value)} autoComplete="off" />
              <input className="m3-input" type="password" style={{ maxWidth: "220px" }} placeholder="Webhook secret" value={channelSecret} onChange={(e) => setChannelSecret(e.target.value)} autoComplete="off" />
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              <button type="button" className="m3-button-filled" disabled={busy === "channels"} onClick={saveChannel}>
                <Bot size={14} /> Save channel
              </button>
              <button type="button" className="m3-button-outlined" disabled={busy === "channels"} onClick={testChannel}>
                Dry-run test
              </button>
            </div>
            <span style={small}>
              {(channels?.platforms || []).map((item) => `${item.label}: ${item.configured ? "configured" : "not set"}`).join(" · ") || "No channels configured."}
            </span>
          </Row>

          <Row title="Media stays on this machine">
            <span className="settings-option-desc">
              Images (Stable Diffusion), speech (Whisper), voices (Kokoro) and image-to-video are
              generated locally. The online media subsystem, its endpoints and its switches were
              removed — there is no external image, video or audio generation endpoint to call.
            </span>
            <span style={small}>
              No media allowance to spend, no consent flow to approve, no billable fallback.
            </span>
          </Row>

          <Row title="Provider catalogue">
            <span className="settings-option-desc">
              {(catalog?.providers || []).filter((item) => item.transport).map((item) => item.label).join(" · ") || "—"}
            </span>
            <span style={small}>
              {catalog?.freeCount ?? 0} free · {catalog?.count ?? 0} registered entries — all free and card-free. Paid, prepaid and card-backed trial services were deleted, not skipped.
            </span>
          </Row>
        </div>
      </div>
    </div>
  );
}
