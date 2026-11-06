#!/usr/bin/env node
"use strict";

/**
 * A `const` read before its declaration is not a style nit here.
 *
 * Twice it shipped, and twice it landed on the user's screen as a bug report:
 *
 *   "Cannot access 'gt' before initialization"   → the Chat tab died on render
 *                                                  ("Workspace could not be loaded")
 *   "Cannot access 'w' before initialization"    → every reply in Work mode
 *                                                  came back as a red Error bubble
 *
 * Both were the same mistake — a value derived from `useState` results, or a
 * max-token budget, written above the line that creates it. Nothing in the
 * build chain objects: esbuild happily compiles it, and the old suites only
 * grep the source. So the rule is enforced here instead.
 *
 * The allowlist is not "these are fine, ignore them" — each entry names code
 * that can only run after render finishes (an event handler, a `useCallback`
 * body), where the binding is already initialised. Anything new fails the
 * suite, and an entry that stops being reported must be deleted, so the list
 * cannot quietly rot into a place where real bugs hide.
 *
 * Run: node scripts/validation/test-no-tdz.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const eslintBin = path.join(frontend, "node_modules", "eslint", "bin", "eslint.js");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

/**
 * Deferred-only references. Key: path under app/frontend/src. Value: symbol →
 * when it can first run, which is always after the declaration has executed.
 */
const ALLOWED = {
  "components/ImageToVideo.jsx": {
    normalizeVideoUrl: "inside the polling callback, after render",
    pollImageToVideoJob: "inside the polling callback, after render",
    setCurrentBatchId: "inside the recovery effect, after render",
  },
  "components/ModelManager.jsx": {
    checkActiveDownload: "inside useEffect, after render",
    handleUnloadModel: "inside onClick / useEffect, after render",
    performLoadModel: "inside an effect or handler, after render",
    startProgressPolling: "inside an effect, after render",
  },
  "components/PersistentTextChat.jsx": {
    loadRuntimeSupervisorPolicy: "inside useCallback, after render",
    refreshRuntimeSupervisor: "inside useCallback, after render",
  },
  "components/WorkTerminalDock.jsx": {
    offerPlan: "inside the paste handler, after render",
  },
};

const configPath = path.join(os.tmpdir(), `luke-no-tdz-${process.pid}.mjs`);
fs.writeFileSync(
  configPath,
  `export default [
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-use-before-define": ["error", { functions: false, classes: true, variables: true, allowNamedExports: true }],
    },
  },
];
`,
  "utf8",
);

try {
  console.log("=== No use before define ===\n");

  assert(fs.existsSync(eslintBin), "eslint is installed (npm ci --prefix app/frontend)");

  const run = spawnSync(
    process.execPath,
    [eslintBin, "-c", configPath, "--no-config-lookup", "--format", "json", "src"],
    { cwd: frontend, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  assert(run.error === undefined, "eslint runs");

  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    throw new Error(`FAIL: could not read eslint output\n${run.stdout}\n${run.stderr}`);
  }

  const violations = [];
  for (const file of report) {
    const relative = path.relative(path.join(frontend, "src"), file.filePath).split(path.sep).join("/");
    for (const message of file.messages) {
      if (message.ruleId !== "no-use-before-define") continue;
      const symbol = (message.message.match(/'([^']+)'/) || [])[1] || message.message;
      violations.push({ file: relative, line: message.line, symbol });
    }
  }

  const seen = new Set(violations.map((item) => `${item.file}·${item.symbol}`));
  assert(violations.length < 60, `the scan looks sane (${violations.length} references before their declaration)`);

  // The file that crashed twice must be clean, allowlist or not.
  const chatCrashes = violations.filter((item) => item.file === "components/TextChat.jsx");
  assert(
    chatCrashes.length === 0,
    `TextChat.jsx reads nothing before it is declared${chatCrashes.length
      ? ` — still: ${chatCrashes.map((item) => `${item.symbol} (line ${item.line})`).join(", ")}`
      : ""}`,
  );

  const unexpected = violations.filter((item) => !ALLOWED[item.file]?.[item.symbol]);
  assert(
    unexpected.length === 0,
    unexpected.length === 0
      ? "every remaining reference is a deferred one, listed with its reason"
      : `nothing new may be used before it is declared:\n${unexpected
        .map((item) => `      ${item.file}:${item.line}  ${item.symbol}`)
        .join("\n")}`,
  );

  const stale = Object.entries(ALLOWED).flatMap(([file, symbols]) =>
    Object.keys(symbols).filter((symbol) => !seen.has(`${file}·${symbol}`)).map((symbol) => `${file}·${symbol}`),
  );
  assert(
    stale.length === 0,
    stale.length === 0
      ? "the allowlist has no stale entries"
      : `these allowlist entries no longer happen — delete them: ${stale.join(", ")}`,
  );

  // The two shapes that actually crashed, stated as behaviour rather than names:
  // a value derived from useState must come after the useState.
  const chat = fs.readFileSync(path.join(frontend, "src", "components", "TextChat.jsx"), "utf8");
  const slotState = chat.indexOf('const [activeSlot, setActiveSlot] = useState("");');
  const slotDerived = chat.indexOf("const activeSlotProfile = activeSlot ?");
  assert(slotState !== -1 && slotDerived > slotState, "the slot profile is derived after the slot state exists");

  const arenaBranch = chat.indexOf("if (arenaRoundRequested && !imageAttachments.length)");
  const maxTokens = chat.indexOf("const effectiveMaxTokens =");
  assert(
    maxTokens !== -1 && maxTokens < arenaBranch,
    "the max-token budget is computed before the arena branch that reads it",
  );

  console.log(`\nPASS: ${checks} checks — nothing reaches a declaration before it runs.`);
} finally {
  fs.rmSync(configPath, { force: true });
}
