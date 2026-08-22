"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(
    path.dirname(filePath),
    { recursive: true }
  );

  const temp =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  fs.renameSync(temp, filePath);
}

function createId(prefix) {
  return (
    `${prefix}-${Date.now()}-` +
    crypto.randomBytes(5).toString("hex")
  );
}

async function sha256File(filePath) {
  const hash =
    crypto.createHash("sha256");

  const stream =
    fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function classifyResult({
  exists,
  sizeMatches,
  checksumMatches,
  remote,
}) {
  if (remote === true) {
    return "remote-verification-required";
  }

  if (!exists) {
    return "missing";
  }

  if (sizeMatches === false) {
    return "size-mismatch";
  }

  if (checksumMatches === false) {
    return "checksum-mismatch";
  }

  return "healthy";
}

class StorageIntegrityScanner {
  constructor({
    configPath,
    statePath,
    safeArchiveManager,
    restoreManager,
  }) {
    this.configPath = configPath;
    this.statePath = statePath;
    this.safeArchiveManager =
      safeArchiveManager;
    this.restoreManager =
      restoreManager;

    this.timer = null;
  }

  readConfig() {
    return readJson(this.configPath);
  }

  readState() {
    if (!fs.existsSync(this.statePath)) {
      return {
        schemaVersion: 1,
        updatedAt: null,
        scheduler: {
          running: false,
          intervalMinutes: 360,
          startedAt: null,
          lastRunAt: null,
          nextRunAt: null,
        },
        lastScan: null,
        scans: [],
        events: [],
      };
    }

    return readJson(this.statePath);
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    state.scans =
      (state.scans || []).slice(-100);

    state.events =
      (state.events || []).slice(-1000);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  async verifyFile({
    recordType,
    recordId,
    filePath,
    expectedBytes = null,
    expectedSha256 = null,
    providerId = null,
    objectKey = null,
  }) {
    const resolvedPath =
      filePath
        ? path.resolve(String(filePath))
        : null;

    if (
      !resolvedPath &&
      (providerId || objectKey)
    ) {
      return {
        recordType,
        recordId,
        providerId,
        objectKey,
        filePath: null,
        status:
          "remote-verification-required",
        exists: null,
        sizeMatches: null,
        checksumMatches: null,
        checkedAt:
          new Date().toISOString(),
      };
    }

    const exists =
      Boolean(
        resolvedPath &&
        fs.existsSync(resolvedPath)
      );

    if (!exists) {
      return {
        recordType,
        recordId,
        providerId,
        objectKey,
        filePath:
          resolvedPath,
        status: "missing",
        exists: false,
        sizeMatches: false,
        checksumMatches: false,
        checkedAt:
          new Date().toISOString(),
      };
    }

    const stat =
      fs.statSync(resolvedPath);

    if (!stat.isFile()) {
      return {
        recordType,
        recordId,
        providerId,
        objectKey,
        filePath:
          resolvedPath,
        status: "missing",
        exists: false,
        sizeMatches: false,
        checksumMatches: false,
        checkedAt:
          new Date().toISOString(),
      };
    }

    let sizeMatches = null;

    if (
      Number.isFinite(
        Number(expectedBytes)
      )
    ) {
      sizeMatches =
        stat.size ===
        Number(expectedBytes);
    }

    let checksumMatches = null;
    let actualSha256 = null;

    if (expectedSha256) {
      actualSha256 =
        await sha256File(
          resolvedPath
        );

      checksumMatches =
        actualSha256 ===
        expectedSha256;
    }

    return {
      recordType,
      recordId,
      providerId,
      objectKey,
      filePath:
        resolvedPath,
      status:
        classifyResult({
          exists: true,
          sizeMatches,
          checksumMatches,
          remote: false,
        }),
      exists: true,
      actualBytes:
        stat.size,
      expectedBytes:
        expectedBytes ?? null,
      sizeMatches,
      actualSha256,
      expectedSha256:
        expectedSha256 || null,
      checksumMatches,
      checkedAt:
        new Date().toISOString(),
    };
  }

  async scanArchives() {
    const archiveStatus =
      this.safeArchiveManager
        .getStatus();

    const archives =
      archiveStatus.archives || [];

    const results = [];

    for (const archive of archives) {
      if (
        archive.verified !== true
      ) {
        continue;
      }

      const mountedPath =
        archive.destinationPath ||
        null;

      results.push(
        await this.verifyFile({
          recordType: "archive",
          recordId: archive.id,
          filePath: mountedPath,
          expectedBytes:
            archive.sourceBytes,
          expectedSha256:
            archive.sourceSha256,
          providerId:
            archive.destinationProviderId ||
            null,
          objectKey:
            archive.objectKey ||
            null,
        })
      );
    }

    return results;
  }

  async scanRestores() {
    const restoreStatus =
      this.restoreManager
        .getStatus();

    const restores =
      restoreStatus.restores || [];

    const results = [];

    for (const restore of restores) {
      if (
        restore.status !== "completed" ||
        restore.verified !== true
      ) {
        continue;
      }

      results.push(
        await this.verifyFile({
          recordType: "restore",
          recordId: restore.id,
          filePath:
            restore.destinationPath,
          expectedBytes:
            restore.expectedBytes,
          expectedSha256:
            restore.expectedSha256,
          providerId: null,
          objectKey: null,
        })
      );
    }

    return results;
  }

  summarize(results) {
    const summary = {
      total: results.length,
      healthy: 0,
      missing: 0,
      sizeMismatch: 0,
      checksumMismatch: 0,
      remoteVerificationRequired: 0,
    };

    for (const item of results) {
      switch (item.status) {
        case "healthy":
          summary.healthy += 1;
          break;

        case "missing":
          summary.missing += 1;
          break;

        case "size-mismatch":
          summary.sizeMismatch += 1;
          break;

        case "checksum-mismatch":
          summary.checksumMismatch += 1;
          break;

        case "remote-verification-required":
          summary.remoteVerificationRequired += 1;
          break;

        default:
          break;
      }
    }

    return summary;
  }

  async runScan() {
    const config =
      this.readConfig();

    const archiveResults =
      await this.scanArchives();

    const restoreResults =
      await this.scanRestores();

    const results =
      [
        ...archiveResults,
        ...restoreResults,
      ].slice(
        0,
        Number(
          config.maxRecordsPerScan
        ) || 2000
      );

    const summary =
      this.summarize(results);

    const scan = {
      id:
        createId("integrity"),
      createdAt:
        new Date().toISOString(),
      summary,
      results,
      safety: {
        readOnly: true,
        automaticRepair: false,
        automaticDeletion: false,
        automaticOverwrite: false,
      },
    };

    const state =
      this.readState();

    state.lastScan = scan;

    state.scans.push({
      id: scan.id,
      createdAt:
        scan.createdAt,
      summary,
    });

    state.scheduler.lastRunAt =
      scan.createdAt;

    if (state.scheduler.running) {
      const intervalMs =
        Math.max(
          1,
          Number(
            state.scheduler
              .intervalMinutes
          ) || 360
        ) *
        60 *
        1000;

      state.scheduler.nextRunAt =
        new Date(
          Date.now() +
          intervalMs
        ).toISOString();
    }

    state.events.push({
      type:
        "integrity-scan-completed",
      scanId:
        scan.id,
      summary,
      createdAt:
        scan.createdAt,
    });

    this.writeState(state);

    return scan;
  }

  startScheduler(
    intervalMinutes = null
  ) {
    const config =
      this.readConfig();

    const minutes =
      Math.max(
        1,
        Number(
          intervalMinutes ??
          config.intervalMinutes
        ) || 360
      );

    this.stopScheduler();

    const intervalMs =
      minutes * 60 * 1000;

    this.timer =
      setInterval(
        () => {
          this.runScan()
            .catch(
              (error) => {
                const state =
                  this.readState();

                state.events.push({
                  type:
                    "integrity-scan-failed",
                  error:
                    error instanceof Error
                      ? error.message
                      : String(error),
                  createdAt:
                    new Date()
                      .toISOString(),
                });

                this.writeState(
                  state
                );
              }
            );
        },
        intervalMs
      );

    if (
      typeof this.timer.unref ===
      "function"
    ) {
      this.timer.unref();
    }

    const state =
      this.readState();

    state.scheduler = {
      running: true,
      intervalMinutes:
        minutes,
      startedAt:
        new Date()
          .toISOString(),
      lastRunAt:
        state.scheduler
          ?.lastRunAt ||
        null,
      nextRunAt:
        new Date(
          Date.now() +
          intervalMs
        ).toISOString(),
    };

    state.events.push({
      type:
        "integrity-scheduler-started",
      intervalMinutes:
        minutes,
      createdAt:
        state.scheduler
          .startedAt,
    });

    this.writeState(state);

    return state.scheduler;
  }

  stopScheduler() {
    if (this.timer) {
      clearInterval(
        this.timer
      );

      this.timer = null;
    }

    const state =
      this.readState();

    if (
      state.scheduler
        ?.running
    ) {
      state.events.push({
        type:
          "integrity-scheduler-stopped",
        createdAt:
          new Date()
            .toISOString(),
      });
    }

    state.scheduler = {
      ...(state.scheduler || {}),
      running: false,
      nextRunAt: null,
    };

    this.writeState(state);

    return state.scheduler;
  }

  getStatus() {
    return {
      config:
        this.readConfig(),
      state:
        this.readState(),
      safety: {
        readOnly: true,
        automaticRepair: false,
        automaticDeletion: false,
        automaticOverwrite: false,
        shellExecution: false,
      },
    };
  }
}

module.exports = {
  StorageIntegrityScanner,
  sha256File,
  classifyResult,
};
