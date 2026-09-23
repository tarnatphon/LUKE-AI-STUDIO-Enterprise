#!/usr/bin/env node
"use strict";

/**
 * No server file may reference an identifier that is never declared.
 *
 * Two shipped routes were broken by exactly this, and both looked fine to every
 * other check:
 *
 *   typeof imageToVideoProcessRunner?.drainQueue === "function"
 *
 * `typeof x` is safe for an undeclared x, but `typeof x?.y` evaluates its base
 * first, so the optional chaining threw ReferenceError. Every resume failed.
 *
 *   try { parsed = JSON.parse(...) } catch (_) {}
 *   if (...) return json(res, _.statusCode || 500, {...})
 *
 * A catch binding exists only inside its own block, so the line below it threw,
 * and every failed render answered "_ is not defined" instead of the worker's
 * own error.
 *
 * Neither is a syntax error, so `node --check` passes; neither fires unless the
 * code path runs, so a route sweep only finds them by luck. eslint's no-undef
 * rule finds all of them at once. It lives in app/frontend's devDependencies
 * because that is the one place setup.sh runs npm install — nothing installs
 * scripts/server's dependencies, so declaring it there would never reach a
 * user's machine.
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

async function main() {
  console.log("\n=== Server has no undefined identifiers ===\n");

  const eslintPath = resolveFromFrontend("eslint");
  const globalsPath = resolveFromFrontend("globals");

  if (!eslintPath || !globalsPath) {
    console.log("  SKIPPED — eslint is not installed under app/frontend/node_modules.");
    console.log("  This check needs it to read the server's scopes. Run ./mac.sh once,");
    console.log("  or: cd app/frontend && npm install");
    console.log("");
    return;
  }

  const { ESLint } = require(eslintPath);
  const globals = require(globalsPath);

  const eslint = new ESLint({
    cwd: root,
    // Self-contained: do not pick up whatever config happens to be lying around.
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.cjs"],
        languageOptions: {
          ecmaVersion: 2023,
          sourceType: "commonjs",
          globals: { ...globals.node, ...globals.es2021 },
        },
        rules: { "no-undef": "error" },
      },
    ],
  });

  const targets = ["scripts/server/**/*.cjs"];
  const results = await eslint.lintFiles(targets);

  const files = results.filter((result) => !result.filePath.includes(`${path.sep}node_modules${path.sep}`));

  assert(files.length > 20, `Linted ${files.length} server files, more than 20.`);

  const problems = [];
  for (const file of files) {
    for (const message of file.messages) {
      if (message.ruleId !== "no-undef") continue;
      problems.push(
        `${path.relative(root, file.filePath)}:${message.line}  ${message.message}`
      );
    }
  }

  if (problems.length) {
    console.log(`  ${problems.length} undefined identifier(s):`);
    problems.slice(0, 20).forEach((line) => console.log(`    ${line}`));
  }

  assert(
    problems.length === 0,
    `Every identifier in ${files.length} server files is declared (${problems.length} are not).`
  );

  // A check that lints nothing and reports success is worse than no check, so
  // prove the rule is live: lint a file written to fail it.
  const probeDir = path.join(root, "scripts", "server", "__no_undef_probe__");
  const probeFile = path.join(probeDir, "probe.cjs");
  fs.mkdirSync(probeDir, { recursive: true });

  try {
    fs.writeFileSync(
      probeFile,
      '"use strict";\nmodule.exports = function () {\n  return definitelyNotDeclaredAnywhere.x;\n};\n'
    );

    const probeResults = await eslint.lintFiles([
      path.relative(root, probeFile).split(path.sep).join("/"),
    ]);
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

  console.log("\n  PASS: Server has no undefined identifiers completed.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
