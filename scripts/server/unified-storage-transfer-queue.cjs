"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function createId(prefix) {
  return (
    `${prefix}-${Date.now()}-` +
    crypto
      .randomBytes(6)
      .toString("hex")
  );
}

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

function sleep(milliseconds) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

function calculateRetryDelay(
  attempt
) {
  const normalized =
    Math.max(
      1,
      Number(attempt) || 1
    );

  return Math.min(
    5 * 60 * 1000,
    2000 *
      Math.pow(
        2,
        normalized - 1
      )
  );
}

function isRetryableError(
  error
) {
  const code =
    String(
      error?.code || ""
    ).toLowerCase();

  const message =
    String(
      error?.message || ""
    ).toLowerCase();

  return (
    [
      "econnreset",
      "econnrefused",
      "etimedout",
      "enotfound",
      "enetunreach",
      "ehostunreach",
      "eio",
      "ebusy",
    ].includes(code) ||
    message.includes(
      "offline"
    ) ||
    message.includes(
      "unavailable"
    ) ||
    message.includes(
      "not connected"
    ) ||
    message.includes(
      "network"
    )
  );
}

class UnifiedStorageTransferQueue {
  constructor({
    statePath,
    providerCore,
    s3Adapter,
    healthScorer = null,
    policyManager = null,
    workloadDetector = null,
    capacityManager = null,
    maxConcurrent = 1,
  }) {
    this.statePath =
      statePath;

    this.providerCore =
      providerCore;

    this.s3Adapter =
      s3Adapter;

    this.healthScorer =
      healthScorer;

    this.policyManager =
      policyManager;

    this.workloadDetector =
      workloadDetector;

    this.capacityManager =
      capacityManager;

    this.maxConcurrent =
      Math.max(
        1,
        Number(maxConcurrent) || 1
      );

    this.processingPromise =
      null;
  }

