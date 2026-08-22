import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

// LUKE_AI_STORAGE_HEALTH_SCORE_PANEL_V2
export default function StorageHealthScorePanel({
  requestJson,
  setError,
}) {
  const [health, setHealth] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/health",
            );

          setHealth(
            data.health || null,
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

  const evaluate =
    useCallback(
      async () => {
        setBusy("evaluate");

        try {
          await requestJson(
            "/api/storage/health/evaluate",
            {
              method: "POST",
              body: JSON.stringify({}),
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

  const providers =
    useMemo(
      () =>
        Object.values(
          health?.providers || {},
        ).sort(
          (left, right) =>
            (
              right.score || 0
            ) -
            (
              left.score || 0
            ),
        ),
      [health],
    );

  return (
    <section className="storage-health-score-panel">
      <div className="storage-health-heading">
        <div>
          <strong>
            Storage Health Score
          </strong>

          <span>
            Smart Provider Selection
          </span>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={Boolean(busy)}
          onClick={evaluate}
        >
          Evaluate Now
        </button>
      </div>

      <div className="storage-health-provider-grid">
        {providers.map(
          (provider) => (
            <article
              key={
                provider.providerId
              }
            >
              <header>
                <div>
                  <strong>
                    {provider.name ||
                      provider.providerId}
                  </strong>

                  <span>
                    {provider.category}
                    {" · "}
                    {provider.adapter}
                  </span>
                </div>

                <strong>
                  {provider.score}
                </strong>
              </header>

              <small>
                Status:
                {" "}
                {provider.health
                  ?.status}
              </small>

              <small>
                Writable:
                {" "}
                {provider.health
                  ?.writable
                  ? "YES"
                  : "NO"}
              </small>

              <small>
                Failures:
                {" "}
                {provider
                  .recentFailures ||
                  0}
              </small>

              <details>
                <summary>
                  Score Breakdown
                </summary>

                <div>
                  {Object.entries(
                    provider.breakdown ||
                      {},
                  ).map(
                    ([key, value]) => (
                      <small
                        key={key}
                      >
                        {key}:
                        {" "}
                        {value}
                      </small>
                    ),
                  )}
                </div>
              </details>
            </article>
          ),
        )}
      </div>
    </section>
  );
}
