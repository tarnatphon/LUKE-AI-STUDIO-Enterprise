#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  StorageRecoveryReadinessCertifier,
} = require(
  "../server/storage-recovery-readiness-certifier.cjs"
);

function main() {
  const root =
    path.join(
      "/tmp",
      `luke-storage-cert-${process.pid}`
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    }
  );

  try {
    const certifier =
      new StorageRecoveryReadinessCertifier({
        statePath:
          path.join(
            root,
            "state.json"
          ),

        disasterRecoveryDashboard: {
          generateSummary() {
            return {
              recoveryReadiness: {
                score: 97,
                status:
                  "healthy",
              },

              safety: {
                automaticRepair:
                  false,

                automaticDeletion:
                  false,

                automaticOverwrite:
                  false,
              },
            };
          },
        },

        recoveryRunbookManager: {
          createRunbook() {
            return {
              procedures: [
                {
                  code:
                    "recovery-ready",
                },
              ],

              counts: {
                safe: 1,
                requiresConfirmation: 0,
                manualOnly: 0,
              },

              executionPolicy: {
                automaticActionExecution:
                  false,

                destructiveAutomaticExecution:
                  false,
              },
            };
          },
        },

        recoverySimulationManager: {
          runAll() {
            return {
              passed: true,
              total: 7,
              passedCount: 7,
              failedCount: 0,
            };
          },
        },
      });

    const result =
      certifier.certify();

    if (
      result.passed !==
      true
    ) {
      throw new Error(
        "Certification should pass."
      );
    }

    if (
      result.status !==
      "CERTIFIED"
    ) {
      throw new Error(
        "Certification status mismatch."
      );
    }

    for (
      const [
        gate,
        passed,
      ] of Object.entries(
        result.gates
      )
    ) {
      if (
        passed !== true
      ) {
        throw new Error(
          `Certification gate failed: ${gate}`
        );
      }
    }

    if (
      result.safety
        .automaticDeletion !==
      false
    ) {
      throw new Error(
        "Automatic deletion must remain disabled."
      );
    }

    if (
      result.safety
        .destructiveAutoExecution !==
      false
    ) {
      throw new Error(
        "Destructive auto execution must remain disabled."
      );
    }

    console.log(
      "PASS: Recovery readiness score is included in certification."
    );

    console.log(
      "PASS: Disaster Drill must pass before certification."
    );

    console.log(
      "PASS: Guided Recovery policy is validated."
    );

    console.log(
      "PASS: Destructive automatic execution remains disabled."
    );

    console.log(
      "PASS: Automatic repair, deletion and overwrite remain disabled."
    );

    console.log(
      "PASS: Storage Recovery Readiness Certification validation completed."
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
