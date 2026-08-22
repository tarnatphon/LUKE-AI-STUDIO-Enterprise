"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
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

function expandHome(value) {
  const text =
    String(value || "");

  if (text === "~") {
    return os.homedir();
  }

  if (text.startsWith("~/")) {
    return path.join(
      os.homedir(),
      text.slice(2)
    );
  }

  return path.resolve(text);
}

function createId(prefix) {
  return (
    `${prefix}-${Date.now()}-` +
    crypto
      .randomBytes(6)
      .toString("hex")
  );
}

function isPathInside(
  candidate,
  root
) {
  const resolvedCandidate =
    path.resolve(candidate);

  const resolvedRoot =
    path.resolve(root);

  return (
    resolvedCandidate ===
      resolvedRoot ||
    resolvedCandidate.startsWith(
      resolvedRoot +
      path.sep
    )
  );
}

async function hashFile(filePath) {
  return new Promise(
    (resolve, reject) => {
      const hash =
        crypto.createHash(
          "sha256"
        );

      const stream =
        fs.createReadStream(
          filePath
        );

      stream.on(
        "error",
        reject
      );

      stream.on(
        "data",
        (chunk) => {
          hash.update(chunk);
        }
      );

      stream.on(
        "end",
        () => {
          resolve(
            hash.digest("hex")
          );
        }
      );
    }
  );
}

class StorageDestinationManager {
  constructor({
    root,
    policyPath,
    statePath,
  }) {
    this.root =
      path.resolve(root);

    this.policyPath =
      policyPath;

    this.statePath =
      statePath;

    this.transferActive =
      false;
  }

  readPolicy() {
    return readJson(
      this.policyPath
    );
  }

  // LUKE_AI_STORAGE_POLICY_MANAGEMENT_V1
  getPolicy() {
    return this.readPolicy();
  }

