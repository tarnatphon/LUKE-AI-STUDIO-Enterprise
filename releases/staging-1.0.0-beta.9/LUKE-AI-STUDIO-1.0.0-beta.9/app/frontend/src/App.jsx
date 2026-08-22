import { Component, lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import TopStatusBar from "./components/TopStatusBar";
import Home from "./components/Home";
import { cleanupCandidates, formatBytes, getCleanupCandidates, getDiagnostics, getHardwareSpecs, getHealth, getTelemetry, getBackendOptions, getBackendStatus, listGeneratedOutputs, listLlmConversations, saveLlmConversation, deleteLlmConversation, listSpeechTranscriptions, deleteSpeechTranscription, listTtsOutputs, deleteTtsOutput, stopServer } from "./services/api";
import "./App.css";

const workspaceLoaders = {
  generator: () => import("./components/Generator"),
  models: () => import("./components/ModelManager"),
  settings: () => import("./components/Settings"),
  chat: () => import("./components/TextChat"),
  speech: () => import("./components/SpeechTranscriber"),
  tts: () => import("./components/TextToSpeech"),
  "image-video": () => import("./components/ImageToVideo"),
  assets: () => import("./components/AssetLibrary"),
};

const workspacePrefetches = new Map();

function preloadWorkspace(tab) {
  const load = workspaceLoaders[tab];
  if (!load) return Promise.resolve(null);
  if (workspacePrefetches.has(tab)) return workspacePrefetches.get(tab);

  const request = Promise.resolve()
    .then(load)
    .catch((error) => {
      workspacePrefetches.delete(tab);
      console.warn(`Workspace prefetch failed for ${tab}; navigation can retry.`, error);
      return null;
    });
  workspacePrefetches.set(tab, request);
  return request;
}

const Generator = lazy(workspaceLoaders.generator);
const ModelManager = lazy(workspaceLoaders.models);
const Settings = lazy(workspaceLoaders.settings);
const TextChat = lazy(workspaceLoaders.chat);
const SpeechTranscriber = lazy(workspaceLoaders.speech);
const TextToSpeech = lazy(workspaceLoaders.tts);
const ImageToVideo = lazy(workspaceLoaders["image-video"]);
// LUKE_AI_RUNTIME_DASHBOARD_V1
const RuntimeDownloadDashboard = lazy(() => import("./components/RuntimeDownloadDashboard"));
// LUKE_AI_TEXT_MODEL_MANAGER_UI_V1
const TextModelManager = lazy(() => import("./components/TextModelManager"));
// LUKE_AI_PERSISTENT_TEXT_CHAT_UI_V1
const PersistentTextChat = lazy(() => import("./components/PersistentTextChat"));
// LUKE_AI_ASSET_LIBRARY_UI_V1
const AssetLibrary = lazy(workspaceLoaders.assets);

const WorkspaceFallback = () => (
  <div className="workspace-loading" role="status" aria-live="polite">
    Loading workspace…
  </div>
);

class WorkspaceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Workspace failed to load", error, info);
  }

  returnHome = () => {
    this.setState({ error: null });
    this.props.onReturnHome();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="workspace-load-error" role="alert" aria-live="assertive">
        <strong>Workspace could not be loaded.</strong>
        <span>Your current data is still stored locally. Retry the app or return Home.</span>
        <div className="workspace-load-error-actions">
          <button type="button" className="m3-btn m3-btn-filled" onClick={() => window.location.reload()}>
            Retry
          </button>
          <button type="button" className="m3-btn m3-btn-outlined" onClick={this.returnHome}>
            Return Home
          </button>
        </div>
      </div>
    );
  }
}

const WorkspacePanel = ({ tab, activeTab, onReturnHome, overflow = "hidden", children }) => (
  <div style={{ display: activeTab === tab ? "flex" : "none", flex: 1, flexDirection: "column", overflow }}>
    <WorkspaceErrorBoundary onReturnHome={() => onReturnHome(tab)}>
      {children}
    </WorkspaceErrorBoundary>
  </div>
);

