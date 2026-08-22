"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const grants = new Map();

function permissionError(message = "This Work folder needs permission. Open Edit project and grant access to it again.") {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = "WORK_FOLDER_PERMISSION_REQUIRED";
  return error;
}

function canonicalDirectory(value) {
  const candidate = String(value || "").trim();
  if (!candidate || !path.isAbsolute(candidate)) throw permissionError("Work folder access requires an absolute selected folder.");
  let canonical;
  try {
    canonical = fs.realpathSync(candidate);
  } catch {
    throw permissionError("The selected Work folder is no longer available.");
  }
  if (!fs.statSync(canonical).isDirectory()) throw permissionError("The selected Work path is not a folder.");
  return canonical;
}

function grantWorkFolder({ projectId, root }) {
  const owner = String(projectId || "").trim();
  if (!owner) throw permissionError("A Work project is required before granting folder access.");
  const canonicalRoot = canonicalDirectory(root);
  const grantId = crypto.randomBytes(24).toString("base64url");
  grants.set(grantId, { projectId: owner, root: canonicalRoot });
  return { grantId, root: canonicalRoot };
}

function assertWorkFolderGrant({ projectId, root, grantId }) {
  const grant = grants.get(String(grantId || ""));
  const owner = String(projectId || "").trim();
  if (!grant || !owner || grant.projectId !== owner) throw permissionError();
  const canonicalRoot = canonicalDirectory(root);
  if (grant.root !== canonicalRoot) throw permissionError("Permission does not match this Work folder.");
  return canonicalRoot;
}

function revokeWorkFolderGrant({ projectId, grantId }) {
  const grant = grants.get(String(grantId || ""));
  if (grant && grant.projectId === String(projectId || "").trim()) grants.delete(grantId);
}

module.exports = { assertWorkFolderGrant, grantWorkFolder, revokeWorkFolderGrant };
