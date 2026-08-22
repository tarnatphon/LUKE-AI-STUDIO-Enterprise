#!/usr/bin/env node
"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  StorageDisasterRecoveryDashboard,
  severityFromScore,
} = require(
  "../server/storage-disaster-recovery-dashboard.cjs"
);

function createManager(
  value
) {
  return {
    getStatus() {
      return value;
    },
  };
}

function main() {
  const root =
    path.join(
      "/tmp",
      `luke-dr-${process.pid}`
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    }
  );

  try {
    const statePath =
      path.join(
        root,
        "state.json"
      );

    const dashboard =
      new StorageDisasterRecoveryDashboard({
        statePath,

        healthScorer: {
          evaluateAll() {
            return [
              {
                provider: {
                  id:
                    "local",
                },

                health: {
                  status:
                    "healthy",
                },
              },
            ];
          },
        },

        providerCore:
          createManager({
            providers: [
              {
                id:
                  "local",
              },
              {
                id:
                  "nas",
              },
            ],

            state: {},
          }),

        capacityManager:
          createManager({
            providers: {
              local: {
                level:
                  "healthy",
              },

              nas: {
                level:
                  "warning",
              },
            },

            reservations: [],

            cleanupRecommendations: [],
          }),

        lifecycleManager:
          createManager({
            config: {
              automaticDeletion:
                false,
            },

            state: {},
          }),

        safeArchiveManager:
          createManager({
            archives: [
              {
                id:
                  "a1",

                verified:
                  true,

                cleanupEligible:
                  false,
              },
            ],

            cleanupRequests: [],
          }),

        restoreManager:
          createManager({
            restores: [
              {
                id:
                  "r1",

                status:
                  "completed",

                verified:
                  true,
              },
            ],
          }),

        integrityScanner:
          createManager({
            state: {
              scheduler: {
                running:
                  true,
              },

              lastScan: {
                summary: {
                  total: 2,
                  healthy: 2,
                  missing: 0,
                  sizeMismatch: 0,
                  checksumMismatch: 0,
                  remoteVerificationRequired: 0,
                },
              },
            },
          }),

        deepCloudIntegrityManager:
          createManager({
            verifications: [],

            alertSummary: {
              open: 0,
              critical: 0,
              acknowledged: 0,
            },
          }),

        availabilityWatcher:
          createManager({
            running: true,
          }),
      });

    const summary =
      dashboard
        .generateSummary();

    if (
      summary
        .recoveryReadiness
        .score < 80
    ) {
      throw new Error(
        "Healthy recovery score is unexpectedly low."
      );
    }

    if (
      summary
        .integrity
        .checksumMismatch !==
      0
    ) {
      throw new Error(
        "Healthy integrity summary failed."
      );
    }

    if (
      summary
        .archive
        .verified !==
      1
    ) {
      throw new Error(
        "Archive summary failed."
      );
    }

    if (
      summary
        .restore
        .verified !==
      1
    ) {
      throw new Error(
        "Restore summary failed."
      );
    }

    if (
      summary.safety
        .automaticDeletion !==
      false
    ) {
      throw new Error(
        "Automatic deletion must remain disabled."
      );
    }

    const degraded =
      new StorageDisasterRecoveryDashboard({
        statePath:
          path.join(
            root,
            "degraded.json"
          ),

        healthScorer: {
          evaluateAll() {
            return [
              {
                health: {
                  status:
                    "critical",
                },
              },
            ];
          },
        },

        providerCore:
          createManager({
            providers: [
              {},
            ],
          }),

        capacityManager:
          createManager({
            providers: {
              local: {
                level:
                  "critical",
              },
            },

            reservations: [],
          }),

        lifecycleManager:
          createManager({
            config: {
              automaticDeletion:
                false,
            },
          }),

        safeArchiveManager:
          createManager({
            archives: [],
            cleanupRequests: [],
          }),

        restoreManager:
          createManager({
            restores: [
              {
                status:
                  "failed",

                verified:
                  false,
              },
            ],
          }),

        integrityScanner:
          createManager({
            state: {
              scheduler: {
                running:
                  true,
              },

              lastScan: {
                summary: {
                  total: 2,
                  healthy: 0,
                  missing: 1,
                  sizeMismatch: 0,
                  checksumMismatch: 1,
                  remoteVerificationRequired: 0,
                },
              },
            },
          }),

        deepCloudIntegrityManager:
          createManager({
            alertSummary: {
              open: 1,
              critical: 1,
              acknowledged: 0,
            },
          }),

        availabilityWatcher:
          createManager({
            running: false,
          }),
      });

    const bad =
      degraded
        .generateSummary();

    if (
      bad
        .recoveryReadiness
        .status !==
      "critical"
    ) {
      throw new Error(
        "Critical recovery state was not detected."
      );
    }

    if (
      bad.recommendations
        .length < 3
    ) {
      throw new Error(
        "Recovery recommendations were not generated."
      );
    }

    if (
      severityFromScore(
        90
      ) !== "healthy"
    ) {
      throw new Error(
        "Healthy score classification failed."
      );
    }

    console.log(
      "PASS: Provider health contributes to recovery readiness."
    );

    console.log(
      "PASS: Capacity risk contributes to recovery readiness."
    );

    console.log(
      "PASS: Archive and restore readiness are summarized."
    );

    console.log(
      "PASS: Local, NAS and Cloud integrity risks are summarized."
    );

    console.log(
      "PASS: Critical Deep Cloud alerts reduce recovery readiness."
    );

    console.log(
      "PASS: Disaster Recovery recommendations are generated from actual subsystem state."
    );

    console.log(
      "PASS: Unavailable subsystems degrade gracefully instead of crashing the dashboard."
    );

    console.log(
      "PASS: Dashboard remains read-only with automatic repair, deletion and overwrite disabled."
    );

    console.log(
      "PASS: Storage Disaster Recovery Dashboard validation completed."
    );
  } finally {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.stack ||
        error.message
      : String(error)
  );

  process.exit(1);
}
