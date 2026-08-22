"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const TERMINAL_STATES =
  new Set([
    "completed",
    "failed",
    "cancelled",
  ]);

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function defaultState() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    jobs: [],
  };
}

function atomicWriteJson(
  filePath,
  value
) {
  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive: true,
    }
  );

  const temporary =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.renameSync(
    temporary,
    filePath
  );
}

class ImageToVideoJobManager {
  constructor({
    statePath,
    maxHistory = 200,
    cancelGraceMs = 8000,
    terminalRetentionMs =
      90 * 24 * 60 * 60 * 1000,
  }) {
    if (!statePath) {
      throw new Error(
        "statePath is required"
      );
    }

    this.statePath =
      path.resolve(
        statePath
      );

    this.maxHistory =
      Math.max(
        1,
        Number(maxHistory) ||
        200
      );

    this.cancelGraceMs =
      cancelGraceMs;

    // LUKE_AI_I2V_HISTORY_RETENTION_V1
    this.terminalRetentionMs =
      Math.max(
        0,
        Number(
          terminalRetentionMs
        ) ||
        0
      );

    this.activeProcesses =
      new Map();

    this.state =
      this.loadState();

    this.recoverInterruptedJobs();
  }

  loadState() {
    if (
      !fs.existsSync(
        this.statePath
      )
    ) {
      return defaultState();
    }

    try {
      const parsed =
        JSON.parse(
          fs.readFileSync(
            this.statePath,
            "utf8"
          )
        );

      if (
        !parsed ||
        !Array.isArray(
          parsed.jobs
        )
      ) {
        return defaultState();
      }

      return {
        schemaVersion:
          parsed.schemaVersion ||
          1,

        updatedAt:
          parsed.updatedAt ||
          null,

        jobs:
          parsed.jobs,
      };

    } catch {
      return defaultState();
    }
  }

  pruneHistory() {
    const now =
      Date.now();

    const activeJobs = [];
    const retainedTerminalJobs = [];

    for (
      const job of
      this.state.jobs
    ) {
      if (
        !TERMINAL_STATES.has(
          job.state
        )
      ) {
        activeJobs.push(job);
        continue;
      }

      const finishedTime =
        Date.parse(
          job.finishedAt ||
          job.updatedAt ||
          job.createdAt ||
          ""
        );

      const hasValidTime =
        Number.isFinite(
          finishedTime
        );

      const expired =
        this.terminalRetentionMs >
          0 &&
        hasValidTime &&
        (
          now -
          finishedTime
        ) >
          this.terminalRetentionMs;

      if (!expired) {
        retainedTerminalJobs
          .push(job);
      }
    }

    const allowedTerminal =
      retainedTerminalJobs
        .slice(
          -this.maxHistory
        );

    const allowedIds =
      new Set(
        allowedTerminal
          .map(
            (job) =>
              job.id
          )
      );

    this.state.jobs =
      this.state.jobs
        .filter(
          (job) =>
            !TERMINAL_STATES.has(
              job.state
            ) ||
            allowedIds.has(
              job.id
            )
        );

    return {
      active:
        activeJobs.length,

      terminal:
        allowedTerminal.length,

      total:
        this.state.jobs.length,
    };
  }

  saveState() {
    this.state.updatedAt =
      nowIso();

    this.pruneHistory();

    atomicWriteJson(
      this.statePath,
      this.state
    );
  }

  recoverInterruptedJobs() {
    let changed = false;

    for (
      const job of
      this.state.jobs
    ) {
      if (
        job.state ===
          "running" ||
        job.state ===
          "queued" ||
        job.state ===
          "cancelling"
      ) {
        const previousState =
          job.state;

        const recoveredAt =
          nowIso();

        job.state =
          "failed";

        job.error = {
          code:
            "PROCESS_INTERRUPTED",

          message:
            "The application restarted before this job reached a terminal state.",
        };

        // LUKE_AI_I2V_RESTART_RECOVERY_METADATA_V1
        job.recovery = {
          recoveredAt,

          previousState,

          reason:
            "APPLICATION_RESTART",

          resumable:
            false,
        };

        job.pid = null;

        job.finishedAt =
          recoveredAt;

        job.updatedAt =
          recoveredAt;

        changed = true;
      }
    }

    if (changed) {
      this.saveState();
    }

    return {
      changed,

      recovered:
        this.state.jobs
          .filter(
            (job) =>
              job.recovery
                ?.reason ===
              "APPLICATION_RESTART"
          )
          .length,
    };
  }

