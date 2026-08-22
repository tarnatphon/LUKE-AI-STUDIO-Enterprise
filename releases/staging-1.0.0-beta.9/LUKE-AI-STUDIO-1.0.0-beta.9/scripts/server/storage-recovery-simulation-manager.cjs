"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  StorageDisasterRecoveryDashboard,
} = require(
  "./storage-disaster-recovery-dashboard.cjs"
);

const {
  StorageRecoveryRunbookManager,
} = require(
  "./storage-recovery-runbook-manager.cjs"
);

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(
    path.dirname(filePath),
    { recursive: true }
  );

  const temporaryPath =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  fs.renameSync(
    temporaryPath,
    filePath
  );
}

function defaultState() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    lastDrill: null,
    drills: [],
    events: [],
  };
}

function statusManager(value) {
  return {
    getStatus() {
      return value;
    },
  };
}

const SCENARIOS =
  Object.freeze({
    "provider-offline": {
      label:
        "NAS / Provider Offline",

      expectedCodes: [
        "provider-health",
      ],

      build() {
        return {
          healthScorer: {
            evaluateAll() {
              return [
                {
                  health: {
                    status:
                      "offline",
                  },
                },
              ];
            },
          },

          providerCore:
            statusManager({
              providers: [
                {
                  id:
                    "nas-test",
                },
              ],
            }),

          watcher:
            statusManager({
              running: true,
            }),
        };
      },
    },

    "capacity-critical": {
      label:
        "Local Capacity Critical",

      expectedCodes: [
        "capacity-critical",
      ],

      build() {
        return {
          capacity:
            statusManager({
              providers: {
                local: {
                  level:
                    "critical",
                },
              },
              reservations: [],
              cleanupRecommendations: [],
            }),
        };
      },
    },

    "checksum-corruption": {
      label:
        "Checksum Corruption",

      expectedCodes: [
        "checksum-mismatch",
      ],

      build() {
        return {
          integrity:
            statusManager({
              state: {
                scheduler: {
                  running: true,
                },
                lastScan: {
                  summary: {
                    total: 1,
                    healthy: 0,
                    missing: 0,
                    sizeMismatch: 0,
                    checksumMismatch: 1,
                    remoteVerificationRequired: 0,
                  },
                },
              },
            }),
        };
      },
    },

    "archive-missing": {
      label:
        "Archived File Missing",

      expectedCodes: [
        "missing-files",
      ],

      build() {
        return {
          integrity:
            statusManager({
              state: {
                scheduler: {
                  running: true,
                },
                lastScan: {
                  summary: {
                    total: 1,
                    healthy: 0,
                    missing: 1,
                    sizeMismatch: 0,
                    checksumMismatch: 0,
                    remoteVerificationRequired: 0,
                  },
                },
              },
            }),
        };
      },
    },

    "restore-failure": {
      label:
        "Restore Failure",

      expectedCodes: [
        "restore-failure",
      ],

      build() {
        return {
          restore:
            statusManager({
              restores: [
                {
                  id:
                    "restore-test",
                  status:
                    "failed",
                  verified:
                    false,
                },
              ],
            }),
        };
      },
    },

    "cloud-integrity-alert": {
      label:
        "Cloud Integrity Alert",

      expectedCodes: [
        "cloud-integrity-alerts",
      ],

      build() {
        return {
          deepCloud:
            statusManager({
              verifications: [
                {
                  id:
                    "verify-test",
                  status:
                    "checksum-mismatch",
                },
              ],
              alertSummary: {
                open: 1,
                critical: 1,
                acknowledged: 0,
              },
            }),
        };
      },
    },

    "watcher-stopped": {
      label:
        "Availability Watcher Stopped",

      expectedCodes: [
        "watcher-stopped",
      ],

      build() {
        return {
          watcher:
            statusManager({
              running: false,
            }),
        };
      },
    },
  });

function createHealthyDefaults() {
  return {
    healthScorer: {
      evaluateAll() {
        return [
          {
            health: {
              status:
                "healthy",
            },
          },
        ];
      },
    },

    providerCore:
      statusManager({
        providers: [
          {
            id:
              "local-test",
          },
        ],
      }),

    capacity:
      statusManager({
        providers: {
          local: {
            level:
              "healthy",
          },
        },
        reservations: [],
        cleanupRecommendations: [],
      }),

    lifecycle:
      statusManager({
        config: {
          automaticDeletion:
            false,
        },
      }),

    archive:
      statusManager({
        archives: [
          {
            id:
              "archive-test",
            verified:
              true,
            cleanupEligible:
              false,
          },
        ],
        cleanupRequests: [],
      }),

    restore:
      statusManager({
        restores: [],
      }),

    integrity:
      statusManager({
        state: {
          scheduler: {
            running: true,
          },
          lastScan: {
            summary: {
              total: 1,
              healthy: 1,
              missing: 0,
              sizeMismatch: 0,
              checksumMismatch: 0,
              remoteVerificationRequired: 0,
            },
          },
        },
      }),

    deepCloud:
      statusManager({
        verifications: [],
        alertSummary: {
          open: 0,
          critical: 0,
          acknowledged: 0,
        },
      }),

    watcher:
      statusManager({
        running: true,
      }),
  };
}

