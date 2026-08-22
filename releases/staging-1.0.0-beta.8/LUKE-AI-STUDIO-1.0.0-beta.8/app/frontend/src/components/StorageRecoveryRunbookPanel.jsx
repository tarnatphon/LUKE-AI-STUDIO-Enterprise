import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_RECOVERY_RUNBOOK_PANEL_V1
const safeHandlers = {
  "evaluate-storage-health":
    "/api/storage/health/evaluate",

  "scan-storage-availability":
    "/api/storage/watcher/scan",

  "start-storage-watcher":
    "/api/storage/watcher/start",

  "run-integrity-scan":
    "/api/storage/integrity/scan",
};

export default function StorageRecoveryRunbookPanel({
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
              "/api/storage/recovery-runbook",
            );

          setStatus(
            data.recoveryRunbook ||
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

  const executeSafeAction =
    useCallback(
      async (
        action,
      ) => {
        const endpoint =
          safeHandlers[
            action?.id
          ];

        if (!endpoint) {
          setError?.(
            "Action นี้ไม่ได้อยู่ใน Safe Action Allowlist"
          );

          return;
        }

        setBusy(
          action.id
        );

        try {
          await requestJson(
            endpoint,
            {
              method: "POST",
              body:
                JSON.stringify({}),
            },
          );

          await requestJson(
            "/api/storage/recovery-runbook/refresh",
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

  const runbook =
    status?.current ||
    null;

  const procedures =
    runbook?.procedures ||
    [];

  const counts =
    runbook?.counts ||
    {};

  return (
    <section className="storage-recovery-runbook-panel">
      <div className="storage-runbook-heading">
        <div>
          <strong>
            Storage Recovery Runbook
          </strong>

          <span>
            Guided Recovery Actions
          </span>
        </div>

        <strong>
          USER CONTROLLED
        </strong>
      </div>

      <div className="storage-runbook-summary">
        <article>
          <strong>
            {counts.safe || 0}
          </strong>
          <span>
            Safe actions
          </span>
        </article>

        <article>
          <strong>
            {
              counts
                .requiresConfirmation ||
              0
            }
          </strong>
          <span>
            Confirmation
          </span>
        </article>

        <article>
          <strong>
            {counts.manualOnly || 0}
          </strong>
          <span>
            Manual only
          </span>
        </article>

        <article>
          <strong>
            {
              runbook
                ?.recoveryReadiness
                ?.score ??
              0
            }
          </strong>
          <span>
            Recovery score
          </span>
        </article>
      </div>

      <div className="storage-runbook-procedures">
        {procedures.map(
          (procedure) => (
            <article
              key={procedure.id}
              className="storage-runbook-procedure"
            >
              <header>
                <div>
                  <strong>
                    {procedure.title}
                  </strong>

                  <small>
                    {procedure.code}
                  </small>
                </div>

                <span>
                  {procedure.severity}
                </span>
              </header>

              <p>
                {procedure.objective}
              </p>

              <div className="storage-runbook-steps">
                {procedure.steps.map(
                  (step) => (
                    <div
                      key={`${procedure.id}-${step.order}`}
                      className="storage-runbook-step"
                    >
                      <div>
                        <strong>
                          {step.order}.
                          {" "}
                          {step.title}
                        </strong>

                        <span>
                          {step.level}
                        </span>
                      </div>

                      {step.instruction && (
                        <small>
                          {step.instruction}
                        </small>
                      )}

                      {step.safeExecutable &&
                        step.action && (
                        <button
                          type="button"
                          className="m3-btn m3-btn-outlined"
                          disabled={
                            Boolean(
                              busy
                            )
                          }
                          onClick={() =>
                            executeSafeAction(
                              step.action,
                            )
                          }
                        >
                          Run Safe Action
                        </button>
                      )}

                      {step.level ===
                        "REQUIRES_CONFIRMATION" && (
                        <strong>
                          Explicit confirmation required — not executed by Runbook
                        </strong>
                      )}
                    </div>
                  ),
                )}
              </div>
            </article>
          ),
        )}
      </div>

      <div className="storage-runbook-safety">
        <strong>
          Guided Recovery Safety
        </strong>

        <span>
          Automatic execution: OFF
        </span>

        <span>
          Destructive actions: BLOCKED
        </span>

        <span>
          Cleanup confirmation: REQUIRED
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
