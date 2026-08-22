"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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

function createId(prefix) {
  return (
    `${prefix}-${Date.now()}-` +
    crypto
      .randomBytes(6)
      .toString("hex")
  );
}

async function sha256File(
  filePath
) {
  const hash =
    crypto.createHash(
      "sha256"
    );

  const stream =
    fs.createReadStream(
      filePath
    );

  for await (
    const chunk of stream
  ) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function safeSourceFile(
  sourcePath
) {
  const resolved =
    path.resolve(
      String(
        sourcePath || ""
      )
    );

  if (
    !fs.existsSync(resolved)
  ) {
    const error =
      new Error(
        "Archive source file was not found."
      );

    error.statusCode = 404;
    throw error;
  }

  const stat =
    fs.statSync(resolved);

  if (!stat.isFile()) {
    const error =
      new Error(
        "Archive source must be a regular file."
      );

    error.statusCode = 400;
    throw error;
  }

  return {
    path:
      resolved,
    sizeBytes:
      stat.size,
  };
}

class StorageSafeArchiveManager {
  constructor({
    statePath,
    transferQueue,
  }) {
    this.statePath =
      statePath;

    this.transferQueue =
      transferQueue;
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
        archives: [],
        cleanupRequests: [],
        events: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    state.archives =
      (
        state.archives || []
      ).slice(-500);

    state.cleanupRequests =
      (
        state.cleanupRequests ||
        []
      ).slice(-500);

    state.events =
      (
        state.events || []
      ).slice(-1000);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  async requestArchive({
    sourcePath,
    destinationProviderId = null,
    destinationPath = null,
    objectKey = null,
    workloadType = null,
  }) {
    const source =
      safeSourceFile(
        sourcePath
      );

    const sourceSha256 =
      await sha256File(
        source.path
      );

    const job =
      this.transferQueue
        .enqueue({
          type:
            destinationProviderId
              ? "copy"
              : "copy",
          sourcePath:
            source.path,
          destinationProviderId,
          destinationPath,
          objectKey,
          workloadType,
          workloadOverride:
            Boolean(
              workloadType
            ),
          priority: 50,
        });

    const archive = {
      id:
        createId(
          "archive"
        ),
      sourcePath:
        source.path,
      sourceBytes:
        source.sizeBytes,
      sourceSha256,
      transferJobId:
        job.id,
      destinationProviderId:
        destinationProviderId ||
        null,
      destinationPath:
        destinationPath ||
        null,
      objectKey:
        objectKey ||
        null,
      workloadType:
        workloadType ||
        null,
      status:
        "queued",
      verified:
        false,
      sourcePreserved:
        true,
      cleanupEligible:
        false,
      createdAt:
        new Date()
          .toISOString(),
      verifiedAt:
        null,
    };

    const state =
      this.readState();

    state.archives.push(
      archive
    );

    state.events.push({
      type:
        "archive-requested",
      archiveId:
        archive.id,
      transferJobId:
        job.id,
      sourcePath:
        source.path,
      createdAt:
        archive.createdAt,
    });

    this.writeState(
      state
    );

    return archive;
  }

  syncArchive(
    archiveId
  ) {
    const state =
      this.readState();

    const archive =
      state.archives.find(
        (item) =>
          item.id ===
          archiveId
      );

    if (!archive) {
      const error =
        new Error(
          "Archive request was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    const queueState =
      this.transferQueue
        .getStatus();

    const job =
      (
        queueState.jobs || []
      ).find(
        (item) =>
          item.id ===
          archive.transferJobId
      );

    if (!job) {
      archive.status =
        "transfer-job-missing";

      this.writeState(
        state
      );

      return archive;
    }

    archive.status =
      job.status;

    archive.destinationProviderId =
      job.destinationProviderId ||
      archive.destinationProviderId;

    if (
      job.status ===
        "completed" &&
      job.verified ===
        true
    ) {
      archive.verified =
        true;

      archive.cleanupEligible =
        true;

      archive.verifiedAt =
        archive.verifiedAt ||
        new Date()
          .toISOString();

      archive.sourcePreserved =
        fs.existsSync(
          archive.sourcePath
        );

      state.events.push({
        type:
          "archive-verified",
        archiveId:
          archive.id,
        transferJobId:
          archive.transferJobId,
        sourcePreserved:
          archive.sourcePreserved,
        createdAt:
          archive.verifiedAt,
      });
    }

    this.writeState(
      state
    );

    return archive;
  }

  requestCleanup(
    archiveId
  ) {
    const archive =
      this.syncArchive(
        archiveId
      );

    if (
      archive.verified !==
        true ||
      archive.cleanupEligible !==
        true
    ) {
      const error =
        new Error(
          "Cleanup cannot be requested before archive verification succeeds."
        );

      error.statusCode = 409;
      throw error;
    }

    if (
      !fs.existsSync(
        archive.sourcePath
      )
    ) {
      const error =
        new Error(
          "Source file no longer exists."
        );

      error.statusCode = 404;
      throw error;
    }

    const state =
      this.readState();

    const existing =
      state.cleanupRequests.find(
        (item) =>
          item.archiveId ===
            archive.id &&
          item.status ===
            "pending"
      );

    if (existing) {
      return existing;
    }

    const request = {
      id:
        createId(
          "cleanup"
        ),
      archiveId:
        archive.id,
      sourcePath:
        archive.sourcePath,
      expectedSha256:
        archive.sourceSha256,
      expectedBytes:
        archive.sourceBytes,
      status:
        "pending",
      explicitConfirmationRequired:
        true,
      createdAt:
        new Date()
          .toISOString(),
      confirmedAt:
        null,
      cancelledAt:
        null,
    };

    state.cleanupRequests.push(
      request
    );

    state.events.push({
      type:
        "cleanup-requested",
      cleanupRequestId:
        request.id,
      archiveId:
        archive.id,
      createdAt:
        request.createdAt,
    });

    this.writeState(
      state
    );

    return request;
  }

  async confirmCleanup(
    requestId
  ) {
    const state =
      this.readState();

    const request =
      state.cleanupRequests.find(
        (item) =>
          item.id ===
          requestId
      );

    if (!request) {
      const error =
        new Error(
          "Cleanup request was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    if (
      request.status !==
      "pending"
    ) {
      const error =
        new Error(
          "Cleanup request is not pending."
        );

      error.statusCode = 409;
      throw error;
    }

    const source =
      safeSourceFile(
        request.sourcePath
      );

    if (
      source.sizeBytes !==
      request.expectedBytes
    ) {
      const error =
        new Error(
          "Source file changed after archive verification."
        );

      error.statusCode = 409;
      throw error;
    }

    const currentSha256 =
      await sha256File(
        source.path
      );

    if (
      currentSha256 !==
      request.expectedSha256
    ) {
      const error =
        new Error(
          "Source checksum changed after archive verification."
        );

      error.statusCode = 409;
      throw error;
    }

    fs.unlinkSync(
      source.path
    );

    request.status =
      "confirmed";

    request.confirmedAt =
      new Date()
        .toISOString();

    const archive =
      state.archives.find(
        (item) =>
          item.id ===
          request.archiveId
      );

    if (archive) {
      archive.sourcePreserved =
        false;

      archive.cleanupEligible =
        false;

      archive.status =
        "source-cleaned";
    }

    state.events.push({
      type:
        "cleanup-confirmed",
      cleanupRequestId:
        request.id,
      archiveId:
        request.archiveId,
      sourcePath:
        request.sourcePath,
      createdAt:
        request.confirmedAt,
    });

    this.writeState(
      state
    );

    return {
      request,
      sourceDeleted:
        true,
      explicitConfirmation:
        true,
    };
  }

  cancelCleanup(
    requestId
  ) {
    const state =
      this.readState();

    const request =
      state.cleanupRequests.find(
        (item) =>
          item.id ===
          requestId
      );

    if (!request) {
      const error =
        new Error(
          "Cleanup request was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    if (
      request.status !==
      "pending"
    ) {
      return request;
    }

    request.status =
      "cancelled";

    request.cancelledAt =
      new Date()
        .toISOString();

    state.events.push({
      type:
        "cleanup-cancelled",
      cleanupRequestId:
        request.id,
      archiveId:
        request.archiveId,
      createdAt:
        request.cancelledAt,
    });

    this.writeState(
      state
    );

    return request;
  }

  getStatus() {
    return {
      ...this.readState(),
      safety: {
        automaticSourceDeletion:
          false,
        explicitCleanupRequest:
          true,
        explicitCleanupConfirmation:
          true,
        checksumRevalidationBeforeDelete:
          true,
        shellExecution:
          false,
      },
    };
  }
}

module.exports = {
  StorageSafeArchiveManager,
  sha256File,
  safeSourceFile,
};
