#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const APP = path.join(ROOT, "app");
const CONFIG_FILE = path.join(APP, "config", "update.json");
const VERSION_FILE = path.join(APP, "version.json");
const STATE_DIR = path.join(APP, "update-state");
const STATUS_FILE = path.join(STATE_DIR, "status.json");
const MANAGED_FILE = path.join(STATE_DIR, "managed-files.json");
const LOG_FILE = path.join(STATE_DIR, "updater.log");

fs.mkdirSync(STATE_DIR, { recursive: true });

function now() { return new Date().toISOString(); }
function log(message) {
  const line = `[${now()}] ${message}`;
  console.log(`  [Update] ${message}`);
  fs.appendFileSync(LOG_FILE, `${line}\n`);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
function status(state, extra = {}) {
  writeJsonAtomic(STATUS_FILE, { state, updatedAt: now(), ...extra });
}
function normalizeRel(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
function isProtected(rel, protectedPaths) {
  const n = normalizeRel(rel);
  return protectedPaths.some((p) => n === normalizeRel(p) || n.startsWith(`${normalizeRel(p)}/`));
}
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(/[.-]/).map((x) => /^\d+$/.test(x) ? Number(x) : x);
  const pb = String(b).replace(/^v/, "").split(/[.-]/).map((x) => /^\d+$/.test(x) ? Number(x) : x);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0; const y = pb[i] ?? 0;
    if (typeof x === "number" && typeof y === "number" && x !== y) return x > y ? 1 : -1;
    if (String(x) !== String(y)) return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}
function requestBuffer(url, timeoutMs, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, { headers: { "User-Agent": "Local-AI-Updater/1.0", Accept: "application/json, application/octet-stream" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(requestBuffer(next, timeoutMs, redirects + 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Connection timeout")));
    req.on("error", reject);
  });
}
async function fetchJson(url, timeoutMs) {
  if (url.startsWith("file://")) return readJson(new URL(url), null);
  const buffer = await requestBuffer(url, timeoutMs);
  return JSON.parse(buffer.toString("utf8"));
}
async function download(url, destination, timeoutMs) {
  const buffer = url.startsWith("file://") ? fs.readFileSync(new URL(url)) : await requestBuffer(url, Math.max(timeoutMs, 30000));
  fs.writeFileSync(destination, buffer);
}
function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}
function walkFiles(base, prefix = "") {
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const rel = normalizeRel(path.join(prefix, entry.name));
    const abs = path.join(base, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}
function copyFileSafe(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  try { fs.chmodSync(destination, fs.statSync(source).mode); } catch {}
}
function removeEmptyParents(start, stop) {
  let current = path.dirname(start);
  while (current.startsWith(stop) && current !== stop) {
    try { if (fs.readdirSync(current).length === 0) fs.rmdirSync(current); else break; } catch { break; }
    current = path.dirname(current);
  }
}
function extractPackage(pkg, destination) {
  fs.mkdirSync(destination, { recursive: true });
  let result;
  if (pkg.endsWith(".zip")) {
    if (process.platform === "win32") {
      result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Expand-Archive -LiteralPath '${pkg.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`], { stdio: "inherit" });
    } else {
      result = spawnSync("unzip", ["-q", "-o", pkg, "-d", destination], { stdio: "inherit" });
    }
  } else if (pkg.endsWith(".tar.gz") || pkg.endsWith(".tgz")) {
    result = spawnSync("tar", ["-xzf", pkg, "-C", destination], { stdio: "inherit" });
  } else {
    throw new Error("Unsupported update package format");
  }
  if (!result || result.status !== 0) throw new Error("Unable to extract update package");
}
function findPayload(extractDir) {
  const direct = path.join(extractDir, "Local AI");
  if (fs.existsSync(path.join(direct, "app"))) return direct;
  if (fs.existsSync(path.join(extractDir, "app"))) return extractDir;
  const dirs = fs.readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const dir of dirs) {
    const candidate = path.join(extractDir, dir.name);
    if (fs.existsSync(path.join(candidate, "app"))) return candidate;
  }
  throw new Error("Update package does not contain a valid Local AI payload");
}
function healthCheck(root) {
  const required = ["app/version.json", "app/dist/index.html", "scripts/server/serve.cjs"];
  for (const rel of required) if (!fs.existsSync(path.join(root, rel))) return { ok: false, reason: `Missing ${rel}` };
  const node = process.execPath;
  const syntax = spawnSync(node, ["--check", path.join(root, "scripts", "server", "serve.cjs")], { encoding: "utf8" });
  if (syntax.status !== 0) return { ok: false, reason: syntax.stderr || "Server syntax check failed" };
  const version = readJson(path.join(root, "app", "version.json"), null);
  if (!version?.version) return { ok: false, reason: "Invalid version metadata" };
  return { ok: true, version: version.version };
}
function installPayload(payload, config, nextVersion) {
  const protectedPaths = Array.isArray(config.protectedPaths) ? config.protectedPaths : [];
  const allPayloadFiles = walkFiles(payload).filter((rel) => !isProtected(rel, protectedPaths));
  const oldManaged = readJson(MANAGED_FILE, { files: [] }).files || [];
  const backupRoot = path.join(STATE_DIR, `rollback-${Date.now()}`);
  const changed = new Set([...oldManaged, ...allPayloadFiles]);
  fs.mkdirSync(backupRoot, { recursive: true });

  for (const rel of changed) {
    if (isProtected(rel, protectedPaths)) continue;
    const existing = path.join(ROOT, rel);
    if (fs.existsSync(existing) && fs.statSync(existing).isFile()) copyFileSafe(existing, path.join(backupRoot, rel));
  }
  writeJsonAtomic(path.join(backupRoot, "rollback.json"), { previousVersion: readJson(VERSION_FILE, {}).version || "unknown", files: [...changed] });

  try {
    for (const rel of allPayloadFiles) copyFileSafe(path.join(payload, rel), path.join(ROOT, rel));
    if (config.cleanupOldVersion !== false) {
      const newSet = new Set(allPayloadFiles);
      for (const rel of oldManaged) {
        if (newSet.has(rel) || isProtected(rel, protectedPaths)) continue;
        const target = path.join(ROOT, rel);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          fs.unlinkSync(target);
          removeEmptyParents(target, ROOT);
        }
      }
    }
    const health = healthCheck(ROOT);
    if (!health.ok || compareVersions(health.version, nextVersion) !== 0) throw new Error(health.reason || "Installed version did not match manifest");
    writeJsonAtomic(MANAGED_FILE, { version: nextVersion, files: allPayloadFiles });
    fs.rmSync(backupRoot, { recursive: true, force: true });
    return health;
  } catch (error) {
    log(`Health check failed; rolling back: ${error.message}`);
    for (const rel of changed) {
      if (isProtected(rel, protectedPaths)) continue;
      const target = path.join(ROOT, rel);
      const backup = path.join(backupRoot, rel);
      if (fs.existsSync(backup)) copyFileSafe(backup, target);
      else if (fs.existsSync(target) && fs.statSync(target).isFile()) fs.unlinkSync(target);
    }
    fs.rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const config = readJson(CONFIG_FILE, {});
  const current = readJson(VERSION_FILE, { version: "0.0.0" });
  const manifestUrl = process.env.LOCAL_AI_UPDATE_MANIFEST || config.manifestUrl || "";

  if (args.has("--health-check")) {
    const health = healthCheck(ROOT);
    console.log(JSON.stringify(health));
    process.exit(health.ok ? 0 : 1);
  }
  if (config.enabled === false || config.checkOnLaunch === false) {
    status("disabled", { currentVersion: current.version });
    return;
  }
  if (!manifestUrl) {
    status("not-configured", { currentVersion: current.version, message: "Running installed version; update source is not configured." });
    log(`Running installed version ${current.version}; update source is not configured.`);
    return;
  }

  status("checking", { currentVersion: current.version });
  let manifest;
  try {
    manifest = await fetchJson(manifestUrl, Number(config.timeoutMs) || 2500);
  } catch (error) {
    status("offline", { currentVersion: current.version, message: error.message });
    log(`Offline or update server unavailable. Continuing with installed version ${current.version}.`);
    return;
  }

  const channel = process.env.LOCAL_AI_UPDATE_CHANNEL || config.channel || "stable";
  const release = manifest.channels?.[channel] || manifest;
  if (!release?.version) throw new Error("Update manifest has no version");
  if (compareVersions(release.version, current.version) <= 0) {
    status("up-to-date", { currentVersion: current.version, latestVersion: release.version });
    log(`Local AI ${current.version} is up to date.`);
    return;
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const asset = release.assets?.[platformKey] || release.assets?.[process.platform] || release.asset;
  if (!asset?.url || !asset?.sha256) {
    status("incompatible", { currentVersion: current.version, latestVersion: release.version, platform: platformKey });
    log(`Update ${release.version} is not available for ${platformKey}. Continuing with ${current.version}.`);
    return;
  }
  if (config.autoInstall === false && !args.has("--install")) {
    status("available", { currentVersion: current.version, latestVersion: release.version });
    log(`Update ${release.version} is available.`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "local-ai-update-"));
  const ext = asset.url.endsWith(".tar.gz") ? ".tar.gz" : asset.url.endsWith(".tgz") ? ".tgz" : ".zip";
  const pkg = path.join(tempRoot, `update${ext}`);
  const extractDir = path.join(tempRoot, "extract");
  try {
    status("downloading", { currentVersion: current.version, latestVersion: release.version });
    log(`Downloading Local AI ${release.version}...`);
    await download(asset.url, pkg, Number(config.timeoutMs) || 2500);
    const actualHash = sha256(pkg);
    if (actualHash.toLowerCase() !== String(asset.sha256).toLowerCase()) throw new Error("SHA256 verification failed");
    extractPackage(pkg, extractDir);
    const payload = findPayload(extractDir);
    const packageHealth = healthCheck(payload);
    if (!packageHealth.ok || compareVersions(packageHealth.version, release.version) !== 0) throw new Error(packageHealth.reason || "Update package version mismatch");
    status("installing", { currentVersion: current.version, latestVersion: release.version });
    installPayload(payload, config, release.version);
    status("updated", { previousVersion: current.version, currentVersion: release.version, oldVersionRemoved: config.cleanupOldVersion !== false });
    log(`Updated successfully to ${release.version}. Previous managed version removed.`);
  } catch (error) {
    status("failed", { currentVersion: current.version, latestVersion: release.version, message: error.message });
    log(`Update failed. Continuing with installed version ${current.version}: ${error.message}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const current = readJson(VERSION_FILE, { version: "unknown" });
  status("failed", { currentVersion: current.version, message: error.message });
  log(`Updater error. Continuing with installed version: ${error.message}`);
  process.exitCode = 0;
});
