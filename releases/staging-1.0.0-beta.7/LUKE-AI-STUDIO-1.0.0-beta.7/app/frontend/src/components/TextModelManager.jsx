import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Download,
  HardDrive,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Square,
  Users,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const ACTIVE_STATES = new Set([
  "queued",
  "downloading",
  "verifying",
]);

const TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

const STATE_LABELS = {
  queued: "รอคิว",
  downloading: "กำลังดาวน์โหลด",
  verifying: "กำลังตรวจ SHA256",
  paused: "หยุดชั่วคราว",
  completed: "ติดตั้งแล้ว",
  failed: "ดาวน์โหลดไม่สำเร็จ",
  cancelled: "ยกเลิกแล้ว",
  skipped: "ข้ามแล้ว",
};

function formatBytes(value) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  const index = Math.min(
    Math.floor(
      Math.log(bytes) /
      Math.log(1024),
    ),
    units.length - 1,
  );

  const amount =
    bytes / (1024 ** index);

  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getModelName(model) {
  return (
    model.name?.th ||
    model.name?.en ||
    model.id
  );
}

function getModelQueueItem(
  queueItems,
  modelId,
  variantId,
) {
  return queueItems.find(
    (item) =>
      item.modelId === modelId &&
      item.variantId === variantId &&
      ![
        "cancelled",
        "skipped",
      ].includes(item.state),
  );
}

function getStatusClass(state) {
  if (state === "completed") {
    return "text-model-status-ready";
  }

  if (
    state === "failed" ||
    state === "cancelled"
  ) {
    return "text-model-status-error";
  }

  if (
    state === "paused" ||
    state === "skipped"
  ) {
    return "text-model-status-muted";
  }

  return "text-model-status-active";
}

function DownloadProgress({ item }) {
  if (!item) {
    return null;
  }

  const percent = Math.max(
    0,
    Math.min(
      100,
      Number(item.progress?.percent) || 0,
    ),
  );

  return (
    <div className="text-model-progress-section">
      <div className="text-model-progress-header">
        <span>
          {STATE_LABELS[item.state] || item.state}
        </span>

        <strong>{percent}%</strong>
      </div>

      <div
        className="progress-bar-container text-model-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent}
      >
        <div
          className="progress-bar-fill text-model-progress-fill"
          style={{
            width: `${percent}%`,
          }}
        />
      </div>

      <div className="text-model-progress-meta">
        <span>
          {formatBytes(
            item.progress?.downloadedBytes,
          )}

          {item.progress?.totalBytes
            ? ` / ${formatBytes(
                item.progress.totalBytes,
              )}`
            : ""}
        </span>

        <span>
          {formatBytes(
            item.progress
              ?.speedBytesPerSecond,
          )}/s
        </span>
      </div>
    </div>
  );
}

