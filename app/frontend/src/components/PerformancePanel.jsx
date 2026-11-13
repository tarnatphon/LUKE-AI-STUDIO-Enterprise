import React, { useCallback, useEffect, useState } from "react";
import { Gauge, HardDriveDownload, Trash2, Zap } from "lucide-react";
import GovernorSettingsCard from "./GovernorSettingsCard.jsx";
import BackgroundModelCard from "./BackgroundModelCard.jsx";

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

// A measurement is a fact about this machine and this model. Keeping it only in
// component state means "Measure once" really means "measure once per visit",
// and the card goes back to claiming it knows nothing every time it is opened.
const MEASURED_KEY = "luke.performance.measured";

function readStoredMeasurement() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MEASURED_KEY) || "null");
    if (!parsed || !Number(parsed.tokensPerSecond)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeMeasurement(result, model) {
  try {
    window.localStorage.setItem(
      MEASURED_KEY,
      JSON.stringify({ ...result, model: String(model || ""), at: Date.now() }),
    );
  } catch {
    // A full or disabled localStorage must not lose the measurement on screen.
  }
}

/** "Measured just now" / "Measured 3 h ago" — a number without an age is a claim. */
function describeMeasurementAge(at) {
  const ageMs = Date.now() - (Number(at) || 0);
  if (!Number.isFinite(ageMs) || ageMs < 120000) return "Measured just now";
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 60) return `Measured ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Measured ${hours} h ago`;
  return `Measured ${Math.round(hours / 24)} d ago`;
}

