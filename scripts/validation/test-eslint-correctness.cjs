#!/usr/bin/env node
"use strict";

/**
 * eslint's correctness rules, over the whole tree.
 *
 * This began as a no-undef check after two shipped routes turned out to call
 * names that were never declared. Pointing the rest of eslint's recommended
 * rules at the tree found four more things that were wrong rather than merely
 * untidy:
 *
 *   readJsonFile was declared twice, with different bodies. Function
 *   declarations hoist, so the second won file-wide and the first — the one a
 *   reader meets first, with the stricter object check and a null default —
 *   never ran anywhere. formatBytes was declared twice identically.
 *
 *   A `return;` in serve.cjs that no path could reach.
 *
 *   Ten validation suites threw from inside a finally block. A throw there
 *   replaces whatever the try block already threw, so a suite that failed for
 *   one reason reported a different one — and the cleanup written after the
 *   throw never ran. They mark the failure and set a non-zero exit code now,
 *   which fails the scan without hiding anything.
 *
 * None of these is a syntax error, so `node --check` passes, and none fires on
 * a path a route sweep happens to walk.
 *
 * eslint lives in app/frontend's devDependencies because that is the one place
 * setup.sh runs npm install — nothing installs scripts/server's dependencies, so
 * declaring it there would never reach a user's machine.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function resolveFromFrontend(name) {
  try {
    return require.resolve(name, { paths: [frontend] });
  } catch {
    return null;
  }
}

/**
 * Style rules, turned off deliberately. Each one was looked at, not filtered
 * wholesale:
 *
 *   no-unused-vars       dead locals are not defects and there are many
 *   no-empty             empty catch blocks are used for best-effort cleanup
 *   no-useless-escape    153 hits, all cosmetic, mostly in character classes
 *   no-control-regex     intentional — the server strips ANSI escapes (\x1b)
 *   no-regex-spaces      style
 *   no-sparse-arrays     `(m || [, "boot"])[1]` is correct and idiomatic
 *   no-unexpected-multiline  two hits that parse exactly as written
 */
const STYLE_RULES = [
  "no-unused-vars",
  "no-empty",
  "no-useless-escape",
  "no-control-regex",
  "no-regex-spaces",
  "no-sparse-arrays",
  "no-unexpected-multiline",
];

/** What to lint, and how each part of the tree has to be read to lint it. */
const TARGETS = [
  {
    label: "server, workers and validation suites",
    pattern: "scripts/**/*.cjs",
    languageOptions: (globals) => ({
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.es2021 },
    }),
  },
  {
    label: "frontend modules",
    pattern: "app/frontend/src/**/*.{js,mjs}",
    languageOptions: (globals) => ({
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
    }),
  },
  {
    label: "React components",
    pattern: "app/frontend/src/**/*.jsx",
    languageOptions: (globals) => ({
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    }),
  },
];

async function main() {
  console.log("\n=== eslint correctness rules, whole tree ===\n");

  const eslintPath = resolveFromFrontend("eslint");
  const globalsPath = resolveFromFrontend("globals");
  const jsPath = resolveFromFrontend("@eslint/js");

  if (!eslintPath || !globalsPath || !jsPath) {
    console.log("  SKIPPED — eslint is not installed under app/frontend/node_modules.");
    console.log("  This check needs it to read the code. Run ./mac.sh once,");
    console.log("  or: cd app/frontend && npm install");
    console.log("");
    return;
  }

  const { ESLint } = require(eslintPath);
  const globals = require(globalsPath);
  const js = require(jsPath);

  const rules = { ...js.configs.recommended.rules };
  for (const rule of STYLE_RULES) delete rules[rule];

  const eslint = new ESLint({
    cwd: root,
    // Self-contained: never pick up whatever config happens to be lying around.
    overrideConfigFile: true,
    overrideConfig: TARGETS.map((target) => ({
      files: [target.pattern],
      languageOptions: target.languageOptions(globals),
      rules,
    })),
  });

  let totalFiles = 0;
  const problems = [];

  for (const target of TARGETS) {
    const results = await eslint.lintFiles([target.pattern]);
    const files = results.filter(
      (result) => !result.filePath.includes(`${path.sep}node_modules${path.sep}`)
    );
    totalFiles += files.length;

    let found = 0;
    for (const file of files) {
      for (const message of file.messages) {
        if (!message.ruleId) continue;
        found += 1;
        problems.push(
          `${path.relative(root, file.filePath)}:${message.line}  ${message.ruleId}  ${message.message}`
        );
      }
    }
    console.log(`  ${target.label}: ${files.length} files, ${found} problems`);
  }

  assert(totalFiles > 200, `Linted ${totalFiles} files across the whole tree, more than 200.`);

  if (problems.length) {
    console.log(`\n  ${problems.length} problem(s):`);
    problems.slice(0, 20).forEach((line) => console.log(`    ${line}`));
  }

  assert(problems.length === 0, `The tree is clean (${problems.length} problems).`);

  // A check that lints nothing and reports success is worse than no check, so
  // prove two rules are live with files written to break them.
  const probeDir = path.join(root, "scripts", "__lint_probe__");
  fs.mkdirSync(probeDir, { recursive: true });

  try {
    fs.writeFileSync(
      path.join(probeDir, "undef.cjs"),
      '"use strict";\nmodule.exports = function () {\n  return definitelyNotDeclaredAnywhere.x;\n};\n'
    );
    fs.writeFileSync(
      path.join(probeDir, "redeclare.cjs"),
      '"use strict";\nfunction twice() { return 1; }\nfunction twice() { return 2; }\nmodule.exports = twice;\n'
    );

    const probeResults = await eslint.lintFiles([
      "scripts/__lint_probe__/undef.cjs",
      "scripts/__lint_probe__/redeclare.cjs",
    ]);
    const caught = new Set(
      probeResults.flatMap((result) => result.messages.map((message) => message.ruleId))
    );

    assert(caught.has("no-undef"), "no-undef is live: it flagged the undeclared name.");
    assert(caught.has("no-redeclare"), "no-redeclare is live: it flagged the duplicate declaration.");
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }

  console.log("\n  PASS: eslint correctness rules completed.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
