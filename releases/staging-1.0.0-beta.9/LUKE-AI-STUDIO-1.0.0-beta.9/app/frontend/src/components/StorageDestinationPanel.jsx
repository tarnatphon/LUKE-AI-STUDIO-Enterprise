import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_DESTINATION_DASHBOARD_V2
export default function StorageDestinationPanel({
  requestJson,
  setError,
}) {
  const [policy, setPolicy] =
    useState(null);

  const [storage, setStorage] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const [sourcePath, setSourcePath] =
    useState("");

  const [relativePath, setRelativePath] =
    useState("");

  const loadStorage =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/settings",
            );

          setPolicy(
            data.policy || null,
          );

          setStorage(
            data.storage || null,
          );
        } catch (error) {
          setError?.(
            error instanceof Error
              ? error.message
              : String(error),
          );
        }
      },
      [requestJson, setError],
    );

  useEffect(() => {
    loadStorage();

    const interval =
      window.setInterval(
        loadStorage,
        5000,
      );

    return () => {
      window.clearInterval(interval);
    };
  }, [loadStorage]);

  const saveSettings =
    useCallback(
      async () => {
        if (!policy) {
          return;
        }

        setBusy("save");

        try {
          const data =
            await requestJson(
              "/api/storage/settings",
              {
                method: "PUT",
                body: JSON.stringify({
                  policy,
                }),
              },
            );

          setPolicy(data.policy);
          setStorage(data.storage);
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
        policy,
        requestJson,
        setError,
      ],
    );

  const chooseFolder =
    useCallback(
      async (target) => {
        setBusy(`folder-${target}`);

        try {
          const currentPath =
            target === "local"
              ? policy?.localFallback
                  ?.path
              : policy
                  ?.customDestination
                  ?.path;

          const data =
            await requestJson(
              "/api/storage/choose-folder",
              {
                method: "POST",
                body: JSON.stringify({
                  defaultLocation:
                    currentPath || null,
                }),
              },
            );

          setPolicy(
            (current) => {
              if (!current) {
                return current;
              }

              if (target === "local") {
                return {
                  ...current,
                  localFallback: {
                    ...(current.localFallback ||
                      {}),
                    path:
                      data.selectedPath,
                  },
                };
              }

              return {
                ...current,
                selectionMode: "custom",
                customDestination: {
                  ...(current.customDestination ||
                    {}),
                  enabled: true,
                  path:
                    data.selectedPath,
                },
              };
            },
          );

          setError?.("");
        } catch (error) {
          if (
            error?.cancelled !== true
          ) {
            setError?.(
              error instanceof Error
                ? error.message
                : String(error),
            );
          }
        } finally {
          setBusy("");
        }
      },
      [
        policy,
        requestJson,
        setError,
      ],
    );

  const transferFile =
    useCallback(
      async () => {
        if (!sourcePath.trim()) {
          setError?.(
            "กรุณาระบุไฟล์ที่อยู่ใน Local fallback",
          );
          return;
        }

        setBusy("transfer");

        try {
          await requestJson(
            "/api/storage/transfer",
            {
              method: "POST",
              body: JSON.stringify({
                sourcePath:
                  sourcePath.trim(),
                relativePath:
                  relativePath.trim() ||
                  null,
              }),
            },
          );

          setSourcePath("");
          setRelativePath("");
          await loadStorage();
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
        loadStorage,
        relativePath,
        requestJson,
        setError,
        sourcePath,
      ],
    );

  const handleDeletion =
    useCallback(
      async (
        confirmationId,
        action,
      ) => {
        setBusy(
          `${action}-${confirmationId}`,
        );

        try {
          await requestJson(
            action === "confirm"
              ? "/api/storage/confirm-local-deletion"
              : "/api/storage/cancel-local-deletion",
            {
              method: "POST",
              body: JSON.stringify({
                confirmationId,
              }),
            },
          );

          await loadStorage();
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
        loadStorage,
        requestJson,
        setError,
      ],
    );

  if (!policy) {
    return (
      <section className="storage-destination-panel">
        กำลังโหลดการตั้งค่าพื้นที่จัดเก็บ...
      </section>
    );
  }

  const confirmations =
    storage
      ?.pendingDeletionConfirmations ||
    [];

  const history =
    storage?.transferHistory || [];

  return (
    <section className="storage-destination-panel">
      <div className="storage-destination-heading">
        <div>
          <strong>
            Storage Destination Manager
          </strong>

          <span>
            External Drive, Local fallback และยืนยันก่อนลบ
          </span>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={Boolean(busy)}
          onClick={loadStorage}
        >
          Refresh Storage
        </button>
      </div>

      <div className="storage-destination-status">
        <div>
          <span>Active Destination</span>

          <strong>
            {storage?.destination?.type ||
              storage
                ?.activeDestination
                ?.type ||
              "unknown"}
          </strong>

          <small>
            {storage?.destination?.path ||
              storage
                ?.activeDestination
                ?.path ||
              "—"}
          </small>
        </div>

        <div>
          <span>External Drive</span>

          <strong>
            {storage
              ?.externalDriveAvailable
              ? "Connected"
              : "Not Connected"}
          </strong>

          <small>
            {storage?.externalRoot ||
              "/Volumes/EXTERNAL Drive"}
          </small>
        </div>

        <div>
          <span>Local Fallback</span>

          <strong>
            {storage?.fallbackActive
              ? "Active"
              : "Standby"}
          </strong>

          <small>
            {storage?.localDestination ||
              policy.localFallback
                ?.path}
          </small>
        </div>
      </div>

      <div className="storage-destination-settings">
        <label>
          <span>Storage Mode</span>

          <select
            value={
              policy.selectionMode ||
              "automatic"
            }
            onChange={(event) =>
              setPolicy(
                (current) => ({
                  ...current,
                  selectionMode:
                    event.target.value,
                  customDestination: {
                    ...(current
                      .customDestination ||
                      {}),
                    enabled:
                      event.target.value ===
                      "custom",
                  },
                }),
              )
            }
          >
            <option value="automatic">
              Automatic
            </option>

            <option value="external">
              External Drive
            </option>

            <option value="local">
              Local Drive
            </option>

            <option value="custom">
              Custom Folder
            </option>
          </select>
        </label>

        <label>
          <span>
            External Volume Name
          </span>

          <input
            type="text"
            value={
              policy
                .preferredDestination
                ?.volumeName || ""
            }
            onChange={(event) =>
              setPolicy(
                (current) => ({
                  ...current,
                  preferredDestination: {
                    ...(current
                      .preferredDestination ||
                      {}),
                    volumeName:
                      event.target.value,
                  },
                }),
              )
            }
          />
        </label>

        <label>
          <span>
            External Relative Path
          </span>

          <input
            type="text"
            value={
              policy
                .preferredDestination
                ?.relativePath || ""
            }
            onChange={(event) =>
              setPolicy(
                (current) => ({
                  ...current,
                  preferredDestination: {
                    ...(current
                      .preferredDestination ||
                      {}),
                    relativePath:
                      event.target.value,
                  },
                }),
              )
            }
          />
        </label>

        <label className="storage-folder-field">
          <span>
            Local Fallback Folder
          </span>

          <div>
            <input
              type="text"
              value={
                policy.localFallback
                  ?.path || ""
              }
              onChange={(event) =>
                setPolicy(
                  (current) => ({
                    ...current,
                    localFallback: {
                      ...(current
                        .localFallback ||
                        {}),
                      path:
                        event.target.value,
                    },
                  }),
                )
              }
            />

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={Boolean(busy)}
              onClick={() =>
                chooseFolder("local")
              }
            >
              Choose Folder
            </button>
          </div>
        </label>

        <label className="storage-folder-field">
          <span>
            Custom Destination
          </span>

          <div>
            <input
              type="text"
              value={
                policy
                  .customDestination
                  ?.path || ""
              }
              disabled={
                policy.selectionMode !==
                "custom"
              }
              onChange={(event) =>
                setPolicy(
                  (current) => ({
                    ...current,
                    customDestination: {
                      ...(current
                        .customDestination ||
                        {}),
                      enabled: true,
                      path:
                        event.target.value,
                    },
                  }),
                )
              }
            />

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={Boolean(busy)}
              onClick={() =>
                chooseFolder("custom")
              }
            >
              Choose Folder
            </button>
          </div>
        </label>

        <label className="storage-setting-checkbox">
          <input
            type="checkbox"
            checked={
              policy.localFallback
                ?.enabled !== false
            }
            onChange={(event) =>
              setPolicy(
                (current) => ({
                  ...current,
                  localFallback: {
                    ...(current
                      .localFallback ||
                      {}),
                    enabled:
                      event.target.checked,
                  },
                }),
              )
            }
          />

          ใช้ Local fallback เมื่อ External Drive ไม่ได้เชื่อมต่อ
        </label>

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={saveSettings}
        >
          {busy === "save"
            ? "กำลังบันทึก..."
            : "Save Storage Settings"}
        </button>
      </div>

      <div className="storage-transfer-panel">
        <div>
          <strong>
            Transfer Local File
          </strong>

          <span>
            Copy และตรวจ SHA-256 ก่อนถามยืนยันการลบ Local copy
          </span>
        </div>

        <label>
          <span>
            Local Source File
          </span>

          <input
            type="text"
            value={sourcePath}
            onChange={(event) =>
              setSourcePath(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          <span>
            Relative Destination Path
          </span>

          <input
            type="text"
            value={relativePath}
            placeholder="Optional"
            onChange={(event) =>
              setRelativePath(
                event.target.value,
              )
            }
          />
        </label>

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={
            Boolean(busy) ||
            !storage
              ?.externalDriveAvailable
          }
          onClick={transferFile}
        >
          {busy === "transfer"
            ? "กำลังโอนและตรวจสอบ..."
            : "Transfer to External Drive"}
        </button>
      </div>

      {confirmations.length > 0 && (
        <div className="storage-deletion-confirmations">
          <strong>
            ยืนยันการลบ Local Copy
          </strong>

          <span>
            ไฟล์ปลายทางผ่านการตรวจขนาดและ SHA-256 แล้ว
          </span>

          {confirmations.map(
            (confirmation) => (
              <article
                key={
                  confirmation
                    .confirmationId
                }
              >
                <small>
                  Local:
                  {" "}
                  {confirmation.sourcePath}
                </small>

                <small>
                  External:
                  {" "}
                  {confirmation
                    .destinationPath}
                </small>

                <div className="storage-confirmation-actions">
                  <button
                    type="button"
                    className="m3-btn m3-btn-error"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      handleDeletion(
                        confirmation
                          .confirmationId,
                        "confirm",
                      )
                    }
                  >
                    ยืนยันลบ Local Copy
                  </button>

                  <button
                    type="button"
                    className="m3-btn m3-btn-outlined"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      handleDeletion(
                        confirmation
                          .confirmationId,
                        "cancel",
                      )
                    }
                  >
                    เก็บ Local Copy ไว้
                  </button>
                </div>
              </article>
            ),
          )}
        </div>
      )}

      {history.length > 0 && (
        <details className="storage-transfer-history">
          <summary>
            Transfer History
          </summary>

          <div>
            {history
              .slice()
              .reverse()
              .slice(0, 20)
              .map((record) => (
                <article key={record.id}>
                  <strong>
                    {record.relativePath ||
                      record.id}
                  </strong>

                  <small>
                    {record.destinationPath}
                  </small>

                  <small>
                    SHA-256:
                    {" "}
                    {record.verification
                      ?.sha256Verified
                      ? "Verified"
                      : "Not verified"}
                  </small>

                  <small>
                    Local:
                    {" "}
                    {record
                      .localCopyPreserved
                      ? "Preserved"
                      : "Deleted after confirmation"}
                  </small>
                </article>
              ))}
          </div>
        </details>
      )}
    </section>
  );
}
