import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LoaderCircle,
  Play,
  RefreshCw,
  Save,
  Square,
  Volume2,
} from "lucide-react";
import {
  getTtsStatus,
  listTtsModels,
  speakSystemTts,
  speakTts,
  startTts,
  stopTts,
} from "../services/api";

const FALLBACK_VOICES = [
  { id: "af_heart", name: "Heart", language: "en-us", gender: "Female" },
  { id: "af_bella", name: "Bella", language: "en-us", gender: "Female" },
  { id: "am_michael", name: "Michael", language: "en-us", gender: "Male" },
  { id: "bf_emma", name: "Emma", language: "en-gb", gender: "Female" },
  { id: "bm_george", name: "George", language: "en-gb", gender: "Male" },
];

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function TextToSpeech({
  showAlert,
  selectedOutput,
  onOutputsChanged,
  ttsSettings,
  setTtsSettings,
}) {
  const [status, setStatus] = useState({ ready: false, running: false, runtimeInstalled: false, settings: {}, voices: [] });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [text, setText] = useState("Hello from LUKE AI STUDIO text to speech.");
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [output, setOutput] = useState(null);
  const abortRef = useRef(null);

  const installedModels = useMemo(() => models.filter((model) => model.installed), [models]);
  const voices = status.voices?.length ? status.voices : FALLBACK_VOICES;
  const selectedVoice = ttsSettings?.voice || "af_heart";
  const speed = ttsSettings?.speed || 1;
  const engine = ttsSettings?.engine || "kokoro";
  const systemTts = status.systemTts || null;
  const systemEngineAvailable = !!systemTts?.available;
  const systemVoices = useMemo(() => {
    const list = Array.isArray(systemTts?.voices) ? systemTts.voices : [];
    return [...list].sort((a, b) => {
      const aThai = String(a.language).toLowerCase().startsWith("th") ? 1 : 0;
      const bThai = String(b.language).toLowerCase().startsWith("th") ? 1 : 0;
      if (aThai !== bThai) return bThai - aThai;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [systemTts?.voices]);
  const hasThaiSystemVoice = systemVoices.some((voice) => String(voice.language).toLowerCase().startsWith("th"));
  const selectedSystemVoice = ttsSettings?.systemVoice
    || systemVoices.find((voice) => String(voice.language).toLowerCase().startsWith("th"))?.id
    || systemVoices[0]?.id
    || "";
  const usingSystemEngine = engine === "system";

  const updateTtsSetting = (key, value) => {
    setTtsSettings((prev) => ({ ...prev, [key]: value }));
  };

  const switchEngine = (nextEngine) => {
    if (nextEngine === engine) return;
    updateTtsSetting("engine", nextEngine);
    if (nextEngine === "system" && text.trim() === "Hello from LUKE AI STUDIO text to speech.") {
      setText("สวัสดีครับ ยินดีต้อนรับสู่ LUKE AI STUDIO ทุกเสียงนี้สร้างขึ้นบนเครื่องของคุณ โดยไม่ต้องใช้อินเทอร์เน็ต");
    }
  };

  const refresh = useCallback(async () => {
    const [nextStatus, nextModels] = await Promise.all([
      getTtsStatus(),
      listTtsModels(),
    ]);
    setStatus(nextStatus);
    setModels(nextModels);
    setSelectedModel((current) => {
      const installed = nextModels.filter((model) => model.installed);
      if (current && installed.some((model) => model.filename === current || model.id === current)) return current;
      const active = nextStatus.settings?.model;
      if (active && installed.some((model) => model.filename === active)) return active;
      const preferred = ttsSettings?.model;
      if (preferred && installed.some((model) => model.filename === preferred)) return preferred;
      return installed.find((model) => model.recommended)?.filename || installed[0]?.filename || "";
    });
  }, [ttsSettings?.model]);

  useEffect(() => {
    refresh().catch((err) => showAlert?.({ title: "TTS Status Failed", message: err.message || String(err), danger: true }));
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(interval);
  }, [refresh, showAlert]);

  useEffect(() => {
    if (!selectedOutput) return;
    setOutput(selectedOutput);
    setText(selectedOutput.text || "");
    if (selectedOutput.model === "macos-system") {
      updateTtsSetting("engine", "system");
      if (selectedOutput.voice) updateTtsSetting("systemVoice", selectedOutput.voice);
      if (selectedOutput.speed) updateTtsSetting("speed", selectedOutput.speed);
      return;
    }
    if (selectedOutput.voice) updateTtsSetting("voice", selectedOutput.voice);
    if (selectedOutput.speed) updateTtsSetting("speed", selectedOutput.speed);
    if (selectedOutput.model) setSelectedModel(selectedOutput.model);
  }, [selectedOutput]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleLoadModel = async () => {
    if (!selectedModel) return;
    setIsLoadingModel(true);
    try {
      await startTts(selectedModel, { voice: selectedVoice, speed });
      updateTtsSetting("model", selectedModel);
      await refresh();
    } catch (err) {
      showAlert?.({ title: "TTS Model Load Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopTts();
      await refresh();
    } catch (err) {
      showAlert?.({ title: "Stop TTS Failed", message: err.message || String(err), danger: true });
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) return;
    if (usingSystemEngine) {
      if (!systemEngineAvailable) {
        showAlert?.({ title: "System Voice Unavailable", message: "macOS System Voice TTS is only available on macOS.", danger: true });
        return;
      }
      if (!selectedSystemVoice) {
        showAlert?.({ title: "No System Voice", message: "No macOS system voices were found. Install a voice in System Settings → Accessibility → Spoken Content → System Voice → Manage Voices.", danger: true });
        return;
      }
      setIsGenerating(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const generated = await speakSystemTts(text, {
          voice: selectedSystemVoice,
          speed,
          signal: controller.signal,
        });
        setOutput(generated);
        await onOutputsChanged?.();
      } catch (err) {
        if (err.name !== "AbortError") {
          showAlert?.({ title: "System Voice Generation Failed", message: err.message || String(err), danger: true });
        }
      } finally {
        abortRef.current = null;
        setIsGenerating(false);
      }
      return;
    }
    if (!selectedModel) return;
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!status.ready || status.settings?.model !== selectedModel) {
        setIsLoadingModel(true);
        try {
          await startTts(selectedModel, { voice: selectedVoice, speed });
          updateTtsSetting("model", selectedModel);
          await refresh();
        } finally {
          setIsLoadingModel(false);
        }
      }
      const generated = await speakTts(text, {
        model: selectedModel,
        voice: selectedVoice,
        speed,
        signal: controller.signal,
      });
      setOutput(generated);
      await refresh();
      await onOutputsChanged?.();
    } catch (err) {
      if (err.name !== "AbortError") {
        showAlert?.({ title: "TTS Generation Failed", message: err.message || String(err), danger: true });
      }
    } finally {
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
  };

  const isLoaded = status.ready && status.settings?.model === selectedModel;

  return (
    <div className="workspace-area speech-workspace">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Text to Speech</h2>
        <p className="workspace-subtitle">
          Generate local WAV narration with Kokoro ONNX or macOS system voices (Thai-capable).
        </p>
      </div>

      <div className="speech-grid">
        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Runtime</h3>
            <span className={`status-chip ${usingSystemEngine ? (systemEngineAvailable ? "" : "offline") : (status.runtimeInstalled ? "" : "offline")}`}>
              {usingSystemEngine
                ? (systemEngineAvailable ? (systemVoices.length ? `${systemVoices.length} system voices` : "No voices found") : "macOS only")
                : (status.runtimeInstalled ? (status.ready ? "Ready" : "Installed") : "Runtime missing")}
            </span>
          </div>

          {status.error && !usingSystemEngine && <div className="text-progress error">{status.error}</div>}

          <div className="speech-controls-row">
            <label className="speech-label">
              Engine
              <select className="m3-input" value={engine} onChange={(event) => switchEngine(event.target.value)}>
                <option value="kokoro">Kokoro (English, offline model)</option>
                <option value="system" disabled={!systemEngineAvailable}>
                  {systemEngineAvailable ? "macOS System Voice (Thai & multilingual)" : "macOS System Voice (macOS only)"}
                </option>
              </select>
            </label>
          </div>

          {usingSystemEngine ? (
            <>
              <div className="speech-controls-row">
                <label className="speech-label">
                  System voice
                  <select className="m3-input" value={selectedSystemVoice} onChange={(event) => updateTtsSetting("systemVoice", event.target.value)}>
                    {systemVoices.length === 0 && <option value="">No system voices found</option>}
                    {systemVoices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {`${String(voice.language).toLowerCase().startsWith("th") ? "★ " : ""}${voice.name} (${voice.language})`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="speech-label">
                  Speed
                  <input
                    className="m3-input"
                    type="number"
                    min="0.5"
                    max="2"
                    step="0.05"
                    value={speed}
                    onChange={(event) => updateTtsSetting("speed", Math.max(0.5, Math.min(2, Number(event.target.value) || 1)))}
                  />
                </label>
              </div>
              {!hasThaiSystemVoice && systemVoices.length > 0 && (
                <div className="text-progress">
                  No Thai voice installed. Add one in System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, then click Refresh.
                </div>
              )}
              <div className="text-progress">
                System voices are spoken by macOS itself — no model download, works with Thai text (★ = Thai voices).
              </div>
            </>
          ) : (
            <>
              <label className="speech-label">
                Kokoro model
                <select className="m3-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                  {installedModels.length === 0 && <option value="">No downloaded TTS models</option>}
                  {installedModels.map((model) => (
                    <option key={model.id || model.filename} value={model.filename}>
                      {model.name || model.filename}
                    </option>
                  ))}
                </select>
              </label>

              <div className="speech-controls-row">
                <label className="speech-label">
                  Voice
                  <select className="m3-input" value={selectedVoice} onChange={(event) => updateTtsSetting("voice", event.target.value)}>
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} ({voice.gender}, {voice.language})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="speech-label">
                  Speed
                  <input
                    className="m3-input"
                    type="number"
                    min="0.5"
                    max="2"
                    step="0.05"
                    value={speed}
                    onChange={(event) => updateTtsSetting("speed", Math.max(0.5, Math.min(2, Number(event.target.value) || 1)))}
                  />
                </label>
              </div>
            </>
          )}

          <div className="speech-button-row">
            {!usingSystemEngine && (
              <button
                className="m3-btn m3-btn-filled"
                onClick={handleLoadModel}
                disabled={!selectedModel || isLoadingModel || isGenerating || isLoaded}
              >
                {isLoadingModel ? <LoaderCircle className="progress-spinner" size={14} /> : <Play size={14} />}
                <span>{isLoaded ? "Loaded" : isLoadingModel ? "Loading" : "Load"}</span>
              </button>
            )}
            <button className="m3-btn m3-btn-outlined" onClick={refresh}>
              <RefreshCw size={14} />
              <span>Refresh</span>
            </button>
            {!usingSystemEngine && status.ready && (
              <button className="m3-btn m3-btn-error" onClick={handleStop}>
                <Square size={14} />
                <span>Stop Runtime</span>
              </button>
            )}
          </div>

          {!usingSystemEngine && installedModels.length === 0 && (
            <div className="text-progress">
              Download a Kokoro model from Model Manager, TTS Models first — or switch Engine to macOS System Voice for Thai.
            </div>
          )}
        </section>

        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Input</h3>
            <span className="status-chip">{text.trim().length} chars</span>
          </div>
          <textarea
            className="m3-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            maxLength={5000}
            style={{ width: "100%", resize: "vertical", minHeight: "220px", lineHeight: 1.45 }}
            placeholder="Type text to turn into speech..."
          />
          <div className="speech-button-row">
            {isGenerating ? (
              <button className="m3-btn m3-btn-error" onClick={handleCancel}>
                <Square size={14} />
                <span>Cancel</span>
              </button>
            ) : (
              <button
                className="m3-btn m3-btn-filled"
                onClick={handleGenerate}
                disabled={!text.trim() || (usingSystemEngine ? (!systemEngineAvailable || !selectedSystemVoice) : (!selectedModel || !status.runtimeInstalled))}
              >
                <Volume2 size={14} />
                <span>Generate WAV</span>
              </button>
            )}
            {isGenerating && <span className="text-progress"><LoaderCircle className="progress-spinner" size={14} /> Generating locally...</span>}
          </div>
        </section>
      </div>

      <section className="m3-card speech-result-panel">
        <div className="speech-panel-header">
          <h3>Output</h3>
          <div className="speech-button-row">
            <button className="m3-btn m3-btn-outlined" onClick={() => output?.url && downloadUrl(output.url, output.audioFile || "tts.wav")} disabled={!output?.url}>
              <Save size={14} />
              <span>WAV</span>
            </button>
          </div>
        </div>
        {output?.url ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <audio controls src={output.url} style={{ width: "100%" }} />
            <div className="text-progress">
              {output.voiceName || output.voice} &bull; {output.modelName || output.model} &bull; {new Date(output.createdAt).toLocaleString()}
            </div>
            <textarea
              className="m3-input"
              value={output.text || text}
              onChange={(event) => setOutput((prev) => ({ ...(prev || {}), text: event.target.value }))}
              rows={5}
              style={{ width: "100%", resize: "vertical", minHeight: "120px", lineHeight: 1.45 }}
            />
          </div>
        ) : (
          <div className="empty-state" style={{ padding: "32px 0" }}>
            <Volume2 size={42} />
            <p>Generated speech will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
