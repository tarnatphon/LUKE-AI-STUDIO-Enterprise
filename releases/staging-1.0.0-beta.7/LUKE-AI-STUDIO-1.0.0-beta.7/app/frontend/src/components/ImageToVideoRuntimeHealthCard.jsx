export default function ImageToVideoRuntimeHealthCard({
  runtime,
  loading = false,
  error = "",
  onRefresh,
}) {
  const state =
    runtime?.state ||
    (loading
      ? "checking"
      : "unknown");

  const packages =
    runtime?.packages || {};

  const acceleration =
    runtime?.acceleration || {};

  const ffmpeg =
    runtime?.ffmpeg || {};

  const ready =
    runtime?.ready === true;

  return (
    <section
      className={`i2v-runtime-health i2v-runtime-health-${state}`}
      aria-live="polite"
    >
      <div className="i2v-runtime-health-heading">
        <div>
          <strong>
            Image-to-Video Runtime
          </strong>

          <span>
            {loading
              ? "Checking runtime…"
              : ready
                ? "Ready for generation"
                : "Runtime needs attention"}
          </span>
        </div>

        <strong>
          {state.toUpperCase()}
        </strong>
      </div>

      <div className="i2v-runtime-health-grid">
        <article>
          <span>
            Python
          </span>

          <strong>
            {runtime
              ?.probe
              ?.pythonVersion ||
              "N/A"}
          </strong>
        </article>

        <article>
          <span>
            Torch
          </span>

          <strong>
            {acceleration
              .torchAvailable
              ? acceleration
                  .torchVersion ||
                "READY"
              : "MISSING"}
          </strong>
        </article>

        <article>
          <span>
            Device
          </span>

          <strong>
            {acceleration
              .recommendedDevice
              ?.toUpperCase() ||
              "N/A"}
          </strong>
        </article>

        <article>
          <span>
            MPS
          </span>

          <strong>
            {acceleration
              .mpsAvailable
              ? acceleration
                  .mpsTest ===
                "passed"
                ? "READY"
                : "AVAILABLE"
              : "NO"}
          </strong>
        </article>

        <article>
          <span>
            FFmpeg
          </span>

          <strong>
            {ffmpeg.available
              ? ffmpeg.version ||
                "READY"
              : "MISSING"}
          </strong>
        </article>

        <article>
          <span>
            Packages
          </span>

          <strong>
            {packages.ready
              ? "READY"
              : `${packages.missing?.length || 0} MISSING`}
          </strong>
        </article>
      </div>

      {Array.isArray(
        packages.missing,
      ) &&
        packages.missing.length >
          0 && (
          <small>
            Missing:
            {" "}
            {packages.missing.join(
              ", ",
            )}
          </small>
        )}

      {error && (
        <small>
          Runtime check:
          {" "}
          {error}
        </small>
      )}

      <div className="i2v-runtime-health-actions">
        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          disabled={loading}
          onClick={onRefresh}
        >
          Refresh Runtime Health
        </button>
      </div>

      <div className="i2v-runtime-health-safety">
        <span>
          Automatic install: OFF
        </span>

        <span>
          Automatic repair: OFF
        </span>

        <span>
          Automatic model download: OFF
        </span>
      </div>
    </section>
  );
}
