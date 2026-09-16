"use strict";

/**
 * The Work agent loop, end to end, against the real server.
 *
 * Codex is useful for one reason above all others: it writes a change, runs
 * the project's own checks, reads the failure and tries again. This proves the
 * loop exists here — locate a symbol, patch it, run the failing check, see it
 * pass, review the diff, revert it — and that every step stays inside the
 * folder the user granted.
 *
 * Run: node scripts/validation/test-work-agent-loop.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  console.log("Work agent loop validation (end to end)");

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-agent-loop-"));
  const project = path.join(sandbox, "project");
  const secret = path.join(sandbox, "secret");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "test"), { recursive: true });
  fs.mkdirSync(secret, { recursive: true });
  fs.writeFileSync(path.join(secret, "passwords.txt"), "top secret");

  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({
    name: "agent-loop-fixture",
    version: "1.0.0",
    private: true,
    scripts: { test: "node test/calculator.test.js" },
  }, null, 2));

  // A function with a deliberate bug, plus a test that catches it.
  fs.writeFileSync(path.join(project, "src", "calculator.js"), [
    "function add(a, b) {",
    "  return a - b;",
    "}",
    "",
    "function multiply(a, b) {",
    "  return a * b;",
    "}",
    "",
    "module.exports = { add, multiply };",
    "",
  ].join("\n"));

  fs.writeFileSync(path.join(project, "test", "calculator.test.js"), [
    "const assert = require('node:assert');",
    "const fs = require('node:fs');",
    "const { add, multiply } = require('../src/calculator.js');",
    "",
    "// Proves the command really runs with the project as its working directory.",
    "fs.writeFileSync('cwd-proof.txt', process.cwd());",
    "",
    "assert.strictEqual(add(2, 3), 5, 'add(2,3) should be 5');",
    "assert.strictEqual(multiply(2, 3), 6, 'multiply(2,3) should be 6');",
    "console.log('all good');",
    "",
  ].join("\n"));

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.status === 200) ready = true;
      } catch {}
      if (!ready) await delay(150);
    }
    if (!ready) throw new Error(`Application server did not become ready.\n${log}`);

    const call = async (endpoint, payload) => {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {}
      return { status: response.status, data };
    };

    const projectId = "work_agent_loop";
    const grant = await call("/api/work/folder/restore", { projectId, roots: [project] });
    const grantId = grant.data?.grants?.[project];
    check("the project folder is granted", Boolean(grantId), `status ${grant.status}`);
    const base = { projectId, root: project, grantId };

    // ── A. The verify loop ─────────────────────────────────────────────────
    section("1. The project's own check command is detected (A)");
    const plan = await call("/api/work/check/plan", base);
    const commands = plan.data?.commands || [];
    check("npm-test is offered", commands.some((entry) => entry.id === "npm-test"), JSON.stringify(commands.map((entry) => entry.id)));
    check("the command is described for the model", commands.every((entry) => entry.label && entry.category === "check"));
    check("no free-form command is offered", !commands.some((entry) => /\brm\b|\bcurl\b|\bsh\b/.test(entry.file)));

    section("2. The check runs and reports the real failure (A)");
    const failing = await call("/api/work/check/run", { ...base, commandId: "npm-test" });
    check("the check ran", failing.status === 200, `status ${failing.status}`);
    check("it did not pass, because the code is wrong", failing.data?.result?.passed === false, JSON.stringify(failing.data?.result?.passed));
    check("the exit code comes back", Number(failing.data?.result?.exitCode) !== 0, String(failing.data?.result?.exitCode));
    check("the failure is summarised for the model", (failing.data?.result?.failureSignals || []).length > 0);
    check("the output mentions the assertion", /should be 5|AssertionError/.test(String(failing.data?.result?.output)));
    check("it ran with the project as its working directory", fs.existsSync(path.join(project, "cwd-proof.txt")));
    check(
      "it could not write outside the project",
      !fs.existsSync(path.join(sandbox, "cwd-proof.txt")),
    );
    check("a command the project does not have is refused", (await call("/api/work/check/run", { ...base, commandId: "rm-rf" })).status === 404);

    // ── C. Repository understanding ────────────────────────────────────────
    section("3. The repository is understood without reading every file (C)");
    const map = await call("/api/work/index/map", base);
    check("the map names the folders", /src\//.test(String(map.data?.result?.map)) && /test\//.test(String(map.data?.result?.map)));
    check("the map reports the languages", (map.data?.result?.summary?.languages || []).some((entry) => entry.language === "javascript"));
    check("entry points are called out", (map.data?.result?.entryPoints || []).includes("package.json"));
    check("the map never leaks the folder next door", !/passwords|secret/.test(String(map.data?.result?.map)));

    const outline = await call("/api/work/index/outline", { ...base, path: "src/calculator.js" });
    const symbols = outline.data?.result?.symbols || [];
    check("the file outline lists its functions", symbols.some((entry) => entry.name === "add") && symbols.some((entry) => entry.name === "multiply"));
    check("the outline carries line numbers", symbols.every((entry) => Number(entry.line) > 0));

    const symbol = await call("/api/work/index/symbol", { ...base, name: "add" });
    check("the definition is found", (symbol.data?.result?.definitions || []).some((entry) => entry.file === "src/calculator.js"));
    check("the usages are found", (symbol.data?.result?.usages || []).some((entry) => entry.file.endsWith("calculator.test.js")));
    check("a symbol outside the folder is invisible", !(symbol.data?.result?.usages || []).some((entry) => entry.file.includes("secret")));

    const search = await call("/api/work/index/search", { ...base, pattern: "return a - b" });
    check("regex search finds the buggy line", (search.data?.result?.results || []).length === 1);
    check("search results carry file and line", (search.data?.result?.results?.[0]?.line || 0) > 0);

    // ── B. Patch editing ───────────────────────────────────────────────────
    section("4. Edits are targeted patches, not whole-file rewrites (B)");
    const run = await call("/api/work/run/begin", { ...base, label: "fix add()" });
    const runId = run.data?.result?.runId;
    check("a Work run is opened", Boolean(runId), `status ${run.status}`);

    const badAnchor = await call("/api/work/file/patch", {
      ...base,
      runId,
      path: "src/calculator.js",
      edits: [{ op: "replace", old: "return a + b;", new: "return a * b;" }],
    });
    check("an anchor that is not in the file is refused", badAnchor.status === 422, `status ${badAnchor.status}`);
    check(
      "the file was not touched by the refused patch",
      fs.readFileSync(path.join(project, "src", "calculator.js"), "utf8").includes("return a - b;"),
    );

    const ambiguous = await call("/api/work/file/patch", {
      ...base,
      runId,
      path: "src/calculator.js",
      edits: [{ op: "replace", old: "return ", new: "return 0;" }],
    });
    check("an anchor that matches twice is refused", ambiguous.status === 422, `status ${ambiguous.status}`);
    check(
      "nothing was written for the ambiguous patch either",
      fs.readFileSync(path.join(project, "src", "calculator.js"), "utf8").includes("return a - b;"),
    );

    const patched = await call("/api/work/file/patch", {
      ...base,
      runId,
      path: "src/calculator.js",
      edits: [{ op: "replace", old: "return a - b;", new: "return a + b;" }],
    });
    check("the exact patch is applied", patched.status === 200 && patched.data?.result?.changed === true, `status ${patched.status}`);
    check("only the patched line changed", fs.readFileSync(path.join(project, "src", "calculator.js"), "utf8").includes("return a + b;"));
    check(
      "the rest of the file survived",
      fs.readFileSync(path.join(project, "src", "calculator.js"), "utf8").includes("function multiply"),
    );

    section("5. The check is run again — and now it passes (A + B)");
    const passing = await call("/api/work/check/run", { ...base, commandId: "npm-test" });
    check("the project's own test suite passes", passing.data?.result?.passed === true, JSON.stringify(passing.data?.result?.output || "").slice(0, 300));
    check("no failure signals are reported", (passing.data?.result?.failureSignals || []).length === 0);

    // ── D. Review and undo ─────────────────────────────────────────────────
    section("6. The run is reviewed before anything is kept (D)");
    const review = await call("/api/work/run/review", { ...base, runId });
    const changes = review.data?.result?.changes || [];
    check("one file is reported as changed", changes.length === 1, JSON.stringify(changes.map((entry) => entry.path)));
    check("the change is a unified diff", /^--- a\/src\/calculator\.js$/m.test(String(changes[0]?.diff)));
    check("the diff shows the removed and added lines", /-  return a - b;/.test(String(changes[0]?.diff)) && /\+  return a \+ b;/.test(String(changes[0]?.diff)));
    check("the totals are counted", review.data?.result?.totals?.additions === 1 && review.data?.result?.totals?.deletions === 1, JSON.stringify(review.data?.result?.totals));
    check("the change can be undone", changes[0]?.undoable === true);

    section("7. Reverting puts the project back (D)");
    const reverted = await call("/api/work/run/revert", { ...base, runId });
    check("the revert reports the file", (reverted.data?.result?.restored || []).length === 1);
    check(
      "the original code is back",
      fs.readFileSync(path.join(project, "src", "calculator.js"), "utf8").includes("return a - b;"),
    );
    const afterRevert = await call("/api/work/run/review", { ...base, runId });
    check("there is nothing left to review", (afterRevert.data?.result?.changes || []).length === 0);
    const failingAgain = await call("/api/work/check/run", { ...base, commandId: "npm-test" });
    check("the check fails again, proving the revert was real", failingAgain.data?.result?.passed === false);

    section("8. A whole-file write joins the same safety net (D)");
    const secondRun = await call("/api/work/run/begin", { ...base, label: "rewrite" });
    const secondRunId = secondRun.data?.result?.runId;
    const rewritten = await call("/api/work/file/write", {
      ...base,
      runId: secondRunId,
      path: "src/calculator.js",
      content: "function add(a, b) {\n  return a + b;\n}\nfunction multiply(a, b) {\n  return a * b;\n}\nmodule.exports = { add, multiply };\n",
      approvalGranted: true,
    });
    check("the whole-file write succeeded", rewritten.status === 200, `status ${rewritten.status}`);
    const secondReview = await call("/api/work/run/review", { ...base, runId: secondRunId });
    check("it is in the review too", (secondReview.data?.result?.changes || []).length === 1);
    await call("/api/work/run/revert", { ...base, runId: secondRunId });
    check(
      "and it can be undone the same way",
      fs.readFileSync(path.join(project, "src", "calculator.js"), "utf8").includes("return a - b;"),
    );

    section("9. Nothing reaches outside the granted folder");
    const escapePatch = await call("/api/work/file/patch", {
      ...base,
      runId,
      path: "../secret/passwords.txt",
      edits: [{ op: "append", text: "pwned" }],
    });
    // Work paths answer 400 for ".." and absolute paths (the shared guard's
    // convention, same as every other Work endpoint) and 403 for a grant
    // mismatch; either way the write is refused.
    check("a path that leaves the folder is refused", escapePatch.status === 400 || escapePatch.status === 403, `status ${escapePatch.status}`);
    check("the file outside is untouched", fs.readFileSync(path.join(secret, "passwords.txt"), "utf8") === "top secret");
    const absolutePatch = await call("/api/work/file/patch", {
      ...base,
      runId,
      path: path.join(secret, "passwords.txt"),
      edits: [{ op: "append", text: "pwned" }],
    });
    check("an absolute path outside the folder is refused", absolutePatch.status === 400 || absolutePatch.status === 403, `status ${absolutePatch.status}`);
    const otherFolderRun = await call("/api/work/run/begin", { projectId, root: secret, grantId });
    check("a folder without a grant cannot open a run", otherFolderRun.status === 403, `status ${otherFolderRun.status}`);
    const foreignRevert = await call("/api/work/run/revert", { projectId, root: secret, grantId, runId });
    check("a run cannot be reverted from another folder", foreignRevert.status === 403, `status ${foreignRevert.status}`);
    const canaryEscape = await call("/api/work/index/search", { ...base, pattern: "top secret" });
    check("the secret is not findable through search", (canaryEscape.data?.result?.results || []).length === 0);

    section("10. The model is taught the loop, and the UI shows it");
    const chat = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "TextChat.jsx"), "utf8");
    const panel = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "WorkAgentPanel.jsx"), "utf8");
    const server = fs.readFileSync(serverFile, "utf8");
    check("Work mode loads the panel", /import WorkAgentPanel from "\.\/WorkAgentPanel"/.test(chat));
    for (const tool of ["apply_patch", "create_file", "run_check", "find_symbol", "search_code", "repo_map", "read_outline", "update_tasks"]) {
      check(`"${tool}" is wired to an endpoint or handled`, chat.includes(`"${tool}"`));
    }
    check("whole-file writes still work", chat.includes('/api/work/file/write'));
    check("every write is backed up first", /const runId = changesFiles && !chatFolder \? await ensureWorkRun\(action\.path\) : null/.test(chat));
    check("a new task starts a new run", /workRunIdRef\.current = null/.test(chat));
    check("the model is told the workflow", /UNDERSTAND first/.test(chat) && /VERIFY with run_check/.test(chat));
    check("the model is told never to re-emit a whole file", /Never re-emit an entire file/.test(chat));
    check("the model is told not to invent a command", /never invent a commandId/.test(chat));
    check("the available check commands are injected", /Verification commands available in this project/.test(chat) && /loadCheckPlan/.test(chat));
    check("the project plan is kept in the prompt", /Your current plan/.test(chat));
    check("running a check asks first when the policy says so", /run the project check/.test(chat));
    check("the panel shows the plan", /Plan/.test(panel));
    check("the panel shows the diff", /change\.diff/.test(panel));
    check("the panel can undo the run", /Revert everything this run/.test(panel));
    check("the panel says LUKE AI never commits", /never commits, pushes or cleans/.test(panel));
    const runner = fs.readFileSync(path.join(root, "scripts", "server", "work-command-runner.cjs"), "utf8");
    check("commands are executed without a shell", /shell: false/.test(runner) && /execFileAsync\(command\.file, command\.args/.test(runner));
    check("the working directory is pinned to the granted folder", /cwd: root/.test(runner) && /killSignal: "SIGKILL"/.test(runner));
    check("only detected commands can run", /Unknown verification command/.test(runner));
    check("a missing interpreter is reported, not crashed on", /is not installed on this machine/.test(runner));
    check("every new endpoint checks the folder grant", (server.match(/assertWorkFolderGrant/g) || []).length >= 15);
    check("the patch endpoint is confined", /\/api\/work\/file\/patch/.test(server) && /assertNotChatScope\(body\.projectId\)/.test(server));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGKILL");
      });
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