class StorageRecoverySimulationManager {
  constructor({
    statePath,
  }) {
    this.statePath =
      statePath;
  }

  readState() {
    if (
      !fs.existsSync(
        this.statePath
      )
    ) {
      return defaultState();
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date()
        .toISOString();

    state.drills =
      (state.drills || [])
        .slice(-200);

    state.events =
      (state.events || [])
        .slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  listScenarios() {
    return Object.entries(
      SCENARIOS
    ).map(
      ([
        id,
        scenario,
      ]) => ({
        id,
        label:
          scenario.label,
        expectedCodes:
          scenario
            .expectedCodes,
      })
    );
  }

  runScenario(
    scenarioId
  ) {
    const scenario =
      SCENARIOS[
        scenarioId
      ];

    if (!scenario) {
      const error =
        new Error(
          "Unknown disaster drill scenario."
        );

      error.statusCode = 404;
      throw error;
    }

    const root =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "luke-storage-drill-"
        )
      );

    try {
      const defaults =
        createHealthyDefaults();

      const override =
        scenario.build();

      const managers = {
        ...defaults,
        ...override,
      };

      const dashboard =
        new StorageDisasterRecoveryDashboard({
          statePath:
            path.join(
              root,
              "dr-state.json"
            ),

          healthScorer:
            managers
              .healthScorer,

          capacityManager:
            managers.capacity,

          lifecycleManager:
            managers.lifecycle,

          safeArchiveManager:
            managers.archive,

          restoreManager:
            managers.restore,

          integrityScanner:
            managers.integrity,

          deepCloudIntegrityManager:
            managers.deepCloud,

          availabilityWatcher:
            managers.watcher,

          providerCore:
            managers.providerCore,
        });

      const runbook =
        new StorageRecoveryRunbookManager({
          statePath:
            path.join(
              root,
              "runbook-state.json"
            ),

          disasterRecoveryDashboard:
            dashboard,
        });

      const summary =
        dashboard
          .generateSummary();

      const guide =
        runbook
          .createRunbook();

      const actualCodes =
        (
          summary
            .recommendations ||
          []
        ).map(
          (item) =>
            item.code
        );

      const missingExpectedCodes =
        scenario
          .expectedCodes
          .filter(
            (code) =>
              !actualCodes
                .includes(code)
          );

      const passed =
        missingExpectedCodes
          .length === 0;

      const result = {
        scenarioId,
        label:
          scenario.label,

        passed,

        expectedCodes:
          scenario
            .expectedCodes,

        actualCodes,

        missingExpectedCodes,

        recoveryReadiness:
          summary
            .recoveryReadiness,

        runbookCounts:
          guide.counts,

        procedureCodes:
          guide.procedures
            .map(
              (item) =>
                item.code
            ),

        safety: {
          simulationOnly:
            true,

          mockManagersOnly:
            true,

          productionStorageTouched:
            false,

          networkAccess:
            false,

          automaticRepair:
            false,

          automaticDeletion:
            false,

          automaticOverwrite:
            false,
        },

        completedAt:
          new Date()
            .toISOString(),
      };

      const state =
        this.readState();

      state.lastDrill =
        result;

      state.drills.push(
        result
      );

      state.events.push({
        type:
          "storage-recovery-drill-completed",

        scenarioId,

        passed,

        createdAt:
          result.completedAt,
      });

      this.writeState(
        state
      );

      return result;
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

  runAll() {
    const results =
      Object.keys(
        SCENARIOS
      ).map(
        (scenarioId) =>
          this.runScenario(
            scenarioId
          )
      );

    return {
      passed:
        results.every(
          (item) =>
            item.passed
        ),

      total:
        results.length,

      passedCount:
        results.filter(
          (item) =>
            item.passed
        ).length,

      failedCount:
        results.filter(
          (item) =>
            !item.passed
        ).length,

      results,

      completedAt:
        new Date()
          .toISOString(),

      safety: {
        simulationOnly:
          true,

        productionStorageTouched:
          false,

        networkAccess:
          false,
      },
    };
  }

  getStatus() {
    return {
      state:
        this.readState(),

      scenarios:
        this.listScenarios(),

      safety: {
        simulationOnly:
          true,

        mockManagersOnly:
          true,

        productionStorageTouched:
          false,

        networkAccess:
          false,

        automaticRepair:
          false,

        automaticDeletion:
          false,

        automaticOverwrite:
          false,
      },
    };
  }
}

module.exports = {
  StorageRecoverySimulationManager,
  SCENARIOS,
};
