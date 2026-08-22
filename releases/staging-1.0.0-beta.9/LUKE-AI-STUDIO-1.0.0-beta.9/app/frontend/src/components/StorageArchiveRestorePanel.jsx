import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_ARCHIVE_RESTORE_PANEL_V2
export default function StorageArchiveRestorePanel({
  requestJson,
  setError,
}) {
  const [archiveId, setArchiveId] =
    useState("");

  const [destinationPath, setDestinationPath] =
    useState("");

  const [sourceArchivePath, setSourceArchivePath] =
    useState("");

  const [restoreAsNew, setRestoreAsNew] =
    useState(true);

  const [status, setStatus] =
    useState(null);

  const [activeRestore, setActiveRestore] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/restore",
            );

          setStatus(
            data.restore || null,
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

  const requestRestore =
    useCallback(
      async () => {
        if (
          !archiveId.trim() ||
          !destinationPath.trim()
        ) {
          setError?.(
            "กรุณาระบุ Archive ID และ Restore Destination"
          );
          return;
        }

        setBusy("request");

        try {
          const data =
            await requestJson(
              "/api/storage/restore/request",
              {
                method: "POST",
                body: JSON.stringify({
                  archiveId:
                    archiveId.trim(),
                  destinationPath:
                    destinationPath.trim(),
                  restoreAsNew,
                }),
              },
            );

          setActiveRestore(
            data.restore || null,
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
        destinationPath,
        refresh,
        requestJson,
        restoreAsNew,
        setError,
      ],
    );

  const executeRestore =
    useCallback(
      async () => {
        if (
          !activeRestore?.id ||
          !sourceArchivePath.trim()
        ) {
          setError?.(
            "กรุณาระบุ Mounted Archive Source Path"
          );
          return;
        }

        setBusy("restore");

        try {
          await requestJson(
            "/api/storage/restore/local",
            {
              method: "POST",
              body: JSON.stringify({
                restoreId:
                  activeRestore.id,
                sourceArchivePath:
                  sourceArchivePath.trim(),
              }),
            },
          );

          setActiveRestore(null);

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
        activeRestore,
        refresh,
        requestJson,
        setError,
        sourceArchivePath,
      ],
    );

  const restores =
    status?.restores || [];

  return (
    <section className="storage-archive-restore-panel">
      <div className="storage-archive-restore-heading">
        <div>
          <strong>
            Archive Restore Workflow
          </strong>

          <span>
            Restore → Size Verify → SHA-256 Verify
          </span>
        </div>

        <strong>
          AUTO OVERWRITE: OFF
        </strong>
      </div>

      <div className="storage-archive-restore-form">
        <input
          type="text"
          placeholder="Verified Archive ID"
          value={archiveId}
          onChange={(event) =>
            setArchiveId(
              event.target.value,
            )
          }
        />

        <input
          type="text"
          placeholder="Restore destination"
          value={destinationPath}
          onChange={(event) =>
            setDestinationPath(
              event.target.value,
            )
          }
        />

        <label>
          <input
            type="checkbox"
            checked={restoreAsNew}
            onChange={(event) =>
              setRestoreAsNew(
                event.target.checked,
              )
            }
          />

          Restore as new if file exists
        </label>

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={requestRestore}
        >
          Prepare Restore
        </button>
      </div>

      {activeRestore && (
        <div className="storage-archive-restore-execute">
          <strong>
            Restore prepared
          </strong>

          <span>
            Target:
            {" "}
            {activeRestore.destinationPath}
          </span>

          <input
            type="text"
            placeholder="Mounted archive source path"
            value={sourceArchivePath}
            onChange={(event) =>
              setSourceArchivePath(
                event.target.value,
              )
            }
          />

          <button
            type="button"
            className="m3-btn m3-btn-outlined"
            disabled={Boolean(busy)}
            onClick={executeRestore}
          >
            Restore + Verify
          </button>
        </div>
      )}

      <div className="storage-archive-restore-list">
        {restores
          .slice()
          .reverse()
          .map(
            (restore) => (
              <article
                key={restore.id}
              >
                <header>
                  <strong>
                    {restore.status}
                  </strong>

                  <span>
                    {restore.verified
                      ? "VERIFIED"
                      : "NOT VERIFIED"}
                  </span>
                </header>

                <small>
                  Archive:
                  {" "}
                  {restore.archiveId}
                </small>

                <small>
                  Destination:
                  {" "}
                  {restore.destinationPath}
                </small>

                <small>
                  SHA-256:
                  {" "}
                  {restore.restoredSha256 ||
                    restore.expectedSha256}
                </small>

                <small>
                  Automatic overwrite:
                  NO
                </small>
              </article>
            ),
          )}
      </div>
    </section>
  );
}
