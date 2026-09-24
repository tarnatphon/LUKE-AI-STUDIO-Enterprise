#!/usr/bin/env node
"use strict";

/**
 * The interface renders links out of content it does not own.
 *
 * The chat renders markdown links straight out of model output, the search
 * panel renders source URLs out of indexed content, the model manager
 * renders page URLs out of the model list, and the social agency renders a
 * product's source URL. A link in such content is a value to check, not a
 * command to obey: href="javascript:…" executes in the app's own origin
 * when clicked.
 *
 * There is a second layer to the check, and it is the one that defeats naive
 * ones: browsers strip tabs, newlines and other control characters from an
 * href before parsing its scheme, so "java\tscript:alert(1)" runs just as
 * well. The guard parses the value the way the browser will — stripped
 * first, scheme allowed second — and the unit assertions below cover the
 * bypass shapes, not only the plain ones.
 */

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function main() {
  console.log("\n=== Content-derived links stay links ===\n");

  const { safeExternalUrl } = await import(
    pathToFileURL(path.join(root, "app", "frontend", "src", "lib", "safe-link.mjs")).href
  );

  // ── the guard itself ─────────────────────────────────────────────────────
  const allowed = [
    "https://example.com/page",
    "http://example.com",
    "mailto:someone@example.com",
    "/api/output-file?filename=abc.png",
    "#section",
  ];

  for (const url of allowed) {
    assert(safeExternalUrl(url) === url.replace(/\s+/g, ""), `an ordinary ${JSON.stringify(url)} survives.`);
  }

  const rejected = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:http://app.example/uuid",
  ];

  for (const url of rejected) {
    assert(safeExternalUrl(url) === "", `a ${url.split(":")[0]}: link is refused.`);
  }

  // The bypass shapes: the browser strips these characters before it parses
  // the scheme, so a check that looked at the raw string would have passed
  // them.
  const bypasses = [
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\rscript:alert(1)",
    "  javascript:alert(1)",
    "java\u0000script:alert(1)",
  ];

  for (const url of bypasses) {
    assert(safeExternalUrl(url) === "", `a ${JSON.stringify(url)} that would survive raw-string checks is refused.`);
  }

  assert(safeExternalUrl("  https://example.com ") === "https://example.com", "harmless surrounding whitespace is cleaned, not rejected.");
  assert(safeExternalUrl("") === "" && safeExternalUrl(42) === "" && safeExternalUrl(null) === "", "empty and non-string values come out empty.");

  // ── every link site in the interface goes through the guard ─────────────
  const srcDir = path.join(root, "app", "frontend", "src");

  const jsxFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsx")) jsxFiles.push(full);
    }
  })(srcDir);

  assert(jsxFiles.length > 20, `The sweep really walks the interface (${jsxFiles.length} .jsx files).`);

  const unguardedHref = [];
  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/href=\{([^}]*)\}/g)) {
      const expr = match[1].trim();
      // A bare identifier is one hop away from the guard — follow it to its
      // definition instead of flagging the shape.
      const identifierGuard = /^[A-Za-z_$][\w$]*$/.test(expr) &&
        new RegExp(`const ${expr} = safeExternalUrl\\(`).test(text);
      const guarded =
        expr.includes("safeExternalUrl(") ||
        identifierGuard ||
        /^["'`]\/?/.test(expr) ||
        /^["'`]#/.test(expr);
      if (!guarded) {
        unguardedHref.push(`${path.relative(root, file)}: href={${expr.slice(0, 60)}}`);
      }
    }
  }
  assert(
    unguardedHref.length === 0,
    `Every dynamic href in the interface passes the guard or is a static literal.${unguardedHref.length ? ` Unguarded: ${unguardedHref.join(" | ")}` : ""}`
  );

  // The one window.open in the interface is a link with a different verb.
  const openSites = [];
  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/window\.open\(\s*([^,)]+)/g)) {
      const arg = match[1].trim();
      const identifierGuard = /^[A-Za-z_$][\w$]*$/.test(arg) &&
        new RegExp(`const ${arg} = safeExternalUrl\\(`).test(text);
      const guarded = arg.includes("safeExternalUrl(") || identifierGuard || /^["'`]/.test(arg);
      if (!guarded) {
        openSites.push(`${path.relative(root, file)}: window.open(${arg.slice(0, 60)})`);
      }
    }
  }
  assert(
    openSites.length === 0,
    `Every window.open takes a guarded or literal URL.${openSites.length ? ` Unguarded: ${openSites.join(" | ")}` : ""}`
  );

  // ── the markdown renderer specifically ───────────────────────────────────
  const textChat = fs.readFileSync(path.join(srcDir, "components", "TextChat.jsx"), "utf8");
  const inlineFn = textChat.slice(textChat.indexOf("function parseInlineMarkdown"), textChat.indexOf("function parseInlineMarkdown") + 3000);
  assert(
    inlineFn.includes("const href = safeExternalUrl(match[2])"),
    "The markdown link branch checks the URL the model wrote."
  );
  assert(
    inlineFn.includes("if (!href) return <span key={idx}>{match[1]}</span>;"),
    "and a refused URL renders as plain text, not a dead link that navigates home."
  );

  console.log("\n  PASS: Content-derived links stay links completed.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