export default function PerformancePanel({ pendingTextSettings, updateTextSetting, onApply, showAlert }) {
  const [plan, setPlan] = useState(null);
  const [cache, setCache] = useState(null);
  const [busy, setBusy] = useState("");
  const [measured, setMeasured] = useState(() => readStoredMeasurement());
  const [copying, setCopying] = useState(null);
  // The governor releases models when the machine is short; until this card
  // existed, that only ever appeared as a line in the terminal.
  const [governor, setGovernor] = useState(null);
  const [governorNote, setGovernorNote] = useState("");
  // What the mmap preference actually became. The Settings toggle holds the
  // preference; a filesystem can overrule it without changing it, and until this
  // card existed nothing said so.
  const [mmapStatus, setMmapStatus] = useState(null);
  // Every llama.cpp backend on the machine, including ones an earlier run left
  // behind. "Why are there two, and which one is stale" was a `ps` question.
  const [backends, setBackends] = useState(null);
  // Which model translates product names, so "no small model downloaded" is
  // visible here instead of only inside a translation that never happens.
  const [backgroundModel, setBackgroundModel] = useState(null);
  const [backgroundNote, setBackgroundNote] = useState("");
  // Everything this app owns stays on the disk the user chose. The internal
  // disk is only used for a disposable copy, and only when asked for.
  const [useInternalDisk, setUseInternalDisk] = useState(false);
  // What the Context Size slider above means when it says 0: the number the
  // app picks, the memory it has to work with, and the price of the next step.
  const [contextPlan, setContextPlan] = useState(null);
  // The loads this app has actually measured, not just the last one, so the
  // argument for the internal-disk copy is backed by this machine's own numbers.
  const [loadHistory, setLoadHistory] = useState(null);

  // A download started from this panel is followed here, not only in Text
  // Models: the card that offered the button is the card that reports it.
  const loadBackgroundModel = useCallback(async () => {
    try {
      const response = await fetch("/api/background-model");
      const data = await response.json();
      if (response.ok) setBackgroundModel(data.result || null);
    } catch {}
  }, []);

  const refresh = useCallback(async (internalDisk = useInternalDisk) => {
    try {
      const response = await fetch("/api/model-cache/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useInternalDisk: internalDisk }),
      });
      const data = await response.json();
      if (response.ok) setCache(data.result || null);
    } catch {}
    try {
      // No `isGpuMode` guess: the server decides from the backend it will
      // actually run, so the numbers on this card are the numbers the machine
      // uses — and the numbers the first launch applied.
      const planResponse = await fetch("/api/llm/performance-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const planData = await planResponse.json();
      if (planResponse.ok) setPlan(planData);
    } catch {}
    try {
      const contextResponse = await fetch("/api/llm/context-plan");
      const contextData = await contextResponse.json();
      setContextPlan(contextResponse.ok ? contextData : null);
    } catch {
      setContextPlan(null);
    }
    try {
      const statusResponse = await fetch("/api/llm/status");
      const statusData = await statusResponse.json();
      if (statusResponse.ok) {
        setMmapStatus(statusData.mmap || null);
        setLoadHistory({
          entries: Array.isArray(statusData.loadHistory) ? statusData.loadHistory : [],
          summary: statusData.loadSummary || null,
        });
      }
    } catch {}
    try {
      const processResponse = await fetch("/api/llm/processes");
      const processData = await processResponse.json();
      if (processResponse.ok) setBackends(processData || null);
    } catch {}
    try {
      const governorResponse = await fetch("/api/resource-governor");
      const governorData = await governorResponse.json();
      if (governorResponse.ok) setGovernor(governorData.result || null);
    } catch {}
    await loadBackgroundModel();
  }, [loadBackgroundModel]);

  const mmapOverridden = Boolean(mmapStatus?.model) && (mmapStatus?.requested !== false) !== (mmapStatus?.effective !== false);
  const mmapNote = (() => {
    if (!mmapStatus?.model) return "";
    const effective = mmapStatus.effective !== false;
    const when = mmapStatus.loaded ? "The running model" : "The next load";
    const where = mmapStatus.filesystem ? ` on ${mmapStatus.filesystem}` : "";
    if (!mmapOverridden) {
      return `${when} ${effective ? "memory-maps the model file (--mmap)" : "reads the model file instead of mapping it (--no-mmap)"}${where}.`;
    }
    return `${when} uses ${effective ? "--mmap" : "--no-mmap"}, not what Settings asks for: ${mmapStatus.reason || "this volume decides it."}`;
  })();

  const saveGovernor = async (overrides) => {
    setBusy("governor-save");
    setGovernorNote("");
    try {
      const response = await fetch("/api/resource-governor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: overrides || {} }),
      });
      const data = await response.json();
      if (response.ok) {
        setGovernor(data.result || null);
        const rejected = Array.isArray(data.rejected) ? data.rejected : [];
        setGovernorNote(
          rejected.length
            ? `Saved, but not everything was accepted — ${rejected.map((entry) => `${entry.key}: ${entry.reason}`).join(" · ")}`
            : "Saved — the next sweep uses these numbers."
        );
      } else {
        setGovernorNote(data.error || "The governor settings could not be saved.");
      }
    } catch (error) {
      setGovernorNote(error?.message || "The governor settings could not be saved.");
    } finally {
      setBusy("");
    }
  };

  // One click on a catalogue model: the same queue Text Models uses, so the
  // download, the checksum and the progress bar are the ones already built.
  const downloadBackgroundModel = async (suggestion) => {
    if (!suggestion || !suggestion.modelId) return;
    setBusy("background-download");
    setBackgroundNote("");
    try {
      const response = await fetch("/api/text-models/download-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: suggestion.modelId, variantId: suggestion.variantId }),
      });
      const data = await response.json();
      if (response.ok) {
        setBackgroundNote(`${suggestion.filename} was added to the download queue.`);
        await loadBackgroundModel();
      } else {
        setBackgroundNote(data.error || "That model could not be queued.");
      }
    } catch (error) {
      setBackgroundNote(error?.message || "That model could not be queued.");
    } finally {
      setBusy("");
    }
  };

  const resetGovernor = async () => {
    setBusy("governor-reset");
    setGovernorNote("");
    try {
      const response = await fetch("/api/resource-governor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await response.json();
      if (response.ok) {
        setGovernor(data.result || null);
        setGovernorNote("Back to the values shipped for this machine.");
      } else {
        setGovernorNote(data.error || "Could not reset the governor settings.");
      }
    } catch (error) {
      setGovernorNote(error?.message || "Could not reset the governor settings.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    void refresh(useInternalDisk);
  }, [refresh, useInternalDisk]);

  // Only while a download is actually moving: three seconds is enough to watch
  // a progress bar, and the poll stops the moment the queue says it is done.
  useEffect(() => {
    if (!backgroundModel?.download?.active) return undefined;
    const timer = setInterval(() => {
      void loadBackgroundModel();
    }, 3000);
    return () => clearInterval(timer);
  }, [backgroundModel?.download?.active, loadBackgroundModel]);

  // What the one-time tune did on first launch, in the words of the machine it
  // did it to. Without this the values simply appeared, and an overridden
  // thread count looked like a setting that had never been touched.
  const tunedNote = pendingTextSettings?.runtimeTunedNote || null;
  // The tune records the backend it was planned for. If the machine now runs
  // models somewhere else (Metal stopped validating, a GPU was installed, the
  // user switched backend), those numbers are someone else's: say so instead of
  // presenting a stale decision as the current one.
  const tunedModeMismatch = Boolean(tunedNote)
    && Boolean(plan)
    && typeof plan.isGpuMode === "boolean"
    && typeof tunedNote.gpuMode === "boolean"
    && tunedNote.gpuMode !== plan.isGpuMode;
  const tunedMachine = (() => {
    if (!tunedNote) return "";
    const bits = [
      tunedNote.cpu,
      tunedNote.cores ? `${tunedNote.cores} cores` : "",
      tunedNote.ramGb ? `${Math.round(tunedNote.ramGb)} GB` : "",
    ].filter(Boolean).join(", ");
    const target = tunedNote.gpuMode
      ? `the GPU${tunedNote.gpu ? ` (${tunedNote.gpu})` : ""}`
      : "the CPU";
    return bits ? `${bits}, running on ${target}` : `this machine, running on ${target}`;
  })();

  const contextLine = (() => {
    if (!contextPlan?.plan) return "";
    const { plan, automatic, savedContextSize, next } = contextPlan;
    const model = contextPlan.model || "";
    const kvSource = plan.usedLearnedKv
      ? "measured from llama.cpp"
      : "an estimate until the model has run once";
    const head = savedContextSize > 0
      ? `Saved: ${contextPlan.effective} tokens${model ? ` for ${model}` : ""}. Automatic would use ${automatic}.`
      : `Automatic: ${automatic} tokens${model ? ` for ${model}` : ""}.`;
    const budget = `The model budget is ${plan.poolGb} GB, ${plan.freeGb} GB is free after the model and the GPU buffer, and ${plan.kvBudgetGb} GB of that is set aside for the KV cache at ${plan.kvGbPer4096} GB per 4096 tokens (${kvSource}).`;
    const nextNote = !next
      ? ""
      : next.fits
        ? ` The next step up, ${next.tokens}, also fits: it needs ${next.kvGb} GB of KV cache.`
        : ` ${next.tokens} tokens would need ${next.kvGb} GB of KV cache — ${next.overByGb} GB more than that — so the app stops at ${automatic}. Drag the slider to take the larger window anyway.`;
    const manual = savedContextSize > automatic
      ? " A window larger than the budget is the reason macOS compresses memory for this model."
      : "";
    // The slider can hold an edit that has not been saved; the line describes
    // what the load will do, so it has to say which is which.
    const pendingContext = Number(pendingTextSettings?.contextSize) || 0;
    const pendingNote = pendingContext === savedContextSize
      ? ""
      : ` The slider above shows ${pendingContext > 0 ? pendingContext : "automatic"}, which is not saved yet.`;
    return `${head} ${budget}${nextNote}${manual}${pendingNote}`;
  })();

  // Three lines are enough to see the pattern; the average above them is the
  // part that answers "is it always like this?".
  const historyLines = (loadHistory?.entries || []).slice(0, 3).map((entry) => {
    const when = new Date(Number(entry.at) || Date.now());
    const stamp = Number.isNaN(when.getTime())
      ? ""
      : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const seconds = Math.round((Number(entry.elapsedMs) || 0) / 1000);
    const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
    const rate = Number(entry.bytesPerSecond) || 0;
    const bySpeed = rate > 0 ? ` at ${Math.round(rate / 1024 / 1024)} MB/s` : "";
    return `${entry.filename} — ${duration}${bySpeed} · ${entry.cached ? "internal copy" : "the model's own disk"}${stamp ? ` · ${stamp}` : ""}`;
  });

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
      setMeasured({ ...data.result, model: String(mmapStatus?.model || ""), at: Date.now() });
      storeMeasurement(data.result, mmapStatus?.model);
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
    // The note that explains the values has to follow them, or it describes a
    // tune that is no longer the one running.
    updateTextSetting("runtimeTunedNote", {
      ...(tunedNote || {}),
      threads: recommended.threads,
      keptThreads: false,
      batchSize: recommended.batchSize,
      ubatchSize: recommended.ubatchSize,
      reasonThreads: String(recommended.reason?.threads || ""),
      reasonBatch: String(recommended.reason?.batchSize || ""),
      appliedByUser: true,
    });
    if (typeof onApply === "function") onApply();
  };

  const copyToInternalDisk = async (modelPath, scope) => {
    setCopying(modelPath);
    try {
      const response = await fetch("/api/model-cache/prime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelPath, scope, useInternalDisk }),
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
      const response = await fetch("/api/model-cache/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useInternalDisk }) });
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
  // A draft model has to be a GGUF llama.cpp can run, so the cache list is
  // filtered back to text models here even though the cache itself now also
  // holds image models.
  const modelOptions = (cache?.plans || []).filter((entry) => entry.kind !== "image").map((entry) => entry.source);
  const externalModels = (cache?.plans || []).filter((entry) => entry.external && !entry.cached);
  const draftFit = plan?.draft;

  return (
    <div style={rowStyle} id="performance-panel">
      <div style={headingStyle}>
        <Gauge size={15} />
        <strong>Performance &amp; model cache</strong>
      </div>

      {contextPlan?.plan && (
        <>
          <div style={{ ...headingStyle, marginTop: 12 }}>
            <strong>Context window (the slider above)</strong>
          </div>
          <span style={descStyle}>{contextLine}</span>
        </>
      )}

      <span style={descStyle}>
        {measured?.tokensPerSecond
          ? `${describeMeasurementAge(measured.at)}${measured.model ? ` on ${measured.model}` : ""}: ${measured.tokensPerSecond.toFixed(1)} tokens/s to write, ${(measured.promptTokensPerSecond || 0).toFixed(0)} tokens/s to read the chat.`
          : measured?.error
            ? measured.error
            : "Measure once to see what this machine actually does — then tune with numbers instead of guesses."}
        {" "}This card is Settings → Text Generation → Performance; the app links straight here from the model cards.
      </span>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={measure} disabled={busy === "measure"}>
          <Zap size={13} />
          {busy === "measure" ? "Measuring…" : measured?.tokensPerSecond ? "Measure again" : "Measure speed"}
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
      {loadHistory?.summary?.message && (
        <>
          <div style={{ ...headingStyle, marginTop: 14 }}>
            <strong>Load history</strong>
          </div>
          <span style={descStyle}>{loadHistory.summary.message}</span>
          {historyLines.map((line) => (
            <span key={line} style={{ ...descStyle, display: "block", fontFamily: "monospace", fontSize: "0.74rem" }}>
              {line}
            </span>
          ))}
        </>
      )}
      {tunedNote && (
        <span style={descStyle}>
          {`${tunedNote.appliedByUser ? "Applied from this card" : tunedNote.backfilled ? "Already in place from an earlier tune" : "Applied for you on first launch"}: ${tunedNote.keptThreads ? `threads left at your ${tunedNote.threads}` : `${tunedNote.threads} threads`}, batch ${tunedNote.batchSize}, ubatch ${tunedNote.ubatchSize}.`}
          {tunedMachine ? ` Chosen for ${tunedMachine}.` : ""}
          {` Why: ${tunedNote.reasonThreads}${tunedNote.reasonBatch ? ` — and batch ${tunedNote.batchSize} because ${tunedNote.reasonBatch}` : ""}.`}
          {tunedNote.appliedByUser ? "" : " Nothing is re-applied after this; the button above changes the values only when you press it."}
        </span>
      )}
      {tunedModeMismatch && (
        <span style={{ ...descStyle, color: "var(--md-sys-color-error)" }}>
          Those values were planned for {tunedNote.gpuMode ? "the GPU" : "the CPU"}, and this machine now runs models on{" "}
          {plan.isGpuMode ? "the GPU" : "the CPU"}. Press the button above to plan them again for the current backend.
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
      <span style={descStyle}>
        Everything this app keeps — models, chats, outputs — stays on the disk the app runs from. Nothing is moved to the machine's own
        disk unless you ask for it below.
      </span>
      {backends?.processes?.length > 0 && (
        <span style={descStyle}>
          Running: {backends.processes
            .map((process) => `${process.owner} · ${process.model || "?"} on port ${process.port ?? "?"} · ${process.mmapFlag || "mmap default"}`)
            .join("  |  ")}
        </span>
      )}
      {backends?.orphans?.length > 0 && (
        <span style={{ ...descStyle, color: "var(--md-sys-color-error)" }}>
          {backends.orphans.length} llama.cpp {backends.orphans.length === 1 ? "process" : "processes"} left behind by an earlier run
          ({backends.orphans.map((orphan) => `pid ${orphan.pid}${orphan.model ? ` ${orphan.model}` : ""}${orphan.mmapFlag ? ` ${orphan.mmapFlag}` : ""}`).join(", ")}).
          Stop the app and run <code>pkill -f llama-server</code> before loading again, or they will compete for memory.
        </span>
      )}
      {mmapNote && (
        <span style={{ ...descStyle, color: mmapOverridden ? "var(--md-sys-color-error)" : "var(--md-sys-color-outline)" }}>
          {mmapNote}
        </span>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: ".7rem", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={useInternalDisk}
          onChange={(event) => setUseInternalDisk(event.target.checked)}
        />
        Use the internal disk for a temporary {externalModels[0]?.sizeGb ? `${externalModels[0].sizeGb} GB ` : ""}copy (faster loading, deletable any time)
      </label>
      {!useInternalDisk && (
        <span style={descStyle}>
          Off: the model is loaded from your external disk every time. Turning this on trades internal disk space for much faster loading;
          your model itself never moves.
        </span>
      )}
      {useInternalDisk && externalModels.length === 0 && (
        <span style={descStyle}>
          {cache?.cachedGb > 0
            ? `${cache.cachedGb} GB cached. Models load from the internal disk; the originals stay on your external disk.`
            : "Nothing to copy — every model is already on the same disk as the cache."}
        </span>
      )}
      {useInternalDisk && externalModels.length > 0 && (
        <>
          <span style={descStyle}>
            Copying {externalModels.length === 1 ? "this model" : "these models"} to the internal disk turns a slow load into a few seconds.
            The copy is disposable: delete it any time and the model on your external disk is untouched. An image model is a folder of
            tens of thousands of small files, which is the slowest thing an external disk can be asked to read, so it gains the most.
          </span>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
            {externalModels.map((entry) => (
              <li key={entry.source} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: ".7rem" }}>
                <code style={{ flex: 1, minWidth: "8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.source.split("/").pop()}</code>
                <span style={{ color: "var(--md-sys-color-outline)" }}>{entry.label || (entry.kind === "image" ? "Image model" : "Text model")}</span>
                <span style={{ color: "var(--md-sys-color-outline)" }}>{entry.sizeGb} GB</span>
                {/* A copy that does not fit fails minutes in; say so instead. */}
                {entry.fits === false ? (
                  <span style={{ color: "var(--md-sys-color-error)", flexBasis: "100%" }}>
                    Needs about {Math.round((Number(entry.neededBytes) / 1024 ** 3) * 10) / 10} GB free; this disk has {entry.freeGb} GB.
                    Delete a cached model or free some space.
                  </span>
                ) : entry.freeGb !== null && entry.freeGb !== undefined ? (
                  <span style={{ color: "var(--md-sys-color-outline)" }}>{entry.freeGb} GB free</span>
                ) : null}
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => copyToInternalDisk(entry.source, entry.kind)}
                  disabled={copying === entry.source || entry.fits === false}
                  title={entry.fits === false ? "There is not enough room on the internal disk for this copy." : undefined}
                >
                  <HardDriveDownload size={13} />
                  {copying === entry.source ? "Copying…" : "Copy"}
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

      <BackgroundModelCard
        data={backgroundModel}
        busy={busy}
        note={backgroundNote}
        onDownload={downloadBackgroundModel}
      />

      <GovernorSettingsCard
        data={governor}
        busy={busy}
        note={governorNote}
        onSave={saveGovernor}
        onReset={resetGovernor}
      />
    </div>
  );
}