  createJob({
    payload,
    retryOf = null,
  }) {
    if (
      !payload ||
      typeof payload !==
        "object" ||
      Array.isArray(payload)
    ) {
      throw new Error(
        "A generation payload object is required."
      );
    }

    const createdAt =
      nowIso();

    const job = {
      id:
        crypto.randomUUID(),

      type:
        "image-to-video",

      state:
        "queued",

      progress: {
        percent: 0,
        step: null,
        total: null,
        message:
          "Queued",
      },

      payload:
        clone(payload),

      retryOf,

      pid: null,

      output: null,

      error: null,

      createdAt,

      updatedAt:
        createdAt,

      startedAt: null,

      finishedAt: null,

      cancelledAt: null,
    };

    this.state.jobs.push(
      job
    );

    this.saveState();

    return clone(job);
  }

  startJob(
    jobId,
    processHandle
  ) {
    const job =
      this.requireJob(
        jobId
      );

    if (
      job.state !==
      "queued"
    ) {
      throw new Error(
        `Job ${jobId} is not queued.`
      );
    }

    if (
      !processHandle ||
      typeof processHandle !==
        "object" ||
      typeof processHandle.kill !==
        "function"
    ) {
      throw new Error(
        "A child-process handle with kill() is required."
      );
    }

    job.state =
      "running";

    job.startedAt =
      nowIso();

    job.updatedAt =
      job.startedAt;

    job.pid =
      Number.isInteger(
        processHandle.pid
      )
        ? processHandle.pid
        : null;

    job.progress = {
      percent: 0,
      step: 0,
      total: null,
      message:
        "Starting generation",
    };

    this.activeProcesses.set(
      jobId,
      processHandle
    );

    this.saveState();

    return clone(job);
  }

  // LUKE_AI_I2V_MONOTONIC_PROGRESS_V1
  updateProgress(
    jobId,
    {
      percent,
      step = null,
      total = null,
      message = null,
    }
  ) {
    const job =
      this.requireJob(
        jobId
      );

    if (
      job.state !==
      "running"
    ) {
      return clone(job);
    }

    const numeric =
      Number(percent);

    const previousPercent =
      Number(
        job.progress
          ?.percent ||
        0
      );

    const incomingPercent =
      Number.isFinite(
        numeric
      )
        ? Math.max(
            0,
            Math.min(
              99,
              numeric
            )
          )
        : previousPercent;

    const monotonicPercent =
      Math.max(
        previousPercent,
        incomingPercent
      );

    job.progress = {
      percent:
        monotonicPercent,

      step:
        Number.isFinite(
          Number(step)
        )
          ? Math.max(
              Number(
                job.progress
                  ?.step ||
                0
              ),
              Number(step)
            )
          : job.progress
              ?.step ??
            null,

      total:
        Number.isFinite(
          Number(total)
        )
          ? Number(total)
          : job.progress
              ?.total ??
            null,

      message:
        message ||
        job.progress
          ?.message ||
        "Generating",
    };

    job.updatedAt =
      nowIso();

    this.saveState();

    return clone(job);
  }

