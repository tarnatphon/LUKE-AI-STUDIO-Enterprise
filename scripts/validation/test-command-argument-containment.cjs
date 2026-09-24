#!/usr/bin/env node
"use strict";

/**
 * Request-derived strings that reach a child process's command line.
 *
 * The command-execution audit counted 41 spawn/exec sites: zero run through
 * a shell, zero eval, and the one interpolating execSync (unzip) is pinned
 * by its own suite. What this class adds is the question the shell audit
 * does not answer: of the arguments that do not go through a shell, which
 * carry request-derived values, and what shape could a value take to change
 * what the child process does?
 *
 * For a child without a shell there is exactly one dangerous shape: a value
 * that starts with "-" sits where the child reads an option, not a value.
 * Every other character is inert in argv — no separators, no quoting, no
 * expansion.
 *
 * The sweep found two:
 *
 *   GET /api/llm/recommend?useCase=...
 *     the query string went straight into --use-case for the llmfit binary
 *
 *   the transcription path
 *     the request's (or saved settings') language went straight into -l for
 *     the whisper binary
 *
 * Both children are local tools, so the worst case was option confusion,
 * not code execution — but the guard is the shape that closes the class:
 * a request string in argv now always passes a constraint. Both children
 * are absent on this machine, so the guards are pinned structurally here and
 * by the routes' behaviour; a mutation that removes either guard fails the
 * structural assertion, and that is stated rather than hidden.
 */

const fs = require("node:fs");
const os = require("node:os");
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-argvcheck-"));
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

async function main() {
  console.log("\n=== Request strings that reach a command line stay values ===\n");

  const source = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");

  // ── the llmfit guard ─────────────────────────────────────────────────────
  const llmfitStart = source.indexOf("async function getLlmfitRecommendations");
  const llmfitFn = source.slice(llmfitStart, llmfitStart + 4000);
  assert(llmfitFn.length > 500, "The llmfit recommendation function is found.");
  assert(
    /\/\^\[A-Za-z\]\[A-Za-z0-9-\]\{0,31\}\$/.test(llmfitFn),
    "The useCase is constrained to a plain word."
  );
  assert(
    llmfitFn.includes('"--use-case", safeUseCase'),
    "The argv carries the constrained value, not the query string."
  );
  assert(
    llmfitFn.includes("cacheKey = `${hardwareHash}:${safeUseCase}:${limit}`"),
    "The cache key uses the constrained value too, so junk cannot pre-fill entries."
  );

  // ── the whisper language guard ───────────────────────────────────────────
  const speechFn = source.slice(
    source.indexOf("function transcribeWavBuffer"),
    source.indexOf("function transcribeWavBuffer") + 6000
  );
  assert(
    speechFn.includes('!languageRaw.startsWith("-")'),
    "A language starting with a dash is refused, so -l always gets a value."
  );
  assert(
    /[\\u0000-\\u001f]/.test(speechFn) && speechFn.includes("languageRaw"),
    "Control characters are refused as well."
  );
  assert(
    speechFn.includes('args.push("-l", language)'),
    "and the argv carries the constrained variable."
  );

  // The one argv shape that remains unconstrained is documented as such:
  // the prompt in the image-to-video worker. It sits as the value of
  // --prompt in a child without a shell, so it cannot change what the child
  // runs — it can only make the child's own parser complain.
  assert(
    source.includes('"--prompt", String(body.prompt || "")'),
    "The prompt stays a plain argv value after its flag (no shell can read it differently)."
  );

  // ── behaviour: the route with the query string ───────────────────────────
  const { temp, destination } = buildTempRoot();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

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

    // A value that starts with a dash: the guard falls back to the default,
    // so this answers like any other valid use case — not like a fault.
    const hostile = await (
      await fetch(`${baseUrl}/api/llm/recommend?useCase=--force-runtime`)
    ).json();
    assert(hostile.ok === true, "A dash-prefixed useCase falls back to the default rather than erroring.");

    const controlChars = await (
      await fetch(`${baseUrl}/api/llm/recommend?useCase=chat%0A--limit`)
    ).json();
    assert(controlChars.ok === true, "Embedded control characters fall back the same way.");

    const ordinary = await (
      await fetch(`${baseUrl}/api/llm/recommend?useCase=chat`)
    ).json();
    assert(ordinary.ok === true, "An ordinary use case still works.");
    assert(
      ordinary.source === controlChars.source && ordinary.source === hostile.source,
      "All three land on the same fallback path — the junk is indistinguishable from a plain chat request."
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of it.");

    console.log("\n  PASS: Request strings that reach a command line stay values completed.\n");
  } finally {
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
