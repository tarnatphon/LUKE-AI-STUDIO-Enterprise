"use strict";

/**
 * The Egress Ledger — proof, not marketing.
 *
 * "100% offline" is a sentence. This is a dated, append-only record of every
 * outbound request LUKE's online surfaces make: which host, which provider,
 * which surface, how many bytes, and whether the policy allowed it. No prompt,
 * no key, no response body is ever written — only the shape of the departure.
 *
 * The report endpoint turns it into a one-page attestation a user can hand to
 * a client or keep for themselves. It deliberately states its own scope: it
 * proves what LUKE sent, not what the OS, the browser or another app did.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_FILE = path.join(ROOT, "app", "runtime-state", "egress", "ledger.jsonl");
const MAX_ENTRIES = 5000;

function ledgerFile() {
  const override = String(process.env.LUKE_EGRESS_LEDGER_FILE || "").trim();
  return override || DEFAULT_FILE;
}

function safeHost(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.username || url.password) return `${url.protocol}//[credentials removed]`;
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(rawUrl || "unknown").slice(0, 120);
  }
}

function safeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

/**
 * Record one departure. `entry` is whitelisted field by field: a caller cannot
 * accidentally smuggle a prompt or a token into the ledger by passing an extra
 * property.
 */
function record(entry = {}) {
  const row = {
    at: new Date().toISOString(),
    surface: String(entry.surface || "unknown").slice(0, 60),
    provider: String(entry.provider || "").slice(0, 80),
    host: safeHost(entry.url || entry.host || ""),
    method: String(entry.method || "POST").slice(0, 10).toUpperCase(),
    bytes: safeInt(entry.bytes),
    decision: entry.decision === "blocked" ? "blocked" : "allowed",
    reason: String(entry.reason || "").slice(0, 200),
    model: String(entry.model || "").slice(0, 120),
    paid: entry.paid === true,
  };

  try {
    const file = ledgerFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
    trim();
  } catch {
    // A ledger that cannot write must never break the turn it is describing.
  }

  return row;
}

/** Keep the file bounded without rewriting it on every request. */
function trim() {
  try {
    const file = ledgerFile();
    if (fs.statSync(file).size < 2 * 1024 * 1024) return;
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    if (lines.length <= MAX_ENTRIES) return;
    fs.writeFileSync(file, `${lines.slice(-MAX_ENTRIES).join("\n")}\n`, { mode: 0o600 });
  } catch {}
}

function list(limit = 200) {
  const capped = Math.min(Math.max(safeInt(limit, 200), 1), MAX_ENTRIES);
  try {
    const lines = fs.readFileSync(ledgerFile(), "utf8").split("\n").filter(Boolean);
    return lines.slice(-capped).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function stats() {
  const rows = list(MAX_ENTRIES);
  const byHost = {};
  let allowed = 0;
  let blocked = 0;
  let bytes = 0;

  for (const row of rows) {
    if (row.decision === "blocked") blocked += 1;
    else allowed += 1;
    bytes += safeInt(row.bytes);
    byHost[row.host] = (byHost[row.host] || 0) + 1;
  }

  return {
    entries: rows.length,
    allowed,
    blocked,
    bytes,
    paidCalls: rows.filter((row) => row.paid === true && row.decision === "allowed").length,
    byHost,
    firstAt: rows.length ? rows[0].at : null,
    lastAt: rows.length ? rows[rows.length - 1].at : null,
  };
}

/** A one-page attestation. Text form is available with ?format=text. */
function report() {
  const rows = list(MAX_ENTRIES);
  const numbers = stats();
  const digest = crypto
    .createHash("sha256")
    .update(rows.map((row) => JSON.stringify(row)).join("\n"))
    .digest("hex");

  const attestation = [
    "LUKE AI STUDIO — Air-gap attestation",
    `Generated: ${new Date().toISOString()}`,
    `Ledger entries in scope: ${numbers.entries}`,
    `Allowed outbound requests: ${numbers.allowed}`,
    `Blocked by policy: ${numbers.blocked}`,
    `Paid endpoints called: ${numbers.paidCalls}`,
    `Ledger SHA-256: ${digest}`,
    "",
    "Scope: this attests to outbound HTTP requests made through LUKE's online",
    "surfaces (the free cloud chain, channel relay, media dispatch and the",
    "external gateway). OS, browser and third-party traffic are out of scope.",
    "A zero-entry report means LUKE recorded no departures in the retained",
    "window; verify at the network layer for regulated work.",
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    claim: numbers.entries === 0
      ? "No outbound requests recorded by LUKE's online surfaces."
      : `${numbers.allowed} outbound requests recorded; ${numbers.paidCalls} reached a paid endpoint.`,
    attestation,
    digest,
    stats: numbers,
    recent: rows.slice(-25),
    file: path.relative(ROOT, ledgerFile()),
    scope: "LUKE online surfaces only; OS/browser traffic is out of scope",
  };
}

function clear() {
  try {
    const file = ledgerFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "", { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ledgerFile,
  safeHost,
  record,
  list,
  stats,
  report,
  clear,
  MAX_ENTRIES,
  DEFAULT_FILE,
};
