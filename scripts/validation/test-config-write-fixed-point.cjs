#!/usr/bin/env node
"use strict";

/**
 * A tracked config the server can write must be a fixed point of the
 * server's own writer.
 *
 * The app runs from a git checkout on the user's disk. A settings save that
 * changed nothing used to rewrite
 * app/config/text-chat/runtime-supervisor-policy.json with the full default
 * schema even though the committed file carried only the security block -
 * one ordinary save turned a clean checkout into a dirty one, and the next
 * update that touched the file refused to merge over it. The same shape
 * existed in the image-to-video record files, which shipped another
 * computer's "ready" answer into every clone.
 *
 * So this boots a throwaway checkout the app has never written to and checks
 * the class end to end:
 *
 *   - booting rewrites nothing under app/config
 *   - saving a policy back to itself is a byte-for-byte no-op
 *   - a policy that really changed still lands
 *   - the image-to-video answer is decided by this machine's filesystem,
 *     never by a record written elsewhere
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  \u2713 ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A throwaway checkout: sources copied, node_modules symlinked, config and
 * dist copied, no runtime-state. Copies, not hardlinks - a hardlink written
 * in place would change the real repository.
 */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-config-fp-"));
  const destination = path.join(temp, "repo");

  fs.mkdirSync(path.join(destination, "scripts", "server"), { recursive: true });
  fs.mkdirSync(path.join(destination, "app"), { recursive: true });

  const sources = spawnSync("find", ["scripts", "-type", "f", "-not", "-path", "*/node_modules/*"], {
    cwd: root,
    encoding: "utf8",
  }).stdout
    .split("\n")
    .filter(Boolean);

  for (const file of sources) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }

  const dependencies = path.join(root, "scripts", "server", "node_modules");
  if (fs.existsSync(dependencies)) {
    fs.symlinkSync(dependencies, path.join(destination, "scripts", "server", "node_modules"), "dir");
  }

  for (const folder of ["config", "dist"]) {
    const source = path.join(root, "app", folder);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(destination, "app", folder), { recursive: true });
    }
  }

  return { temp, destination };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const net = require("node:net");
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function hashTree(folder) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.set(path.relative(folder, full), fs.readFileSync(full, "utf8"));
    }
  };

  if (fs.existsSync(folder)) walk(folder);

  return out;
}

