"use strict";

/**
 * How Work is supposed to behave in a conversation.
 *
 * Two complaints came from using it, and both are about the interface rather
 * than the tools: it asked too much, and it blurred explanation together with
 * the commands that go in the Terminal. A coding agent that stops to ask
 * whether it may continue is not helping, and a wall of prose with the command
 * buried in it is not an answer — you cannot copy it, and you cannot run it.
 *
 * So Work is instructed to assume the sensible default and carry on, to ask
 * only when it is genuinely blocked, and to answer in two kinds of block:
 * `text` for explanation and `code` for what the Terminal should run. The
 * renderer honours that: a text block reads as prose, and only a runnable
 * block is offered to the Terminal.
 *
 * Approval is part of asking less: one question covers a batch of edits,
 * instead of one confirmation per file.
 *
 * These are instructions and rendering rules, so the suite reads the source —
 * the point is that they cannot quietly disappear.
 *
 * Run: node scripts/validation/test-work-conversation-contract.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const chatFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");

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

async function main() {
const chat = fs.readFileSync(chatFile, "utf8");
const instruction = chat.slice(chat.indexOf("const workInstruction"), chat.indexOf("const approvalInstruction"));

section("1. Work asks only when it is genuinely blocked");
check("it is told to assume the sensible default and carry on", /How much to ask: almost never/.test(instruction));
check("ordinary work is named as not needing permission", /Ordinary project work does not need permission/.test(instruction));
check("the reasons to ask are named and narrow",
  /only when you are truly blocked/.test(instruction) && /secret or credential only the user has/.test(instruction));
check("even then it asks one question with options", /ask ONE question, offer concrete options/.test(instruction));
check("it is told not to pause between steps", /Work in long stretches/.test(instruction) && /Do not pause between steps/.test(instruction));
check("completing work is still preferred over asking about it", /edit every file that needs editing, run the check, fix what it reports/.test(instruction));

section("2. Explanation and commands are kept apart");
check("the two block types are defined", /```text/.test(instruction) && /```code/.test(instruction));
check("text holds explanation, summary and questions", /every explanation, summary, question and next step/.test(instruction));
check("no commands may hide in a text block", /No commands in here/.test(instruction));
check("code holds only what the Terminal should run", /only what the user should run in the Terminal/.test(instruction));
check("a code block stays free of prose", /no prose, no bullet numbers, no commentary inside the block/.test(instruction));
check("code meant for a file is written by the tools, not handed over", /use apply_patch or create_file instead of handing the user a block/.test(instruction));

section("3. The renderer keeps its side of the contract");
check("a text fence is unfenced so it reads as prose", /\.replace\(\/```text\\n\(\[\\s\\S\]\*\?\)```\/g, "\$1"\)/.test(chat));
check("only runnable blocks are offered to the Terminal",
  /const runnable = workMode && Boolean\(onSendToTerminal\) && !\["json", "diff", "markdown", "md", "text", ""\]/.test(chat));
check("a code block is labelled as something to run", /lang === "code" \? "Run in Terminal"/.test(chat));
check("the Terminal button still goes to the same dock", /onSendToTerminal\(code\.trim\(\)\)/.test(chat));

section("4. One question covers a batch of edits");
check("what needs approval is decided once, by a named helper", /const approvalKindFor = \(tool\) =>/.test(chat));
check("file changes and project checks are the only things asked about",
  /\["write_file", "apply_patch", "create_file"\]\.includes\(tool\)/.test(chat) && /tool === "run_check"/.test(chat));
check("the question is asked once, before the actions run", /const mustAskFirst = approvalMode === "ask"/.test(chat));
check("a batch is listed rather than asked one at a time", /Allow Work Chat to do \$\{summary\.length\} things/.test(chat));
check("a single action still reads as a single question", /Allow Work Chat to \$\{summary\[0\]\}\?/.test(chat));
check("declining skips the edits instead of stopping the run", /denied\.has\(index\)/.test(chat) && /User denied this action/.test(chat));
check("no per-action confirmation is left behind", !/if \(mustAsk && \(changesFiles \|\| runsCommand\)\)/.test(chat));

section("5. The split also happens in code, when the model forgets");
const blocksFile = path.join(root, "app", "frontend", "src", "lib", "work-answer-blocks.mjs");
const { splitAnswerBlocks, looksLikeCommand, expandJsonAnswer } = await import(`file://${blocksFile}`);

check("a bare command is recognised", looksLikeCommand("npm install"), String(looksLikeCommand("npm install")));
check("a shell prompt is stripped, not mistaken for part of it", looksLikeCommand("$ npm install"));
check("a sentence about a command is not a command", !looksLikeCommand("Run npm install to fetch the packages."));
check("prose that starts with a capital is left alone", !looksLikeCommand("Make sure the build passes."));
check("an over-long line is left alone", !looksLikeCommand(`node ${"x".repeat(200)}`));

const mixed = [
  "I added the missing import and fixed the test.",
  "",
  "npm install",
  "npm run build",
  "",
  "If the build passes, commit with the GitHub tab.",
].join("\n");
const split = splitAnswerBlocks(mixed);
check("the answer comes apart into text and code", split.length === 3, JSON.stringify(split.map((b) => b.type)));
check("the explanation stays text", split[0].type === "text" && /missing import/.test(split[0].content), JSON.stringify(split[0]));
check("consecutive commands become one runnable block",
  split[1].type === "code" && split[1].content === "npm install\nnpm run build", JSON.stringify(split[1]));
check("the sentence after them stays text", split[2].type === "text" && /GitHub tab/.test(split[2].content), JSON.stringify(split[2]));
check("nothing is lost in the split", split.map((b) => b.content).join("\n").includes("npm run build"));
check("a plain answer with no commands stays one block of prose",
  splitAnswerBlocks("Everything already passes.\nNothing to change.").every((b) => b.type === "text"));
section("6. A model that answers in JSON is understood the same way");
const jsonAnswer = [
  "```json",
  '{"blocks":[{"type":"text","text":"I added the missing import."},{"type":"code","code":"npm install"}]}',
  "```",
].join("\n");
const expanded = expandJsonAnswer(jsonAnswer);
check("the JSON block becomes the same two blocks", /```text\nI added the missing import\.\n```/.test(expanded) && /```code\nnpm install\n```/.test(expanded), expanded);
check("an unknown block type is read as prose, not as a command",
  /```text/.test(expandJsonAnswer('```json\n{"blocks":[{"type":"note","text":"heads up"}]}\n```')));
check("a broken JSON block is left alone for the reader",
  expandJsonAnswer("```json\n{not json at all}\n```") === "```json\n{not json at all}\n```");
check("an answer with no JSON is untouched", expandJsonAnswer("plain words\n") === "plain words\n");
check("the renderer expands JSON before it decides anything else",
  /const fromJson = workMode \? expandJsonAnswer\(content\) : content;/.test(chat));

section("7. The model is told both forms are understood");
check("fences are still the first thing it is told", /How to answer — two kinds of fenced block/.test(instruction));
check("JSON is offered as an alternative, not a requirement", /```json/.test(instruction) && /both are understood/i.test(instruction));

check("the renderer imposes the split only when the model used no fences",
  /workMode && !fromJson\.includes\("```"\)/.test(chat) && /splitAnswerBlocks\(fromJson\)/.test(chat),
  "renderer hook");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
