import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_SAFE_ARCHIVE_PANEL_V2
export default function StorageSafeArchivePanel({
  requestJson,
  setError,
}) {
  const [sourcePath, setSourcePath] =
    useState("");

  const [providerId, setProviderId] =
    useState("");

  const [destinationPath, setDestinationPath] =
    useState("");

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
              "/api/storage/archive",
            );

          setStatus(
            data.archive || null,
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
        4000,
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
        payload,
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
        requestJson,
        refresh,
        setError,
      ],
    );

  const requestArchive =
    useCallback(
      async () => {
        if (!sourcePath.trim()) {
          setError?.(
            "กรุณาระบุ Source File"
          );
          return;
        }

        await action(
          "/api/storage/archive/request",
          {
            sourcePath:
              sourcePath.trim(),
            destinationProviderId:
              providerId.trim() ||
              null,
            destinationPath:
              destinationPath.trim() ||
              null,
          },
        );
      },
      [
        action,
        destinationPath,
        providerId,
        setError,
        sourcePath,
      ],
    );

  const archives =
    status?.archives || [];

  const cleanupRequests =
    status?.cleanupRequests ||
    [];

  return (
    <section className="storage-safe-archive-panel">
      <div className="storage-safe-archive-heading">
        <div>
          <strong>
            Safe Archive Workflow
          </strong>

          <span>
            Archive → Verify → Explicit Cleanup
          </span>
        </div>

        <strong>
          AUTO DELETE: OFF
        </strong>
      </div>

      <div className="storage-safe-archive-form">
        <input
          type="text"
          placeholder="Source file"
          value={sourcePath}
          onChange={(event) =>
            setSourcePath(
              event.target.value,
            )
          }
        />

        <input
          type="text"
          placeholder="Provider ID (blank = automatic)"
          value={providerId}
          onChange={(event) =>
            setProviderId(
              event.target.value,
            )
          }
        />

        <input
          type="text"
          placeholder="Destination path"
          value={destinationPath}
          onChange={(event) =>
            setDestinationPath(
              event.target.value,
            )
          }
        />

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={requestArchive}
        >
          Archive Safely
        </button>
      </div>

      <div className="storage-safe-archive-list">
        {archives
          .slice()
          .reverse()
          .map(
            (archive) => (
              <article
                key={archive.id}
              >
                <header>
                  <strong>
                    {archive.status}
                  </strong>

                  <span>
                    {archive.verified
                      ? "VERIFIED"
                      : "NOT VERIFIED"}
                  </span>
                </header>

                <small>
                  {archive.sourcePath}
                </small>

                <small>
                  SHA-256:
                  {" "}
                  {archive.sourceSha256}
                </small>

                <small>
                  Source preserved:
                  {" "}
                  {archive.sourcePreserved
                    ? "YES"
                    : "NO"}
                </small>

                <div>
                  <button
                    type="button"
                    className="m3-btn m3-btn-outlined"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      action(
                        "/api/storage/archive/sync",
                        {
                          archiveId:
                            archive.id,
                        },
                      )
                    }
                  >
                    Sync Status
                  </button>

                  {archive.cleanupEligible && (
                    <button
                      type="button"
                      className="m3-btn m3-btn-outlined"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        action(
                          "/api/storage/archive/cleanup/request",
                          {
                            archiveId:
                              archive.id,
                          },
                        )
                      }
                    >
                      Request Source Cleanup
                    </button>
                  )}
                </div>
              </article>
            ),
          )}
      </div>

      {cleanupRequests.length > 0 && (
        <div className="storage-safe-cleanup-requests">
          <strong>
            Explicit Cleanup Requests
          </strong>

          {cleanupRequests
            .slice()
            .reverse()
            .map(
              (request) => (
                <article
                  key={request.id}
                >
                  <header>
                    <strong>
                      {request.status}
                    </strong>

                    <span>
                      CONFIRMATION REQUIRED
                    </span>
                  </header>

                  <small>
                    {request.sourcePath}
                  </small>

                  {request.status ===
                    "pending" && (
                    <div>
                      <button
                        type="button"
                        className="m3-btn m3-btn-outlined"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          action(
                            "/api/storage/archive/cleanup/cancel",
                            {
                              requestId:
                                request.id,
                            },
                          )
                        }
                      >
                        Cancel Cleanup
                      </button>

                      <button
                        type="button"
                        className="m3-btn m3-btn-error"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          action(
                            "/api/storage/archive/cleanup/confirm",
                            {
                              requestId:
                                request.id,
                            },
                          )
                        }
                      >
                        Confirm Delete Source
                      </button>
                    </div>
                  )}
                </article>
              ),
            )}
        </div>
      )}
    </section>
  );
}
