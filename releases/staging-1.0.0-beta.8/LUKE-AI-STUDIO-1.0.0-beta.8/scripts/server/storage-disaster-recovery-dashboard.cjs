"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8"
    )
  );
}

function writeJsonAtomic(
  filePath,
  value
) {
  fs.mkdirSync(
    path.dirname(
      filePath
    ),
    {
      recursive: true,
    }
  );

  const temporaryPath =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.renameSync(
    temporaryPath,
    filePath
  );
}

function createDefaultState() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    lastSummary: null,
    history: [],
    events: [],
  };
}

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function getArray(
  value
) {
  return Array.isArray(value)
    ? value
    : [];
}

function severityFromScore(
  score
) {
  if (score >= 85) {
    return "healthy";
  }

  if (score >= 65) {
    return "warning";
  }

  return "critical";
}

class StorageDisasterRecoveryDashboard {
  constructor({
    statePath,
    healthScorer,
    capacityManager,
    lifecycleManager,
    safeArchiveManager,
    restoreManager,
    integrityScanner,
    deepCloudIntegrityManager,
    availabilityWatcher,
    providerCore,
  }) {
    this.statePath =
      statePath;

    this.healthScorer =
      healthScorer;

    this.capacityManager =
      capacityManager;

    this.lifecycleManager =
      lifecycleManager;

    this.safeArchiveManager =
      safeArchiveManager;

    this.restoreManager =
      restoreManager;

    this.integrityScanner =
      integrityScanner;

    this.deepCloudIntegrityManager =
      deepCloudIntegrityManager;

    this.availabilityWatcher =
      availabilityWatcher;

    this.providerCore =
      providerCore;
  }

  readState() {
    if (
      !fs.existsSync(
        this.statePath
      )
    ) {
      return createDefaultState();
    }

    return readJson(
      this.statePath
    );
  }

