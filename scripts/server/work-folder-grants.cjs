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

/**
 * Chat folders use the same grant machinery as Work projects, but their owner
 * is a conversation ("chat:<id>") instead of a project. That keeps one single
 * enforcement path — and lets the server refuse anything that writes.
 */
function chatScopeId(conversationId) {
  const id = String(conversationId || "").trim();
  if (!id) throw permissionError("A conversation is required before granting folder access.");
  return `chat:${id}`;
}

function isChatScope(owner) {
  return String(owner || "").startsWith("chat:");
}

function grantWorkFolder({ projectId, root, scope }) {
  const owner = String(scope || projectId || "").trim();
  if (!owner) throw permissionError("A Work project is required before granting folder access.");
  const canonicalRoot = canonicalDirectory(root);
  const grantId = crypto.randomBytes(24).toString("base64url");
  grants.set(grantId, { projectId: owner, root: canonicalRoot, chat: isChatScope(owner) });
  return { grantId, root: canonicalRoot, projectId: owner };
}

function grantChatFolder({ conversationId, root, canWrite = false }) {
  const granted = grantWorkFolder({ scope: chatScopeId(conversationId), root });
  const grant = grants.get(granted.grantId);
  // Editing is opt-in per folder: the user ticks it while approving the path.
  if (grant) grant.canWrite = canWrite === true;
  return { ...granted, canWrite: grant ? grant.canWrite === true : false };
}

/**
 * A chat folder may only be written to when the user ticked "allow editing"
 * while approving it. Work projects keep their own approval policy.
 */
function assertChatFolderWrite({ projectId, root, grantId }) {
  const canonicalRoot = assertWorkFolderGrant({ projectId, root, grantId });
  if (!isChatScope(projectId)) return canonicalRoot;
  const grant = grants.get(String(grantId || ""));
  if (!grant || grant.canWrite !== true) {
    const error = new Error(
      "This folder was approved for reading only. Attach it again and allow editing to change files."
    );
    error.statusCode = 403;
    error.code = "CHAT_FOLDER_READ_ONLY";
    throw error;
  }
  return canonicalRoot;
}

/**
 * Normal chat may read an approved folder but must never change the disk.
 * Editing stays a Work Mode capability, so any write-style call made with a
 * chat grant is refused here, no matter which endpoint it comes from.
 */
function assertNotChatScope(projectId) {
  if (!isChatScope(projectId)) return;
  const error = new Error(
    "This folder was approved for reading in chat. Switch to Work Mode (or open the project there) to edit files, run commands, or use the terminal."
  );
  error.statusCode = 403;
  error.code = "CHAT_FOLDER_READ_ONLY";
  throw error;
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

module.exports = {
  assertWorkFolderGrant,
  assertChatFolderWrite,
  assertNotChatScope,
  grantWorkFolder,
  grantChatFolder,
  revokeWorkFolderGrant,
  isChatScope,
  chatScopeId,
};
