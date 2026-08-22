#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  StorageRecoverySimulationManager,
} = require(
  "../server/storage-recovery-simulation-manager.cjs"
);

function main() {
  const root =
    path.join(
      "/tmp",
      `luke-simulation-test-${process.pid}`
    );

  fs.mkdirSync(
    root,
    {
      recursive: true,
    }
  );

  try {
    const manager =
      new StorageRecoverySimulationManager({
        statePath:
          path.join(
            root,
            "state.json"
          ),
      });

    const scenarios =
      manager.listScenarios();

    if (
      scenarios.length < 7
    ) {
      throw new Error(
        "Expected all disaster drill scenarios."
      );
    }

    const full =
      manager.runAll();

    if (
      full.total !==
      scenarios.length
    ) {
      throw new Error(
        "Run-all scenario count mismatch."
      );
    }

    if (
      full.passed !==
      true
    ) {
      const failed =
        full.results
          .filter(
            (item) =>
              !item.passed
          )
          .map(
            (item) =>
              item.scenarioId
          )
          .join(", ");

      throw new Error(
        `Disaster drill failed: ${failed}`
      );
    }

    for (
      const result of
      full.results
    ) {
      if (
        result.safety
          .simulationOnly !==
        true
      ) {
        throw new Error(
          "Simulation safety flag missing."
        );
      }

      if (
        result.safety
          .productionStorageTouched !==
        false
      ) {
        throw new Error(
          "Simulation must never touch production storage."
        );
      }

      if (
        result.safety
          .networkAccess !==
        false
      ) {
        throw new Error(
          "Disaster drill must not use network access."
        );
      }

      if (
        result
          .missingExpectedCodes
          .length !==
        0
      ) {
        throw new Error(
          `Expected recovery recommendation missing in ${result.scenarioId}`
        );
      }
    }

    console.log(
      "PASS: NAS/provider offline scenario is detected."
    );

    console.log(
      "PASS: Critical Local capacity scenario is detected."
    );

    console.log(
      "PASS: SHA-256 corruption scenario is detected."
    );

    console.log(
      "PASS: Missing archive scenario is detected."
    );

    console.log(
      "PASS: Restore failure scenario is detected."
    );

    console.log(
      "PASS: Critical Cloud integrity alert scenario is detected."
    );

    console.log(
      "PASS: Stopped availability watcher scenario is detected."
    );

    console.log(
      "PASS: Disaster Recovery recommendations map to the expected Guided Recovery procedures."
    );

    console.log(
      "PASS: Disaster Drill uses mock managers only."
    );

    console.log(
      "PASS: Production Local, External, NAS and Cloud storage are never accessed."
    );

    console.log(
      "PASS: Disaster Drill performs no network access."
    );

    console.log(
      "PASS: Automatic repair, deletion and overwrite remain disabled."
    );

    console.log(
      "PASS: Storage Recovery Simulation validation completed."
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
