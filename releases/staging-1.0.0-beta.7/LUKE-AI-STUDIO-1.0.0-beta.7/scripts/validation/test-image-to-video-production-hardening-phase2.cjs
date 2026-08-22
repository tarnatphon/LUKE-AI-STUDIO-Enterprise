#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ImageToVideoJobManager,
} = require(
  "../server/image-to-video-job-manager.cjs"
);

const {
  planImageToVideoCleanup,
  applyImageToVideoCleanup,
} = require(
  "../server/image-to-video-maintenance.cjs"
);

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}

function touchOld(
  target,
  millisecondsAgo
) {
  const when =
    new Date(
      Date.now() -
      millisecondsAgo
    );

  fs.utimesSync(
    target,
    when,
    when
  );
}

function main() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-i2v-phase2-"
      )
    );

  try {
    const cacheDir =
      path.join(
        root,
        "app",
        "cache",
        "image-to-video"
      );

    const outputDir =
      path.join(
        root,
        "app",
        "outputs",
        "video"
      );

    fs.mkdirSync(
      cacheDir,
      {
        recursive: true,
      }
    );

    fs.mkdirSync(
      outputDir,
      {
        recursive: true,
      }
    );

    const activeCache =
      path.join(
        cacheDir,
        "active-job.png"
      );

    const terminalCache =
      path.join(
        cacheDir,
        "terminal-job.png"
      );

    const orphanCache =
      path.join(
        cacheDir,
        "orphan-job.png"
      );

    const recentOrphan =
      path.join(
        cacheDir,
        "recent-orphan.png"
      );

    const referencedOutput =
      path.join(
        outputDir,
        "retained.mp4"
      );

    const orphanOutput =
      path.join(
        outputDir,
        "orphan.mp4"
      );

    for (
      const file of [
        activeCache,
        terminalCache,
        orphanCache,
        recentOrphan,
        referencedOutput,
        orphanOutput,
      ]
    ) {
      fs.writeFileSync(
        file,
        "test"
      );
    }

    const eightDays =
      8 * 24 * 60 * 60 * 1000;

    const twoDays =
      2 * 24 * 60 * 60 * 1000;

    touchOld(
      terminalCache,
      twoDays
    );

    touchOld(
      orphanCache,
      eightDays
    );

    touchOld(
      referencedOutput,
      eightDays
    );

    touchOld(
      orphanOutput,
      eightDays
    );

    const jobs = [
      {
        id:
          "active-job",

        state:
          "running",

        output: null,
      },

      {
        id:
          "terminal-job",

        state:
          "completed",

        output: null,
      },

      {
        id:
          "retained-output",

        state:
          "completed",

        output: {
          output:
            "app/outputs/video/retained.mp4",
        },
      },
    ];

    const plan =
      planImageToVideoCleanup({
        root,
        jobs,
      });

    const removePaths =
      new Set(
        plan.remove.map(
          (item) =>
            path.normalize(
              item.path
            )
        )
      );

    assert(
      !removePaths.has(
        path.normalize(
          activeCache
        )
      ),
      "Active job cache must never be removed."
    );

    assert(
      removePaths.has(
        path.normalize(
          terminalCache
        )
      ),
      "Expired terminal cache should be removable."
    );

    assert(
      removePaths.has(
        path.normalize(
          orphanCache
        )
      ),
      "Expired orphan cache should be removable."
    );

    assert(
      !removePaths.has(
        path.normalize(
          recentOrphan
        )
      ),
      "Recent orphan cache must be preserved."
    );

    assert(
      !removePaths.has(
        path.normalize(
          referencedOutput
        )
      ),
      "Output referenced by retained history must never be deleted."
    );

    assert(
      removePaths.has(
        path.normalize(
          orphanOutput
        )
      ),
      "Expired unreferenced output should be removable."
    );

    const applied =
      applyImageToVideoCleanup(
        plan
      );

    assert(
      applied.removedCount >= 3,
      "Expected cleanup actions were not applied."
    );

    assert(
      fs.existsSync(
        activeCache
      ),
      "Active cache disappeared."
    );

    assert(
      fs.existsSync(
        referencedOutput
      ),
      "Referenced output disappeared."
    );

    assert(
      !fs.existsSync(
        orphanOutput
      ),
      "Expired orphan output still exists."
    );

    const statePath =
      path.join(
        root,
        "jobs.json"
      );

    const oldDate =
      new Date(
        Date.now() -
        10 * 24 * 60 * 60 * 1000
      ).toISOString();

    const recentDate =
      new Date()
        .toISOString();

    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: recentDate,
          jobs: [
            {
              id: "old-terminal",
              state: "completed",
              createdAt: oldDate,
              updatedAt: oldDate,
              finishedAt: oldDate,
            },
            {
              id: "recent-terminal",
              state: "completed",
              createdAt: recentDate,
              updatedAt: recentDate,
              finishedAt: recentDate,
            },
            {
              id: "restart-running",
              state: "running",
              createdAt: recentDate,
              updatedAt: recentDate,
              startedAt: recentDate,
              finishedAt: null,
              pid: 99999,
            },
          ],
        },
        null,
        2
      )
    );

    const manager =
      new ImageToVideoJobManager({
        statePath,
        maxHistory: 20,
        terminalRetentionMs:
          7 * 24 * 60 * 60 * 1000,
      });

    const recovered =
      manager.getJob(
        "restart-running"
      );

    assert(
      recovered.state ===
        "failed",
      "Interrupted running job must recover as failed."
    );

    assert(
      recovered.recovery
        ?.previousState ===
        "running",
      "Previous restart state metadata missing."
    );

    assert(
      recovered.recovery
        ?.reason ===
        "APPLICATION_RESTART",
      "Restart recovery reason missing."
    );

    assert(
      recovered.recovery
        ?.resumable ===
        false,
      "Interrupted process must not be marked resumable."
    );

    manager.saveState();

    assert(
      manager.getJob(
        "old-terminal"
      ) === null,
      "Expired terminal history must be pruned."
    );

    assert(
      manager.getJob(
        "recent-terminal"
      ) !== null,
      "Recent terminal history must be preserved."
    );

    assert(
      manager.getJob(
        "restart-running"
      ) !== null,
      "Recovered recent job must be preserved."
    );

    console.log(
      "PASS: Active Image-to-Video cache is always preserved."
    );

    console.log(
      "PASS: Expired terminal and orphan cache can be safely cleaned."
    );

    console.log(
      "PASS: Outputs referenced by retained history are never deleted."
    );

    console.log(
      "PASS: Expired unreferenced outputs can be cleaned."
    );

    console.log(
      "PASS: Recent orphan files are preserved by grace period."
    );

    console.log(
      "PASS: Terminal history retention removes expired records only."
    );

    console.log(
      "PASS: Restart recovery records previous state and recovery reason."
    );

    console.log(
      "PASS: Image-to-Video Production Hardening Phase 2A validation completed."
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
