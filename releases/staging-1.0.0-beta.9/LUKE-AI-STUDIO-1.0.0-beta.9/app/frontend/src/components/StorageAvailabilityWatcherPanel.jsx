import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_AVAILABILITY_WATCHER_PANEL_V2
export default function StorageAvailabilityWatcherPanel({
  requestJson,
  setError,
}) {
  const [watcher, setWatcher] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/watcher",
            );

          setWatcher(
            data.watcher || null,
          );

          setError?.("");
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

  const action =
    useCallback(
      async (
        endpoint,
        payload = null,
      ) => {
        setBusy(endpoint);

        try {
          await requestJson(
            endpoint,
            {
              method: "POST",
              ...(payload
                ? {
                    body:
                      JSON.stringify(
                        payload,
                      ),
                  }
                : {}),
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

  const providers =
    watcher?.providers || {};

  const events =
    watcher?.events || [];

  return (
    <section className="storage-availability-watcher-panel">
      <div className="storage-watcher-heading">
        <div>
          <strong>
            Availability Watcher
          </strong>

          <span>
            External · NAS · Cloud Auto Resume
          </span>
        </div>

        <div>
          <button
            type="button"
            className="m3-btn m3-btn-outlined"
            disabled={Boolean(busy)}
            onClick={() =>
              action(
                "/api/storage/watcher/scan",
              )
            }
          >
            Scan Now
          </button>

          {watcher?.enabled ? (
            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={Boolean(busy)}
              onClick={() =>
                action(
                  "/api/storage/watcher/stop",
                )
              }
            >
              Stop Watcher
            </button>
          ) : (
            <button
              type="button"
              className="m3-btn m3-btn-filled"
              disabled={Boolean(busy)}
              onClick={() =>
                action(
                  "/api/storage/watcher/start",
                )
              }
            >
              Start Watcher
            </button>
          )}
        </div>
      </div>

      <div className="storage-watcher-status">
        <div>
          <span>Running</span>

          <strong>
            {watcher?.running
              ? "YES"
              : "NO"}
          </strong>
        </div>

        <div>
          <span>Interval</span>

          <strong>
            {Math.round(
              (
                watcher?.intervalMs ||
                10000
              ) / 1000,
            )}
            {" "}
            sec
          </strong>
        </div>

        <div>
          <span>Last Scan</span>

          <strong>
            {watcher?.lastScanAt ||
              "Never"}
          </strong>
        </div>
      </div>

      <div className="storage-watcher-providers">
        {Object.entries(
          providers,
        ).map(
          ([
            providerId,
            status,
          ]) => (
            <article
              key={providerId}
            >
              <strong>
                {providerId}
              </strong>

              <span>
                {status.status}
              </span>

              <small>
                Reachable:
                {" "}
                {status.reachable
                  ? "YES"
                  : "NO"}
              </small>

              <small>
                Writable:
                {" "}
                {status.writable
                  ? "YES"
                  : "NO"}
              </small>
            </article>
          ),
        )}
      </div>

      {events.length > 0 && (
        <details className="storage-watcher-events">
          <summary>
            Availability Events
          </summary>

          <div>
            {events
              .slice()
              .reverse()
              .slice(0, 30)
              .map(
                (
                  event,
                  index,
                ) => (
                  <article
                    key={`${event.createdAt}-${index}`}
                  >
                    <strong>
                      {event.type}
                    </strong>

                    <small>
                      Provider:
                      {" "}
                      {event.providerId ||
                        "-"}
                    </small>

                    {Number.isFinite(
                      event.changedJobs,
                    ) && (
                      <small>
                        Resumed Jobs:
                        {" "}
                        {
                          event.changedJobs
                        }
                      </small>
                    )}

                    <small>
                      {event.createdAt}
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
