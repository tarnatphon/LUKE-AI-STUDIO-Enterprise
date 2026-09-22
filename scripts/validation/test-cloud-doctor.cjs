#!/usr/bin/env node
"use strict";

/**
 * The cloud doctor, and the bug it was written to find.
 *
 * `scripts/cloud-doctor.cjs` is the one thing that makes real calls to real
 * providers, so a test suite can only drive it against a stand-in. What a suite
 * can still prove is everything the doctor itself is responsible for: that it
 * resolves the right model, that it names a failure the user can act on, that
 * the verdict matches what came back, and that no key survives into the output.
 *
 * The middle of this file pins a defect the doctor exposed on its first run.
 * `testRemoteProvider` sent no model at all, so `buildRemotePayload` silently
 * used the provider's built-in default. A user who picked a model in Settings,
 * pressed Test and was told "ok" was told it about a *different* model from the
 * one every real turn would send. When a free lineup rotates the chosen model
 * out — which they do — the panel said healthy and every turn 404'd. The probe
 * now resolves the model the same way the chain does.
 */

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const doctorFile = path.join(root, "scripts", "cloud-doctor.cjs");
const providerFile = path.join(root, "scripts", "server", "remote-text-provider.cjs");

// Inside the gitignored runtime-state folder, so the "ignored by git" line the
// doctor prints is an assertion about a real path and not about a throwaway.
const keyFile = path.join(root, "app", "runtime-state", "text-chat", "cloud-doctor-test.json");

// Distinct endings on purpose: the doctor shows the last four characters, and
// three identical hints would hide a mix-up between providers.
const KEYS = {
  nvidia: "nvapi-DOCTOR-HEALTHY-1111-AAAA",
  openrouter: "sk-or-DOCTOR-HEALTHY-2222-BBBB",
  zai: "zz-DOCTOR-HEALTHY-3333-CCCC",
};

const REFUSED_KEY = "sk-or-DOCTOR-REVOKED-9999-ZZZZ";
const RATE_LIMITED_KEY = "zz-DOCTOR-QUOTA-SPENT-8888-YYYY";

const SERVED_MODELS = ["moonshotai/kimi-k3", "poolside/laguna-s-2.1:free", "glm-4.7-flash"];

// A model the provider no longer serves. Not hypothetical: NVIDIA's own
// /v1/models lists kimi-k3 and does not list kimi-k2.5.
const GONE_MODEL = "moonshotai/kimi-k2.5";

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One provider's block out of the report: from its `[n/3]` heading to the blank
 * line that ends it. Assertions about a single provider have to be scoped to
 * that block, because the other providers in the same run are healthy and print
 * "ok" — a whole-report search would pass for the wrong reason.
 */
