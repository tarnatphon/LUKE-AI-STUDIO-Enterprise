"use strict";

/**
 * sha256 of a file, streamed. One copy, because there were four.
 *
 * The storage managers (archive restore, cloud integrity, the integrity scanner,
 * the safe-archive writer) each carried the same twenty lines. They hashed the
 * same bytes the same way, so the duplication was harmless — until one of them
 * is fixed and the others are not, and two components disagree about whether a
 * multi-gigabyte archive is intact.
 *
 * Streamed on purpose: these files are models and archives, and reading one into
 * memory to hash it is how a machine with 16 GB of RAM fails to verify a 20 GB
 * backup. A missing file rejects with ENOENT from the read stream; callers that
 * want a message of their own catch it.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

module.exports = { sha256File };
