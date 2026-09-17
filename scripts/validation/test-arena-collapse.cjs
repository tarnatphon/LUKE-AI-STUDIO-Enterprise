"use strict";

/**
 * The Arena gets out of the way when it is not being used.
 *
 * The panel lives between the conversation and the composer and grows with
 * every model it runs, so it pushes the chat around exactly when the user is
 * trying to read it. It can be folded down to its heading — and the choice is
 * remembered, because folding the same panel again on every launch is its own
 * annoyance.
 *
 * Collapsed has to stay useful: the enable switch stays reachable, and a round
 * already running still says so in one line, so folding the panel never hides
 * work in progress.
 *
 * Run: node scripts/validation/test-arena-collapse.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const panelFile = path.join(root, "app", "frontend", "src", "components", "ModelArenaPanel.jsx");
const sheetFile = path.join(root, "app", "frontend", "src", "components", "TextChat.css");

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

const panel = fs.readFileSync(panelFile, "utf8");
const sheet = fs.readFileSync(sheetFile, "utf8");

section("1. The panel folds away");
check("there is a collapse button in the heading", /className="chat-arena-collapse"/.test(panel));
check("it is announced as a disclosure", /aria-expanded=\{!collapsed\}/.test(panel));
check("its label changes with the state", /\{collapsed \? "ขยาย" : "ย่อ"\}/.test(panel));
check("its icon changes with the state", /\{collapsed \? <ChevronUp size=\{15\} \/> : <ChevronDown size=\{15\} \/>\}/.test(panel));
check("it says what it does", /title=\{collapsed \? "ขยายหน้าต่าง Arena" : "ย่อหน้าต่าง Arena ให้เหลือแค่แถวหัวข้อ"\}/.test(panel));
check("the body is hidden when it is folded", /\{enabled && !collapsed && \(/.test(panel));
check("the state starts from what the user chose last time",
  /useState\(\(\) => \{[\s\S]*?localStorage\.getItem\(COLLAPSED_KEY\) === "1"/.test(panel));

section("2. The choice is remembered, and failing to is not fatal");
check("folding is written down", /localStorage\.setItem\(COLLAPSED_KEY, value \? "1" : "0"\)/.test(panel));
check("the key is named once, in one place", /const COLLAPSED_KEY = "luke_arena_collapsed";/.test(panel));
check("a browser that refuses storage still lets the panel fold",
  (panel.match(/\} catch \{/g) || []).length >= 2, String((panel.match(/\} catch \{/g) || []).length));

section("3. Folded still tells you what is happening");
check("the enable switch stays reachable while folded",
  panel.indexOf('className="chat-arena-toggle"') < panel.indexOf('className="chat-arena-collapse"'));
check("a running round is reported on the heading",
  /กำลังเปรียบเทียบ · \$\{answered\}\/\$\{entered \|\| selectedIds\.length\}/.test(panel));
check("finished answers are reported too", /roundDone \|\| answered > 0\s*\n\s*\? "มีคำตอบแล้ว"/.test(panel));
check("the note is only shown while folded", /\{collapsed && collapsedNote && \(/.test(panel));

section("4. It looks like the rest of the app");
check("the button is styled in the panel's own stylesheet", /\.chat-arena-collapse \{/.test(sheet));
check("it uses the app's own tokens, not new colours",
  /color: var\(--md-sys-color-on-surface-variant\)/.test(sheet) && /border: 1px solid var\(--border-color\)/.test(sheet));
check("the stylesheet travels with the chat workspace, not the first paint",
  /chat-arena/.test(sheet) && fs.existsSync(sheetFile));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
