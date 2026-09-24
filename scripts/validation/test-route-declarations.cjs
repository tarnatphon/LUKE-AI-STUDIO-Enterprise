#!/usr/bin/env node
"use strict";

/**
 * No declared route is made unreachable by a route declared before it.
 *
 * The server takes the first handler whose condition matches. An exact
 * route (/api/llm/recommendations) whose URL starts with an earlier prefix
 * (/api/llm/recommend, declared with startsWith) is never called — the
 * prefix swallows the request first. Nothing else catches that: the route
 * sweep reaches the URL and gets an answer, but the answer comes from the
 * prefix handler, and the dead route simply stops being code.
 *
 * Measured today: no such shadowing exists, in either shape (prefix over
 * exact, prefix over prefix), and the /api/ catch-all — the one prefix that
 * swallows on purpose — is declared last, where a fallback belongs. The
 * /api/social-agency prefix swallows its namespace on purpose too: those
 * routes are declared in the runtime module it delegates to, which is why
 * this suite's scope is the declarations in serve.cjs itself.
 *
 * This is the pin: the next prefix route added above an exact route fails
 * the suite with both routes named, instead of shipping as silent dead
 * code.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function main() {
  console.log("\n=== No route shadows another ===\n");

  const source = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
  const lines = source.split("\n");

  function enclosing(index) {
    const line = source.slice(0, index).split("\n").length;
    return lines.slice(Math.max(0, line - 4), line + 3).join("\n");
  }

  const entries = [];
  const seen = new Set();

  const forms = [
    [/req\.url\s*===\s*"((?:\/)[^"]+)"/g, "exact"],
    [/req\.url\.startsWith\("((?:\/)[^"]+)"\)/g, "prefix"],
    [/String\(req\.url[^)]*\)\.split\("\?"\)\[0\]\s*===\s*"((?:\/)[^"]+)"/g, "exact"],
    [/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*===\s*"((?:\/(?:api|v1|sdapi|tts-outputs))[^"]*)"/g, "exact"],
    [/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.startsWith\("((?:\/(?:api|v1|sdapi|tts-outputs))[^"]*)"\)/g, "prefix"],
  ];

  for (const [re, kind] of forms) {
    let match;
    while ((match = re.exec(source)) !== null) {
      const line = source.slice(0, match.index).split("\n").length;
      const condition = enclosing(match.index);
      const methodMatch = condition.match(/req\.method\s*===\s*"([A-Z]+)"/);
      const method = methodMatch ? methodMatch[1] : null;
      const key = `${method || "*"}|${kind}|${match[1]}|${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ line, method, url: match[1], kind });
    }
  }

  entries.sort((a, b) => a.line - b.line);

  // The eleven-plus routes declared as regex literals are not in the list
  // above; count them separately. They all live in the delegated
  // social-agency namespace, so they join the sanity count but not the
  // shadow check.
  const regexLiterals = source.match(/\/\^\\\/(?:api|v1|sdapi|tts-outputs)[^\n]*?\$\//g) || [];

  assert(
    entries.length >= 270,
    `The parser found ${entries.length} string routes — the sweep sees 293 routes in total, so the string forms are not being missed.`
  );
  assert(
    regexLiterals.length >= 10,
    `The ${regexLiterals.length} regex-declared routes are still declared as regex literals (the sweep expands their alternatives into the remaining routes).`
  );

  assert(
    entries.every((entry) => /^(\/api\/|\/v1\/|\/sdapi\/|\/tts-outputs\/)/.test(entry.url)),
    "Every declared route lives in a known namespace."
  );

  // ── the invariant ────────────────────────────────────────────────────────
  // An earlier-declared prefix swallows a later route when the later URL
  // extends the prefix past a path boundary: /api/llm/recommend swallows
  // /api/llm/recommendations, but not /api/llm/recommendations-v2, which is
  // a different segment.
  const shadows = [];

  for (const outer of entries) {
    if (outer.kind !== "prefix") continue;
    for (const inner of entries) {
      if (inner.line <= outer.line) continue;
      if (outer.method && inner.method && outer.method !== inner.method) continue;
      if (!inner.url.startsWith(outer.url)) continue;
      const rest = inner.url.slice(outer.url.length);
      if (rest === "" || rest.startsWith("/")) continue;
      shadows.push({
        prefix: outer,
        shadowed: inner,
        shape: inner.kind === "prefix" ? "prefix-over-prefix" : "prefix-over-exact",
      });
    }
  }

  assert(
    shadows.length === 0,
    `No route is swallowed by an earlier prefix.${shadows.length ? ` Shadows: ` + shadows.map((s) => `L${s.prefix.line} ${s.prefix.url} swallows ${s.shape} L${s.shadowed.line} ${s.shadowed.url}`).join(" | ") : ""}`
  );

  // ── the prefixes that swallow on purpose stay where they belong ─────────
  const catchAll = entries.filter((entry) => entry.kind === "prefix" && entry.url === "/api/");
  assert(
    catchAll.length > 0,
    "The /api/ catch-all exists — the sweep's unexplained-404 check depends on it."
  );
  const apiPrefixes = entries.filter(
    (entry) => entry.kind === "prefix" && entry.url.startsWith("/api/")
  );
  const lastApiPrefix = apiPrefixes[apiPrefixes.length - 1];
  assert(
    catchAll.some((entry) => entry.line === lastApiPrefix.line),
    "and it is the last /api/ prefix declared, so it is the fallback instead of the first bite."
  );

  console.log("\n  PASS: No route shadows another completed.\n");
}

main();
