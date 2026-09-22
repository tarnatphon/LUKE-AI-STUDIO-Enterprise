#!/usr/bin/env node
/**
 * LUKE AI STUDIO — cloud brain doctor.
 *
 *     bash scripts/cloud-doctor.sh          (resolves the bundled Node first)
 *     node scripts/cloud-doctor.cjs         (if Node is already on PATH)
 *     node scripts/cloud-doctor.cjs --json  (machine-readable, same checks)
 *
 * Why this exists: the whole cloud chain can be exercised in the test suites
 * only against a stand-in server on a local socket. That proves the wire format,
 * the retry rules and the key handling. It cannot prove that *this* account,
 * on *this* machine, is allowed to call the model that is currently free. The
 * suites also cannot see a free lineup rotating a model out from under the
 * chain, or a provider changing its endpoint. Only a real call can.
 *
 * So this makes real calls, one per configured provider plus one turn through
 * the chain itself, and prints what came back in a shape that can be pasted
 * straight back into a chat. It uses the shipped provider module directly — the
 * same functions the server calls — so it is the real code path, not a
 * re-implementation of it.
 *
 * It never prints a key. Only the last four characters, which is what the
 * settings panel already shows. The final report is scrubbed again on the way
 * out as a second line of defence.
 *
 * Costs nothing: every provider in the default chain is priced at zero per
 * token. Three providers plus one chain turn is four short requests.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const provider = require(path.join(ROOT, "scripts", "server", "remote-text-provider.cjs"));

const JSON_MODE = process.argv.includes("--json");

// ── output ─────────────────────────────────────────────────────────────────

const lines = [];
const say = (text = "") => lines.push(text);

const ms = (startedAt) => {
  const elapsed = Date.now() - startedAt;
  return elapsed < 1000 ? `${elapsed} ms` : `${(elapsed / 1000).toFixed(1)} s`;
};

/** What each failure code means, and what to do about it. */
const ADVICE = {
  no_key: "No key is saved for this provider. Open Settings → Cloud brain (Work) and paste one.",
  invalid_key: "This key was refused. It is mistyped, revoked, or belongs to another service. Nothing else in the chain is at fault.",
  model_not_allowed: "The account may not call this model. Pick another from the list above.",
  unknown_model: "This model id no longer exists. Pick another from the list above — free lineups rotate.",
  now_paid: "This model stopped being free. Pick another from the list above, or the chain will move on by itself.",
  harness_restricted: "This endpoint only accepts its own apps. It cannot be used from here.",
  rate_limited: "Too many requests, or the free quota for today is spent. Wait and run this again.",
  upstream_error: "The provider's own servers failed. Not your setup — try again in a few minutes.",
  unreachable: "No connection to the provider. Check the network, or a proxy or firewall that blocks it.",
  unexpected_shape: "The provider answered, but not with a model list. Its endpoint may have moved.",
  refused: "The provider refused the request without saying why. Check the account page.",
};

const adviceFor = (code) => ADVICE[code] || "Unrecognised failure. The message above is what the provider said.";

// ── the key file ───────────────────────────────────────────────────────────

async function inspectKeyFile(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  const report = { path: relativePath, exists: false, mode: "", modeOk: null, gitIgnored: null };

  if (!fs.existsSync(absolute)) return report;

  report.exists = true;

  try {
    const mode = fs.statSync(absolute).mode & 0o777;
    report.mode = `0${mode.toString(8)}`;
    // Only the owner may read a file that holds API keys.
    report.modeOk = mode === 0o600;
  } catch {
    report.mode = "unreadable";
  }

  // Ask git rather than reading .gitignore: the question is whether git would
  // actually commit this file, and only git knows that for sure.
  const ignored = spawnSync("git", ["check-ignore", "-q", relativePath], {
    cwd: ROOT,
    stdio: "ignore",
  });
  report.gitIgnored = ignored.status === 0;

  return report;
}

// ── one provider ───────────────────────────────────────────────────────────

