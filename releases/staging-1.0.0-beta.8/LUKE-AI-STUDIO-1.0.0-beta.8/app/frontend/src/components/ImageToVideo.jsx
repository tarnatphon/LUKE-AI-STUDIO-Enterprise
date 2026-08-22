// LUKE_AI_I2V_PROMPT_IMPORT_V1
import {
  importPromptFile,
} from "../utils/imageToVideoPromptImport";

// LUKE_AI_I2V_ASYNC_JOB_IMPORT_V1
import {
  createImageToVideoJob,
  getImageToVideoJob,
  listImageToVideoJobs,
  cancelImageToVideoJob,
  retryImageToVideoJob,
  // LUKE_AI_I2V_RECOVERY_IMPORT_V1
  getImageToVideoRecoveryStatus,
  // LUKE_AI_I2V_BATCH_CONTROL_IMPORTS_V1
  pauseImageToVideoBatch,
  resumeImageToVideoBatch,
  cancelImageToVideoBatch,
  getRetryableImageToVideoBatchJobs,
  skipImageToVideoBatchJob,
  listAssets,
} from "../services/api";

import { getImageToVideoRuntimeCapability } from "../services/api";
import ImageToVideoRuntimeHealthCard from "./ImageToVideoRuntimeHealthCard.jsx";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Film, Upload, Play, CheckCircle2, AlertTriangle, Cpu, HardDrive, Plus, Trash2, Sparkles, ShieldCheck, Download, Wrench } from "lucide-react";
import { getImageToVideoCompatibility, generateImageToVideo, getImageToVideoCapabilityStatus, installImageToVideoCapability } from "../services/api";

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("Please select a valid image."));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// LUKE_AI_I2V_BATCH_ANALYTICS_HELPERS_V1
function batchElapsedMs(
  job
) {
  if (
    !job?.startedAt ||
    !job?.finishedAt
  ) {
    return null;
  }

  const started =
    Date.parse(
      job.startedAt
    );

  const finished =
    Date.parse(
      job.finishedAt
    );

  const elapsed =
    finished - started;

  return Number.isFinite(
    elapsed
  ) &&
    elapsed >= 0
    ? elapsed
    : null;
}

function formatBatchDuration(
  milliseconds
) {
  if (
    !Number.isFinite(
      milliseconds
    ) ||
    milliseconds < 0
  ) {
    return "Calculating…";
  }

  let seconds =
    Math.round(
      milliseconds /
      1000
    );

  const hours =
    Math.floor(
      seconds / 3600
    );

  seconds -=
    hours * 3600;

  const minutes =
    Math.floor(
      seconds / 60
    );

  seconds -=
    minutes * 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatBatchBytes(
  bytes
) {
  if (
    !Number.isFinite(
      bytes
    ) ||
    bytes < 0
  ) {
    return "Calculating…";
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const units = [
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let value =
    bytes / 1024;

  let unitIndex = 0;

  while (
    value >= 1024 &&
    unitIndex <
      units.length - 1
  ) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${
    value >= 100
      ? value.toFixed(0)
      : value >= 10
        ? value.toFixed(1)
        : value.toFixed(2)
  } ${units[unitIndex]}`;
}

function escapeBatchCsv(
  value
) {
  const text =
    String(
      value ?? ""
    );

  if (
    /[",\n\r]/.test(
      text
    )
  ) {
    return `"${text.replace(
      /"/g,
      '""',
    )}"`;
  }

  return text;
}

