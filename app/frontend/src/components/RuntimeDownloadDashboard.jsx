import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Download,
  HardDrive,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  Database,
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
  "preparing",
  "downloading",
  "verifying",
  "installing",
  "rolling-back",
]);

const TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "rolled-back",
]);

const STATE_LABELS = {
  queued: "รอเริ่มติดตั้ง",
  preparing: "กำลังเตรียมระบบ",
  downloading: "กำลังดาวน์โหลด",
  verifying: "กำลังตรวจสอบ SHA256",
  installing: "กำลังติดตั้ง",
  "rolling-back": "กำลังกู้คืนระบบเดิม",
  completed: "ติดตั้งสำเร็จ",
  failed: "ติดตั้งไม่สำเร็จ",
  cancelled: "ยกเลิกแล้ว",
  "rolled-back": "กู้คืนระบบเดิมแล้ว",
  ready: "พร้อมใช้งาน",
  missing: "ยังไม่ได้ติดตั้ง",
};

function formatBytes(value) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  const amount = bytes / (1024 ** index);

  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getJobForDependency(jobs, dependencyId) {
  return jobs.find(
    (job) =>
      job.dependencyId === dependencyId &&
      (
        ACTIVE_STATES.has(job.state) ||
        TERMINAL_STATES.has(job.state)
      ),
  );
}

function getStatusClass(state) {
  if (state === "completed" || state === "ready") {
    return "runtime-status-ready";
  }

  if (
    state === "failed" ||
    state === "rolled-back"
  ) {
    return "runtime-status-error";
  }

  if (state === "cancelled") {
    return "runtime-status-muted";
  }

  if (ACTIVE_STATES.has(state)) {
    return "runtime-status-active";
  }

  return "runtime-status-missing";
}

function RuntimeProgress({ job }) {
  if (!job) {
    return null;
  }

  const percent = Math.max(
    0,
    Math.min(100, Number(job.progress?.percent) || 0),
  );

  return (
    <div className="runtime-progress-section">
      <div className="runtime-progress-header">
        <span>{STATE_LABELS[job.state] || job.state}</span>
        <strong>{percent}%</strong>
      </div>

      <div
        className="progress-bar-container runtime-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent}
      >
        <div
          className="progress-bar-fill runtime-progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="runtime-progress-meta">
        <span>
          {formatBytes(job.progress?.downloadedBytes)}
          {job.progress?.totalBytes
            ? ` / ${formatBytes(job.progress.totalBytes)}`
            : ""}
        </span>

        <span>
          {formatBytes(job.progress?.speedBytesPerSecond)}/s
        </span>
      </div>
    </div>
  );
}

function RuntimeDependencyCard({
  dependency,
  job,
  busyDependencyId,
  onInstall,
  onCancel,
}) {
  const active = Boolean(job && ACTIVE_STATES.has(job.state));
  const completed = job?.state === "completed";
  const state = active || job
    ? job.state
    : dependency.installed
      ? "ready"
      : "missing";

  const isBusy = busyDependencyId === dependency.id;

  return (
    <article className="m3-card runtime-dependency-card">
      <div className="runtime-card-header">
        <div className="runtime-card-icon">
          {dependency.installed || completed
            ? <CheckCircle2 size={22} />
            : active
              ? <LoaderCircle className="progress-spinner" size={22} />
              : <Download size={22} />}
        </div>

        <div className="runtime-card-title-group">
          <h3 className="m3-card-title">
            {dependency.name?.th || dependency.name?.en || dependency.id}
          </h3>

          <div className="runtime-card-subtitle">
            {dependency.name?.en || dependency.id}
          </div>
        </div>

        <span className={`status-chip ${getStatusClass(state)}`}>
          {STATE_LABELS[state] || state}
        </span>
      </div>

      <div className="runtime-card-details">
        <span>
          {dependency.required ? "จำเป็นต่อระบบ" : "ติดตั้งเพิ่มเติมได้"}
        </span>

        <span>
          {dependency.category === "core-runtime"
            ? "Core Runtime"
            : "AI Runtime"}
        </span>
      </div>

      <RuntimeProgress job={job} />

      {job?.checksum?.expected && (
        <div className="runtime-checksum">
          <ShieldCheck size={15} />
          <span>
            SHA256:
            {" "}
            {job.checksum.verified
              ? "ตรวจสอบผ่าน"
              : job.state === "verifying"
                ? "กำลังตรวจสอบ"
                : "รอตรวจสอบ"}
          </span>
        </div>
      )}

      {job?.error?.message && (
        <div className="runtime-error-message">
          <CircleX size={16} />
          <span>{job.error.message}</span>
        </div>
      )}

      <div className="runtime-card-actions">
        {!dependency.installed && !active && (
          <button
            type="button"
            className="m3-btn m3-btn-filled"
            disabled={isBusy}
            onClick={() => onInstall(dependency)}
          >
            {isBusy
              ? <LoaderCircle className="progress-spinner" size={15} />
              : <Download size={15} />}
            ติดตั้ง
          </button>
        )}

        {active && (
          <button
            type="button"
            className="m3-btn m3-btn-error"
            disabled={isBusy}
            onClick={() => onCancel(job)}
          >
            <Square size={14} />
            ยกเลิก
          </button>
        )}

        {(dependency.installed || completed) && (
          <span className="runtime-installed-label">
            <PackageCheck size={16} />
            พร้อมใช้งาน
          </span>
        )}
      </div>
    </article>
  );
}

