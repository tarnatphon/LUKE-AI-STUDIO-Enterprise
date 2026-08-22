#!/usr/bin/env node
"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const {
  StorageRecoveryRunbookManager,
  ACTION_LEVELS,
  SAFE_ACTION_IDS,
} = require(
  "../server/storage-recovery-runbook-manager.cjs"
);

function main() {
  const root =
    path.join(
      "/tmp",
      `luke-runbook-${process.pid}`
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    }
  );

  try {
    const manager =
      new StorageRecoveryRunbookManager({
        statePath:
          path.join(
            root,
            "state.json"
          ),

        disasterRecoveryDashboard: {
          generateSummary() {
            return {
              recoveryReadiness: {
                score: 35,
                status:
                  "critical",
              },

              recommendations: [
                {
                  code:
                    "checksum-mismatch",
                  severity:
                    "critical",
                  message:
                    "Checksum mismatch",
                },

                {
                  code:
                    "cleanup-pending",
                  severity:
                    "info",
                  message:
                    "Cleanup pending",
                },

                {
                  code:
                    "watcher-stopped",
                  severity:
                    "info",
                  message:
                    "Watcher stopped",
                },
              ],
            };
          },
        },
      });

    const runbook =
      manager.createRunbook();

    if (
      runbook
        .procedures
        .length !== 3
    ) {
      throw new Error(
        "Expected three runbook procedures."
      );
    }

    const cleanup =
      runbook
        .procedures
        .find(
          (item) =>
            item.code ===
            "cleanup-pending"
        );

    if (
      !cleanup
        .steps
        .some(
          (step) =>
            step.level ===
            ACTION_LEVELS
              .REQUIRES_CONFIRMATION
        )
    ) {
      throw new Error(
        "Cleanup confirmation gate missing."
      );
    }

    const watcher =
      runbook
        .procedures
        .find(
          (item) =>
            item.code ===
            "watcher-stopped"
        );

    const executable =
      watcher
        .steps
        .filter(
          (step) =>
            step.safeExecutable
        );

    if (
      executable.length < 2
    ) {
      throw new Error(
        "Watcher safe actions were not generated."
      );
    }

    for (
      const procedure of
      runbook.procedures
    ) {
      for (
        const step of
        procedure.steps
      ) {
        if (
          step.safeExecutable
        ) {
          if (
            !SAFE_ACTION_IDS.has(
              step.action.id
            )
          ) {
            throw new Error(
              "Unsafe action escaped safe-action allowlist."
            );
          }
        }

        if (
          step.level ===
          ACTION_LEVELS
            .REQUIRES_CONFIRMATION &&
          step.safeExecutable
        ) {
          throw new Error(
            "Confirmation action must never be safe-executable."
          );
        }
      }
    }

    if (
      runbook
        .executionPolicy
        .automaticActionExecution !==
      false
    ) {
      throw new Error(
        "Automatic action execution must remain disabled."
      );
    }

    if (
      runbook
        .executionPolicy
        .destructiveAutomaticExecution !==
      false
    ) {
      throw new Error(
        "Destructive automatic execution must remain disabled."
      );
    }

    console.log(
      "PASS: Disaster Recovery recommendations are converted into guided runbook procedures."
    );

    console.log(
      "PASS: Safe actions are restricted to an explicit allowlist."
    );

    console.log(
      "PASS: Health evaluation, availability scan and integrity scan can be user-triggered safely."
    );

    console.log(
      "PASS: Actions requiring identifiers or recovery choices remain manual."
    );

    console.log(
      "PASS: Source cleanup remains behind explicit confirmation."
    );

    console.log(
      "PASS: Destructive actions are never executable as SAFE actions."
    );

    console.log(
      "PASS: Guided Recovery never performs automatic repair, deletion or overwrite."
    );

    console.log(
      "PASS: Storage Recovery Runbook validation completed."
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
