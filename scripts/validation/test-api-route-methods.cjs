#!/usr/bin/env node
"use strict";

/**
 * Every route, with its own method, on a checkout the app has never written to.
 *
 * The first version of this check swept every route with GET and counted 175
 * 404s, then called them method mismatches and moved on. That was a guess
 * dressed as a measurement: 187 of the routes only accept POST, so they had
 * never been touched at all. Sweeping each one with the method it actually
 * declares turned up eighteen 500s — including a route that referenced a
 * variable it never declared and so had never once worked.
 *
 * So this does the sweep properly, and the assertion is simply that a 500 never
 * happens. A 500 means the server is broken; "you left a field out" is a 400
 * and "that part of the app is not installed here" is a 503. Anything else and
 * a real crash has somewhere to hide.
 *
 * A 404 is allowed, because plenty of these routes answer "no such record" to a
 * request with no id in it — but only when the body says so. A 404 that comes
 * from the routing fallback proves the route does not exist, which is a
 * different and worse thing.
 *
 * The server is booted from a throwaway copy of the repo with no runtime-state
 * folder, so this measures a fresh checkout and leaves the real one alone.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every (method, url) pair the server declares.
 *
 * Each url check is scoped to the condition that contains it, so a method check
 * belonging to the previous route is never borrowed — which is how the first
 * attempt ended up sweeping POST-only routes with GET.
 */
function extractRoutes(source) {
  const enclosingCondition = (index) => {
    let depth = 0;
    let start = index;
    for (let i = index; i >= 0; i -= 1) {
      const ch = source[i];
      if (ch === ")") depth += 1;
      else if (ch === "(") {
        if (depth === 0) {
          start = i;
          break;
        }
        depth -= 1;
      }
    }
    depth = 0;
    let end = start;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    return source.slice(start, end + 1);
  };

  const routes = [];
  const seen = new Set();

  // Not every route is spelled `req.url ===`. Three other forms exist, and an
  // extractor that only knew the first one reported 266 routes when the server
  // declares 273 — which is how POST /api/assets, a route that killed the whole
  // process, stayed outside the sweep.
  const forms = [
    /req\.url\s*===\s*"(\/[^"]+)"/g,
    /req\.url\.startsWith\("(\/[^"]+)"\)/g,
    /String\(req\.url[^)]*\)\.split\("\?"\)\[0\]\s*===\s*"(\/[^"]+)"/g,
    /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*===\s*"(\/(?:api|v1|sdapi|tts-outputs)[^"]*)"/g,
    /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.startsWith\("(\/(?:api|v1|sdapi|tts-outputs)[^"]*)"\)/g,
  ];

  for (const re of forms) {
    let match;
    while ((match = re.exec(source)) !== null) {
      const condition = enclosingCondition(match.index);
      const declared = condition.match(/req\.method\s*===\s*"([A-Z]+)"/);
      const method = declared ? declared[1] : "GET";
      const prefix = re.source.includes("startsWith");
      const key = `${method} ${match[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ method, url: match[1], prefix });
    }
  }

  // A sixth form: eleven routes are declared as regular expressions rather than
  // string comparisons, and every one of them was invisible to the five above.
  // That is not a curiosity — POST .../batches/<id>/resume was one of them, and
  // it threw a ReferenceError on every call. A sweep that cannot see a route
  // cannot report it broken.
  const regexForm = /\/\^\\\/(?:api|v1|sdapi|tts-outputs)[^\n]*?\$\//g;
  let regexMatch;
  while ((regexMatch = regexForm.exec(source)) !== null) {
    const condition = enclosingCondition(regexMatch.index);
    const declared = condition.match(/req\.method\s*===\s*"([A-Z]+)"/);
    const method = declared ? declared[1] : "POST";

    // Every branch, not just the first. Taking only the first alternative of
    // (pause|resume|cancel|retry-failed) swept /pause and passed while /resume
    // threw on every call.
    for (const url of regexRouteToUrls(regexMatch[0])) {
      if (!url.startsWith("/")) continue;
      const key = `${method} ${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ method, url, prefix: false });
    }
  }

  return routes;
}

/**
 * A regular expression route turned into one URL it accepts, so the sweep has
 * something concrete to call. Capture groups become a placeholder, alternations
 * take their first branch, and optional groups are dropped — the sweep covers
 * the shortest URL the route matches.
 */
