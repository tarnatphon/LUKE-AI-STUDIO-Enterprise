import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_UNIFIED_TRANSFER_QUEUE_PANEL_V1
export default function UnifiedTransferQueuePanel({
  requestJson,
  setError,
}) {
  const [queue, setQueue] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const [form, setForm] =
    useState({
      sourcePath: "",
      destinationProviderId: "",
      destinationPath: "",
      objectKey: "",
      priority: 100,
      workloadType: "models",
      workloadOverride: false,
    });

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/queue",
            );

          setQueue(
            data.queue || null,
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
        3000,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, [refresh]);

  const enqueue =
    useCallback(
      async () => {
        if (
          !form.sourcePath.trim()
        ) {
          setError?.(
            "กรุณาระบุ Source File",
          );
          return;
        }

        setBusy("enqueue");

        try {
          await requestJson(
            "/api/storage/queue/enqueue",
            {
              method: "POST",
              body: JSON.stringify({
                job: {
                  type:
                    form
                      .destinationProviderId
                      ? "copy"
                      : "copy",
                  sourcePath:
                    form.sourcePath
                      .trim(),
                  destinationProviderId:
                    form
                      .destinationProviderId ||
                    null,
                  destinationPath:
                    form
                      .destinationPath
                      .trim() ||
                    null,
                  objectKey:
                    form.objectKey
                      .trim() ||
                    null,
                  priority:
                    Number(
                      form.priority,
                    ) || 100,
                  workloadType:
                    form.workloadType,
                  workloadOverride:
                    form.workloadOverride,
                },
              }),
            },
          );

          setForm(
            (current) => ({
              ...current,
              sourcePath: "",
              destinationPath: "",
              objectKey: "",
            }),
          );

          await refresh();
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

  const action =
    useCallback(
      async (
        endpoint,
        payload = {},
      ) => {
        setBusy(endpoint);

        try {
          await requestJson(
            endpoint,
            {
              method: "POST",
              body: JSON.stringify(
                payload,
              ),
            },
          );

          await refresh();
        } finally {
          setBusy("");
        }
      },
      [
        refresh,
        requestJson,
      ],
    );

  const jobs =
    queue?.jobs || [];

  return (
    <section className="unified-transfer-queue-panel">
      <div className="unified-transfer-heading">
        <div>
          <strong>
            Unified Transfer Queue
          </strong>

          <span>
            Local · External · NAS · Cloud
          </span>
        </div>

        <div>
          <button
            type="button"
            className="m3-btn m3-btn-outlined"
            disabled={Boolean(busy)}
            onClick={refresh}
          >
            Refresh
          </button>

          {queue?.paused ? (
            <button
              type="button"
              className="m3-btn m3-btn-filled"
              onClick={() =>
                action(
                  "/api/storage/queue/resume",
                )
              }
            >
              Resume Queue
            </button>
          ) : (
            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              onClick={() =>
                action(
                  "/api/storage/queue/pause",
                )
              }
            >
              Pause Queue
            </button>
          )}
        </div>
      </div>

      <div className="unified-transfer-form">
        <input
          type="text"
          placeholder="Source file"
          value={form.sourcePath}
          onChange={(event) =>
            setForm(
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
          placeholder="Provider ID (เว้นว่างเพื่อ Auto Priority)"
          value={
            form.destinationProviderId
          }
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                destinationProviderId:
                  event.target.value,
              }),
            )
          }
        />

        <input
          type="text"
          placeholder="Destination path"
          value={
            form.destinationPath
          }
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                destinationPath:
                  event.target.value,
              }),
            )
          }
        />

        <input
          type="text"
          placeholder="Cloud object key"
          value={form.objectKey}
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                objectKey:
                  event.target.value,
              }),
            )
          }
        />

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

        {/* LUKE_AI_QUEUE_WORKLOAD_OVERRIDE_UI_V2 */}
        <select
          value={form.workloadType}
          disabled={!form.workloadOverride}
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                workloadType:
                  event.target.value,
              }),
            )
          }
        >
          <option value="models">Models</option>
          <option value="images">Images</option>
          <option value="video">Video</option>
          <option value="backups">Backups</option>
          <option value="temporary">Temporary</option>
        </select>

        <label className="unified-transfer-workload-override">
          <input
            type="checkbox"
            checked={form.workloadOverride}
            onChange={(event) =>
              setForm(
                (current) => ({
                  ...current,
                  workloadOverride:
                    event.target.checked,
                }),
              )
            }
          />

          Manual Workload Override
        </label>

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={Boolean(busy)}
          onClick={enqueue}
        >
          Add to Transfer Queue
        </button>
      </div>

      <div className="unified-transfer-list">
        {jobs.map(
          (job) => (
            <article key={job.id}>
              <header>
                <strong>
                  {job.type}
                </strong>

                <span>
                  {job.status}
                </span>
              </header>

              <small>
                Source:
                {" "}
                {job.sourcePath}
              </small>

              <small>
                Provider:
                {" "}
                {job
                  .destinationProviderId ||
                  "Auto"}
              </small>

              <small>
                Workload:
                {" "}
                {job.workloadType ||
                  "Detecting"}
                {" "}
                {job.workloadDetection
                  ?.manualOverride
                  ? "(Manual)"
                  : "(Auto)"}
              </small>

              <small>
                Attempt:
                {" "}
                {job.attempts}
                /
                {job.maxAttempts}
              </small>

              <progress
                max="100"
                value={
                  job.progress || 0
                }
              />

              {job.nextRetryAt && (
                <small>
                  Retry:
                  {" "}
                  {job.nextRetryAt}
                </small>
              )}

              {job.error && (
                <small>
                  Error:
                  {" "}
                  {job.error}
                </small>
              )}

              <div>
                {[
                  "failed",
                  "cancelled",
                ].includes(
                  job.status,
                ) && (
                  <button
                    type="button"
                    className="m3-btn m3-btn-outlined"
                    onClick={() =>
                      action(
                        "/api/storage/queue/retry",
                        {
                          jobId:
                            job.id,
                        },
                      )
                    }
                  >
                    Retry
                  </button>
                )}

                {![
                  "completed",
                  "cancelled",
                ].includes(
                  job.status,
                ) && (
                  <button
                    type="button"
                    className="m3-btn m3-btn-error"
                    onClick={() =>
                      action(
                        "/api/storage/queue/cancel",
                        {
                          jobId:
                            job.id,
                        },
                      )
                    }
                  >
                    Cancel
                  </button>
                )}
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  );
}
