import {
  useCallback,
  useEffect,
  useState,
} from "react";

// LUKE_AI_STORAGE_POLICY_PROFILES_PANEL_V2
export default function StoragePolicyProfilesPanel({
  requestJson,
  setError,
}) {
  const [policies, setPolicies] =
    useState(null);

  const [workload, setWorkload] =
    useState("models");

  const [selection, setSelection] =
    useState(null);

  const [busy, setBusy] =
    useState("");

  const refresh =
    useCallback(
      async () => {
        try {
          const data =
            await requestJson(
              "/api/storage/policies",
            );

          setPolicies(
            data.policies || null,
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
  }, [refresh]);

  const testRouting =
    useCallback(
      async () => {
        setBusy("routing");

        try {
          const data =
            await requestJson(
              "/api/storage/policies/select",
              {
                method: "POST",
                body: JSON.stringify({
                  workloadType:
                    workload,
                  capability:
                    "write",
                }),
              },
            );

          setSelection(
            data.result || null,
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
        workload,
      ],
    );

  const profiles =
    policies?.config
      ?.profiles || {};

  return (
    <section className="storage-policy-profiles-panel">
      <div className="storage-policy-heading">
        <div>
          <strong>
            Storage Policy Profiles
          </strong>

          <span>
            Workload-Aware Routing
          </span>
        </div>

        <div>
          <select
            value={workload}
            onChange={(event) =>
              setWorkload(
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
            className="m3-btn m3-btn-outlined"
            disabled={Boolean(busy)}
            onClick={testRouting}
          >
            Test Routing
          </button>
        </div>
      </div>

      <div className="storage-policy-grid">
        {Object.entries(
          profiles,
        ).map(
          ([
            profileId,
            profile,
          ]) => (
            <article
              key={profileId}
            >
              <header>
                <strong>
                  {profile.label}
                </strong>

                <span>
                  {profileId}
                </span>
              </header>

              <small>
                Minimum Free:
                {" "}
                {Math.round(
                  (
                    profile
                      .minimumFreeBytes ||
                    0
                  ) /
                    1024 /
                    1024 /
                    1024,
                )}
                {" "}
                GB
              </small>

              <details>
                <summary>
                  Category Weights
                </summary>

                <div>
                  {Object.entries(
                    profile
                      .categoryWeights ||
                      {},
                  ).map(
                    ([key, value]) => (
                      <small
                        key={key}
                      >
                        {key}:
                        {" "}
                        {value}
                      </small>
                    ),
                  )}
                </div>
              </details>
            </article>
          ),
        )}
      </div>

      {selection && (
        <div className="storage-policy-selection">
          <strong>
            Selected Provider
          </strong>

          <span>
            Workload:
            {" "}
            {
              selection
                .profile.id
            }
          </span>

          <span>
            Provider:
            {" "}
            {
              selection
                .selected
                .provider
                .name
            }
          </span>

          <span>
            Final Score:
            {" "}
            {
              selection
                .selected
                .finalScore
            }
          </span>
        </div>
      )}
    </section>
  );
}
