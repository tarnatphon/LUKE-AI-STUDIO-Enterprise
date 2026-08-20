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

function classifyVerification({
  expectedBytes,
  actualBytes,
  expectedSha256,
  actualSha256,
}) {
  if (
    Number.isFinite(
      Number(expectedBytes)
    ) &&
    Number(expectedBytes) !==
      Number(actualBytes)
  ) {
    return "size-mismatch";
  }

  if (
    expectedSha256 &&
    actualSha256 &&
    expectedSha256 !==
      actualSha256
  ) {
    return "checksum-mismatch";
  }

  return "healthy";
}

class StorageDeepCloudIntegrityManager {
  constructor({
    statePath,
    safeArchiveManager,
    s3Adapter,
  }) {
    this.statePath =
      statePath;

    this.safeArchiveManager =
      safeArchiveManager;

    this.s3Adapter =
      s3Adapter;
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
        verifications: [],
        alerts: [],
        events: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date()
        .toISOString();

    state.verifications =
      (
        state.verifications ||
        []
      ).slice(-500);

    state.alerts =
      (
        state.alerts ||
        []
      ).slice(-1000);

    state.events =
      (
        state.events ||
        []
      ).slice(-1500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  getArchive(
    archiveId
  ) {
    const status =
      this.safeArchiveManager
        .getStatus();

    const archive =
      (
        status.archives || []
      ).find(
        (item) =>
          item.id ===
          archiveId
      );

    if (!archive) {
      const error =
        new Error(
          "Archive record was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    if (
      archive.verified !== true
    ) {
      const error =
        new Error(
          "Deep verification requires a verified archive record."
        );

      error.statusCode = 409;
      throw error;
    }

    if (
      !archive
        .destinationProviderId ||
      !archive.objectKey
    ) {
      const error =
        new Error(
          "Archive does not contain a remote provider and object key."
        );

      error.statusCode = 409;
      throw error;
    }

    return archive;
  }

  createAlert({
    state,
    verification,
    severity,
    type,
    message,
  }) {
    const existing =
      (
        state.alerts || []
      ).find(
        (item) =>
          item.verificationId ===
            verification.id &&
          item.type === type &&
          item.status ===
            "open"
      );

    if (existing) {
      existing.lastSeenAt =
        new Date()
          .toISOString();

      return existing;
    }

    const alert = {
      id:
        createId(
          "alert"
        ),
      verificationId:
        verification.id,
      archiveId:
        verification.archiveId,
      providerId:
        verification.providerId,
      objectKey:
        verification.objectKey,
      severity,
      type,
      message,
      status:
        "open",
      createdAt:
        new Date()
          .toISOString(),
      lastSeenAt:
        new Date()
          .toISOString(),
      acknowledgedAt:
        null,
    };

    state.alerts.push(
      alert
    );

    return alert;
  }

  async verifyArchive({
    archiveId,
    approvedRoot,
  }) {
    const archive =
      this.getArchive(
        archiveId
      );

    const root =
      path.resolve(
        String(
          approvedRoot || ""
        )
      );

    if (!root) {
      const error =
        new Error(
          "Approved storage root is required."
        );

      error.statusCode = 400;
      throw error;
    }

    fs.mkdirSync(
      root,
      {
        recursive: true,
      }
    );

    const verificationId =
      createId(
        "cloud-verify"
      );

    const verificationDirectory =
      path.join(
        root,
        ".luke-integrity-verification"
      );

    fs.mkdirSync(
      verificationDirectory,
      {
        recursive: true,
      }
    );

    const temporaryPath =
      path.join(
        verificationDirectory,
        `${verificationId}.tmp`
      );

    const verification = {
      id:
        verificationId,
      archiveId:
        archive.id,
      providerId:
        archive
          .destinationProviderId,
      objectKey:
        archive.objectKey,
      expectedBytes:
        archive.sourceBytes ??
        null,
      expectedSha256:
        archive.sourceSha256 ||
        null,
      actualBytes:
        null,
      actualSha256:
        null,
      adapterVerified:
        null,
      status:
        "running",
      temporaryCopyRemoved:
        false,
      sourceModified:
        false,
      remoteObjectModified:
        false,
      createdAt:
        new Date()
          .toISOString(),
      completedAt:
        null,
      error:
        null,
    };

    const state =
      this.readState();

    state.verifications.push(
      verification
    );

    state.events.push({
      type:
        "deep-cloud-verification-started",
      verificationId:
        verification.id,
      archiveId:
        archive.id,
      providerId:
        verification.providerId,
      objectKey:
        verification.objectKey,
      createdAt:
        verification.createdAt,
    });

    this.writeState(
      state
    );

    try {
      const downloadResult =
        await this.s3Adapter
          .downloadFile({
            providerId:
              verification.providerId,
            objectKey:
              verification.objectKey,
            destinationPath:
              temporaryPath,
            approvedRoot:
              root,
          });

      if (
        !fs.existsSync(
          temporaryPath
        )
      ) {
        const error =
          new Error(
            "Deep verification download did not create the temporary file."
          );

        error.code =
          "REMOTE_DOWNLOAD_MISSING";

        throw error;
      }

      const stat =
        fs.statSync(
          temporaryPath
        );

      verification.actualBytes =
        stat.size;

      verification.actualSha256 =
        await sha256File(
          temporaryPath
        );

      verification.adapterVerified =
        typeof downloadResult
          ?.sha256Verified ===
          "boolean"
          ? downloadResult
              .sha256Verified
          : null;

      verification.status =
        classifyVerification({
          expectedBytes:
            verification
              .expectedBytes,
          actualBytes:
            verification
              .actualBytes,
          expectedSha256:
            verification
              .expectedSha256,
          actualSha256:
            verification
              .actualSha256,
        });

      verification.completedAt =
        new Date()
          .toISOString();

      const currentState =
        this.readState();

      const stored =
        currentState
          .verifications
          .find(
            (item) =>
              item.id ===
              verification.id
          );

      if (stored) {
        Object.assign(
          stored,
          verification
        );
      }

      if (
        verification.status ===
        "size-mismatch"
      ) {
        this.createAlert({
          state:
            currentState,
          verification,
          severity:
            "critical",
          type:
            "cloud-size-mismatch",
          message:
            "Cloud object size differs from the verified archive record.",
        });
      }

      if (
        verification.status ===
        "checksum-mismatch"
      ) {
        this.createAlert({
          state:
            currentState,
          verification,
          severity:
            "critical",
          type:
            "cloud-checksum-mismatch",
          message:
            "Cloud object SHA-256 differs from the verified archive record.",
        });
      }

      currentState.events.push({
        type:
          "deep-cloud-verification-completed",
        verificationId:
          verification.id,
        status:
          verification.status,
        createdAt:
          verification.completedAt,
      });

      this.writeState(
        currentState
      );

      return verification;
    } catch (error) {
      verification.status =
        "provider-error";

      verification.error =
        error instanceof Error
          ? error.message
          : String(error);

      verification.completedAt =
        new Date()
          .toISOString();

      const currentState =
        this.readState();

      const stored =
        currentState
          .verifications
          .find(
            (item) =>
              item.id ===
              verification.id
          );

      if (stored) {
        Object.assign(
          stored,
          verification
        );
      }

      this.createAlert({
        state:
          currentState,
        verification,
        severity:
          "critical",
        type:
          "cloud-provider-error",
        message:
          verification.error,
      });

      currentState.events.push({
        type:
          "deep-cloud-verification-failed",
        verificationId:
          verification.id,
        error:
          verification.error,
        createdAt:
          verification.completedAt,
      });

      this.writeState(
        currentState
      );

      throw error;
    } finally {
      try {
        fs.rmSync(
          temporaryPath,
          {
            force: true,
          }
        );

        verification
          .temporaryCopyRemoved =
          true;
      } catch {
        verification
          .temporaryCopyRemoved =
          false;
      }

      const finalState =
        this.readState();

      const stored =
        finalState
          .verifications
          .find(
            (item) =>
              item.id ===
              verification.id
          );

      if (stored) {
        stored
          .temporaryCopyRemoved =
          verification
            .temporaryCopyRemoved;
      }

      this.writeState(
        finalState
      );
    }
  }

  acknowledgeAlert(
    alertId
  ) {
    const state =
      this.readState();

    const alert =
      state.alerts.find(
        (item) =>
          item.id ===
          alertId
      );

    if (!alert) {
      const error =
        new Error(
          "Integrity alert was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    alert.status =
      "acknowledged";

    alert.acknowledgedAt =
      new Date()
        .toISOString();

    state.events.push({
      type:
        "integrity-alert-acknowledged",
      alertId:
        alert.id,
      createdAt:
        alert.acknowledgedAt,
    });

    this.writeState(
      state
    );

    return alert;
  }

  getStatus() {
    const state =
      this.readState();

    const alerts =
      state.alerts || [];

    return {
      ...state,
      alertSummary: {
        open:
          alerts.filter(
            (item) =>
              item.status ===
              "open"
          ).length,
        critical:
          alerts.filter(
            (item) =>
              item.status ===
                "open" &&
              item.severity ===
                "critical"
          ).length,
        acknowledged:
          alerts.filter(
            (item) =>
              item.status ===
              "acknowledged"
          ).length,
      },
      safety: {
        remoteReadOnly:
          true,
        sourceModification:
          false,
        remoteObjectModification:
          false,
        automaticRepair:
          false,
        automaticDeletion:
          false,
        automaticOverwrite:
          false,
        temporaryVerificationCopy:
          true,
      },
    };
  }
}

module.exports = {
  StorageDeepCloudIntegrityManager,
  sha256File,
  classifyVerification,
};
