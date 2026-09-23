#!/usr/bin/env node
"use strict";

/**
 * Nothing in the repository may reference an identifier that is never declared.
 *
 * Four shipped bugs were this one mistake, and none of them is visible to any
 * other check:
 *
 *   typeof imageToVideoProcessRunner?.drainQueue === "function"
 *     `typeof x` is safe for an undeclared x, but `typeof x?.y` evaluates its
 *     base first, so the optional chaining threw. Every resume failed.
 *
 *   try { parsed = JSON.parse(...) } catch (_) {}
 *   if (...) return json(res, _.statusCode || 500, {...})
 *     A catch binding exists only inside its own block. Every failed render
 *     answered "_ is not defined" instead of the worker's own error.
 *
 *   style={typeof getSliderStyle === "function" ? getSliderStyle(...) : undefined}
 *     The helper lived in Settings.jsx and was never exported. The guard hid
 *     it, so the slider silently rendered with no fill.
 *
 *   `${NOT_A_PROGRAM} It reads like a plan — ...`
 *     Exported by work-tool-call.mjs, used by WorkTerminalDock.jsx, and absent
 *     from its import list. Offering a plan threw.
 *
 * None is a syntax error, so `node --check` passes. None fires unless its code
 * path runs, so a route sweep finds them only by luck. eslint's no-undef rule
 * finds all of them at once.
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
  console.log("\n=== No undefined identifiers anywhere ===\n");

  const eslintPath = resolveFromFrontend("eslint");
  const globalsPath = resolveFromFrontend("globals");

  if (!eslintPath || !globalsPath) {
    console.log("  SKIPPED — eslint is not installed under app/frontend/node_modules.");
    console.log("  This check needs it to read the code's scopes. Run ./mac.sh once,");
    console.log("  or: cd app/frontend && npm install");
    console.log("");
    return;
  }

  const { ESLint } = require(eslintPath);
  const globals = require(globalsPath);

  const eslint = new ESLint({
    cwd: root,
    // Self-contained: never pick up whatever config happens to be lying around.
    overrideConfigFile: true,
    overrideConfig: TARGETS.map((target) => ({
      files: [target.pattern],
      languageOptions: target.languageOptions(globals),
      rules: { "no-undef": "error" },
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
        if (message.ruleId !== "no-undef") continue;
        found += 1;
        problems.push(
          `${path.relative(root, file.filePath)}:${message.line}  ${message.message}`
        );
      }
    }
    console.log(`  ${target.label}: ${files.length} files, ${found} undefined`);
  }

  assert(totalFiles > 200, `Linted ${totalFiles} files across the whole tree, more than 200.`);

  if (problems.length) {
    console.log(`\n  ${problems.length} undefined identifier(s):`);
    problems.slice(0, 20).forEach((line) => console.log(`    ${line}`));
  }

  assert(
    problems.length === 0,
    `Every identifier in ${totalFiles} files is declared (${problems.length} are not).`
  );

  // A check that lints nothing and reports success is worse than no check, so
  // prove the rule is live: lint a file written to fail it.
  const probeDir = path.join(root, "scripts", "__no_undef_probe__");
  const probeFile = path.join(probeDir, "probe.cjs");
  fs.mkdirSync(probeDir, { recursive: true });

  try {
    fs.writeFileSync(
      probeFile,
      '"use strict";\nmodule.exports = function () {\n  return definitelyNotDeclaredAnywhere.x;\n};\n'
    );

    const probeResults = await eslint.lintFiles(["scripts/__no_undef_probe__/probe.cjs"]);
    const caught = probeResults.flatMap((result) =>
      result.messages.filter((message) => message.ruleId === "no-undef")
    );

    assert(
      caught.length === 1,
      `The rule is live: it flagged the deliberately undefined name (${caught.length} flagged).`
    );
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }

  console.log("\n  PASS: No undefined identifiers anywhere completed.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
