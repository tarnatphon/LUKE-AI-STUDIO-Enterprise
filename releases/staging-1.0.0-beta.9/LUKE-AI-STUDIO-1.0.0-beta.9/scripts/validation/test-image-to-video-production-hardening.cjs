#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  EventEmitter,
} = require(
  "node:events"
);

const {
  PassThrough,
} = require(
  "node:stream"
);

const {
  ImageToVideoJobManager,
} = require(
  "../server/image-to-video-job-manager.cjs"
);

const {
  ImageToVideoProcessRunner,
  parseProgressChunk,
} = require(
  "../server/image-to-video-process-runner.cjs"
);

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}

function fakeSpawnFactory() {
  const children = [];

  function fakeSpawn() {
    const child =
      new EventEmitter();

    child.pid =
      50000 +
      children.length;

    child.stdout =
      new PassThrough();

    child.stderr =
      new PassThrough();

    child.killCalls = [];

    child.kill =
      function kill(
        signal
      ) {
        this.killCalls.push(
          signal
        );

        setImmediate(
          () => {
            this.emit(
              "close",
              null,
              signal
            );
          }
        );

        return true;
      };

    children.push(child);

    return child;
  }

  return {
    fakeSpawn,
    children,
  };
}

async function tick() {
  await new Promise(
    (resolve) =>
      setImmediate(resolve)
  );
}

async function main() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-i2v-hardening-"
      )
    );

  try {
    const runtimePython =
      path.join(
        root,
        "python"
      );

    const workerPath =
      path.join(
        root,
        "worker.py"
      );

    fs.writeFileSync(
      runtimePython,
      ""
    );

    fs.writeFileSync(
      workerPath,
      ""
    );

    const manager =
      new ImageToVideoJobManager({
        statePath:
          path.join(
            root,
            "jobs.json"
          ),
      });

    const {
      fakeSpawn,
      children,
    } =
      fakeSpawnFactory();

    const runner =
      new ImageToVideoProcessRunner({
        root,
        jobManager:
          manager,
        spawnImpl:
          fakeSpawn,
        runtimePython,
        workerPath,
        maxConcurrent: 1,
      });

    const job1 =
      manager.createJob({
        payload: {
          modelId: "svd",
        },
      });

    const job2 =
      manager.createJob({
        payload: {
          modelId: "svd",
        },
      });

    runner.startPreparedJob(
      job1.id,
      {
        args: [
          "--model",
          "svd",
        ],
      }
    );

    runner.startPreparedJob(
      job2.id,
      {
        args: [
          "--model",
          "svd",
        ],
      }
    );

    assert(
      children.length === 1,
      "Concurrency=1 must spawn only the first worker."
    );

    assert(
      manager.getJob(
        job1.id
      ).state ===
        "running",
      "First job must be running."
    );

    assert(
      manager.getJob(
        job2.id
      ).state ===
        "queued",
      "Second job must remain queued."
    );

    const summary1 =
      runner.getQueueSummary();

    assert(
      summary1.running === 1,
      "Expected exactly one running worker."
    );

    assert(
      summary1.queued === 1,
      "Expected one queued worker."
    );

    manager.updateProgress(
      job1.id,
      {
        percent: 80,
        step: 20,
        total: 25,
      }
    );

    manager.updateProgress(
      job1.id,
      {
        percent: 4,
        step: 1,
        total: 25,
      }
    );

    const monotonic =
      manager.getJob(
        job1.id
      );

    assert(
      monotonic
        .progress
        .percent === 80,
      "Progress must never decrease."
    );

    assert(
      monotonic
        .progress
        .step === 20,
      "Progress step must never decrease."
    );

    const ignoredLoader =
      parseProgressChunk(
        "100%|██████████| 5/5"
      );

    assert(
      ignoredLoader === null,
      "Small model-loader progress must not be treated as inference progress."
    );

    const inference =
      parseProgressChunk(
        "44%|████ 11/25 [00:01<00:02]"
      );

    assert(
      inference !== null,
      "Inference progress must be detected."
    );

    assert(
      inference.step === 11 &&
      inference.total === 25,
      "Inference step/total mismatch."
    );

    children[0]
      .stdout
      .write(
        '{"ok":true,"output":"/tmp/one.mp4"}\n'
      );

    children[0]
      .emit(
        "close",
        0,
        null
      );

    await tick();

    assert(
      children.length === 2,
      "Second job must start only after first job settles."
    );

    assert(
      manager.getJob(
        job1.id
      ).state ===
        "completed",
      "First job must complete."
    );

    assert(
      manager.getJob(
        job2.id
      ).state ===
        "running",
      "Second queued job must automatically start."
    );

    const job3 =
      manager.createJob({
        payload: {
          modelId: "svd",
        },
      });

    runner.startPreparedJob(
      job3.id,
      {
        args: [
          "--model",
          "svd",
        ],
      }
    );

    assert(
      manager.getJob(
        job3.id
      ).state ===
        "queued",
      "Third job must queue while second is running."
    );

    manager.cancelJob(
      job3.id
    );

    assert(
      manager.getJob(
        job3.id
      ).state ===
        "cancelled",
      "Queued job must be cancellable."
    );

    children[1]
      .stdout
      .write(
        '{"ok":true,"output":"/tmp/two.mp4"}\n'
      );

    children[1]
      .emit(
        "close",
        0,
        null
      );

    await tick();

    assert(
      children.length === 2,
      "Cancelled queued job must never spawn."
    );

    const finalSummary =
      runner.getQueueSummary();

    assert(
      finalSummary.running === 0,
      "No workers should remain running."
    );

    assert(
      finalSummary.queued === 0,
      "No jobs should remain queued."
    );

    console.log(
      "PASS: Image-to-Video concurrency is limited to exactly one worker."
    );

    console.log(
      "PASS: Additional jobs remain queued until the active worker settles."
    );

    console.log(
      "PASS: Queued jobs automatically start in FIFO order."
    );

    console.log(
      "PASS: Cancelled queued jobs never spawn a worker."
    );

    console.log(
      "PASS: Job progress is monotonic and never decreases."
    );

    console.log(
      "PASS: Small model-loading tqdm bars are ignored."
    );

    console.log(
      "PASS: Real inference 25-step progress is detected."
    );

    console.log(
      "PASS: Image-to-Video Production Hardening Phase 1 validation completed."
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

main().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.stack ||
          error.message
        : String(error)
    );

    process.exit(1);
  }
);
