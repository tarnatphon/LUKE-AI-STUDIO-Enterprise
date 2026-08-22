"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
    path.dirname(filePath),
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

function defaultState() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    lastRunbook: null,
    history: [],
    events: [],
  };
}

const ACTION_LEVELS =
  Object.freeze({
    SAFE: "SAFE",
    REQUIRES_CONFIRMATION:
      "REQUIRES_CONFIRMATION",
    MANUAL_ONLY:
      "MANUAL_ONLY",
  });

const SAFE_ACTION_IDS =
  new Set([
    "evaluate-storage-health",
    "scan-storage-availability",
    "start-storage-watcher",
    "run-integrity-scan",
  ]);

const RUNBOOK_DEFINITIONS =
  Object.freeze({
    "provider-health": {
      title:
        "Storage provider health issue",

      objective:
        "Identify the unhealthy provider and verify connectivity before moving or restoring data.",

      steps: [
        {
          order: 1,
          title:
            "Refresh provider health",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "evaluate-storage-health",
            method:
              "POST",
            endpoint:
              "/api/storage/health/evaluate",
            requiresInput:
              false,
          },
        },
        {
          order: 2,
          title:
            "Scan provider availability",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "scan-storage-availability",
            method:
              "POST",
            endpoint:
              "/api/storage/watcher/scan",
            requiresInput:
              false,
          },
        },
        {
          order: 3,
          title:
            "Review provider selection",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Review provider health and choose a healthy destination before retrying transfers.",
        },
      ],
    },

    "capacity-critical": {
      title:
        "Critical storage capacity",

      objective:
        "Prevent failed writes while preserving existing files.",

      steps: [
        {
          order: 1,
          title:
            "Run integrity scan first",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "run-integrity-scan",
            method:
              "POST",
            endpoint:
              "/api/storage/integrity/scan",
            requiresInput:
              false,
          },
        },
        {
          order: 2,
          title:
            "Review cleanup candidates",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Review Lifecycle and Archive candidates. Do not delete files solely to free space.",
        },
        {
          order: 3,
          title:
            "Archive before cleanup",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Archive selected files to verified External, NAS or Cloud storage before considering source cleanup.",
        },
      ],
    },

    "checksum-mismatch": {
      title:
        "SHA-256 integrity mismatch",

      objective:
        "Confirm corruption and restore from a verified copy without overwriting the damaged file.",

      steps: [
        {
          order: 1,
          title:
            "Run integrity scan again",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "run-integrity-scan",
            method:
              "POST",
            endpoint:
              "/api/storage/integrity/scan",
            requiresInput:
              false,
          },
        },
        {
          order: 2,
          title:
            "Deep verify Cloud archive",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Select the matching verified Cloud Archive ID and run Deep Cloud Verification.",
        },
        {
          order: 3,
          title:
            "Prepare restore-as-new",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Restore from a verified archive using Restore As New. Do not overwrite the existing file.",
        },
      ],
    },

    "missing-files": {
      title:
        "Missing archived or restored file",

      objective:
        "Locate another verified copy and recover it without modifying remaining archives.",

      steps: [
        {
          order: 1,
          title:
            "Scan storage availability",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "scan-storage-availability",
            method:
              "POST",
            endpoint:
              "/api/storage/watcher/scan",
            requiresInput:
              false,
          },
        },
        {
          order: 2,
          title:
            "Verify alternate archive",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Identify another verified Local, NAS or Cloud archive with the expected checksum.",
        },
        {
          order: 3,
          title:
            "Restore to a new path",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Prepare Restore As New from the verified archive.",
        },
      ],
    },

    "cloud-integrity-alerts": {
      title:
        "Critical Cloud integrity alert",

      objective:
        "Verify the remote object before relying on it for recovery.",

      steps: [
        {
          order: 1,
          title:
            "Deep verify affected Cloud archive",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Use the affected Archive ID in Deep Cloud Integrity Verification.",
        },
        {
          order: 2,
          title:
            "Acknowledge alert after review",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Acknowledge the alert only after reviewing verification results.",
        },
        {
          order: 3,
          title:
            "Preserve alternate verified copies",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Do not cleanup other verified copies while the Cloud object remains suspect.",
        },
      ],
    },

    "restore-failure": {
      title:
        "Restore operation failed",

      objective:
        "Determine whether the archive, destination or checksum caused the restore failure.",

      steps: [
        {
          order: 1,
          title:
            "Run integrity scan",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "run-integrity-scan",
            method:
              "POST",
            endpoint:
              "/api/storage/integrity/scan",
            requiresInput:
              false,
          },
        },
        {
          order: 2,
          title:
            "Verify source archive",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Verify the selected archive before preparing another restore.",
        },
        {
          order: 3,
          title:
            "Retry using Restore As New",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Prepare a new restore destination rather than overwriting the failed destination.",
        },
      ],
    },

    "cleanup-pending": {
      title:
        "Source cleanup waiting for confirmation",

      objective:
        "Ensure the archived copy remains verified before any source deletion.",

      steps: [
        {
          order: 1,
          title:
            "Verify archive status",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Confirm that archive verification is still valid and the destination remains available.",
        },
        {
          order: 2,
          title:
            "Confirm source cleanup",
          level:
            ACTION_LEVELS.REQUIRES_CONFIRMATION,
          action: null,
          instruction:
            "Source deletion requires the existing explicit cleanup confirmation workflow. Guided Recovery will never execute this automatically.",
        },
      ],
    },

    "watcher-stopped": {
      title:
        "Storage availability watcher stopped",

      objective:
        "Resume storage availability monitoring.",

      steps: [
        {
          order: 1,
          title:
            "Start storage watcher",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "start-storage-watcher",
            method:
              "POST",
            endpoint:
              "/api/storage/watcher/start",
            requiresInput:
              false,
          },
        },
        {
          order: 2,
          title:
            "Run immediate availability scan",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "scan-storage-availability",
            method:
              "POST",
            endpoint:
              "/api/storage/watcher/scan",
            requiresInput:
              false,
          },
        },
      ],
    },

    "subsystem-unavailable": {
      title:
        "Recovery subsystem unavailable",

      objective:
        "Restore observability before executing recovery actions.",

      steps: [
        {
          order: 1,
          title:
            "Refresh health",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "evaluate-storage-health",
            method:
              "POST",
            endpoint:
              "/api/storage/health/evaluate",
            requiresInput:
              false,
          },
        },
        {
          order: 2,
          title:
            "Review unavailable subsystem",
          level:
            ACTION_LEVELS.MANUAL_ONLY,
          action: null,
          instruction:
            "Review the Disaster Recovery subsystem list and backend logs before recovery operations.",
        },
      ],
    },

    "recovery-ready": {
      title:
        "Storage recovery systems healthy",

      objective:
        "Maintain verification coverage without changing data.",

      steps: [
        {
          order: 1,
          title:
            "Optional integrity scan",
          level:
            ACTION_LEVELS.SAFE,
          action: {
            id:
              "run-integrity-scan",
            method:
              "POST",
            endpoint:
              "/api/storage/integrity/scan",
            requiresInput:
              false,
          },
        },
      ],
    },
  });

