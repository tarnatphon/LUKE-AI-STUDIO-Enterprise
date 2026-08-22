import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_LIFECYCLE_PLANNER_PANEL_V2
function formatBytes(value) {
  const bytes =
    Number(value);

  if (!Number.isFinite(bytes)) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let number = bytes;
  let index = 0;

  while (
    number >= 1024 &&
    index < units.length - 1
  ) {
    number /= 1024;
    index += 1;
  }

  return `${number.toFixed(
    index === 0 ? 0 : 1
  )} ${units[index]}`;
}

export default function StorageLifecyclePlannerPanel({
  requestJson,
  setError,
}) {
  const [rootPath, setRootPath] =
    useState("");

  const [status, setStatus] =
    useState(null);

  const [plan, setPlan] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/lifecycle",
            );

          setStatus(
            data.lifecycle ||
            null,
          );
        } catch (error) {
          setError?.(
            error instanceof Error
              ? error.message
              : String(error),
          );
        }
      },
      [
        requestJson,
        setError,
      ],
    );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createPlan =
    useCallback(
      async () => {
        if (!rootPath.trim()) {
          setError?.(
            "กรุณาระบุ Storage Folder"
          );
          return;
        }

        setBusy(true);

        try {
          const data =
            await requestJson(
              "/api/storage/lifecycle/plan",
              {
                method: "POST",
                body: JSON.stringify({
                  rootPath:
                    rootPath.trim(),
                  maxFiles: 5000,
                }),
              },
            );

          setPlan(
            data.plan || null,
          );

          await refresh();
          setError?.("");
        } catch (error) {
          setError?.(
            error instanceof Error
              ? error.message
              : String(error),
          );
        } finally {
          setBusy(false);
        }
      },
      [
        refresh,
        requestJson,
        rootPath,
        setError,
      ],
    );

  const rules =
    status?.config?.rules ||
    {};

  return (
    <section className="storage-lifecycle-planner-panel">
      <div className="storage-lifecycle-heading">
        <div>
          <strong>
            Storage Lifecycle Planner
          </strong>

          <span>
            Safe Cleanup Planning
          </span>
        </div>

        <strong>
          AUTO DELETE: OFF
        </strong>
      </div>

      <div className="storage-lifecycle-form">
        <input
          type="text"
          placeholder="Storage folder to analyze"
          value={rootPath}
          onChange={(event) =>
            setRootPath(
              event.target.value,
            )
          }
        />

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={busy}
          onClick={createPlan}
        >
          Analyze Storage
        </button>
      </div>

      <div className="storage-lifecycle-rules">
        {Object.entries(
          rules,
        ).map(
          ([
            workload,
            rule,
          ]) => (
            <article
              key={workload}
            >
              <strong>
                {rule.label}
              </strong>

              <small>
                Review:
                {" "}
                {rule.reviewAfterDays}
                d
              </small>

              <small>
                Archive:
                {" "}
                {rule.archiveAfterDays}
                d
              </small>

              <small>
                Delete Candidate:
                {" "}
                {
                  rule
                    .deleteCandidateAfterDays
                }
                d
              </small>
            </article>
          ),
        )}
      </div>

      {plan && (
        <>
          <div className="storage-lifecycle-summary">
            <strong>
              Cleanup Plan
            </strong>

            <span>
              Files:
              {" "}
              {
                plan.summary
                  .totalFiles
              }
            </span>

            <span>
              Keep:
              {" "}
              {
                plan.summary
                  .keepFiles
              }
            </span>

            <span>
              Review:
              {" "}
              {
                plan.summary
                  .reviewFiles
              }
            </span>

            <span>
              Archive:
              {" "}
              {
                plan.summary
                  .archiveFiles
              }
            </span>

            <span>
              Delete Candidates:
              {" "}
              {
                plan.summary
                  .deleteCandidateFiles
              }
            </span>

            <span>
              Potential Recovery:
              {" "}
              {formatBytes(
                plan.summary
                  .potentialRecoveryBytes,
              )}
            </span>

            <strong>
              No files were deleted.
            </strong>
          </div>

          <details className="storage-lifecycle-files">
            <summary>
              Planned File Actions
            </summary>

            <div>
              {plan.files
                .slice(0, 200)
                .map(
                  (
                    file,
                    index,
                  ) => (
                    <article
                      key={`${file.relativePath}-${index}`}
                    >
                      <header>
                        <strong>
                          {file.action}
                        </strong>

                        <span>
                          {
                            file
                              .workloadType
                          }
                        </span>
                      </header>

                      <small>
                        {
                          file
                            .relativePath
                        }
                      </small>

                      <small>
                        {formatBytes(
                          file.sizeBytes,
                        )}
                        {" · "}
                        {file.ageDays}
                        {" days"}
                      </small>

                      <small>
                        Reason:
                        {" "}
                        {file.reason}
                      </small>
                    </article>
                  ),
                )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
