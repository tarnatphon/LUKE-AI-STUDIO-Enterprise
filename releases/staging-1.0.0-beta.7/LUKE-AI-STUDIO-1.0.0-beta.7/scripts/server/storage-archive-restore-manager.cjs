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

function ensureParentDirectory(
  filePath
) {
  fs.mkdirSync(
    path.dirname(
      filePath
    ),
    {
      recursive: true,
    }
  );
}

function safeRestoreTarget({
  destinationPath,
  overwrite = false,
}) {
  const resolved =
    path.resolve(
      String(
        destinationPath || ""
      )
    );

  if (!resolved) {
    const error =
      new Error(
        "Restore destination is required."
      );

    error.statusCode = 400;
    throw error;
  }

  if (
    fs.existsSync(resolved) &&
    overwrite !== true
  ) {
    const error =
      new Error(
        "Restore destination already exists. Automatic overwrite is disabled."
      );

    error.code =
      "EEXIST";

    error.statusCode = 409;
    throw error;
  }

  return resolved;
}

function restoreAsNewPath(
  destinationPath
) {
  const resolved =
    path.resolve(
      destinationPath
    );

  if (
    !fs.existsSync(
      resolved
    )
  ) {
    return resolved;
  }

  const directory =
    path.dirname(
      resolved
    );

  const extension =
    path.extname(
      resolved
    );

  const baseName =
    path.basename(
      resolved,
      extension
    );

  for (
    let index = 1;
    index <= 9999;
    index += 1
  ) {
    const candidate =
      path.join(
        directory,
        `${baseName}-restored-${index}${extension}`
      );

    if (
      !fs.existsSync(
        candidate
      )
    ) {
      return candidate;
    }
  }

  const error =
    new Error(
      "Unable to generate a unique restore filename."
    );

  error.statusCode = 409;
  throw error;
}

