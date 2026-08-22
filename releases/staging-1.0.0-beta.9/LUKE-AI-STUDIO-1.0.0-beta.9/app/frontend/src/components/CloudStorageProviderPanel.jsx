import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

// LUKE_AI_CLOUD_STORAGE_PROVIDER_DASHBOARD_V2
const PRESETS = {
  aws: {
    label: "Amazon S3",
    endpoint: "",
    region: "ap-southeast-1",
    forcePathStyle: false,
  },

  r2: {
    label: "Cloudflare R2",
    endpoint: "",
    region: "auto",
    forcePathStyle: false,
  },

  b2: {
    label: "Backblaze B2",
    endpoint: "",
    region: "us-west-004",
    forcePathStyle: false,
  },

  minio: {
    label: "MinIO",
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    forcePathStyle: true,
  },

  custom: {
    label: "Custom S3-Compatible",
    endpoint: "",
    region: "auto",
    forcePathStyle: false,
  },
};

export default function CloudStorageProviderPanel({
  requestJson,
  setError,
}) {
  const [providers, setProviders] =
    useState([]);

  const [s3State, setS3State] =
    useState({
      transfers: [],
      pendingDeleteConfirmations: [],
    });

  const [busy, setBusy] =
    useState("");

  const [form, setForm] =
    useState({
      preset: "aws",
      id: "",
      name: "",
      priority: 40,
      endpoint: "",
      region: "ap-southeast-1",
      bucket: "",
      forcePathStyle: false,
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
    });

  const [upload, setUpload] =
    useState({
      providerId: "",
      sourcePath: "",
      objectKey: "",
    });

  const [download, setDownload] =
    useState({
      providerId: "",
      objectKey: "",
      destinationPath: "",
    });

  const [remove, setRemove] =
    useState({
      providerId: "",
      objectKey: "",
    });

  const cloudProviders =
    useMemo(
      () =>
        providers.filter(
          (provider) =>
            provider.category === "cloud" &&
            provider.adapter ===
              "s3-compatible",
        ),
      [providers],
    );

  const refresh =
    useCallback(
      async () => {
        try {
          const [
            providerResult,
            stateResult,
          ] = await Promise.all([
            requestJson(
              "/api/storage/providers",
            ),
            requestJson(
              "/api/storage/s3/status",
            ),
          ]);

          setProviders(
            providerResult.storage
              ?.providers || [],
          );

          setS3State(
            stateResult.storage || {
              transfers: [],
              pendingDeleteConfirmations:
                [],
            },
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

    const interval =
      window.setInterval(
        refresh,
        5000,
      );

    return () =>
      window.clearInterval(
        interval,
      );
  }, [refresh]);

  const applyPreset =
    useCallback(
      (presetKey) => {
        const preset =
          PRESETS[presetKey] ||
          PRESETS.custom;

        setForm(
          (current) => ({
            ...current,
            preset:
              presetKey,
            name:
              current.name ||
              preset.label,
            endpoint:
              preset.endpoint,
            region:
              preset.region,
            forcePathStyle:
              preset.forcePathStyle,
          }),
        );
      },
      [],
    );

  const saveAccount =
    useCallback(
      async () => {
        if (
          !form.id.trim() ||
          !form.name.trim() ||
          !form.bucket.trim()
        ) {
          setError?.(
            "กรุณาระบุ Provider ID, ชื่อบัญชี และ Bucket",
          );
          return;
        }

        if (
          !form.accessKeyId.trim() ||
          !form.secretAccessKey
        ) {
          setError?.(
            "กรุณาระบุ Access Key ID และ Secret Access Key",
          );
          return;
        }

        setBusy("save");

        try {
          const providerResult =
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
                      "cloud",
                    adapter:
                      "s3-compatible",
                    enabled: true,
                    priority:
                      Number(
                        form.priority,
                      ) || 40,
                    settings: {
                      endpoint:
                        form.endpoint.trim() ||
                        null,
                      region:
                        form.region.trim() ||
                        "auto",
                      bucket:
                        form.bucket.trim(),
                      forcePathStyle:
                        Boolean(
                          form.forcePathStyle,
                        ),
                      providerPreset:
                        form.preset,
                      maxAttempts: 3,
                    },
                    credentialReference:
                      null,
                    capabilities: {
                      read: true,
                      write: true,
                      delete: false,
                      resume: true,
                    },
                  },
                }),
              },
            );

          await requestJson(
            "/api/storage/credentials",
            {
              method: "POST",
              body: JSON.stringify({
                providerId:
                  providerResult
                    .provider.id,
                credential: {
                  accessKeyId:
                    form.accessKeyId
                      .trim(),
                  secretAccessKey:
                    form.secretAccessKey,
                  ...(form.sessionToken
                    .trim()
                    ? {
                        sessionToken:
                          form.sessionToken
                            .trim(),
                      }
                    : {}),
                },
              }),
            },
          );

          setForm({
            preset: "aws",
            id: "",
            name: "",
            priority: 40,
            endpoint: "",
            region:
              "ap-southeast-1",
            bucket: "",
            forcePathStyle:
              false,
            accessKeyId: "",
            secretAccessKey: "",
            sessionToken: "",
          });

          await refresh();
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
        refresh,
        requestJson,
        setError,
      ],
    );

  const testConnection =
    useCallback(
      async (providerId) => {
        setBusy(
          `test-${providerId}`,
        );

        try {
          await requestJson(
            "/api/storage/s3/test",
            {
              method: "POST",
              body: JSON.stringify({
                providerId,
              }),
            },
          );

          await refresh();
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

  const runUpload =
    useCallback(
      async () => {
        if (
          !upload.providerId ||
          !upload.sourcePath.trim()
        ) {
          setError?.(
            "กรุณาเลือก Provider และ Source File",
          );
          return;
        }

        setBusy("upload");

        try {
          await requestJson(
            "/api/storage/s3/upload",
            {
              method: "POST",
              body: JSON.stringify({
                providerId:
                  upload.providerId,
                sourcePath:
                  upload.sourcePath
                    .trim(),
                objectKey:
                  upload.objectKey
                    .trim() ||
                  null,
              }),
            },
          );

          setUpload(
            (current) => ({
              ...current,
              sourcePath: "",
              objectKey: "",
            }),
          );

          await refresh();
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
        upload,
      ],
    );

  const runDownload =
    useCallback(
      async () => {
        if (
          !download.providerId ||
          !download.objectKey.trim() ||
          !download.destinationPath.trim()
        ) {
          setError?.(
            "กรุณาระบุ Provider, Object Key และ Destination Path",
          );
          return;
        }

        setBusy("download");

        try {
          await requestJson(
            "/api/storage/s3/download",
            {
              method: "POST",
              body: JSON.stringify({
                providerId:
                  download.providerId,
                objectKey:
                  download.objectKey
                    .trim(),
                destinationPath:
                  download
                    .destinationPath
                    .trim(),
              }),
            },
          );

          await refresh();
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
        download,
        refresh,
        requestJson,
        setError,
      ],
    );

  const requestDelete =
    useCallback(
      async () => {
        if (
          !remove.providerId ||
          !remove.objectKey.trim()
        ) {
          setError?.(
            "กรุณาเลือก Provider และ Object Key",
          );
          return;
        }

        setBusy("delete-request");

        try {
          await requestJson(
            "/api/storage/s3/delete-request",
            {
              method: "POST",
              body: JSON.stringify({
                providerId:
                  remove.providerId,
                objectKey:
                  remove.objectKey
                    .trim(),
              }),
            },
          );

          setRemove(
            (current) => ({
              ...current,
              objectKey: "",
            }),
          );

          await refresh();
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
        remove,
        requestJson,
        setError,
      ],
    );

  const resolveDelete =
    useCallback(
      async (
        confirmationId,
        confirm,
      ) => {
        setBusy(
          `${
            confirm
              ? "confirm"
              : "cancel"
          }-${confirmationId}`,
        );

        try {
          await requestJson(
            confirm
              ? "/api/storage/s3/delete-confirm"
              : "/api/storage/s3/delete-cancel",
            {
              method: "POST",
              body: JSON.stringify({
                confirmationId,
              }),
            },
          );

          await refresh();
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

  return (
    <section className="cloud-storage-provider-panel">
      <div className="cloud-storage-heading">
        <div>
          <strong>
            Cloud Storage
          </strong>

          <span>
            AWS S3 · Cloudflare R2 · Backblaze B2 · MinIO
          </span>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={Boolean(busy)}
          onClick={refresh}
        >
          Refresh Cloud
        </button>
      </div>

      <div className="cloud-provider-form">
        <label>
          <span>Provider</span>

          <select
            value={form.preset}
            onChange={(event) =>
              applyPreset(
                event.target.value,
              )
            }
          >
            <option value="aws">
              Amazon S3
            </option>

            <option value="r2">
              Cloudflare R2
            </option>

            <option value="b2">
              Backblaze B2
            </option>

            <option value="minio">
              MinIO
            </option>

            <option value="custom">
              Custom S3-Compatible
            </option>
          </select>
        </label>

        <label>
          <span>Provider ID</span>

          <input
            type="text"
            value={form.id}
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
          <span>Account Name</span>

          <input
            type="text"
            value={form.name}
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
          <span>Priority</span>

          <input
            type="number"
            min="1"
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

        <label>
          <span>Bucket</span>

          <input
            type="text"
            value={form.bucket}
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  bucket:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label>
          <span>Region</span>

          <input
            type="text"
            value={form.region}
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  region:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label className="cloud-provider-wide">
          <span>Endpoint</span>

          <input
            type="text"
            value={form.endpoint}
            placeholder={
              form.preset === "aws"
                ? "เว้นว่างสำหรับ AWS S3"
                : "https://..."
            }
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  endpoint:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label>
          <span>Access Key ID</span>

          <input
            type="text"
            autoComplete="off"
            value={form.accessKeyId}
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  accessKeyId:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label>
          <span>
            Secret Access Key
          </span>

          <input
            type="password"
            autoComplete="new-password"
            value={
              form.secretAccessKey
            }
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  secretAccessKey:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label className="cloud-provider-wide">
          <span>
            Session Token
          </span>

          <input
            type="password"
            autoComplete="new-password"
            placeholder="Optional"
            value={form.sessionToken}
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  sessionToken:
                    event.target.value,
                }),
              )
            }
          />
        </label>

        <label className="cloud-provider-checkbox">
          <input
            type="checkbox"
            checked={
              form.forcePathStyle
            }
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  forcePathStyle:
                    event.target.checked,
                }),
              )
            }
          />

          Force Path Style
        </label>

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={saveAccount}
        >
          {busy === "save"
            ? "กำลังบันทึก..."
            : "Add Cloud Account"}
        </button>
      </div>

      <div className="cloud-provider-list">
        {cloudProviders.map(
          (provider) => (
            <article key={provider.id}>
              <header>
                <div>
                  <strong>
                    {provider.name}
                  </strong>

                  <span>
                    {provider.settings
                      ?.providerPreset ||
                      "s3-compatible"}
                  </span>
                </div>

                <span>
                  Priority
                  {" "}
                  {provider.priority}
                </span>
              </header>

              <small>
                Bucket:
                {" "}
                {provider.settings
                  ?.bucket}
              </small>

              <small>
                Region:
                {" "}
                {provider.settings
                  ?.region ||
                  "auto"}
              </small>

              <small>
                Credentials:
                {" "}
                {provider
                  .credentialReference
                  ? "macOS Keychain"
                  : "Missing"}
              </small>

              {provider.settings
                ?.endpoint && (
                <small>
                  Endpoint:
                  {" "}
                  {
                    provider
                      .settings
                      .endpoint
                  }
                </small>
              )}

              <button
                type="button"
                className="m3-btn m3-btn-outlined"
                disabled={Boolean(busy)}
                onClick={() =>
                  testConnection(
                    provider.id,
                  )
                }
              >
                Test Connection
              </button>
            </article>
          ),
        )}
      </div>

      <div className="cloud-operation-grid">
        <div>
          <strong>
            Upload
          </strong>

          <select
            value={upload.providerId}
            onChange={(event) =>
              setUpload(
                (current) => ({
                  ...current,
                  providerId:
                    event.target.value,
                }),
              )
            }
          >
            <option value="">
              Select Provider
            </option>

            {cloudProviders.map(
              (provider) => (
                <option
                  key={provider.id}
                  value={provider.id}
                >
                  {provider.name}
                </option>
              ),
            )}
          </select>

          <input
            type="text"
            placeholder="Local source file"
            value={upload.sourcePath}
            onChange={(event) =>
              setUpload(
                (current) => ({
                  ...current,
                  sourcePath:
                    event.target.value,
                }),
              )
            }
          />

          <input
            type="text"
            placeholder="Object key (optional)"
            value={upload.objectKey}
            onChange={(event) =>
              setUpload(
                (current) => ({
                  ...current,
                  objectKey:
                    event.target.value,
                }),
              )
            }
          />

          <button
            type="button"
            className="m3-btn m3-btn-filled"
            disabled={Boolean(busy)}
            onClick={runUpload}
          >
            Upload & Verify
          </button>
        </div>

        <div>
          <strong>
            Download
          </strong>

          <select
            value={
              download.providerId
            }
            onChange={(event) =>
              setDownload(
                (current) => ({
                  ...current,
                  providerId:
                    event.target.value,
                }),
              )
            }
          >
            <option value="">
              Select Provider
            </option>

            {cloudProviders.map(
              (provider) => (
                <option
                  key={provider.id}
                  value={provider.id}
                >
                  {provider.name}
                </option>
              ),
            )}
          </select>

          <input
            type="text"
            placeholder="Cloud object key"
            value={download.objectKey}
            onChange={(event) =>
              setDownload(
                (current) => ({
                  ...current,
                  objectKey:
                    event.target.value,
                }),
              )
            }
          />

          <input
            type="text"
            placeholder="Destination path"
            value={
              download.destinationPath
            }
            onChange={(event) =>
              setDownload(
                (current) => ({
                  ...current,
                  destinationPath:
                    event.target.value,
                }),
              )
            }
          />

          <button
            type="button"
            className="m3-btn m3-btn-filled"
            disabled={Boolean(busy)}
            onClick={runDownload}
          >
            Download & Verify
          </button>
        </div>

        <div>
          <strong>
            Delete Cloud Object
          </strong>

          <span>
            ต้อง Request ก่อน และ Confirm อีกครั้ง
          </span>

          <select
            value={remove.providerId}
            onChange={(event) =>
              setRemove(
                (current) => ({
                  ...current,
                  providerId:
                    event.target.value,
                }),
              )
            }
          >
            <option value="">
              Select Provider
            </option>

            {cloudProviders.map(
              (provider) => (
                <option
                  key={provider.id}
                  value={provider.id}
                >
                  {provider.name}
                </option>
              ),
            )}
          </select>

          <input
            type="text"
            placeholder="Cloud object key"
            value={remove.objectKey}
            onChange={(event) =>
              setRemove(
                (current) => ({
                  ...current,
                  objectKey:
                    event.target.value,
                }),
              )
            }
          />

          <button
            type="button"
            className="m3-btn m3-btn-error"
            disabled={Boolean(busy)}
            onClick={requestDelete}
          >
            Request Delete
          </button>
        </div>
      </div>

      {s3State
        .pendingDeleteConfirmations
        ?.length > 0 && (
        <div className="cloud-delete-confirmations">
          <strong>
            Pending Cloud Deletion
          </strong>

          {s3State
            .pendingDeleteConfirmations
            .map(
              (confirmation) => (
                <article
                  key={
                    confirmation
                      .confirmationId
                  }
                >
                  <span>
                    {
                      confirmation
                        .providerId
                    }
                    {" / "}
                    {
                      confirmation
                        .bucket
                    }
                  </span>

                  <strong>
                    {
                      confirmation
                        .objectKey
                    }
                  </strong>

                  <div>
                    <button
                      type="button"
                      className="m3-btn m3-btn-error"
                      disabled={
                        Boolean(busy)
                      }
                      onClick={() =>
                        resolveDelete(
                          confirmation
                            .confirmationId,
                          true,
                        )
                      }
                    >
                      ยืนยันลบ Cloud Object
                    </button>

                    <button
                      type="button"
                      className="m3-btn m3-btn-outlined"
                      disabled={
                        Boolean(busy)
                      }
                      onClick={() =>
                        resolveDelete(
                          confirmation
                            .confirmationId,
                          false,
                        )
                      }
                    >
                      ยกเลิกการลบ
                    </button>
                  </div>
                </article>
              ),
            )}
        </div>
      )}

      {s3State.transfers
        ?.length > 0 && (
        <details className="cloud-transfer-history">
          <summary>
            Cloud Transfer History
          </summary>

          <div>
            {s3State.transfers
              .slice()
              .reverse()
              .slice(0, 30)
              .map(
                (transfer) => (
                  <article
                    key={transfer.id}
                  >
                    <header>
                      <strong>
                        {
                          transfer
                            .direction
                        }
                      </strong>

                      <span>
                        {
                          transfer
                            .status
                        }
                      </span>
                    </header>

                    <small>
                      Provider:
                      {" "}
                      {
                        transfer
                          .providerId
                      }
                    </small>

                    <small>
                      Object:
                      {" "}
                      {
                        transfer
                          .objectKey
                      }
                    </small>

                    {Number.isFinite(
                      transfer.progress,
                    ) && (
                      <progress
                        max="100"
                        value={
                          transfer
                            .progress
                        }
                      />
                    )}

                    {transfer
                      .sha256Verified !==
                      undefined && (
                      <small>
                        SHA-256:
                        {" "}
                        {transfer
                          .sha256Verified
                          ? "Verified"
                          : "Not verified"}
                      </small>
                    )}
                  </article>
                ),
              )}
          </div>
        </details>
      )}
    </section>
  );
}
