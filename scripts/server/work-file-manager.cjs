const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const {
  assertStaysInsideRoot,
  createHttpError: createGuardError,
  resolveInsideRoot,
} = require("./work-path-guard.cjs");

function createStatusError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

const DOCUMENT_EXTS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"]);

// Bound extracted document previews so a single giant file cannot blow up chat context.
const MAX_DOCUMENT_PREVIEW_BYTES = 256 * 1024;

// Every path decision is delegated to the shared guard so Work Mode and the
// approved chat folder cannot drift apart.
async function resolveTarget(options = {}) {
  const filePath = options.filePath || options.path || options.directoryPath || "";
  const { realRoot, targetPath, relativePath } = await resolveInsideRoot({
    root: options.root || options.projectRoot,
    targetPath: filePath,
    allowMissing: true,
  });
  return { realRoot, filePath: relativePath, targetPath };
}

async function safeRealTarget(realRoot, targetPath, filePath) {
  try {
    return await assertStaysInsideRoot(realRoot, targetPath, { allowMissing: false });
  } catch (error) {
    if (error && error.statusCode === 404) throw createGuardError(`File not found: ${filePath}`, 404);
    throw error;
  }
}

async function listWorkDirectory(options = {}) {
  const { realRoot, filePath, targetPath } = await resolveTarget(options);
  const realTarget = await safeRealTarget(realRoot, targetPath, filePath);
  const stat = await fsp.stat(realTarget);
  if (!stat.isDirectory()) throw createStatusError("Not a directory", 400);
  const dirents = await fsp.readdir(realTarget, { withFileTypes: true });
  const entries = dirents.map((d) => ({
    name: d.name,
    path: filePath ? path.join(filePath, d.name).replace(/\\/g, "/") : d.name,
    isDirectory: d.isDirectory()
  }));
  return { path: filePath, entries };
}

async function readWorkFile(options = {}) {
  const { realRoot, filePath, targetPath } = await resolveTarget(options);
  const realTarget = await safeRealTarget(realRoot, targetPath, filePath);
  const stat = await fsp.stat(realTarget);
  if (stat.isDirectory()) throw createStatusError("Cannot read a directory as a file", 400);
  const buffer = await fsp.readFile(realTarget);
  const modifiedAt = stat.mtime.toISOString();
  const ext = path.extname(realTarget).toLowerCase();
  if (DOCUMENT_EXTS.has(ext)) {
    const { extractProjectDocument } = require("./work-project-search.cjs");
    const content = await extractProjectDocument(buffer, ext);
    const preview = content.length > MAX_DOCUMENT_PREVIEW_BYTES ? content.slice(0, MAX_DOCUMENT_PREVIEW_BYTES) : content;
    return {
      content: preview,
      filePath,
      size: buffer.length,
      modifiedAt,
      readOnly: true,
      sourceFormat: ext.slice(1).toUpperCase(),
      truncated: content.length > MAX_DOCUMENT_PREVIEW_BYTES
    };
  }
  if (buffer.includes(0)) {
    throw createStatusError("Binary files are not supported for text reading", 415);
  }
  return { content: buffer.toString("utf8"), filePath, size: buffer.length, modifiedAt };
}

async function writeWorkFile(options = {}) {
  if (options.approvalGranted !== true) {
    throw createStatusError("Write approval is required", 403);
  }
  const { realRoot, filePath, targetPath } = await resolveTarget(options);
  // A brand new file has no realpath yet, so prove the closest existing
  // ancestor is inside the root as well (resolveInsideRoot already did, this
  // re-checks right before the write so nothing changed in between).
  await assertStaysInsideRoot(realRoot, targetPath, { allowMissing: true });
  const body = options.content;
  if (typeof body !== "string") throw createStatusError("Text content is required", 400);
  const dir = path.dirname(targetPath);
  if (fs.existsSync(targetPath)) {
    const realTarget = await safeRealTarget(realRoot, targetPath, filePath);
    const current = await fsp.stat(realTarget);
    if (options.expectedModifiedAt && current.mtime.toISOString() !== options.expectedModifiedAt) {
      throw createStatusError("File was modified by another writer", 409);
    }
  } else if (options.expectedModifiedAt) {
    throw createStatusError("File was modified by another writer", 409);
  }
  if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
  const tempFile = targetPath + ".tmp." + process.pid + "." + Date.now();
  await fsp.writeFile(tempFile, body, "utf8");
  await fsp.rename(tempFile, targetPath);
  const savedStat = await fsp.stat(targetPath);
  return {
    success: true,
    saved: true,
    filePath,
    bytes: Buffer.byteLength(body, "utf8"),
    modifiedAt: savedStat.mtime.toISOString()
  };
}

class WorkFileManager {
  constructor(projectRoot = process.cwd()) { this.projectRoot = projectRoot; }
  readWorkFile(arg1, arg2) {
    const options = typeof arg1 === "object" && arg1 !== null ? arg1 : { filePath: arg1, ...(arg2 || {}), root: (arg2 && arg2.root) || this.projectRoot };
    return readWorkFile(options);
  }
  writeWorkFile(arg1, content, extra = {}) {
    const options = typeof arg1 === "object" && arg1 !== null ? arg1 : { filePath: arg1, content, ...extra, root: extra.root || this.projectRoot };
    return writeWorkFile(options);
  }
  listWorkDirectory(options = {}) {
    return listWorkDirectory({ root: this.projectRoot, ...options });
  }
}

module.exports = {
  WorkFileManager,
  listWorkDirectory,
  readWorkFile,
  writeWorkFile,
  readProjectFile: readWorkFile,
  writeProjectFile: writeWorkFile
};
