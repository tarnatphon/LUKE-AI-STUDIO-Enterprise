import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_RECOVERY_SIMULATION_PANEL_V1
export default function StorageRecoverySimulationPanel({
  requestJson,
  setError,
}) {
  const [status, setStatus] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/recovery-simulation",
            );

          setStatus(
            data.simulation ||
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

  const run =
    useCallback(
      async (
        scenarioId,
      ) => {
        setBusy(
          scenarioId
        );

        try {
          await requestJson(
            "/api/storage/recovery-simulation/run",
            {
              method: "POST",
              body:
                JSON.stringify({
                  scenarioId,
                }),
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

  const runAll =
    useCallback(
      async () => {
        setBusy("all");

        try {
          await requestJson(
            "/api/storage/recovery-simulation/run-all",
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
          setBusy("");
        }
      },
      [
        refresh,
        requestJson,
        setError,
      ],
    );

  const scenarios =
    status?.scenarios ||
    [];

  const last =
    status
      ?.state
      ?.lastDrill ||
    null;

  return (
    <section className="storage-recovery-simulation-panel">
      <div className="storage-simulation-heading">
        <div>
          <strong>
            Storage Disaster Drill
          </strong>

          <span>
            Mock-only Recovery Simulation
          </span>
        </div>

        <strong>
          PRODUCTION STORAGE: UNTOUCHED
        </strong>
      </div>

      <button
        type="button"
        className="m3-btn m3-btn-filled"
        disabled={Boolean(busy)}
        onClick={runAll}
      >
        Run Full Disaster Drill
      </button>

      <div className="storage-simulation-grid">
        {scenarios.map(
          (scenario) => (
            <article
              key={scenario.id}
            >
              <strong>
                {scenario.label}
              </strong>

              <small>
                Expected:
                {" "}
                {
                  scenario
                    .expectedCodes
                    .join(", ")
                }
              </small>

              <button
                type="button"
                className="m3-btn m3-btn-outlined"
                disabled={Boolean(busy)}
                onClick={() =>
                  run(
                    scenario.id
                  )
                }
              >
                Run Simulation
              </button>
            </article>
          ),
        )}
      </div>

      {last && (
        <div className="storage-simulation-last">
          <strong>
            Last Drill:
            {" "}
            {last.label}
          </strong>

          <span>
            Result:
            {" "}
            {last.passed
              ? "PASSED"
              : "FAILED"}
          </span>

          <span>
            Recovery Score:
            {" "}
            {
              last
                .recoveryReadiness
                ?.score ??
              "N/A"
            }
          </span>

          <span>
            Detected:
            {" "}
            {
              last.actualCodes
                ?.join(", ") ||
              "None"
            }
          </span>
        </div>
      )}

      <div className="storage-simulation-safety">
        <strong>
          Simulation Safety
        </strong>

        <span>
          Mock managers: YES
        </span>

        <span>
          Real NAS access: NO
        </span>

        <span>
          Real Cloud access: NO
        </span>

        <span>
          Network access: NO
        </span>

        <span>
          Auto repair: OFF
        </span>

        <span>
          Auto delete: OFF
        </span>

        <span>
          Auto overwrite: OFF
        </span>
      </div>
    </section>
  );
}