  completeJob(
    jobId,
    output
  ) {
    const job =
      this.requireJob(
        jobId
      );

    if (
      TERMINAL_STATES.has(
        job.state
      )
    ) {
      return clone(job);
    }

    const finishedAt =
      nowIso();

    job.state =
      "completed";

    job.progress = {
      percent: 100,
      step:
        job.progress
          ?.total ??
        job.progress
          ?.step ??
        null,

      total:
        job.progress
          ?.total ??
        null,

      message:
        "Completed",
    };

    job.output =
      output
        ? clone(output)
        : null;

    job.error = null;

    job.pid = null;

    job.finishedAt =
      finishedAt;

    job.updatedAt =
      finishedAt;

    this.activeProcesses.delete(
      jobId
    );

    this.saveState();

    return clone(job);
  }

  failJob(
    jobId,
    error
  ) {
    const job =
      this.requireJob(
        jobId
      );

    if (
      TERMINAL_STATES.has(
        job.state
      )
    ) {
      return clone(job);
    }

    const finishedAt =
      nowIso();

    job.state =
      "failed";

    job.error = {
      code:
        error?.code ||
        "GENERATION_FAILED",

      message:
        error?.message ||
        String(
          error ||
          "Image-to-Video generation failed."
        ),
    };

    job.pid = null;

    job.finishedAt =
      finishedAt;

    job.updatedAt =
      finishedAt;

    this.activeProcesses.delete(
      jobId
    );

    this.saveState();

    return clone(job);
  }

  // LUKE_AI_I2V_BATCH_PAUSE_STATE_V1
  pauseJob(jobId) {
    const job =
      this.requireJob(jobId);

    if (
      job.state !== "queued"
    ) {
      return clone(job);
    }

    job.state =
      "paused";

    job.updatedAt =
      nowIso();

    job.progress = {
      ...(job.progress || {}),
      message:
        "Paused",
    };

    this.saveState();

    return clone(job);
  }

  resumeJob(jobId) {
    const job =
      this.requireJob(jobId);

    if (
      job.state !== "paused"
    ) {
      return clone(job);
    }

    job.state =
      "queued";

    job.updatedAt =
      nowIso();

    job.progress = {
      ...(job.progress || {}),
      message:
        "Queued",
    };

    this.saveState();

    return clone(job);
  }

  skipJob(jobId) {
    const job =
      this.requireJob(jobId);

    if (
      ![
        "queued",
        "paused",
      ].includes(
        job.state
      )
    ) {
      return clone(job);
    }

    const timestamp =
      nowIso();

    job.state =
      "cancelled";

    job.pid = null;

    job.finishedAt =
      timestamp;

    job.updatedAt =
      timestamp;

    job.error = {
      code:
        "BATCH_SKIPPED",

      message:
        "Skipped by Batch control.",
    };

    job.progress = {
      ...(job.progress || {}),
      message:
        "Skipped",
    };

    this.saveState();

    return clone(job);
  }

  getBatchJobs(batchId) {
    const value =
      String(batchId || "");

    return this.state.jobs
      .filter(
        (job) =>
          job?.payload
            ?.batchId ===
          value
      )
      .map(clone);
  }

  pauseBatch(batchId) {
    const jobs =
      this.getBatchJobs(
        batchId
      );

    let paused = 0;

    for (const job of jobs) {
      if (
        job.state ===
        "queued"
      ) {
        this.pauseJob(
          job.id
        );

        paused += 1;
      }
    }

    return {
      batchId,
      paused,
      jobs:
        this.getBatchJobs(
          batchId
        ),
    };
  }

  resumeBatch(batchId) {
    const jobs =
      this.getBatchJobs(
        batchId
      );

    let resumed = 0;

    for (const job of jobs) {
      if (
        job.state ===
        "paused"
      ) {
        this.resumeJob(
          job.id
        );

        resumed += 1;
      }
    }

    return {
      batchId,
      resumed,
      jobs:
        this.getBatchJobs(
          batchId
        ),
    };
  }


