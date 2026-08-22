import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_INTEGRITY_PANEL_V2
export default function StorageIntegrityPanel({
  requestJson,
  setError,
}) {
  const [status, setStatus] =
    useState(null);

  const [
    intervalMinutes,
    setIntervalMinutes,
  ] = useState(360);

  const [busy, setBusy] =
    useState("");

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/integrity",
            );

          setStatus(
            data.integrity || null,
          );

          const minutes =
            data.integrity
              ?.state
              ?.scheduler
              ?.intervalMinutes;

          if (minutes) {
            setIntervalMinutes(
              minutes,
            );
          }
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

    const timer =
      window.setInterval(
        refresh,
        5000,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, [refresh]);

  const run =
    useCallback(
      async (
        endpoint,
        payload = {},
      ) => {
        setBusy(endpoint);

        try {
          await requestJson(
            endpoint,
            {
              method: "POST",
              body:
                JSON.stringify(
                  payload,
                ),
            },
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
          setBusy("");
        }
      },
      [
        refresh,
        requestJson,
        setError,
      ],
    );

  const scanner =
    status?.state || {};

  const scheduler =
    scanner.scheduler || {};

  const lastScan =
    scanner.lastScan || null;

  const summary =
    lastScan?.summary || {};

  return (
    <section className="storage-integrity-panel">
      <div className="storage-integrity-heading">
        <div>
          <strong>
            Storage Integrity Scanner
          </strong>

          <span>
            Size + SHA-256 Verification
          </span>
        </div>

        <strong>
          READ ONLY
        </strong>
      </div>

      <div className="storage-integrity-controls">
        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={() =>
            run(
              "/api/storage/integrity/scan",
            )
          }
        >
          Scan Now
        </button>

        <input
          type="number"
          min="1"
          value={intervalMinutes}
          onChange={(event) =>
            setIntervalMinutes(
              Math.max(
                1,
                Number(
                  event.target.value,
                ) || 1,
              ),
            )
          }
        />

        {!scheduler.running ? (
          <button
            type="button"
            className="m3-btn m3-btn-outlined"
            disabled={Boolean(busy)}
            onClick={() =>
              run(
                "/api/storage/integrity/scheduler/start",
                {
                  intervalMinutes,
                },
              )
            }
          >
            Start Scheduled Verification
          </button>
        ) : (
          <button
            type="button"
            className="m3-btn m3-btn-outlined"
            disabled={Boolean(busy)}
            onClick={() =>
              run(
                "/api/storage/integrity/scheduler/stop",
              )
            }
          >
            Stop Schedule
          </button>
        )}
      </div>

      <div className="storage-integrity-status">
        <span>
          Scheduler:
          {" "}
          {scheduler.running
            ? "RUNNING"
            : "STOPPED"}
        </span>

        <span>
          Interval:
          {" "}
          {scheduler.intervalMinutes ||
            intervalMinutes}
          {" min"}
        </span>

        <span>
          Next run:
          {" "}
          {scheduler.nextRunAt ||
            "Not scheduled"}
        </span>
      </div>

      {lastScan && (
        <>
          <div className="storage-integrity-summary">
            <article>
              <strong>
                {summary.healthy || 0}
              </strong>
              <span>Healthy</span>
            </article>

            <article>
              <strong>
                {summary.missing || 0}
              </strong>
              <span>Missing</span>
            </article>

            <article>
              <strong>
                {summary.sizeMismatch || 0}
              </strong>
              <span>Size mismatch</span>
            </article>

            <article>
              <strong>
                {summary.checksumMismatch || 0}
              </strong>
              <span>SHA mismatch</span>
            </article>

            <article>
              <strong>
                {
                  summary
                    .remoteVerificationRequired ||
                  0
                }
              </strong>
              <span>Remote verify</span>
            </article>
          </div>

          <div className="storage-integrity-results">
            {lastScan.results.map(
              (item) => (
                <article
                  key={`${item.recordType}-${item.recordId}`}
                >
                  <header>
                    <strong>
                      {item.status}
                    </strong>

                    <span>
                      {item.recordType}
                    </span>
                  </header>

                  <small>
                    {item.filePath ||
                      item.objectKey ||
                      item.recordId}
                  </small>

                  <small>
                    Size:
                    {" "}
                    {item.sizeMatches === null
                      ? "N/A"
                      : item.sizeMatches
                        ? "OK"
                        : "FAILED"}
                  </small>

                  <small>
                    SHA-256:
                    {" "}
                    {item.checksumMatches === null
                      ? "N/A"
                      : item.checksumMatches
                        ? "OK"
                        : "FAILED"}
                  </small>
                </article>
              ),
            )}
          </div>
        </>
      )}

      <div className="storage-integrity-safety">
        <strong>
          Scanner Safety
        </strong>

        <span>
          Automatic repair: OFF
        </span>

        <span>
          Automatic deletion: OFF
        </span>

        <span>
          Automatic overwrite: OFF
        </span>
      </div>
    </section>
  );
}