function downloadBatchFile(
  filename,
  contents,
  mimeType
) {
  const blob =
    new Blob(
      [contents],
      {
        type: mimeType,
      },
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const anchor =
    document.createElement(
      "a"
    );

  anchor.href =
    url;

  anchor.download =
    filename;

  document.body.appendChild(
    anchor
  );

  anchor.click();

  anchor.remove();

  URL.revokeObjectURL(
    url
  );
}

export default function ImageToVideo({
 specs, showAlert }) {

  // LUKE_AI_I2V_ASSET_RELATIONSHIP_STATE_V1
  const [
    sourceAssetId,
    setSourceAssetId,
  ] = useState(null);

  const [
    referenceAssetIds,
    setReferenceAssetIds,
  ] = useState([]);

  const [
    assetRelationshipNotice,
    setAssetRelationshipNotice,
  ] = useState("");


  // LUKE_AI_I2V_RUNTIME_HEALTH_STATE_V1
    const [
      runtimeCapability,
      setRuntimeCapability,
    ] = useState(null);

    const [
      runtimeCapabilityLoading,
      setRuntimeCapabilityLoading,
    ] = useState(true);

    const [
      runtimeCapabilityError,
      setRuntimeCapabilityError,
    ] = useState("");

    const refreshRuntimeCapability =
      useCallback(
        async () => {
          setRuntimeCapabilityLoading(
            true,
          );

          try {
            const runtime =
              await getImageToVideoRuntimeCapability();

            setRuntimeCapability(
              runtime,
            );

            setRuntimeCapabilityError(
              "",
            );

            return runtime;
          } catch (error) {
            setRuntimeCapability(
              null,
            );

            setRuntimeCapabilityError(
              error instanceof Error
                ? error.message
                : String(error),
            );

            return null;
          } finally {
            setRuntimeCapabilityLoading(
              false,
            );
          }
        },
        [],
      );

    useEffect(() => {
      refreshRuntimeCapability();
    }, [refreshRuntimeCapability]);

  const [catalog, setCatalog] = useState([]);
  const [source, setSource] = useState(null);
  const [references, setReferences] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [capability, setCapability] = useState({ state: "checking", installed: false });
  const [installing, setInstalling] = useState(false);
  const [assetRelationshipOptions, setAssetRelationshipOptions] = useState([]);
  const [assetRelationshipLoading, setAssetRelationshipLoading] = useState(false);
  const [assetRelationshipError, setAssetRelationshipError] = useState("");

  useEffect(() => {
    getImageToVideoCompatibility()
      .then((data) => setCatalog(data.models || []))
      .catch((e) => showAlert?.({ title: "Compatibility Check Failed", message: e.message, danger: true }));
  }, [showAlert]);

  // LUKE_AI_I2V_ASSET_RELATIONSHIP_PICKER_V1
  const refreshAssetRelationshipOptions = useCallback(async () => {
    setAssetRelationshipLoading(true);
    setAssetRelationshipError("");
    setAssetRelationshipNotice("");

    try {
      const [images, referencesResult] = await Promise.all([
        listAssets({ type: "image" }),
        listAssets({ type: "reference" }),
      ]);

      const nextAssets = [
        ...(Array.isArray(images.assets) ? images.assets : []),
        ...(Array.isArray(referencesResult.assets) ? referencesResult.assets : []),
      ];

      const availableAssetIds = new Set(
        nextAssets.map((asset) => asset.assetId),
      );

      setAssetRelationshipOptions(nextAssets);
      setSourceAssetId((currentAssetId) => {
        if (!currentAssetId || availableAssetIds.has(currentAssetId)) {
          return currentAssetId;
        }

        setAssetRelationshipNotice(
          "A linked source Asset was removed because it is no longer available.",
        );

        return null;
      });
      setReferenceAssetIds((currentAssetIds) => {
        const nextAssetIds = currentAssetIds.filter((assetId) =>
          availableAssetIds.has(assetId),
        );

        if (nextAssetIds.length !== currentAssetIds.length) {
          setAssetRelationshipNotice(
            "One or more linked reference Assets were removed because they are no longer available.",
          );
        }

        return nextAssetIds;
      });
    } catch (error) {
      setAssetRelationshipError(
        error?.message ||
          "Could not load Asset Library links.",
      );
    } finally {
      setAssetRelationshipLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAssetRelationshipOptions();
  }, [refreshAssetRelationshipOptions]);

  const imageAssetOptions = useMemo(
    () => assetRelationshipOptions.filter((asset) => asset.type === "image"),
    [assetRelationshipOptions],
  );

  const referenceAssetOptions = useMemo(
    () => assetRelationshipOptions.filter((asset) => asset.type === "reference"),
    [assetRelationshipOptions],
  );

  const getRelationshipAssetLabel = (asset) =>
    asset.metadata?.originalName ||
    asset.metadata?.filename ||
    asset.sourcePrompt ||
    asset.existingPath?.split(/[\\/]/).pop() ||
    asset.assetId;

  const formatRelationshipAssetPath = (asset) =>
    asset?.existingPath ||
    "Managed record only";

  const selectedRelationshipSourceAsset = useMemo(
    () =>
      assetRelationshipOptions.find(
        (asset) => asset.assetId === sourceAssetId,
      ) || null,
    [assetRelationshipOptions, sourceAssetId],
  );

  const selectedRelationshipReferenceAssets = useMemo(
    () =>
      referenceAssetIds
        .map((assetId) =>
          assetRelationshipOptions.find(
            (asset) => asset.assetId === assetId,
          ),
        )
        .filter(Boolean),
    [assetRelationshipOptions, referenceAssetIds],
  );

  const refreshCapability = async () => {
    try {
      const data = await getImageToVideoCapabilityStatus();
      setCapability(data);
      setInstalling(data.state === "installing");
      return data;
    } catch (error) {
      setCapability({ state: "error", installed: false, message: error.message });
      return null;
    }
  };

  useEffect(() => {
    let timer;
    refreshCapability().then((data) => {
      if (data?.state === "installing") timer = setInterval(refreshCapability, 1500);
    });
    return () => timer && clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!installing) return undefined;
    const timer = setInterval(async () => {
      const data = await refreshCapability();
      if (data && data.state !== "installing") {
        clearInterval(timer);
        if (data.state === "ready") showAlert?.({ title: "Image-to-Video Ready", message: "Runtime installed successfully." });
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [installing, showAlert]);

  const installCapability = async (repair = false) => {
    setInstalling(true);
    setCapability((prev) => ({ ...prev, state: "installing", message: repair ? "Repairing Image-to-Video…" : "Installing Image-to-Video…" }));
    try {
      await installImageToVideoCapability(repair);
    } catch (error) {
      setInstalling(false);
      setCapability({ state: "error", installed: false, message: error.message });
      showAlert?.({ title: "Installation Failed", message: error.message, danger: true });
    }
  };

  const automaticModel = useMemo(
    () => catalog.find((m) => m.workerReady && m.compatibility.status === "recommended")
      || catalog.find((m) => m.workerReady && m.compatibility.status === "limited")
      || catalog.find((m) => m.workerReady)
      || null,
    [catalog]
  );

  const addReferences = async (files) => {
    try {
      const available = Math.max(0, 8 - references.length);
      const accepted = Array.from(files || []).filter((file) => file.type.startsWith("image/")).slice(0, available);
      const items = await Promise.all(accepted.map(readImage));
      setReferences((prev) => [...prev, ...items].slice(0, 8));
    } catch (error) {
      showAlert?.({ title: "Reference Image", message: error.message, danger: true });
    }
  };

  const chooseSource = async (file) => {
    try { setSource(await readImage(file)); }
    catch (error) { showAlert?.({ title: "Source Image", message: error.message, danger: true }); }
  };

  // LUKE_AI_I2V_ASYNC_JOB_STATE_V1
  const [
    activeJob,
    setActiveJob,
  ] = useState(null);

  const [
    jobHistory,
    setJobHistory,
  ] = useState([]);

  const [
    generatedVideoUrl,
    setGeneratedVideoUrl,
  ] = useState("");

  const refreshJobHistory =
    useCallback(
      async () => {
        try {
          const result =
            await listImageToVideoJobs(
              12,
            );

          setJobHistory(
            Array.isArray(
              result?.jobs,
            )
              ? result.jobs
              : [],
          );
        } catch {
        }
      },
      [],
    );

  // LUKE_AI_I2V_UI_RESTART_RECOVERY_V1
  useEffect(() => {
    let cancelled = false;

    const restoreImageToVideoState =
      async () => {
        try {
          const [
            historyResult,
            recoveryResult,
          ] =
            await Promise.all([
              listImageToVideoJobs(
                12,
              ),
              getImageToVideoRecoveryStatus(),
            ]);

          if (cancelled) {
            return;
          }

          const jobs =
            Array.isArray(
              historyResult?.jobs,
            )
              ? historyResult.jobs
              : [];

          setJobHistory(
            jobs,
          );

          // LUKE_AI_I2V_BATCH_RESTART_RECOVERY_V1
          const latestBatchJob =
            jobs.find(
              (job) =>
                Boolean(
                  job?.payload
                    ?.batchId,
                ),
            );

          if (
            latestBatchJob
              ?.payload
              ?.batchId
          ) {
            setCurrentBatchId(
              latestBatchJob
                .payload
                .batchId,
            );
          }

          const active =
            Array.isArray(
              recoveryResult
                ?.activeJobs,
            )
              ? recoveryResult
                  .activeJobs[0]
              : null;

          if (active?.id) {
            setActiveJob(
              active,
            );

            setStatus(
              "Restoring active Image-to-Video job…",
            );

            pollImageToVideoJob(
              active.id,
            ).catch(
              (error) => {
                if (!cancelled) {
                  setStatus(
                    error.message,
                  );
                }
              },
            );

            return;
          }

          const recovered =
            Array.isArray(
              recoveryResult
                ?.recoveredJobs,
            )
              ? recoveryResult
                  .recoveredJobs[0]
              : null;

          if (recovered) {
            setActiveJob(
              recovered,
            );

            setStatus(
              "A previous Image-to-Video job was interrupted when the application closed. Retry the job to generate it again.",
            );

            return;
          }

          const latest =
            jobs[0] || null;

          if (
            latest?.state ===
              "completed"
          ) {
            const output =
              normalizeVideoUrl(
                latest?.output
                  ?.videoUrl ||
                latest?.output
                  ?.output ||
                latest?.output
                  ?.worker
                  ?.output,
              );

            if (output) {
              setGeneratedVideoUrl(
                output,
              );
            }
          }

        } catch {
          await refreshJobHistory();
        }
      };

    restoreImageToVideoState();

    return () => {
      cancelled = true;
    };
  }, []);



  const normalizeVideoUrl =
    (value) => {
      const url =
        String(
          value || "",
        );

      if (
        url.startsWith(
          "app/outputs/",
        )
      ) {
        return (
          "/" +
          url.slice(
            "app/".length,
          )
        );
      }

      return url;
    };

  const pollImageToVideoJob =
    async (jobId) => {
      for (;;) {
        const job =
          await getImageToVideoJob(
            jobId,
          );

        setActiveJob(
          job,
        );

        const percent =
          Math.round(
            Number(
              job?.progress
                ?.percent || 0,
            ),
          );

        if (
          job.state ===
          "queued"
        ) {
          setStatus(
            "Image-to-Video job queued…",
          );
        } else if (
          job.state ===
          "running" ||
          job.state ===
          "cancelling"
        ) {
          setStatus(
            job?.progress
              ?.message ||
              `Creating video… ${percent}%`,
          );
        }

        if (
          job.state ===
          "completed"
        ) {
          const output =
            normalizeVideoUrl(
              job?.output
                ?.videoUrl ||
              job?.output
                ?.output ||
              job?.output
                ?.worker
                ?.output,
            );

          setGeneratedVideoUrl(
            output,
          );

          setStatus(
            "Automatic Image-to-Video completed.",
          );

          await refreshJobHistory();

          return job;
        }

        if (
          job.state ===
          "cancelled"
        ) {
          setStatus(
            "Image-to-Video generation cancelled.",
          );

          await refreshJobHistory();

          return job;
        }

        if (
          job.state ===
          "failed"
        ) {
          await refreshJobHistory();

          throw new Error(
            job?.error
              ?.message ||
              "Image-to-Video generation failed.",
          );
        }

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              1000,
            ),
        );
      }
    };

  const cancelActiveJob =
    async () => {
      if (!activeJob?.id) {
        return;
      }

      try {
        const job =
          await cancelImageToVideoJob(
            activeJob.id,
          );

        setActiveJob(
          job,
        );

        setStatus(
          "Cancelling Image-to-Video generation…",
        );
      } catch (error) {
        showAlert?.({
          title:
            "Cancel Image-to-Video",
          message:
            error.message,
          danger: true,
        });
      }
    };

  const retryJob =
    async (jobId) => {
      setBusy(true);
      setGeneratedVideoUrl("");

      try {
        const job =
          await retryImageToVideoJob(
            jobId,
          );

        setActiveJob(
          job,
        );

        setStatus(
          "Retry queued…",
        );

        await pollImageToVideoJob(
          job.id,
        );
      } catch (error) {
        setStatus(
          error.message,
        );

        showAlert?.({
          title:
            "Retry Image-to-Video",
          message:
            error.message,
          danger: true,
        });
      } finally {
        setBusy(false);
      }
    };

  // LUKE_AI_I2V_ASYNC_JOB_RUN_V1
  // LUKE_AI_I2V_PROMPT_STUDIO_STATE_V1
  const [
    promptText,
    setPromptText,
  ] = useState("");

  const [
    durationSeconds,
    setDurationSeconds,
  ] = useState(5);

  const [
    importedPromptRows,
    setImportedPromptRows,
  ] = useState([]);

  const [
    promptImportStatus,
    setPromptImportStatus,
  ] = useState("");

  // LUKE_AI_I2V_DURATION_STRATEGY_UI_V1
  const durationUsesStitch =
    durationSeconds > 5;

  const handlePromptFile =
    async (file) => {
      if (!file) {
        return;
      }

      try {
        const imported =
          await importPromptFile(
            file,
          );

        setImportedPromptRows(
          imported.rows || [],
        );

        if (
          imported.prompt
        ) {
          setPromptText(
            imported.prompt,
          );
        }

        const importedDuration =
          imported.rows
            ?.find(
              (item) =>
                item.duration,
            )
            ?.duration;

        if (
          [5, 10, 15]
            .includes(
              importedDuration,
            )
        ) {
          setDurationSeconds(
            importedDuration,
          );
        }

        setPromptImportStatus(
          `${file.name}: ${imported.rows?.length || 0} prompt row(s) imported`,
        );

      } catch (error) {
        setPromptImportStatus(
          error.message,
        );

        showAlert?.({
          title:
            "Prompt Import",
          message:
            error.message,
          danger: true,
        });
      }
    };

  // LUKE_AI_I2V_BATCH_STATE_V1
  const [
    currentBatchId,
    setCurrentBatchId,
  ] = useState("");

  const [
    batchSubmitting,
    setBatchSubmitting,
  ] = useState(false);

  const batchJobs =
    currentBatchId
      ? jobHistory.filter(
          (job) =>
            job?.payload
              ?.batchId ===
            currentBatchId,
        )
      : [];

  const batchSummary =
    batchJobs.reduce(
      (summary, job) => {
        summary.total += 1;

        if (
          job.state ===
          "completed"
        ) {
          summary.completed += 1;
        } else if (
          job.state ===
          "failed"
        ) {
          summary.failed += 1;
        } else if (
          job.state ===
          "cancelled"
        ) {
          summary.cancelled += 1;
        } else if (
          job.state ===
          "running"
        ) {
          summary.running += 1;
        } else if (
          job.state ===
          "queued"
        ) {
          summary.queued += 1;

        // LUKE_AI_I2V_BATCH_PAUSED_SUMMARY_V1
        } else if (
          job.state ===
          "paused"
        ) {
          summary.paused += 1;

        } else if (
          job.state ===
          "cancelling"
        ) {
          summary.cancelling += 1;
        }

        return summary;
      },
      {
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        running: 0,
        queued: 0,
        paused: 0,
        cancelling: 0,
      },
    );

  // LUKE_AI_I2V_BATCH_ANALYTICS_MODEL_V1
  const completedBatchJobs =
    batchJobs.filter(
      (job) =>
        job.state ===
        "completed"
    );

  const elapsedSamples =
    completedBatchJobs
      .map(
        batchElapsedMs
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          )
      );

  const averageGenerationMs =
    elapsedSamples.length > 0
      ? elapsedSamples.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        elapsedSamples.length
      : null;

  const remainingActionableJobs =
    batchJobs.filter(
      (job) =>
        [
          "queued",
          "paused",
          "running",
        ].includes(
          job.state
        )
    ).length;

  const estimatedRemainingMs =
    Number.isFinite(
      averageGenerationMs
    )
      ? averageGenerationMs *
        remainingActionableJobs
      : null;

  const outputSizeSamples =
    completedBatchJobs
      .map(
        (job) =>
          Number(
            job?.output
              ?.sizeBytes
          )
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          ) &&
          value >= 0
      );

  const averageOutputBytes =
    outputSizeSamples.length > 0
      ? outputSizeSamples.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        outputSizeSamples.length
      : null;

  const estimatedRemainingBytes =
    Number.isFinite(
      averageOutputBytes
    )
      ? averageOutputBytes *
        remainingActionableJobs
      : null;

  const skippedBatchJobs =
    batchJobs.filter(
      (job) =>
        job.state ===
          "cancelled" &&
        job?.error?.code ===
          "BATCH_SKIPPED"
    );

  const cancelledBatchJobs =
    batchJobs.filter(
      (job) =>
        job.state ===
          "cancelled" &&
        job?.error?.code !==
          "BATCH_SKIPPED"
    );

  const batchAnalytics =
    {
      batchId:
        currentBatchId,

      total:
        batchSummary.total,

      completed:
        batchSummary.completed,

      failed:
        batchSummary.failed,

      cancelled:
        cancelledBatchJobs.length,

      skipped:
        skippedBatchJobs.length,

      running:
        batchSummary.running,

      queued:
        batchSummary.queued,

      paused:
        batchSummary.paused,

      sampleCount:
        elapsedSamples.length,

      averageGenerationMs,

      estimatedRemainingMs,

      outputSizeSampleCount:
        outputSizeSamples.length,

      averageOutputBytes,

      estimatedRemainingBytes,
    };

  const batchFinished =
    batchSummary.total > 0 &&
    (
      batchSummary.completed +
      batchSummary.failed +
      batchSummary.cancelled
    ) ===
      batchSummary.total;

  const batchPercent =
    batchSummary.total > 0
      ? Math.round(
          (
            (
              batchSummary.completed +
              batchSummary.failed +
              batchSummary.cancelled
            ) /
            batchSummary.total
          ) *
            100,
        )
      : 0;

  // LUKE_AI_I2V_BATCH_ENGINE_V1
  // LUKE_AI_I2V_BATCH_CONTROL_HANDLERS_V1
  const [
    batchControlBusy,
    setBatchControlBusy,
  ] = useState(false);

  const batchPaused =
    batchSummary.paused > 0 &&
    batchSummary.queued === 0 &&
    batchSummary.running <= 1;

  const refreshBatchState =
    async () => {
      await refreshJobHistory();
    };

  const runBatchControl =
    async (
      action,
      successMessage,
    ) => {
      if (
        !currentBatchId ||
        batchControlBusy
      ) {
        return;
      }

      setBatchControlBusy(true);

      try {
        await action(
          currentBatchId
        );

        await refreshBatchState();

        setStatus(
          successMessage
        );

      } catch (error) {
        setStatus(
          error.message
        );

        showAlert?.({
          title:
            "Batch Control",
          message:
            error.message,
          danger: true,
        });

      } finally {
        setBatchControlBusy(false);
      }
    };

  const pauseCurrentBatch =
    () =>
      runBatchControl(
        pauseImageToVideoBatch,
        "Batch paused. The currently running video will finish normally.",
      );

  const resumeCurrentBatch =
    () =>
      runBatchControl(
        resumeImageToVideoBatch,
        "Batch resumed.",
      );

  const cancelRemainingBatch =
    () =>
      runBatchControl(
        cancelImageToVideoBatch,
        "Remaining queued Batch jobs cancelled. Current rendering job was preserved.",
      );

  const skipBatchJob =
    async (jobId) => {
      if (
        !currentBatchId ||
        batchControlBusy
      ) {
        return;
      }

      setBatchControlBusy(true);

      try {
        await skipImageToVideoBatchJob(
          currentBatchId,
          jobId,
        );

        await refreshBatchState();

        setStatus(
          "Batch item skipped.",
        );

      } catch (error) {
        setStatus(
          error.message,
        );

        showAlert?.({
          title:
            "Skip Batch Item",
          message:
            error.message,
          danger: true,
        });

      } finally {
        setBatchControlBusy(false);
      }
    };

  const retryFailedBatchItems =
    async () => {
      if (
        !currentBatchId ||
        batchControlBusy
      ) {
        return;
      }

      setBatchControlBusy(true);

      try {
        const result =
          await getRetryableImageToVideoBatchJobs(
            currentBatchId,
          );

        const ids =
          result?.retryableJobIds ||
          [];

        let retried = 0;

        for (
          const jobId of ids
        ) {
          await retryImageToVideoJob(
            jobId,
          );

          retried += 1;
        }

        await refreshBatchState();

        setStatus(
          retried > 0
            ? `Retry queued for ${retried} Batch item(s).`
            : "No failed or cancelled Batch items require retry.",
        );

      } catch (error) {
        setStatus(
          error.message,
        );

        showAlert?.({
          title:
            "Retry Batch",
          message:
            error.message,
          danger: true,
        });

      } finally {
        setBatchControlBusy(false);
      }
    };

  // LUKE_AI_I2V_BATCH_ANALYTICS_EXPORT_V1
  const buildBatchReport =
    () => ({
      generatedAt:
        new Date()
          .toISOString(),

      analytics:
        batchAnalytics,

      jobs:
        batchJobs
          .slice()
          .sort(
            (a, b) =>
              Number(
                a?.payload
                  ?.batchIndex ||
                0
              ) -
              Number(
                b?.payload
                  ?.batchIndex ||
                0
              ),
          )
          .map(
            (job) => ({
              id:
                job.id,

              index:
                job?.payload
                  ?.batchIndex ??
                null,

              state:
                job.state,

              prompt:
                job?.payload
                  ?.prompt ||
                "",

              seconds:
                job?.payload
                  ?.seconds ??
                null,

              createdAt:
                job.createdAt ||
                null,

              startedAt:
                job.startedAt ||
                null,

              finishedAt:
                job.finishedAt ||
                null,

              elapsedMs:
                batchElapsedMs(
                  job
                ),

              sizeBytes:
                Number.isFinite(
                  Number(
                    job?.output
                      ?.sizeBytes
                  )
                )
                  ? Number(
                      job.output
                        .sizeBytes
                    )
                  : null,

              output:
                job.output ||
                null,

              errorCode:
                job?.error
                  ?.code ||
                null,

              errorMessage:
                job?.error
                  ?.message ||
                null,
            }),
          ),
    });

  const exportBatchJson =
    () => {
      if (!currentBatchId) {
        return;
      }

      downloadBatchFile(
        `${currentBatchId}.json`,
        JSON.stringify(
          buildBatchReport(),
          null,
          2,
        ),
        "application/json;charset=utf-8",
      );
    };

  const exportBatchCsv =
    () => {
      if (!currentBatchId) {
        return;
      }

      const report =
        buildBatchReport();

      const headers = [
        "index",
        "job_id",
        "state",
        "prompt",
        "seconds",
        "created_at",
        "started_at",
        "finished_at",
        "elapsed_ms",
        "size_bytes",
        "error_code",
        "error_message",
      ];

      const rows = [
        headers.join(","),
        ...report.jobs.map(
          (job) =>
            [
              job.index,
              job.id,
              job.state,
              job.prompt,
              job.seconds,
              job.createdAt,
              job.startedAt,
              job.finishedAt,
              job.elapsedMs,
              job.sizeBytes,
              job.errorCode,
              job.errorMessage,
            ]
              .map(
                escapeBatchCsv
              )
              .join(","),
        ),
      ];

      downloadBatchFile(
        `${currentBatchId}.csv`,
        rows.join("\n"),
        "text/csv;charset=utf-8",
      );
    };

  const startImportedBatch =
    async () => {
      if (!source) {
        showAlert?.({
          title:
            "Batch Image-to-Video",
          message:
            "Add a source image before starting the batch.",
          danger: true,
        });

        return;
      }

      if (
        importedPromptRows.length <
        1
      ) {
        showAlert?.({
          title:
            "Batch Image-to-Video",
          message:
            "Import a CSV or XLSX file containing prompt rows first.",
        });

        return;
      }

      if (
        runtimeCapability?.ready !==
        true
      ) {
        const currentRuntime =
          await refreshRuntimeCapability();

        if (
          currentRuntime?.ready !==
          true
        ) {
          showAlert?.({
            title:
              "Batch Image-to-Video",
            message:
              "Image-to-Video runtime is not ready.",
            danger: true,
          });

          return;
        }
      }

      const batchId =
        `i2v-batch-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      setCurrentBatchId(
        batchId,
      );

      setBatchSubmitting(
        true,
      );

      setStatus(
        `Creating batch queue: ${importedPromptRows.length} jobs…`,
      );

      try {
        let created = 0;

        for (
          let index = 0;
          index <
          importedPromptRows.length;
          index += 1
        ) {
          const row =
            importedPromptRows[index];

          const rowDuration =
            [5, 10, 15]
              .includes(
                Number(
                  row.duration,
                ),
              )
              ? Number(
                  row.duration,
                )
              : durationSeconds;

          await createImageToVideoJob({
            modelId: "auto",

            imageDataUrl:
              source.dataUrl,
          // LUKE_AI_I2V_ASSET_RELATIONSHIP_PAYLOAD_V1
          sourceAssetId:
            sourceAssetId ||
            null,

          referenceAssetIds:
            Array.isArray(
              referenceAssetIds
            )
              ? referenceAssetIds
              : [],


            references:
              references.map(
                (item) => ({
                  ...item,
                  type: "auto",
                  weight: 1,
                }),
              ),

            referenceLock: true,
            automaticMatch: true,

            prompt:
              row.prompt ||
              promptText,

            seconds:
              rowDuration,

            batchId,

            batchIndex:
              index + 1,

            batchSize:
              importedPromptRows.length,

            batchSource:
              "prompt-file-import",
          });

          created += 1;

          setStatus(
            `Creating batch queue: ${created}/${importedPromptRows.length} jobs…`,
          );
        }

        await refreshJobHistory();

        setStatus(
          `Batch queued: ${created} jobs. Jobs will run sequentially using the certified concurrency=1 pipeline.`,
        );

      } catch (error) {
        await refreshJobHistory();

        setStatus(
          error.message,
        );

        showAlert?.({
          title:
            "Batch Image-to-Video",
          message:
            error.message,
          danger: true,
        });

      } finally {
        setBatchSubmitting(
          false,
        );
      }
    };

  const run = async () => {
    if (
      !source ||
      !automaticModel ||
      automaticModel
        .compatibility
        .status === "blocked"
    ) {
      return;
    }

    setBusy(true);
    setGeneratedVideoUrl("");

    setStatus(
      "Automatic Match is analysing the computer and locking the reference appearance…",
    );

    try {
      // LUKE_AI_I2V_GENERATE_RUNTIME_GATE_V1
      if (
        runtimeCapability?.ready !== true
      ) {
        const currentRuntime =
          await refreshRuntimeCapability();

        if (
          currentRuntime?.ready !== true
        ) {
          throw new Error(
            "Image-to-Video runtime is not ready. Check Torch, MPS/CUDA, required packages and FFmpeg before generating.",
          );
        }
      }

      const job =
        await createImageToVideoJob({
          modelId: "auto",
          imageDataUrl:
            source.dataUrl,
          // LUKE_AI_I2V_ASSET_RELATIONSHIP_PAYLOAD_V1
          sourceAssetId:
            sourceAssetId ||
            null,

          referenceAssetIds:
            Array.isArray(
              referenceAssetIds
            )
              ? referenceAssetIds
              : [],

          references:
            references.map(
              (item) => ({
                ...item,
                type: "auto",
                weight: 1,
              }),
            ),
          referenceLock: true,
          automaticMatch: true,
          prompt: promptText,
          seconds: durationSeconds,
        });

      setActiveJob(
        job,
      );

      setStatus(
        job?.state === "running"
          ? "Image-to-Video generation started…"
          : "Image-to-Video job queued…",
      );

      await pollImageToVideoJob(
        job.id,
      );
    } catch (error) {
      setStatus(
        error.message,
      );

      showAlert?.({
        title:
          "Automatic Image-to-Video",
        message:
          error.message,
        danger: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const runtimeReady = capability.installed === true || capability.state === "ready";
  const blocked = !runtimeReady || !automaticModel || automaticModel.compatibility.status === "blocked";

  return <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>

      {/* LUKE_AI_I2V_RUNTIME_HEALTH_MOUNT_V1 */}
      <ImageToVideoRuntimeHealthCard
        runtime={runtimeCapability}
        loading={runtimeCapabilityLoading}
        error={runtimeCapabilityError}
        onRefresh={refreshRuntimeCapability}
      />

      <Film size={28}/><div><h2 style={{ margin: 0 }}>Automatic Image to Video</h2><div style={{ opacity: .72 }}>Upload images only. LUKE AI selects and applies every setting automatically.</div></div>
    </div>

    <div className="settings-card" style={{ padding: 18, marginBottom: 18, border: "1px solid var(--border-color)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, fontWeight:700 }}><Sparkles size={20}/> Automatic Reference Match</div>
      <p style={{ marginBottom:0, opacity:.78 }}>The system automatically locks identity, hairstyle, clothing, object shape, colors, materials, artwork, logos and background appearance. No model, strength, prompt or motion adjustment is required.</p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.25fr) minmax(300px, .8fr)", gap: 18 }}>
      <section className="settings-card" style={{ padding: 18 }}>
        <h3>1. Upload the image to animate</h3>
        <label style={{ minHeight: 280, border: "2px dashed var(--border-color)", borderRadius: 14, display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden" }}>
          {source ? <img src={source.dataUrl} alt="source" style={{ width: "100%", height: 310, objectFit: "contain" }}/> : <div style={{ textAlign: "center" }}><Upload size={34}/><div style={{marginTop:8}}>Choose the main image</div></div>}
          <input type="file" accept="image/*" hidden onChange={(e)=>chooseSource(e.target.files?.[0])}/>
        </label>

        <h3 style={{ marginTop: 20 }}>2. Add Reference images <span style={{ opacity:.6, fontWeight:400 }}>({references.length}/8)</span></h3>
        <p style={{ opacity:.72, marginTop:-6 }}>Upload the clearest photos available. Front, side and detail views are accepted; the system decides how each image should be used.</p>
        <label style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:12, border:"1px dashed var(--border-color)", borderRadius:12, cursor:"pointer" }}><Plus size={18}/> Add Reference images<input type="file" accept="image/*" multiple hidden onChange={(e)=>addReferences(e.target.files)}/></label>

        <div
          style={{
            marginTop: 16,
            padding: 14,
            border:
              "1px solid var(--border-color)",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <strong>Link existing Asset Library records</strong>
            <button
              type="button"
              onClick={refreshAssetRelationshipOptions}
              disabled={assetRelationshipLoading}
            >
              Refresh
            </button>
          </div>

          <label
            style={{
              display: "grid",
              gap: 6,
              marginBottom: 10,
            }}
          >
            <span>Source Asset</span>
            <select
              value={sourceAssetId || ""}
              disabled={assetRelationshipLoading}
              onChange={(event) => {
                setAssetRelationshipNotice("");
                setSourceAssetId(event.target.value || null);
              }}
            >
              <option value="">No linked source Asset</option>
              {imageAssetOptions.map((asset) => (
                <option
                  key={asset.assetId}
                  value={asset.assetId}
                >
                  {getRelationshipAssetLabel(asset)}
                </option>
              ))}
            </select>
          </label>

          <label
            style={{
              display: "grid",
              gap: 6,
            }}
          >
            <span>Reference Assets</span>
            <select
              multiple
              value={referenceAssetIds}
              disabled={assetRelationshipLoading}
              onChange={(event) => {
                setAssetRelationshipNotice("");
                setReferenceAssetIds(
                  Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                );
              }}
              style={{
                minHeight: 96,
              }}
            >
              {referenceAssetOptions.map((asset) => (
                <option
                  key={asset.assetId}
                  value={asset.assetId}
                >
                  {getRelationshipAssetLabel(asset)}
                </option>
              ))}
            </select>
          </label>

          {assetRelationshipLoading && (
            <p style={{ opacity: .7 }}>
              Loading Asset Library links...
            </p>
          )}

          {assetRelationshipError && (
            <p style={{ color: "var(--md-sys-color-error)" }}>
              {assetRelationshipError}
            </p>
          )}

          {assetRelationshipNotice && (
            <p className="i2v-asset-picker-notice">
              {assetRelationshipNotice}
            </p>
          )}

          <div
            className="i2v-asset-picker-counts"
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            <span>
              {imageAssetOptions.length} source Assets available
            </span>
            <span>
              {referenceAssetOptions.length} reference Assets available
            </span>
          </div>

          {!assetRelationshipLoading &&
            !assetRelationshipError &&
            imageAssetOptions.length === 0 &&
            referenceAssetOptions.length === 0 && (
              <p className="i2v-asset-picker-empty">
                No eligible Asset Library records are available to link yet.
              </p>
            )}

          <div
            style={{
              display: "grid",
              gap: 8,
              marginTop: 12,
            }}
          >
            <div
              style={{
                padding: 10,
                border:
                  "1px solid var(--border-color)",
                borderRadius: 10,
              }}
            >
              <strong>Linked source</strong>
              <p style={{ margin: "6px 0 0", opacity: .72 }}>
                {selectedRelationshipSourceAsset
                  ? `${getRelationshipAssetLabel(selectedRelationshipSourceAsset)} | ${formatRelationshipAssetPath(selectedRelationshipSourceAsset)}`
                  : "No source Asset linked"}
              </p>
            </div>

            <div
              style={{
                padding: 10,
                border:
                  "1px solid var(--border-color)",
                borderRadius: 10,
              }}
            >
              <strong>Linked references</strong>
              {selectedRelationshipReferenceAssets.length > 0 ? (
                <ul
                  style={{
                    margin: "6px 0 0",
                    paddingLeft: 18,
                  }}
                >
                  {selectedRelationshipReferenceAssets.map((asset) => (
                    <li key={asset.assetId}>
                      {getRelationshipAssetLabel(asset)} | {formatRelationshipAssetPath(asset)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "6px 0 0", opacity: .72 }}>
                  No reference Assets linked
                </p>
              )}
            </div>
          </div>

          <p style={{ marginBottom: 0, opacity: .72 }}>
            These links only attach Asset IDs to the generated video record. They do not move, copy, edit or delete files.
          </p>
        </div>

        {/* LUKE_AI_I2V_PROMPT_STUDIO_UI_V1 */}
        <div
          style={{
            marginTop: 16,
            padding: 14,
            border:
              "1px solid var(--border-color)",
            borderRadius: 12,
          }}
        >
          <h3
            style={{
              marginTop: 0,
            }}
          >
            Prompt Studio
          </h3>

          <textarea
            value={
              promptText
            }
            onChange={(event) =>
              setPromptText(
                event.target.value,
              )
            }
            placeholder="Describe the motion, camera movement, lighting and scene..."
            rows={6}
            style={{
              width: "100%",
              resize:
                "vertical",
            }}
          />

          <label
            style={{
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              padding: 10,
              marginTop: 10,
              border:
                "1px dashed var(--border-color)",
              borderRadius: 10,
              cursor:
                "pointer",
            }}
          >
            Import Prompt / Batch

            <input
              type="file"
              accept=".txt,.md,.csv,.xlsx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(event) => {
                const file =
                  event.target
                    .files?.[0];

                handlePromptFile(
                  file,
                );

                event.target.value =
                  "";
              }}
            />
          </label>

          {promptImportStatus && (
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                opacity: 0.75,
              }}
            >
              {promptImportStatus}
            </div>
          )}

          {importedPromptRows
            .length > 1 && (
            <div
              style={{
                marginTop: 10,
                fontSize: 13,
              }}
            >
              Batch preview:
              {" "}
              {importedPromptRows.length}
              {" "}
              rows loaded.
              Phase 3A batch execution
              will consume these rows
              after the duration strategy
              is certified.
            </div>
            )}

          {/* LUKE_AI_I2V_BATCH_STUDIO_UI_V1 */}
          {importedPromptRows
            .length > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border:
                  "1px solid var(--border-color)",
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 10,
                  alignItems:
                    "center",
                }}
              >
                <strong>
                  Batch Studio
                </strong>

                <span>
                  {importedPromptRows.length}
                  {" "}
                  jobs
                </span>
              </div>

              <button
                type="button"
                onClick={
                  startImportedBatch
                }
                disabled={
                  batchSubmitting ||
                  busy
                }
                style={{
                  width: "100%",
                  marginTop: 10,
                  padding: 11,
                }}
              >
                {batchSubmitting
                  ? "Creating Batch Queue…"
                  : `Queue ${importedPromptRows.length} Videos`}
              </button>

              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  opacity: 0.72,
                }}
              >
                Jobs use the existing
                persistent FIFO queue
                and run one at a time
                to protect RAM/MPS.
              </div>
            </div>
          )}

          {currentBatchId && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border:
                  "1px solid var(--border-color)",
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 10,
                }}
              >
                <strong>
                  Batch Progress
                </strong>

                <span>
                  {batchPercent}%
                </span>
              </div>

              <div
                style={{
                  height: 8,
                  marginTop: 10,
                  borderRadius: 999,
                  overflow: "hidden",
                  background:
                    "var(--md-sys-color-surface-container)",
                }}
              >
                <div
                  style={{
                    width:
                      `${batchPercent}%`,
                    height: "100%",
                    background:
                      "var(--md-sys-color-primary)",
                  }}
                />
              </div>

              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(3, 1fr)",
                  gap: 6,
                  fontSize: 13,
                }}
              >
                <span>
                  Total:
                  {" "}
                  {batchSummary.total}
                </span>

                <span>
                  Done:
                  {" "}
                  {batchSummary.completed}
                </span>

                <span>
                  Queue:
                  {" "}
                  {batchSummary.queued}
                </span>

                <span>
                  Running:
                  {" "}
                  {batchSummary.running}
                </span>

                <span>
                  Failed:
                  {" "}
                  {batchSummary.failed}
                </span>

                <span>
                  Cancelled:
                  {" "}
                  {batchSummary.cancelled}
                </span>
              </div>

              {/* LUKE_AI_I2V_BATCH_CONTROL_UI_V1 */}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {batchSummary.paused > 0 ? (
                  <button
                    type="button"
                    disabled={
                      batchControlBusy
                    }
                    onClick={
                      resumeCurrentBatch
                    }
                  >
                    Resume Batch
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={
                      batchControlBusy ||
                      batchFinished ||
                      batchSummary.queued < 1
                    }
                    onClick={
                      pauseCurrentBatch
                    }
                  >
                    Pause Batch
                  </button>
                )}

                <button
                  type="button"
                  disabled={
                    batchControlBusy ||
                    (
                      batchSummary.queued +
                      batchSummary.paused
                    ) < 1
                  }
                  onClick={
                    cancelRemainingBatch
                  }
                >
                  Cancel Remaining
                </button>

                <button
                  type="button"
                  disabled={
                    batchControlBusy ||
                    (
                      batchSummary.failed +
                      batchSummary.cancelled
                    ) < 1
                  }
                  onClick={
                    retryFailedBatchItems
                  }
                >
                  Retry Failed
                </button>
              </div>

              {batchSummary.paused > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    borderRadius: 8,
                    fontWeight: 700,
                  }}
                >
                  PAUSED
                  {" · "}
                  {batchSummary.paused}
                  {" "}
                  job(s) waiting
                  {" · "}
                  current render, if any,
                  continues normally
                </div>
              )}

              {batchJobs.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {batchJobs
                    .slice()
                    .sort(
                      (a, b) =>
                        Number(
                          a?.payload
                            ?.batchIndex ||
                          0
                        ) -
                        Number(
                          b?.payload
                            ?.batchIndex ||
                          0
                        ),
                    )
                    .map(
                      (job) => (
                        <div
                          key={
                            job.id
                          }
                          style={{
                            display:
                              "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "space-between",
                            gap: 8,
                            padding:
                              "8px 10px",
                            border:
                              "1px solid var(--border-color)",
                            borderRadius: 8,
                            fontSize: 13,
                          }}
                        >
                          <span>
                            #
                            {job?.payload
                              ?.batchIndex ||
                              "?"}
                            {" · "}
                            {String(
                              job.state ||
                              "unknown",
                            ).toUpperCase()}
                          </span>

                          {[
                            "queued",
                            "paused",
                          ].includes(
                            job.state,
                          ) && (
                            <button
                              type="button"
                              disabled={
                                batchControlBusy
                              }
                              onClick={() =>
                                skipBatchJob(
                                  job.id,
                                )
                              }
                            >
                              Skip
                            </button>
                          )}
                        </div>
                      ),
                    )}
                </div>
              )}

              {/* LUKE_AI_I2V_BATCH_ANALYTICS_UI_V1 */}
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  border:
                    "1px solid var(--border-color)",
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems:
                      "center",
                    gap: 8,
                    flexWrap:
                      "wrap",
                  }}
                >
                  <strong>
                    Batch Analytics
                  </strong>

                  <span
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                    }}
                  >
                    Observed data only
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(2, minmax(0, 1fr))",
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  <span>
                    Avg. generation:
                    {" "}
                    {Number.isFinite(
                      averageGenerationMs
                    )
                      ? formatBatchDuration(
                          averageGenerationMs
                        )
                      : "Calculating…"}
                  </span>

                  <span>
                    ETA:
                    {" "}
                    {Number.isFinite(
                      estimatedRemainingMs
                    )
                      ? formatBatchDuration(
                          estimatedRemainingMs
                        )
                      : "Calculating…"}
                  </span>

                  <span>
                    Avg. output:
                    {" "}
                    {Number.isFinite(
                      averageOutputBytes
                    )
                      ? formatBatchBytes(
                          averageOutputBytes
                        )
                      : "No size sample yet"}
                  </span>

                  <span>
                    Remaining storage:
                    {" "}
                    {Number.isFinite(
                      estimatedRemainingBytes
                    )
                      ? formatBatchBytes(
                          estimatedRemainingBytes
                        )
                      : "Calculating…"}
                  </span>

                  <span>
                    Time samples:
                    {" "}
                    {elapsedSamples.length}
                  </span>

                  <span>
                    Size samples:
                    {" "}
                    {outputSizeSamples.length}
                  </span>

                  <span>
                    Skipped:
                    {" "}
                    {skippedBatchJobs.length}
                  </span>

                  <span>
                    Cancelled:
                    {" "}
                    {cancelledBatchJobs.length}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    disabled={
                      !currentBatchId
                    }
                    onClick={
                      exportBatchCsv
                    }
                  >
                    Export CSV
                  </button>

                  <button
                    type="button"
                    disabled={
                      !currentBatchId
                    }
                    onClick={
                      exportBatchJson
                    }
                  >
                    Export JSON
                  </button>
                </div>
              </div>

              {batchFinished && (
                <div
                  style={{
                    marginTop: 10,
                    fontWeight: 700,
                  }}
                >
                  Batch completed
                  {" · "}
                  {batchSummary.completed}
                  {" "}
                  successful
                  {" · "}
                  {batchSummary.failed}
                  {" "}
                  failed
                </div>
              )}
            </div>
          )}


          <div
            style={{
              marginTop: 16,
            }}
          >
            <strong>
              Video Duration
            </strong>

            <div
              style={{
                display:
                  "grid",
                gridTemplateColumns:
                  "repeat(3, 1fr)",
                gap: 8,
                marginTop: 8,
              }}
            >
              {[5, 10, 15]
                .map(
                  (seconds) => (
                    <button
                      key={
                        seconds
                      }
                      type="button"
                      onClick={() =>
                        setDurationSeconds(
                          seconds,
                        )
                      }
                      style={{
                        padding: 10,
                        fontWeight:
                          durationSeconds ===
                          seconds
                            ? 700
                            : 400,
                      }}
                    >
                      {seconds} sec
                    </button>
                  ),
                )}
            </div>

            {durationUsesStitch && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                }}
              >
                {durationSeconds} sec
                uses LUKE AI STUDIO Segment/Stitch mode with last-frame continuity and final duration verification.
              </div>
            )}
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10, marginTop:12 }}>
          {references.map((item,index)=><div key={`${item.name}-${index}`} style={{ border:"1px solid var(--border-color)", borderRadius:12, padding:8 }}>
            <img src={item.dataUrl} alt={`reference ${index + 1}`} style={{ width:"100%", height:120, objectFit:"contain", borderRadius:8 }}/>
            <div style={{fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", margin:"7px 0"}}>{item.name}</div>
            <button type="button" onClick={()=>setReferences((prev)=>prev.filter((_,i)=>i!==index))} style={{ width:"100%", display:"flex", justifyContent:"center", gap:6 }}><Trash2 size={15}/> Remove</button>
          </div>)}
        </div>
      </section>

      <section className="settings-card" style={{ padding: 18 }}>
        <h3>Automatic computer check</h3>
        <div style={{ display:"flex", gap:10, marginBottom:12 }}><Cpu size={18}/>{specs?.gpu_name || "GPU detecting…"}</div>
        <div style={{ display:"flex", gap:10, marginBottom:16 }}><HardDrive size={18}/>{specs?.ram_total_gb || 0} GB RAM</div>
        {automaticModel ? <div style={{ padding:14, borderRadius:12, background:"var(--md-sys-color-surface-container)" }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", fontWeight:700 }}>{blocked ? <AlertTriangle size={18}/> : <CheckCircle2 size={18}/>} {automaticModel.compatibility.label}</div>
          <p>{automaticModel.compatibility.reason}</p>
          <div><strong>Selected automatically:</strong> {automaticModel.name}</div>
          <div style={{marginTop:8, display:"flex", gap:7, alignItems:"center"}}><ShieldCheck size={17}/> Maximum Reference Lock enabled</div>
          <p style={{marginBottom:0, opacity:.72}}>Duration, frame count, memory offload and conservative camera motion are selected automatically for this computer.</p>
        </div> : <p>Checking compatible local video models…</p>}
        {!runtimeReady && <div style={{ marginTop:16, padding:14, border:"1px solid var(--border-color)", borderRadius:12 }}>
          <div style={{display:"flex", alignItems:"center", gap:8, fontWeight:700}}><Download size={18}/> Image-to-Video is not installed</div>
          <p style={{opacity:.76}}>{capability.message || "Install the isolated runtime and required AI components. Video models are installed explicitly and generation never downloads model weights silently."}</p>
          <button type="button" onClick={()=>installCapability(capability.state === "error")} disabled={installing} style={{width:"100%", padding:12, display:"flex", justifyContent:"center", gap:8}}>
            {capability.state === "error" ? <Wrench size={18}/> : <Download size={18}/>}
            {installing ? (capability.message || "Installing…") : capability.state === "error" ? "Repair Image-to-Video" : "Install Image-to-Video"}
          </button>
          {installing && <p style={{fontSize:12, opacity:.7}}>Keep LUKE AI open. Installation progress is checked automatically.</p>}
        </div>}
        {runtimeReady && <div style={{marginTop:16, display:"flex", gap:8, alignItems:"center"}}><CheckCircle2 size={18}/> Image-to-Video runtime ready</div>}
        <button onClick={run} disabled={busy || !source || blocked} style={{ width:"100%", marginTop:18, padding:13, display:"flex", justifyContent:"center", gap:8 }}><Play size={18}/>{busy ? "Creating automatically…" : "Create Video Automatically"}</button>
        {!source && <p style={{opacity:.66}}>Upload the main image to enable automatic generation.</p>}
        {status && <p style={{ marginTop:12 }}>{status}</p>}

        {/* LUKE_AI_I2V_ASYNC_JOB_UI_V1 */}
        {activeJob && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              border:
                "1px solid var(--border-color)",
              borderRadius: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: 10,
                alignItems:
                  "center",
              }}
            >
              <strong>
                Generation Job
              </strong>

              <span>
                {activeJob.state}
              </span>
            </div>

            <div
              style={{
                height: 8,
                marginTop: 10,
                borderRadius: 999,
                overflow:
                  "hidden",
                background:
                  "var(--md-sys-color-surface-container)",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width:
                    `${Math.max(
                      0,
                      Math.min(
                        100,
                        Number(
                          activeJob
                            ?.progress
                            ?.percent ||
                            0,
                        ),
                      ),
                    )}%`,
                  background:
                    "var(--md-sys-color-primary)",
                  transition:
                    "width .25s ease",
                }}
              />
            </div>

            <div
              style={{
                marginTop: 7,
                fontSize: 13,
                opacity: 0.76,
              }}
            >
              {Math.round(
                Number(
                  activeJob
                    ?.progress
                    ?.percent ||
                    0,
                ),
              )}
              %
              {" · "}
              {activeJob
                ?.progress
                ?.message ||
                activeJob.state}
            </div>

            {[
              "queued",
              "running",
            ].includes(
              activeJob.state,
            ) && (
              <button
                type="button"
                onClick={
                  cancelActiveJob
                }
                style={{
                  width: "100%",
                  marginTop: 10,
                  padding: 10,
                }}
              >
                Cancel Generation
              </button>
            )}
          </div>
        )}

        {generatedVideoUrl && (
          <div
            style={{
              marginTop: 16,
            }}
          >
            <h3>
              Generated Video
            </h3>

            <video
              src={
                generatedVideoUrl
              }
              controls
              playsInline
              style={{
                width: "100%",
                borderRadius: 12,
                background: "#000",
              }}
            />
          </div>
        )}

        {jobHistory.length > 0 && (
          <div
            style={{
              marginTop: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap: 8,
              }}
            >
              <h3
                style={{
                  margin: 0,
                }}
              >
                Generation History
              </h3>

              <button
                type="button"
                onClick={
                  refreshJobHistory
                }
              >
                Refresh
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
                marginTop: 10,
              }}
            >
              {jobHistory
                .slice(0, 6)
                .map(
                  (job) => (
                    <div
                      key={job.id}
                      style={{
                        padding: 10,
                        border:
                          "1px solid var(--border-color)",
                        borderRadius: 10,
                      }}
                    >
                      <div
                        style={{
                          display:
                            "flex",
                          justifyContent:
                            "space-between",
                          gap: 8,
                        }}
                      >
                        <strong>
                          {job.state}
                        </strong>

                        <span
                          style={{
                            fontSize: 12,
                            opacity: 0.7,
                          }}
                        >
                          {Math.round(
                            Number(
                              job
                                ?.progress
                                ?.percent ||
                                0,
                            ),
                          )}
                          %
                        </span>
                      </div>

                      {job.state ===
                        "completed" &&
                        (
                          job?.output
                            ?.videoUrl ||
                          job?.output
                            ?.output
                        ) && (
                          <button
                            type="button"
                            onClick={() =>
                              setGeneratedVideoUrl(
                                normalizeVideoUrl(
                                  job
                                    ?.output
                                    ?.videoUrl ||
                                  job
                                    ?.output
                                    ?.output,
                                ),
                              )
                            }
                            style={{
                              marginTop: 8,
                            }}
                          >
                            View Video
                          </button>
                        )}

                      {[
                        "completed",
                        "failed",
                        "cancelled",
                      ].includes(
                        job.state,
                      ) && (
                        <button
                          type="button"
                          onClick={() =>
                            retryJob(
                              job.id,
                            )
                          }
                          disabled={busy}
                          style={{
                            marginTop: 8,
                            marginLeft: 8,
                          }}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  ),
                )}
            </div>
          </div>
        )}

      </section>
    </div>
  </div>;
}