function ModelCard({
  model,
  queueItems,
  updateInfo,
  hardwareInfo,
  busyId,
  onDownload,
  onUpdate,
  onAction,
}) {
  // LUKE_AI_TEXT_MODEL_HARDWARE_UI_V3
  const recommendedVariantId =
    hardwareInfo?.recommendedVariantId ||
    model.recommendedVariant ||
    model.variants?.[0]?.id ||
    "";

  const [
    selectedVariantId,
    setSelectedVariantId,
  ] = useState(
    recommendedVariantId,
  );

  useEffect(() => {
    if (recommendedVariantId) {
      setSelectedVariantId(
        recommendedVariantId,
      );
    }
  }, [recommendedVariantId]);

  const variant =
    model.variants?.find(
      (item) =>
        item.id === selectedVariantId,
    ) ||
    model.variants?.find(
      (item) =>
        item.id === recommendedVariantId,
    ) ||
    model.variants?.[0];

  const variantHardware =
    hardwareInfo?.variants?.find(
      (item) =>
        item.id === variant?.id,
    ) ||
    null;

  const queueItem = variant
    ? getModelQueueItem(
        queueItems,
        model.id,
        variant.id,
      )
    : null;

  const busy =
    busyId === model.id ||
    busyId === queueItem?.id;

  const installed =
    queueItem?.state === "completed";

  const active =
    queueItem &&
    (
      ACTIVE_STATES.has(queueItem.state) ||
      queueItem.state === "paused"
    );

  return (
    <article className="m3-card text-model-card">
      <div className="text-model-card-header">
        <div
          className={
            "text-model-icon " +
            (
              model.category === "community"
                ? "text-model-icon-community"
                : "text-model-icon-official"
            )
          }
        >
          {model.category === "community"
            ? <Users size={22} />
            : <ShieldCheck size={22} />}
        </div>

        <div className="text-model-title-group">
          <h3 className="m3-card-title">
            {getModelName(model)}
          </h3>

          <div className="text-model-publisher">
            {model.publisher}
            {" · "}
            {model.runtime}
          </div>
        </div>

        <div className="text-model-card-statuses">
          {updateInfo?.updateAvailable && (
            <span className="status-chip text-model-update-available">
              Update Available
            </span>
          )}

          <span
            className={
              "status-chip " +
              (
                model.category === "community"
                  ? "text-model-category-community"
                  : "text-model-category-official"
              )
            }
          >
            {model.category === "community"
              ? "Community"
              : "Official"}
          </span>
        </div>
      </div>

      <p className="text-model-description">
        {model.description?.th ||
          model.description?.en ||
          "โมเดลข้อความสำหรับใช้งานภายในเครื่อง"}
      </p>

      {updateInfo?.installed && (
        <div className="text-model-version-status">
          <div>
            <span>เวอร์ชันติดตั้ง</span>
            <strong>
              {updateInfo.installedVersion}
            </strong>
          </div>

          <div>
            <span>เวอร์ชันล่าสุด</span>
            <strong>
              {updateInfo.latestVersion}
            </strong>
          </div>

          {updateInfo.rollbackAvailable && (
            <span className="text-model-rollback-ready">
              <RotateCcw size={14} />
              Rollback พร้อม
            </span>
          )}
        </div>
      )}

      <div className="text-model-variant-selector">
        <label
          htmlFor={`text-model-variant-${model.id}`}
        >
          Quantization
        </label>

        <select
          id={`text-model-variant-${model.id}`}
          value={variant?.id || ""}
          disabled={
            Boolean(queueItem) ||
            busy
          }
          onChange={(event) =>
            setSelectedVariantId(
              event.target.value,
            )
          }
        >
          {(model.variants || []).map(
            (candidate) => {
              const compatibility =
                hardwareInfo?.variants?.find(
                  (item) =>
                    item.id === candidate.id,
                );

              let suffix = " — ไม่แนะนำ";

              if (
                compatibility?.compatibility ===
                "recommended"
              ) {
                suffix = " — แนะนำ";
              } else if (
                compatibility?.compatibility ===
                "compatible"
              ) {
                suffix = " — ใช้งานได้";
              }

              return (
                <option
                  key={candidate.id}
                  value={candidate.id}
                  disabled={
                    compatibility?.downloadable ===
                    false
                  }
                >
                  {candidate.quantization}
                  {suffix}
                </option>
              );
            },
          )}
        </select>

        {variantHardware && (
          <div
            className={
              "text-model-hardware-status " +
              (
                variantHardware.compatibility ===
                "recommended"
                  ? "text-model-hardware-recommended"
                  : variantHardware.compatibility ===
                      "compatible"
                    ? "text-model-hardware-compatible"
                    : "text-model-hardware-incompatible"
              )
            }
          >
            {variantHardware.compatibility ===
            "recommended"
              ? "เหมาะกับเครื่องนี้"
              : variantHardware.compatibility ===
                  "compatible"
                ? "สามารถใช้งานได้"
                : "ไม่แนะนำสำหรับเครื่องนี้"}
          </div>
        )}
      </div>

      <div className="text-model-meta-grid">
        <div>
          <span>เวอร์ชัน</span>
          <strong>{model.version}</strong>
        </div>

        <div>
          <span>Context</span>
          <strong>
            {Number(
              model.contextLength || 0,
            ).toLocaleString()}
          </strong>
        </div>

        <div>
          <span>Quantization</span>
          <strong>
            {variant?.quantization || "-"}
          </strong>
        </div>

        <div>
          <span>ขนาด</span>
          <strong>
            {formatBytes(
              variant?.sizeBytes,
            )}
          </strong>
        </div>
      </div>

      {model.safetyProfile && (
        <div className="text-model-safety-profile">
          <Wrench size={15} />

          <span>
            Safety Profile:
            {" "}
            <strong>
              {model.safetyProfile}
            </strong>
          </span>
        </div>
      )}

      {model.behaviorNotice?.th && (
        <div className="text-model-notice">
          <AlertTriangle size={15} />
          <span>
            {model.behaviorNotice.th}
          </span>
        </div>
      )}

      {queueItem && (
        <>
          <div className="text-model-current-status">
            <span
              className={`status-chip ${getStatusClass(
                queueItem.state,
              )}`}
            >
              {STATE_LABELS[
                queueItem.state
              ] || queueItem.state}
            </span>

            {queueItem.queuePosition && (
              <span className="text-model-queue-position">
                คิวที่ {queueItem.queuePosition}
              </span>
            )}
          </div>

          <DownloadProgress
            item={queueItem}
          />

          {queueItem.checksum?.verified && (
            <div className="text-model-checksum">
              <CheckCircle2 size={15} />
              SHA256 ตรวจสอบผ่าน
            </div>
          )}

          {queueItem.error?.message && (
            <div className="text-model-error">
              <AlertTriangle size={15} />
              <span>
                {queueItem.error.message}
              </span>
            </div>
          )}
        </>
      )}

      <div className="text-model-card-actions">
        {!queueItem &&
          updateInfo?.updateAvailable && (
          <button
            type="button"
            className="m3-btn m3-btn-filled text-model-update-button"
            disabled={busy}
            onClick={() =>
              onUpdate(model)
            }
          >
            {busy
              ? (
                <LoaderCircle
                  className="progress-spinner"
                  size={15}
                />
              )
              : <RefreshCw size={15} />}

            อัปเดตทันที
          </button>
        )}

        {!queueItem &&
          !updateInfo?.installed &&
          variant && (
          <button
            type="button"
            className="m3-btn m3-btn-filled"
            disabled={
              busy ||
              variantHardware?.downloadable ===
                false
            }
            onClick={() =>
              onDownload(
                model,
                variant,
              )
            }
          >
            {busy
              ? (
                <LoaderCircle
                  className="progress-spinner"
                  size={15}
                />
              )
              : <Download size={15} />}

            ดาวน์โหลดทันที
          </button>
        )}

        {queueItem?.state ===
          "downloading" && (
          <button
            type="button"
            className="m3-btn m3-btn-outlined"
            disabled={busy}
            onClick={() =>
              onAction(
                queueItem,
                "pause",
              )
            }
          >
            <CirclePause size={15} />
            หยุดชั่วคราว
          </button>
        )}

        {[
          "paused",
          "failed",
        ].includes(
          queueItem?.state,
        ) && (
          <button
            type="button"
            className="m3-btn m3-btn-filled"
            disabled={busy}
            onClick={() =>
              onAction(
                queueItem,
                "resume",
              )
            }
          >
            <CirclePlay size={15} />
            {queueItem.state === "failed"
              ? "ลองใหม่"
              : "ดาวน์โหลดต่อ"}
          </button>
        )}

        {queueItem?.state ===
          "queued" && (
          <>
            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={busy}
              onClick={() =>
                onAction(
                  queueItem,
                  "move",
                  {
                    direction: "up",
                  },
                )
              }
            >
              <ArrowUp size={15} />
              เลื่อนขึ้น
            </button>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={busy}
              onClick={() =>
                onAction(
                  queueItem,
                  "move",
                  {
                    direction: "down",
                  },
                )
              }
            >
              <ArrowDown size={15} />
              เลื่อนลง
            </button>

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={busy}
              onClick={() =>
                onAction(
                  queueItem,
                  "skip",
                )
              }
            >
              <SkipForward size={15} />
              ข้าม
            </button>
          </>
        )}

        {queueItem &&
          !TERMINAL_STATES.has(
            queueItem.state,
          ) && (
          <button
            type="button"
            className="m3-btn m3-btn-error"
            disabled={busy}
            onClick={() =>
              onAction(
                queueItem,
                "cancel",
              )
            }
          >
            <Square size={14} />
            ยกเลิก
          </button>
        )}

        {installed && (
          <span className="text-model-installed">
            <PackageCheck size={16} />
            พร้อมใช้งาน
          </span>
        )}
      </div>
    </article>
  );
}