function blockOf(stdout, heading) {
  const start = stdout.indexOf(heading);
  if (start < 0) return "";
  const rest = stdout.slice(start);
  const end = rest.indexOf("\n\n");
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * A provider stand-in. Which way it answers is decided by the bearer token, so
 * one server can play a healthy account, a revoked key and an exhausted quota in
 * the same run. Every model it is asked for is recorded — that record is the
 * direct proof that the probe asked for the model the user selected.
 */
function startStandIn() {
  const requestedModels = [];

  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;

    const bearer = String(req.headers.authorization || "").toUpperCase();

    const fail = (status, message) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message } }));
    };

    if (req.url.endsWith("/models") && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: SERVED_MODELS.map((id) => ({ id })) }));
    }

    if (req.url.endsWith("/chat/completions") && req.method === "POST") {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      const model = String(parsed.model || "");
      requestedModels.push(model);

      if (bearer.includes("REVOKED")) return fail(401, `invalid api key ${bearer}`);
      if (bearer.includes("QUOTA")) return fail(429, "rate limited");
      if (!SERVED_MODELS.includes(model)) return fail(404, `model ${model} not found`);

      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const piece of ["LUKE", "-CHAIN", "-OK"]) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      resolve({
        port: server.address().port,
        requestedModels,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function writeConfig({ keys, models = {}, useLocalFallback = true, order }) {
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(
    keyFile,
    `${JSON.stringify(
      { keys, order: order || ["nvidia", "openrouter", "zai"], models, useLocalFallback },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
}

async function runDoctor(baseUrl, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [doctorFile, ...extraArgs], {
      cwd: root,
      env: {
        ...process.env,
        LUKE_REMOTE_PROVIDER_FILE: keyFile,
        LUKE_REMOTE_PROVIDER_BASE_URL: baseUrl,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  console.log("\n=== Cloud doctor validation ===\n");

  assert(fs.existsSync(doctorFile), "scripts/cloud-doctor.cjs exists.");
  assert(fs.existsSync(providerFile), "The provider module the doctor drives exists.");

  const standIn = await startStandIn();
  const baseUrl = `http://127.0.0.1:${standIn.port}/v1`;

  const originalKeyFile = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8") : null;

  try {
    // ── the state the user is in right now: no key file at all ─────────────
    fs.rmSync(keyFile, { force: true });

    const empty = await runDoctor(baseUrl);

    assert(empty.code === 0, `With no key saved the doctor reports and exits 0 (got ${empty.code}).`);
    assert(
      empty.stdout.includes("NOTHING CONFIGURED YET"),
      "It says nothing is configured yet, rather than reporting a fault."
    );
    assert(
      empty.stdout.includes("no key saved — skipped"),
      "Every provider in the chain is listed as skipped, not silently dropped."
    );
    assert(
      empty.stdout.includes("not created yet"),
      "It reports that the key file does not exist yet instead of failing to read it."
    );

    // ── a healthy chain ────────────────────────────────────────────────────
    writeConfig({ keys: KEYS });

    standIn.requestedModels.length = 0;
    const healthy = await runDoctor(baseUrl);

    assert(healthy.code === 0, `A healthy chain exits 0 (got ${healthy.code}).`);
    assert(
      healthy.stdout.includes("HEALTHY"),
      "The verdict says healthy when every configured provider answered."
    );
    assert(
      healthy.stdout.includes("ignored by git: yes"),
      "It confirms the key file is ignored by git, asking git rather than reading .gitignore."
    );
    assert(healthy.stdout.includes("mode 0600"), "It confirms the key file is owner-readable only.");
    assert(
      healthy.stdout.includes("answered by nvidia / moonshotai/kimi-k3"),
      "One real turn through the chain names the provider and model that answered."
    );
    assert(
      standIn.requestedModels.includes("moonshotai/kimi-k3"),
      "The probe sent a real model on the wire, not an empty one."
    );

    // ── the defect this suite exists to keep fixed ─────────────────────────
    writeConfig({ keys: KEYS, models: { nvidia: GONE_MODEL } });

    standIn.requestedModels.length = 0;
    const gone = await runDoctor(baseUrl);
    const nvidiaBlock = blockOf(gone.stdout, "[1/3] NVIDIA NIM");

    // Twice, and the count is the assertion: once by the probe, once by the
    // chain turn at the end. The chain always resolved the selected model, so a
    // single occurrence in the log means the chain sent it and the probe did
    // not — which is exactly the defect this block pins.
    const probeRequests = standIn.requestedModels.filter((model) => model === GONE_MODEL).length;
    assert(
      probeRequests === 2,
      `The selected model was requested twice — once by the probe, once by the chain (got ${probeRequests}).`
    );
    assert(
      gone.code === 1,
      `A model the provider no longer serves makes the doctor exit 1 (got ${gone.code}).`
    );
    assert(
      nvidiaBlock.includes("unknown_model"),
      "It names the failure unknown_model instead of reporting the account as reachable."
    );
    assert(
      nvidiaBlock.includes("NOT in that list"),
      "It says the selected model is not in the provider's own list."
    );
    assert(
      !nvidiaBlock.includes("test     ok"),
      "The provider whose selected model is gone is not reported as healthy."
    );
    assert(
      blockOf(gone.stdout, "[2/3] OpenRouter").includes("test     ok"),
      "A dead model on one provider does not make the others look broken."
    );
    assert(
      gone.stdout.includes("answered by openrouter"),
      "The chain still completes a turn by moving on to the next provider."
    );

    // ── a key the provider refuses ─────────────────────────────────────────
    writeConfig({ keys: { ...KEYS, openrouter: REFUSED_KEY } });

    const refused = await runDoctor(baseUrl);

    assert(refused.code === 1, `A refused key makes the doctor exit 1 (got ${refused.code}).`);
    assert(
      blockOf(refused.stdout, "[2/3] OpenRouter").includes("invalid_key"),
      "A refused key is named invalid_key, against the provider it belongs to."
    );
    assert(
      refused.stdout.includes("answered by nvidia"),
      "A bad second key does not stop the chain from answering through the first."
    );

    // ── the whole chain spent, with local fallback turned off ──────────────
    writeConfig({
      keys: {
        nvidia: RATE_LIMITED_KEY,
        openrouter: RATE_LIMITED_KEY,
        zai: RATE_LIMITED_KEY,
      },
      useLocalFallback: false,
    });

    const spent = await runDoctor(baseUrl);

    assert(spent.code === 1, `A spent chain makes the doctor exit 1 (got ${spent.code}).`);
    assert(
      spent.stdout.includes("no provider answered"),
      "It says no provider answered, rather than reporting an empty success."
    );
    assert(
      spent.stdout.includes("Work would refuse"),
      "It warns that Work would refuse, because local fallback is off."
    );
    assert(
      spent.stdout.includes("- nvidia / moonshotai/kimi-k3: rate_limited") &&
        spent.stdout.includes("- openrouter / poolside/laguna-s-2.1:free: rate_limited") &&
        spent.stdout.includes("- zai / glm-4.7-flash: rate_limited"),
      "Every link of the chain is reported, not just the first failure."
    );

    // ── no key ever reaches the output ─────────────────────────────────────
    writeConfig({ keys: KEYS });

    const secret = await runDoctor(baseUrl);
    const json = await runDoctor(baseUrl, ["--json"]);

    for (const [providerId, value] of Object.entries(KEYS)) {
      assert(
        !secret.stdout.includes(value),
        `The ${providerId} key never appears in the report.`
      );
    }

    assert(
      secret.stdout.includes(`…${KEYS.nvidia.slice(-4)}`) &&
        secret.stdout.includes(`…${KEYS.openrouter.slice(-4)}`) &&
        secret.stdout.includes(`…${KEYS.zai.slice(-4)}`),
      "It still shows each key's last four characters, so the user can tell which is saved."
    );
    assert(
      !Object.values(KEYS).some((value) => json.stdout.includes(value)),
      "No key survives into the --json report either."
    );

    let parsed = null;
    try {
      parsed = JSON.parse(json.stdout);
    } catch {}

    assert(parsed !== null && parsed.exitCode === 0, "--json emits parseable JSON with a verdict.");
    assert(
      parsed !== null && Array.isArray(parsed.providers) && parsed.providers.length === 3,
      "--json reports every provider in the chain."
    );

    console.log("\n  PASS: Cloud doctor validation completed.\n");
  } finally {
    await standIn.close();
    await delay(100);

    if (originalKeyFile === null) fs.rmSync(keyFile, { force: true });
    else fs.writeFileSync(keyFile, originalKeyFile, "utf8");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