async function checkProvider(entry, index, total) {
  const result = {
    id: entry.id,
    label: entry.label,
    model: entry.model,
    keyHint: entry.keyHint,
    configured: entry.configured,
    list: null,
    test: null,
    modelServed: null,
  };

  if (!entry.configured) {
    say(`[${index}/${total}] ${entry.label}`);
    say(`      no key saved — skipped. Get one: ${entry.docs}`);
    say();
    return result;
  }

  say(`[${index}/${total}] ${entry.label}`);
  say(`      key      ${entry.keyHint}`);

  const listedAt = Date.now();
  const list = await provider.listRemoteModels(entry.id);
  result.list = { ok: list.ok, code: list.code, count: (list.models || []).length, ms: ms(listedAt) };

  if (list.ok) {
    say(`      models   ${list.models.length} served, listed in ${ms(listedAt)}`);
    result.modelServed = list.models.includes(entry.model);
    say(
      `      chosen   ${entry.model}${
        result.modelServed ? " — served: yes" : " — NOT in that list, this will 404"
      }`
    );
  } else {
    say(`      models   ${list.code} — ${list.message}`);
    say(`               ${adviceFor(list.code)}`);
  }

  const testedAt = Date.now();
  const test = await provider.testRemoteProvider(entry.id);
  result.test = { ...test, ms: ms(testedAt) };

  if (test.ok) {
    say(`      test     ok — answered in ${ms(testedAt)}`);
    say(`               reply: ${test.sample ? `"${test.sample}"` : "(the provider answered with no text)"}`);
  } else {
    say(`      test     ${test.code} — ${test.message}`);
    say(`               ${adviceFor(test.code)}`);
  }

  say();

  return result;
}

// ── one turn through the chain itself ──────────────────────────────────────

async function checkChain() {
  const result = { answered: false, providerId: null, model: null, chars: 0, ms: "", failures: [] };

  say("chain    one real turn, exactly the way Work sends one");

  const startedAt = Date.now();
  let text = "";

  const chain = await provider.streamRemoteChain({
    messages: [{ role: "user", content: "Reply with exactly: LUKE-CHAIN-OK" }],
    maxTokens: 64,
    onDelta: (delta) => {
      text += String(delta || "");
    },
  });

  result.ms = ms(startedAt);
  result.providerId = chain.providerId;
  result.model = chain.model;
  result.chars = text.trim().length;
  result.failures = (chain.failures || []).map((failure) => ({
    providerId: failure.providerId,
    model: failure.model,
    code: failure.code,
    status: failure.status,
    message: failure.message,
  }));

  if (chain.content) {
    result.answered = true;
    say(`           answered by ${chain.providerId} / ${chain.model} in ${result.ms}`);
    say(`           ${result.chars} characters, first words: "${text.trim().slice(0, 60)}"`);
  } else {
    say(`           no provider answered, in ${result.ms}`);

    for (const failure of result.failures) {
      say(`           - ${failure.providerId} / ${failure.model}: ${failure.code} — ${failure.message}`);
    }

    if (!result.failures.length) {
      say("           nothing was tried: no provider in the chain has a key saved.");
    }
  }

  say();

  return result;
}

// ── the verdict ────────────────────────────────────────────────────────────

