#!/usr/bin/env node
"use strict";

/**
 * Downloading a model that happens to be a .zip must extract it, and nothing
 * about that may run through a shell or land outside the models folder.
 *
 * The old code was
 *
 *   execSync(`unzip -o "${destPath}" -d "${path.dirname(destPath)}"`)
 *
 * and execSync given a string always goes through /bin/sh. destPath is built
 * from a filename, so a name carrying a quote or $(...) became a command. It is
 * not reachable today — every caller checks the extension first, and a URL's
 * pathname percent-encodes the metacharacters — but that is two accidents away
 * from a hole, and the fix costs nothing.
 *
 * Also measured: `unzip` strips leading ../ from an entry ("skipped ../ path
 * component(s)") instead of following it, so a crafted archive cannot write
 * outside the destination. That is unzip's behaviour, not this code's, so it is
 * asserted here rather than assumed.
 */

const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-zipdl-"));
  const destination = path.join(temp, "repo");

  fs.mkdirSync(path.join(destination, "scripts", "server"), { recursive: true });
  fs.mkdirSync(path.join(destination, "app"), { recursive: true });

  const sources = spawnSync(
    "find",
    ["scripts", "-type", "f", "-not", "-path", "*/node_modules/*"],
    { cwd: root, encoding: "utf8" }
  ).stdout
    .split("\n")
    .filter(Boolean);

  for (const file of sources) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }

  const dependencies = path.join(root, "scripts", "server", "node_modules");
  if (fs.existsSync(dependencies)) {
    fs.symlinkSync(
      dependencies,
      path.join(destination, "scripts", "server", "node_modules"),
      "dir"
    );
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
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function makeZip(entries) {
  // python3's zipfile is available everywhere this repo's scripts already run.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "luke-zip-stage-"));
  const out = path.join(staging, "archive.zip");
  const script = [
    "import zipfile, json, sys",
    "spec = json.loads(sys.argv[1])",
    "out = sys.argv[2]",
    "with zipfile.ZipFile(out, 'w') as z:",
    "    for name, text in spec:",
    "        z.writestr(name, text)",
  ].join("\n");

  const result = spawnSync(
    "python3",
    ["-c", script, JSON.stringify(entries), out],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(`could not build a test archive: ${result.stderr}`);
  }

  const bytes = fs.readFileSync(out);
  fs.rmSync(staging, { recursive: true, force: true });
  return bytes;
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(200);
  }
  return predicate();
}