  readState() {
    if (
      !fs.existsSync(
        this.statePath
      )
    ) {
      return {
        schemaVersion: 1,
        updatedAt: null,
        processing: false,
        paused: false,
        activeJobId: null,
        jobs: [],
        history: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    state.jobs =
      (
        state.jobs || []
      ).slice(-500);

    state.history =
      (
        state.history || []
      ).slice(-1000);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  getStatus() {
    return this.readState();
  }

  enqueue(input) {
    const type =
      String(
        input?.type || ""
      ).trim();

    if (
      ![
        "copy",
        "cloud-upload",
      ].includes(type)
    ) {
      const error =
        new Error(
          "Unsupported transfer job type."
        );

      error.statusCode = 400;
      throw error;
    }

    const sourcePath =
      String(
        input.sourcePath || ""
      ).trim();

    if (!sourcePath) {
      const error =
        new Error(
          "sourcePath is required."
        );

      error.statusCode = 400;
      throw error;
    }

    const job = {
      id:
        createId(
          "storage-job"
        ),
      type,
      status:
        "queued",
      priority:
        Number(
          input.priority
        ) || 100,
      sourcePath,
      destinationProviderId:
        input.destinationProviderId ||
        null,
      destinationPath:
        input.destinationPath ||
        null,
      objectKey:
        input.objectKey ||
        null,
      // LUKE_AI_AUTOMATIC_WORKLOAD_DETECTION_V1
      workloadType:
        null,
      workloadDetection:
        null,
      workloadOverride:
        Boolean(
          input.workloadOverride
        ),
      requestedWorkloadType:
        input.workloadType
          ? String(
              input.workloadType
            )
              .trim()
              .toLowerCase()
          : null,
      attempts: 0,
      maxAttempts:
        Math.max(
          1,
          Number(
            input.maxAttempts
          ) || 5
        ),
      nextRetryAt:
        null,
      createdAt:
        new Date().toISOString(),
      startedAt:
        null,
      completedAt:
        null,
      progress: 0,
      verified: false,
      error: null,
      result: null,
    };

    if (
      this.workloadDetector
    ) {
      const detected =
        this.workloadDetector
          .detect({
            sourcePath:
              job.sourcePath,
            workloadType:
              job.requestedWorkloadType,
            manualOverride:
              job.workloadOverride,
          });

      job.workloadType =
        detected.workloadType;

      job.workloadDetection =
        detected;
    } else {
      job.workloadType =
        job.requestedWorkloadType ||
        "models";

      job.workloadDetection = {
        workloadType:
          job.workloadType,
        confidence:
          job.workloadOverride
            ? 1
            : 0,
        reason:
          job.workloadOverride
            ? "manual-override"
            : "detector-unavailable",
        manualOverride:
          job.workloadOverride,
      };
    }

    const state =
      this.readState();

    state.jobs.push(job);

    state.jobs.sort(
      (left, right) =>
        left.priority -
        right.priority
    );

    this.writeState(state);

    this.start();

    return job;
  }

  pause() {
    const state =
      this.readState();

    state.paused = true;

    this.writeState(state);

    return {
      paused: true,
    };
  }

  resume() {
    const state =
      this.readState();

    state.paused = false;

    this.writeState(state);

    this.start();

    return {
      paused: false,
    };
  }

  cancel(jobId) {
    const state =
      this.readState();

    const job =
      state.jobs.find(
        (item) =>
          item.id === jobId
      );

    if (!job) {
      const error =
        new Error(
          "Transfer job was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    if (
      [
        "completed",
        "cancelled",
      ].includes(
        job.status
      )
    ) {
      return job;
    }

    job.status =
      "cancelled";

    job.completedAt =
      new Date().toISOString();

    job.error = null;

    this.writeState(state);

    return job;
  }

  retry(jobId) {
    const state =
      this.readState();

    const job =
      state.jobs.find(
        (item) =>
          item.id === jobId
      );

    if (!job) {
      const error =
        new Error(
          "Transfer job was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    job.status =
      "queued";

    job.error =
      null;

    job.nextRetryAt =
      null;

    job.completedAt =
      null;

    job.progress = 0;

    this.writeState(state);

    this.start();

    return job;
  }

  async copyFile({
    sourcePath,
    destinationPath,
  }) {
    const source =
      path.resolve(
        sourcePath
      );

    const destination =
      path.resolve(
        destinationPath
      );

    if (
      !fs.existsSync(source) ||
      !fs.statSync(source)
        .isFile()
    ) {
      const error =
        new Error(
          "Source file was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    fs.mkdirSync(
      path.dirname(
        destination
      ),
      {
        recursive: true,
      }
    );

    await fs.promises.copyFile(
      source,
      destination
    );

    const sourceStat =
      fs.statSync(source);

    const destinationStat =
      fs.statSync(destination);

    if (
      sourceStat.size !==
      destinationStat.size
    ) {
      const error =
        new Error(
          "Copied file size verification failed."
        );

      error.statusCode = 500;
      throw error;
    }

    return {
      sourcePath:
        source,
      destinationPath:
        destination,
      sourceBytes:
        sourceStat.size,
      destinationBytes:
        destinationStat.size,
      verified: true,
      sourcePreserved:
        true,
    };
  }

  async processJob(job) {
    job.status =
      "checking";

    job.startedAt =
      job.startedAt ||
      new Date().toISOString();

    job.attempts += 1;

    job.error = null;

    const state =
      this.readState();

    state.activeJobId =
      job.id;

    this.writeState(state);

    try {
      let provider = null;

      if (
        job.destinationProviderId
      ) {
        provider =
          this.providerCore
            .getProvider(
              job.destinationProviderId
            );
      } else {
        // LUKE_AI_WORKLOAD_AWARE_ROUTING_V1
        if (
          this.policyManager
        ) {
          const policySelection =
            this.policyManager
              .selectForWorkload({
                workloadType:
                  job.workloadType ||
                  "models",
                capability:
                  "write",
              });

          provider =
            policySelection
              .selected
              .provider;

          job.policySelection = {
            workloadType:
              policySelection
                .profile.id,
            providerId:
              provider.id,
            finalScore:
              policySelection
                .selected
                .finalScore,
          };
        } else {
          const selected =
            this.healthScorer
              ? this.healthScorer
                  .selectBestProvider({
                    capability:
                      "write",
                  })
              : this.providerCore
                  .selectProvider({
                    capability:
                      "write",
                  });

          provider =
            selected.provider;
        }
      }

      job.destinationProviderId =
        provider.id;

      // LUKE_AI_STORAGE_CAPACITY_GUARD_V1
      if (
        this.capacityManager
      ) {
        const requiredBytes =
          this.capacityManager
            .estimateSourceBytes(
              job.sourcePath
            );

        if (
          Number.isFinite(
            requiredBytes
          )
        ) {
          const forecast =
            this.capacityManager
              .forecast({
                workloadType:
                  job.workloadType ||
                  "temporary",
                sourcePath:
                  job.sourcePath,
                requiredBytes,
              });

          const targetCapacity =
            forecast.providers.find(
              (item) =>
                item.providerId ===
                provider.id
            );

          if (
            targetCapacity &&
            !targetCapacity.sufficient
          ) {
            const error =
              new Error(
                "Destination provider does not have enough safe free space."
              );

            error.code =
              "ENOSPC";

            error.statusCode =
              409;

            throw error;
          }

          job.capacityForecast = {
            requiredBytes,
            providerId:
              provider.id,
            level:
              targetCapacity
                ?.level ||
              "unknown",
          };

          this.capacityManager
            .reserve({
              jobId:
                job.id,
              providerId:
                provider.id,
              requiredBytes,
              workloadType:
                job.workloadType ||
                "temporary",
            });
        }
      }

      if (
        provider.category ===
          "cloud" &&
        provider.adapter ===
          "s3-compatible"
      ) {
        job.status =
          "transferring";

        job.progress = 20;

        this.writeState(state);

        const result =
          await this.s3Adapter
            .uploadFile({
              providerId:
                provider.id,
              sourcePath:
                job.sourcePath,
              objectKey:
                job.objectKey ||
                path.basename(
                  job.sourcePath
                ),
            });

        job.status =
          "verifying";

        job.progress = 90;

        this.writeState(state);

        if (
          result.transfer
            ?.verified !==
          true
        ) {
          throw new Error(
            "Cloud verification failed."
          );
        }

        job.result =
          result;

        job.verified =
          true;
      } else {
        const rootPath =
          provider.settings
            ?.rootPath;

        if (!rootPath) {
          const error =
            new Error(
              "Destination root path is unavailable."
            );

          error.code =
            "ENOTFOUND";

          throw error;
        }

        const destinationPath =
          job.destinationPath
            ? path.resolve(
                rootPath,
                job.destinationPath
              )
            : path.join(
                rootPath,
                path.basename(
                  job.sourcePath
                )
              );

        job.status =
          "transferring";

        job.progress = 30;

        this.writeState(state);

        const result =
          await this.copyFile({
            sourcePath:
              job.sourcePath,
            destinationPath,
          });

        job.status =
          "verifying";

        job.progress = 90;

        this.writeState(state);

        job.result =
          result;

        job.verified =
          result.verified ===
          true;
      }

      if (
        this.healthScorer &&
        provider?.id
      ) {
        this.healthScorer
          .recordSuccess(
            provider.id
          );
      }

      if (
        this.capacityManager
      ) {
        this.capacityManager
          .release(
            job.id
          );
      }

      job.status =
        "completed";

      job.progress = 100;

      job.completedAt =
        new Date().toISOString();

      job.error = null;

      job.nextRetryAt =
        null;

      const latestState =
        this.readState();

      latestState.activeJobId =
        null;

      latestState.history.push({
        ...job,
      });

      this.writeState(
        latestState
      );

      return job;
    } catch (error) {
      if (
        this.capacityManager
      ) {
        this.capacityManager
          .release(
            job.id
          );
      }

      if (
        this.healthScorer &&
        job.destinationProviderId
      ) {
        this.healthScorer
          .recordFailure(
            job.destinationProviderId
          );
      }

      const retryable =
        isRetryableError(
          error
        );

      if (
        retryable &&
        job.attempts <
          job.maxAttempts
      ) {
        const delay =
          calculateRetryDelay(
            job.attempts
          );

        job.status =
          "waiting";

        job.nextRetryAt =
          new Date(
            Date.now() +
            delay
          ).toISOString();

        job.error =
          error instanceof Error
            ? error.message
            : String(error);

        const latestState =
          this.readState();

        latestState.activeJobId =
          null;

        this.writeState(
          latestState
        );

        await sleep(delay);

        const afterWait =
          this.readState();

        const currentJob =
          afterWait.jobs.find(
            (item) =>
              item.id === job.id
          );

        if (
          !currentJob ||
          currentJob.status ===
            "cancelled"
        ) {
          return;
        }

        currentJob.status =
          "retrying";

        this.writeState(
          afterWait
        );

        return this.processJob(
          currentJob
        );
      }

      job.status =
        "failed";

      job.completedAt =
        new Date().toISOString();

      job.error =
        error instanceof Error
          ? error.message
          : String(error);

      const latestState =
        this.readState();

      latestState.activeJobId =
        null;

      latestState.history.push({
        ...job,
      });

      this.writeState(
        latestState
      );

      return job;
    }
  }

  // LUKE_AI_QUEUE_WAKE_WAITING_JOBS_V1
  wakeWaitingJobs({
    providerId = null,
  } = {}) {
    const state =
      this.readState();

    let changed = 0;

    for (const job of state.jobs || []) {
      if (
        job.status !== "waiting"
      ) {
        continue;
      }

      if (
        providerId &&
        job.destinationProviderId &&
        job.destinationProviderId !==
          providerId
      ) {
        continue;
      }

      job.status =
        "queued";

      job.nextRetryAt =
        null;

      job.error =
        null;

      changed += 1;
    }

    if (changed > 0) {
      this.writeState(state);
      this.start();
    }

    return {
      changed,
      providerId,
    };
  }

  async processLoop() {
    const initial =
      this.readState();

    if (
      initial.processing ===
      true
    ) {
      return;
    }

    initial.processing =
      true;

    this.writeState(initial);

    try {
      while (true) {
        const state =
          this.readState();

        if (state.paused) {
          break;
        }

        const now =
          Date.now();

        const nextJob =
          state.jobs.find(
            (job) =>
              [
                "queued",
                "retrying",
                "waiting",
              ].includes(
                job.status
              ) &&
              (
                !job.nextRetryAt ||
                Date.parse(
                  job.nextRetryAt
                ) <= now
              )
          );

        if (!nextJob) {
          break;
        }

        await this.processJob(
          nextJob
        );
      }
    } finally {
      const finalState =
        this.readState();

      finalState.processing =
        false;

      finalState.activeJobId =
        null;

      this.writeState(
        finalState
      );
    }
  }

  start() {
    if (
      this.processingPromise
    ) {
      return this.processingPromise;
    }

    this.processingPromise =
      this.processLoop()
        .finally(() => {
          this.processingPromise =
            null;
        });

    return this.processingPromise;
  }
}

module.exports = {
  UnifiedStorageTransferQueue,
  calculateRetryDelay,
  isRetryableError,
};
