"use strict";

/**
 * Two complaints, both about Work forgetting things the user cannot see.
 *
 * One: folder permission lives in the server's memory, so a restart takes it
 * away, and the app — remembering a grant that no longer exists — asks nothing
 * and does nothing until the user presses a button they have to remember. The
 * grant is now restored on its own, and the check asks the server rather than
 * trusting the app's memory.
 *
 * Two: {"tool":"repo_map"} is how the model asks about code. Pasted into the
 * Terminal it was refused as "not one of the programs Work can run" — true, and
 * useless, because the user is left holding an instruction with nowhere to put
 * it. The Terminal answers it now: tools that only read are run and printed,
 * and anything that writes is sent back to Work Chat, which asks first and
 * keeps a backup.
 *
 * Run: node scripts/validation/test-work-terminal-tools-grants.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const appFile = path.join(root, "app", "frontend", "src", "App.jsx");
const dockFile = path.join(root, "app", "frontend", "src", "components", "WorkTerminalDock.jsx");
const toolFile = path.join(root, "app", "frontend", "src", "lib", "work-tool-call.mjs");
const grantsFile = path.join(root, "app", "frontend", "src", "lib", "work-grants.mjs");

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

const app = fs.readFileSync(appFile, "utf8");
const dock = fs.readFileSync(dockFile, "utf8");
const grants = fs.readFileSync(grantsFile, "utf8");

async function main() {
  const tools = await import(`file://${toolFile}`);

  section("1. A tool call is understood, a command is not mistaken for one");
  check("a bare tool call is read", JSON.stringify(tools.parseToolCall('{"tool":"repo_map"}')) === JSON.stringify({ tool: "repo_map", args: { tool: "repo_map" } }));
  check("its arguments come along",
    JSON.stringify(tools.parseToolCall('{"tool":"search_code","pattern":"useState"}')?.args) === JSON.stringify({ tool: "search_code", pattern: "useState" }));
  check("a command is not a tool call", tools.parseToolCall("npm install") === null);
  check("a sentence is not a tool call", tools.parseToolCall("Run npm install first") === null);
  check("broken JSON is not a tool call", tools.parseToolCall('{"tool":"repo_map"') === null);
  check("JSON without a tool is not a tool call", tools.parseToolCall('{"files":3}') === null);
  check("a list is not a tool call", tools.parseToolCall('["repo_map"]') === null);

  section("2. Only tools that read are run from a typed prompt");
  const endpoints = tools.TERMINAL_TOOL_ENDPOINTS;
  check("the inspecting tools are runnable", ["repo_map", "read_outline", "find_symbol", "search_code", "read_file", "list_directory"].every((tool) => Boolean(endpoints[tool])));
  check("no tool that writes is in that list",
    tools.CHAT_ONLY_TOOLS.every((tool) => !endpoints[tool]),
    Object.keys(endpoints).join(", "));
  check("the tools that change files are named as chat-only",
    ["write_file", "apply_patch", "create_file"].every((tool) => tools.CHAT_ONLY_TOOLS.includes(tool)));
  check("a runnable tool is not refused", tools.toolRefusal("repo_map") === null);
  check("a writing tool is refused and told where it belongs", /does not run from the Terminal/.test(tools.toolRefusal("write_file")) && /Work chat/.test(tools.toolRefusal("write_file")));
  check("an unknown tool is told what does work here", /node, npm/.test(tools.toolRefusal("bogus")) && /repo_map/.test(tools.toolRefusal("bogus")));

  section("3. Each tool gets the body its endpoint expects");
  const base = { root: "/work", projectId: "p1", grantId: "g1" };
  check("repo_map asks for the whole map", tools.toolPayload("repo_map", {}, base).limit === 0);
  check("find_symbol carries the name", tools.toolPayload("find_symbol", { name: "useState" }, base).name === "useState");
  check("find_symbol accepts symbol as well", tools.toolPayload("find_symbol", { symbol: "useState" }, base).name === "useState");
  check("search_code carries the pattern", tools.toolPayload("search_code", { query: "useState" }, base).pattern === "useState");
  check("read_file carries the path", tools.toolPayload("read_file", { path: "src/app.js" }, base).path === "src/app.js");
  check("every payload stays inside the granted folder",
    ["repo_map", "find_symbol", "search_code", "read_file"].every((tool) => tools.toolPayload(tool, {}, base).root === "/work"));
  check("a tool never sends itself as an argument", Object.values(tools.toolPayload("repo_map", {}, base)).every((value) => value !== "repo_map"));

  section("4. Answers are printed, not dropped");
  check("a structured answer is printed whole", /"files"/.test(tools.summariseToolResult("repo_map", { result: { files: 3 } })));
  check("a plain answer is printed as it is", tools.summariseToolResult("repo_map", { result: "three files" }) === "three files");
  check("a long answer is trimmed, not lost", /trimmed/.test(tools.summariseToolResult("repo_map", { result: { blob: "x".repeat(9000) } })));
  check("an empty answer says so", /nothing came back/.test(tools.summariseToolResult("repo_map", null)));

  section("5. Folder permission restores itself");
  check("the check runs when Work is opened", /if \(assistantMode !== "work"\) return;\s*\n\s*void ensureProjectGrants\(\);/.test(app));
  check("it asks the server, not the app's memory", /fetch\("\/api\/work\/readiness"/.test(app));
  check("it acts on folders the server says it cannot reach",
    /const missing = \(data\?\.result\?\.folders \|\| \[\]\)\.filter\(\(folder\) => folder\.exists && !folder\.granted\);/.test(app));
  check("it does nothing when every folder is reachable", /if \(missing\.length === 0\) return;/.test(app));
  check("it comes back when the window does", /window\.addEventListener\("focus", recheck\);/.test(app));
  check("and when the tab is shown again", /document\.addEventListener\("visibilitychange", recheck\);/.test(app));
  check("both listeners are taken off again", /removeEventListener\("focus", recheck\);[\s\S]*?removeEventListener\("visibilitychange", recheck\);/.test(app));
  check("it only ever re-grants folders the project already names",
    /restoreProjectGrants\(project, \{ force: true \}\)/.test(app) && /allProjectFolders\(project\)/.test(grants));
  check("a folder that fails says so instead of pretending", /catch \{\s*\n\s*\/\/ A folder that cannot be granted/.test(app));

  section("6. A lapsed grant heals on its own");
  check("a permissions failure is recognised", /const lapsed = \/permission\|grant\|not granted\/i\.test\(message\);/.test(dock));
  check("the folder is granted again without asking the user", /const restored = await restoreGrants\(\);/.test(dock));
  check("the same command is run once more", /setCommandQueue\(\(current\) => \[command, \.\.\.current\]\);/.test(dock));
  check("it runs again at most once", /if \(lapsed && retriedRef\.current < 1\) \{\s*\n\s*retriedRef\.current \+= 1;/.test(dock));
  check("a successful run clears the retry count", /retriedRef\.current = 0;/.test(dock));
  check("a folder that cannot be granted is not retried forever",
    /if \(restored\.ok\) \{[\s\S]*?return;\s*\n\s*\}\s*\n\s*setNeedsGrant\(true\);/.test(dock));
  check("the user is told what happened", /Access had lapsed/.test(dock));

  section("7. The answer is visible");
  check("the output follows the answer", /if \(element && outputFollowsRef\.current\) element\.scrollTop = element\.scrollHeight;/.test(dock));
  check("but not while the user has scrolled up to read",
    /onScroll=\{\(event\) => \{ const element = event\.currentTarget; outputFollowsRef\.current = element\.scrollHeight - element\.scrollTop - element\.clientHeight <= 40; \}\}/.test(dock));
  check("the scroll effect watches the output", /\}, \[output\]\);/.test(dock));
  check("the terminal answers a tool call rather than running it as a command",
    /const call = parseToolCall\(nextCommand\);\s*\n\s*if \(call\) void runToolCall\(call\);\s*\n\s*else void executeCommand\(nextCommand\);/.test(dock));
  check("a tool call waits its turn in the queue like a command", /\}, \[busy, pendingApproval, commandQueue, executeCommand, runToolCall, root\]\);/.test(dock));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
