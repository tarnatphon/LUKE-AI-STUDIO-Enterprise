import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_PROVIDER_PANEL_V1
export default function StorageProviderPanel({
  requestJson,
  setError,
}) {
  const [storage, setStorage] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const [form, setForm] =
    useState({
      id: "",
      name: "",
      category: "nas",
      adapter:
        "mounted-folder",
      priority: 50,
      rootPath: "",
      username: "",
      password: "",
    });

  const loadProviders =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/providers",
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
    loadProviders();
  }, [loadProviders]);

  const chooseNasFolder =
    useCallback(
      async () => {
        setBusy("folder");

        try {
          const data =
            await requestJson(
              "/api/storage/choose-folder",
              {
                method: "POST",
                body: JSON.stringify({
                  defaultLocation:
                    form.rootPath ||
                    null,
                  prompt:
                    "Choose a mounted NAS folder",
                }),
              },
            );

          setForm(
            (current) => ({
              ...current,
              rootPath:
                data.selectedPath,
            }),
          );

          setError?.("");
        } catch (error) {
          if (
            error?.cancelled !==
            true
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
        form.rootPath,
        requestJson,
        setError,
      ],
    );

  const saveProvider =
    useCallback(
      async () => {
        if (
          !form.id.trim() ||
          !form.name.trim()
        ) {
          setError?.(
            "กรุณาระบุ Provider ID และชื่อ NAS",
          );
          return;
        }

        if (
          form.adapter ===
            "mounted-folder" &&
          !form.rootPath.trim()
        ) {
          setError?.(
            "กรุณาเลือก Mounted NAS Folder",
          );
          return;
        }

        setBusy("save");

        try {
          const providerData =
            await requestJson(
              "/api/storage/providers",
              {
                method: "POST",
                body: JSON.stringify({
                  provider: {
                    id:
                      form.id.trim(),
                    name:
                      form.name.trim(),
                    category:
                      form.category,
                    adapter:
                      form.adapter,
                    enabled: true,
                    priority:
                      Number(
                        form.priority,
                      ) || 50,
                    settings: {
                      rootPath:
                        form.rootPath.trim(),
                    },
                    credentialReference:
                      null,
                    capabilities: {
                      read: true,
                      write: true,
                      delete: false,
                      resume:
                        form.adapter !==
                        "mounted-folder",
                    },
                  },
                }),
              },
            );

          if (
            form.adapter !==
              "mounted-folder" &&
            (
              form.username ||
              form.password
            )
          ) {
            await requestJson(
              "/api/storage/credentials",
              {
                method: "POST",
                body: JSON.stringify({
                  providerId:
                    providerData
                      .provider.id,
                  credential: {
                    username:
                      form.username,
                    password:
                      form.password,
                  },
                }),
              },
            );
          }

          setForm({
            id: "",
            name: "",
            category: "nas",
            adapter:
              "mounted-folder",
            priority: 50,
            rootPath: "",
            username: "",
            password: "",
          });

          await loadProviders();
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
        form,
        loadProviders,
        requestJson,
        setError,
      ],
    );

  const checkProvider =
    useCallback(
      async (providerId) => {
        setBusy(
          `check-${providerId}`,
        );

        try {
          await requestJson(
            "/api/storage/providers/check",
            {
              method: "POST",
              body: JSON.stringify({
                providerId,
              }),
            },
          );

          await loadProviders();
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
        loadProviders,
        requestJson,
        setError,
      ],
    );

  const providers =
    storage?.providers || [];

  const health =
    storage?.state?.providers ||
    {};

  return (
    <section className="storage-provider-panel">
      <div className="storage-provider-heading">
        <div>
          <strong>
            NAS & Cloud Providers
          </strong>

          <span>
            Credential ถูกเก็บใน macOS Keychain
          </span>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={Boolean(busy)}
          onClick={loadProviders}
        >
          Refresh Providers
        </button>
      </div>

      <div className="storage-provider-form">
        <label>
          <span>Provider ID</span>

          <input
            type="text"
            value={form.id}
            placeholder="office-nas"
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  id:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label>
          <span>ชื่อ Provider</span>

          <input
            type="text"
            value={form.name}
            placeholder="Office NAS"
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  name:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label>
          <span>ประเภท NAS</span>

          <select
            value={form.adapter}
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  adapter:
                    event.target.value,
                }),
              )
            }
          >
            <option value="mounted-folder">
              Mounted NAS Folder
            </option>

            <option value="smb">
              SMB
            </option>

            <option value="nfs">
              NFS
            </option>

            <option value="webdav">
              WebDAV
            </option>
          </select>
        </label>

        <label>
          <span>Priority</span>

          <input
            type="number"
            value={form.priority}
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  priority:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label className="storage-provider-folder">
          <span>
            Mounted Folder / Root Path
          </span>

          <div>
            <input
              type="text"
              value={form.rootPath}
              onChange={(event) =>
                setForm(
                  (current) => ({
                    ...current,
                    rootPath:
                      event.target.value,
                  }),
                )
              }
            />

            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              disabled={Boolean(busy)}
              onClick={chooseNasFolder}
            >
              Choose NAS Folder
            </button>
          </div>
        </label>

        {[
          "smb",
          "webdav",
        ].includes(
          form.adapter,
        ) && (
          <>
            <label>
              <span>Username</span>

              <input
                type="text"
                value={form.username}
                autoComplete="off"
                onChange={(event) =>
                  setForm(
                    (current) => ({
                      ...current,
                      username:
                        event.target
                          .value,
                    }),
                  )
                }
              />
            </label>

            <label>
              <span>Password</span>

              <input
                type="password"
                value={form.password}
                autoComplete="new-password"
                onChange={(event) =>
                  setForm(
                    (current) => ({
                      ...current,
                      password:
                        event.target
                          .value,
                    }),
                  )
                }
              />
            </label>
          </>
        )}

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={saveProvider}
        >
          {busy === "save"
            ? "กำลังบันทึก..."
            : "Add Storage Provider"}
        </button>
      </div>

      <div className="storage-provider-list">
        {providers.map(
          (provider) => {
            const providerHealth =
              health[provider.id];

            return (
              <article
                key={provider.id}
              >
                <header>
                  <div>
                    <strong>
                      {provider.name}
                    </strong>

                    <span>
                      {provider.category}
                      {" · "}
                      {provider.adapter}
                    </span>
                  </div>

                  <span>
                    {providerHealth
                      ?.status ||
                      provider
                        .configurationStatus ||
                      "not-checked"}
                  </span>
                </header>

                <small>
                  Priority:
                  {" "}
                  {provider.priority}
                </small>

                <small>
                  Credential:
                  {" "}
                  {provider
                    .credentialReference
                    ? "Stored in Keychain"
                    : "Not configured"}
                </small>

                {providerHealth
                  ?.rootPath && (
                  <small>
                    Path:
                    {" "}
                    {
                      providerHealth
                        .rootPath
                    }
                  </small>
                )}

                {Number.isFinite(
                  providerHealth
                    ?.availableBytes,
                ) && (
                  <small>
                    Available:
                    {" "}
                    {Math.round(
                      providerHealth
                        .availableBytes /
                        1024 /
                        1024 /
                        1024,
                    )}
                    {" "}
                    GB
                  </small>
                )}

                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    checkProvider(
                      provider.id,
                    )
                  }
                >
                  Test Provider
                </button>
              </article>
            );
          },
        )}
      </div>
    </section>
  );
}
