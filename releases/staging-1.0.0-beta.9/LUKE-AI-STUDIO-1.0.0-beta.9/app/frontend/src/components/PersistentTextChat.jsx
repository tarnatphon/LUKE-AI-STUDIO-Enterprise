import {
  MessageSquarePlus,
  Pin,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  ThumbsDown,
  ThumbsUp,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* LUKE_AI_STORAGE_DESTINATION_PANEL_IMPORT_FINAL_V1 */
import StorageDestinationPanel from "./StorageDestinationPanel.jsx";

/* LUKE_AI_STORAGE_PROVIDER_PANEL_IMPORT_V2 */
import StorageProviderPanel from "./StorageProviderPanel.jsx";

/* LUKE_AI_CLOUD_STORAGE_PANEL_IMPORT_V2 */
import CloudStorageProviderPanel from "./CloudStorageProviderPanel.jsx";

/* LUKE_AI_UNIFIED_TRANSFER_QUEUE_IMPORT_V1 */
import UnifiedTransferQueuePanel from "./UnifiedTransferQueuePanel.jsx";

/* LUKE_AI_STORAGE_AVAILABILITY_WATCHER_IMPORT_V2 */
import StorageAvailabilityWatcherPanel from "./StorageAvailabilityWatcherPanel.jsx";

/* LUKE_AI_STORAGE_HEALTH_SCORE_IMPORT_V2 */
import StorageHealthScorePanel from "./StorageHealthScorePanel.jsx";

/* LUKE_AI_STORAGE_POLICY_PROFILES_IMPORT_V2 */
import StoragePolicyProfilesPanel from "./StoragePolicyProfilesPanel.jsx";

/* LUKE_AI_STORAGE_WORKLOAD_DETECTION_IMPORT_V2 */
import StorageWorkloadDetectionPanel from "./StorageWorkloadDetectionPanel.jsx";

/* LUKE_AI_STORAGE_LIFECYCLE_IMPORT_V2 */
import StorageLifecyclePlannerPanel from "./StorageLifecyclePlannerPanel.jsx";

/* LUKE_AI_STORAGE_ARCHIVE_RESTORE_IMPORT_V2 */
import StorageArchiveRestorePanel from "./StorageArchiveRestorePanel.jsx";

/* LUKE_AI_STORAGE_INTEGRITY_IMPORT_V2 */
import StorageIntegrityPanel from "./StorageIntegrityPanel.jsx";

/* LUKE_AI_DEEP_CLOUD_INTEGRITY_IMPORT_V1 */
import StorageDeepCloudIntegrityPanel from "./StorageDeepCloudIntegrityPanel.jsx";

/* LUKE_AI_STORAGE_DISASTER_RECOVERY_IMPORT_V1 */
import StorageDisasterRecoveryPanel from "./StorageDisasterRecoveryPanel.jsx";

/* LUKE_AI_STORAGE_RECOVERY_RUNBOOK_IMPORT_V1 */
import StorageRecoveryRunbookPanel from "./StorageRecoveryRunbookPanel.jsx";

/* LUKE_AI_STORAGE_RECOVERY_SIMULATION_IMPORT_V1 */
import StorageRecoverySimulationPanel from "./StorageRecoverySimulationPanel.jsx";

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "th-TH",
    {
      dateStyle: "short",
      timeStyle: "short",
    },
  ).format(
    new Date(value),
  );
}

