import { Component, lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import TopStatusBar from "./components/TopStatusBar";
import Home from "./components/Home";
import { cleanupCandidates, formatBytes, getCleanupCandidates, getDiagnostics, getHardwareSpecs, getHealth, getTelemetry, getBackendOptions, getBackendStatus, listGeneratedOutputs, listLlmConversations, saveLlmConversation, deleteLlmConversation, listSpeechTranscriptions, deleteSpeechTranscription, listTtsOutputs, deleteTtsOutput, stopServer, applyQualityPreset, detectModelFamily } from "./services/api";
import "./App.css";
import { canonicalThemeId } from "./themes";
import { missingGrants, normaliseFailedFolders, restoreProjectGrants, stripGrants, withRestoredGrants } from "./lib/work-grants.mjs";
import { buildLabel } from "./lib/build-info.mjs";
import { chunkFailureAdvice, isChunkLoadError, withChunkRecovery } from "./lib/panel-recovery.mjs";

const workspaceLoaders = {
  generator: () => import("./components/Generator"),
  models: () => import("./components/ModelManager"),
  settings: () => import("./components/Settings"),
  chat: () => import("./components/TextChat"),
  speech: () => import("./components/SpeechTranscriber"),
  tts: () => import("./components/TextToSpeech"),
  "image-video": () => import("./components/ImageToVideo"),
  assets: () => import("./components/AssetLibrary"),
  "social-agency": () => import("./components/SocialAgency"),
  // LUKE_AI_WORKFLOW_BUILDER_V1
  "ai-workflow": () => import("./components/WorkflowBuilder"),
};

// Every lazy panel goes through withChunkRecovery: a panel whose file has been
// replaced by a rebuild is a tab from an older build, not a broken panel, and it
// reloads itself once instead of printing a URL in the middle of Settings.
const lazyPanel = (load) => lazy(withChunkRecovery(load));

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

const Generator = lazyPanel(workspaceLoaders.generator);
const ModelManager = lazyPanel(workspaceLoaders.models);
const Settings = lazyPanel(workspaceLoaders.settings);
const TextChat = lazyPanel(workspaceLoaders.chat);
const SpeechTranscriber = lazyPanel(workspaceLoaders.speech);
const TextToSpeech = lazyPanel(workspaceLoaders.tts);
const ImageToVideo = lazyPanel(workspaceLoaders["image-video"]);
// LUKE_AI_RUNTIME_DASHBOARD_V1
const RuntimeDownloadDashboard = lazyPanel(() => import("./components/RuntimeDownloadDashboard"));
// LUKE_AI_TEXT_MODEL_MANAGER_UI_V1
const TextModelManager = lazyPanel(() => import("./components/TextModelManager"));
// LUKE_AI_PERSISTENT_TEXT_CHAT_UI_V1
const PersistentTextChat = lazyPanel(() => import("./components/PersistentTextChat"));
// LUKE_AI_ASSET_LIBRARY_UI_V1
const AssetLibrary = lazyPanel(workspaceLoaders.assets);
const SocialAgency = lazyPanel(workspaceLoaders["social-agency"]);
// LUKE_AI_WORKFLOW_BUILDER_V1
const WorkflowBuilder = lazyPanel(workspaceLoaders["ai-workflow"]);

const WorkspaceFallback = () => (
  <div className="workspace-loading" role="status" aria-live="polite">
    Loading workspace…
  </div>
);

class SoftWorkspaceBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Settings extra panel failed", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;

    // A panel that could not be fetched is the one failure with an obvious
    // repair, so it gets a sentence and the button instead of a bare URL.
    if (isChunkLoadError(this.state.error)) {
      return (
        <div className="workspace-load-error" role="alert" style={{ padding: "16px", margin: "12px" }}>
          <strong>This panel needs the current build of the app.</strong>
          <span>{chunkFailureAdvice(buildLabel())}</span>
          <span className="load-error-detail" style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", display: "block", marginTop: 8 }}>
            {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          </span>
          <div className="workspace-load-error-actions">
            <button type="button" className="m3-btn m3-btn-filled" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="workspace-load-error" role="alert" style={{ padding: "16px", margin: "12px" }}>
        <strong>A settings panel failed to load.</strong>
        <span>{String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}</span>
      </div>
    );
  }
}

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
        <span className="load-error-detail" style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", display: "block", marginTop: 8 }}>{String(this.state.error?.message || this.state.error || "")}</span>
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
  <div className="workspace-panel" data-tab={tab} style={{ display: activeTab === tab ? "flex" : "none", overflow, flex: "1 1 0", height: 0, minHeight: 0 }}>
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
    document.documentElement.setAttribute("data-theme", canonicalThemeId(theme));
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Navigation
  const [activeTab, setActiveTab] = useState("home");
  // A link to #performance lands where it says. That card lives inside the Text
  // Generation section of Settings, so the breadcrumb the slow-load message used
  // to print — Settings, then Performance — described two levels that are not in
  // the sidebar at all. The fragment opens the panel; Settings expands the
  // section and scrolls to the card.
  useEffect(() => {
    const openIfAsked = () => {
      if (window.location.hash.replace(/^#/, "") === "performance") setActiveTab("settings");
    };
    openIfAsked();
    window.addEventListener("hashchange", openIfAsked);
    return () => window.removeEventListener("hashchange", openIfAsked);
  }, []);
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
    server_rss_gb: null,
    ram_used_gb: 0,
    ram_total_gb: 0,
    gpu_name: "Detecting...",
    vram_used_gb: 0,
    vram_total_gb: 0,
  });

  // Default Image Constraints
  //
  // These are the numbers *until a model is chosen*: the first model switch
  // fills in the family's own (see the applyQualityPreset effect below). They
  // used to be FLUX Schnell's profile applied to everyone — 1024² at CFG 1 and
  // 4 steps — which on a 4 GB machine is four times over budget and on an SD 1.5
  // checkpoint produces a burnt, prompt-ignoring image. Mid-tier SD 1.5 values
  // are the safer "nothing chosen yet" default; the plan replaces them the
  // moment it knows what it is running.
  const [constraints, setConstraints] = useState({
    width: 512,
    height: 512,
    steps: 25,
    npuSteps: 4,
    standardSteps: 20,
    cfgScale: 6.5,
    sampler: "dpm++2m",
    scheduler: "karras",
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
  const [conversationHistoryHydrated, setConversationHistoryHydrated] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [showHistory, setShowHistory] = useState(false); // Default hide
  const [chatProjects, setChatProjects] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("chat_projects") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  });
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem("active_chat_project") || null);
  const [assistantMode, setAssistantMode] = useState(() => localStorage.getItem("luke_assistant_mode") === "work" ? "work" : "chat");

  // `/api/work/folder/restore` answers with a `failed` list. Keeping it here is
  // what lets Edit project show WHICH saved path is gone instead of leaving the
  // user with a console line they have to copy by hand.
  const [failedProjectFolders, setFailedProjectFolders] = useState({});
  const recordFailedFolders = useCallback((projectId, failed) => {
    const id = String(projectId || "").trim();
    if (!id) return;
    const entries = normaliseFailedFolders(failed);
    setFailedProjectFolders((current) => {
      if (entries.length === 0) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      // Focus/visibility re-checks call this often; an unchanged list must not
      // hand React a new object on every window focus.
      const existing = current[id] || [];
      const unchanged = entries.length === existing.length
        && entries.every((entry, index) => entry.root === existing[index]?.root
          && entry.error === existing[index]?.error);
      return unchanged ? current : { ...current, [id]: entries };
    });
  }, []);
  const clearFailedFolders = useCallback((projectId) => {
    setFailedProjectFolders((current) => {
      if (!(projectId in current)) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
  }, []);

  useEffect(() => {
    // Grant ids are session state: writing them down is what made Work believe
    // it still had permission after a restart.
    localStorage.setItem("chat_projects", JSON.stringify(chatProjects.map(stripGrants)));
  }, [chatProjects]);

  // Folder permissions live in the server's memory, so they are gone after a
  // restart while the projects still list the folders the user chose. Re-grant
  // those saved folders once per launch instead of asking the user to open
  // Edit project for every single project.
  const projectGrantsRestoredRef = useRef(false);
  useEffect(() => {
    if (projectGrantsRestoredRef.current) return;
    const pending = chatProjects.filter((project) => missingGrants(project).length > 0);
    if (pending.length === 0) return;
    projectGrantsRestoredRef.current = true;
    void (async () => {
      const patches = [];
      for (const project of pending) {
        try {
          const { grants, failed } = await restoreProjectGrants(project);
          recordFailedFolders(project.id, failed);
          if (Object.keys(grants).length > 0) patches.push({ id: project.id, grants });
        } catch (_) {}
      }
      if (patches.length === 0) return;
      setChatProjects((current) => current.map((project) => {
        const patch = patches.find((entry) => entry.id === project.id);
        return patch ? withRestoredGrants(project, patch.grants) : project;
      }));
    })();
  }, [chatProjects, recordFailedFolders]);

  /**
   * Ask the server which folders it can actually reach, and re-grant the ones
   * it cannot.
   *
   * The project remembers a grant id, but the server keeps permissions in
   * memory and forgets them when it restarts — so the app's own memory is not
   * the truth, and trusting it is why Work needed a button pressed after every
   * launch. Readiness is the truth: it is answered by the server that holds
   * (or has lost) the permission.
   *
   * This only ever re-grants folders the project already names, so it can
   * never reach a folder the user did not choose.
   */
  const ensureProjectGrants = useCallback(async () => {
    const project = chatProjects.find((entry) => entry.id === activeProjectId);
    const roots = Array.isArray(project?.sourceFolders) ? project.sourceFolders.filter(Boolean) : [];
    if (!project?.id || roots.length === 0) return;
    try {
      const response = await fetch("/api/work/readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          sourceFolders: roots,
          folderGrants: project.folderGrants || {},
          activeRoot: roots[0],
        }),
      });
      const data = await response.json();
      const missing = (data?.result?.folders || []).filter((folder) => folder.exists && !folder.granted);
      if (missing.length === 0) return;
      const { grants, failed } = await restoreProjectGrants(project, { force: true });
      recordFailedFolders(project.id, failed);
      if (Object.keys(grants || {}).length === 0) return;
      setChatProjects((current) => current.map((entry) => (entry.id === project.id ? withRestoredGrants(entry, grants) : entry)));
    } catch {
      // A folder that cannot be granted says so where the user is working —
      // the Work panels keep their own button for that case.
    }
  }, [chatProjects, activeProjectId, recordFailedFolders]);

  // Checked when Work is opened, and again whenever the window comes back:
  // a restart while the tab sat in the background is invisible otherwise.
  useEffect(() => {
    if (assistantMode !== "work") return;
    void ensureProjectGrants();
  }, [assistantMode, ensureProjectGrants]);

  useEffect(() => {
    if (assistantMode !== "work") return;
    const recheck = () => { void ensureProjectGrants(); };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [assistantMode, ensureProjectGrants]);

  useEffect(() => {
    if (activeProjectId) localStorage.setItem("active_chat_project", activeProjectId);
    else localStorage.removeItem("active_chat_project");
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem("luke_assistant_mode", assistantMode);
  }, [assistantMode]);

  const handleAssistantModeChange = useCallback((requestedMode) => {
    const nextMode = requestedMode === "work" ? "work" : "chat";

    // Clicking the already-selected mode should only reveal Chat. Re-clearing the
    // conversation remounts the composer and can make a long chat appear frozen.
    if (nextMode === assistantMode) {
      if (activeTab !== "chat") setActiveTab("chat");
      return;
    }

    setAssistantMode(nextMode);
    setActiveConversationId((currentId) => {
      const conversationMode = (conversation) => conversation?.assistantMode
        || (conversation?.projectId ? "work" : "chat");
      const matchesTarget = (conversation) => conversationMode(conversation) === nextMode
        && (nextMode !== "work" || !activeProjectId || conversation.projectId === activeProjectId);
      const currentConversation = conversations.find((conversation) => conversation.id === currentId);
      if (matchesTarget(currentConversation)) return currentId;
      return conversations.find(matchesTarget)?.id || null;
    });
    setActiveTab("chat");
  }, [activeProjectId, activeTab, assistantMode, conversations]);
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

  const conversationSaveChainsRef = useRef(new Map());

  const persistConversation = (conversation) => {
    const compactConversation = sanitizeConversationForStorage(conversation);
    const previous = conversationSaveChainsRef.current.get(compactConversation.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => saveLlmConversation(compactConversation));
    conversationSaveChainsRef.current.set(compactConversation.id, next);
    next.catch((err) => {
      console.warn("Could not save chat history to app folder:", err);
    }).finally(() => {
      if (conversationSaveChainsRef.current.get(compactConversation.id) === next) conversationSaveChainsRef.current.delete(compactConversation.id);
    });
  };

  useEffect(() => {
    if (!conversationHistoryHydrated) return;
    try {
      const recoverable = conversations
        .slice(0, 80)
        .map(sanitizeConversationForStorage);
      localStorage.setItem("chat_conversations", JSON.stringify(recoverable));
    } catch (err) {
      console.warn("Could not update the local chat history mirror:", err);
    }
  }, [conversationHistoryHydrated, conversations]);

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
        const localConversations = legacyConversations.map(sanitizeConversationForStorage);
        const diskIds = new Set(diskConversations.map((conversation) => conversation.id));
        const missingLegacy = localConversations.filter((conversation) => conversation.id && !diskIds.has(conversation.id));

        if (missingLegacy.length > 0) {
          await Promise.all(missingLegacy.map((conversation) => saveLlmConversation(conversation)));
        }

        const mergedById = new Map();
        for (const conversation of [...diskConversations, ...localConversations]) {
          const current = mergedById.get(conversation.id);
          if (!current || Number(conversation.timestamp || 0) >= Number(current.timestamp || 0)) mergedById.set(conversation.id, conversation);
        }
        const merged = [...mergedById.values()]
          .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        if (!cancelled) setConversations(merged);
      } catch (err) {
        console.warn("Could not load chat history from app folder:", err);
        if (!cancelled && legacyConversations.length > 0) {
          setConversations(legacyConversations.map(sanitizeConversationForStorage));
        }
      } finally {
        if (!cancelled) setConversationHistoryHydrated(true);
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
          ...(newTitle ? { title: newTitle } : {}),
          projectId: activeProjectId || list[idx].projectId || null,
          assistantMode,
        };
        list[idx] = conversation;
      } else {
        conversation = {
          id,
          title: newTitle || "Chat Session",
          model: modelName,
          messages: msgs,
          timestamp: Date.now(),
          projectId: activeProjectId || null,
          assistantMode,
        };
        list.unshift(conversation);
      }
      persistConversation(conversation);
      return list;
    });
  }, [activeProjectId, assistantMode]);

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

  const handleMoveConversationToProject = useCallback((conversationId, projectId) => {
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const updated = {
        ...conversation,
        projectId: projectId || null,
        assistantMode: projectId ? "work" : "chat",
        timestamp: Date.now(),
      };
      persistConversation(updated);
      return updated;
    }));
  }, []);

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
        // One-time runtime tune. The server knows the machine it is running
        // on — and which backend it will actually use — so it picks thread and
        // batch counts instead of leaving them at "one thread per core", which
        // is wrong once the GPU runs the model. What was applied is written
        // down in `runtimeTunedNote`: the Performance card prints it, so the
        // values appear with a reason instead of silently replacing whatever
        // was there.
        try {
          const tuneResponse = await fetch("/api/llm/performance-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const tuneData = await tuneResponse.json();
          const recommended = tuneData?.recommended;
          if (tuneResponse.ok && recommended) {
            const defaultThreads = Number(hardware.cpu_cores_physical) || 4;
            // One note shape for both paths: the values that are in force, the
            // machine they were chosen for, and the sentence behind each. An
            // install that was tuned before the note existed gets the same
            // explanation, marked as recorded now rather than applied now.
            const buildNote = ({ threads, keptThreads, batchSize, ubatchSize, backfilled }) => ({
              threads,
              keptThreads,
              batchSize,
              ubatchSize,
              reasonThreads: String(recommended.reason?.threads || ""),
              reasonBatch: String(recommended.reason?.batchSize || ""),
              gpuMode: tuneData.isGpuMode !== false,
              gpuModeSource: String(tuneData.gpuModeSource || ""),
              cpu: String(tuneData.hardware?.cpu || ""),
              gpu: String(tuneData.hardware?.gpu || ""),
              cores: Number(tuneData.hardware?.coresPhysical) || defaultThreads,
              ramGb: Number(tuneData.hardware?.ramGb) || 0,
              backfilled: backfilled === true,
              at: new Date().toISOString(),
            });
            setTextSettings((prev) => {
              if (prev.runtimeTuned) {
                // Tuned by an older build that wrote nothing down: describe the
                // values that are already in force instead of leaving the card
                // silent about numbers the app chose itself.
                if (prev.runtimeTunedNote) return prev;
                return {
                  ...prev,
                  runtimeTunedNote: buildNote({
                    threads: Number(prev.threads) || recommended.threads,
                    keptThreads: false,
                    batchSize: Number(prev.batchSize) || recommended.batchSize,
                    ubatchSize: Number(prev.ubatchSize) || recommended.ubatchSize,
                    backfilled: true,
                  }),
                };
              }
              const currentThreads = Number(prev.threads) || 0;
              // A thread count that is not the default one is the user's own
              // choice, and a tune must not overwrite it on first launch.
              const keepThreads = currentThreads > 0 && currentThreads !== defaultThreads;
              return {
                ...prev,
                threads: keepThreads ? currentThreads : recommended.threads,
                batchSize: recommended.batchSize,
                ubatchSize: recommended.ubatchSize,
                runtimeTuned: true,
                runtimeTunedNote: buildNote({
                  threads: keepThreads ? currentThreads : recommended.threads,
                  keptThreads: keepThreads,
                  batchSize: recommended.batchSize,
                  ubatchSize: recommended.ubatchSize,
                  backfilled: false,
                }),
              };
            });
          }
        } catch (_) {}
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

  // Poll system telemetry usage statistics on interval.
  //
  // A hidden tab has nobody looking at the numbers, and these requests are what
  // keep the server sampling hardware (vm_stat / nvidia-smi / a whole
  // `llama-server --list-devices`); the server pauses half a minute after the
  // last one. So polling in the background wakes the machine for nothing: it
  // stops with the tab and resumes the instant the tab is visible again, which
  // is also the moment the server starts sampling again.
  useEffect(() => {
    let interval = null;

    async function updateTelemetry() {
      try {
        const stats = await getTelemetry();
        setTelemetry((prev) => (
          prev.cpu_usage === stats.cpu_usage &&
          prev.server_rss_gb === stats.server_rss_gb &&
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

    function stopPolling() {
      if (interval) clearInterval(interval);
      interval = null;
    }

    function startPolling() {
      stopPolling();
      if (document.hidden) return;
      interval = setInterval(updateTelemetry, 1500); // Poll every 1.5 seconds
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stopPolling();
        return;
      }
      updateTelemetry();
      startPolling();
    }

    updateTelemetry();
    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Sync active model settings default parameters.
  //
  // One source of truth: scripts/server/image-quality.cjs, which knows what each
  // architecture actually wants (DPM++ 2M + karras + clip skip 2 for SD 1.5,
  // euler + CFG 1 + `simple` for FLUX, low CFG for distilled Lightning/Turbo
  // builds) and clamps the size to this machine's tier.
  //
  // This ran as a chain of `name.includes("flux")` guesses before, and it only
  // ever touched steps/cfg/size — never the sampler, the scheduler or clip skip,
  // which is where most of the quality difference lives. It also fired on every
  // model switch, overwriting settings the user had deliberately set; it now
  // leaves a pinned choice alone.
  useEffect(() => {
    if (!activeModel) return;
    setConstraints((prev) => {
      // A user who has tuned the numbers keeps them across a model switch. They
      // can return to the machine's advice from the quality panel at any time.
      if (prev.qualityPinned === true) {
        return {
          ...prev,
          modelFamily: detectModelFamily(activeModel),
          hardwareTier: specs?.tier || prev.hardwareTier,
        };
      }
      const next = applyQualityPreset(
        { ...prev, hardwareTier: specs?.tier || prev.hardwareTier },
        prev.qualityPreset === "custom" ? "auto" : (prev.qualityPreset || "auto"),
        activeModel,
        specs?.tier
      );
      return {
        ...next,
        modelFamily: detectModelFamily(activeModel),
        standardSteps: next.steps,
      };
    });
  }, [activeModel, specs?.tier]);

  // Tab contents are kept mounted to preserve loading/generation state when switching tabs

  const sidebarContent = useMemo(() => (
    <Sidebar
      collapsed={!sidebarVisible}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      prefetchWorkspace={prefetchWorkspace}
      specs={specs}
      health={health}
      conversations={conversations}
      activeConversationId={activeConversationId}
      setActiveConversationId={setActiveConversationId}
      showHistory={showHistory}
      setShowHistory={setShowHistory}
      onDeleteConversation={handleDeleteConversation}
      onMoveConversationToProject={handleMoveConversationToProject}
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
      projects={chatProjects}
      setProjects={setChatProjects}
      failedProjectFolders={failedProjectFolders}
      onForgetMissingFolders={clearFailedFolders}
      activeProjectId={activeProjectId}
      setActiveProjectId={setActiveProjectId}
      assistantMode={assistantMode}
      setAssistantMode={handleAssistantModeChange}
    />
  ), [sidebarVisible, activeTab, specs, conversations, activeConversationId, showHistory, handleDeleteConversation, handleMoveConversationToProject, speechTranscriptions, selectedSpeechTranscript, showSpeechHistory, handleDeleteSpeechTranscription, ttsOutputs, selectedTtsOutput, showTtsHistory, handleDeleteTtsOutput, chatProjects, failedProjectFolders, clearFailedFolders, activeProjectId, assistantMode, handleAssistantModeChange]);

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

        {visitedTabs.has("social-agency") && (
        <WorkspacePanel tab="social-agency" activeTab={activeTab} onReturnHome={recoverFailedWorkspace} overflow="auto">
          <SocialAgency
            onCreateImage={() => setActiveTab("generator")}
            onCreateVideo={() => setActiveTab("image-video")}
            onOpenChat={() => setActiveTab("chat")}
          />
        </WorkspacePanel>
        )}

        {/* LUKE_AI_WORKFLOW_BUILDER_V1 */}
        {visitedTabs.has("ai-workflow") && (
        <WorkspacePanel tab="ai-workflow" activeTab={activeTab} onReturnHome={recoverFailedWorkspace} overflow="auto">
          <WorkflowBuilder />
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
            assistantMode={assistantMode}
            activeProject={chatProjects.find((project) => project.id === activeProjectId) || null}
            setProjects={setChatProjects}
            speechSettings={speechSettings}
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
        <WorkspacePanel tab="settings" activeTab={activeTab} onReturnHome={recoverFailedWorkspace} overflow="auto">
          <div className="workspace-title-section settings-workspace-header">
            <h2 className="workspace-title">Settings & Parameters</h2>
            <p className="workspace-subtitle">
              Configure your AI models for optimal performance.
            </p>
          </div>
          <div className="runtime-dashboard-shell">
          <SoftWorkspaceBoundary>
            <RuntimeDownloadDashboard />
          </SoftWorkspaceBoundary>
          <SoftWorkspaceBoundary>
            <TextModelManager />
          </SoftWorkspaceBoundary>

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
            showHeader={false}
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