function App() {
  const dialogResolverRef = useRef(null);
  const [dialog, setDialog] = useState(null);

  const closeDialog = useCallback((value) => {
    const resolver = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    if (resolver) resolver(value);
  }, []);

  const showConfirm = useCallback(({ title = "Confirm Action", message, confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) => {
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
      setDialog({ type: "confirm", title, message, confirmLabel, cancelLabel, danger });
    });
  }, []);

  const showAlert = useCallback(({ title = "Notice", message, confirmLabel = "OK", danger = false }) => {
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
      setDialog({ type: "alert", title, message, confirmLabel, danger });
    });
  }, []);

  // Theme State
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Navigation
  const [activeTab, setActiveTab] = useState("home");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["home"]));

  useEffect(() => {
    setVisitedTabs((current) => {
      if (current.has(activeTab)) return current;
      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const recoverFailedWorkspace = useCallback((failedTab) => {
    setVisitedTabs((current) => {
      if (!current.has(failedTab)) return current;
      const next = new Set(current);
      next.delete(failedTab);
      return next;
    });
    setActiveTab("home");
  }, []);

  const prefetchWorkspace = useCallback((tab) => {
    void preloadWorkspace(tab);
  }, []);

  // Prompts
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  // Model & Server Status
  const [activeModel, setActiveModel] = useState(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [isStoppingServer, setIsStoppingServer] = useState(false);
  const [isLlmLoaded, setIsLlmLoaded] = useState(false);
  const [backendOptions, setBackendOptions] = useState({
    options: [{ id: "cpu", label: "CPU", available: true }],
    cudaAvailable: false,
    vulkanAvailable: false,
    defaultBackendType: "cpu",
  });
  const [health, setHealth] = useState(null);
  const [cleanupItems, setCleanupItems] = useState([]);
  const [isReadinessBusy, setIsReadinessBusy] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  // Gallery History
  const [generatedImages, setGeneratedImages] = useState([]);

  // Generation status
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  // System Specifications & Telemetry
  const [specs, setSpecs] = useState({
    os_name: "Loading Specs...",
    cpu_name: "Loading Specs...",
    cpu_cores_physical: 4,
    cpu_cores_logical: 8,
    ram_total_gb: 0,
    gpu_name: "Loading Specs...",
  });

  const [telemetry, setTelemetry] = useState({
    cpu_usage: 0,
    ram_used_gb: 0,
    ram_total_gb: 0,
    gpu_name: "Detecting...",
    vram_used_gb: 0,
    vram_total_gb: 0,
  });

  // Default Image Constraints
  const [constraints, setConstraints] = useState({
    width: 1024,
    height: 1024,
    steps: 4,          // Recommended default steps for Flux.1 Schnell/Lightning
    npuSteps: 4,
    standardSteps: 20,
    cfgScale: 1.0,     // Recommended default CFG for Flux.1 Schnell
    sampler: "euler_a",
    seed: -1,
    denoisingStrength: 0.7,
    useGpu: true,
    useTaesd: true,
    useFlashAttn: true,
    useTiling: false,
    vaeTiling: true,
    vaeOnCpu: false,
    threads: 4,
    backendType: "auto",
  });

  const [textSettings, setTextSettings] = useState(() => {
    const saved = localStorage.getItem("textSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          enableThinking: parsed.enableThinking === true,
          maxTokens: !parsed.maxTokens || parsed.maxTokens === 384 ? 1024 : parsed.maxTokens,
          responseTokenMode: parsed.responseTokenMode || "auto",
        };
      } catch (_) {}
    }
    return {
      contextSize: 0,
      temperature: 0.7,
      systemPrompt: "You are a helpful local AI assistant.",
      threads: Math.max(4, Math.min(16, (navigator.hardwareConcurrency || 4) - 2)),
      enableThinking: false,
      // New performance settings
      gpuLayers: -1,
      maxTokens: 1024,
      responseTokenMode: "auto",
      topP: 0.95,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.1,
      seed: null,
      performanceProfile: "balanced",
      flashAttn: true,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      mlock: false,
      mmap: true,
      cachePrompt: true,
      defragThold: 0.1,
      batchSize: 512,
      ubatchSize: 512,
      preferredBackend: "auto",
    };
  });

  useEffect(() => {
    localStorage.setItem("textSettings", JSON.stringify(textSettings));
  }, [textSettings]);

  const [speechSettings, setSpeechSettings] = useState(() => {
    const saved = localStorage.getItem("speechSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          language: parsed.language || "auto",
          threads: Math.max(1, Math.min(32, Number(parsed.threads) || Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)))),
          backendPreference: ["auto", "vulkan", "metal", "cpu"].includes(parsed.backendPreference) ? parsed.backendPreference : "auto",
          translate: parsed.translate === true,
        };
      } catch (_) {}
    }
    return {
      language: "auto",
      threads: Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)),
      backendPreference: "auto",
      translate: false,
    };
  });

  useEffect(() => {
    localStorage.setItem("speechSettings", JSON.stringify(speechSettings));
  }, [speechSettings]);

  const [ttsSettings, setTtsSettings] = useState(() => {
    const saved = localStorage.getItem("ttsSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          model: parsed.model || "",
          voice: parsed.voice || "af_heart",
          speed: Math.max(0.5, Math.min(2, Number(parsed.speed) || 1)),
        };
      } catch (_) {}
    }
    return {
      model: "",
      voice: "af_heart",
      speed: 1,
    };
  });

  useEffect(() => {
    localStorage.setItem("ttsSettings", JSON.stringify(ttsSettings));
  }, [ttsSettings]);

  // Lifted Chat History States
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [showHistory, setShowHistory] = useState(false); // Default hide
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem("sidebarVisible");
    return saved !== "false";
  });

  useEffect(() => {
    localStorage.setItem("sidebarVisible", String(sidebarVisible));
  }, [sidebarVisible]);

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("fontSize");
    return saved ? Number(saved) : 16;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-size", `${fontSize}px`);
    localStorage.setItem("fontSize", String(fontSize));
  }, [fontSize]);
  const [speechTranscriptions, setSpeechTranscriptions] = useState([]);
  const [selectedSpeechTranscript, setSelectedSpeechTranscript] = useState(null);
  const [showSpeechHistory, setShowSpeechHistory] = useState(false);
  const [ttsOutputs, setTtsOutputs] = useState([]);
  const [selectedTtsOutput, setSelectedTtsOutput] = useState(null);
  const [showTtsHistory, setShowTtsHistory] = useState(false);

  const sanitizeMessageForStorage = (message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content.map((item) => {
        if (item?.type !== "image_url") return item;
        return {
          type: "text",
          text: "[Attached image omitted from saved chat history]",
        };
      }),
    };
  };

  const sanitizeConversationForStorage = (conversation) => ({
    ...conversation,
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map(sanitizeMessageForStorage)
      : [],
  });

  const persistConversation = (conversation) => {
    const compactConversation = sanitizeConversationForStorage(conversation);
    try {
      saveLlmConversation(compactConversation).catch((err) => {
        console.warn("Could not save chat history to app folder:", err);
      });
    } catch (err) {
      console.warn("Could not save chat history:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadConversations() {
      let legacyConversations = [];
      const legacySaved = localStorage.getItem("chat_conversations");
      if (legacySaved) {
        try {
          legacyConversations = JSON.parse(legacySaved);
        } catch (_) {
          localStorage.removeItem("chat_conversations");
        }
      }

      try {
        const diskConversations = await listLlmConversations();
        const diskIds = new Set(diskConversations.map((conversation) => conversation.id));
        const missingLegacy = legacyConversations
          .map(sanitizeConversationForStorage)
          .filter((conversation) => conversation.id && !diskIds.has(conversation.id));

        if (missingLegacy.length > 0) {
          await Promise.all(missingLegacy.map((conversation) => saveLlmConversation(conversation)));
        }

        const merged = [...diskConversations, ...missingLegacy]
          .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        if (!cancelled) setConversations(merged);
        if (legacySaved) localStorage.removeItem("chat_conversations");
      } catch (err) {
        console.warn("Could not load chat history from app folder:", err);
        if (!cancelled && legacyConversations.length > 0) {
          setConversations(legacyConversations.map(sanitizeConversationForStorage));
        }
      }
    }
    loadConversations();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveConversationState = useCallback((id, msgs, modelName, newTitle = null) => {
    setConversations((prev) => {
      const list = [...prev];
      const idx = list.findIndex(c => c.id === id);
      let conversation;
      if (idx !== -1) {
        conversation = {
          ...list[idx],
          messages: msgs,
          timestamp: Date.now(),
          model: modelName,
          ...(newTitle ? { title: newTitle } : {})
        };
        list[idx] = conversation;
      } else {
        conversation = {
          id,
          title: newTitle || "Chat Session",
          model: modelName,
          messages: msgs,
          timestamp: Date.now()
        };
        list.unshift(conversation);
      }
      persistConversation(conversation);
      return list;
    });
  }, []);

  const handleDeleteConversation = useCallback((id, e) => {
    if (e) e.stopPropagation();
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      return filtered;
    });
    deleteLlmConversation(id).catch((err) => {
      console.warn("Could not delete chat history from app folder:", err);
    });
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  }, [activeConversationId]);

  const refreshSpeechTranscriptions = useCallback(async () => {
    try {
      const list = await listSpeechTranscriptions();
      setSpeechTranscriptions(list);
    } catch (err) {
      console.warn("Could not load speech transcriptions:", err);
      setSpeechTranscriptions([]);
    }
  }, []);

  const handleDeleteSpeechTranscription = useCallback(async (item, e) => {
    if (e) e.stopPropagation();
    const itemId = item.filename || item.metadata || item.textFile;
    if (!itemId) return;

    const ok = await showConfirm({
      title: "Delete Transcription",
      message: `Are you sure you want to delete "${item.displayName || item.sourceFilename || "this transcription"}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;

    try {
      await deleteSpeechTranscription(itemId);
      
      setSelectedSpeechTranscript((prev) => {
        if (prev) {
          const prevId = prev.filename || prev.metadata || prev.textFile;
          if (prevId === itemId) return null;
        }
        return prev;
      });

      refreshSpeechTranscriptions();
    } catch (err) {
      console.error("Failed to delete speech transcription:", err);
      showAlert({ title: "Delete Failed", message: err.message || String(err), danger: true });
    }
  }, [showConfirm, showAlert, setSelectedSpeechTranscript, refreshSpeechTranscriptions]);

  useEffect(() => {
    refreshSpeechTranscriptions();
  }, [refreshSpeechTranscriptions]);

  const refreshTtsOutputs = useCallback(async () => {
    try {
      const list = await listTtsOutputs();
      setTtsOutputs(list);
    } catch (err) {
      console.warn("Could not load TTS outputs:", err);
      setTtsOutputs([]);
    }
  }, []);

  const handleDeleteTtsOutput = useCallback(async (item, e) => {
    if (e) e.stopPropagation();
    const itemId = item.filename || item.metadata;
    if (!itemId) return;

    const ok = await showConfirm({
      title: "Delete TTS Output",
      message: `Are you sure you want to delete "${item.displayName || item.audioFile || "this audio"}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;

    try {
      await deleteTtsOutput(itemId);
      setSelectedTtsOutput((prev) => {
        if (prev) {
          const prevId = prev.filename || prev.metadata;
          if (prevId === itemId) return null;
        }
        return prev;
      });
      refreshTtsOutputs();
    } catch (err) {
      console.error("Failed to delete TTS output:", err);
      showAlert({ title: "Delete Failed", message: err.message || String(err), danger: true });
    }
  }, [showConfirm, showAlert, refreshTtsOutputs]);

  useEffect(() => {
    refreshTtsOutputs();
  }, [refreshTtsOutputs]);

  // Load hardware specifications on mount
  useEffect(() => {
    async function loadSpecs() {
      try {
        const hardware = await getHardwareSpecs();
        const backendInfo = await getBackendOptions();
        setBackendOptions(backendInfo);
        setSpecs(hardware);
        // Default CPU threads count to match physical cores
        setConstraints((prev) => ({
          ...prev,
          threads: hardware.cpu_cores_physical || 4,
          backendType: prev.backendType === "auto" ? backendInfo.defaultBackendType || "cpu" : prev.backendType,
          useGpu: (prev.backendType === "auto" ? backendInfo.defaultBackendType : prev.backendType) !== "cpu",
        }));
        setTextSettings((prev) => ({
          ...prev,
          threads: prev.threads || hardware.cpu_cores_physical || 4
        }));
      } catch (err) {
        console.error("Error fetching hardware specs:", err);
      }
    }
    loadSpecs();
  }, []);

  const refreshReadiness = useCallback(async () => {
    setIsReadinessBusy(true);
    try {
      const [healthInfo, candidates] = await Promise.all([
        getHealth(),
        getCleanupCandidates().catch(() => []),
      ]);
      setHealth(healthInfo);
      setCleanupItems(candidates);
    } finally {
      setIsReadinessBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshReadiness();
  }, [refreshReadiness]);

  const copyDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 1800);
    } catch (err) {
      showAlert({ title: "Diagnostics Failed", message: err.message || String(err), danger: true });
    }
  }, [showAlert]);

  const cleanupSafeItems = useCallback(async () => {
    if (cleanupItems.length === 0) return;
    const totalBytes = cleanupItems.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
    const ok = await showConfirm({
      title: "Clean Safe Files?",
      message: `Delete ${cleanupItems.length} temporary/cache item${cleanupItems.length === 1 ? "" : "s"} and free about ${formatBytes(totalBytes)}?\n\nModels and generated outputs are not included.`,
      confirmLabel: "Clean",
      danger: true,
    });
    if (!ok) return;

    setIsReadinessBusy(true);
    try {
      await cleanupCandidates(cleanupItems.map((item) => item.id));
      await refreshReadiness();
    } catch (err) {
      showAlert({ title: "Cleanup Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsReadinessBusy(false);
    }
  }, [cleanupItems, refreshReadiness, showAlert, showConfirm]);

  useEffect(() => {
    async function loadSavedOutputs() {
      const outputs = await listGeneratedOutputs();
      setGeneratedImages(outputs);
    }
    loadSavedOutputs();
  }, []);

  // Save active model configuration to localStorage for persistence across reloads
  useEffect(() => {
    if (activeModel) {
      localStorage.setItem("active-model", activeModel);
    } else {
      localStorage.removeItem("active-model");
    }
  }, [activeModel]);

  // Check if server is already running on mount (handles page refresh and startup lag)
  useEffect(() => {
    let checkInterval = null;

    async function checkServerRunning() {
      const status = await getBackendStatus();
      const isRunning = Boolean(status.ready);
      if (isRunning) {
        if (checkInterval) clearInterval(checkInterval);

        const savedModel = localStorage.getItem("active-model");
        if (savedModel) {
          setActiveModel(savedModel);
          setServerRunning(true);
        } else {
          // Query the active model from status if possible, otherwise use fallback
          try {
            if (status && status.settings && status.settings.model) {
              const modelName = status.settings.model.split(/[\\/]/).pop();
              setActiveModel(modelName);
            }
          } catch (_) {}
          setServerRunning(true);
        }
      } else {
        // If server is not running, check if they had a simulated model active in browser mode
        const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
        if (!isTauriDesktop) {
          const savedModel = localStorage.getItem("active-model");
          if (savedModel) {
            setActiveModel(savedModel);
            setServerRunning(false);
          }
        }
      }
    }

    checkServerRunning();
    // Poll every 2 seconds to auto-detect when the backend becomes ready
    checkInterval = setInterval(checkServerRunning, 2000);

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);

  // Poll system telemetry usage statistics on interval
  useEffect(() => {
    async function updateTelemetry() {
      try {
        const stats = await getTelemetry();
        setTelemetry((prev) => (
          prev.cpu_usage === stats.cpu_usage &&
          prev.ram_used_gb === stats.ram_used_gb &&
          prev.ram_total_gb === stats.ram_total_gb &&
          prev.gpu_name === stats.gpu_name &&
          prev.vram_used_gb === stats.vram_used_gb &&
          prev.vram_total_gb === stats.vram_total_gb
            ? prev
            : stats
        ));
      } catch (err) {
        // Telemetry errors ignored
      }
    }

    updateTelemetry();
    const interval = setInterval(updateTelemetry, 1500); // Poll every 1.5 seconds

    return () => clearInterval(interval);
  }, []);

  // Sync active model settings default parameters
  useEffect(() => {
    if (activeModel) {
      const name = activeModel.toLowerCase();
      if (name.includes("lcm-dreamshaper-v7-fp16")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 4,
          npuSteps: 4,
          cfgScale: 1.0,
          width: 512,
          height: 512,
          backendType: "openvino-npu",
          useGpu: true,
        }));
      } else if (name.includes("flux") || name.includes("schnell")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 4,
          standardSteps: 4,
          cfgScale: 1.0,
          width: 1024,
          height: 1024,
        }));
      } else if (name.includes("lightning") || name.includes("turbo")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 4,
          standardSteps: 4,
          cfgScale: 1.5,
          width: 1024,
          height: 1024,
        }));
      } else if (name.includes("sd15")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 25,
          standardSteps: 25,
          cfgScale: 7.0,
          width: 512,
          height: 512,
        }));
      } else if (name.includes("sd35")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 20,
          standardSteps: 20,
          cfgScale: 4.5,
          width: 1024,
          height: 1024,
        }));
      } else {
        // Fallback for custom or SD 1.x models (like CyberRealistic or arbitrary safetensors)
        setConstraints((prev) => ({
          ...prev,
          steps: 20,
          standardSteps: 20,
          cfgScale: 7.0,
          width: 512,
          height: 512,
        }));
      }
    }
  }, [activeModel]);

  // Tab contents are kept mounted to preserve loading/generation state when switching tabs

  const sidebarContent = useMemo(() => (
    <Sidebar
      collapsed={!sidebarVisible}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      prefetchWorkspace={prefetchWorkspace}
      specs={specs}
      conversations={conversations}
      activeConversationId={activeConversationId}
      setActiveConversationId={setActiveConversationId}
      showHistory={showHistory}
      setShowHistory={setShowHistory}
      onDeleteConversation={handleDeleteConversation}
      speechTranscriptions={speechTranscriptions}
      selectedSpeechTranscript={selectedSpeechTranscript}
      setSelectedSpeechTranscript={setSelectedSpeechTranscript}
      showSpeechHistory={showSpeechHistory}
      setShowSpeechHistory={setShowSpeechHistory}
      onDeleteSpeechTranscription={handleDeleteSpeechTranscription}
      ttsOutputs={ttsOutputs}
      selectedTtsOutput={selectedTtsOutput}
      setSelectedTtsOutput={setSelectedTtsOutput}
      showTtsHistory={showTtsHistory}
      setShowTtsHistory={setShowTtsHistory}
      onDeleteTtsOutput={handleDeleteTtsOutput}
    />
  ), [sidebarVisible, activeTab, specs, conversations, activeConversationId, showHistory, handleDeleteConversation, speechTranscriptions, selectedSpeechTranscript, showSpeechHistory, handleDeleteSpeechTranscription, ttsOutputs, selectedTtsOutput, showTtsHistory, handleDeleteTtsOutput]);

  const handleStopServer = useCallback(async () => {
    if (!serverRunning || isStoppingServer) return;
    setIsStoppingServer(true);
    try {
      await stopServer();
      setServerRunning(false);
      setActiveModel(null);
    } catch (err) {
      console.error("Failed to stop server:", err);
      showAlert({ title: "Stop Server Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsStoppingServer(false);
    }
  }, [serverRunning, isStoppingServer, showAlert]);

  return (
    <div className="app-container">
      {/* Sidebar with Navigation Rail & Specs */}
      {sidebarContent}

      {/* Main Panel */}
      <div className="main-content">
        {/* Top telemetry specs chips bar */}
        <TopStatusBar
          telemetry={telemetry}
          serverRunning={serverRunning}
          activeModel={activeModel}
          isLlmLoaded={isLlmLoaded}
          onStopServer={handleStopServer}
          isStoppingServer={isStoppingServer}
          theme={theme}
          setTheme={setTheme}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
        />

        {/* Dynamic Workspace Container */}
        <div style={{ display: activeTab === "home" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "auto" }}>
          <Home setActiveTab={setActiveTab} specs={specs} health={health} activeModel={activeModel} isLlmLoaded={isLlmLoaded} />
        </div>

        <Suspense fallback={<WorkspaceFallback />}>
        {visitedTabs.has("generator") && (
        <WorkspacePanel tab="generator" activeTab={activeTab} onReturnHome={recoverFailedWorkspace}>
          <Generator
            prompt={prompt}
            setPrompt={setPrompt}
            negativePrompt={negativePrompt}
            setNegativePrompt={setNegativePrompt}
            constraints={constraints}
            setConstraints={setConstraints}
            activeModel={activeModel}
            generatedImages={generatedImages}
            setGeneratedImages={setGeneratedImages}
            isGenerating={isGenerating}
            setIsGenerating={setIsGenerating}
            generationProgress={generationProgress}
            setGenerationProgress={setGenerationProgress}
            setActiveTab={setActiveTab}
            showAlert={showAlert}
            showConfirm={showConfirm}
            specs={specs}
            textSettings={textSettings}
          />
        </WorkspacePanel>
        )}

        {visitedTabs.has("image-video") && (
        <WorkspacePanel tab="image-video" activeTab={activeTab} onReturnHome={recoverFailedWorkspace}>
          <ImageToVideo specs={specs} showAlert={showAlert} />
        </WorkspacePanel>
        )}

        {visitedTabs.has("assets") && (
        <WorkspacePanel tab="assets" activeTab={activeTab} onReturnHome={recoverFailedWorkspace} overflow="auto">
          <AssetLibrary />
        </WorkspacePanel>
        )}

        {visitedTabs.has("models") && (
        <WorkspacePanel tab="models" activeTab={activeTab} onReturnHome={recoverFailedWorkspace}>
          <ModelManager
            activeModel={activeModel}
            setActiveModel={setActiveModel}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
            constraints={constraints}
            setConstraints={setConstraints}
            telemetry={telemetry}
            backendOptions={backendOptions}
            showAlert={showAlert}
            showConfirm={showConfirm}
            activeTab={activeTab}
            specs={specs}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
          />
        </WorkspacePanel>
        )}

        {visitedTabs.has("chat") && (
        <WorkspacePanel tab="chat" activeTab={activeTab} onReturnHome={recoverFailedWorkspace}>
          <TextChat
            specs={specs}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            setActiveModel={setActiveModel}
            setServerRunning={setServerRunning}
            conversations={conversations}
            setConversations={setConversations}
            activeConversationId={activeConversationId}
            setActiveConversationId={setActiveConversationId}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            saveConversationState={saveConversationState}
            setIsLlmLoaded={setIsLlmLoaded}
          />
        </WorkspacePanel>
        )}

        {visitedTabs.has("speech") && (
        <WorkspacePanel tab="speech" activeTab={activeTab} onReturnHome={recoverFailedWorkspace}>
          <SpeechTranscriber
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedTranscript={selectedSpeechTranscript}
            onTranscriptionsChanged={refreshSpeechTranscriptions}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
          />
        </WorkspacePanel>
        )}

        {visitedTabs.has("tts") && (
        <WorkspacePanel tab="tts" activeTab={activeTab} onReturnHome={recoverFailedWorkspace}>
          <TextToSpeech
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedOutput={selectedTtsOutput}
            onOutputsChanged={refreshTtsOutputs}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
          />
        </WorkspacePanel>
        )}

        {visitedTabs.has("settings") && (
        <WorkspacePanel tab="settings" activeTab={activeTab} onReturnHome={recoverFailedWorkspace}>
          <div className="runtime-dashboard-shell">
  <RuntimeDownloadDashboard />
<TextModelManager />
<PersistentTextChat />
</div>
<Settings
            constraints={constraints}
            setConstraints={setConstraints}
            activeModel={activeModel}
            specs={specs}
            backendOptions={backendOptions}
            setBackendOptions={setBackendOptions}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
            setActiveModel={setActiveModel}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
            health={health}
            cleanupItems={cleanupItems}
            isReadinessBusy={isReadinessBusy}
            refreshReadiness={refreshReadiness}
            copyDiagnostics={copyDiagnostics}
            cleanupSafeItems={cleanupSafeItems}
            diagnosticsCopied={diagnosticsCopied}
            theme={theme}
            setTheme={setTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
          />
        </WorkspacePanel>
        )}
        </Suspense>
      </div>

      {dialog && (
        <div className="app-dialog-backdrop" role="presentation">
          <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
            <h3 id="app-dialog-title" className="app-dialog-title">{dialog.title}</h3>
            <p className="app-dialog-message">{dialog.message}</p>
            <div className="app-dialog-actions">
              {dialog.type === "confirm" && (
                <button className="m3-btn m3-btn-outlined" onClick={() => closeDialog(false)}>
                  {dialog.cancelLabel}
                </button>
              )}
              <button
                className={`m3-btn ${dialog.danger ? "m3-btn-error" : "m3-btn-filled"}`}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
