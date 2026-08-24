"use strict";

// LUKE_AI_WORK_FILE_MANAGER_V2
//
// Project-confined file access for Work. All roots are canonicalized with
// realpath so that macOS /private/var and /var path aliases never bypass the
// containment check, and symlink escapes are rejected by canonical target
// comparison.

const fs = require("node:fs");
const path = require("node:path");
const {
  extractProjectDocument,
} = require("./work-project-search.cjs");

const PREVIEWABLE_DOCUMENTS = new Map([
  [".doc", "DOC"],
  [".docx", "DOCX"],
  [".pptx", "PPTX"],
  [".xlsx", "XLSX"],
  [".pdf", "PDF"],
]);
const MAX_DOCUMENT_PREVIEW_BYTES = 10 * 1024 * 1024;
// Tolerance for optimistic-concurrency mtime comparison across filesystems.
const MTIME_COMPARE_EPSILON_MS = 5;

function createStatusError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}

class WorkFileManager {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  resolveRootAndPath(arg1, arg2) {
    let root = this.projectRoot;
    let filePath = "";

    if (typeof arg1 === "object" && arg1 !== null) {
      root = arg1.root || arg1.projectRoot || this.projectRoot;
      filePath =
        arg1.filePath ||
        arg1.path ||
        arg1.directoryPath ||
        "";
    } else if (typeof arg1 === "string") {
      filePath = arg1;
      if (typeof arg2 === "object" && arg2 !== null) {
        root = arg2.root || arg2.projectRoot || this.projectRoot;
      }
    }

    const realRoot = fs.existsSync(root)
      ? fs.realpathSync(root)
      : path.resolve(root);

    // Resolve the target against the canonical root so that macOS
    // /private/var aliases can never bypass the containment check.
    const targetPath = path.resolve(realRoot, filePath);
    const rel = path.relative(realRoot, targetPath);

    if (rel === ".." || rel.startsWith(`..${path.sep}`)) {
      throw createStatusError(
        "Path traversal not permitted outside project root",
        400
      );
    }

    return {
      root,
      realRoot,
      filePath,
      targetPath,
    };
  }

  assertInsideRoot(realRoot, targetPath) {
    const realTarget = fs.realpathSync(targetPath);

    if (
      realTarget !== realRoot &&
      !realTarget.startsWith(realRoot + path.sep)
    ) {
      throw createStatusError(
        "Work file symlink escaped the project root.",
        403
      );
    }

    return realTarget;
  }

  async readWorkFile(arg1, arg2) {
    const {
      realRoot,
      targetPath,
      filePath,
    } = this.resolveRootAndPath(arg1, arg2);

    if (!fs.existsSync(targetPath)) {
      throw createStatusError(`File not found: ${filePath}`, 404);
    }

    const realTarget = this.assertInsideRoot(realRoot, targetPath);
    const stat = fs.statSync(realTarget);
    const modifiedAt = stat.mtimeMs;
    const extension = path.extname(realTarget).toLowerCase();
    const sourceFormat = PREVIEWABLE_DOCUMENTS.get(extension);

    if (sourceFormat) {
      if (stat.size > MAX_DOCUMENT_PREVIEW_BYTES) {
        throw createStatusError(
          "Document is too large to preview.",
          413
        );
      }

      const buffer = fs.readFileSync(realTarget);
      const content = await extractProjectDocument(buffer, extension);

      return {
        content,
        filePath,
        size: stat.size,
        modifiedAt,
        readOnly: true,
        sourceFormat,
      };
    }

    const buffer = fs.readFileSync(realTarget);

    if (buffer.includes(0)) {
      throw createStatusError(
        "Binary files are not supported for text reading",
        415
      );
    }

    return {
      content: buffer.toString("utf8"),
      filePath,
      size: buffer.length,
      modifiedAt,
      readOnly: false,
    };
  }