function verdictFor(status, keyFile, results, chain) {
  const configured = status.providers.filter((entry) => entry.configured);

  if (!configured.length) {
    say("verdict  NOTHING CONFIGURED YET — that is not a fault, it is the starting point.");
    say("         Open the app, go to Settings → Cloud brain (Work), and paste a key:");
    say("         NVIDIA — no daily quota at all · build.nvidia.com → Get API key");
    say("         OpenRouter — 50 free requests a day · openrouter.ai → Keys");
    say("         Until then every Work turn is answered by the local model, which is");
    say("         the last link of the chain by design.");
    return 0;
  }

  const problems = [];

  if (keyFile.exists && keyFile.modeOk === false) {
    problems.push(`the key file is ${keyFile.mode}; it should be 0600 so only your account can read it`);
  }

  if (keyFile.exists && keyFile.gitIgnored === false) {
    problems.push("the key file is NOT ignored by git — a commit would publish your keys");
  }

  for (const result of results) {
    if (!result.configured) continue;
    if (result.modelServed === false) {
      problems.push(`${result.label}: ${result.model} is not in that provider's list any more`);
    }
    if (result.test && result.test.ok === false) {
      problems.push(`${result.label}: ${result.test.code} — ${adviceFor(result.test.code)}`);
    }
  }

  if (!chain.answered) {
    problems.push(
      status.localFallback
        ? "no provider answered a turn, so Work falls back to the local model"
        : "no provider answered a turn, and local fallback is OFF — Work would refuse"
    );
  }

  if (!problems.length) {
    say("verdict  HEALTHY — every configured provider answered, and the chain completed a turn.");
    return 0;
  }

  say(`verdict  ${problems.length} THING${problems.length === 1 ? "" : "S"} TO FIX`);
  problems.forEach((problem, index) => say(`         ${index + 1}. ${problem}`));

  if (status.localFallback) {
    say("         Work still answers: the local model is the last link of the chain.");
  }

  return 1;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const status = await provider.providerStatus();
  const keyFile = await inspectKeyFile(status.keyFile);

  // A test points this at a throwaway file outside the app folder, and a path
  // that climbs out with ".." reads as nonsense. Show the real one in that case.
  const keyFileLabel = status.keyFile.startsWith("..")
    ? path.join(ROOT, status.keyFile)
    : status.keyFile;

  say("LUKE AI STUDIO — cloud brain doctor");
  say(`key file   ${keyFileLabel}`);
  say(
    `           ${keyFile.exists ? "exists" : "not created yet (no key has ever been saved)"} · mode ${
      keyFile.mode || "—"
    }${keyFile.modeOk === false ? " (should be 0600)" : ""} · ignored by git: ${
      keyFile.gitIgnored === null ? "unknown" : keyFile.gitIgnored ? "yes" : "NO"
    }`
  );
  say(`chain      ${status.order.join(" → ")} → local`);
  say(`configured ${status.chain.length ? status.chain.join(" → ") : "none"}`);
  say();

  const results = [];

  for (let index = 0; index < status.order.length; index += 1) {
    const entry = status.providers.find((candidate) => candidate.id === status.order[index]);
    if (!entry) continue;
    results.push(await checkProvider(entry, index + 1, status.order.length));
  }

  // Providers in the catalogue that are not in the default chain: only worth a
  // line if a key is actually saved for one.
  for (const entry of status.providers) {
    if (status.order.includes(entry.id) || !entry.configured) continue;
    say(`[extra]  ${entry.label} has a key but is not in the chain — it will never be called.`);
    say();
    results.push(await checkProvider(entry, "+", "+"));
  }

  const chain = await checkChain();
  const exitCode = verdictFor(status, keyFile, results, chain);

  if (JSON_MODE) {
    const secrets = Object.values((await provider.readConfig()).keys || {}).filter(Boolean);
    let payload = JSON.stringify(
      { status, keyFile, providers: results, chain, exitCode },
      null,
      2
    );
    for (const secret of secrets) payload = provider.scrubKey(payload, secret);
    process.stdout.write(`${payload}\n`);
    return exitCode;
  }

  let report = lines.join("\n");

  // Second line of defence: the module already scrubs what it throws, but this
  // is the one place the whole report exists as a single string, so scrubbing it
  // here is what makes "no key in the output" true for every path through here.
  const secrets = Object.values((await provider.readConfig()).keys || {}).filter(Boolean);
  for (const secret of secrets) report = provider.scrubKey(report, secret);

  process.stdout.write(`${report}\n`);

  return exitCode;
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    process.stdout.write(
      `cloud doctor could not run: ${error && error.message ? error.message : String(error)}\n`
    );
    process.exit(2);
  });
