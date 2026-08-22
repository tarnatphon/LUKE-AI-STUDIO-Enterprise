import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

// LUKE_AI_STORAGE_DISASTER_RECOVERY_PANEL_V1
export default function StorageDisasterRecoveryPanel({
  requestJson,
  setError,
}) {
  const [status, setStatus] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/disaster-recovery",
            );

          setStatus(
            data.disasterRecovery ||
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

    const timer =
      window.setInterval(
        refresh,
        10000,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, [refresh]);

  const manualRefresh =
    useCallback(
      async () => {
        setBusy(true);

        try {
          await requestJson(
            "/api/storage/disaster-recovery/refresh",
            {
              method: "POST",
              body:
                JSON.stringify({}),
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
          setBusy(false);
        }
      },
      [
        refresh,
        requestJson,
        setError,
      ],
    );

  const current =
    status?.current ||
    null;

  const score =
    current
      ?.recoveryReadiness
      ?.score ?? 0;

  const overallStatus =
    current
      ?.recoveryReadiness
      ?.status ||
    "unknown";

  const cards =
    useMemo(
      () => {
        if (!current) {
          return [];
        }

        return [
          {
            title:
              "Providers",
            value:
              current.providers
                ?.total ?? 0,
            detail:
              `${current.providers?.unhealthy ?? 0} unhealthy`,
          },

          {
            title:
              "Capacity",
            value:
              current.capacity
                ?.critical ?? 0,
            detail:
              `${current.capacity?.warning ?? 0} warnings`,
          },

          {
            title:
              "Archives",
            value:
              current.archive
                ?.verified ?? 0,
            detail:
              `${current.archive?.total ?? 0} total`,
          },

          {
            title:
              "Restores",
            value:
              current.restore
                ?.verified ?? 0,
            detail:
              `${current.restore?.failed ?? 0} failed`,
          },

          {
            title:
              "Integrity",
            value:
              current.integrity
                ?.healthy ?? 0,
            detail:
              `${current.integrity?.checksumMismatch ?? 0} SHA mismatch`,
          },

          {
            title:
              "Cloud Alerts",
            value:
              current.deepCloud
                ?.criticalAlerts ?? 0,
            detail:
              `${current.deepCloud?.openAlerts ?? 0} open`,
          },
        ];
      },
      [current],
    );

  const recommendations =
    current
      ?.recommendations ||
    [];

  const subsystemStatus =
    current
      ?.subsystemStatus ||
    {};

  return (
    <section className="storage-dr-panel">
      <div className="storage-dr-heading">
        <div>
          <strong>
            Storage Disaster Recovery
          </strong>

          <span>
            Overall Recovery Readiness
          </span>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={busy}
          onClick={manualRefresh}
        >
          Refresh Health
        </button>
      </div>

      <div className="storage-dr-score">
        <div>
          <strong>
            {score}
          </strong>

          <span>
            / 100
          </span>
        </div>

        <article>
          <strong>
            {overallStatus}
          </strong>

          <small>
            Recovery readiness
          </small>
        </article>

        <article>
          <strong>
            {
              current
                ?.subsystemErrors ??
              0
            }
          </strong>

          <small>
            Subsystem errors
          </small>
        </article>

        <article>
          <strong>
            {current
              ?.watcher
              ?.running
              ? "RUNNING"
              : "STOPPED"}
          </strong>

          <small>
            Availability watcher
          </small>
        </article>
      </div>

      <div className="storage-dr-grid">
        {cards.map(
          (card) => (
            <article
              key={card.title}
            >
              <span>
                {card.title}
              </span>

              <strong>
                {card.value}
              </strong>

              <small>
                {card.detail}
              </small>
            </article>
          ),
        )}
      </div>

      <div className="storage-dr-integrity">
        <strong>
          Integrity Status
        </strong>

        <span>
          Missing:
          {" "}
          {current
            ?.integrity
            ?.missing ?? 0}
        </span>

        <span>
          Size mismatch:
          {" "}
          {current
            ?.integrity
            ?.sizeMismatch ?? 0}
        </span>

        <span>
          SHA mismatch:
          {" "}
          {current
            ?.integrity
            ?.checksumMismatch ?? 0}
        </span>

        <span>
          Remote verification:
          {" "}
          {current
            ?.integrity
            ?.remoteVerificationRequired ??
            0}
        </span>
      </div>

      <div className="storage-dr-recommendations">
        <strong>
          Recovery Recommendations
        </strong>

        {recommendations.map(
          (
            recommendation,
            index,
          ) => (
            <article
              key={`${recommendation.code}-${index}`}
            >
              <header>
                <strong>
                  {
                    recommendation
                      .severity
                  }
                </strong>

                <span>
                  {
                    recommendation
                      .code
                  }
                </span>
              </header>

              <small>
                {
                  recommendation
                    .message
                }
              </small>
            </article>
          ),
        )}
      </div>

      <details className="storage-dr-subsystems">
        <summary>
          Recovery Subsystems
        </summary>

        <div>
          {Object.entries(
            subsystemStatus,
          ).map(
            ([
              name,
              subsystem,
            ]) => (
              <article
                key={name}
              >
                <strong>
                  {name}
                </strong>

                <span>
                  {subsystem.ok
                    ? "READY"
                    : "UNAVAILABLE"}
                </span>

                {subsystem.error && (
                  <small>
                    {subsystem.error}
                  </small>
                )}
              </article>
            ),
          )}
        </div>
      </details>

      <div className="storage-dr-safety">
        <strong>
          Disaster Recovery Safety
        </strong>

        <span>
          Dashboard: READ ONLY
        </span>

        <span>
          Auto Repair: OFF
        </span>

        <span>
          Auto Delete: OFF
        </span>

        <span>
          Auto Overwrite: OFF
        </span>

        <span>
          Remote Modification: OFF
        </span>
      </div>
    </section>
  );
}