  writeState(
    state
  ) {
    state.updatedAt =
      new Date()
        .toISOString();

    state.history =
      getArray(
        state.history
      ).slice(-200);

    state.events =
      getArray(
        state.events
      ).slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  safeCall(
    label,
    callback
  ) {
    try {
      return {
        ok: true,
        label,
        value:
          callback(),
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        label,
        value: null,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      };
    }
  }

  collectProviderHealth() {
    if (
      this.healthScorer &&
      typeof this.healthScorer
        .evaluateAll ===
        "function"
    ) {
      return this.safeCall(
        "providerHealth",
        () =>
          this.healthScorer
            .evaluateAll()
      );
    }

    if (
      this.healthScorer &&
      typeof this.healthScorer
        .getStatus ===
        "function"
    ) {
      return this.safeCall(
        "providerHealth",
        () =>
          this.healthScorer
            .getStatus()
      );
    }

    return {
      ok: false,
      label:
        "providerHealth",
      value: null,
      error:
        "Health scorer contract unavailable.",
    };
  }

  collectGetStatus(
    label,
    manager
  ) {
    if (
      !manager ||
      typeof manager.getStatus !==
        "function"
    ) {
      return {
        ok: false,
        label,
        value: null,
        error:
          `${label} getStatus unavailable.`,
      };
    }

    return this.safeCall(
      label,
      () =>
        manager.getStatus()
    );
  }

  buildProviderSummary(
    healthResult,
    providerResult
  ) {
    const providerStatus =
      providerResult.value ||
      {};

    const providers =
      getArray(
        providerStatus.providers
      );

    let healthRecords = [];

    if (
      Array.isArray(
        healthResult.value
      )
    ) {
      healthRecords =
        healthResult.value;
    } else if (
      Array.isArray(
        healthResult.value
          ?.providers
      )
    ) {
      healthRecords =
        healthResult.value
          .providers;
    }

    const unhealthy =
      healthRecords.filter(
        (item) => {
          const status =
            String(
              item?.health
                ?.status ??
              item?.status ??
              ""
            )
              .toLowerCase();

          return [
            "critical",
            "offline",
            "failed",
            "unhealthy",
          ].includes(status);
        }
      ).length;

    return {
      total:
        providers.length ||
        healthRecords.length,
      healthRecords:
        healthRecords.length,
      unhealthy,
      providerCoreAvailable:
        providerResult.ok,
      healthAvailable:
        healthResult.ok,
    };
  }

  buildCapacitySummary(
    result
  ) {
    const value =
      result.value || {};

    const providers =
      Object.values(
        value.providers || {}
      );

    const critical =
      providers.filter(
        (item) =>
          item?.level ===
          "critical"
      ).length;

    const warning =
      providers.filter(
        (item) =>
          item?.level ===
          "warning"
      ).length;

    return {
      trackedProviders:
        providers.length,
      critical,
      warning,
      activeReservations:
        getArray(
          value.reservations
        ).filter(
          (item) =>
            item.status ===
            "active"
        ).length,
      cleanupRecommendations:
        getArray(
          value
            .cleanupRecommendations
        ).length,
      available:
        result.ok,
    };
  }

  buildArchiveSummary(
    result
  ) {
    const value =
      result.value || {};

    const archives =
      getArray(
        value.archives
      );

    const cleanupRequests =
      getArray(
        value.cleanupRequests
      );

    return {
      total:
        archives.length,
      verified:
        archives.filter(
          (item) =>
            item.verified ===
            true
        ).length,
      cleanupEligible:
        archives.filter(
          (item) =>
            item.cleanupEligible ===
            true
        ).length,
      pendingCleanup:
        cleanupRequests.filter(
          (item) =>
            item.status ===
            "pending"
        ).length,
      available:
        result.ok,
    };
  }

  buildRestoreSummary(
    result
  ) {
    const value =
      result.value || {};

    const restores =
      getArray(
        value.restores
      );

    return {
      total:
        restores.length,
      completed:
        restores.filter(
          (item) =>
            item.status ===
            "completed"
        ).length,
      verified:
        restores.filter(
          (item) =>
            item.verified ===
            true
        ).length,
      failed:
        restores.filter(
          (item) =>
            item.status ===
            "failed"
        ).length,
      available:
        result.ok,
    };
  }

  buildIntegritySummary(
    result
  ) {
    const value =
      result.value || {};

    const lastScan =
      value.state
        ?.lastScan ||
      value.lastScan ||
      null;

    const summary =
      lastScan
        ?.summary ||
      {};

    return {
      total:
        safeNumber(
          summary.total
        ),
      healthy:
        safeNumber(
          summary.healthy
        ),
      missing:
        safeNumber(
          summary.missing
        ),
      sizeMismatch:
        safeNumber(
          summary.sizeMismatch
        ),
      checksumMismatch:
        safeNumber(
          summary.checksumMismatch
        ),
      remoteVerificationRequired:
        safeNumber(
          summary
            .remoteVerificationRequired
        ),
      schedulerRunning:
        Boolean(
          value.state
            ?.scheduler
            ?.running
        ),
      available:
        result.ok,
    };
  }

  buildDeepCloudSummary(
    result
  ) {
    const value =
      result.value || {};

    return {
      verifications:
        getArray(
          value.verifications
        ).length,
      openAlerts:
        safeNumber(
          value.alertSummary
            ?.open
        ),
      criticalAlerts:
        safeNumber(
          value.alertSummary
            ?.critical
        ),
      acknowledged:
        safeNumber(
          value.alertSummary
            ?.acknowledged
        ),
      available:
        result.ok,
    };
  }

  buildWatcherSummary(
    result
  ) {
    const value =
      result.value || {};

    return {
      running:
        Boolean(
          value.running
        ),
      lastCheckedAt:
        value.lastCheckedAt ||
        value.updatedAt ||
        null,
      available:
        result.ok,
    };
  }

  calculateRecoveryScore({
    providers,
    capacity,
    archive,
    restore,
    integrity,
    deepCloud,
    watcher,
    subsystemErrors,
  }) {
    let score = 100;

    score -=
      providers.unhealthy *
      12;

    score -=
      capacity.critical *
      15;

    score -=
      capacity.warning *
      5;

    score -=
      restore.failed *
      8;

    score -=
      integrity.missing *
      12;

    score -=
      integrity.sizeMismatch *
      15;

    score -=
      integrity.checksumMismatch *
      20;

    score -=
      deepCloud.criticalAlerts *
      18;

    score -=
      subsystemErrors *
      5;

    if (
      watcher.available &&
      !watcher.running
    ) {
      score -= 3;
    }

    if (
      archive.total > 0 &&
      archive.verified === 0
    ) {
      score -= 8;
    }

    return clamp(
      Math.round(score),
      0,
      100
    );
  }

  generateRecommendations({
    providers,
    capacity,
    archive,
    restore,
    integrity,
    deepCloud,
    watcher,
    subsystemErrors,
  }) {
    const recommendations = [];

    if (
      providers.unhealthy > 0
    ) {
      recommendations.push({
        severity:
          "critical",
        code:
          "provider-health",
        message:
          "One or more storage providers require attention.",
      });
    }

    if (
      capacity.critical > 0
    ) {
      recommendations.push({
        severity:
          "critical",
        code:
          "capacity-critical",
        message:
          "At least one storage provider has critical capacity risk.",
      });
    }

    if (
      integrity.checksumMismatch >
      0
    ) {
      recommendations.push({
        severity:
          "critical",
        code:
          "checksum-mismatch",
        message:
          "Integrity scan detected SHA-256 mismatches.",
      });
    }

    if (
      integrity.missing > 0
    ) {
      recommendations.push({
        severity:
          "critical",
        code:
          "missing-files",
        message:
          "Integrity scan detected missing archived or restored files.",
      });
    }

    if (
      deepCloud.criticalAlerts >
      0
    ) {
      recommendations.push({
        severity:
          "critical",
        code:
          "cloud-integrity-alerts",
        message:
          "Deep Cloud Integrity has open critical alerts.",
      });
    }

    if (
      restore.failed > 0
    ) {
      recommendations.push({
        severity:
          "warning",
        code:
          "restore-failure",
        message:
          "One or more restore operations failed and should be reviewed.",
      });
    }

    if (
      archive.pendingCleanup >
      0
    ) {
      recommendations.push({
        severity:
          "info",
        code:
          "cleanup-pending",
        message:
          "Explicit source-cleanup requests are waiting for user action.",
      });
    }

    if (
      watcher.available &&
      !watcher.running
    ) {
      recommendations.push({
        severity:
          "info",
        code:
          "watcher-stopped",
        message:
          "Storage availability watcher is currently stopped.",
      });
    }

    if (
      subsystemErrors > 0
    ) {
      recommendations.push({
        severity:
          "warning",
        code:
          "subsystem-unavailable",
        message:
          "One or more recovery subsystems could not provide status.",
      });
    }

    if (
      recommendations.length ===
      0
    ) {
      recommendations.push({
        severity:
          "healthy",
        code:
          "recovery-ready",
        message:
          "No critical storage recovery risks are currently detected.",
      });
    }

    return recommendations;
  }

  generateSummary() {
    const raw = {
      health:
        this.collectProviderHealth(),

      providers:
        this.collectGetStatus(
          "providers",
          this.providerCore
        ),

      capacity:
        this.collectGetStatus(
          "capacity",
          this.capacityManager
        ),

      lifecycle:
        this.collectGetStatus(
          "lifecycle",
          this.lifecycleManager
        ),

      archive:
        this.collectGetStatus(
          "archive",
          this.safeArchiveManager
        ),

      restore:
        this.collectGetStatus(
          "restore",
          this.restoreManager
        ),

      integrity:
        this.collectGetStatus(
          "integrity",
          this.integrityScanner
        ),

      deepCloud:
        this.collectGetStatus(
          "deepCloud",
          this.deepCloudIntegrityManager
        ),

      watcher:
        this.collectGetStatus(
          "watcher",
          this.availabilityWatcher
        ),
    };

    const subsystemErrors =
      Object.values(raw)
        .filter(
          (item) =>
            item.ok !== true
        )
        .length;

    const providers =
      this.buildProviderSummary(
        raw.health,
        raw.providers
      );

    const capacity =
      this.buildCapacitySummary(
        raw.capacity
      );

    const archive =
      this.buildArchiveSummary(
        raw.archive
      );

    const restore =
      this.buildRestoreSummary(
        raw.restore
      );

    const integrity =
      this.buildIntegritySummary(
        raw.integrity
      );

    const deepCloud =
      this.buildDeepCloudSummary(
        raw.deepCloud
      );

    const watcher =
      this.buildWatcherSummary(
        raw.watcher
      );

    const score =
      this.calculateRecoveryScore({
        providers,
        capacity,
        archive,
        restore,
        integrity,
        deepCloud,
        watcher,
        subsystemErrors,
      });

    const status =
      severityFromScore(
        score
      );

    const recommendations =
      this.generateRecommendations({
        providers,
        capacity,
        archive,
        restore,
        integrity,
        deepCloud,
        watcher,
        subsystemErrors,
      });

    const summary = {
      generatedAt:
        new Date()
          .toISOString(),

      recoveryReadiness: {
        score,
        status,
      },

      providers,
      capacity,

      lifecycle: {
        available:
          raw.lifecycle.ok,

        automaticDeletion:
          raw.lifecycle
            .value
            ?.config
            ?.automaticDeletion ??
          false,
      },

      archive,
      restore,
      integrity,
      deepCloud,
      watcher,

      subsystemErrors,

      recommendations,

      safety: {
        readOnlyDashboard:
          true,

        automaticRepair:
          false,

        automaticDeletion:
          false,

        automaticOverwrite:
          false,

        remoteModification:
          false,
      },

      subsystemStatus:
        Object.fromEntries(
          Object.entries(raw)
            .map(
              ([
                key,
                value,
              ]) => [
                key,
                {
                  ok:
                    value.ok,
                  error:
                    value.error,
                },
              ]
            )
        ),
    };

    const state =
      this.readState();

    state.lastSummary =
      summary;

    state.history.push({
      generatedAt:
        summary.generatedAt,

      score:
        summary
          .recoveryReadiness
          .score,

      status:
        summary
          .recoveryReadiness
          .status,

      criticalAlerts:
        deepCloud
          .criticalAlerts,

      checksumMismatch:
        integrity
          .checksumMismatch,

      missing:
        integrity.missing,
    });

    state.events.push({
      type:
        "disaster-recovery-summary-generated",

      score:
        summary
          .recoveryReadiness
          .score,

      status:
        summary
          .recoveryReadiness
          .status,

      createdAt:
        summary.generatedAt,
    });

    this.writeState(
      state
    );

    return summary;
  }

  getStatus() {
    return {
      state:
        this.readState(),

      current:
        this.generateSummary(),

      safety: {
        readOnlyDashboard:
          true,

        automaticRepair:
          false,

        automaticDeletion:
          false,

        automaticOverwrite:
          false,

        shellExecution:
          false,
      },
    };
  }
}

module.exports = {
  StorageDisasterRecoveryDashboard,
  severityFromScore,
};