class StorageRecoveryRunbookManager {
  constructor({
    statePath,
    disasterRecoveryDashboard,
  }) {
    this.statePath =
      statePath;

    this.disasterRecoveryDashboard =
      disasterRecoveryDashboard;
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

    state.history =
      (
        state.history || []
      ).slice(-200);

    state.events =
      (
        state.events || []
      ).slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  validateSafeAction(action) {
    if (!action) {
      return false;
    }

    if (
      !SAFE_ACTION_IDS.has(
        action.id
      )
    ) {
      return false;
    }

    if (
      action.method !==
      "POST"
    ) {
      return false;
    }

    if (
      action.requiresInput ===
      true
    ) {
      return false;
    }

    return true;
  }

  createRunbook() {
    const disasterRecovery =
      this.disasterRecoveryDashboard
        .generateSummary();

    const recommendations =
      disasterRecovery
        .recommendations ||
      [];

    const procedures =
      recommendations.map(
        (
          recommendation,
          index,
        ) => {
          const definition =
            RUNBOOK_DEFINITIONS[
              recommendation.code
            ] ||
            {
              title:
                recommendation.code,
              objective:
                recommendation.message,
              steps: [
                {
                  order: 1,
                  title:
                    "Review manually",
                  level:
                    ACTION_LEVELS.MANUAL_ONLY,
                  action: null,
                  instruction:
                    recommendation.message,
                },
              ],
            };

          const steps =
            definition.steps.map(
              (step) => ({
                ...step,
                safeExecutable:
                  step.level ===
                    ACTION_LEVELS.SAFE &&
                  this.validateSafeAction(
                    step.action
                  ),
              })
            );

          return {
            id:
              `procedure-${index + 1}-${recommendation.code}`,
            code:
              recommendation.code,
            severity:
              recommendation.severity,
            title:
              definition.title,
            objective:
              definition.objective,
            steps,
          };
        }
      );

    const counts = {
      safe: 0,
      requiresConfirmation: 0,
      manualOnly: 0,
    };

    for (
      const procedure of
      procedures
    ) {
      for (
        const step of
        procedure.steps
      ) {
        if (
          step.level ===
          ACTION_LEVELS.SAFE
        ) {
          counts.safe += 1;
        }

        if (
          step.level ===
          ACTION_LEVELS
            .REQUIRES_CONFIRMATION
        ) {
          counts
            .requiresConfirmation +=
            1;
        }

        if (
          step.level ===
          ACTION_LEVELS.MANUAL_ONLY
        ) {
          counts.manualOnly +=
            1;
        }
      }
    }

    const runbook = {
      generatedAt:
        new Date()
          .toISOString(),

      recoveryReadiness:
        disasterRecovery
          .recoveryReadiness,

      procedures,

      counts,

      executionPolicy: {
        safeActionsRequireUserClick:
          true,

        automaticActionExecution:
          false,

        destructiveAutomaticExecution:
          false,

        cleanupConfirmationRequired:
          true,

        automaticRepair:
          false,

        automaticDeletion:
          false,

        automaticOverwrite:
          false,
      },
    };

    const state =
      this.readState();

    state.lastRunbook =
      runbook;

    state.history.push({
      generatedAt:
        runbook.generatedAt,

      recoveryScore:
        runbook
          .recoveryReadiness
          ?.score ??
        null,

      procedureCount:
        procedures.length,

      counts,
    });

    state.events.push({
      type:
        "recovery-runbook-generated",

      procedureCount:
        procedures.length,

      createdAt:
        runbook.generatedAt,
    });

    this.writeState(
      state
    );

    return runbook;
  }

  getStatus() {
    return {
      state:
        this.readState(),

      current:
        this.createRunbook(),

      allowedSafeActions:
        Array.from(
          SAFE_ACTION_IDS
        ),

      safety: {
        automaticActionExecution:
          false,

        destructiveAutomaticExecution:
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
  StorageRecoveryRunbookManager,
  ACTION_LEVELS,
  SAFE_ACTION_IDS,
  RUNBOOK_DEFINITIONS,
};
