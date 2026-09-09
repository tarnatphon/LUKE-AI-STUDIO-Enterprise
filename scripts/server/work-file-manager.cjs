const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

function createStatusError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

const DOCUMENT_EXTS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"]);

function isInsideRoot(realRoot, realTarget) {
  return realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
}

async function resolveTarget(options = {}) {
  const root = options.root || options.projectRoot;
  const filePath = options.filePath || options.path || options.directoryPath || "";
  if (!root) throw createStatusError("Project root is required", 400);
  const realRoot = await fsp.realpath(root);
  if (typeof filePath !== "string" || path.isAbsolute(filePath)) {
    throw createStatusError("Path traversal not permitted outside project root", 400);
  }
  const targetPath = path.resolve(realRoot, filePath);
  const rel = path.relative(realRoot, targetPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw createStatusError("Path traversal not permitted outside project root", 400);
  }
  return { realRoot, filePath, targetPath };
}

async function safeRealTarget(realRoot, targetPath, filePath) {
  try {
    const realTarget = await fsp.realpath(targetPath);
    if (!isInsideRoot(realRoot, realTarget)) {
      throw createStatusError("Symlink escaping project root is forbidden", 403);
    }
    return realTarget;
  } catch (err) {
    if (err && err.statusCode) throw err;
    if (err && err.code === "ENOENT") throw createStatusError("File not found: " + filePath, 404);
    throw err;
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
    return {
      content,
      filePath,
      size: buffer.length,
      modifiedAt,
      readOnly: true,
      sourceFormat: ext.slice(1).toUpperCase()
    };
  }
  if (buffer.includes(0)) {
    throw createStatusError("Binary files are not supported for text reading", 415);
  }
  return { content: buffer.toString("utf8"), filePath, size: buffer.length, modifiedAt };
}

async function writeWorkFile(options = {}) {
  if (options.approvalGranted === false) {
    throw createStatusError("Write approval is required", 403);
  }
  const { realRoot, filePath, targetPath } = await resolveTarget(options);
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
