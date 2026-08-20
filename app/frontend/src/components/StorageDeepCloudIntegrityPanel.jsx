import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_DEEP_CLOUD_INTEGRITY_PANEL_V1
export default function StorageDeepCloudIntegrityPanel({
  requestJson,
  setError,
}) {
  const [status, setStatus] =
    useState(null);

  const [archiveId, setArchiveId] =
    useState("");

  const [busy, setBusy] =
    useState("");

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/integrity/cloud",
            );

          setStatus(
            data.cloudIntegrity ||
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
        5000,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, [refresh]);

  const verify =
    useCallback(
      async () => {
        if (!archiveId.trim()) {
          setError?.(
            "กรุณาระบุ Verified Cloud Archive ID"
          );

          return;
        }

        setBusy("verify");

        try {
          await requestJson(
            "/api/storage/integrity/cloud/verify",
            {
              method: "POST",
              body: JSON.stringify({
                archiveId:
                  archiveId.trim(),
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
        archiveId,
        refresh,
        requestJson,
        setError,
      ],
    );

  const acknowledge =
    useCallback(
      async (
        alertId,
      ) => {
        setBusy(
          alertId
        );

        try {
          await requestJson(
            "/api/storage/integrity/cloud/alerts/acknowledge",
            {
              method: "POST",
              body:
                JSON.stringify({
                  alertId,
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

  const verifications =
    status?.verifications ||
    [];

  const alerts =
    status?.alerts || [];

  const summary =
    status?.alertSummary ||
    {};

  return (
    <section className="storage-deep-cloud-integrity-panel">
      <div className="storage-deep-cloud-heading">
        <div>
          <strong>
            Deep Cloud Integrity Verification
          </strong>

          <span>
            S3 Download → Size → SHA-256 → Temp Cleanup
          </span>
        </div>

        <strong>
          REMOTE READ ONLY
        </strong>
      </div>

      <div className="storage-deep-cloud-form">
        <input
          type="text"
          placeholder="Verified Cloud Archive ID"
          value={archiveId}
          onChange={(event) =>
            setArchiveId(
              event.target.value,
            )
          }
        />

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={verify}
        >
          Deep Verify Cloud Object
        </button>
      </div>

      <div className="storage-alert-summary">
        <article>
          <strong>
            {summary.open || 0}
          </strong>
          <span>Open alerts</span>
        </article>

        <article>
          <strong>
            {summary.critical || 0}
          </strong>
          <span>Critical</span>
        </article>

        <article>
          <strong>
            {summary.acknowledged || 0}
          </strong>
          <span>Acknowledged</span>
        </article>
      </div>

      <div className="storage-deep-cloud-results">
        <strong>
          Verification History
        </strong>

        {verifications
          .slice()
          .reverse()
          .slice(0, 100)
          .map(
            (item) => (
              <article
                key={item.id}
              >
                <header>
                  <strong>
                    {item.status}
                  </strong>

                  <span>
                    {item.providerId}
                  </span>
                </header>

                <small>
                  {item.objectKey}
                </small>

                <small>
                  Size:
                  {" "}
                  {item.actualBytes ??
                    "N/A"}
                </small>

                <small>
                  SHA-256:
                  {" "}
                  {item.actualSha256 ||
                    "N/A"}
                </small>

                <small>
                  Temporary copy removed:
                  {" "}
                  {item.temporaryCopyRemoved
                    ? "YES"
                    : "NO"}
                </small>
              </article>
            ),
          )}
      </div>

      <div className="storage-integrity-alert-center">
        <strong>
          Integrity Alert Center
        </strong>

        {alerts
          .slice()
          .reverse()
          .slice(0, 100)
          .map(
            (alert) => (
              <article
                key={alert.id}
              >
                <header>
                  <strong>
                    {alert.type}
                  </strong>

                  <span>
                    {alert.severity}
                  </span>
                </header>

                <small>
                  {alert.message}
                </small>

                <small>
                  {alert.objectKey}
                </small>

                <small>
                  Status:
                  {" "}
                  {alert.status}
                </small>

                {alert.status ===
                  "open" && (
                  <button
                    type="button"
                    className="m3-btn m3-btn-outlined"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      acknowledge(
                        alert.id,
                      )
                    }
                  >
                    Acknowledge
                  </button>
                )}
              </article>
            ),
          )}
      </div>

      <div className="storage-deep-cloud-safety">
        <strong>
          Safety
        </strong>

        <span>
          Remote object modification: OFF
        </span>

        <span>
          Automatic repair: OFF
        </span>

        <span>
          Automatic deletion: OFF
        </span>

        <span>
          Temporary verification copy: AUTO CLEANUP
        </span>
      </div>
    </section>
  );
}
