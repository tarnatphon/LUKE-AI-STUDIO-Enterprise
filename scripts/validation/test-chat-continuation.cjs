"use strict";

/**
 * An answer that stops halfway is not finished work.
 *
 * Local models hit the response-token cap in the middle of a file more often
 * than a hosted one does, and the app used to hand the answer back with a note
 * telling the user to type "continue" — the same habit Work was just told to
 * give up. Now the model is simply asked to carry on, with its own words so
 * far as the prefill, so nothing it already wrote is written twice.
 *
 * The loop has to be bounded and it has to be honest: a model stuck repeating
 * itself must not be able to run away with the machine, an abort has to stop
 * it at once, a continuation that errors must not lose the answer already on
 * screen, and the token count the user sees has to cover the whole answer
 * rather than its first leg.
 *
 * Run: node scripts/validation/test-chat-continuation.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const chatFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");
const chat = fs.readFileSync(chatFile, "utf8");

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

section("1. A cut-off answer carries on by itself");
check("the continuation loop exists", /while \(finalFinishReason === "length"/.test(chat));
check("it only continues an answer that was cut off, not one that finished",
  /finalFinishReason === "length" && continuations < MAX_AUTO_CONTINUES && !controller\.signal\.aborted/.test(chat));
check("the limit is named rather than buried", /const MAX_AUTO_CONTINUES = (\d+);/.test(chat));
const limit = Number((chat.match(/const MAX_AUTO_CONTINUES = (\d+);/) || [])[1]);
check("the limit is small enough that a stuck model cannot run away", limit >= 1 && limit <= 3, String(limit));
check("an aborted generation stops at once", /!controller\.signal\.aborted/.test(chat) && /if \(controller\.signal\.aborted\) break;/.test(chat));

section("2. It carries on from the words already written");
check("the model is given its own answer as a prefill",
  /\[\.\.\.requestMessages, \{ role: "assistant", content: prefix \}\]/.test(chat));
check("the screen shows the whole answer, not just the new leg",
  /\(text\) => handleStreamToken\(prefix \+ String\(text \|\| ""\)\)/.test(chat));
check("a backend that echoes the prefix is not doubled",
  /answerText = extra\.startsWith\(prefix\) \? extra : prefix \+ extra;/.test(chat));

section("3. It fails safely");
check("a continuation that errors does not throw the answer away",
  /\} catch \(continuationError\) \{/.test(chat) && /Losing the answer so far would be worse than stopping here\./.test(chat));
check("an error ends the loop instead of retrying", /finalFinishReason = null;\s*\n\s*break;/.test(chat));
check("the count the user sees covers every leg",
  /const exactTokens = continuations > 0\s*\n\s*\? streamedTokens/.test(chat));
check("the stats say the answer was carried on", /finishReason: finalFinishReason,\s*\n\s*truncated: finalFinishReason === "length",\s*\n\s*continuations,/.test(chat));

section("4. The user can still ask for more, with one click");
check("the old instruction to type it by hand is gone", !/Ask \\"continue\\"/.test(chat));
check("a truncated answer offers a Continue button", /chat-generation-continue/.test(chat) && />\s*\n?\s*Continue/.test(chat));
check("the button carries on from where the answer stopped", /onClick=\{\(\) => continueFrom\(index\)\}/.test(chat));
check("the button is disabled while something is already running", /disabled=\{isBusy \|\| Boolean\(loadingModel\)\}/.test(chat));
check("it knows how many times the answer was carried on", /The answer was carried on \$\{message\.generationStats\.continuations/.test(chat));
check("the click builds its request from the tail of the answer",
  /String\(messages\[messageIndex\]\?\.content \|\| ""\)\.slice\(-240\)/.test(chat));
check("it asks for the answer to be picked up mid-flow, not repeated",
  /Do not repeat anything you already wrote, and do not start again/.test(chat));

section("5. Order matters, and is easy to break in a refactor");
// continueFrom calls sendMessage, so it has to be declared after it: a const
// read before it is initialised throws on every render, not just on the click.
const sendAt = chat.indexOf("const sendMessage = async (");
const continueAt = chat.indexOf("const continueFrom = useCallback");
check("continueFrom is declared after the sendMessage it calls",
  sendAt > 0 && continueAt > sendAt, `send ${sendAt}, continue ${continueAt}`);
check("its dependencies are the ones it uses", /\}, \[messages, sendMessage\]\);/.test(chat));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
