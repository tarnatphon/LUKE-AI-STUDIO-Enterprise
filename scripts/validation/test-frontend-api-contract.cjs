#!/usr/bin/env node
"use strict";

/**
 * Every URL the frontend calls must be a URL the server handles.
 *
 * This is the check that catches a feature which is fully built, fully tested
 * and unreachable — a renamed route, a typo, a path that only ever existed on
 * one side. It is deliberately independent of the route extractor in
 * test-api-route-methods.cjs: the input is the list of URLs the frontend
 * actually asks for, not the list the server declares, so an extractor that
 * cannot see a route cannot hide it here either. That matters because the
 * extractor has now been found narrower than the route surface three times.
 *
 * The oracle is the router's own fallback. Anything no route handles ends at
 *
 *   return json(res, 404, { ok: false, error: "Unknown API endpoint" })
 *
 * so "the server does not serve this" is an exact string, not a guess. A route
 * that exists and rejects the request for its own reasons — 400, 403, 404 with
 * its own message, 503 because a runtime is missing — is still a route that
 * exists, and passes.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const frontendSrc = path.join(root, "app", "frontend", "src");

const FALLBACK = "Unknown API endpoint";
const METHODS = ["POST", "GET", "PATCH", "DELETE"];
/** The verbs a call site may name, which is wider than the sweep below. */
const NAMED_METHODS = new Set([...METHODS, "PUT", "HEAD", "OPTIONS"]);

/**
 * The wrappers the frontend sends requests through, and the ones whose verb is
 * GET when the call site does not say otherwise. Anything else is only claimed
 * when it writes its verb down.
 */
const REQUEST_HELPERS = new Set(["fetch", "api", "postJson", "fetchWithTimeoutAndRetry"]);
const GET_BY_DEFAULT = new Set(["fetch", "api", "fetchWithTimeoutAndRetry"]);

/**
 * Endpoints whose job is to open a native dialog and wait for a person.
 *
 * /api/storage/choose-folder asks the operating system for a folder picker: on
 * macOS that is an osascript dialog which stays on screen until somebody
 * chooses something, and on Windows a modal does the same. There is no answer
 * to collect, so the suite was calling it, waiting 20 seconds for a timeout,
 * and then reporting the URL as one the server does not have — on macOS only,
 * and only because a person had not clicked. Linux answers 501 fast enough to
 * be probed normally, which is why this stayed hidden.
 *
 * So these are checked by their declaration in the server source instead. The
 * claim this suite makes is "every URL the frontend calls reaches a route", and
 * a route that opens a dialog is a route.
 */
const INTERACTIVE = new Map([
  ["/api/storage/choose-folder", path.join("scripts", "server", "serve.cjs")],
]);