class StorageArchiveRestoreManager {
  constructor({
    statePath,
    safeArchiveManager,
    transferQueue,
  }) {
    this.statePath =
      statePath;

    this.safeArchiveManager =
      safeArchiveManager;

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
        restores: [],
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

    state.restores =
      (
        state.restores || []
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

  getArchive(
    archiveId
  ) {
    const archiveState =
      this.safeArchiveManager
        .getStatus();

    const archive =
      (
        archiveState.archives ||
        []
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
      archive.verified !==
      true
    ) {
      const error =
        new Error(
          "Only verified archives can be restored."
        );

      error.statusCode = 409;
      throw error;
    }

    return archive;
  }

  requestRestore({
    archiveId,
    destinationPath,
    restoreAsNew = false,
  }) {
    const archive =
      this.getArchive(
        archiveId
      );

    let target =
      path.resolve(
        String(
          destinationPath || ""
        )
      );

    if (
      restoreAsNew ===
      true
    ) {
      target =
        restoreAsNewPath(
          target
        );
    } else {
      target =
        safeRestoreTarget({
          destinationPath:
            target,
          overwrite:
            false,
        });
    }

    ensureParentDirectory(
      target
    );

    const restore = {
      id:
        createId(
          "restore"
        ),
      archiveId:
        archive.id,
      archiveProviderId:
        archive.destinationProviderId ||
        null,
      archiveObjectKey:
        archive.objectKey ||
        null,
      archiveDestinationPath:
        archive.destinationPath ||
        null,
      expectedSha256:
        archive.sourceSha256,
      expectedBytes:
        archive.sourceBytes,
      destinationPath:
        target,
      restoreAsNew:
        Boolean(
          restoreAsNew
        ),
      status:
        "requested",
      verified:
        false,
      overwritePerformed:
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

    state.restores.push(
      restore
    );

    state.events.push({
      type:
        "restore-requested",
      restoreId:
        restore.id,
      archiveId:
        archive.id,
      destinationPath:
        target,
      createdAt:
        restore.createdAt,
    });

    this.writeState(
      state
    );

    return restore;
  }

  async restoreLocalArchive({
    restoreId,
    sourceArchivePath,
  }) {
    const state =
      this.readState();

    const restore =
      state.restores.find(
        (item) =>
          item.id ===
          restoreId
      );

    if (!restore) {
      const error =
        new Error(
          "Restore request was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    if (
      restore.status ===
      "completed"
    ) {
      return restore;
    }

    const source =
      path.resolve(
        String(
          sourceArchivePath || ""
        )
      );

    if (
      !fs.existsSync(source) ||
      !fs.statSync(source)
        .isFile()
    ) {
      const error =
        new Error(
          "Archive source file is unavailable."
        );

      error.statusCode = 404;
      throw error;
    }

    if (
      fs.existsSync(
        restore.destinationPath
      )
    ) {
      const error =
        new Error(
          "Restore destination now exists. Overwrite remains disabled."
        );

      error.statusCode = 409;
      throw error;
    }

    const sourceStat =
      fs.statSync(
        source
      );

    if (
      sourceStat.size !==
      restore.expectedBytes
    ) {
      const error =
        new Error(
          "Archive size does not match verified archive metadata."
        );

      error.statusCode = 409;
      throw error;
    }

    const sourceHash =
      await sha256File(
        source
      );

    if (
      sourceHash !==
      restore.expectedSha256
    ) {
      const error =
        new Error(
          "Archive checksum verification failed before restore."
        );

      error.statusCode = 409;
      throw error;
    }

    const temporaryTarget =
      `${restore.destinationPath}.restore-${process.pid}-${Date.now()}`;

    fs.copyFileSync(
      source,
      temporaryTarget
    );

    const restoredStat =
      fs.statSync(
        temporaryTarget
      );

    if (
      restoredStat.size !==
      restore.expectedBytes
    ) {
      fs.rmSync(
        temporaryTarget,
        {
          force: true,
        }
      );

      const error =
        new Error(
          "Restored file size verification failed."
        );

      error.statusCode = 500;
      throw error;
    }

    const restoredHash =
      await sha256File(
        temporaryTarget
      );

    if (
      restoredHash !==
      restore.expectedSha256
    ) {
      fs.rmSync(
        temporaryTarget,
        {
          force: true,
        }
      );

      const error =
        new Error(
          "Restored SHA-256 verification failed."
        );

      error.statusCode = 500;
      throw error;
    }

    fs.renameSync(
      temporaryTarget,
      restore.destinationPath
    );

    restore.status =
      "completed";

    restore.verified =
      true;

    restore.completedAt =
      new Date()
        .toISOString();

    restore.restoredSha256 =
      restoredHash;

    restore.restoredBytes =
      restoredStat.size;

    state.events.push({
      type:
        "restore-verified",
      restoreId:
        restore.id,
      archiveId:
        restore.archiveId,
      destinationPath:
        restore.destinationPath,
      sha256:
        restoredHash,
      createdAt:
        restore.completedAt,
    });

    this.writeState(
      state
    );

    return restore;
  }

  markFailed(
    restoreId,
    error
  ) {
    const state =
      this.readState();

    const restore =
      state.restores.find(
        (item) =>
          item.id ===
          restoreId
      );

    if (!restore) {
      return null;
    }

    restore.status =
      "failed";

    restore.error =
      error instanceof Error
        ? error.message
        : String(error);

    state.events.push({
      type:
        "restore-failed",
      restoreId,
      error:
        restore.error,
      createdAt:
        new Date()
          .toISOString(),
    });

    this.writeState(
      state
    );

    return restore;
  }

  getStatus() {
    return {
      ...this.readState(),
      safety: {
        verifiedArchiveOnly:
          true,
        automaticOverwrite:
          false,
        restoreAsNew:
          true,
        sha256Verification:
          true,
        sizeVerification:
          true,
        archivePreserved:
          true,
        automaticDeletion:
          false,
        shellExecution:
          false,
      },
    };
  }
}

module.exports = {
  StorageArchiveRestoreManager,
  sha256File,
  safeRestoreTarget,
  restoreAsNewPath,
};
