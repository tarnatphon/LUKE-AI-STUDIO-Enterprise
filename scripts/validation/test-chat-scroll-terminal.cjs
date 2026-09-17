"use strict";

/**
 * Two ways the chat stops fighting the user.
 *
 * One: reading a long answer means scrolling up, and getting back down used to
 * mean a lot of wheeling. A button appears only while there is somewhere to go
 * and takes the message pane to the newest message — the pane, not the
 * document, because the LUKE workspace sits above it and must not move.
 *
 * Two: a ```code block the model wrote can be sent to the Terminal. It is one
 * command per line, so the block is split and the lines run one after another:
 * the first waits in the input for the user to press Run, and the rest follow
 * on their own when it finishes.
 *
 * The queue pauses while an approval is waiting. Without that, the next
 * command starts the instant the previous one stops, replacing the prompt the
 * user was asked about and quietly running what they never allowed.
 *
 * Run: node scripts/validation/test-chat-scroll-terminal.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const chatFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");
const dockFile = path.join(root, "app", "frontend", "src", "components", "WorkTerminalDock.jsx");
const sheetFile = path.join(root, "app", "frontend", "src", "components", "TextChat.css");
const helperFile = path.join(root, "app", "frontend", "src", "lib", "work-answer-blocks.mjs");

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

const chat = fs.readFileSync(chatFile, "utf8");
const dock = fs.readFileSync(dockFile, "utf8");
const sheet = fs.readFileSync(sheetFile, "utf8");

async function main() {
  const helper = await import(`file://${helperFile}`);

  section("1. A ```code block becomes Terminal commands");
  check("the block is split before it is sent", /const lines = terminalCommandLines\(code\);/.test(chat));
  check("the lines travel with the command", /detail: \{ command: String\(code \|\| ""\)\.trim\(\), lines \}/.test(chat));
  check("the window event still carries the raw text for anything listening", /luke:work-terminal-command/.test(chat));
  check("the splitter is exported from the shared helper", typeof helper.terminalCommandLines === "function");

  const lines = helper.terminalCommandLines("npm install\nnode app.js");
  check("one command per line", JSON.stringify(lines) === JSON.stringify(["npm install", "node app.js"]), JSON.stringify(lines));

  check("a $ prompt is not part of the command",
    JSON.stringify(helper.terminalCommandLines("$ npm install")) === JSON.stringify(["npm install"]));
  check("a > prompt is not part of the command",
    JSON.stringify(helper.terminalCommandLines("> npm test")) === JSON.stringify(["npm test"]));
  check("numbered steps are not part of the command",
    JSON.stringify(helper.terminalCommandLines("1. npm install\n2. node app.js")) === JSON.stringify(["npm install", "node app.js"]));
  check("bullet marks are not part of the command",
    JSON.stringify(helper.terminalCommandLines("- npm test")) === JSON.stringify(["npm test"]));
  check("backticks are not part of the command",
    JSON.stringify(helper.terminalCommandLines("`npm install`")) === JSON.stringify(["npm install"]));
  check("blank lines are dropped",
    JSON.stringify(helper.terminalCommandLines("npm install\n\n   \nnode app.js")) === JSON.stringify(["npm install", "node app.js"]));
  check("comments are dropped, they would print nothing",
    JSON.stringify(helper.terminalCommandLines("# install first\nnpm install")) === JSON.stringify(["npm install"]));
  check("an empty block yields nothing", helper.terminalCommandLines("").length === 0);
  check("a redirect survives the cleaning",
    JSON.stringify(helper.terminalCommandLines("node app.js > out.log 2>&1")) === JSON.stringify(["node app.js > out.log 2>&1"]));

  section("2. The Terminal takes the block, one press, then the rest");
  check("several commands do not all land in the input at once", /if \(lines\.length > 1 && lines\.every\(\(line\) => looksLikeCommand\(line\)\)\) \{/.test(dock));
  check("the first command waits in the input for the user", /setCommandText\(lines\[0\]\);/.test(dock));
  check("the rest are held back until it finishes", /setStaged\(lines\.slice\(1\)\);/.test(dock));
  check("a single command still just fills the input",
    /setStaged\(\[\]\);\s*\n\s*setPendingScript\(null\);\s*\n\s*setCommandText\(raw \|\| lines\[0\] \|\| ""\);/.test(dock));
  check("pressing Run queues the held-back lines too", /\[\.\.\.current, command, \.\.\.staged\]/.test(dock));
  check("the held batch is spent once it is queued", /setCommandQueue\(\(current\) => \[\.\.\.current, command, \.\.\.staged\]\.slice\(-50\)\);\s*\n\s*setStaged\(\[\]\);/.test(dock));
  check("clearing the terminal drops the batch as well", /if \(command === "clear"\) \{[\s\S]{0,160}setStaged\(\[\]\);/.test(dock));
  check("the user is told more will follow", /staged\.length > 0 && <div style=\{stagedStyle\}/.test(dock));
  check("and can drop them", /onClick=\{\(\) => setStaged\(\[\]\)\} title="Do not run the rest of the block"/.test(dock));

  section("3. The queue waits its turn");
  check("a command runs only when the terminal is idle", /if \(busy \|\| pendingApproval \|\| !root \|\| commandQueue\.length === 0\) return;/.test(dock));
  check("an approval that is waiting stops the queue", /busy \|\| pendingApproval \|\|/.test(dock));
  check("the queue effect watches the approval", /\}, \[busy, pendingApproval, commandQueue, executeCommand, runToolCall, root\]\);/.test(dock));

  section("4. Back down to the newest message");
  check("there is a jump button", /className="chat-jump-latest"/.test(chat));
  check("it sits outside the scrolling pane, so it cannot scroll away",
    chat.indexOf('className="chat-jump-latest"') > chat.indexOf('<div ref={bottomRef} />'));
  check("it is inside the wrapper that positions it",
    chat.indexOf('className="chat-scroll-area"') < chat.indexOf('className="chat-jump-latest"'));
  check("the wrapper is a positioning context", /\.chat-scroll-area \{[\s\S]*?position: relative;/.test(sheet));
  check("the button floats over the conversation", /\.chat-jump-latest \{[\s\S]*?position: absolute;/.test(sheet));
  check("and is centred, not hiding the text under it", /\.chat-jump-latest \{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/.test(sheet));
  check("it appears only while there is somewhere to go", /\{showJumpToLatest && \(/.test(chat));
  check("it scrolls the message pane, not the whole document",
    /container\.scrollTo\(\{ top: container\.scrollHeight, behavior: "smooth" \}\);/.test(chat));
  check("following the answer resumes after the jump", /followGenerationRef\.current = true;/.test(chat));
  check("it disappears once it is used", /setShowJumpToLatest\(false\);/.test(chat));

  section("5. Cheap while tokens are streaming");
  check("the scroll handler measures on every frame", /onScroll=\{\(event\) => \{[\s\S]*?distanceFromBottom = container\.scrollHeight - container\.scrollTop - container\.clientHeight;/.test(chat));
  check("but only touches state when the answer changes",
    /setShowJumpToLatest\(\(current\) => \(current === far \? current : far\)\);/.test(chat));
  check("following the answer is still decided while busy", /if \(isBusy\) followGenerationRef\.current = distanceFromBottom <= 80;/.test(chat));
  check("the threshold is a named distance, not a magic compare", /const far = distanceFromBottom > 220;/.test(chat));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
