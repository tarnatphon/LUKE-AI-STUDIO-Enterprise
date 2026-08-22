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

function createDefaultState() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    lastCertification: null,
    history: [],
  };
}

class StorageRecoveryReadinessCertifier {
  constructor({
    statePath,
    disasterRecoveryDashboard,
    recoveryRunbookManager,
    recoverySimulationManager,
  }) {
    this.statePath =
      statePath;

    this.disasterRecoveryDashboard =
      disasterRecoveryDashboard;

    this.recoveryRunbookManager =
      recoveryRunbookManager;

    this.recoverySimulationManager =
      recoverySimulationManager;
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

  writeState(state) {
    state.updatedAt =
      new Date()
        .toISOString();

    state.history =
      (
        state.history || []
      ).slice(-100);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  certify() {
    const dashboard =
      this.disasterRecoveryDashboard
        .generateSummary();

    const runbook =
      this.recoveryRunbookManager
        .createRunbook();

    const drill =
      this.recoverySimulationManager
        .runAll();

    const gates = {
      recoveryScoreAvailable:
        Number.isFinite(
          Number(
            dashboard
              ?.recoveryReadiness
              ?.score
          )
        ),

      noCriticalSimulationFailure:
        drill.passed === true,

      disasterDrillComplete:
        drill.total > 0 &&
        drill.failedCount === 0,

      runbookAvailable:
        Array.isArray(
          runbook.procedures
        ),

      safeActionPolicy:
        runbook
          .executionPolicy
          .automaticActionExecution ===
          false,

      destructiveAutoExecutionDisabled:
        runbook
          .executionPolicy
          .destructiveAutomaticExecution ===
          false,

      automaticRepairDisabled:
        dashboard
          .safety
          .automaticRepair ===
          false,

      automaticDeletionDisabled:
        dashboard
          .safety
          .automaticDeletion ===
          false,

      automaticOverwriteDisabled:
        dashboard
          .safety
          .automaticOverwrite ===
          false,
    };

    const passed =
      Object.values(
        gates
      ).every(
        Boolean
      );

    const certification = {
      certifiedAt:
        new Date()
          .toISOString(),

      passed,

      status:
        passed
          ? "CERTIFIED"
          : "NOT_CERTIFIED",

      recoveryReadiness:
        dashboard
          .recoveryReadiness,

      disasterDrill: {
        passed:
          drill.passed,

        total:
          drill.total,

        passedCount:
          drill.passedCount,

        failedCount:
          drill.failedCount,
      },

      runbook: {
        procedures:
          runbook
            .procedures
            .length,

        safeActions:
          runbook
            .counts
            .safe,

        requiresConfirmation:
          runbook
            .counts
            .requiresConfirmation,

        manualOnly:
          runbook
            .counts
            .manualOnly,
      },

      gates,

      safety: {
        automaticRepair:
          false,

        automaticDeletion:
          false,

        automaticOverwrite:
          false,

        destructiveAutoExecution:
          false,

        productionDrillAccess:
          false,
      },
    };

    const state =
      this.readState();

    state.lastCertification =
      certification;

    state.history.push({
      certifiedAt:
        certification
          .certifiedAt,

      passed:
        certification
          .passed,

      status:
        certification
          .status,

      recoveryScore:
        certification
          .recoveryReadiness
          ?.score ??
        null,

      disasterDrillPassed:
        certification
          .disasterDrill
          .passed,
    });

    this.writeState(
      state
    );

    return certification;
  }

  getStatus() {
    return {
      state:
        this.readState(),

      safety: {
        certificationOnly:
          true,

        productionMutation:
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
  StorageRecoveryReadinessCertifier,
};