  cancelJob(
    jobId
  ) {
    const job =
      this.requireJob(
        jobId
      );

    if (
      job.state ===
      "cancelled"
    ) {
      return clone(job);
    }

    if (
      TERMINAL_STATES.has(
        job.state
      )
    ) {
      throw new Error(
        `Job ${jobId} is already ${job.state}.`
      );
    }

    if (
      job.state ===
      "queued"
    ) {
      const cancelledAt =
        nowIso();

      job.state =
        "cancelled";

      job.cancelledAt =
        cancelledAt;

      job.finishedAt =
        cancelledAt;

      job.updatedAt =
        cancelledAt;

      job.pid = null;

      job.progress = {
        ...job.progress,
        message:
          "Cancelled before start",
      };

      this.saveState();

      return clone(job);
    }

    const child =
      this.activeProcesses.get(
        jobId
      );

    if (!child) {
      throw new Error(
        "The running process is not owned by this Job Manager instance."
      );
    }

    job.state =
      "cancelling";

    job.updatedAt =
      nowIso();

    job.progress = {
      ...job.progress,
      message:
        "Cancelling",
    };

    this.saveState();

    let signalled = false;

    try {
      signalled =
        child.kill(
          "SIGTERM"
        ) !== false;

    } catch (error) {
      job.state =
        "running";

      job.updatedAt =
        nowIso();

      this.saveState();

      throw error;
    }

    if (!signalled) {
      job.state =
        "running";

      job.updatedAt =
        nowIso();

      this.saveState();

      throw new Error(
        "The generation process rejected SIGTERM."
      );
    }

    return clone(job);
  }

  confirmCancelled(
    jobId
  ) {
    const job =
      this.requireJob(
        jobId
      );

    const cancelledAt =
      nowIso();

    job.state =
      "cancelled";

    job.cancelledAt =
      cancelledAt;

    job.finishedAt =
      cancelledAt;

    job.updatedAt =
      cancelledAt;

    job.pid = null;

    job.progress = {
      ...job.progress,
      message:
        "Cancelled",
    };

    this.activeProcesses.delete(
      jobId
    );

    this.saveState();

    return clone(job);
  }

  retryJob(
    jobId
  ) {
    const original =
      this.requireJob(
        jobId
      );

    if (
      !TERMINAL_STATES.has(
        original.state
      )
    ) {
      throw new Error(
        "Only a terminal job can be retried."
      );
    }

    return this.createJob({
      payload:
        original.payload,

      retryOf:
        original.id,
    });
  }

  getJob(
    jobId
  ) {
    const job =
      this.state.jobs.find(
        (item) =>
          item.id === jobId
      );

    return job
      ? clone(job)
      : null;
  }

  requireJob(
    jobId
  ) {
    const job =
      this.state.jobs.find(
        (item) =>
          item.id === jobId
      );

    if (!job) {
      const error =
        new Error(
          `Image-to-Video job not found: ${jobId}`
        );

      error.statusCode = 404;

      throw error;
    }

    return job;
  }

  listJobs({
    limit = 50,
    state = null,
  } = {}) {
    const safeLimit =
      Math.max(
        1,
        Math.min(
          200,
          Number(limit) ||
          50
        )
      );

    let jobs =
      this.state.jobs;

    if (state) {
      jobs =
        jobs.filter(
          (job) =>
            job.state ===
            state
        );
    }

    return clone(
      jobs
        .slice()
        .reverse()
        .slice(
          0,
          safeLimit
        )
    );
  }

  getSummary() {
    const counts = {
      queued: 0,
      running: 0,
      cancelling: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (
      const job of
      this.state.jobs
    ) {
      if (
        Object.prototype
          .hasOwnProperty
          .call(
            counts,
            job.state
          )
      ) {
        counts[
          job.state
        ] += 1;
      }
    }

    return {
      total:
        this.state.jobs
          .length,

      activeProcesses:
        this.activeProcesses
          .size,

      counts,

      updatedAt:
        this.state
          .updatedAt,

      safety: {
        persistentProcessObjects:
          false,

        cancelOnlyOwnedProcess:
          true,

        retryCreatesNewJob:
          true,

        destructiveHistoryMutation:
          false,
      },
    };
  }
}

module.exports = {
  ImageToVideoJobManager,
  TERMINAL_STATES,
};
