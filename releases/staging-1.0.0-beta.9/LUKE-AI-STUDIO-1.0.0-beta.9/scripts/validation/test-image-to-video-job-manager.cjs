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

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      message
    );
  }
}

function createFakeProcess(
  pid = 12345
) {
  return {
    pid,
    signals: [],

    kill(signal) {
      this.signals.push(
        signal
      );

      return true;
    },
  };
}

function main() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-i2v-job-"
      )
    );

  const statePath =
    path.join(
      root,
      "jobs.json"
    );

  try {
    const manager =
      new ImageToVideoJobManager({
        statePath,
        maxHistory: 20,
      });

    const job =
      manager.createJob({
        payload: {
          modelId:
            "auto",

          imageDataUrl:
            "data:image/png;base64,test",

          automatic:
            true,
        },
      });

    assert(
      job.state ===
        "queued",
      "New job must be queued."
    );

    assert(
      job.progress.percent ===
        0,
      "Queued progress must start at 0."
    );

    const child =
      createFakeProcess();

    const running =
      manager.startJob(
        job.id,
        child
      );

    assert(
      running.state ===
        "running",
      "Job must become running."
    );

    assert(
      running.pid ===
        12345,
      "Owned PID must be exposed."
    );

    const progressed =
      manager.updateProgress(
        job.id,
        {
          percent: 44,
          step: 11,
          total: 25,
          message:
            "Inference 11/25",
        }
      );

    assert(
      progressed.progress
        .percent === 44,
      "Progress percent mismatch."
    );

    const cancelling =
      manager.cancelJob(
        job.id
      );

    assert(
      cancelling.state ===
        "cancelling",
      "Running job must enter cancelling state."
    );

    assert(
      child.signals.length ===
        1 &&
      child.signals[0] ===
        "SIGTERM",
      "Cancellation must send SIGTERM to owned process."
    );

    const cancelled =
      manager.confirmCancelled(
        job.id
      );

    assert(
      cancelled.state ===
        "cancelled",
      "Job must become cancelled."
    );

    assert(
      manager.getSummary()
        .activeProcesses ===
        0,
      "Cancelled process must leave active map."
    );

    const retry =
      manager.retryJob(
        job.id
      );

    assert(
      retry.id !== job.id,
      "Retry must create a new job."
    );

    assert(
      retry.retryOf ===
        job.id,
      "Retry parent missing."
    );

    assert(
      retry.state ===
        "queued",
      "Retry must start queued."
    );

    const fake2 =
      createFakeProcess(
        67890
      );

    manager.startJob(
      retry.id,
      fake2
    );

    const completed =
      manager.completeJob(
        retry.id,
        {
          videoUrl:
            "/outputs/test.mp4",
        }
      );

    assert(
      completed.state ===
        "completed",
      "Job must complete."
    );

    assert(
      completed.progress
        .percent === 100,
      "Completed job must report 100%."
    );

    assert(
      completed.output
        .videoUrl ===
        "/outputs/test.mp4",
      "Output metadata missing."
    );

    const failedJob =
      manager.createJob({
        payload: {
          modelId:
            "svd",
        },
      });

    manager.startJob(
      failedJob.id,
      createFakeProcess(
        22222
      )
    );

    const failed =
      manager.failJob(
        failedJob.id,
        new Error(
          "Synthetic failure"
        )
      );

    assert(
      failed.state ===
        "failed",
      "Failure state mismatch."
    );

    assert(
      failed.error
        .message ===
        "Synthetic failure",
      "Failure message mismatch."
    );

    const queued =
      manager.createJob({
        payload: {
          modelId:
            "svd",
        },
      });

    const queuedCancelled =
      manager.cancelJob(
        queued.id
      );

    assert(
      queuedCancelled.state ===
        "cancelled",
      "Queued cancellation failed."
    );

    const persisted =
      JSON.parse(
        fs.readFileSync(
          statePath,
          "utf8"
        )
      );

    assert(
      Array.isArray(
        persisted.jobs
      ),
      "Persistent history missing."
    );

    assert(
      !JSON.stringify(
        persisted
      ).includes(
        '"signals"'
      ),
      "Process object leaked into persistent state."
    );

    assert(
      manager
        .listJobs({
          limit: 2,
        })
        .length === 2,
      "History limit failed."
    );

    const summary =
      manager.getSummary();

    assert(
      summary.safety
        .cancelOnlyOwnedProcess ===
        true,
      "Owned-process safety missing."
    );

    assert(
      summary.safety
        .retryCreatesNewJob ===
        true,
      "Retry safety missing."
    );

    const restartState =
      {
        schemaVersion: 1,
        updatedAt: null,
        jobs: [
          {
            id:
              "restart-test",

            type:
              "image-to-video",

            state:
              "running",

            progress: {
              percent: 50,
            },

            payload: {},

            retryOf: null,

            pid: 99999,

            output: null,

            error: null,

            createdAt:
              new Date()
                .toISOString(),

            updatedAt:
              new Date()
                .toISOString(),

            startedAt:
              new Date()
                .toISOString(),

            finishedAt: null,

            cancelledAt: null,
          },
        ],
      };

    fs.writeFileSync(
      statePath,
      JSON.stringify(
        restartState,
        null,
        2
      )
    );

    const restarted =
      new ImageToVideoJobManager({
        statePath,
      });

    const recovered =
      restarted.getJob(
        "restart-test"
      );

    assert(
      recovered.state ===
        "failed",
      "Interrupted job must fail after restart."
    );

    assert(
      recovered.error
        .code ===
        "PROCESS_INTERRUPTED",
      "Restart recovery code missing."
    );

    console.log(
      "PASS: queued -> running -> cancelling -> cancelled lifecycle."
    );

    console.log(
      "PASS: completed and failed terminal states."
    );

    console.log(
      "PASS: Progress persists independently of process objects."
    );

    console.log(
      "PASS: Cancel sends SIGTERM only through the owned child-process handle."
    );

    console.log(
      "PASS: Retry creates a new queued job and preserves retryOf."
    );

    console.log(
      "PASS: Persistent history does not serialize child-process objects."
    );

    console.log(
      "PASS: Running jobs recover safely as failed after application restart."
    );

    console.log(
      "PASS: Production Image-to-Video Job Manager validation completed."
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