async function main() {
  console.log("\n=== Tracked config: the server's own writes are fixed points ===\n");

  const { temp, destination } = buildTempRoot();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(destination, "scripts", "server", "serve.cjs")], {
    cwd: destination,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      LUKE_AI_HOST: "127.0.0.1",
      LUKE_AI_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  child.stdout.on("data", (chunk) => {
    serverLog += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    serverLog += chunk.toString("utf8");
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        await fetch(`${baseUrl}/api/health`);
        ready = true;
        break;
      } catch {
        await delay(150);
      }
    }

    assert(ready, "The server boots on a checkout it has never written to.");

    // ── 1. booting rewrites nothing ────────────────────────────────────────
    //
    // The supervisor's monitor fires on its 5 second interval while this
    // runs; whatever boot schedules must not touch a tracked config.

    const configBefore = hashTree(path.join(destination, "app", "config"));
    await delay(6500);
    const configAfterBoot = hashTree(path.join(destination, "app", "config"));

    const bootChanged = [];
    for (const [file, content] of configBefore) {
      if (configAfterBoot.get(file) !== content) bootChanged.push(file);
    }

    assert(
      bootChanged.length === 0,
      `Booting rewrites nothing under app/config${bootChanged.length ? ` - it touched ${bootChanged.join(", ")}` : ""}.`
    );

    // ── 2. saving a policy back to itself is a no-op ───────────────────────
    //
    // The committed file must be exactly what the server's own writer
    // produces from it. A future default change that breaks that equality
    // is what would dirty the checkout again.

    const supervisorFile = path.join(destination, "app", "config", "text-chat", "runtime-supervisor-policy.json");
    const storageFile = path.join(destination, "app", "config", "storage", "storage-destination-policy.json");

    const supervisorCommitted = fs.readFileSync(supervisorFile, "utf8");
    const storageCommitted = fs.readFileSync(storageFile, "utf8");

    // A rewrite leaves a trace even when the bytes survive: renameSync
    // replaces the inode, an in-place write moves the mtime. Remember both.
    const supervisorStatBefore =
      fs.statSync(supervisorFile);

    const put = async (url, policy) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      return { status: response.status, body: await response.text() };
    };

    const supervisorRound = await put("/api/text-runtime/supervisor/settings", JSON.parse(supervisorCommitted));
    assert(
      supervisorRound.status === 200,
      `Saving the supervisor policy back to itself answers ${supervisorRound.status}, a real save.`
    );

    const supervisorAfter = fs.readFileSync(supervisorFile, "utf8");
    assert(
      supervisorAfter === supervisorCommitted,
      "Saving the supervisor policy unchanged rewrites nothing: the committed file is a fixed point of the server's own writer."
    );

    const supervisorStatAfter =
      fs.statSync(supervisorFile);

    assert(
      supervisorStatAfter.ino === supervisorStatBefore.ino &&
        supervisorStatAfter.mtimeMs ===
          supervisorStatBefore.mtimeMs,
      "The no-op save does not even touch the file: inode and mtime are unchanged, so the writer saw identical bytes and stopped."
    );

    const storageRound = await put("/api/storage/settings", JSON.parse(storageCommitted));
    assert(
      storageRound.status === 200,
      `Saving the storage destination policy back to itself answers ${storageRound.status}, a real save.`
    );

    const storageAfter = fs.readFileSync(storageFile, "utf8");
    assert(
      storageAfter === storageCommitted,
      "Saving the storage destination policy unchanged rewrites nothing: the committed file is a fixed point of the server's own writer."
    );

    // ── 3. a policy that really changed still lands ────────────────────────

    const changedPolicy = JSON.parse(supervisorCommitted);
    changedPolicy.supervision = {
      ...changedPolicy.supervision,
      healthCheckIntervalMs: 9000,
    };

    const changedRound = await put("/api/text-runtime/supervisor/settings", changedPolicy);
    const changedAfter = fs.readFileSync(supervisorFile, "utf8");

    assert(
      changedRound.status === 200 &&
        changedAfter !== supervisorCommitted &&
        changedAfter.includes('"healthCheckIntervalMs": 9000'),
      "A supervisor policy that really did change is still written, with the changed value."
    );

    // Restore the fixed point so the assertions below start from it.
    await put("/api/text-runtime/supervisor/settings", JSON.parse(supervisorCommitted));
    assert(
      fs.readFileSync(supervisorFile, "utf8") === supervisorCommitted,
      "Saving the fixed point back lands byte for byte, so the no-op and the real write are not two different code paths."
    );

    // ── 4. the image-to-video answer is this machine's, not the record's ───
    //
    // The record files were tracked, so a checkout installed elsewhere
    // shipped its "ready" answer into every clone. The status route must be
    // decided by what is on this machine's disk.

    const i2vDir = path.join(destination, "app", "runtimes", "image-to-video");
    const venvPython = path.join(i2vDir, "venv", "bin", "python");
    const installedPath = path.join(i2vDir, "installed.json");
    const statusPath = path.join(i2vDir, "install-status.json");

    const getStatus = async () => {
      const response = await fetch(`${baseUrl}/api/capabilities/image-to-video/status`);
      return { status: response.status, body: await response.json() };
    };

    const fresh = await getStatus();
    assert(
      fresh.status === 200 &&
        fresh.body.state === "not-installed" &&
        fresh.body.installed === false,
      "On a checkout with no runtime and no record, the answer is not-installed."
    );

    // A record written on another computer: what a clone used to carry.
    for (const name of ["installed.json", "install-status.json"]) {
      const source = path.join(root, "app", "runtimes", "image-to-video", name);
      if (fs.existsSync(source)) {
        fs.mkdirSync(i2vDir, { recursive: true });
        fs.copyFileSync(source, path.join(i2vDir, name));
      }
    }

    const stale = await getStatus();
    assert(
      stale.body.state === "not-installed" &&
        stale.body.installed === false,
      "A record claiming an install from another computer cannot flip this machine's answer to ready."
    );
    assert(
      stale.body.staleRecord === true && stale.body.recordedState,
      "The stale record is named in the answer instead of being trusted silently."
    );

    // An install in progress is a different machine state, and the record
    // says it honestly.
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ state: "installing", step: "Installing packages", message: "Installing the Python runtime." }, null, 2),
      "utf8"
    );

    const installing = await getStatus();
    assert(
      installing.body.state === "installing" &&
        installing.body.installed === false,
      "While the installer writes installing, the answer is installing, not ready and not silently not-installed."
    );

    // The runtime really is here: the installer finished, which is what
    // wrote both the runtime and the record's final state.
    fs.mkdirSync(path.dirname(venvPython), { recursive: true });
    fs.writeFileSync(venvPython, "#!/bin/sh\n", "utf8");
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ state: "ready", step: "Complete", message: "Image-to-Video is installed and ready." }, null, 2),
      "utf8"
    );

    const present = await getStatus();
    assert(
      present.body.state === "ready" &&
        present.body.installed === true,
      "When the runtime is on this machine's disk, the answer is ready."
    );
    assert(
      present.body.manifest && present.body.manifest.installed === true,
      "The local install record is served as the manifest when the runtime is present."
    );
  } finally {
    child.kill("SIGKILL");
    await delay(300);

    // Unlink node_modules before removing the tree. fs.rmSync does not follow
    // a symlink, verified rather than assumed, but this is the repository's
    // real dependency folder on the other end of it.
    const linked = path.join(destination, "scripts", "server", "node_modules");
    try {
      if (fs.lstatSync(linked).isSymbolicLink()) fs.unlinkSync(linked);
    } catch {}

    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log("\n  PASS: tracked configs are fixed points of the server's own writes.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
