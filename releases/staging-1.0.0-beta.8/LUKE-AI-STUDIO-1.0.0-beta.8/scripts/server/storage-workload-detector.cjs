"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MODEL_EXTENSIONS =
  new Set([
    ".gguf",
    ".safetensors",
    ".ckpt",
    ".onnx",
    ".pth",
    ".pt",
    ".bin",
    ".mlmodel",
    ".mlpackage",
  ]);

const IMAGE_EXTENSIONS =
  new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".heic",
    ".heif",
    ".tif",
    ".tiff",
    ".svg",
  ]);

const VIDEO_EXTENSIONS =
  new Set([
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".webm",
    ".m4v",
    ".mpeg",
    ".mpg",
  ]);

const BACKUP_EXTENSIONS =
  new Set([
    ".zip",
    ".tar",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
    ".7z",
    ".rar",
    ".bak",
    ".backup",
  ]);

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

function normalizePath(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .replaceAll("\\", "/")
    .toLowerCase();
}

function detectByExtension(
  filePath
) {
  const extension =
    path.extname(
      String(
        filePath || ""
      )
    )
      .toLowerCase();

  if (
    MODEL_EXTENSIONS.has(
      extension
    )
  ) {
    return {
      workloadType:
        "models",
      confidence: 0.98,
      reason:
        `model-extension:${extension}`,
    };
  }

  if (
    IMAGE_EXTENSIONS.has(
      extension
    )
  ) {
    return {
      workloadType:
        "images",
      confidence: 0.98,
      reason:
        `image-extension:${extension}`,
    };
  }

  if (
    VIDEO_EXTENSIONS.has(
      extension
    )
  ) {
    return {
      workloadType:
        "video",
      confidence: 0.98,
      reason:
        `video-extension:${extension}`,
    };
  }

  if (
    BACKUP_EXTENSIONS.has(
      extension
    )
  ) {
    return {
      workloadType:
        "backups",
      confidence: 0.94,
      reason:
        `archive-extension:${extension}`,
    };
  }

  return null;
}

function detectByPath(
  filePath
) {
  const normalized =
    normalizePath(
      filePath
    );

  if (
    /(^|\/)(tmp|temp|cache|caches|scratch)(\/|$)/.test(
      normalized
    )
  ) {
    return {
      workloadType:
        "temporary",
      confidence: 0.90,
      reason:
        "temporary-path",
    };
  }

  if (
    /(^|\/)(models?|checkpoints?|loras?|embeddings?)(\/|$)/.test(
      normalized
    )
  ) {
    return {
      workloadType:
        "models",
      confidence: 0.86,
      reason:
        "model-path",
    };
  }

  if (
    /(^|\/)(images?|pictures?|photos?|renders?)(\/|$)/.test(
      normalized
    )
  ) {
    return {
      workloadType:
        "images",
      confidence: 0.82,
      reason:
        "image-path",
    };
  }

  if (
    /(^|\/)(videos?|movies?|clips?|footage)(\/|$)/.test(
      normalized
    )
  ) {
    return {
      workloadType:
        "video",
      confidence: 0.82,
      reason:
        "video-path",
    };
  }

  if (
    /(^|\/)(backups?|archives?|snapshots?)(\/|$)/.test(
      normalized
    )
  ) {
    return {
      workloadType:
        "backups",
      confidence: 0.82,
      reason:
        "backup-path",
    };
  }

  return null;
}

class StorageWorkloadDetector {
  constructor({
    statePath,
  }) {
    this.statePath =
      statePath;
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
        lastDetection: null,
        history: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(
    state
  ) {
    state.updatedAt =
      new Date().toISOString();

    state.history =
      (
        state.history || []
      ).slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  detect({
    sourcePath,
    workloadType = null,
    manualOverride = false,
  }) {
    const source =
      String(
        sourcePath || ""
      ).trim();

    if (!source) {
      const error =
        new Error(
          "sourcePath is required for workload detection."
        );

      error.statusCode =
        400;

      throw error;
    }

    const allowed =
      new Set([
        "models",
        "images",
        "video",
        "backups",
        "temporary",
      ]);

    if (
      manualOverride ===
        true &&
      allowed.has(
        String(
          workloadType || ""
        ).toLowerCase()
      )
    ) {
      return this.persist({
        sourcePath:
          source,
        workloadType:
          String(
            workloadType
          ).toLowerCase(),
        confidence:
          1,
        reason:
          "manual-override",
        manualOverride:
          true,
      });
    }

    const extensionResult =
      detectByExtension(
        source
      );

    if (extensionResult) {
      return this.persist({
        sourcePath:
          source,
        ...extensionResult,
        manualOverride:
          false,
      });
    }

    const pathResult =
      detectByPath(
        source
      );

    if (pathResult) {
      return this.persist({
        sourcePath:
          source,
        ...pathResult,
        manualOverride:
          false,
      });
    }

    let sizeBytes =
      null;

    try {
      const stat =
        fs.statSync(
          source
        );

      if (
        stat.isFile()
      ) {
        sizeBytes =
          stat.size;
      }
    } catch {
      sizeBytes =
        null;
    }

    if (
      Number.isFinite(
        sizeBytes
      ) &&
      sizeBytes >=
        10 *
        1024 *
        1024 *
        1024
    ) {
      return this.persist({
        sourcePath:
          source,
        workloadType:
          "video",
        confidence:
          0.55,
        reason:
          "very-large-file",
        sizeBytes,
        manualOverride:
          false,
      });
    }

    return this.persist({
      sourcePath:
        source,
      workloadType:
        "temporary",
      confidence:
        0.35,
      reason:
        "fallback",
      sizeBytes,
      manualOverride:
        false,
    });
  }

  persist(
    detection
  ) {
    const record = {
      ...detection,
      detectedAt:
        new Date().toISOString(),
    };

    const state =
      this.readState();

    state.lastDetection =
      record;

    state.history.push(
      record
    );

    this.writeState(
      state
    );

    return record;
  }

  getStatus() {
    return this.readState();
  }
}

module.exports = {
  StorageWorkloadDetector,
  detectByExtension,
  detectByPath,
  MODEL_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  BACKUP_EXTENSIONS,
};