export default function RuntimeDownloadDashboard() {
  const [dependencies, setDependencies] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [downloadDirectory, setDownloadDirectory] = useState("");
  const [fallbackDirectory, setFallbackDirectory] = useState("");
  // LUKE_AI_RUNTIME_STORAGE_DASHBOARD_V1
  const [storageStatus, setStorageStatus] = useState(null);
  // LUKE_AI_RUNTIME_STORAGE_CLEANUP_DASHBOARD_V1
  const [storageUsage, setStorageUsage] = useState(null);
  const [cleanupCategoryId, setCleanupCategoryId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyDependencyId, setBusyDependencyId] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  const hasActiveJobs = useMemo(
    () => jobs.some((job) => ACTIVE_STATES.has(job.state)),
    [jobs],
  );

  const requestJson = useCallback(async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Backend returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        `Request failed with HTTP ${response.status}`,
      );
    }

    return data;
  }, []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setRefreshing(true);
    }

    try {
      const [
        dependencyData,
        jobData,
        storageData,
        storageUsageData,
      ] = await Promise.all([
        requestJson("/api/runtime/dependencies"),
        requestJson("/api/runtime/install/jobs"),
        requestJson("/api/runtime/storage"),
        requestJson("/api/runtime/storage/usage"),
      ]);

      if (!mountedRef.current) {
        return;
      }

      setDependencies(dependencyData.dependencies || []);
      setSummary(dependencyData.summary || null);
      setDownloadDirectory(
        dependencyData.defaultDownloadDirectory || "",
      );
      setFallbackDirectory(
        dependencyData.fallbackDownloadDirectory || "",
      );
      setJobs(jobData.jobs || []);
      setStorageStatus(storageData || null);
      setStorageUsage(storageUsageData || null);
      setError("");
    } catch (requestError) {
      if (mountedRef.current) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : String(requestError),
        );
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [requestJson]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();

    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(
      () => refresh({ silent: true }),
      hasActiveJobs ? 750 : 10000,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [hasActiveJobs, refresh]);

  const installDependency = useCallback(
    async (dependency) => {
      setBusyDependencyId(dependency.id);
      setError("");

      try {
        const createResult = await requestJson(
          "/api/runtime/install/jobs",
          {
            method: "POST",
            body: JSON.stringify({
              dependencyId: dependency.id,
            }),
          },
        );

        const jobId = createResult.job?.id;

        if (!jobId) {
          throw new Error("Backend did not create an install job.");
        }

        await requestJson(
          `/api/runtime/install/jobs/${encodeURIComponent(jobId)}/start`,
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        );

        await refresh({ silent: true });
      } catch (installError) {
        setError(
          installError instanceof Error
            ? installError.message
            : String(installError),
        );
      } finally {
        setBusyDependencyId("");
      }
    },
    [refresh, requestJson],
  );

  const cleanupStorageCategory = useCallback(
    async (category, dryRun) => {
      setCleanupCategoryId(category.id);
      setError("");

      try {
        const result = await requestJson(
          "/api/runtime/storage/cleanup",
          {
            method: "POST",
            body: JSON.stringify({
              categoryId: category.id,
              dryRun,
            }),
          },
        );

        if (
          dryRun &&
          result.cleanup?.deletedFiles > 0
        ) {
          const confirmed = window.confirm(
            `พบไฟล์ที่ลบได้ ${result.cleanup.deletedFiles} ไฟล์ ` +
            `รวม ${formatBytes(result.cleanup.deletedBytes)}\n\n` +
            "ยืนยันลบไฟล์เหล่านี้หรือไม่?",
          );

          if (!confirmed) {
            return;
          }

          await requestJson(
            "/api/runtime/storage/cleanup",
            {
              method: "POST",
              body: JSON.stringify({
                categoryId: category.id,
                dryRun: false,
              }),
            },
          );
        }

        await refresh({ silent: true });
      } catch (cleanupError) {
        setError(
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
        );
      } finally {
        setCleanupCategoryId("");
      }
    },
    [refresh, requestJson],
  );

  const cancelJob = useCallback(
    async (job) => {
      setBusyDependencyId(job.dependencyId);
      setError("");

      try {
        await requestJson(
          `/api/runtime/install/jobs/${encodeURIComponent(job.id)}/cancel`,
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        );

        await refresh({ silent: true });
      } catch (cancelError) {
        setError(
          cancelError instanceof Error
            ? cancelError.message
            : String(cancelError),
        );
      } finally {
        setBusyDependencyId("");
      }
    },
    [refresh, requestJson],
  );

  return (
    <section className="runtime-dashboard">
      <div className="runtime-dashboard-header">
        <div>
          <div className="runtime-dashboard-eyebrow">
            System Health
          </div>

          <h2>Runtime & Download Manager</h2>

          <p>
            ตรวจสอบ ติดตั้ง และติดตามความคืบหน้าของระบบ AI
            โดยไฟล์ดาวน์โหลดจะถูกตรวจ SHA256 ก่อนติดตั้งทุกครั้ง
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
            className={refreshing ? "progress-spinner" : ""}
          />
          รีเฟรช
        </button>
      </div>

      <div className="runtime-summary-grid">
        <div className="m3-card runtime-summary-card">
          <span>Runtime ทั้งหมด</span>
          <strong>{summary?.total ?? dependencies.length}</strong>
        </div>

        <div className="m3-card runtime-summary-card runtime-summary-ready">
          <span>พร้อมใช้งาน</span>
          <strong>{summary?.ready ?? 0}</strong>
        </div>

        <div className="m3-card runtime-summary-card runtime-summary-missing">
          <span>ยังไม่ได้ติดตั้ง</span>
          <strong>{summary?.missing ?? 0}</strong>
        </div>

        <div className="m3-card runtime-summary-card runtime-summary-required">
          <span>Runtime จำเป็นที่ขาด</span>
          <strong>{summary?.requiredMissing ?? 0}</strong>
        </div>
      </div>

      <div
        className={
          "m3-card runtime-storage-panel " +
          (
            storageStatus?.usingFallback
              ? "runtime-storage-fallback-active"
              : storageStatus?.ok
                ? "runtime-storage-external-ready"
                : "runtime-storage-unavailable"
          )
        }
      >
        <div className="runtime-storage-icon">
          <HardDrive size={22} />
        </div>

        <div className="runtime-storage-content">
          <div className="runtime-storage-heading">
            <strong>
              {storageStatus?.usingFallback
                ? "กำลังใช้โฟลเดอร์สำรอง"
                : "ตำแหน่งดาวน์โหลดหลัก"}
            </strong>

            <span
              className={
                "status-chip " +
                (
                  storageStatus?.usingFallback
                    ? "runtime-status-missing"
                    : storageStatus?.ok
                      ? "runtime-status-ready"
                      : "runtime-status-error"
                )
              }
            >
              {storageStatus?.usingFallback
                ? "External Drive ไม่พร้อม"
                : storageStatus?.ok
                  ? "External Drive พร้อม"
                  : "Storage ไม่พร้อม"}
            </span>
          </div>

          <div className="runtime-storage-path">
            {storageStatus?.selectedDirectory ||
              downloadDirectory ||
              "กำลังตรวจสอบ..."}
          </div>

          {storageStatus?.usingFallback && (
            <div className="runtime-storage-warning">
              <AlertTriangle size={15} />
              <span>
                ระบบเลือก Safe Fallback อัตโนมัติ
                เพราะไม่พบหรือไม่สามารถเขียนลง External Drive ได้
              </span>
            </div>
          )}

          {storageStatus?.external?.freeBytes != null && (
            <div className="runtime-storage-free-space">
              พื้นที่ว่าง External Drive:
              {" "}
              {formatBytes(storageStatus.external.freeBytes)}
            </div>
          )}

          {fallbackDirectory && (
            <div className="runtime-storage-fallback">
              โฟลเดอร์สำรอง: {fallbackDirectory}
            </div>
          )}
        </div>
      </div>

      {storageUsage && (
        <div className="runtime-cleanup-section">
          <div className="runtime-cleanup-heading">
            <div>
              <div className="runtime-dashboard-eyebrow">
                Storage Manager
              </div>
              <h3>พื้นที่จัดเก็บและการทำความสะอาด</h3>
              <p>
                ระบบจะทำ Dry Run ก่อนลบจริง และจะไม่ลบไฟล์ที่กำลัง
                ดาวน์โหลด ติดตั้ง ตรวจสอบ หรือ Rollback
              </p>
            </div>

            <div className="runtime-cleanup-total">
              <Database size={18} />
              <span>
                ใช้พื้นที่ทั้งหมด
                {" "}
                <strong>
                  {formatBytes(storageUsage.summary?.totalBytes)}
                </strong>
              </span>
            </div>
          </div>

          <div className="runtime-cleanup-grid">
            {(storageUsage.categories || []).map((category) => (
              <article
                key={category.id}
                className="m3-card runtime-cleanup-card"
              >
                <div className="runtime-cleanup-card-header">
                  <div>
                    <strong>{category.label}</strong>
                    <div className="runtime-cleanup-path">
                      {category.path || "ไม่พบตำแหน่งจัดเก็บ"}
                    </div>
                  </div>

                  <span
                    className={
                      "status-chip " +
                      (
                        category.protected
                          ? "runtime-status-active"
                          : category.cleanupAllowed
                            ? "runtime-status-ready"
                            : "runtime-status-muted"
                      )
                    }
                  >
                    {category.protected
                      ? "กำลังใช้งาน"
                      : category.cleanupAllowed
                        ? "ล้างได้"
                        : "ป้องกัน"}
                  </span>
                </div>

                <div className="runtime-cleanup-stat">
                  <strong>{formatBytes(category.sizeBytes)}</strong>
                  <span>
                    {category.fileCount} ไฟล์ ·
                    {" "}
                    {category.directoryCount} โฟลเดอร์
                  </span>
                </div>

                {category.symlinkCount > 0 && (
                  <div className="runtime-cleanup-warning">
                    <AlertTriangle size={14} />
                    ข้าม Symbolic Link {category.symlinkCount} รายการ
                  </div>
                )}

                <div className="runtime-card-actions">
                  {category.cleanupAllowed && (
                    <button
                      type="button"
                      className="m3-btn m3-btn-outlined"
                      disabled={
                        category.protected ||
                        cleanupCategoryId === category.id ||
                        category.sizeBytes <= 0
                      }
                      onClick={() =>
                        cleanupStorageCategory(category, true)
                      }
                    >
                      {cleanupCategoryId === category.id
                        ? (
                          <LoaderCircle
                            className="progress-spinner"
                            size={15}
                          />
                        )
                        : <Trash2 size={15} />}
                      ทำความสะอาด
                    </button>
                  )}

                  {!category.cleanupAllowed && (
                    <span className="runtime-cleanup-protected">
                      <ShieldCheck size={15} />
                      ป้องกันการลบ
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="runtime-dashboard-error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="m3-card runtime-dashboard-loading">
          <LoaderCircle className="progress-spinner" size={24} />
          กำลังตรวจสอบ Runtime...
        </div>
      ) : (
        <div className="runtime-dependency-grid">
          {dependencies.map((dependency) => (
            <RuntimeDependencyCard
              key={dependency.id}
              dependency={dependency}
              job={getJobForDependency(jobs, dependency.id)}
              busyDependencyId={busyDependencyId}
              onInstall={installDependency}
              onCancel={cancelJob}
            />
          ))}
        </div>
      )}
    </section>
  );
}
