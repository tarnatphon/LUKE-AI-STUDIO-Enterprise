"use strict";

/**
 * A script the user pasted, run without a shell.
 *
 * Pasting finished code into the terminal is the obvious thing to do with it,
 * and until now the answer was a paragraph explaining where else to put it —
 * no answer at all when what the user wants is to see it run.
 *
 * So it runs. This suite is about what has to stay true while it does:
 *
 * - it asks before anything happens, because a script runs with the user's
 *   access, which reaches further than the folder they granted;
 * - the file it is written to lives inside the granted folder, resolved by the
 *   same guard every other Work path goes through, and is gone afterwards —
 *   running code must not quietly add files to the project;
 * - the interpreter gets exactly one argument, the file, so nothing in the
 *   script is ever re-read as command syntax, and no shell is involved;
 * - the working directory is the granted folder, so the project's own
 *   dependencies resolve the way they do everywhere else.
 *
 * Run: node scripts/validation/test-work-script-run.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const runnerFile = path.join(root, "scripts", "server", "work-script-runner.cjs");
const dockFile = path.join(root, "app", "frontend", "src", "components", "WorkTerminalDock.jsx");
const projectId = "script-run-audit";

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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/work/environment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return { port, child };
    } catch {
      await delay(250);
    }
  }
  child.kill("SIGKILL");
  throw new Error("The server never answered.");
}

async function main() {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-script-")));
  const neighbour = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-neighbour-")));
  const runner = require(runnerFile);

  section("1. Choosing the interpreter");
  check("a JavaScript script runs on node", runner.chooseInterpreter("auto", "const x = 1;\nconsole.log(x);") === "node");
  check("a Python script runs on python3", runner.chooseInterpreter("auto", "def main():\n    print('hi')\n") === "python3");
  check("a shebang wins over a guess", runner.chooseInterpreter("auto", "#!/usr/bin/env python3\nprint('hi')\n") === "python3");
  check("what the user asked for wins over both", runner.chooseInterpreter("node", "print('hi')\n") === "node");
  check("a shell is never one of the choices", !("bash" in runner.SCRIPT_INTERPRETERS) && !("sh" in runner.SCRIPT_INTERPRETERS) && !("zsh" in runner.SCRIPT_INTERPRETERS));
  let refused = null;
  try {
    runner.chooseInterpreter("bash", "echo hi");
  } catch (error) {
    refused = error;
  }
  check("asking for a shell is refused", refused !== null && /cannot run a script here/.test(refused.message), String(refused?.message).slice(0, 70));

  const { port, child } = await startServer();
  try {
    const granted = await post("/api/work/folder/restore", { projectId, roots: [sandbox] });
    const grantId = granted.data?.grants?.[sandbox];
    if (!grantId) throw new Error(`The folder could not be granted: ${JSON.stringify(granted.data)}`);

    const base = { projectId, root: sandbox, grantId };
    const script = (code, extra = {}) => post("/api/work/script/run", { ...base, code, ...extra });

    section("2. It asks before anything happens");
    const code = "const fs = require('fs');\nfs.writeFileSync('made-by-a-pasted-script.txt', 'x');\nconsole.log('done');\n";
    const asked = await script(code);
    check("it refuses until it is allowed", asked.status === 403 && asked.data?.requiresApproval === true, `${asked.status} ${String(asked.data?.error).slice(0, 70)}`);
    check("the refusal names the interpreter", asked.data?.preview?.interpreter === "node", String(asked.data?.preview?.interpreter));
    check("the refusal says where it would run", asked.data?.preview?.cwd === sandbox, String(asked.data?.preview?.cwd));
    check("the refusal warns what running it means", /your access/i.test(String(asked.data?.preview?.note)), String(asked.data?.preview?.note).slice(0, 70));
    check("the user is shown the first lines of their own code", /made-by-a-pasted-script/.test(String(asked.data?.preview?.script)));
    check("nothing was written while it waited", !fs.existsSync(path.join(sandbox, "made-by-a-pasted-script.txt")));
    check("not even the script file was created yet", !fs.existsSync(path.join(sandbox, runner.SCRIPT_FOLDER)));

    section("3. Once allowed, it really runs");
    const allowed = await script(code, { approvalGranted: true });
    check("the script is accepted", allowed.status === 200, `${allowed.status} ${String(allowed.data?.error).slice(0, 70)}`);
    check("its output comes back", /done/.test(String(allowed.data?.result?.output)), String(allowed.data?.result?.output).slice(0, 60));
    check("it ran in the granted folder", allowed.data?.result?.cwd === sandbox, String(allowed.data?.result?.cwd));
    check("the file it wrote is there", fs.existsSync(path.join(sandbox, "made-by-a-pasted-script.txt")));

    section("4. No trace is left behind");
    check("the script file is gone", !fs.existsSync(path.join(sandbox, runner.SCRIPT_FOLDER)));
    const leftovers = fs.readdirSync(sandbox).filter((entry) => entry.startsWith("luke-"));
    check("nothing else was added to the project", leftovers.length === 0, leftovers.join(", "));

    section("5. The file stays inside the granted folder, and is the only argument");
    const where = await script("console.log(process.argv[1]);\nconsole.log(process.argv.length);\nconsole.log(process.cwd());\n", { approvalGranted: true });
    const lines = String(where.data?.result?.output || "").trim().split(/\r?\n/);
    // The file is deleted after the run, so its printed path is the evidence.
    check("the script file was written inside the folder",
      Boolean(lines[0]) && path.resolve(lines[0]).startsWith(sandbox + path.sep) && /\.luke-run/.test(lines[0]),
      String(lines[0]));
    check("the interpreter was given one argument: the file", lines[1] === "2", String(lines[1]));
    check("the working directory is the granted folder", lines[2] === sandbox, String(lines[2]));

    section("6. No shell, whatever the script contains");
    const hostiles = await script(
      "console.log('start');\n// ; rm -rf /\nconst x = `$(whoami)`;\nconsole.log('end', x);\n",
      { approvalGranted: true },
    );
    check("shell syntax in a script is just text", /start[\s\S]*end/.test(String(hostiles.data?.result?.output)), String(hostiles.data?.result?.output).slice(0, 80));
    check("nothing outside the folder was touched", fs.readdirSync(neighbour).length === 0);

    section("7. Approval is per script, never remembered");
    const second = await script("console.log('again');\n");
    check("the next script asks again", second.status === 403 && second.data?.requiresApproval === true, `${second.status}`);

    section("8. Python, and a script that fails");
    const python = await script("import sys\nprint('python ran', sys.version_info[0])\n", { approvalGranted: true });
    check("a Python script is run by python3", python.data?.result?.interpreter === "python3", String(python.data?.result?.interpreter));
    check("its output comes back", /python ran/.test(String(python.data?.result?.output)), String(python.data?.result?.output).slice(0, 60));
    const failing = await script("process.exit(3);\n", { approvalGranted: true });
    check("a failing script reports its exit code", failing.data?.result?.exitCode === 3, JSON.stringify(failing.data?.result?.exitCode));
    const empty = await script("   \n\n", { approvalGranted: true });
    check("an empty script is refused, not run", empty.status === 400, `${empty.status}`);

    section("8b. Notes are not a failed script, they are not a script");
    for (const [label, block] of [
      ["a heading above a tool call", "# Update tasks\n{\"tool\":\"update_tasks\",\"tasks\":[]}"],
      ["a task list", "- [ ] read the file\n- [ ] run the tests"],
      ["a tool call on its own", "{\"tool\":\"repo_map\"}"],
      ["a plan in prose", "First we move the parser, then we run the tests."],
    ]) {
      const response = await script(block, { approvalGranted: true });
      check(label, response.status === 400, `${response.status} ${String(response.data?.error).slice(0, 60)}`);
      check(`${label}: it says there is no program`, /no program|notes/i.test(String(response.data?.error)), String(response.data?.error).slice(0, 80));
    }
    check("no script file was left by any of them", !fs.existsSync(path.join(sandbox, runner.SCRIPT_FOLDER)));

    section("9. A folder that was not granted cannot run one");
    const stranger = await post("/api/work/script/run", { projectId, root: neighbour, grantId, code: "console.log(1)", approvalGranted: true });
    check("it is refused", stranger.status !== 200, `${stranger.status} ${String(stranger.data?.error).slice(0, 60)}`);
    check("nothing ran in it", fs.readdirSync(neighbour).length === 0);
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(neighbour, { recursive: true, force: true });
  }

  section("10. The terminal offers it instead of lecturing");
  const dock = fs.readFileSync(dockFile, "utf8");
  check("a multi-line paste is recognised as a script", /command\.includes\("\\n"\)/.test(dock));
  check("it is offered, not refused", /setPendingScript\(\{ code: command, interpreter: "auto" \}\);/.test(dock));
  check("the old lecture is gone", !/SCRIPT_NOT_A_COMMAND/.test(dock));
  check("running it needs the user's say-so", /role="alertdialog" aria-label="Run this script"/.test(dock));
  check("they are told it runs with their access", /A script runs with your access/.test(dock));
  check("they can choose the interpreter", /SCRIPT_INTERPRETERS\.map/.test(dock) && /<option value="auto">auto<\/option>/.test(dock));
  check("cancelling runs nothing", /Cancelled — the script was not run\./.test(dock));
  check("a block of code from the answer is offered the same way",
    /if \(lines\.length > 1 \|\| raw\.includes\("\\n"\)\) \{[\s\S]*?setPendingScript\(\{ code: raw, interpreter: "auto" \}\);/.test(dock));
  check("a block that is one command per line still runs line by line",
    /lines\.every\(\(line\) => looksLikeCommand\(line\)\)/.test(dock));
  check("code that belongs in the project is pointed at Work Chat", /Work Chat to write the file/.test(dock));

  section("11. A block is read before it is run");
  const lib = await import(`file://${path.join(root, "app", "frontend", "src", "lib", "work-tool-call.mjs")}`);
  check("a JavaScript program is code", lib.looksLikeCode("const x = 1;\nconsole.log(x);") === true);
  check("a Python program is code", lib.looksLikeCode("def main():\n    print('hi')") === true);
  check("a heading above a tool call is not", lib.looksLikeCode("# Update tasks\n{\"tool\":\"update_tasks\"}") === false);
  check("a task list is not", lib.looksLikeCode("- [ ] one\n- [ ] two") === false);
  check("a tool call on its own is not", lib.looksLikeCode('{"tool":"repo_map"}') === false);
  check("prose is not", lib.looksLikeCode("First we move the parser, then we test.") === false);
  check("comments alone are not", lib.looksLikeCode("# just a note") === false);
  check("a tool call is folded back onto one line and left for the user",
    /const call = parseToolCall\(raw\) \|\| parseToolCall\(lines\.join\("\\n"\)\);[\s\S]*?setCommandText\(JSON\.stringify\(call\.args\)\);/.test(dock));
  check("notes are named rather than run", /if \(!looksLikeCode\(raw\)\) \{[\s\S]*?NOT_A_PROGRAM/.test(dock));
  check("and the same judgement is made for a pasted block", /if \(!looksLikeCode\(command\)\) \{[\s\S]*?explainNotAProgram\(command\)/.test(dock));
  check("the message is one line, because it prints in a terminal", lib.NOT_A_PROGRAM.split("\n").length === 1, String(lib.NOT_A_PROGRAM.split("\n").length));
  check("and the refusal quotes the block, so the user can see which one", /move the parser/.test(lib.explainNotAProgram("First we move the parser\nThen we test it")), lib.explainNotAProgram("First we move the parser\nThen we test it"));
  check("it quotes at most two lines", lib.explainNotAProgram("one\ntwo\nthree").split("\n").length === 3, lib.explainNotAProgram("one\ntwo\nthree"));
  check("an empty block gets the plain message", lib.explainNotAProgram("   ") === lib.NOT_A_PROGRAM);
  check("a bullet with no space after the mark is a step",
    lib.planTasksFromMarkdown("-Move the parser").length === 1);
  check("a bullet drawn with a dot is a step",
    lib.planTasksFromMarkdown("• Move the parser").length === 1);
  check("an indented step is a step",
    lib.planTasksFromMarkdown("   - [ ] Move the parser").length === 1);

  section("12. A plan written as markdown has somewhere to go");
  const plan = lib.planTasksFromMarkdown("# Update tasks\n- [ ] move the parser\n- [x] read the file\n- [-] run the tests");
  check("the heading is not a step", plan.length === 3, JSON.stringify(plan));
  check("an open box is a todo", plan[0]?.status === "todo" && plan[0]?.text === "move the parser", JSON.stringify(plan[0]));
  check("a ticked box is done", plan[1]?.status === "done", JSON.stringify(plan[1]));
  check("a dash is in progress", plan[2]?.status === "doing", JSON.stringify(plan[2]));
  check("plain bullets are steps too",
    lib.planTasksFromMarkdown("- first\n- second").length === 2);
  check("a numbered list is a plan",
    lib.planTasksFromMarkdown("1. read\n2. run").length === 2);
  check("prose is still not a plan", lib.planTasksFromMarkdown("First we move it, then we test.").length === 0);
  check("the plan is capped at the 24 steps the agent works to",
    lib.planTasksFromMarkdown(Array.from({ length: 40 }, (_, index) => `- step ${index}`).join("\n")).length === 24);
  check("the terminal offers the plan instead of refusing it", /setPendingPlan\(\{ tasks \}\);/.test(dock));
  check("and says nothing was run", /NOT_A_PROGRAM\} It reads like a plan/.test(dock));
  check("accepting it replaces the plan", /onClick=\{acceptPlan\}.*Set as my plan/.test(dock) || /Set as my plan/.test(dock));
  check("dismissing keeps the plan as it was", /Kept the plan as it was\./.test(dock));
  check("without a plan in the block, the refusal stands",
    /if \(!offerPlan\(raw\)\) setOutput/.test(dock) && /if \(!offerPlan\(command\)\) setOutput/.test(dock));
  check("each path quotes the block it was given",
    /explainNotAProgram\(raw\)/.test(dock) && /explainNotAProgram\(command\)/.test(dock));

  section("13. An action list is neither a command nor a program");
  const actions = `luke-actions

{"actions":[

    {"tool":"repo_map"},

    {"tool":"read_file","path":"app/config/update.json"},

    {"tool":"read_file","path":"app/version.json"}

]}
<arena-system-message>
The previous assistant response was stopped by the user before it completed.
</arena-system-message>
# No test, lint, or build command detected in this project.`;

  const parsed = lib.parseActionBlock(actions);
  check("the block is recognised despite the noise around it", Boolean(parsed), JSON.stringify(parsed));
  check("all three actions are read", parsed?.actions?.length === 3, JSON.stringify(parsed?.actions?.map((entry) => entry.tool)));
  check("the tools are named", JSON.stringify(parsed?.actions?.map((entry) => entry.tool)) === JSON.stringify(["repo_map", "read_file", "read_file"]));
  check("the injected harness message is dropped", !/arena-system-message/.test(lib.stripHarnessNoise(actions)));
  check("what follows it is kept", /No test, lint, or build command/.test(lib.stripHarnessNoise(actions)));
  check("a bare array of actions is read too", lib.parseActionBlock('[{"tool":"repo_map"}]')?.actions?.length === 1);
  check("a block with no tool in it is not an action list", lib.parseActionBlock('{"files":["a.js"]}') === null);
  check("plain prose is still not an action list", lib.parseActionBlock("move the parser, then test") === null);
  check("the message names the tools and the count",
    /3 actions \(repo_map, read_file\)/.test(lib.actionBlockMessage(parsed)), lib.actionBlockMessage(parsed));
  check("and says the terminal cannot run it", /Terminal cannot run it/.test(lib.actionBlockMessage(parsed)));
  check("and where it does belong", /Work runs those itself/.test(lib.actionBlockMessage(parsed)));
  check("the terminal checks for one before deciding it is code",
    /const actionBlock = parseActionBlock\(raw\);/.test(dock) && /const actionBlock = parseActionBlock\(command\);/.test(dock));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  async function post(url, body) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
