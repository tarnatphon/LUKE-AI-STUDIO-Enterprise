#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EventEmitter,
} = require("node:events");
const {
  PassThrough,
} = require("node:stream");

const {
  ImageToVideoJobManager,
} = require(
  "../server/image-to-video-job-manager.cjs"
);

const {
  ImageToVideoProcessRunner,
  parseProgressChunk,
  parseWorkerResult,
} = require(
  "../server/image-to-video-process-runner.cjs"
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

function fakeSpawnFactory() {
  const created = [];

  function fakeSpawn(
    command,
    args,
    options
  ) {
    const child =
      new EventEmitter();

    child.pid =
      45678;

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

    created.push({
      command,
      args,
      options,
      child,
    });

    return child;
  }

  return {
    fakeSpawn,
    created,
  };
}

async function tick() {
  await new Promise(
    (resolve) =>
      setImmediate(
        resolve
      )
  );
}

async function main() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "luke-i2v-runner-"
      )
    );

  try {
    const runtimePython =
      path.join(
        root,
        "runtime-python"
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
      created,
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
      });

    const parsed =
      parseProgressChunk(
        " 44%|████ 11/25 [00:01<00:01]"
      );

    assert(
      parsed !== null,
      "Progress parser returned null."
    );

    assert(
      parsed.step === 11,
      "Progress step mismatch."
    );

    assert(
      parsed.total === 25,
      "Progress total mismatch."
    );

    assert(
      Math.round(
        parsed.percent
      ) === 44,
      "Progress percentage mismatch."
    );

    const result =
      parseWorkerResult(
        'noise\n{"ok":true,"output":"/tmp/video.mp4"}\n'
      );

    assert(
      result?.ok === true,
      "Worker JSON result parser failed."
    );

    const job =
      manager.createJob({
        payload: {
          modelId:
            "svd",
        },
      });

    runner.startPreparedJob(
      job.id,
      {
        args: [
          "--model",
          "svd",
          "--image",
          "/tmp/input.png",
          "--output",
          "/tmp/output.mp4",
        ],

        output: {
          videoUrl:
            "/outputs/video/test.mp4",
        },
      }
    );

    assert(
      created.length === 1,
      "Worker process was not spawned exactly once."
    );

    assert(
      created[0]
        .args[0] ===
        "-u",
      "Worker must run unbuffered."
    );

    assert(
      created[0]
        .options
        .env
        .HF_HUB_OFFLINE ===
        "1",
      "HF offline mode missing."
    );

    assert(
      created[0]
        .options
        .env
        .TRANSFORMERS_OFFLINE ===
        "1",
      "Transformers offline mode missing."
    );

    assert(
      manager.getJob(
        job.id
      ).state ===
        "running",
      "Job did not enter running state."
    );

    created[0]
      .child
      .stderr
      .write(
        " 40%|████ 10/25 [00:01<00:02]\r"
      );

    await tick();

    const progressed =
      manager.getJob(
        job.id
      );

    assert(
      progressed
        .progress
        .step === 10,
      "stderr progress was not captured."
    );

    created[0]
      .child
      .stdout
      .write(
        '{"ok":true,"output":"/tmp/output.mp4","referencesUsed":0}\n'
      );

    created[0]
      .child
      .emit(
        "close",
        0,
        null
      );

    await tick();

    const completed =
      manager.getJob(
        job.id
      );

    assert(
      completed.state ===
        "completed",
      "Successful worker did not complete job."
    );

    assert(
      completed
        .progress
        .percent === 100,
      "Completed job is not 100%."
    );

    assert(
      completed
        .output
        .videoUrl ===
        "/outputs/video/test.mp4",
      "Output metadata missing."
    );

    const cancelJob =
      manager.createJob({
        payload: {
          modelId:
            "svd",
        },
      });

    runner.startPreparedJob(
      cancelJob.id,
      {
        args: [
          "--model",
          "svd",
        ],
      }
    );

    const second =
      created[1];

    manager.cancelJob(
      cancelJob.id
    );

    assert(
      second
        .child
        .killCalls[0] ===
        "SIGTERM",
      "Cancellation did not signal owned process with SIGTERM."
    );

    await tick();

    assert(
      manager.getJob(
        cancelJob.id
      ).state ===
        "cancelled",
      "Runner did not confirm cancellation after process close."
    );

    const failureJob =
      manager.createJob({
        payload: {
          modelId:
            "svd",
        },
      });

    runner.startPreparedJob(
      failureJob.id,
      {
        args: [
          "--model",
          "svd",
        ],
      }
    );

    const third =
      created[2];

    third
      .child
      .stdout
      .write(
        '{"ok":false,"error":"Synthetic worker failure"}\n'
      );

    third
      .child
      .emit(
        "close",
        2,
        null
      );

    await tick();

    const failed =
      manager.getJob(
        failureJob.id
      );

    assert(
      failed.state ===
        "failed",
      "Non-zero worker did not fail job."
    );

    assert(
      failed
        .error
        .message ===
        "Synthetic worker failure",
      "Worker failure message was not preserved."
    );

    console.log(
      "PASS: Worker process runs asynchronously with unbuffered output."
    );

    console.log(
      "PASS: tqdm progress is parsed from stderr."
    );

    console.log(
      "PASS: Final worker JSON is parsed from stdout."
    );

    console.log(
      "PASS: Successful worker transitions job to completed."
    );

    console.log(
      "PASS: Worker failure transitions job to failed."
    );

    console.log(
      "PASS: SIGTERM cancellation is confirmed after owned process closes."
    );

    console.log(
      "PASS: HF and Transformers offline mode are enforced for every job."
    );

    console.log(
      "PASS: Production Image-to-Video Process Runner validation completed."
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