async function main() {
  console.log("\n=== A downloaded archive is extracted without a shell ===\n");

  const { temp, destination } = buildTempRoot();
  const port = await getFreePort();
  const filePort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const modelsDir = path.join(destination, "app", "models");

  const marker = path.join(temp, "SHELL-RAN");

  const archives = {
    "good.zip": makeZip([["extracted-good.txt", "inside the models folder"]]),
    "slip.zip": makeZip([
      ["extracted-slip.txt", "fine"],
      ["../../ESCAPED.txt", "this must not leave the models folder"],
    ]),
    "inj.zip": makeZip([["extracted-inj.txt", "fine"]]),
  };

  // The injection payload as a URL the caller would actually send. The pathname
  // percent-encodes the metacharacters, which is the accident the code used to
  // depend on — asserted here so the suite fails loudly if that ever changes.
  const injectionName = `inj$(touch ${marker}).zip`;

  const fileServer = http.createServer((req, res) => {
    const name = decodeURIComponent(String(req.url || "/").replace(/^\//, ""));
    const bytes = archives[name] || archives["inj.zip"];
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": String(bytes.length),
    });
    res.end(bytes);
  });

  await new Promise((resolve) => fileServer.listen(filePort, "127.0.0.1", resolve));

  const child = spawn(
    process.execPath,
    [path.join(destination, "scripts", "server", "serve.cjs")],
    {
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
      detached: true,
    }
  );

  child.stdout.resume();
  child.stderr.resume();

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
    assert(ready, "The server starts on a throwaway checkout.");

    const startDownload = async (url) => {
      const response = await fetch(`${baseUrl}/api/download-model`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const text = await response.text();
      return { status: response.status, text };
    };

    // ── extraction still works after leaving the shell ──────────────────────
    const started = await startDownload(`http://127.0.0.1:${filePort}/good.zip`);
    assert(
      started.status === 200,
      `A .zip model download is accepted (${started.status}: ${started.text.slice(0, 120)}).`
    );

    const extractedGood = await waitFor(
      () => fs.existsSync(path.join(modelsDir, "extracted-good.txt")),
      30000
    );
    assert(
      extractedGood,
      "and its contents are extracted into the models folder."
    );

    const archiveRemoved = await waitFor(
      () => !fs.existsSync(path.join(modelsDir, "good.zip")),
      10000
    );
    assert(archiveRemoved, "The archive itself is removed once extracted.");

    // ── a crafted archive cannot write outside ──────────────────────────────
    const slipStarted = await startDownload(`http://127.0.0.1:${filePort}/slip.zip`);
    assert(slipStarted.status === 200, `A second archive downloads (${slipStarted.status}).`);

    const extractedSlip = await waitFor(
      () => fs.existsSync(path.join(modelsDir, "extracted-slip.txt")),
      30000
    );
    assert(extractedSlip, "Its normal entry is extracted too.");

    const escapedOutside = spawnSync(
      "find",
      [temp, "-name", "ESCAPED.txt", "-not", "-path", `${modelsDir}/*`],
      { encoding: "utf8" }
    ).stdout.trim();

    if (escapedOutside) console.log(`    escaped to: ${escapedOutside}`);

    assert(
      escapedOutside === "",
      "An entry named ../../ESCAPED.txt does not land outside the models folder."
    );

    // ── a filename with shell metacharacters runs nothing ───────────────────
    const injectionUrl = `http://127.0.0.1:${filePort}/${encodeURIComponent(injectionName)}`;
    const injectionStarted = await startDownload(injectionUrl);
    assert(
      injectionStarted.status === 200,
      `A URL whose name carries $(…) is still accepted as a download (${injectionStarted.status}).`
    );

    await waitFor(
      () => fs.existsSync(path.join(modelsDir, "extracted-inj.txt")),
      30000
    );
    // unzip has run by the time the entry is on disk; give a shell any chance
    // it was going to have before declaring the marker absent.
    await delay(1500);

    assert(
      !fs.existsSync(marker),
      "Extracting it runs no shell command — the payload created nothing."
    );

    const leftovers = spawnSync(
      "find",
      [temp, "-name", "*INJ*", "-o", "-name", "*touch*"],
      { encoding: "utf8" }
    ).stdout.trim();

    assert(
      !/\$\(|`/.test(leftovers) || leftovers === "",
      "No shell metacharacters survive into anything on disk."
    );

    // ── the invocation itself ───────────────────────────────────────────────
    // Structural, and it has to be: no caller can put a shell metacharacter into
    // a .zip destination today. Every route either takes the name from a URL
    // pathname, which percent-encodes " ` { } and space, or checks the extension
    // first, and the unzip branch only runs for .zip. So the behavioural
    // assertions above are the regression guard — extraction still works and
    // stays inside — and this is what fails if the shell comes back.
    const serverSource = fs.readFileSync(
      path.join(root, "scripts", "server", "serve.cjs"),
      "utf8"
    );

    const interpolatedShellCall = serverSource.match(/execSync\(`[^`]*\$\{/g) || [];
    assert(
      interpolatedShellCall.length === 0,
      "No execSync anywhere in the server interpolates a value into a command string."
    );

    assert(
      /spawnSync\(\s*"unzip",\s*\[/.test(serverSource),
      "unzip is invoked with an argument array, so a filename cannot become a command."
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of it.");

    console.log("\n  PASS: Downloaded archives are extracted without a shell completed.\n");
  } finally {
    fileServer.close();
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await delay(500);

    const linked = path.join(destination, "scripts", "server", "node_modules");
    try {
      if (fs.lstatSync(linked).isSymbolicLink()) fs.unlinkSync(linked);
    } catch {}
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