  updatePolicy(input) {
    const current =
      this.readPolicy();

    const source =
      input &&
      typeof input === "object"
        ? input
        : {};

    const allowedModes =
      new Set([
        "automatic",
        "external",
        "local",
        "custom",
      ]);

    const selectionMode =
      String(
        source.selectionMode ??
        current.selectionMode ??
        "automatic"
      ).trim();

    if (
      !allowedModes.has(
        selectionMode
      )
    ) {
      const error =
        new Error(
          "Unsupported storage selection mode."
        );

      error.statusCode = 400;
      throw error;
    }

    const preferred =
      source.preferredDestination &&
      typeof source.preferredDestination ===
        "object"
        ? source.preferredDestination
        : {};

    const localFallback =
      source.localFallback &&
      typeof source.localFallback ===
        "object"
        ? source.localFallback
        : {};

    const custom =
      source.customDestination &&
      typeof source.customDestination ===
        "object"
        ? source.customDestination
        : {};

    const volumeName =
      String(
        preferred.volumeName ??
        current.preferredDestination
          ?.volumeName ??
        "EXTERNAL Drive"
      )
        .replaceAll("/", "")
        .replaceAll("\\", "")
        .trim();

    if (!volumeName) {
      const error =
        new Error(
          "External Drive name is required."
        );

      error.statusCode = 400;
      throw error;
    }

    const relativePath =
      String(
        preferred.relativePath ??
        current.preferredDestination
          ?.relativePath ??
        "ai/ai-downloads"
      )
        .replace(/^[/\\]+/, "")
        .trim();

    if (
      !relativePath ||
      relativePath
        .split(/[\\/]+/)
        .includes("..")
    ) {
      const error =
        new Error(
          "External relative path is invalid."
        );

      error.statusCode = 400;
      throw error;
    }

    const localPath =
      String(
        localFallback.path ??
        current.localFallback
          ?.path ??
        "~/Library/Application Support/LUKE AI STUDIO/downloads"
      ).trim();

    const customPath =
      String(
        custom.path ??
        current.customDestination
          ?.path ??
        ""
      ).trim();

    if (
      selectionMode ===
        "custom" &&
      !customPath
    ) {
      const error =
        new Error(
          "Custom destination path is required."
        );

      error.statusCode = 400;
      throw error;
    }

    const next = {
      ...current,
      selectionMode,
      preferredDestination: {
        ...(current.preferredDestination ||
          {}),
        type: "external",
        volumeName,
        relativePath,
      },
      localFallback: {
        ...(current.localFallback ||
          {}),
        enabled:
          localFallback.enabled !==
          undefined
            ? Boolean(
                localFallback.enabled
              )
            : current.localFallback
                ?.enabled !== false,
        path:
          localPath,
      },
      customDestination: {
        ...(current.customDestination ||
          {}),
        enabled:
          selectionMode ===
          "custom",
        path:
          customPath,
      },
      transfer: {
        ...(current.transfer || {}),
        automaticallyTransferWhenAvailable:
          false,
        preserveLocalCopyAfterTransfer:
          true,
        requireConfirmationBeforeLocalDeletion:
          true,
        maximumConcurrentTransfers:
          1,
      },
      security: {
        ...(current.security || {}),
        allowShell:
          false,
        allowAutomaticDeletion:
          false,
        allowPathOutsideApprovedRoots:
          false,
      },
    };

    writeJsonAtomic(
      this.policyPath,
      next
    );

    this.resolveActiveDestination();

    return next;
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
        activeDestination: null,
        externalDriveAvailable:
          false,
        fallbackActive: false,
        pendingDeletionConfirmations:
          [],
        transferHistory: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  getExternalRoot() {
    const policy =
      this.readPolicy();

    const volumeName =
      String(
        policy.preferredDestination
          ?.volumeName ||
        "EXTERNAL Drive"
      ).trim();

    if (!volumeName) {
      return null;
    }

    return path.join(
      "/Volumes",
      volumeName
    );
  }

  getExternalDestination() {
    const policy =
      this.readPolicy();

    const externalRoot =
      this.getExternalRoot();

    if (!externalRoot) {
      return null;
    }

    const relativePath =
      String(
        policy.preferredDestination
          ?.relativePath ||
        "ai/ai-downloads"
      )
        .replace(/^[/\\]+/, "")
        .trim();

    return path.join(
      externalRoot,
      relativePath
    );
  }

  getLocalFallbackDestination() {
    const policy =
      this.readPolicy();

    return expandHome(
      policy.localFallback?.path ||
      "~/Library/Application Support/LUKE AI STUDIO/downloads"
    );
  }

  getCustomDestination() {
    const policy =
      this.readPolicy();

    if (
      policy.customDestination
        ?.enabled !== true
    ) {
      return null;
    }

    const customPath =
      String(
        policy.customDestination
          ?.path || ""
      ).trim();

    if (!customPath) {
      return null;
    }

    return expandHome(
      customPath
    );
  }

  isExternalAvailable() {
    const externalRoot =
      this.getExternalRoot();

    if (!externalRoot) {
      return false;
    }

    try {
      return (
        fs.existsSync(
          externalRoot
        ) &&
        fs.statSync(
          externalRoot
        ).isDirectory()
      );
    } catch {
      return false;
    }
  }

  ensureDestination(
    destination
  ) {
    fs.mkdirSync(
      destination,
      {
        recursive: true,
      }
    );

    return destination;
  }

  resolveActiveDestination() {
    const policy =
      this.readPolicy();

    const externalAvailable =
      this.isExternalAvailable();

    const externalDestination =
      this.getExternalDestination();

    const localDestination =
      this.getLocalFallbackDestination();

    const customDestination =
      this.getCustomDestination();

    let destination = null;
    let destinationType = null;
    let fallbackActive = false;

    if (
      policy.selectionMode ===
        "custom" &&
      customDestination
    ) {
      destination =
        customDestination;

      destinationType =
        "custom";
    } else if (
      policy.selectionMode ===
        "local"
    ) {
      destination =
        localDestination;

      destinationType =
        "local";
    } else if (
      externalAvailable &&
      externalDestination
    ) {
      destination =
        externalDestination;

      destinationType =
        "external";
    } else if (
      policy.localFallback
        ?.enabled !== false
    ) {
      destination =
        localDestination;

      destinationType =
        "local";

      fallbackActive = true;
    } else {
      const error =
        new Error(
          "ไม่พบ External Drive และ Local fallback ถูกปิดใช้งาน"
        );

      error.statusCode = 409;
      throw error;
    }

    this.ensureDestination(
      destination
    );

    const state =
      this.readState();

    state.activeDestination = {
      type:
        destinationType,
      path:
        destination,
      resolvedAt:
        new Date().toISOString(),
    };

    state.externalDriveAvailable =
      externalAvailable;

    state.fallbackActive =
      fallbackActive;

    this.writeState(state);

    return {
      destination:
        state.activeDestination,
      externalDriveAvailable:
        externalAvailable,
      fallbackActive,
      externalRoot:
        this.getExternalRoot(),
      externalDestination,
      localDestination,
      customDestination,
    };
  }

  getStatus() {
    const resolution =
      this.resolveActiveDestination();

    const state =
      this.readState();

    return {
      ...resolution,
      pendingDeletionConfirmations:
        state
          .pendingDeletionConfirmations ||
        [],
      transferHistory:
        state.transferHistory ||
        [],
      transferActive:
        this.transferActive,
    };
  }

  getApprovedRoots() {
    const values = [
      this.getExternalDestination(),
      this.getLocalFallbackDestination(),
      this.getCustomDestination(),
    ].filter(Boolean);

    return [
      ...new Set(
        values.map(
          (value) =>
            path.resolve(value)
        )
      ),
    ];
  }

  validateApprovedPath(
    filePath
  ) {
    const policy =
      this.readPolicy();

    if (
      policy.security
        ?.allowPathOutsideApprovedRoots ===
      true
    ) {
      return;
    }

    const approvedRoots =
      this.getApprovedRoots();

    const approved =
      approvedRoots.some(
        (approvedRoot) =>
          isPathInside(
            filePath,
            approvedRoot
          )
      );

    if (!approved) {
      const error =
        new Error(
          "Path อยู่นอกพื้นที่จัดเก็บที่ได้รับอนุญาต"
        );

      error.statusCode = 403;
      throw error;
    }
  }

  async verifyTransfer({
    sourcePath,
    destinationPath,
  }) {
    const policy =
      this.readPolicy();

    const sourceStat =
      fs.statSync(
        sourcePath
      );

    const destinationStat =
      fs.statSync(
        destinationPath
      );

    const sizeVerified =
      policy.transfer
        ?.verifyFileSize ===
      false
        ? true
        : (
            sourceStat.size ===
            destinationStat.size
          );

    let sourceSha256 = null;
    let destinationSha256 =
      null;

    let sha256Verified = true;

    if (
      policy.transfer
        ?.verifySha256 !==
      false
    ) {
      [
        sourceSha256,
        destinationSha256,
      ] = await Promise.all([
        hashFile(sourcePath),
        hashFile(destinationPath),
      ]);

      sha256Verified =
        sourceSha256 ===
        destinationSha256;
    }

    return {
      verified:
        sizeVerified &&
        sha256Verified,
      sizeVerified,
      sha256Verified,
      sourceBytes:
        sourceStat.size,
      destinationBytes:
        destinationStat.size,
      sourceSha256,
      destinationSha256,
    };
  }

  async transferLocalFile({
    sourcePath,
    relativePath = null,
  }) {
    if (this.transferActive) {
      const error =
        new Error(
          "มีงานโอนย้ายไฟล์กำลังทำงานอยู่"
        );

      error.statusCode = 409;
      throw error;
    }

    const localRoot =
      this.getLocalFallbackDestination();

    const externalRoot =
      this.getExternalDestination();

    if (
      !this.isExternalAvailable()
    ) {
      const error =
        new Error(
          "ยังไม่พบ External Drive"
        );

      error.statusCode = 409;
      throw error;
    }

    if (!externalRoot) {
      const error =
        new Error(
          "ไม่ได้กำหนด External destination"
        );

      error.statusCode = 409;
      throw error;
    }

    const resolvedSource =
      path.resolve(
        expandHome(sourcePath)
      );

    if (
      !isPathInside(
        resolvedSource,
        localRoot
      )
    ) {
      const error =
        new Error(
          "โอนได้เฉพาะไฟล์ที่อยู่ใน Local fallback"
        );

      error.statusCode = 403;
      throw error;
    }

    if (
      !fs.existsSync(
        resolvedSource
      ) ||
      !fs.statSync(
        resolvedSource
      ).isFile()
    ) {
      const error =
        new Error(
          "ไม่พบ Source file"
        );

      error.statusCode = 404;
      throw error;
    }

    const calculatedRelativePath =
      relativePath
        ? String(relativePath)
            .replace(/^[/\\]+/, "")
        : path.relative(
            localRoot,
            resolvedSource
          );

    if (
      !calculatedRelativePath ||
      calculatedRelativePath
        .startsWith("..")
    ) {
      const error =
        new Error(
          "Relative destination path ไม่ถูกต้อง"
        );

      error.statusCode = 400;
      throw error;
    }

    const destinationPath =
      path.resolve(
        externalRoot,
        calculatedRelativePath
      );

    if (
      !isPathInside(
        destinationPath,
        externalRoot
      )
    ) {
      const error =
        new Error(
          "Destination path อยู่นอก External destination"
        );

      error.statusCode = 403;
      throw error;
    }

    this.validateApprovedPath(
      resolvedSource
    );

    this.validateApprovedPath(
      destinationPath
    );

    const transferId =
      createId(
        "storage-transfer"
      );

    this.transferActive =
      true;

    try {
      fs.mkdirSync(
        path.dirname(
          destinationPath
        ),
        {
          recursive: true,
        }
      );

      await fs.promises.copyFile(
        resolvedSource,
        destinationPath
      );

      const verification =
        await this.verifyTransfer({
          sourcePath:
            resolvedSource,
          destinationPath,
        });

      if (
        verification.verified !==
        true
      ) {
        await fs.promises.rm(
          destinationPath,
          {
            force: true,
          }
        );

        const error =
          new Error(
            "ตรวจสอบไฟล์หลังโอนไม่ผ่าน"
          );

        error.statusCode = 500;
        throw error;
      }

      const policy =
        this.readPolicy();

      const state =
        this.readState();

      const record = {
        id:
          transferId,
        status:
          "completed",
        sourcePath:
          resolvedSource,
        destinationPath,
        relativePath:
          calculatedRelativePath,
        verification,
        transferredAt:
          new Date().toISOString(),
        localCopyPreserved:
          true,
        deletionConfirmed:
          false,
        deletedAt:
          null,
      };

      state.transferHistory =
        [
          ...(state.transferHistory ||
            []),
          record,
        ].slice(
          -(
            Number(
              policy.transfer
                ?.maximumHistoryItems
            ) || 200
          )
        );

      if (
        policy.transfer
          ?.requireConfirmationBeforeLocalDeletion !==
        false
      ) {
        state
          .pendingDeletionConfirmations =
          [
            ...(
              state
                .pendingDeletionConfirmations ||
              []
            ),
            {
              confirmationId:
                createId(
                  "delete-confirmation"
                ),
              transferId,
              sourcePath:
                resolvedSource,
              destinationPath,
              createdAt:
                new Date().toISOString(),
            },
          ];
      }

      this.writeState(state);

      return {
        transfer:
          record,
        pendingDeletionConfirmation:
          state
            .pendingDeletionConfirmations
            .find(
              (item) =>
                item.transferId ===
                transferId
            ) || null,
      };
    } finally {
      this.transferActive =
        false;
    }
  }

  async confirmLocalDeletion({
    confirmationId,
  }) {
    const policy =
      this.readPolicy();

    if (
      policy.security
        ?.allowAutomaticDeletion ===
      true
    ) {
      throw new Error(
        "Automatic deletion policy must remain disabled"
      );
    }

    const state =
      this.readState();

    const confirmation =
      (
        state
          .pendingDeletionConfirmations ||
        []
      ).find(
        (item) =>
          item.confirmationId ===
          confirmationId
      );

    if (!confirmation) {
      const error =
        new Error(
          "ไม่พบคำขอยืนยันการลบ"
        );

      error.statusCode = 404;
      throw error;
    }

    const transfer =
      (
        state.transferHistory ||
        []
      ).find(
        (item) =>
          item.id ===
          confirmation.transferId
      );

    if (
      !transfer ||
      transfer.verification
        ?.verified !== true
    ) {
      const error =
        new Error(
          "ไม่สามารถลบ Local copy เพราะยังไม่มีผลตรวจสอบการโอนที่สมบูรณ์"
        );

      error.statusCode = 409;
      throw error;
    }

    const localRoot =
      this.getLocalFallbackDestination();

    if (
      !isPathInside(
        confirmation.sourcePath,
        localRoot
      )
    ) {
      const error =
        new Error(
          "Source file อยู่นอก Local fallback"
        );

      error.statusCode = 403;
      throw error;
    }

    if (
      fs.existsSync(
        confirmation.sourcePath
      )
    ) {
      await fs.promises.unlink(
        confirmation.sourcePath
      );
    }

    transfer.localCopyPreserved =
      false;

    transfer.deletionConfirmed =
      true;

    transfer.deletedAt =
      new Date().toISOString();

    state.pendingDeletionConfirmations =
      (
        state
          .pendingDeletionConfirmations ||
        []
      ).filter(
        (item) =>
          item.confirmationId !==
          confirmationId
      );

    this.writeState(state);

    return {
      deleted: true,
      transfer,
    };
  }

  cancelLocalDeletion({
    confirmationId,
  }) {
    const state =
      this.readState();

    const exists =
      (
        state
          .pendingDeletionConfirmations ||
        []
      ).some(
        (item) =>
          item.confirmationId ===
          confirmationId
      );

    if (!exists) {
      const error =
        new Error(
          "ไม่พบคำขอยืนยันการลบ"
        );

      error.statusCode = 404;
      throw error;
    }

    state.pendingDeletionConfirmations =
      (
        state
          .pendingDeletionConfirmations ||
        []
      ).filter(
        (item) =>
          item.confirmationId !==
          confirmationId
      );

    this.writeState(state);

    return {
      cancelled: true,
      confirmationId,
    };
  }
}

module.exports = {
  StorageDestinationManager,
  expandHome,
  isPathInside,
  hashFile,
};
