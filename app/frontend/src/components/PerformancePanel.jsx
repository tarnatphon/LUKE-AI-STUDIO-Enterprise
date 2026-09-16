import React, { useCallback, useEffect, useState } from "react";
import { Gauge, HardDriveDownload, Trash2, Zap } from "lucide-react";

/**
 * Speed lives in three places: how the runtime is tuned, whether a draft model
 * helps, and how long the model takes to come off disk. This panel puts the
 * three where the user can act on them, and measures instead of guessing.
 */

const rowStyle = {
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

const descStyle = { display: "block", marginTop: 4, color: "var(--md-sys-color-outline)", fontSize: ".68rem", lineHeight: 1.5 };

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

export default function PerformancePanel({ pendingTextSettings, updateTextSetting, onApply, showAlert }) {
  const [plan, setPlan] = useState(null);
  const [cache, setCache] = useState(null);
  const [busy, setBusy] = useState("");
  const [measured, setMeasured] = useState(null);
  const [copying, setCopying] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/model-cache/status");
      const data = await response.json();
      if (response.ok) setCache(data.result || null);
    } catch {}
    try {
      const planResponse = await fetch("/api/llm/performance-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isGpuMode: true }),
      });
      const planData = await planResponse.json();
      if (planResponse.ok) setPlan(planData);
    } catch {}
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const measure = async () => {
    setBusy("measure");
    try {
      const response = await fetch("/api/llm/measure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The model could not be measured.");
      setMeasured(data.result);
    } catch (error) {
      setMeasured({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  };

  const applyRecommended = () => {
    const recommended = plan?.recommended;
    if (!recommended) return;
    updateTextSetting("threads", recommended.threads);
    updateTextSetting("batchSize", recommended.batchSize);
    updateTextSetting("ubatchSize", recommended.ubatchSize);
    if (typeof onApply === "function") onApply();
  };

  const copyToInternalDisk = async (modelPath) => {
    setCopying(modelPath);
    try {
      const response = await fetch("/api/model-cache/prime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelPath }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The model could not be copied.");
      await refresh();
    } catch (error) {
      if (typeof showAlert === "function") showAlert({ title: "Could not cache the model", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setCopying(null);
    }
  };

  const clearCache = async () => {
    setBusy("clear");
    try {
      const response = await fetch("/api/model-cache/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The cache could not be cleared.");
      await refresh();
    } catch (error) {
      if (typeof showAlert === "function") showAlert({ title: "Could not clear the cache", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  };

  const recommended = plan?.recommended;
  const currentThreads = Number(pendingTextSettings?.threads) || 0;
  const currentBatch = Number(pendingTextSettings?.batchSize) || 0;
  const alreadyApplied = Boolean(recommended) && recommended.threads === currentThreads && recommended.batchSize === currentBatch;
  const modelOptions = (cache?.plans || []).map((entry) => entry.source);
  const externalModels = (cache?.plans || []).filter((entry) => entry.external && !entry.cached);
  const draftFit = plan?.draft;

  return (
    <div style={rowStyle}>
      <div style={headingStyle}>
        <Gauge size={15} />
        <strong>Performance</strong>
      </div>

      <span style={descStyle}>
        {measured?.tokensPerSecond
          ? `Measured just now: ${measured.tokensPerSecond.toFixed(1)} tokens/s to write, ${(measured.promptTokensPerSecond || 0).toFixed(0)} tokens/s to read the chat.`
          : measured?.error
            ? measured.error
            : "Measure once to see what this machine actually does — then tune with numbers instead of guesses."}
      </span>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={measure} disabled={busy === "measure"}>
          <Zap size={13} />
          {busy === "measure" ? "Measuring…" : "Measure speed"}
        </button>
        {recommended && (
          <button type="button" style={buttonStyle} onClick={applyRecommended} disabled={alreadyApplied}>
            <Gauge size={13} />
            {alreadyApplied ? "Using the tuned values" : `Use ${recommended.threads} threads · batch ${recommended.batchSize}`}
          </button>
        )}
      </div>
      {recommended && (
        <span style={descStyle}>
          Tuned for this machine: {recommended.reason.threads}, and batch {recommended.batchSize} because {recommended.reason.batchSize}.
        </span>
      )}

      <div style={{ ...headingStyle, marginTop: 14 }}>
        <Zap size={15} />
        <strong>Draft model (optional)</strong>
      </div>
      <select
        className="m3-input"
        value={pendingTextSettings?.draftModel || ""}
        onChange={(event) => updateTextSetting("draftModel", event.target.value)}
        style={{ marginTop: 6, width: "100%" }}
        aria-label="Draft model for speculative decoding"
      >
        <option value="">No draft model</option>
        {modelOptions.map((source) => (
          <option key={source} value={source}>{source.split("/").pop()}</option>
        ))}
      </select>
      <span style={descStyle}>
        A small draft model guesses the next tokens and the big model only checks them, which makes replies noticeably faster when there is memory to spare.
        {draftFit ? (draftFit.fits ? " It fits in the memory this machine has." : ` Not recommended here: ${draftFit.reason}.`) : ""}
      </span>

      <div style={{ ...headingStyle, marginTop: 14 }}>
        <HardDriveDownload size={15} />
        <strong>Model loading</strong>
      </div>
      {externalModels.length === 0 ? (
        <span style={descStyle}>
          {cache?.cachedGb > 0
            ? `${cache.cachedGb} GB cached on the internal disk. Models load from there instead of the external drive.`
            : "Every model is already on the internal disk, so loading is as fast as this machine can do it."}
        </span>
      ) : (
        <>
          <span style={descStyle}>
            {externalModels.length === 1 ? "This model is on an external drive" : "These models are on an external drive"}. Copying
            {externalModels.length === 1 ? " it" : " them"} to the internal disk once turns a very slow load into a few seconds.
          </span>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
            {externalModels.map((entry) => (
              <li key={entry.source} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".7rem" }}>
                <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.source.split("/").pop()}</code>
                <span style={{ color: "var(--md-sys-color-outline)" }}>{entry.sizeGb} GB</span>
                <button type="button" style={buttonStyle} onClick={() => copyToInternalDisk(entry.source)} disabled={copying === entry.source}>
                  <HardDriveDownload size={13} />
                  {copying === entry.source ? "Copying…" : "Copy to internal disk"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {cache?.cachedGb > 0 && (
        <button type="button" style={{ ...buttonStyle, marginTop: 8 }} onClick={clearCache} disabled={busy === "clear"}>
          <Trash2 size={13} />
          {busy === "clear" ? "Clearing…" : `Clear the ${cache.cachedGb} GB cache`}
        </button>
      )}
    </div>
  );
}
