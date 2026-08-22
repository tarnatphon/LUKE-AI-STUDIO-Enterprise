"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  spawn,
} = require(
  "node:child_process"
);

const MIN_INFERENCE_TOTAL = 20;

function clampProgress(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      99,
      number
    )
  );
}

function parseProgressChunk(
  chunk
) {
  const text =
    String(
      chunk || ""
    )
      .replace(
        /\r/g,
        "\n"
      );

  let best = null;

  const ratioPattern =
    /(?:^|\s)(\d{1,4})\s*\/\s*(\d{1,4})(?:\s|$|\[)/g;

  for (
    const match of
    text.matchAll(
      ratioPattern
    )
  ) {
    const step =
      Number(
        match[1]
      );

    const total =
      Number(
        match[2]
      );

    if (
      total <
        MIN_INFERENCE_TOTAL ||
      step < 0 ||
      step > total
    ) {
      continue;
    }

    const percent =
      clampProgress(
        (
          step /
          total
        ) *
          100
      );

    if (
      percent !== null &&
      (
        best === null ||
        percent >
          best.percent
      )
    ) {
      best = {
        percent,
        step,
        total,
        message:
          `Inference ${step}/${total}`,
      };
    }
  }

  return best;
}

function parseWorkerResult(
  stdout
) {
  const lines =
    String(
      stdout || ""
    )
      .split(
        /\r?\n/
      )
      .map(
        (line) =>
          line.trim()
      )
      .filter(Boolean);

  for (
    let index =
      lines.length - 1;
    index >= 0;
    index -= 1
  ) {
    const line =
      lines[index];

    if (
      !line.startsWith(
        "{"
      )
    ) {
      continue;
    }

    try {
      const parsed =
        JSON.parse(line);

      if (
        parsed &&
        typeof parsed ===
          "object"
      ) {
        return parsed;
      }
    } catch {
    }
  }

  return null;
}

class ImageToVideoProcessRunner {
  constructor({
    root,
    jobManager,
    spawnImpl = spawn,
    runtimePython = null,
    workerPath = null,
    maxConcurrent = 1,
  }) {
    if (!root) {
      throw new Error(
        "root is required"
      );
    }

    if (!jobManager) {
      throw new Error(
        "jobManager is required"
      );
    }

    this.root =
      path.resolve(root);

    this.jobManager =
      jobManager;

    this.spawnImpl =
      spawnImpl;

    this.runtimePython =
      runtimePython ||
      path.join(
        this.root,
        "app",
        "runtimes",
        "image-to-video",
        "venv",
        "bin",
        "python"
      );

    this.workerPath =
      workerPath ||
      path.join(
        this.root,
        "scripts",
        "workers",
        "image_to_video_worker.py"
      );

    // LUKE_AI_I2V_DURATION_WORKER_CONTRACT_V1
    this.durationWorkerPath =
      path.join(
        this.root,
        "scripts",
        "workers",
        "image_to_video_duration_worker.py"
      );

    this.maxConcurrent =
      Math.max(
        1,
        Number(
          maxConcurrent
        ) ||
        1
      );

    this.pendingQueue = [];

    this.runningJobIds =
      new Set();
  }

  assertRuntime() {
    if (
      !fs.existsSync(
        this.runtimePython
      )
    ) {
      throw new Error(
        "Image-to-Video runtime Python is missing."
      );
    }

    if (
      !fs.existsSync(
        this.workerPath
      )
    ) {
      throw new Error(
        "Image-to-Video worker is missing."
      );
    }
  }

  buildEnvironment() {
    return {
      ...process.env,

      HF_HUB_OFFLINE:
        "1",

      TRANSFORMERS_OFFLINE:
        "1",

      HF_HUB_DISABLE_XET:
        "1",

      TOKENIZERS_PARALLELISM:
        "false",

      PYTHONUNBUFFERED:
        "1",
    };
  }

  // LUKE_AI_I2V_DURATION_WORKER_SELECTOR_V1
  getRequestedSeconds(
    args
  ) {
    const index =
      Array.isArray(args)
        ? args.indexOf(
            "--seconds"
          )
        : -1;

    if (
      index < 0 ||
      index + 1 >=
        args.length
    ) {
      return 5;
    }

    const value =
      Number(
        args[
          index + 1
        ]
      );

    return Number.isFinite(
      value
    )
      ? value
      : 5;
  }

  selectWorkerPath(
    args
  ) {
    const seconds =
      this.getRequestedSeconds(
        args
      );

    if (
      seconds > 5
    ) {
      if (
        !fs.existsSync(
          this.durationWorkerPath
        )
      ) {
        throw new Error(
          "Image-to-Video duration worker is missing."
        );
      }

      return (
        this.durationWorkerPath
      );
    }

    return this.workerPath;
  }

  startPreparedJob(
    jobId,
    {
      args,
      cwd = this.root,
      output = null,
    }
  ) {
    this.assertRuntime();

    if (
      !Array.isArray(
        args
      ) ||
      args.length === 0
    ) {
      throw new Error(
        "Prepared worker arguments are required."
      );
    }

    const current =
      this.jobManager
        .getJob(
          jobId
        );

    if (!current) {
      throw new Error(
        `Image-to-Video job not found: ${jobId}`
      );
    }

    if (
      current.state !==
      "queued"
    ) {
      throw new Error(
        `Job ${jobId} must be queued before execution.`
      );
    }

    const selectedWorkerPath =
      this.selectWorkerPath(
        args
      );

    this.pendingQueue.push({
      jobId,
      args:
        args.slice(),
      cwd,

      workerPath:
        selectedWorkerPath,

      output:
        output
          ? {
              ...output,
            }
          : null,
    });

    this.drainQueue();

    return {
      job:
        this.jobManager
          .getJob(
            jobId
          ),

      pid:
        this.jobManager
          .getJob(
            jobId
          )
          ?.pid ||
        null,

      queue:
        this.getQueueSummary(),
    };
  }

  // LUKE_AI_I2V_BATCH_PAUSE_RUNNER_V1
  drainQueue() {
    if (
      this.runningJobIds
        .size >=
      this.maxConcurrent
    ) {
      return;
    }

    const scanLimit =
      this.pendingQueue
        .length;

    let scanned = 0;

    while (
      this.runningJobIds
        .size <
        this.maxConcurrent &&
      this.pendingQueue
        .length > 0 &&
      scanned <
        scanLimit
    ) {
      const task =
        this.pendingQueue
          .shift();

      scanned += 1;

      const latest =
        this.jobManager
          .getJob(
            task.jobId
          );

      if (!latest) {
        continue;
      }

      if (
        latest.state ===
        "paused"
      ) {
        this.pendingQueue
          .push(task);

        continue;
      }

      if (
        latest.state !==
        "queued"
      ) {
        continue;
      }

      this.spawnTask(
        task
      );
    }
  }

  spawnTask(
    task
  ) {
    const child =
      this.spawnImpl(
        this.runtimePython,
        [
          "-u",
          task.workerPath ||
          this.workerPath,
          ...task.args,
        ],
        {
          cwd:
            task.cwd,

          env:
            this.buildEnvironment(),

          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

    this.jobManager
      .startJob(
        task.jobId,
        child
      );

    this.runningJobIds.add(
      task.jobId
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settleOnce =
      (callback) => {
        if (settled) {
          return;
        }

        settled = true;

        this.runningJobIds.delete(
          task.jobId
        );

        callback();

        this.drainQueue();
      };

    if (
      child.stdout &&
      typeof child.stdout.on ===
        "function"
    ) {
      child.stdout.on(
        "data",
        (chunk) => {
          const text =
            String(chunk);

          stdout += text;

          const progress =
            parseProgressChunk(
              text
            );

          if (progress) {
            this.jobManager
              .updateProgress(
                task.jobId,
                progress
              );
          }
        }
      );
    }

    if (
      child.stderr &&
      typeof child.stderr.on ===
        "function"
    ) {
      child.stderr.on(
        "data",
        (chunk) => {
          const text =
            String(chunk);

          stderr += text;

          const progress =
            parseProgressChunk(
              text
            );

          if (progress) {
            this.jobManager
              .updateProgress(
                task.jobId,
                progress
              );
          }
        }
      );
    }

    child.on(
      "error",
      (error) => {
        settleOnce(
          () => {
            this.jobManager
              .failJob(
                task.jobId,
                {
                  code:
                    "PROCESS_START_FAILED",

                  message:
                    error instanceof Error
                      ? error.message
                      : String(error),
                }
              );
          }
        );
      }
    );

    child.on(
      "close",
      (
        code,
        signal
      ) => {
        settleOnce(
          () => {
            const latest =
              this.jobManager
                .getJob(
                  task.jobId
                );

            if (
              latest?.state ===
              "cancelling"
            ) {
              this.jobManager
                .confirmCancelled(
                  task.jobId
                );

              return;
            }

            const result =
              parseWorkerResult(
                stdout
              );

            if (
              code === 0 &&
              result?.ok ===
                true
            ) {
              this.jobManager
                .completeJob(
                  task.jobId,
                  {
                    ...(task.output ||
                      {}),

                    worker:
                      result,
                  }
                );

              return;
            }

            const workerError =
              result?.error ||
              stderr
                .trim()
                .slice(
                  -4000
                ) ||
              stdout
                .trim()
                .slice(
                  -4000
                ) ||
              `Worker exited with code ${code}`;

            this.jobManager
              .failJob(
                task.jobId,
                {
                  code:
                    signal
                      ? "PROCESS_SIGNALLED"
                      : "GENERATION_FAILED",

                  message:
                    signal
                      ? `${workerError} (signal ${signal})`
                      : workerError,
                }
              );
          }
        );
      }
    );
  }

  getQueueSummary() {
    return {
      maxConcurrent:
        this.maxConcurrent,

      running:
        this.runningJobIds
          .size,

      queued:
        this.pendingQueue
          .filter(
            (task) => {
              const job =
                this.jobManager
                  .getJob(
                    task.jobId
                  );

              return (
                job?.state ===
                "queued"
              );
            }
          )
          .length,
    };
  }
}

module.exports = {
  ImageToVideoProcessRunner,
  parseProgressChunk,
  parseWorkerResult,
};
