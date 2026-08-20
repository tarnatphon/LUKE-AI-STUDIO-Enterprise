import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

// LUKE_AI_STORAGE_CAPACITY_PANEL_V1
function formatBytes(value) {
  const bytes =
    Number(value);

  if (!Number.isFinite(bytes)) {
    return "Unknown";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let number = bytes;
  let index = 0;

  while (
    number >= 1024 &&
    index <
      units.length - 1
  ) {
    number /= 1024;
    index += 1;
  }

  return `${number.toFixed(
    index === 0
      ? 0
      : 1,
  )} ${units[index]}`;
}

export default function StorageCapacityPanel({
  requestJson,
  setError,
}) {
  const [capacity, setCapacity] =
    useState(null);

  const [sourcePath, setSourcePath] =
    useState("");

  const [workloadType, setWorkloadType] =
    useState("models");

  const [forecast, setForecast] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/capacity",
            );

          setCapacity(
            data.capacity ||
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

  const runForecast =
    useCallback(
      async () => {
        if (!sourcePath.trim()) {
          setError?.(
            "กรุณาระบุ Source File"
          );
          return;
        }

        setBusy(true);

        try {
          const data =
            await requestJson(
              "/api/storage/capacity/forecast",
              {
                method: "POST",
                body: JSON.stringify({
                  sourcePath:
                    sourcePath.trim(),
                  workloadType,
                }),
              },
            );

          setForecast(
            data.forecast ||
            null,
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
        sourcePath,
        workloadType,
      ],
    );

  const providers =
    useMemo(
      () =>
        Object.values(
          capacity?.providers ||
          {},
        ),
      [capacity],
    );

  const cleanup =
    capacity
      ?.cleanupRecommendations ||
    [];

  return (
    <section className="storage-capacity-panel">
      <div className="storage-capacity-heading">
        <div>
          <strong>
            Storage Capacity Forecast
          </strong>

          <span>
            Safe Space Management
          </span>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          onClick={refresh}
        >
          Refresh
        </button>
      </div>

      <div className="storage-capacity-form">
        <input
          type="text"
          placeholder="Source file path"
          value={sourcePath}
          onChange={(event) =>
            setSourcePath(
              event.target.value,
            )
          }
        />

        <select
          value={workloadType}
          onChange={(event) =>
            setWorkloadType(
              event.target.value,
            )
          }
        >
          <option value="models">
            Models
          </option>

          <option value="images">
            Images
          </option>

          <option value="video">
            Video
          </option>

          <option value="backups">
            Backups
          </option>

          <option value="temporary">
            Temporary
          </option>
        </select>

        <button
          type="button"
          className="m3-btn m3-btn-filled"
          disabled={busy}
          onClick={runForecast}
        >
          Forecast Space
        </button>
      </div>

      {forecast && (
        <div className="storage-capacity-forecast">
          <strong>
            Required:
            {" "}
            {formatBytes(
              forecast.requiredBytes,
            )}
          </strong>

          <span>
            Healthy Providers:
            {" "}
            {
              forecast
                .sufficientProviders
            }
          </span>

          <span>
            Recommended:
            {" "}
            {
              forecast
                .recommendation
                ?.providerName ||
              "None"
            }
          </span>
        </div>
      )}

      <div className="storage-capacity-grid">
        {providers.map(
          (provider) => (
            <article
              key={
                provider.providerId
              }
            >
              <header>
                <strong>
                  {
                    provider
                      .providerName ||
                    provider.providerId
                  }
                </strong>

                <span>
                  {provider.level}
                </span>
              </header>

              <small>
                Available:
                {" "}
                {formatBytes(
                  provider
                    .effectiveAvailableBytes,
                )}
              </small>

              <small>
                Reserved:
                {" "}
                {formatBytes(
                  provider
                    .reservedBytes,
                )}
              </small>

              <small>
                Required:
                {" "}
                {formatBytes(
                  provider
                    .requiredBytes,
                )}
              </small>

              <small>
                Safety Reserve:
                {" "}
                {formatBytes(
                  provider
                    .reserveBytes,
                )}
              </small>

              <small>
                Safe:
                {" "}
                {provider.sufficient
                  ? "YES"
                  : "NO"}
              </small>
            </article>
          ),
        )}
      </div>

      {cleanup.length > 0 && (
        <div className="storage-capacity-cleanup">
          <strong>
            Space Recommendations
          </strong>

          {cleanup.map(
            (
              item,
              index,
            ) => (
              <article
                key={`${item.providerId}-${index}`}
              >
                <span>
                  {item.providerId}
                  {" · "}
                  {item.severity}
                </span>

                <small>
                  {item.action}
                </small>

                <small>
                  Automatic deletion:
                  {" "}
                  NO
                </small>
              </article>
            ),
          )}
        </div>
      )}
    </section>
  );
}