export default function TextModelManager() {
  const [catalog, setCatalog] =
    useState(null);

  const [queue, setQueue] =
    useState({
      activeItemId: null,
      items: [],
    });

  const [policy, setPolicy] =
    useState(null);

  const [
    hardwareStatus,
    setHardwareStatus,
  ] = useState({
    hardware: null,
    summary: {},
    models: [],
  });

  // LUKE_AI_TEXT_MODEL_UPDATE_UI_V1
  const [updateStatus, setUpdateStatus] =
    useState({
      checkedAt: null,
      summary: {
        updatesAvailable: 0,
      },
      models: [],
    });

  const [selectedCategory, setSelectedCategory] =
    useState("all");

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [busyId, setBusyId] =
    useState("");

  const [error, setError] =
    useState("");

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
    async ({
      silent = false,
    } = {}) => {
      if (!silent) {
        setRefreshing(true);
      }

      try {
        const [
          catalogData,
          queueData,
          updateData,
          hardwareData,
        ] = await Promise.all([
          requestJson(
            "/api/text-models/catalog",
          ),
          requestJson(
            "/api/text-models/download-queue",
          ),
          requestJson(
            "/api/text-models/updates",
          ),
          requestJson(
            "/api/text-models/hardware",
          ),
        ]);

        if (!mountedRef.current) {
          return;
        }

        setCatalog(catalogData);
        setQueue(
          queueData.queue || {
            activeItemId: null,
            items: [],
          },
        );
        setPolicy(
          queueData.policy || null,
        );
        setUpdateStatus(
          updateData || {
            checkedAt: null,
            summary: {
              updatesAvailable: 0,
            },
            models: [],
          },
        );

        setHardwareStatus(
          hardwareData || {
            hardware: null,
            summary: {},
            models: [],
          },
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
          setRefreshing(false);
        }
      }
    },
    [requestJson],
  );

  useEffect(() => {
    mountedRef.current = true;
    refresh();

    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const hasActiveQueue = useMemo(
    () =>
      queue.items.some(
        (item) =>
          ACTIVE_STATES.has(item.state),
      ),
    [queue.items],
  );

  useEffect(() => {
    const interval =
      window.setInterval(
        () =>
          refresh({
            silent: true,
          }),
        hasActiveQueue
          ? 750
          : 5000,
      );

    return () => {
      window.clearInterval(interval);
    };
  }, [
    hasActiveQueue,
    refresh,
  ]);

  const visibleModels = useMemo(
    () => {
      const models =
        catalog?.models || [];

      if (
        selectedCategory === "all"
      ) {
        return models;
      }

      return models.filter(
        (model) =>
          model.category ===
          selectedCategory,
      );
    },
    [
      catalog,
      selectedCategory,
    ],
  );

  const activeQueueCount = useMemo(
    () =>
      queue.items.filter(
        (item) =>
          !TERMINAL_STATES.has(
            item.state,
          ),
      ).length,
    [queue.items],
  );

  const downloadModel = useCallback(
    async (
      model,
      variant,
    ) => {
      setBusyId(model.id);
      setError("");

      try {
        await requestJson(
          "/api/text-models/download-queue",
          {
            method: "POST",
            body: JSON.stringify({
              modelId: model.id,
              variantId: variant.id,
            }),
          },
        );

        await refresh({
          silent: true,
        });
      } catch (downloadError) {
        setError(
          downloadError instanceof Error
            ? downloadError.message
            : String(downloadError),
        );
      } finally {
        setBusyId("");
      }
    },
    [
      refresh,
      requestJson,
    ],
  );

  const updateModel = useCallback(
    async (model) => {
      setBusyId(model.id);
      setError("");

      try {
        // LUKE_AI_TEXT_MODEL_STATIC_UPDATE_UI_V1
        await requestJson(
          "/api/text-models/update",
          {
            method: "POST",
            body: JSON.stringify({
              modelId: model.id,
            }),
          },
        );

        await refresh({
          silent: true,
        });
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : String(updateError),
        );
      } finally {
        setBusyId("");
      }
    },
    [
      refresh,
      requestJson,
    ],
  );

  const queueAction = useCallback(
    async (
      item,
      action,
      body = {},
    ) => {
      setBusyId(item.id);
      setError("");

      try {
        await requestJson(
          `/api/text-models/download-queue/${encodeURIComponent(
            item.id,
          )}/${action}`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );

        await refresh({
          silent: true,
        });
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : String(actionError),
        );
      } finally {
        setBusyId("");
      }
    },
    [
      refresh,
      requestJson,
    ],
  );

  return (
    <section className="text-model-manager">
      <div className="text-model-manager-header">
        <div>
          <div className="text-model-eyebrow">
            Text Models
          </div>

          <h2>
            Text Model Manager
          </h2>

          <p>
            เลือกโมเดลได้สูงสุด
            {" "}
            {policy
              ?.maximumBatchSelection || 3}
            {" "}
            รายการต่อชุด
            และระบบจะดาวน์โหลดทีละ
            1 โมเดลตามคิว
          </p>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={refreshing}
          onClick={() => refresh()}
        >
          <RefreshCw
            size={15}
            className={
              refreshing
                ? "progress-spinner"
                : ""
            }
          />

          รีเฟรช
        </button>
      </div>

      <div className="text-model-summary-grid">
        <div className="m3-card text-model-summary-card">
          <span>โมเดลทั้งหมด</span>
          <strong>
            {catalog?.models?.length || 0}
          </strong>
        </div>

        <div className="m3-card text-model-summary-card">
          <span>อยู่ในคิว</span>
          <strong>
            {activeQueueCount}
          </strong>
        </div>

        <div className="m3-card text-model-summary-card">
          <span>ดาวน์โหลดพร้อมกัน</span>
          <strong>
            {policy
              ?.maximumConcurrentDownloads || 1}
          </strong>
        </div>

        <div className="m3-card text-model-summary-card">
          <span>มีอัปเดต</span>
          <strong>
            {updateStatus.summary
              ?.updatesAvailable || 0}
          </strong>
        </div>
      </div>

      {hardwareStatus.hardware && (
        <div className="text-model-hardware-summary">
          <div className="m3-card text-model-hardware-card">
            <span>สถาปัตยกรรม</span>
            <strong>
              {hardwareStatus.hardware.appleSilicon
                ? "Apple Silicon"
                : hardwareStatus.hardware.architecture}
            </strong>
          </div>

          <div className="m3-card text-model-hardware-card">
            <span>RAM ทั้งหมด</span>
            <strong>
              {formatBytes(
                hardwareStatus.hardware
                  .totalRamBytes,
              )}
            </strong>
          </div>

          <div className="m3-card text-model-hardware-card">
            <span>RAM ว่าง</span>
            <strong>
              {formatBytes(
                hardwareStatus.hardware
                  .availableRamBytes,
              )}
            </strong>
          </div>

          <div className="m3-card text-model-hardware-card">
            <span>พื้นที่ว่าง</span>
            <strong>
              {hardwareStatus.hardware
                .freeStorageBytes == null
                ? "ไม่ทราบ"
                : formatBytes(
                    hardwareStatus.hardware
                      .freeStorageBytes,
                  )}
            </strong>
          </div>
        </div>
      )}

      <div className="m3-card text-model-download-policy">
        <HardDrive size={20} />

        <div>
          <strong>
            Unified Download Queue
          </strong>

          <p>
            ดาวน์โหลดภายใน LUKE AI STUDIO,
            ตรวจ SHA256 ก่อนติดตั้ง
            และใช้ Preferred Storage
            พร้อม Local Fallback
          </p>
        </div>
      </div>

      <div className="text-model-category-tabs">
        {[
          {
            id: "all",
            label: "ทั้งหมด",
          },
          {
            id: "official",
            label: "Official Models",
          },
          {
            id: "community",
            label: "Community Models",
          },
        ].map((category) => (
          <button
            key={category.id}
            type="button"
            className={
              "text-model-category-tab " +
              (
                selectedCategory ===
                category.id
                  ? "text-model-category-tab-active"
                  : ""
              )
            }
            onClick={() =>
              setSelectedCategory(
                category.id,
              )
            }
          >
            {category.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-model-manager-error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="m3-card text-model-loading">
          <LoaderCircle
            className="progress-spinner"
            size={24}
          />

          กำลังโหลด Text Model Catalog...
        </div>
      ) : (
        <div className="text-model-grid">
          {visibleModels.map(
            (model) => (
              <ModelCard
                key={model.id}
                model={model}
                queueItems={queue.items}
                updateInfo={
                  updateStatus.models?.find(
                    (item) =>
                      item.modelId ===
                      model.id,
                  ) || null
                }
                hardwareInfo={
                  hardwareStatus.models?.find(
                    (item) =>
                      item.modelId ===
                      model.id,
                  ) || null
                }
                busyId={busyId}
                onDownload={downloadModel}
                onUpdate={updateModel}
                onAction={queueAction}
              />
            ),
          )}
        </div>
      )}

      {queue.items.length > 0 && (
        <section className="text-model-queue-panel">
          <div className="text-model-queue-heading">
            <div>
              <div className="text-model-eyebrow">
                Download Queue
              </div>

              <h3>
                คิวดาวน์โหลดโมเดล
              </h3>
            </div>

            <span className="status-chip text-model-status-active">
              Sequential
            </span>
          </div>

          <div className="text-model-queue-list">
            {queue.items.map(
              (item) => (
                <div
                  key={item.id}
                  className="m3-card text-model-queue-item"
                >
                  <div>
                    <strong>
                      {item.modelName}
                    </strong>

                    <div className="text-model-queue-detail">
                      {item.quantization}
                      {" · "}
                      {formatBytes(
                        item.sizeBytes,
                      )}
                    </div>
                  </div>

                  <span
                    className={`status-chip ${getStatusClass(
                      item.state,
                    )}`}
                  >
                    {STATE_LABELS[
                      item.state
                    ] || item.state}
                  </span>

                  {item.state ===
                    "completed" && (
                    <RotateCcw
                      size={16}
                      aria-label="Rollback available"
                    />
                  )}
                </div>
              ),
            )}
          </div>
        </section>
      )}
    </section>
  );
}
