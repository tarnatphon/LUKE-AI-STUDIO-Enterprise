import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_WORKLOAD_DETECTION_PANEL_V2
export default function StorageWorkloadDetectionPanel({
  requestJson,
  setError,
}) {
  const [sourcePath, setSourcePath] =
    useState("");

  const [status, setStatus] =
    useState(null);

  const [result, setResult] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/workload",
            );

          setStatus(
            data.workload ||
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

  const detect =
    useCallback(
      async () => {
        if (!sourcePath.trim()) {
          setError?.(
            "กรุณาระบุ Source File"
          );
          return;
        }

        setBusy(true);

        try {
          const data =
            await requestJson(
              "/api/storage/workload/detect",
              {
                method: "POST",
                body: JSON.stringify({
                  sourcePath:
                    sourcePath.trim(),
                  manualOverride:
                    false,
                }),
              },
            );

          setResult(
            data.detection ||
            null,
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
        setError,
        sourcePath,
      ],
    );

  return (
    <section className="storage-workload-detection-panel">
      <div className="storage-workload-heading">
        <div>
          <strong>
            Automatic Workload Detection
          </strong>

          <span>
            File Type + Path + Size Routing
          </span>
        </div>
      </div>

      <div className="storage-workload-detection-form">
        <input
          type="text"
          placeholder="Source file path"
          value={sourcePath}
          onChange={(event) =>
            setSourcePath(
              event.target.value,
            )
          }
        />

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={busy}
          onClick={detect}
        >
          Detect Workload
        </button>
      </div>

      {result && (
        <div className="storage-workload-result">
          <strong>
            {result.workloadType}
          </strong>

          <span>
            Confidence:
            {" "}
            {Math.round(
              (
                result.confidence ||
                0
              ) * 100,
            )}
            %
          </span>

          <span>
            Reason:
            {" "}
            {result.reason}
          </span>

          <span>
            Manual:
            {" "}
            {result.manualOverride
              ? "YES"
              : "NO"}
          </span>
        </div>
      )}

      {status?.lastDetection && (
        <details className="storage-workload-history">
          <summary>
            Detection History
          </summary>

          <div>
            {(status.history || [])
              .slice()
              .reverse()
              .slice(0, 30)
              .map(
                (
                  detection,
                  index,
                ) => (
                  <article
                    key={`${detection.detectedAt}-${index}`}
                  >
                    <strong>
                      {
                        detection
                          .workloadType
                      }
                    </strong>

                    <small>
                      {
                        detection
                          .sourcePath
                      }
                    </small>

                    <small>
                      {
                        detection
                          .reason
                      }
                    </small>
                  </article>
                ),
              )}
          </div>
        </details>
      )}
    </section>
  );
}