function regexRouteToUrls(literal) {
  let variants = [literal.slice(2, -2)];

  const expand = (pattern) => {
    let changed = true;
    while (changed) {
      changed = false;
      const next = [];
      for (const variant of variants) {
        const match = variant.match(pattern);
        if (match) {
          changed = true;
          const branches =
            pattern.source.startsWith("\\(\\?:")
              ? [match[1], ""]
              : match[1].split("|");
          for (const branch of branches) {
            next.push(
              variant.slice(0, match.index) + branch + variant.slice(match.index + match[0].length)
            );
          }
        } else {
          next.push(variant);
        }
      }
      variants = next;
    }
  };

  expand(/\(\?:(.*?)\)\?/);
  expand(/\(([^()|]*\|[^()]*)\)/);

  return [
    ...new Set(
      variants.map((variant) =>
        variant
          .replace(/\(\[\^\/\??\][+*]\)/g, "probe-id")
          .replace(/\\\//g, "/")
          .replace(/\\\./g, ".")
          .replace(/\\\?/g, "?")
      )
    ),
  ];
}

/** Routes that exist only to catch everything else; the bare prefix is not a route. */
const CATCH_ALL = new Set(["/api/", "/v1/", "/sdapi/", "/tts-outputs/"]);

/**
 * A throwaway checkout: the sources copied, node_modules symlinked, and no
 * runtime-state folder. Copying rather than hardlinking matters — a hardlinked
 * file written in place would change the real repository.
 */
function buildTempRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-route-sweep-"));
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

async function main() {
  console.log("\n=== API route method sweep ===\n");

  const source = fs.readFileSync(serverFile, "utf8");
  const routes = extractRoutes(source);

  assert(routes.length > 280, `The extractor found ${routes.length} routes, which is more than 280.`);
  const regexRoutes = routes.filter((route) => route.url.includes("probe-id"));
  assert(
    regexRoutes.length >= 11,
    `${regexRoutes.length} of them are declared as regular expressions — the form that hid the broken resume route.`
  );
  assert(
    routes.filter((route) => route.method === "POST").length > 100,
    `${routes.filter((route) => route.method === "POST").length} of them are POST-only — the ones a GET sweep never reached.`
  );

  const { temp, destination } = buildTempRoot();

  assert(
    !fs.existsSync(path.join(destination, "app", "runtime-state")),
    "The throwaway checkout has no runtime-state folder, exactly like a fresh clone."
  );

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

    assert(ready, "The server starts and answers on a checkout it has never written to.");

    const fives = [];
    const silentFours = [];
    const timeouts = [];
    const tally = {};

    for (const route of routes) {
      if (CATCH_ALL.has(route.url)) continue;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);

      let status = 0;
      let body = "";

      try {
        const init = { method: route.method, signal: controller.signal };
        if (route.method !== "GET") {
          init.headers = { "content-type": "application/json" };
          init.body = "{}";
        }
        const response = await fetch(`${baseUrl}${route.url}`, init);
        status = response.status;
        body = await response.text();
      } catch {
        timeouts.push(`${route.method} ${route.url}`);
      } finally {
        clearTimeout(timer);
      }

      if (!status) continue;

      tally[status] = (tally[status] || 0) + 1;

      if (status === 500) fives.push(`${route.method} ${route.url}`);

      // A 404 has to be the application saying "no such record", not the
      // routing fallback saying "no such route".
      if (status === 404) {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {}
        const explained =
          parsed && typeof parsed === "object" && typeof parsed.error === "string" && parsed.error.trim();
        if (!explained) silentFours.push(`${route.method} ${route.url}`);
      }
    }

    const swept = Object.values(tally).reduce((total, count) => total + count, 0);

    console.log(`  swept ${swept} routes, each with its own declared method`);
    console.log(`  ${JSON.stringify(tally)}`);

    assert(timeouts.length === 0, `Every route answered inside its time limit (${timeouts.length} timed out).`);
    assert(
      fives.length === 0,
      `No route answered 500.${fives.length ? ` Offenders: ${fives.join(", ")}` : ""}`
    );
    assert(
      silentFours.length === 0,
      `Every 404 explains itself, so none of them is a route that does not exist.${
        silentFours.length ? ` Unexplained: ${silentFours.join(", ")}` : ""
      }`
    );
    assert(
      !/ReferenceError|TypeError:|is not a function|Cannot read propert/.test(serverLog),
      "The server log carries no uncaught exception from any route."
    );

    // The sweep above is only a test if the server is still there at the end of
    // it. POST /api/assets used to throw where nothing caught it, and Node ends
    // the process on an unhandled rejection — so the suite would have recorded
    // one route as failed and then measured nothing at all.
    let aliveAfter = false;
    try {
      const health = await fetch(`${baseUrl}/api/health`);
      aliveAfter = health.status === 200;
    } catch {}

    assert(aliveAfter, "The server is still running after every route was called.");
    assert(
      !/Unhandled error on/.test(serverLog),
      "No route threw past its own handler into the request-level net."
    );

    // ── the three routes this sweep was written to catch ───────────────────
    const post = async (url) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return { status: response.status, body: await response.text() };
    };

    const cache = await post("/api/model-cache/clear");
    assert(
      cache.status === 200,
      `/api/model-cache/clear answers ${cache.status}, not the ReferenceError it used to throw on every call.`
    );

    const plan = await post("/api/storage/lifecycle/plan");
    assert(
      plan.status === 400,
      `/api/storage/lifecycle/plan with no rootPath answers ${plan.status}, not a Node internals error.`
    );

    const probe = await post("/api/text-runtime/remote-provider/test");
    assert(
      probe.status === 400,
      `/api/text-runtime/remote-provider/test with no provider answers ${probe.status}, not a server fault.`
    );
    assert(
      !probe.body.includes("nvapi-") && !probe.body.includes("sk-or-"),
      "No key material reaches the answer."
    );

    const deleteConversation = await post("/api/llm/delete-conversation");
    assert(
      deleteConversation.status === 400,
      `/api/llm/delete-conversation with no id answers ${deleteConversation.status}, not a server fault.`
    );

    const notInstalled = await post("/api/tts/start");
    assert(
      notInstalled.status === 503 || notInstalled.status === 200,
      `/api/tts/start on a machine without the TTS runtime answers ${notInstalled.status} — unavailable, not broken.`
    );

    console.log("\n  PASS: API route method sweep completed.\n");
  } finally {
    child.kill("SIGKILL");
    await delay(300);

    // Unlink node_modules before removing the tree. fs.rmSync does not follow a
    // symlink, verified rather than assumed, but this is the repository's real
    // dependency folder on the other end of it and the two extra lines are
    // cheaper than being wrong once.
    const linked = path.join(destination, "scripts", "server", "node_modules");
    try {
      if (fs.lstatSync(linked).isSymbolicLink()) fs.unlinkSync(linked);
    } catch {}

    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