function isDeclared(url) {
  const relative = INTERACTIVE.get(url);
  if (!relative) return false;
  try {
    return fs
      .readFileSync(path.join(root, relative), "utf8")
      .includes(`"${url}"`);
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Replace ${...} with a placeholder, counting braces so a nested block inside
 * the interpolation does not end it early. An interpolation that follows a path
 * character rather than a slash is a suffix — almost always the query string —
 * so the path stops there instead of gaining an invented segment.
 */
function resolveTemplate(raw) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "$" && raw[i + 1] === "{") {
      let depth = 0;
      let j = i + 1;
      for (; j < raw.length; j += 1) {
        if (raw[j] === "{") depth += 1;
        else if (raw[j] === "}") {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      if (!out.endsWith("/")) return out;
      out += "probe-id";
      i = j;
    } else {
      out += raw[i];
      i += 1;
    }
  }
  return out;
}

/**
 * The HTTP method a call site uses, or null when it cannot be read.
 *
 * The verb is part of the contract. `PATCH /api/social-agency/products/:sku` is
 * how a product photo is saved, and the call site that saved one was sending
 * POST — a URL that was right, aimed at a route that existed, and answered by
 * the 404 fallback, so the upload and paste-a-link buttons did nothing. Sweeping
 * every method is what hid it: PATCH answered, the URL counted as served, and
 * the one verb the page actually sends was never tried on its own.
 *
 * A call site whose verb cannot be read keeps the old treatment — every method
 * is tried, so "the server does not serve this URL at all" is still caught.
 * Only the verbs written down at the call site are asserted.
 */
function methodAtCallSite(name, args) {
  const asString = (value) => {
    const text = String(value ?? "").trim();
    const match =
      text.match(/^`([\s\S]*)`$/) || text.match(/^"([\s\S]*)"$/) || text.match(/^'([\s\S]*)'$/);
    return match ? match[1] : null;
  };
  const isMethod = (value) => typeof value === "string" && NAMED_METHODS.has(value);

  // postJson(url, body) is POST; postJson(url, body, "PATCH") is PATCH.
  if (name === "postJson") {
    const third = asString(args[2]);
    return isMethod(third) ? third : "POST";
  }

  const options = String(args[1] ?? "");
  if (options.trimStart().startsWith("{")) {
    const declared = options.match(/method:\s*["'`]([A-Za-z]+)["'`]/);
    if (declared) return isMethod(declared[1]) ? declared[1] : null;
    return GET_BY_DEFAULT.has(name) ? "GET" : null;
  }
  // A variable in the options slot can carry any verb, so none is claimed.
  if (options) return null;
  return GET_BY_DEFAULT.has(name) ? "GET" : null;
}

/** The balanced argument list of one call, as raw source text per argument. */
function readCallArgs(text, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  let current = "";
  let quote = null;
  let interpolation = 0;
  const args = [];

  while (i < text.length) {
    const ch = text[i];

    if (quote) {
      if (ch === "\\") { current += ch + text[i + 1]; i += 2; continue; }
      if (quote === "`") {
        if (ch === "$" && text[i + 1] === "{") { interpolation = 1; current += "${"; i += 2; continue; }
        if (interpolation > 0) {
          if (ch === "{") interpolation += 1;
          else if (ch === "}") {
            interpolation -= 1;
            if (interpolation === 0) { current += "}"; i += 1; continue; }
          }
          current += ch; i += 1; continue;
        }
        if (ch === "`") quote = null;
      } else if (ch === quote) {
        quote = null;
      }
      current += ch; i += 1; continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; current += ch; i += 1; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth += 1; current += ch; i += 1; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return args.concat(current);
      current += ch; i += 1; continue;
    }
    if (ch === "," && depth === 1) { args.push(current); current = ""; i += 1; continue; }
    current += ch; i += 1;
  }
  return null;
}

/**
 * Every (url, method) pair a call site states outright: the first argument is a
 * URL literal, so the call is a request, and the verb is either written in the
 * options object, handed to postJson, or the helper's own default — a bare
 * fetch() asks for GET.
 */
function calledMethods() {
  const found = new Map();

  for (const file of walk(frontendSrc)) {
    const text = fs.readFileSync(file, "utf8");
    const call = /([A-Za-z_$][\w$]*)\s*\(/g;
    let match;

    while ((match = call.exec(text)) !== null) {
      const name = match[1];
      if (!REQUEST_HELPERS.has(name)) continue;
      const args = readCallArgs(text, match.index + match[0].length - 1);
      if (!args) continue;
      const raw = String(args[0] ?? "").trim();
      const literal =
        raw.match(/^`([\s\S]*)`$/) || raw.match(/^"([\s\S]*)"$/) || raw.match(/^'([\s\S]*)'$/);
      if (!literal) continue;
      const url = resolveTemplate(literal[1].split("?")[0]).replace(/\/+$/, "");
      if (!url.startsWith("/")) continue;
      const method = methodAtCallSite(name, args);
      if (!method) continue;
      if (!found.has(url)) found.set(url, new Set());
      found.get(url).add(method);
    }
  }

  return found;
}

/**
 * Every URL the frontend asks for, with the candidate action words from the file
 * that asks for it. Those words are how a URL ending in a runtime-chosen segment
 * — `/batches/${id}/${action}` — gets resolved without consulting the server.
 */
function calledUrls() {
  const found = new Map();
  const prefix = "(?:api|v1|sdapi|tts-outputs)";
  const methods = calledMethods();

  for (const file of walk(frontendSrc)) {
    const text = fs.readFileSync(file, "utf8");

    const collect = (raw) => {
      const url = resolveTemplate(raw.split("?")[0]).replace(/\/+$/, "");
      if (!url.startsWith("/")) return;
      if (found.has(url)) return;

      const words = [
        ...new Set(
          (text.match(/"[a-z][a-z0-9-]{1,24}"/g) || []).map((word) => word.slice(1, -1))
        ),
      ];
      found.set(url, { words, methods: [...(methods.get(url) || [])] });
    };

    const plain = new RegExp(`"(\\/${prefix}\\/[^"$]*)\"`, "g");
    let match;
    while ((match = plain.exec(text)) !== null) collect(match[1]);

    const template = new RegExp("`(/" + prefix + "\\/[^`]*)`", "g");
    while ((match = template.exec(text)) !== null) collect(match[1]);
  }

  return [...found.keys()].sort().map((url) => ({
    url,
    actions: found.get(url).words,
    methods: found.get(url).methods,
  }));
}

/** A throwaway checkout, so booting the server cannot touch the real one. */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-contract-"));
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
  console.log("\n=== Frontend API contract ===\n");

  const entries = calledUrls();
  const urls = entries.map((entry) => entry.url);

  assert(urls.length > 250, `The frontend calls ${urls.length} distinct URLs, more than 250.`);
  assert(
    urls.every((url) => !/\$\{|`|\s/.test(url)),
    "Every one resolved to a concrete path, with no interpolation left in it."
  );
  assert(
    urls.filter((url) => url.includes("probe-id")).length > 10,
    `${urls.filter((url) => url.includes("probe-id")).length} of them came from template literals.`
  );

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
        LUKE_AI_TEST_TOTAL_RAM_BYTES: String(32 * 1024 ** 3),
        LUKE_AI_TEST_AVAILABLE_RAM_BYTES: String(24 * 1024 ** 3),
        LUKE_AI_TEST_FREE_STORAGE_BYTES: String(200 * 1024 ** 3),
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

    const ask = async (target, method) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(`${baseUrl}${target}`, {
          method,
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: method === "GET" ? undefined : "{}",
        });
        return (await response.text()).includes(FALLBACK) ? "fallback" : "served";
      } catch {
        // A timeout or a reset connection is not "no such route"; the sweep in
        // test-api-route-methods.cjs is where those are judged. It is also not
        // "served", and it is not the same thing as the fallback answering —
        // so it is remembered as "no answer" and reported as its own thing
        // rather than folded into the list of routes the server lacks.
        return "no-answer";
      } finally {
        clearTimeout(timer);
      }
    };

    const unserved = [];
    const unanswered = [];
    const served = new Set();
    const viaAction = [];
    const byDeclaration = [];
    const methodKnown = [];

    /**
     * One URL on one verb. A URL whose last segment is an action the caller
     * picks at runtime — `/download-queue/${id}/${action}`,
     * `/batches/${id}/${action}`, `/scheduler/${running ? "stop" : "start"}` —
     * cannot be resolved statically, and "probe-id" is not a word any route
     * accepts. The accepted words are recovered from the calling file rather
     * than from the server, and the URL counts as served if any of them is.
     */
    const tryVerb = async (url, method, actions) => {
      let verdict = await ask(url, method);
      if (verdict === "served" || !url.endsWith("/probe-id") || !actions?.length) return verdict;
      const base = url.slice(0, -"/probe-id".length);
      for (const action of actions) {
        if ((await ask(`${base}/${action}`, method)) === "served") {
          viaAction.push(`${method} ${url}  →  ${base}/${action}`);
          return "served";
        }
      }
      return verdict;
    };

    for (const { url, actions, methods } of entries) {
      let verdict = "served";
      let unresolved = "";

      if (INTERACTIVE.has(url)) {
        verdict = isDeclared(url) ? "served" : "fallback";
        if (verdict === "served") byDeclaration.push(url);
      } else if (methods?.length) {
        // Every verb the call sites state outright has to be one the route
        // answers. This is the check a single sweep cannot make: a route that
        // answers PATCH passes a sweep that also tries POST, and the button
        // sending POST stays broken.
        methodKnown.push(url);
        for (const method of [...methods].sort()) {
          const verbVerdict = await tryVerb(url, method, actions);
          if (verbVerdict === "served") continue;
          if (verbVerdict === "no-answer" && verdict !== "fallback") verdict = "no-answer";
          else verdict = "fallback";
          unresolved = unresolved ? `${unresolved}, ${method}` : method;
        }
      } else {
        // No verb was readable at the call site, so the URL is held to what it
        // always was: some method reaches it.
        for (const method of METHODS) {
          const verbVerdict = await tryVerb(url, method, actions);
          if (verbVerdict === "served") { verdict = "served"; break; }
          if (verbVerdict === "no-answer" && verdict !== "fallback") verdict = "no-answer";
          else verdict = "fallback";
        }
      }

      if (verdict === "served") served.add(url);
      else if (verdict === "no-answer") unanswered.push(url);
      else unserved.push(unresolved ? `${unresolved} ${url}` : url);
    }

    console.log(
      `  called: ${urls.length} · served: ${served.size} · unserved: ${unserved.length} · verbs read at the call site: ${methodKnown.length}`
    );
    if (viaAction.length) {
      console.log(`  ${viaAction.length} needed a runtime action word taken from the caller:`);
      viaAction.forEach((line) => console.log(`    ${line}`));
    }
    if (unserved.length) console.log(`  not served: ${unserved.join(", ")}`);
    if (unanswered.length) console.log(`  no answer: ${unanswered.join(", ")}`);
    if (byDeclaration.length) {
      console.log(
        `  ${byDeclaration.length} open a native dialog, so they are checked by their declaration instead: ${byDeclaration.join(", ")}`
      );
    }

    assert(
      methodKnown.length > 150,
      `The verb was read at the call site for ${methodKnown.length} of the ${urls.length} URLs.`
    );
    assert(
      unserved.length === 0,
      `Every URL the frontend calls, with the method its call site sends, reaches a route (${unserved.length} fall through to "${FALLBACK}").`
    );
    assert(
      unanswered.length === 0,
      `Every URL the frontend calls answers at all (${unanswered.length} timed out or reset on every method, which is a different thing and belongs to test-api-route-methods.cjs).`
    );

    let alive = false;
    try {
      alive = (await fetch(`${baseUrl}/api/health`)).status === 200;
    } catch {}
    assert(alive, "The server is still running after all of them were called.");

    console.log("\n  PASS: Frontend API contract completed.\n");
  } finally {
    // The server spawns python workers that outlive it and keep writing into the
    // throwaway checkout, so kill the whole group or the removal races them.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await delay(800);

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