  async writeWorkFile(arg1, arg2, arg3) {
    let request;

    if (typeof arg1 === "object" && arg1 !== null) {
      request = {
        root: arg1.root || arg1.projectRoot,
        filePath: arg1.filePath || arg1.path,
        content: arg1.content,
        approvalGranted: arg1.approvalGranted,
        expectedModifiedAt: arg1.expectedModifiedAt,
      };
    } else {
      const options =
        arg3 && typeof arg3 === "object"
          ? arg3
          : arg2 && typeof arg2 === "object" && arg2 !== null
            ? arg2
            : {};

      request = {
        root: options.root || options.projectRoot,
        filePath:
          typeof arg1 === "string" ? arg1 : arg1?.filePath || arg1?.path,
        content:
          typeof arg2 === "string" ? arg2 : arg2?.content,
        approvalGranted: options.approvalGranted,
        expectedModifiedAt: options.expectedModifiedAt,
      };
    }

    // Writes always require explicit approval (the Work approval mode from
    // the UI is forwarded as approvalGranted by the server).
    if (request.approvalGranted !== true) {
      throw createStatusError(
        "Writing project files requires explicit approval.",
        403
      );
    }

    const {
      realRoot,
      targetPath,
      filePath,
    } = this.resolveRootAndPath({
      root: request.root,
      filePath: request.filePath,
    });

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      throw createStatusError(`File not found: ${filePath}`, 404);
    }

    this.assertInsideRoot(realRoot, targetPath);

    if (
      request.expectedModifiedAt !== undefined &&
      request.expectedModifiedAt !== null
    ) {
      const expected = Number(request.expectedModifiedAt);
      const current = fs.statSync(targetPath).mtimeMs;

      if (
        !Number.isFinite(expected) ||
        Math.abs(current - expected) > MTIME_COMPARE_EPSILON_MS
      ) {
        throw createStatusError(
          "File changed since it was opened. Reload and retry.",
          409
        );
      }
    }

    const body = String(request.content ?? "");
    const directory = path.dirname(targetPath);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, {
        recursive: true,
      });
    }

    // Atomic write: temporary file in the same directory, then rename.
    const tempFile = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

    try {
      fs.writeFileSync(tempFile, body, "utf8");
      fs.renameSync(tempFile, targetPath);
    } catch (error) {
      await fs.promises.rm(tempFile, {
        force: true,
      });
      throw error;
    }

    return {
      saved: true,
      filePath,
      modifiedAt: fs.statSync(targetPath).mtimeMs,
      bytes: Buffer.byteLength(body, "utf8"),
    };
  }

  async getWorkTerminalSession(options = {}) {
    const root =
      options.root || options.projectRoot || this.projectRoot;
    const realRoot = fs.existsSync(root)
      ? fs.realpathSync(root)
      : path.resolve(root);

    return {
      cwd: realRoot,
      prompt: "project >",
      changeDirectoryCommand: `cd "${realRoot}"`,
    };
  }

  async listWorkDirectory(options = {}) {
    const {
      realRoot,
      targetPath,
      filePath,
    } = this.resolveRootAndPath(options);

    if (!fs.existsSync(targetPath)) {
      throw createStatusError(`Directory not found: ${filePath}`, 404);
    }

    this.assertInsideRoot(realRoot, targetPath);

    if (!fs.statSync(targetPath).isDirectory()) {
      throw createStatusError(
        `Not a directory: ${filePath || "."}`,
        400
      );
    }

    const dirents = fs.readdirSync(targetPath, {
      withFileTypes: true,
    });

    const entries = dirents
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((dirent) => {
        const rel = filePath
          ? path.join(filePath, dirent.name)
          : dirent.name;
        return {
          name: dirent.name,
          path: rel,
          isDirectory: dirent.isDirectory(),
        };
      });

    return {
      path: filePath,
      entries,
    };
  }
}

const defaultManager = new WorkFileManager();

module.exports = {
  WorkFileManager,
  readWorkFile: (arg1, arg2) => defaultManager.readWorkFile(arg1, arg2),
  writeWorkFile: (arg1, content, options) =>
    defaultManager.writeWorkFile(arg1, content, options),
  getWorkTerminalSession: (options) =>
    defaultManager.getWorkTerminalSession(options),
  listWorkDirectory: (options) =>
    defaultManager.listWorkDirectory(options),
  readProjectFile: (arg1, arg2) => defaultManager.readWorkFile(arg1, arg2),
  writeProjectFile: (arg1, content, options) =>
    defaultManager.writeWorkFile(arg1, content, options),
};
