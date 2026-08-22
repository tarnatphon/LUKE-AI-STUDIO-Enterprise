"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { extractProjectDocument } = require("./work-project-search.cjs");

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_DOCUMENT_PREVIEW_BYTES = 10 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".pptx", ".xlsx"]);

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function resolveProjectFile(rootValue, relativeValue) {
  if (!rootValue || !path.isAbsolute(String(rootValue))) {
    throw httpError("Work file root must be an absolute path.");
  }
  const root = await fs.realpath(path.resolve(String(rootValue))).catch(() => null);
  if (!root) throw httpError("Work file root is not available.");
  const relativePath = String(relativeValue || "").replace(/\\/g, "/");
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw httpError("Work file path must stay inside the project root.");
  }
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw httpError("Work file path escaped the project root.", 403);
  }
  const realTarget = await fs.realpath(target).catch(() => null);
  if (!realTarget) throw httpError("Work file was not found.", 404);
  if (realTarget !== root && !realTarget.startsWith(`${root}${path.sep}`)) {
    throw httpError("Work file symlink escaped the project root.", 403);
  }
  return { root, target: realTarget, relativePath: path.relative(root, target).replace(/\\/g, "/") };
}

async function listWorkDirectory({ root, directoryPath = "" }) {
  if (!root || !path.isAbsolute(String(root))) throw httpError("Work directory root must be an absolute path.");
  const realRoot = await fs.realpath(path.resolve(String(root))).catch(() => null);
  if (!realRoot) throw httpError("Work directory root is not available.");
  const relative = String(directoryPath || "").replace(/\\/g, "/");
  if (path.isAbsolute(relative) || relative.split("/").includes("..")) throw httpError("Work directory path must stay inside the project root.");
  const requested = path.resolve(realRoot, relative || ".");
  const target = await fs.realpath(requested).catch(() => null);
  if (!target) throw httpError("Work directory was not found.", 404);
  if (target !== realRoot && !target.startsWith(`${realRoot}${path.sep}`)) throw httpError("Work directory symlink escaped the project root.", 403);
  const stats = await fs.stat(target);
  if (!stats.isDirectory()) throw httpError("Work directory was not found.", 404);
  const currentPath = path.relative(realRoot, requested).replace(/\\/g, "/");
  const entries = (await fs.readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".git" && !entry.name.startsWith("."))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 300)
    .map((entry) => ({ name: entry.name, path: [currentPath, entry.name].filter(Boolean).join("/"), type: entry.isDirectory() ? "folder" : "file" }));
  return { path: currentPath, parentPath: currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "", entries };
}

function assertTextBuffer(buffer) {
  if (buffer.includes(0)) throw httpError("Binary files cannot be edited in Work Files.", 415);
}

async function readWorkFile({ root, filePath }) {
  const resolved = await resolveProjectFile(root, filePath);
  const stats = await fs.stat(resolved.target).catch(() => null);
  if (!stats?.isFile()) throw httpError("Work file was not found.", 404);
  const extension = path.extname(resolved.target).toLowerCase();
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    if (stats.size > MAX_DOCUMENT_PREVIEW_BYTES) throw httpError("Work Files can preview documents up to 10 MB.", 413);
    const content = await extractProjectDocument(await fs.readFile(resolved.target), extension);
    if (!content) throw httpError("No readable text was found in this document.", 415);
    return { path: resolved.relativePath, content, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString(), readOnly: true, sourceFormat: extension.slice(1).toUpperCase() };
  }
  if (stats.size > MAX_TEXT_FILE_BYTES) throw httpError("Work Files can open text files up to 1 MB.", 413);
  const buffer = await fs.readFile(resolved.target);
  assertTextBuffer(buffer);
  return { path: resolved.relativePath, content: buffer.toString("utf8"), sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
}

async function writeWorkFile({ root, filePath, content, approvalGranted, expectedModifiedAt }) {
  if (approvalGranted !== true) throw httpError("Explicit approval is required before saving a Work file.", 403);
  const resolved = await resolveProjectFile(root, filePath);
  const stats = await fs.stat(resolved.target).catch(() => null);
  if (!stats?.isFile()) throw httpError("Work file was not found.", 404);
  if (expectedModifiedAt && stats.mtime.toISOString() !== String(expectedModifiedAt)) {
    throw httpError("Work file changed on disk. Reload it before saving.", 409);
  }
  const text = String(content ?? "");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_TEXT_FILE_BYTES) throw httpError("Work Files can save text files up to 1 MB.", 413);
  const existing = await fs.readFile(resolved.target);
  assertTextBuffer(existing);
  const temporary = `${resolved.target}.luke-tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporary, text, { encoding: "utf8", mode: stats.mode });
    const latestStats = await fs.stat(resolved.target).catch(() => null);
    if (!latestStats || latestStats.mtimeMs !== stats.mtimeMs || latestStats.size !== stats.size) {
      throw httpError("Work file changed on disk. Reload it before saving.", 409);
    }
    await fs.rename(temporary, resolved.target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  const savedStats = await fs.stat(resolved.target);
  return { path: resolved.relativePath, sizeBytes: bytes, modifiedAt: savedStats.mtime.toISOString(), saved: true };
}

module.exports = { MAX_DOCUMENT_PREVIEW_BYTES, MAX_TEXT_FILE_BYTES, listWorkDirectory, readWorkFile, writeWorkFile };