export default function PersistentTextChat() {
  const [conversations, setConversations] =
    useState([]);

  const [
    activeConversationId,
    setActiveConversationId,
  ] = useState("");

  const [draft, setDraft] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  // LUKE_AI_TEXT_GENERATION_STREAMING_UI_V1
  const [
    generating,
    setGenerating,
  ] = useState(false);

  const [
    streamingResponse,
    setStreamingResponse,
  ] = useState("");

  // LUKE_AI_MULTI_MODEL_GENERATION_UI_V1
  const [
    availableModels,
    setAvailableModels,
  ] = useState([]);

  const [
    selectedModelIds,
    setSelectedModelIds,
  ] = useState([]);

  const [
    multiModelEnabled,
    setMultiModelEnabled,
  ] = useState(false);

  const [
    multiGenerating,
    setMultiGenerating,
  ] = useState(false);

  const [
    multiResponses,
    setMultiResponses,
  ] = useState({});

  const [
    multiEvaluation,
    setMultiEvaluation,
  ] = useState(null);

  // LUKE_AI_JUDGE_SYNTHESIS_UI_V1
  const [
    judgeGenerating,
    setJudgeGenerating,
  ] = useState(false);

  const [
    judgeResponse,
    setJudgeResponse,
  ] = useState("");

  const [
    judgeFallback,
    setJudgeFallback,
  ] = useState(false);

  const generationAbortRef =
    useRef(null);

  // LUKE_AI_TEXT_CHAT_MEMORY_UI_V1
  const [
    memoryStatus,
    setMemoryStatus,
  ] = useState(null);

  const [
    optimizingMemory,
    setOptimizingMemory,
  ] = useState(false);

  // LUKE_AI_TEXT_RUNTIME_SESSION_UI_V1
  const [
    runtimeSession,
    setRuntimeSession,
  ] = useState(null);

  const [
    refreshingRuntime,
    setRefreshingRuntime,
  ] = useState(false);

  const [error, setError] =
    useState("");

  // LUKE_AI_TEXT_MODEL_FEEDBACK_UI_V1
  const [
    feedbackBusyId,
    setFeedbackBusyId,
  ] = useState("");

  // LUKE_AI_AUTOMATIC_MODEL_ROUTER_UI_V2
  const [
    autoRouterEnabled,
    setAutoRouterEnabled,
  ] = useState(true);

  const [
    routerDecision,
    setRouterDecision,
  ] = useState(null);

  const [
    routingModel,
    setRoutingModel,
  ] = useState(false);

  // LUKE_AI_RUNTIME_FAILURE_RECOVERY_UI_V1
  const [
    recoveryStatus,
    setRecoveryStatus,
  ] = useState(null);

  const [
    recoveryAttempts,
    setRecoveryAttempts,
  ] = useState([]);

  const [
    fallbackModelId,
    setFallbackModelId,
  ] = useState("");

  // LUKE_AI_MODEL_HEALTH_CIRCUIT_BREAKER_UI_V1
  const [
    modelHealth,
    setModelHealth,
  ] = useState([]);

  const [
    modelHealthLoading,
    setModelHealthLoading,
  ] = useState(false);

  // LUKE_AI_RUNTIME_SUPERVISOR_DASHBOARD_UI_V1
  const [
    runtimeSupervisor,
    setRuntimeSupervisor,
  ] = useState(null);

  const [
    runtimeSupervisorPolicy,
    setRuntimeSupervisorPolicy,
  ] = useState(null);

  const [
    runtimeSupervisorBusy,
    setRuntimeSupervisorBusy,
  ] = useState("");

  const [
    runtimeSupervisorSettingsOpen,
    setRuntimeSupervisorSettingsOpen,
  ] = useState(false);

  const [
    runtimeArgumentsText,
    setRuntimeArgumentsText,
  ] = useState("");

  // LUKE_AI_RUNTIME_DETECTION_DASHBOARD_UI_V1
  const [
    detectedTextRuntimes,
    setDetectedTextRuntimes,
  ] = useState([]);

  const [
    runtimeDetectionLoading,
    setRuntimeDetectionLoading,
  ] = useState(false);

  const [
    configuringRuntimeType,
    setConfiguringRuntimeType,
  ] = useState("");

  // LUKE_AI_RUNTIME_ONE_CLICK_INSTALL_UI_FINAL_V1
  const [
    runtimeInstallQueue,
    setRuntimeInstallQueue,
  ] = useState({
    activeJobId: null,
    jobs: [],
  });

  const [
    installingRuntimeType,
    setInstallingRuntimeType,
  ] = useState("");

  const [
    runtimeInstallBusy,
    setRuntimeInstallBusy,
  ] = useState(false);

  // LUKE_AI_RUNTIME_INSTALL_PROGRESS_UI_V2
  const [
    runtimeInstallPreflight,
    setRuntimeInstallPreflight,
  ] = useState({});

  const [
    runtimePreflightBusy,
    setRuntimePreflightBusy,
  ] = useState("");

  const [
    runtimeDetectionInfo,
    setRuntimeDetectionInfo,
  ] = useState(null);

  const [
    resettingCircuitModelId,
    setResettingCircuitModelId,
  ] = useState("");

  const mountedRef = useRef(true);

  const requestJson = useCallback(
    async (
      url,
      options = {},
    ) => {
      const response = await fetch(
        url,
        {
          ...options,
          headers: {
            "content-type":
              "application/json",
            ...(options.headers || {}),
          },
        },
      );

      const text =
        await response.text();

      let data = null;

      try {
        data =
          text
            ? JSON.parse(text)
            : null;
      } catch {
        throw new Error(
          "Backend returned invalid JSON.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          `HTTP ${response.status}`,
        );
      }

      return data;
    },
    [],
  );

  const refresh = useCallback(
    async () => {
      try {
        const data =
          await requestJson(
            "/api/text-chat/conversations",
          );

        if (!mountedRef.current) {
          return;
        }

        const nextConversations =
          data.conversations || [];

        setConversations(
          nextConversations,
        );

        setActiveConversationId(
          (
            currentId =>
              nextConversations.some(
                (conversation) =>
                  conversation.id ===
                  currentId,
              )
                ? currentId
                : (
                    data.lastOpenedConversationId ||
                    nextConversations[0]?.id ||
                    ""
                  )
          )(activeConversationId),
        );

        setError("");
      } catch (refreshError) {
        if (mountedRef.current) {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError),
          );
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [
      activeConversationId,
      requestJson,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;
    refresh();

    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        const data =
          await requestJson(
            "/api/text-runtime/models/available",
          );

        if (cancelled) {
          return;
        }

        const models =
          data.models || [];

        setAvailableModels(models);

        setSelectedModelIds(
          (current) => {
            const existing =
              current.filter(
                (modelId) =>
                  models.some(
                    (model) =>
                      model.modelId ===
                      modelId,
                  ),
              );

            if (existing.length) {
              return existing.slice(
                0,
                data.maximumSelection || 3,
              );
            }

            return models
              .slice(0, 1)
              .map(
                (model) =>
                  model.modelId,
              );
          },
        );
      } catch {
        if (!cancelled) {
          setAvailableModels([]);
        }
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, [requestJson]);

  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) =>
          conversation.id ===
          activeConversationId,
      ) || null,
    [
      conversations,
      activeConversationId,
    ],
  );

  const refreshMemoryStatus =
    useCallback(
      async (
        conversationId,
      ) => {
        if (!conversationId) {
          setMemoryStatus(null);
          return;
        }

        try {
          const data =
            await requestJson(
              "/api/text-chat/memory/status",
              {
                method: "POST",
                body: JSON.stringify({
                  conversationId,
                }),
              },
            );

          setMemoryStatus(data);
        } catch {
          setMemoryStatus(null);
        }
      },
      [requestJson],
    );

  const refreshRuntimeSession =
    useCallback(
      async ({
        automatic = false,
      } = {}) => {
        if (!activeConversationId) {
          return;
        }

        setRefreshingRuntime(true);

        try {
          const data =
            await requestJson(
              "/api/text-runtime/session/refresh",
              {
                method: "POST",
                body: JSON.stringify({
                  conversationId:
                    activeConversationId,
                  forceMemoryRefresh:
                    true,
                  reason:
                    automatic
                      ? "automatic-context-or-ram-threshold"
                      : "manual-user-request",
                }),
              },
            );

          setRuntimeSession(data);

          await refreshMemoryStatus(
            activeConversationId,
          );

          await refresh();
        } catch (runtimeError) {
          setError(
            runtimeError instanceof Error
              ? runtimeError.message
              : String(runtimeError),
          );
        } finally {
          setRefreshingRuntime(false);
        }
      },
      [
        activeConversationId,
        refresh,
        refreshMemoryStatus,
        requestJson,
      ],
    );

  useEffect(() => {
    if (
      !activeConversationId ||
      !memoryStatus
    ) {
      return;
    }

    const requiresRefresh =
      memoryStatus.context?.action ===
        "refresh" ||
      [
        "refresh",
        "emergency-refresh",
      ].includes(
        memoryStatus.ram?.action,
      );

    const alreadyRefreshing =
      refreshingRuntime ||
      [
        "preparing",
        "unloading",
        "loading",
        "verifying",
      ].includes(
        runtimeSession?.status,
      );

    if (
      requiresRefresh &&
      !alreadyRefreshing
    ) {
      refreshRuntimeSession({
        automatic: true,
      });
    }
  }, [
    activeConversationId,
    memoryStatus,
    refreshingRuntime,
    refreshRuntimeSession,
    runtimeSession?.status,
  ]);

  const optimizeMemory =
    useCallback(
      async () => {
        if (!activeConversationId) {
          return;
        }

        setOptimizingMemory(true);

        try {
          const data =
            await requestJson(
              "/api/text-chat/memory/optimize",
              {
                method: "POST",
                body: JSON.stringify({
                  conversationId:
                    activeConversationId,
                  force: true,
                  reason:
                    "manual-user-request",
                }),
              },
            );

          setMemoryStatus({
            ok: true,
            conversationId:
              activeConversationId,
            context:
              data.context,
            ram:
              data.ram,
            memory: {
              hasSummary:
                Boolean(
                  data.conversation
                    ?.memory?.summary,
                ),
              factCount:
                data.conversation
                  ?.memory?.facts
                  ?.length || 0,
              decisionCount:
                data.conversation
                  ?.memory?.decisions
                  ?.length || 0,
              taskCount:
                data.conversation
                  ?.memory?.tasks
                  ?.length || 0,
              snapshotCount:
                data.conversation
                  ?.memory?.snapshots
                  ?.length || 0,
              lastCompactedAt:
                data.conversation
                  ?.memory
                  ?.lastCompactedAt ||
                null,
            },
            session: {
              id:
                data.session?.id ||
                data.conversation
                  ?.session?.id ||
                null,
              refreshCount:
                data.conversation
                  ?.session
                  ?.refreshCount || 0,
              refreshedAt:
                data.conversation
                  ?.session
                  ?.refreshedAt || null,
              refreshReason:
                data.conversation
                  ?.session
                  ?.refreshReason || null,
            },
          });

          await refresh();
        } catch (optimizeError) {
          setError(
            optimizeError instanceof Error
              ? optimizeError.message
              : String(optimizeError),
          );
        } finally {
          setOptimizingMemory(false);
        }
      },
      [
        activeConversationId,
        refresh,
        requestJson,
      ],
    );

  useEffect(() => {
    refreshMemoryStatus(
      activeConversationId,
    );

    const interval =
      window.setInterval(
        () => {
          refreshMemoryStatus(
            activeConversationId,
          );
        },
        5000,
      );

    return () => {
      window.clearInterval(interval);
    };
  }, [
    activeConversationId,
    refreshMemoryStatus,
  ]);

  const filteredConversations = useMemo(
    () => {
      const query =
        search.trim().toLowerCase();

      return [...conversations]
        .filter(
          (conversation) =>
            !query ||
            conversation.title
              .toLowerCase()
              .includes(query) ||
            conversation.messages?.some(
              (message) =>
                message.content
                  .toLowerCase()
                  .includes(query),
            ),
        )
        .sort(
          (left, right) =>
            Number(right.pinned) -
              Number(left.pinned) ||
            new Date(
              right.updatedAt,
            ).getTime() -
              new Date(
                left.updatedAt,
              ).getTime(),
        );
    },
    [
      conversations,
      search,
    ],
  );

  const createConversation =
    useCallback(
      async () => {
        setSaving(true);
        setError("");

        try {
          const data =
            await requestJson(
              "/api/text-chat/conversations",
              {
                method: "POST",
                body: JSON.stringify({
                  title:
                    "บทสนทนาใหม่",
                }),
              },
            );

          setConversations(
            (current) => [
              data.conversation,
              ...current,
            ],
          );

          setActiveConversationId(
            data.conversation.id,
          );

          setDraft("");
        } catch (createError) {
          setError(
            createError instanceof Error
              ? createError.message
              : String(createError),
          );
        } finally {
          setSaving(false);
        }
      },
      [requestJson],
    );

  const generateJudgeSynthesis =
    useCallback(
      async () => {
        if (!activeConversationId) {
          return;
        }

        setJudgeGenerating(true);
        setJudgeResponse("");
        setJudgeFallback(false);
        setError("");

        const controller =
          new AbortController();

        generationAbortRef.current =
          controller;

        try {
          const response = await fetch(
            "/api/text-runtime/judge-synthesis",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify({
                conversationId:
                  activeConversationId,
              }),
              signal:
                controller.signal,
            },
          );

          if (!response.ok) {
            throw new Error(
              await response.text() ||
              `HTTP ${response.status}`,
            );
          }

          if (!response.body) {
            throw new Error(
              "AI Judge stream is unavailable.",
            );
          }

          const reader =
            response.body.getReader();

          const decoder =
            new TextDecoder();

          let buffer = "";
          let accumulated = "";

          while (true) {
            const result =
              await reader.read();

            if (result.done) {
              break;
            }

            buffer += decoder.decode(
              result.value,
              {
                stream: true,
              },
            );

            const frames =
              buffer.split("\n\n");

            buffer =
              frames.pop() || "";

            for (const frame of frames) {
              const lines =
                frame.split(/\r?\n/);

              let eventName =
                "message";

              let dataText = "";

              for (const line of lines) {
                if (
                  line.startsWith(
                    "event:",
                  )
                ) {
                  eventName =
                    line
                      .slice(6)
                      .trim();
                }

                if (
                  line.startsWith(
                    "data:",
                  )
                ) {
                  dataText +=
                    line
                      .slice(5)
                      .trim();
                }
              }

              if (!dataText) {
                continue;
              }

              let payload = null;

              try {
                payload =
                  JSON.parse(dataText);
              } catch {
                continue;
              }

              if (
                eventName ===
                  "judge-delta" &&
                typeof payload.content ===
                  "string"
              ) {
                accumulated +=
                  payload.content;

                setJudgeResponse(
                  accumulated,
                );
              }

              if (
                eventName ===
                "judge-fallback"
              ) {
                setJudgeFallback(true);

                setJudgeResponse(
                  payload.content || "",
                );
              }

              if (
                eventName === "error"
              ) {
                throw new Error(
                  payload.error ||
                  "AI Judge synthesis failed.",
                );
              }
            }
          }

          await refresh();

          await refreshMemoryStatus(
            activeConversationId,
          );
        } catch (judgeError) {
          if (
            judgeError?.name !==
            "AbortError"
          ) {
            setError(
              judgeError instanceof Error
                ? judgeError.message
                : String(judgeError),
            );
          }
        } finally {
          generationAbortRef.current =
            null;

          setJudgeGenerating(false);
        }
      },
      [
        activeConversationId,
        refresh,
        refreshMemoryStatus,
      ],
    );

  const stopJudgeSynthesis =
    useCallback(
      async () => {
        if (!activeConversationId) {
          return;
        }

        try {
          await requestJson(
            "/api/text-runtime/judge-synthesis/stop",
            {
              method: "POST",
              body: JSON.stringify({
                conversationId:
                  activeConversationId,
              }),
            },
          );
        } catch {}

        generationAbortRef.current
          ?.abort();

        setJudgeGenerating(false);
      },
      [
        activeConversationId,
        requestJson,
      ],
    );

  const generateMultiModelResponses =
    useCallback(
      async (
        conversationId,
      ) => {
        const modelIds =
          selectedModelIds
            .slice(0, 3);

        if (!modelIds.length) {
          setError(
            "กรุณาเลือกโมเดลอย่างน้อย 1 โมเดล",
          );
          return;
        }

        setMultiGenerating(true);
        setMultiResponses({});
        setMultiEvaluation(null);
        setError("");

        const controller =
          new AbortController();

        generationAbortRef.current =
          controller;

        try {
          const response = await fetch(
            "/api/text-runtime/multi-generate-stream",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify({
                conversationId,
                modelIds,
              }),
              signal:
                controller.signal,
            },
          );

          if (!response.ok) {
            const message =
              await response.text();

            throw new Error(
              message ||
              `HTTP ${response.status}`,
            );
          }

          if (!response.body) {
            throw new Error(
              "Multi-model stream is unavailable.",
            );
          }

          const reader =
            response.body.getReader();

          const decoder =
            new TextDecoder();

          let buffer = "";

          while (true) {
            const result =
              await reader.read();

            if (result.done) {
              break;
            }

            buffer += decoder.decode(
              result.value,
              {
                stream: true,
              },
            );

            const frames =
              buffer.split("\n\n");

            buffer =
              frames.pop() || "";

            for (const frame of frames) {
              const lines =
                frame.split(/\r?\n/);

              let eventName =
                "message";

              let dataText = "";

              for (const line of lines) {
                if (
                  line.startsWith(
                    "event:",
                  )
                ) {
                  eventName =
                    line
                      .slice(6)
                      .trim();
                }

                if (
                  line.startsWith(
                    "data:",
                  )
                ) {
                  dataText +=
                    line
                      .slice(5)
                      .trim();
                }
              }

              if (!dataText) {
                continue;
              }

              let payload = null;

              try {
                payload =
                  JSON.parse(dataText);
              } catch {
                continue;
              }

              if (
                eventName ===
                  "model-delta" &&
                payload.modelId &&
                typeof payload.content ===
                  "string"
              ) {
                setMultiResponses(
                  (current) => ({
                    ...current,
                    [payload.modelId]:
                      (
                        current[
                          payload.modelId
                        ] || ""
                      ) +
                      payload.content,
                  }),
                );
              }

              if (
                eventName ===
                "multi-complete"
              ) {
                setMultiEvaluation(
                  payload,
                );
              }

              if (
                eventName === "error"
              ) {
                throw new Error(
                  payload.error ||
                  "Multi-model generation failed.",
                );
              }
            }
          }

          await refresh();

          await refreshMemoryStatus(
            conversationId,
          );
        } catch (generationError) {
          if (
            generationError?.name !==
            "AbortError"
          ) {
            setError(
              generationError instanceof Error
                ? generationError.message
                : String(
                    generationError,
                  ),
            );
          }
        } finally {
          generationAbortRef.current =
            null;

          setMultiGenerating(false);
        }
      },
      [
        refresh,
        refreshMemoryStatus,
        selectedModelIds,
      ],
    );

  const stopMultiModelGeneration =
    useCallback(
      async () => {
        if (!activeConversationId) {
          return;
        }

        try {
          await requestJson(
            "/api/text-runtime/multi-generation/stop",
            {
              method: "POST",
              body: JSON.stringify({
                conversationId:
                  activeConversationId,
              }),
            },
          );
        } catch {}

        generationAbortRef.current
          ?.abort();

        setMultiGenerating(false);
      },
      [
        activeConversationId,
        requestJson,
      ],
    );

  const refreshRuntimeInstallQueue =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/text-runtime/install-queue",
            );

          const queue =
            data.queue || {
              activeJobId: null,
              jobs: [],
            };

          setRuntimeInstallQueue(queue);

          const activeJob =
            (queue.jobs || []).find(
              (job) =>
                [
                  "queued",
                  "installing",
                ].includes(job.status),
            );

          setInstallingRuntimeType(
            activeJob?.runtimeType || "",
          );
        } catch {
          setRuntimeInstallQueue({
            activeJobId: null,
            jobs: [],
          });

          setInstallingRuntimeType("");
        }
      },
      [requestJson],
    );

  const checkRuntimeInstallPreflight =
    useCallback(
      async (runtimeType) => {
        setRuntimePreflightBusy(
          runtimeType,
        );

        try {
          const data =
            await requestJson(
              "/api/text-runtime/install-preflight",
              {
                method: "POST",
                body: JSON.stringify({
                  runtimeType,
                }),
              },
            );

          setRuntimeInstallPreflight(
            (current) => ({
              ...current,
              [runtimeType]:
                data.preflight || null,
            }),
          );

          setError("");

          return (
            data.preflight || null
          );
        } catch (preflightError) {
          const preflight =
            preflightError?.data
              ?.preflight ||
            preflightError?.preflight ||
            null;

          setRuntimeInstallPreflight(
            (current) => ({
              ...current,
              [runtimeType]:
                preflight,
            }),
          );

          setError(
            preflightError instanceof Error
              ? preflightError.message
              : String(preflightError),
          );

          return preflight;
        } finally {
          setRuntimePreflightBusy("");
        }
      },
      [requestJson],
    );

  const installDetectedRuntime =
    useCallback(
      async (runtimeType) => {
        setRuntimeInstallBusy(true);
        setInstallingRuntimeType(
          runtimeType,
        );

        try {
          const preflight =
            await checkRuntimeInstallPreflight(
              runtimeType,
            );

          if (
            preflight &&
            preflight.allowed !== true
          ) {
            throw new Error(
              `พื้นที่ว่างไม่เพียงพอ ต้องใช้ ${preflight.requiredText || "พื้นที่เพิ่มเติม"} แต่มี ${preflight.availableText || "ไม่ทราบ"}`,
            );
          }

          const data =
            await requestJson(
              "/api/text-runtime/install",
              {
                method: "POST",
                body: JSON.stringify({
                  runtimeType,
                }),
              },
            );

          setRuntimeInstallQueue(
            data.queue || {
              activeJobId: null,
              jobs: [],
            },
          );

          setError("");
        } catch (installError) {
          setInstallingRuntimeType("");

          setError(
            installError instanceof Error
              ? installError.message
              : String(installError),
          );
        } finally {
          setRuntimeInstallBusy(false);
        }
      },
      [
        checkRuntimeInstallPreflight,
        requestJson,
      ],
    );

  const cancelRuntimeInstall =
    useCallback(
      async (jobId) => {
        setRuntimeInstallBusy(true);

        try {
          const data =
            await requestJson(
              "/api/text-runtime/install-cancel",
              {
                method: "POST",
                body: JSON.stringify({
                  jobId,
                }),
              },
            );

          setRuntimeInstallQueue(
            data.queue || {
              activeJobId: null,
              jobs: [],
            },
          );

          setInstallingRuntimeType("");
          setError("");
        } catch (cancelError) {
          setError(
            cancelError instanceof Error
              ? cancelError.message
              : String(cancelError),
          );
        } finally {
          setRuntimeInstallBusy(false);
        }
      },
      [requestJson],
    );

  const clearRuntimeInstallHistory =
    useCallback(
      async () => {
        setRuntimeInstallBusy(true);

        try {
          const data =
            await requestJson(
              "/api/text-runtime/install-clear",
              {
                method: "POST",
                body: JSON.stringify({}),
              },
            );

          setRuntimeInstallQueue(
            data.queue || {
              activeJobId: null,
              jobs: [],
            },
          );

          setError("");
        } catch (clearError) {
          setError(
            clearError instanceof Error
              ? clearError.message
              : String(clearError),
          );
        } finally {
          setRuntimeInstallBusy(false);
        }
      },
      [requestJson],
    );

  useEffect(() => {
    refreshRuntimeInstallQueue();

    const interval =
      window.setInterval(
        refreshRuntimeInstallQueue,
        2000,
      );

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshRuntimeInstallQueue]);

  const detectInstalledTextRuntimes =
    useCallback(
      async () => {
        setRuntimeDetectionLoading(true);

        try {
          const data =
            await requestJson(
              "/api/text-runtime/detect",
            );

          setDetectedTextRuntimes(
            Array.isArray(
              data.detections,
            )
              ? data.detections
              : [],
          );

          setRuntimeDetectionInfo({
            platform:
              data.platform || "",
            architecture:
              data.architecture || "",
            appleSilicon:
              data.appleSilicon === true,
            installedCount:
              data.installedCount || 0,
            runningCount:
              data.runningCount || 0,
            detectedAt:
              data.detectedAt || null,
          });

          setError("");
        } catch (detectionError) {
          setDetectedTextRuntimes([]);
          setRuntimeDetectionInfo(null);

          setError(
            detectionError instanceof Error
              ? detectionError.message
              : String(detectionError),
          );
        } finally {
          setRuntimeDetectionLoading(false);
        }
      },
      [requestJson],
    );

  const configureDetectedTextRuntime =
    useCallback(
      async (runtimeType) => {
        setConfiguringRuntimeType(
          runtimeType,
        );

        try {
          const data =
            await requestJson(
              "/api/text-runtime/configure-detected",
              {
                method: "POST",
                body: JSON.stringify({
                  runtimeType,
                }),
              },
            );

          if (data.policy) {
            setRuntimeSupervisorPolicy(
              data.policy,
            );

            setRuntimeArgumentsText(
              JSON.stringify(
                data.policy.runtime
                  ?.arguments || [],
                null,
                2,
              ),
            );
          }

          if (data.supervisor) {
            setRuntimeSupervisor(
              data.supervisor,
            );
          }

          await detectInstalledTextRuntimes();

          if (
            typeof loadRuntimeSupervisorPolicy ===
            "function"
          ) {
            await loadRuntimeSupervisorPolicy();
          }

          if (
            typeof refreshRuntimeSupervisor ===
            "function"
          ) {
            await refreshRuntimeSupervisor();
          }

          setError("");
        } catch (configureError) {
          setError(
            configureError instanceof Error
              ? configureError.message
              : String(configureError),
          );
        } finally {
          setConfiguringRuntimeType("");
        }
      },
      [
        detectInstalledTextRuntimes,
        loadRuntimeSupervisorPolicy,
        refreshRuntimeSupervisor,
        requestJson,
      ],
    );

  const refreshRuntimeSupervisor =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/text-runtime/supervisor/status",
            );

          setRuntimeSupervisor(
            data.supervisor || null,
          );
        } catch {
          setRuntimeSupervisor(null);
        }
      },
      [requestJson],
    );

  const loadRuntimeSupervisorPolicy =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/text-runtime/supervisor/settings",
            );

          const policy =
            data.policy || null;

          setRuntimeSupervisorPolicy(
            policy,
          );

          setRuntimeArgumentsText(
            JSON.stringify(
              policy?.runtime
                ?.arguments || [],
              null,
              2,
            ),
          );
        } catch (policyError) {
          setError(
            policyError instanceof Error
              ? policyError.message
              : String(policyError),
          );
        }
      },
      [requestJson],
    );

  const runRuntimeSupervisorAction =
    useCallback(
      async (action) => {
        setRuntimeSupervisorBusy(
          action,
        );

        try {
          // LUKE_AI_SUPERVISOR_EXPLICIT_ENDPOINTS_V1
          const endpointByAction = {
            start:
              "/api/text-runtime/supervisor/start",
            stop:
              "/api/text-runtime/supervisor/stop",
            restart:
              "/api/text-runtime/supervisor/restart",
            reset:
              "/api/text-runtime/supervisor/reset",
          };

          const endpoint =
            endpointByAction[action];

          if (!endpoint) {
            throw new Error(
              `Unsupported supervisor action: ${action}`,
            );
          }

          const data =
            await requestJson(
              endpoint,
              {
                method: "POST",
                body: JSON.stringify({}),
              },
            );

          setRuntimeSupervisor(
            data.supervisor || null,
          );

          setError("");
        } catch (actionError) {
          setError(
            actionError instanceof Error
              ? actionError.message
              : String(actionError),
          );
        } finally {
          setRuntimeSupervisorBusy(
            "",
          );
        }
      },
      [requestJson],
    );

  const saveRuntimeSupervisorPolicy =
    useCallback(
      async () => {
        if (!runtimeSupervisorPolicy) {
          return;
        }

        let parsedArguments = [];

        try {
          parsedArguments =
            JSON.parse(
              runtimeArgumentsText ||
              "[]",
            );
        } catch {
          setError(
            "Runtime Arguments ต้องเป็น JSON Array ที่ถูกต้อง",
          );
          return;
        }

        if (
          !Array.isArray(
            parsedArguments,
          )
        ) {
          setError(
            "Runtime Arguments ต้องเป็น JSON Array",
          );
          return;
        }

        setRuntimeSupervisorBusy(
          "save-settings",
        );

        try {
          const data =
            await requestJson(
              "/api/text-runtime/supervisor/settings",
              {
                method: "PUT",
                body: JSON.stringify({
                  policy: {
                    ...runtimeSupervisorPolicy,
                    runtime: {
                      ...(
                        runtimeSupervisorPolicy
                          .runtime || {}
                      ),
                      arguments:
                        parsedArguments,
                    },
                  },
                }),
              },
            );

          setRuntimeSupervisorPolicy(
            data.policy,
          );

          setRuntimeSupervisor(
            data.supervisor || null,
          );

          setRuntimeSupervisorSettingsOpen(
            false,
          );

          setError("");
        } catch (saveError) {
          setError(
            saveError instanceof Error
              ? saveError.message
              : String(saveError),
          );
        } finally {
          setRuntimeSupervisorBusy(
            "",
          );
        }
      },
      [
        requestJson,
        runtimeArgumentsText,
        runtimeSupervisorPolicy,
      ],
    );

  useEffect(() => {
    refreshRuntimeSupervisor();
    loadRuntimeSupervisorPolicy();

    const interval =
      window.setInterval(
        refreshRuntimeSupervisor,
        5000,
      );

    return () => {
      window.clearInterval(
        interval,
      );
    };
  }, [
    loadRuntimeSupervisorPolicy,
    refreshRuntimeSupervisor,
    detectInstalledTextRuntimes,
  ]);

  const refreshModelHealth =
    useCallback(
      async () => {
        setModelHealthLoading(true);

        try {
          const data =
            await requestJson(
              "/api/text-runtime/model-health",
            );

          setModelHealth(
            data.models || [],
          );
        } catch {
          setModelHealth([]);
        } finally {
          setModelHealthLoading(false);
        }
      },
      [requestJson],
    );

  const resetModelCircuit =
    useCallback(
      async (modelId) => {
        setResettingCircuitModelId(
          modelId,
        );

        try {
          await requestJson(
            "/api/text-runtime/model-health/reset",
            {
              method: "POST",
              body: JSON.stringify({
                modelId,
              }),
            },
          );

          await refreshModelHealth();
        } catch (resetError) {
          setError(
            resetError instanceof Error
              ? resetError.message
              : String(resetError),
          );
        } finally {
          setResettingCircuitModelId(
            "",
          );
        }
      },
      [
        refreshModelHealth,
        requestJson,
      ],
    );

  useEffect(() => {
    refreshModelHealth();

    const interval =
      window.setInterval(
        refreshModelHealth,
        10000,
      );

    return () => {
      window.clearInterval(
        interval,
      );
    };
  }, [refreshModelHealth]);

  const routeModelForPrompt =
    useCallback(
      async (
        conversationId,
        prompt,
      ) => {
        if (!autoRouterEnabled) {
          setRouterDecision(null);
          return null;
        }

        setRoutingModel(true);

        try {
          const data =
            await requestJson(
              "/api/text-runtime/model-router/route",
              {
                method: "POST",
                body: JSON.stringify({
                  conversationId,
                  prompt,
                }),
              },
            );

          setRouterDecision(data);

          return (
            data.selectedModel?.modelId ||
            null
          );
        } catch (routerError) {
          setError(
            routerError instanceof Error
              ? routerError.message
              : String(routerError),
          );

          return null;
        } finally {
          setRoutingModel(false);
        }
      },
      [
        autoRouterEnabled,
        requestJson,
      ],
    );

  const generateAssistantResponse =
    useCallback(
      async (
        conversationId,
        modelId = null,
      ) => {
        setGenerating(true);
        setStreamingResponse("");
        setRecoveryStatus({
          status: "starting",
        });
        setRecoveryAttempts([]);
        setFallbackModelId("");
        setError("");

        const controller =
          new AbortController();

        generationAbortRef.current =
          controller;

        try {
          const response = await fetch(
            "/api/text-runtime/generate-with-recovery",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify({
                conversationId,
                modelId,
              }),
              signal:
                controller.signal,
            },
          );

          if (!response.ok) {
            const errorText =
              await response.text();

            let message =
              errorText ||
              `HTTP ${response.status}`;

            try {
              const parsed =
                JSON.parse(errorText);

              message =
                parsed.error ||
                message;
            } catch {}

            throw new Error(message);
          }

          if (!response.body) {
            throw new Error(
              "Recovery stream is unavailable.",
            );
          }

          const reader =
            response.body.getReader();

          const decoder =
            new TextDecoder();

          let buffer = "";
          let accumulated = "";
          let completed = false;

          while (true) {
            const result =
              await reader.read();

            if (result.done) {
              break;
            }

            buffer += decoder.decode(
              result.value,
              {
                stream: true,
              },
            );

            const frames =
              buffer.split("\\n\\n");

            buffer =
              frames.pop() || "";

            for (const frame of frames) {
              const lines =
                frame.split(/\\r?\\n/);

              let eventName =
                "message";

              let dataText = "";

              for (const line of lines) {
                if (
                  line.startsWith(
                    "event:",
                  )
                ) {
                  eventName =
                    line
                      .slice(6)
                      .trim();
                }

                if (
                  line.startsWith(
                    "data:",
                  )
                ) {
                  dataText +=
                    line
                      .slice(5)
                      .trim();
                }
              }

              if (!dataText) {
                continue;
              }

              let payload = null;

              try {
                payload =
                  JSON.parse(dataText);
              } catch {
                continue;
              }

              if (
                eventName ===
                "recovery-start"
              ) {
                setRecoveryStatus({
                  status: "routing",
                  modelOrder:
                    payload.modelOrder ||
                    [],
                });
              }

              if (
                eventName ===
                "recovery-attempt"
              ) {
                accumulated = "";
                setStreamingResponse("");

                setRecoveryAttempts(
                  (current) => [
                    ...current,
                    {
                      ...payload,
                      status:
                        "generating",
                    },
                  ],
                );

                setRecoveryStatus({
                  status:
                    "generating",
                  modelId:
                    payload.modelId,
                  attempt:
                    payload.attempt,
                });
              }

              if (
                eventName ===
                  "recovery-delta" &&
                typeof payload.content ===
                  "string"
              ) {
                accumulated +=
                  payload.content;

                setStreamingResponse(
                  accumulated,
                );
              }

              if (
                eventName ===
                "recovery-failed-attempt"
              ) {
                setRecoveryAttempts(
                  (current) =>
                    current.map(
                      (attempt) =>
                        attempt.attempt ===
                        payload.attempt
                          ? {
                              ...attempt,
                              status:
                                "failed",
                              errorType:
                                payload.errorType,
                              error:
                                payload.error,
                            }
                          : attempt,
                    ),
                );

                setRecoveryStatus({
                  status:
                    payload.hasNextModel
                      ? "switching"
                      : "failed",
                  failedModelId:
                    payload.modelId,
                  errorType:
                    payload.errorType,
                });
              }

              if (
                eventName ===
                "recovery-complete"
              ) {
                completed = true;

                setRecoveryStatus({
                  status:
                    "completed",
                  successfulModelId:
                    payload
                      .successfulModelId,
                  fallbackUsed:
                    payload
                      .fallbackUsed,
                  successfulAttempt:
                    payload
                      .successfulAttempt,
                });

                if (
                  payload.fallbackUsed
                ) {
                  setFallbackModelId(
                    payload
                      .successfulModelId ||
                    "",
                  );
                }
              }

              if (
                eventName ===
                "recovery-exhausted"
              ) {
                setRecoveryStatus({
                  status:
                    "exhausted",
                });

                throw new Error(
                  payload.error ||
                  "ทุกโมเดลสำรองทำงานไม่สำเร็จ",
                );
              }

              if (
                eventName === "error"
              ) {
                throw new Error(
                  payload.error ||
                  "Runtime recovery failed.",
                );
              }
            }
          }

          setStreamingResponse("");

          if (completed) {
            await refresh();

            await refreshMemoryStatus(
              conversationId,
            );
          }
        } catch (generationError) {
          if (
            generationError?.name !==
            "AbortError"
          ) {
            setError(
              generationError instanceof Error
                ? generationError.message
                : String(
                    generationError,
                  ),
            );
          }
        } finally {
          generationAbortRef.current =
            null;

          setGenerating(false);
        }
      },
      [
        refresh,
        refreshMemoryStatus,
      ],
    );

  const stopGeneration =
    useCallback(
      async () => {
        if (!activeConversationId) {
          return;
        }

        try {
          await requestJson(
            "/api/text-runtime/recovery/stop",
            {
              method: "POST",
              body: JSON.stringify({
                conversationId:
                  activeConversationId,
              }),
            },
          );
        } catch {}

        generationAbortRef.current
          ?.abort();

        setGenerating(false);
      },
      [
        activeConversationId,
        requestJson,
      ],
    );

  const sendMessage =
    useCallback(
      async () => {
        const content =
          draft.trim();

        if (
          !content ||
          generating
        ) {
          return;
        }

        setSaving(true);
        setError("");

        try {
          let conversationId =
            activeConversationId;

          if (!conversationId) {
            const created =
              await requestJson(
                "/api/text-chat/conversations",
                {
                  method: "POST",
                  body: JSON.stringify({
                    title:
                      "บทสนทนาใหม่",
                  }),
                },
              );

            conversationId =
              created.conversation.id;
          }

          const data =
            await requestJson(
              `/api/text-chat/conversations/${encodeURIComponent(
                conversationId,
              )}/messages`,
              {
                method: "POST",
                body: JSON.stringify({
                  role: "user",
                  content,
                }),
              },
            );

          setConversations(
            (current) => {
              const remaining =
                current.filter(
                  (conversation) =>
                    conversation.id !==
                    conversationId,
                );

              return [
                data.conversation,
                ...remaining,
              ];
            },
          );

          setActiveConversationId(
            conversationId,
          );

          setDraft("");

          setSaving(false);

          if (
            multiModelEnabled &&
            selectedModelIds.length > 0
          ) {
            await generateMultiModelResponses(
              conversationId,
            );
          } else {
            const routedModelId =
              await routeModelForPrompt(
                conversationId,
                content,
              );

            await generateAssistantResponse(
              conversationId,
              routedModelId,
            );
          }
        } catch (sendError) {
          setError(
            sendError instanceof Error
              ? sendError.message
              : String(sendError),
          );

          setSaving(false);
        }
      },
      [
        activeConversationId,
        draft,
        generateAssistantResponse,
        generateMultiModelResponses,
        generating,
        multiModelEnabled,
        selectedModelIds,
        requestJson,
        routeModelForPrompt,
      ],
    );

  const submitMessageFeedback =
    useCallback(
      async (
        message,
        feedbackType,
      ) => {
        if (
          !activeConversationId ||
          !message?.id
        ) {
          return;
        }

        setFeedbackBusyId(
          message.id,
        );

        try {
          const data =
            await requestJson(
              "/api/text-chat/feedback",
              {
                method: "POST",
                body: JSON.stringify({
                  conversationId:
                    activeConversationId,
                  messageId:
                    message.id,
                  feedbackType,
                }),
              },
            );

          setConversations(
            (current) =>
              current.map(
                (conversation) =>
                  conversation.id ===
                  activeConversationId
                    ? {
                        ...conversation,
                        messages:
                          conversation.messages.map(
                            (candidate) =>
                              candidate.id ===
                              data.message.id
                                ? data.message
                                : (
                                    feedbackType ===
                                      "preferred" &&
                                    candidate.role ===
                                      "assistant"
                                  )
                                  ? {
                                      ...candidate,
                                      metadata: {
                                        ...(candidate.metadata || {}),
                                        userPreferred:
                                          candidate.id ===
                                          data.message.id,
                                      },
                                    }
                                  : candidate,
                          ),
                      }
                    : conversation,
              ),
          );

          setError("");
        } catch (feedbackError) {
          setError(
            feedbackError instanceof Error
              ? feedbackError.message
              : String(feedbackError),
          );
        } finally {
          setFeedbackBusyId("");
        }
      },
      [
        activeConversationId,
        requestJson,
      ],
    );

  const regenerateMessage =
    useCallback(
      async (message) => {
        if (
          !activeConversationId ||
          !message
        ) {
          return;
        }

        await submitMessageFeedback(
          message,
          "regenerate",
        );

        if (message.modelId) {
          setSelectedModelIds([
            message.modelId,
          ]);

          setMultiModelEnabled(false);
        }

        await generateAssistantResponse(
          activeConversationId,
        );
      },
      [
        activeConversationId,
        generateAssistantResponse,
        submitMessageFeedback,
      ],
    );

  const togglePin = useCallback(
    async (conversation) => {
      try {
        const data =
          await requestJson(
            `/api/text-chat/conversations/${encodeURIComponent(
              conversation.id,
            )}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                pinned:
                  !conversation.pinned,
              }),
            },
          );

        setConversations(
          (current) =>
            current.map(
              (item) =>
                item.id ===
                data.conversation.id
                  ? data.conversation
                  : item,
            ),
        );
      } catch (pinError) {
        setError(
          pinError instanceof Error
            ? pinError.message
            : String(pinError),
        );
      }
    },
    [requestJson],
  );

  const deleteConversation =
    useCallback(
      async (conversationId) => {
        const confirmed =
          window.confirm(
            "ยืนยันการลบบทสนทนานี้หรือไม่?",
          );

        if (!confirmed) {
          return;
        }

        try {
          await requestJson(
            `/api/text-chat/conversations/${encodeURIComponent(
              conversationId,
            )}`,
            {
              method: "DELETE",
            },
          );

          const remaining =
            conversations.filter(
              (conversation) =>
                conversation.id !==
                conversationId,
            );

          setConversations(
            remaining,
          );

          setActiveConversationId(
            remaining[0]?.id || "",
          );
        } catch (deleteError) {
          setError(
            deleteError instanceof Error
              ? deleteError.message
              : String(deleteError),
          );
        }
      },
      [
        conversations,
        requestJson,
      ],
    );

  return (
    <section className="persistent-text-chat">
      <aside className="persistent-chat-sidebar">
        <div className="persistent-chat-sidebar-header">
          <div>
            <span className="text-model-eyebrow">
              Text Chat
            </span>

            <h2>
              ประวัติการสนทนา
            </h2>
          </div>

          <button
            type="button"
            className="m3-btn m3-btn-filled"
            disabled={saving}
            onClick={createConversation}
          >
            <MessageSquarePlus size={16} />
            แชทใหม่
          </button>
        </div>

        <label className="persistent-chat-search">
          <Search size={16} />

          <input
            type="search"
            value={search}
            placeholder="ค้นหาประวัติแชท"
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
          />
        </label>

        <div className="persistent-chat-list">
          {filteredConversations.map(
            (conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={
                  "persistent-chat-list-item " +
                  (
                    conversation.id ===
                    activeConversationId
                      ? "persistent-chat-list-item-active"
                      : ""
                  )
                }
                onClick={() =>
                  setActiveConversationId(
                    conversation.id,
                  )
                }
              >
                <div>
                  <strong>
                    {conversation.title}
                  </strong>

                  <span>
                    {formatDate(
                      conversation.updatedAt,
                    )}
                  </span>
                </div>

                {conversation.pinned && (
                  <Pin size={14} />
                )}
              </button>
            ),
          )}
        </div>
      </aside>

      <div className="persistent-chat-main">
        <header className="persistent-chat-header">
          <div>
            <span className="text-model-eyebrow">
              Conversation
            </span>

            <h2>
              {activeConversation?.title ||
                "เริ่มบทสนทนาใหม่"}
            </h2>

            <p>
              บันทึกอัตโนมัติทุกข้อความ
              และเปิดกลับมาได้หลัง Refresh
              หรือเปิดแอปใหม่
            </p>
          </div>

          <div className="persistent-chat-header-actions">
            {activeConversation && (
              <>
                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  onClick={() =>
                    togglePin(
                      activeConversation,
                    )
                  }
                >
                  <Pin size={15} />
                  {activeConversation.pinned
                    ? "เลิกปักหมุด"
                    : "ปักหมุด"}
                </button>

                <button
                  type="button"
                  className="m3-btn m3-btn-error"
                  onClick={() =>
                    deleteConversation(
                      activeConversation.id,
                    )
                  }
                >
                  <Trash2 size={15} />
                  ลบ
                </button>
              </>
            )}

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              onClick={refresh}
            >
              <RefreshCw size={15} />
              รีเฟรช
            </button>
          </div>
        </header>

        {memoryStatus && (
          <section className="persistent-chat-memory-panel">
            <div className="persistent-chat-memory-heading">
              <div>
                <strong>
                  Conversation Memory
                </strong>

                <span>
                  ระบบรักษาบริบทและรีเฟรชเซสชันอัตโนมัติ
                </span>
              </div>

              <div className="persistent-chat-memory-actions">
                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  disabled={optimizingMemory}
                  onClick={optimizeMemory}
                >
                  {optimizingMemory
                    ? "กำลังเพิ่มประสิทธิภาพ..."
                    : "สร้าง Memory Snapshot"}
                </button>

                <button
                  type="button"
                  className="m3-btn m3-btn-filled"
                  disabled={refreshingRuntime}
                  onClick={() =>
                    refreshRuntimeSession({
                      automatic: false,
                    })
                  }
                >
                  {refreshingRuntime
                    ? "กำลัง Reload Model..."
                    : "Reload Model Runtime"}
                </button>
              </div>
            </div>

            <div className="persistent-chat-memory-grid">
              <div>
                <span>Context</span>
                <strong>
                  {memoryStatus.context
                    ?.usagePercent || 0}%
                </strong>
              </div>

              <div>
                <span>Token โดยประมาณ</span>
                <strong>
                  {(memoryStatus.context
                    ?.estimatedTokens || 0)
                    .toLocaleString()}
                </strong>
              </div>

              <div>
                <span>RAM ใช้งาน</span>
                <strong>
                  {memoryStatus.ram
                    ?.usedPercent || 0}%
                </strong>
              </div>

              <div>
                <span>Session Refresh</span>
                <strong>
                  {memoryStatus.session
                    ?.refreshCount || 0}
                </strong>
              </div>

              <div>
                <span>Memory Facts</span>
                <strong>
                  {memoryStatus.memory
                    ?.factCount || 0}
                </strong>
              </div>

              <div>
                <span>Snapshots</span>
                <strong>
                  {memoryStatus.memory
                    ?.snapshotCount || 0}
                </strong>
              </div>
            </div>

            <div className="persistent-chat-memory-status">
              <span>
                Context Action:
                {" "}
                {memoryStatus.context
                  ?.action || "none"}
              </span>

              <span>
                RAM Action:
                {" "}
                {memoryStatus.ram
                  ?.action || "none"}
              </span>

              <span>
                {memoryStatus.memory
                  ?.hasSummary
                  ? "สรุปบริบทพร้อมใช้งาน"
                  : "ยังไม่ต้องสรุปบริบท"}
              </span>
            </div>

            <div className="persistent-chat-runtime-status">
              <span>
                Runtime:
                {" "}
                {runtimeSession?.status ||
                  "idle"}
              </span>

              <span>
                {runtimeSession?.runtimeOffline
                  ? "Runtime Offline — Memory Prepared"
                  : "Runtime Adapter พร้อมใช้งาน"}
              </span>

              <span>
                Restore Prompt:
                {" "}
                {runtimeSession
                  ?.restorePromptCharacters || 0}
                {" "}
                ตัวอักษร
              </span>
            </div>
          </section>
        )}

        {error && (
          <div className="text-model-manager-error">
            {error}
          </div>
        )}

        <div className="persistent-chat-messages">
          {loading ? (
            <div className="persistent-chat-empty">
              กำลังโหลดประวัติแชท...
            </div>
          ) : activeConversation?.messages
              ?.length ? (
            activeConversation.messages.map(
              (message) => (
                <article
                  key={message.id}
                  className={
                    "persistent-chat-message " +
                    `persistent-chat-message-${message.role}`
                  }
                >
                  <div>
                    {message.role === "user"
                      ? "คุณ"
                      : message.role}
                  </div>

                  <p>
                    {message.content}
                  </p>

                  <time>
                    {formatDate(
                      message.createdAt,
                    )}
                  </time>

                  {message.role ===
                    "assistant" && (
                    <div className="persistent-chat-feedback-actions">
                      <button
                        type="button"
                        title="ชอบคำตอบนี้"
                        className={
                          message.metadata
                            ?.userFeedback ===
                            "like"
                            ? "persistent-chat-feedback-active"
                            : ""
                        }
                        disabled={
                          feedbackBusyId ===
                          message.id
                        }
                        onClick={() =>
                          submitMessageFeedback(
                            message,
                            message.metadata
                              ?.userFeedback ===
                              "like"
                              ? "clear"
                              : "like",
                          )
                        }
                      >
                        <ThumbsUp
                          size={14}
                        />
                      </button>

                      <button
                        type="button"
                        title="ไม่ชอบคำตอบนี้"
                        className={
                          message.metadata
                            ?.userFeedback ===
                            "dislike"
                            ? "persistent-chat-feedback-active"
                            : ""
                        }
                        disabled={
                          feedbackBusyId ===
                          message.id
                        }
                        onClick={() =>
                          submitMessageFeedback(
                            message,
                            message.metadata
                              ?.userFeedback ===
                              "dislike"
                              ? "clear"
                              : "dislike",
                          )
                        }
                      >
                        <ThumbsDown
                          size={14}
                        />
                      </button>

                      <button
                        type="button"
                        title="เลือกเป็นคำตอบที่ต้องการ"
                        className={
                          message.metadata
                            ?.userPreferred
                            ? "persistent-chat-feedback-preferred"
                            : ""
                        }
                        disabled={
                          feedbackBusyId ===
                          message.id
                        }
                        onClick={() =>
                          submitMessageFeedback(
                            message,
                            "preferred",
                          )
                        }
                      >
                        <CheckCircle2
                          size={14}
                        />
                        เลือกคำตอบนี้
                      </button>

                      <button
                        type="button"
                        title="สร้างคำตอบใหม่"
                        disabled={
                          generating ||
                          multiGenerating ||
                          judgeGenerating ||
                          feedbackBusyId ===
                            message.id
                        }
                        onClick={() =>
                          regenerateMessage(
                            message,
                          )
                        }
                      >
                        <RotateCcw
                          size={14}
                        />
                        Regenerate
                      </button>
                    </div>
                  )}
                </article>
              ),
            )
          ) : (
            <div className="persistent-chat-empty">
              เริ่มพิมพ์ข้อความได้เลย
              ระบบจะบันทึกประวัติให้อัตโนมัติ
            </div>
          )}

          {generating && (
            <article className="persistent-chat-message persistent-chat-message-assistant persistent-chat-message-streaming">
              <div>
                assistant
              </div>

              <p>
                {streamingResponse ||
                  "กำลังประมวลผล..."}

                <span className="persistent-chat-streaming-cursor">
                  ▍
                </span>
              </p>
            </article>
          )}
        </div>

        {/* LUKE_AI_STORAGE_DESTINATION_PANEL_MOUNT_FINAL_V1 */}
        {/* LUKE_AI_STORAGE_PROVIDER_PANEL_MOUNT_V2 */}
        {/* LUKE_AI_CLOUD_STORAGE_PANEL_MOUNT_V2 */}
        {/* LUKE_AI_UNIFIED_TRANSFER_QUEUE_MOUNT_V1 */}
        {/* LUKE_AI_STORAGE_AVAILABILITY_WATCHER_MOUNT_V2 */}
        {/* LUKE_AI_STORAGE_HEALTH_SCORE_MOUNT_V2 */}
        {/* LUKE_AI_STORAGE_POLICY_PROFILES_MOUNT_V2 */}
        {/* LUKE_AI_STORAGE_WORKLOAD_DETECTION_MOUNT_V2 */}
        {/* LUKE_AI_STORAGE_LIFECYCLE_MOUNT_V2 */}
        {/* LUKE_AI_STORAGE_ARCHIVE_RESTORE_MOUNT_V2 */}
        {/* LUKE_AI_STORAGE_INTEGRITY_MOUNT_V2 */}
        {/* LUKE_AI_DEEP_CLOUD_INTEGRITY_MOUNT_V1 */}
        {/* LUKE_AI_STORAGE_DISASTER_RECOVERY_MOUNT_V1 */}
        {/* LUKE_AI_STORAGE_RECOVERY_RUNBOOK_MOUNT_V1 */}
        {/* LUKE_AI_STORAGE_RECOVERY_SIMULATION_MOUNT_V1 */}
        <StorageRecoverySimulationPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageRecoveryRunbookPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageDisasterRecoveryPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageDeepCloudIntegrityPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageIntegrityPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageArchiveRestorePanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageLifecyclePlannerPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageWorkloadDetectionPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StoragePolicyProfilesPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageHealthScorePanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageAvailabilityWatcherPanel
          requestJson={requestJson}
          setError={setError}
        />

        <UnifiedTransferQueuePanel
          requestJson={requestJson}
          setError={setError}
        />

        <CloudStorageProviderPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageProviderPanel
          requestJson={requestJson}
          setError={setError}
        />

        <StorageDestinationPanel
          requestJson={requestJson}
          setError={setError}
        />

        <section className="persistent-chat-runtime-detection-panel">
          <div className="persistent-chat-runtime-detection-heading">
            <div>
              <strong>
                Runtime Auto-Detection
              </strong>

              <span>
                ตรวจหา Ollama, llama.cpp และ MLX ที่ติดตั้งในเครื่อง
              </span>
            </div>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={runtimeDetectionLoading}
              onClick={
                detectInstalledTextRuntimes
              }
            >
              {runtimeDetectionLoading
                ? "กำลังตรวจหา..."
                : "ตรวจหา Runtime"}
            </button>
          </div>

          {runtimeDetectionInfo && (
            <div className="persistent-chat-runtime-detection-system">
              <span>
                {runtimeDetectionInfo.platform ||
                  "unknown"}
                {" · "}
                {runtimeDetectionInfo.architecture ||
                  "unknown"}
              </span>

              {runtimeDetectionInfo.appleSilicon && (
                <strong>
                  Apple Silicon
                </strong>
              )}

              <span>
                พบที่ติดตั้ง
                {" "}
                {runtimeDetectionInfo.installedCount}
                {" "}
                รายการ
              </span>

              <span>
                กำลังทำงาน
                {" "}
                {runtimeDetectionInfo.runningCount}
                {" "}
                รายการ
              </span>
            </div>
          )}

          {runtimeDetectionLoading &&
          detectedTextRuntimes.length === 0 ? (
            <div className="persistent-chat-runtime-detection-empty">
              กำลังตรวจสอบ Runtime ในเครื่อง...
            </div>
          ) : detectedTextRuntimes.length === 0 ? (
            <div className="persistent-chat-runtime-detection-empty">
              กด “ตรวจหา Runtime” เพื่อค้นหา Runtime ที่ติดตั้งในเครื่อง
            </div>
          ) : (
            <div className="persistent-chat-runtime-detection-grid">
              {detectedTextRuntimes.map(
                (runtime) => (
                  <article
                    key={runtime.runtimeType}
                    className={
                      "persistent-chat-runtime-detection-card " +
                      (
                        runtime.installed
                          ? "persistent-chat-runtime-installed"
                          : "persistent-chat-runtime-not-installed"
                      )
                    }
                  >
                    <header>
                      <div>
                        <strong>
                          {runtime.displayName ||
                            runtime.runtimeType}
                        </strong>

                        <span>
                          {runtime.runtimeType}
                        </span>
                      </div>

                      <span
                        className={
                          "persistent-chat-runtime-state " +
                          (
                            runtime.running
                              ? "persistent-chat-runtime-running"
                              : runtime.installed
                                ? "persistent-chat-runtime-available"
                                : "persistent-chat-runtime-missing"
                          )
                        }
                      >
                        {runtime.running
                          ? "Running"
                          : runtime.installed
                            ? "Installed"
                            : "Not Installed"}
                      </span>
                    </header>

                    <div className="persistent-chat-runtime-detection-detail">
                      <span>
                        Executable
                      </span>

                      <strong>
                        {runtime.executable ||
                          "ไม่พบในเครื่อง"}
                      </strong>
                    </div>

                    <div className="persistent-chat-runtime-detection-detail">
                      <span>
                        Version
                      </span>

                      <strong>
                        {runtime.version ||
                          "ไม่ทราบเวอร์ชัน"}
                      </strong>
                    </div>

                    <div className="persistent-chat-runtime-detection-detail">
                      <span>
                        Health
                      </span>

                      <strong>
                        {runtime.health?.reachable
                          ? `HTTP ${runtime.health.statusCode || 200}`
                          : "Not reachable"}
                      </strong>
                    </div>

                    {runtime.preset
                      ?.requiresModelPath && (
                      <div className="persistent-chat-runtime-detection-note">
                        ต้องเลือก Model Path หลังจาก Configure
                      </div>
                    )}

                    {/* LUKE_AI_RUNTIME_INSTALL_BUTTON_FINAL_V1 */}
                    {!runtime.installed && (
                      <div className="persistent-chat-runtime-preflight">
                        {runtimeInstallPreflight[
                          runtime.runtimeType
                        ] ? (
                          <>
                            <span>
                              ต้องใช้:
                              {" "}
                              {runtimeInstallPreflight[
                                runtime.runtimeType
                              ].requiredText ||
                                "ไม่ทราบ"}
                            </span>

                            <span>
                              พื้นที่ว่าง:
                              {" "}
                              {runtimeInstallPreflight[
                                runtime.runtimeType
                              ].availableText ||
                                "ไม่ทราบ"}
                            </span>

                            <strong
                              className={
                                runtimeInstallPreflight[
                                  runtime.runtimeType
                                ].allowed
                                  ? "persistent-chat-runtime-preflight-pass"
                                  : "persistent-chat-runtime-preflight-fail"
                              }
                            >
                              {runtimeInstallPreflight[
                                runtime.runtimeType
                              ].allowed
                                ? "พื้นที่เพียงพอ"
                                : "พื้นที่ไม่เพียงพอ"}
                            </strong>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="m3-btn m3-btn-outlined"
                            disabled={
                              runtimePreflightBusy ===
                              runtime.runtimeType
                            }
                            onClick={() =>
                              checkRuntimeInstallPreflight(
                                runtime.runtimeType,
                              )
                            }
                          >
                            {runtimePreflightBusy ===
                            runtime.runtimeType
                              ? "กำลังตรวจพื้นที่..."
                              : "ตรวจพื้นที่ก่อนติดตั้ง"}
                          </button>
                        )}
                      </div>
                    )}

                    {runtime.installed ? (
                      <button
                        type="button"
                        className="m3-btn m3-btn-filled"
                        disabled={
                          Boolean(
                            configuringRuntimeType,
                          ) ||
                          runtimeInstallBusy
                        }
                        onClick={() =>
                          configureDetectedTextRuntime(
                            runtime.runtimeType,
                          )
                        }
                      >
                        {configuringRuntimeType ===
                        runtime.runtimeType
                          ? "กำลังตั้งค่า..."
                          : "One-Click Configure"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="m3-btn m3-btn-filled"
                        disabled={
                          runtimeInstallBusy ||
                          Boolean(
                            installingRuntimeType,
                          )
                        }
                        onClick={() =>
                          installDetectedRuntime(
                            runtime.runtimeType,
                          )
                        }
                      >
                        {installingRuntimeType ===
                        runtime.runtimeType
                          ? "อยู่ในคิวติดตั้ง..."
                          : "One-Click Install"}
                      </button>
                    )}
                  </article>
                ),
              )}
            </div>
          )}

          {/* LUKE_AI_RUNTIME_INSTALL_QUEUE_FINAL_V1 */}
          <div className="persistent-chat-runtime-detection-warning">
            ระบบจะไม่ติดตั้งหรือเปลี่ยนการตั้งค่า Runtime จนกว่าผู้ใช้จะกดปุ่ม
          </div>

          {runtimeInstallQueue.jobs?.length > 0 && (
            <div className="persistent-chat-runtime-install-queue">
              <div className="persistent-chat-runtime-install-heading">
                <div>
                  <strong>
                    Runtime Installation Queue
                  </strong>

                  <span>
                    ระบบติดตั้งทีละรายการเพื่อรักษาความเร็วและความเสถียร
                  </span>
                </div>

                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  disabled={
                    runtimeInstallBusy ||
                    runtimeInstallQueue.jobs.some(
                      (job) =>
                        [
                          "queued",
                          "installing",
                        ].includes(job.status),
                    )
                  }
                  onClick={
                    clearRuntimeInstallHistory
                  }
                >
                  Clear History
                </button>
              </div>

              <div className="persistent-chat-runtime-install-jobs">
                {runtimeInstallQueue.jobs
                  .slice()
                  .reverse()
                  .map((job) => (
                    <article
                      key={job.id}
                      className={
                        "persistent-chat-runtime-install-job " +
                        `persistent-chat-runtime-install-${job.status}`
                      }
                    >
                      <header>
                        <div>
                          <strong>
                            {job.displayName ||
                              job.runtimeType}
                          </strong>

                          <span>
                            {job.installationType ||
                              "installer"}
                          </span>
                        </div>

                        <span>
                          {job.status}
                        </span>
                      </header>

                      <div className="persistent-chat-runtime-install-progress">
                        <div>
                          <span>
                            {job.progressStage ||
                              job.status}
                          </span>

                          <strong>
                            {Math.max(
                              0,
                              Math.min(
                                100,
                                Number(
                                  job.progress,
                                ) || 0,
                              ),
                            )}
                            %
                          </strong>
                        </div>

                        <progress
                          max="100"
                          value={Math.max(
                            0,
                            Math.min(
                              100,
                              Number(
                                job.progress,
                              ) || 0,
                            ),
                          )}
                        />

                        {job.diskPreflight && (
                          <small>
                            พื้นที่ว่าง
                            {" "}
                            {job.diskPreflight
                              .availableText ||
                              "ไม่ทราบ"}
                            {" · "}
                            ต้องใช้
                            {" "}
                            {job.diskPreflight
                              .requiredText ||
                              "ไม่ทราบ"}
                          </small>
                        )}
                      </div>

                      {job.error && (
                        <div className="persistent-chat-runtime-install-error">
                          {job.error}
                        </div>
                      )}

                      {job.log && (
                        <details>
                          <summary>
                            Install Log
                          </summary>

                          <pre>{job.log}</pre>
                        </details>
                      )}

                      {[
                        "queued",
                        "installing",
                      ].includes(
                        job.status,
                      ) && (
                        <button
                          type="button"
                          className="m3-btn m3-btn-error"
                          disabled={
                            runtimeInstallBusy
                          }
                          onClick={() =>
                            cancelRuntimeInstall(
                              job.id,
                            )
                          }
                        >
                          Cancel Install
                        </button>
                      )}

                      {job.status ===
                        "completed" && (
                        <button
                          type="button"
                          className="m3-btn m3-btn-filled"
                          onClick={
                            detectInstalledTextRuntimes
                          }
                        >
                          ตรวจหา Runtime ใหม่
                        </button>
                      )}
                    </article>
                  ))}
              </div>
            </div>
          )}
        </section>

        <section className="persistent-chat-supervisor-panel">
          <div className="persistent-chat-supervisor-heading">
            <div>
              <strong>
                Runtime Supervisor
              </strong>

              <span>
                ควบคุมและตรวจสอบ Text Runtime
              </span>
            </div>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              onClick={() => {
                setRuntimeSupervisorSettingsOpen(
                  (current) => !current,
                );

                if (
                  !runtimeSupervisorPolicy
                ) {
                  loadRuntimeSupervisorPolicy();
                }
              }}
            >
              Runtime Settings
            </button>
          </div>

          <div className="persistent-chat-supervisor-summary">
            <div>
              <span>
                Status
              </span>

              <strong>
                {runtimeSupervisor
                  ?.status ||
                  "unknown"}
              </strong>
            </div>

            <div>
              <span>
                PID
              </span>

              <strong>
                {runtimeSupervisor
                  ?.pid ||
                  "—"}
              </strong>
            </div>

            <div>
              <span>
                Restart
              </span>

              <strong>
                {runtimeSupervisor
                  ?.restartCount ||
                  0}
              </strong>
            </div>

            <div>
              <span>
                Failures
              </span>

              <strong>
                {runtimeSupervisor
                  ?.consecutiveFailures ||
                  0}
              </strong>
            </div>
          </div>

          {runtimeSupervisor
            ?.lastError && (
            <div className="persistent-chat-supervisor-error">
              {runtimeSupervisor.lastError}
            </div>
          )}

          <div className="persistent-chat-supervisor-actions">
            <button
              type="button"
              className="m3-btn m3-btn-filled"
              disabled={
                Boolean(
                  runtimeSupervisorBusy,
                )
              }
              onClick={() =>
                runRuntimeSupervisorAction(
                  "start",
                )
              }
            >
              Start Runtime
            </button>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={
                Boolean(
                  runtimeSupervisorBusy,
                )
              }
              onClick={() =>
                runRuntimeSupervisorAction(
                  "restart",
                )
              }
            >
              Restart Runtime
            </button>

            <button
              type="button"
              className="m3-btn m3-btn-error"
              disabled={
                Boolean(
                  runtimeSupervisorBusy,
                )
              }
              onClick={() =>
                runRuntimeSupervisorAction(
                  "stop",
                )
              }
            >
              Stop Runtime
            </button>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={
                Boolean(
                  runtimeSupervisorBusy,
                )
              }
              onClick={() =>
                runRuntimeSupervisorAction(
                  "reset",
                )
              }
            >
              Reset Supervisor
            </button>
          </div>

          {runtimeSupervisorSettingsOpen &&
            runtimeSupervisorPolicy && (
            <div className="persistent-chat-supervisor-settings">
              <label>
                <span>
                  Runtime Command
                </span>

                <input
                  type="text"
                  value={
                    runtimeSupervisorPolicy
                      .runtime?.command ||
                    ""
                  }
                  placeholder="/path/to/runtime"
                  onChange={(event) =>
                    setRuntimeSupervisorPolicy(
                      (current) => ({
                        ...current,
                        runtime: {
                          ...(current
                            ?.runtime || {}),
                          command:
                            event.target
                              .value,
                        },
                      }),
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Working Directory
                </span>

                <input
                  type="text"
                  value={
                    runtimeSupervisorPolicy
                      .runtime
                      ?.workingDirectory ||
                    "."
                  }
                  onChange={(event) =>
                    setRuntimeSupervisorPolicy(
                      (current) => ({
                        ...current,
                        runtime: {
                          ...(current
                            ?.runtime || {}),
                          workingDirectory:
                            event.target
                              .value,
                        },
                      }),
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Health URL
                </span>

                <input
                  type="text"
                  value={
                    runtimeSupervisorPolicy
                      .runtime?.healthUrl ||
                    ""
                  }
                  placeholder="http://127.0.0.1:10086/health"
                  onChange={(event) =>
                    setRuntimeSupervisorPolicy(
                      (current) => ({
                        ...current,
                        runtime: {
                          ...(current
                            ?.runtime || {}),
                          healthUrl:
                            event.target
                              .value,
                        },
                      }),
                    )
                  }
                />
              </label>

              <label className="persistent-chat-supervisor-settings-wide">
                <span>
                  Runtime Arguments
                </span>

                <textarea
                  rows={6}
                  value={
                    runtimeArgumentsText
                  }
                  onChange={(event) =>
                    setRuntimeArgumentsText(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label className="persistent-chat-supervisor-checkbox">
                <input
                  type="checkbox"
                  checked={
                    runtimeSupervisorPolicy
                      .supervision
                      ?.autoStart === true
                  }
                  onChange={(event) =>
                    setRuntimeSupervisorPolicy(
                      (current) => ({
                        ...current,
                        supervision: {
                          ...(current
                            ?.supervision ||
                            {}),
                          autoStart:
                            event.target
                              .checked,
                        },
                      }),
                    )
                  }
                />

                Auto Start
              </label>

              <label className="persistent-chat-supervisor-checkbox">
                <input
                  type="checkbox"
                  checked={
                    runtimeSupervisorPolicy
                      .supervision
                      ?.autoRestart !==
                    false
                  }
                  onChange={(event) =>
                    setRuntimeSupervisorPolicy(
                      (current) => ({
                        ...current,
                        supervision: {
                          ...(current
                            ?.supervision ||
                            {}),
                          autoRestart:
                            event.target
                              .checked,
                        },
                      }),
                    )
                  }
                />

                Auto Restart
              </label>

              <label>
                <span>
                  Health Interval (ms)
                </span>

                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={
                    runtimeSupervisorPolicy
                      .supervision
                      ?.healthCheckIntervalMs ||
                    5000
                  }
                  onChange={(event) =>
                    setRuntimeSupervisorPolicy(
                      (current) => ({
                        ...current,
                        supervision: {
                          ...(current
                            ?.supervision ||
                            {}),
                          healthCheckIntervalMs:
                            Number(
                              event.target
                                .value,
                            ),
                        },
                      }),
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Maximum Failures
                </span>

                <input
                  type="number"
                  min="1"
                  max="50"
                  value={
                    runtimeSupervisorPolicy
                      .supervision
                      ?.maximumConsecutiveFailures ||
                    5
                  }
                  onChange={(event) =>
                    setRuntimeSupervisorPolicy(
                      (current) => ({
                        ...current,
                        supervision: {
                          ...(current
                            ?.supervision ||
                            {}),
                          maximumConsecutiveFailures:
                            Number(
                              event.target
                                .value,
                            ),
                        },
                      }),
                    )
                  }
                />
              </label>

              <div className="persistent-chat-supervisor-settings-actions">
                <button
                  type="button"
                  className="m3-btn m3-btn-filled"
                  disabled={
                    runtimeSupervisorBusy ===
                    "save-settings"
                  }
                  onClick={
                    saveRuntimeSupervisorPolicy
                  }
                >
                  Save Settings
                </button>

                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  onClick={() =>
                    setRuntimeSupervisorSettingsOpen(
                      false,
                    )
                  }
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {runtimeSupervisor
            ?.events?.length > 0 && (
            <details className="persistent-chat-supervisor-events">
              <summary>
                Supervisor Events
              </summary>

              <div>
                {runtimeSupervisor.events
                  .slice(-10)
                  .reverse()
                  .map((event) => (
                    <article key={event.id}>
                      <strong>
                        {event.type}
                      </strong>

                      <span>
                        {event.createdAt
                          ? formatDate(
                              event.createdAt,
                            )
                          : ""}
                      </span>

                      {event.error && (
                        <small>
                          {event.error}
                        </small>
                      )}
                    </article>
                  ))}
              </div>
            </details>
          )}
        </section>

        <section className="persistent-chat-model-health-panel">
          <div className="persistent-chat-model-health-heading">
            <div>
              <strong>
                Model Health Monitor
              </strong>

              <span>
                ตรวจสอบความเสถียรและหยุดใช้โมเดลที่ล้มเหลวซ้ำชั่วคราว
              </span>
            </div>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={modelHealthLoading}
              onClick={
                refreshModelHealth
              }
            >
              {modelHealthLoading
                ? "กำลังตรวจสอบ..."
                : "Refresh Health"}
            </button>
          </div>

          {modelHealth.length === 0 ? (
            <div className="persistent-chat-model-health-empty">
              ยังไม่มีข้อมูลการทำงานของโมเดล
            </div>
          ) : (
            <div className="persistent-chat-model-health-grid">
              {modelHealth.map(
                (model) => (
                  <article
                    key={model.modelId}
                    className={
                      "persistent-chat-model-health-card " +
                      `persistent-chat-model-health-${model.circuitState}`
                    }
                  >
                    <header>
                      <strong>
                        {model.modelId}
                      </strong>

                      <span>
                        {model.circuitState}
                      </span>
                    </header>

                    <div>
                      <span>
                        Success Rate
                      </span>

                      <strong>
                        {(
                          (
                            model.metrics
                              ?.successRate ??
                            1
                          ) *
                          100
                        ).toFixed(0)}
                        %
                      </strong>
                    </div>

                    <div>
                      <span>
                        Success
                      </span>

                      <strong>
                        {model.totalSuccesses ||
                          0}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Failure
                      </span>

                      <strong>
                        {model.totalFailures ||
                          0}
                      </strong>
                    </div>

                    {model.nextProbeAt && (
                      <small>
                        ทดลองอีกครั้ง:
                        {" "}
                        {formatDate(
                          model.nextProbeAt,
                        )}
                      </small>
                    )}

                    {model.lastErrorType && (
                      <small>
                        ล่าสุด:
                        {" "}
                        {model.lastErrorType}
                      </small>
                    )}

                    {model.circuitState !==
                      "closed" && (
                      <button
                        type="button"
                        className="m3-btn m3-btn-outlined"
                        disabled={
                          resettingCircuitModelId ===
                          model.modelId
                        }
                        onClick={() =>
                          resetModelCircuit(
                            model.modelId,
                          )
                        }
                      >
                        {resettingCircuitModelId ===
                        model.modelId
                          ? "กำลัง Reset..."
                          : "Reset Circuit"}
                      </button>
                    )}
                  </article>
                ),
              )}
            </div>
          )}
        </section>

        {(recoveryStatus ||
          recoveryAttempts.length > 0) && (
          <section className="persistent-chat-recovery-panel">
            <div className="persistent-chat-recovery-heading">
              <div>
                <strong>
                  Runtime Recovery
                </strong>

                <span>
                  สลับโมเดลสำรองอัตโนมัติเมื่อโมเดลหลักทำงานไม่สำเร็จ
                </span>
              </div>

              <strong
                className={
                  "persistent-chat-recovery-state " +
                  `persistent-chat-recovery-state-${recoveryStatus?.status || "idle"}`
                }
              >
                {recoveryStatus?.status ||
                  "idle"}
              </strong>
            </div>

            {recoveryAttempts.length > 0 && (
              <div className="persistent-chat-recovery-attempts">
                {recoveryAttempts.map(
                  (attempt) => (
                    <div
                      key={`${attempt.attempt}-${attempt.modelId}`}
                      className={
                        "persistent-chat-recovery-attempt " +
                        `persistent-chat-recovery-attempt-${attempt.status}`
                      }
                    >
                      <span>
                        ครั้งที่
                        {" "}
                        {attempt.attempt}
                      </span>

                      <strong>
                        {attempt.modelId}
                      </strong>

                      <small>
                        {attempt.status}
                        {attempt.errorType
                          ? ` · ${attempt.errorType}`
                          : ""}
                      </small>
                    </div>
                  ),
                )}
              </div>
            )}

            {fallbackModelId && (
              <div className="persistent-chat-fallback-success">
                ใช้โมเดลสำรองสำเร็จ:
                {" "}
                <strong>
                  {fallbackModelId}
                </strong>
              </div>
            )}
          </section>
        )}

        <section className="persistent-chat-router-panel">
          <div className="persistent-chat-router-heading">
            <div>
              <strong>
                Automatic Model Router
              </strong>

              <span>
                วิเคราะห์ประเภทคำถามและเลือกโมเดลที่เหมาะที่สุด
              </span>
            </div>

            <label className="persistent-chat-router-toggle">
              <input
                type="checkbox"
                checked={autoRouterEnabled}
                disabled={
                  generating ||
                  multiGenerating ||
                  judgeGenerating
                }
                onChange={(event) => {
                  setAutoRouterEnabled(
                    event.target.checked,
                  );

                  if (
                    !event.target.checked
                  ) {
                    setRouterDecision(null);
                  }
                }}
              />

              เลือกโมเดลอัตโนมัติ
            </label>
          </div>

          {routingModel && (
            <div className="persistent-chat-router-loading">
              กำลังวิเคราะห์คำถามและเลือกโมเดล...
            </div>
          )}

          {routerDecision?.selectedModel && (
            <div className="persistent-chat-router-decision">
              <div>
                <span>
                  โมเดลที่เลือก
                </span>

                <strong>
                  {routerDecision
                    .selectedModel
                    .modelName ||
                    routerDecision
                      .selectedModel
                      .modelId}
                </strong>
              </div>

              <div>
                <span>
                  ประเภทคำถาม
                </span>

                <strong>
                  {routerDecision
                    .taskDetection
                    ?.taskType ||
                    "general"}
                </strong>
              </div>

              <div>
                <span>
                  คะแนน Route
                </span>

                <strong>
                  {(
                    routerDecision
                      .selectedModel
                      .routeScore *
                    100
                  ).toFixed(1)}
                </strong>
              </div>

              <div className="persistent-chat-router-reasons">
                {(routerDecision.reasons ||
                  []).map(
                  (reason) => (
                    <span key={reason}>
                      {reason}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
        </section>

        <section className="persistent-chat-multi-model-panel">
          <div className="persistent-chat-multi-model-heading">
            <div>
              <strong>
                Multi-Model Comparison
              </strong>

              <span>
                เลือกได้สูงสุด 3 โมเดล
                และประมวลผลพร้อมกัน
              </span>
            </div>

            <label className="persistent-chat-multi-model-toggle">
              <input
                type="checkbox"
                checked={multiModelEnabled}
                disabled={
                  generating ||
                  multiGenerating
                }
                onChange={(event) =>
                  setMultiModelEnabled(
                    event.target.checked,
                  )
                }
              />

              เปิดใช้งาน
            </label>
          </div>

          {multiModelEnabled && (
            <>
              <div className="persistent-chat-model-selector">
                {availableModels.map(
                  (model) => {
                    const selected =
                      selectedModelIds.includes(
                        model.modelId,
                      );

                    const selectionFull =
                      selectedModelIds.length >=
                        3 &&
                      !selected;

                    return (
                      <label
                        key={
                          model.modelId
                        }
                        className={
                          "persistent-chat-model-option " +
                          (
                            selected
                              ? "persistent-chat-model-option-selected"
                              : ""
                          )
                        }
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={
                            selectionFull ||
                            generating ||
                            multiGenerating
                          }
                          onChange={() =>
                            setSelectedModelIds(
                              (current) =>
                                selected
                                  ? current.filter(
                                      (
                                        modelId,
                                      ) =>
                                        modelId !==
                                        model.modelId,
                                    )
                                  : [
                                      ...current,
                                      model.modelId,
                                    ].slice(
                                      0,
                                      3,
                                    ),
                            )
                          }
                        />

                        <span>
                          <strong>
                            {model.modelName ||
                              model.modelId}
                          </strong>

                          <small>
                            {model.quantization ||
                              model.variantId ||
                              model.version}
                          </small>
                        </span>
                      </label>
                    );
                  },
                )}
              </div>

              {(multiGenerating ||
                Object.keys(
                  multiResponses,
                ).length > 0) && (
                <div className="persistent-chat-multi-results">
                  {selectedModelIds.map(
                    (modelId) => {
                      const model =
                        availableModels.find(
                          (item) =>
                            item.modelId ===
                            modelId,
                        );

                      const evaluated =
                        multiEvaluation
                          ?.responses?.find(
                            (item) =>
                              item.modelId ===
                              modelId,
                          );

                      return (
                        <article
                          key={modelId}
                          className={
                            "persistent-chat-model-result " +
                            (
                              evaluated?.best
                                ? "persistent-chat-model-result-best"
                                : ""
                            )
                          }
                        >
                          <header>
                            <div>
                              <strong>
                                {model?.modelName ||
                                  modelId}
                              </strong>

                              <span>
                                {model?.quantization ||
                                  ""}
                              </span>
                            </div>

                            {evaluated?.best && (
                              <span className="persistent-chat-best-chip">
                                Best Response
                              </span>
                            )}
                          </header>

                          <p>
                            {multiResponses[
                              modelId
                            ] ||
                              (
                                multiGenerating
                                  ? "กำลังประมวลผล..."
                                  : "ไม่มีคำตอบ"
                              )}
                          </p>

                          {evaluated && (
                            <footer>
                              <span>
                                คะแนน:
                                {" "}
                                {(
                                  evaluated.score *
                                  100
                                ).toFixed(1)}
                              </span>

                              <span>
                                อันดับ:
                                {" "}
                                {evaluated.rank}
                              </span>
                            </footer>
                          )}
                        </article>
                      );
                    },
                  )}
                </div>
              )}

              {multiEvaluation?.responses
                ?.length > 0 && (
                <section className="persistent-chat-judge-panel">
                  <div className="persistent-chat-judge-heading">
                    <div>
                      <strong>
                        AI Judge Final Answer
                      </strong>

                      <span>
                        รวมจุดแข็งของทุกโมเดลเป็นคำตอบสุดท้ายเดียว
                      </span>
                    </div>

                    {judgeGenerating ? (
                      <button
                        type="button"
                        className="m3-btn m3-btn-error"
                        onClick={
                          stopJudgeSynthesis
                        }
                      >
                        หยุด AI Judge
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="m3-btn m3-btn-filled"
                        onClick={
                          generateJudgeSynthesis
                        }
                      >
                        สร้าง Final Answer
                      </button>
                    )}
                  </div>

                  {(judgeGenerating ||
                    judgeResponse) && (
                    <article className="persistent-chat-judge-result">
                      <header>
                        <strong>
                          Final Answer
                        </strong>

                        {judgeFallback && (
                          <span className="persistent-chat-judge-fallback">
                            Best Response Fallback
                          </span>
                        )}
                      </header>

                      <p>
                        {judgeResponse ||
                          "กำลังวิเคราะห์และรวมคำตอบ..."}

                        {judgeGenerating && (
                          <span className="persistent-chat-streaming-cursor">
                            ▍
                          </span>
                        )}
                      </p>
                    </article>
                  )}
                </section>
              )}
            </>
          )}
        </section>

        <div className="persistent-chat-composer">
          <textarea
            value={draft}
            placeholder="พิมพ์ข้อความต่อเนื่องได้ที่นี่..."
            onChange={(event) =>
              setDraft(
                event.target.value,
              )
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !generating
              ) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />

          <div className="persistent-chat-composer-footer">
            <span>
              <Save size={14} />
              Autosave เปิดใช้งาน
            </span>

            {multiGenerating ? (
              <button
                type="button"
                className="m3-btn m3-btn-error"
                onClick={
                  stopMultiModelGeneration
                }
              >
                หยุดทุกโมเดล
              </button>
            ) : generating ? (
              <button
                type="button"
                className="m3-btn m3-btn-error"
                onClick={stopGeneration}
              >
                หยุดการสร้างคำตอบ
              </button>
            ) : (
              <button
                type="button"
                className="m3-btn m3-btn-filled"
                disabled={
                  saving ||
                  generating ||
                  multiGenerating ||
                  !draft.trim() ||
                  (
                    multiModelEnabled &&
                    selectedModelIds.length ===
                      0
                  )
                }
                onClick={sendMessage}
              >
                <Send size={16} />
                ส่งข้อความ
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
