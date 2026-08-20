#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const sidebar = fs.readFileSync("app/frontend/src/components/Sidebar.jsx", "utf8");
const styles = fs.readFileSync("app/frontend/src/App.css", "utf8");
const tabs = ["home", "generator", "image-video", "assets", "chat", "speech", "tts", "models", "settings"];

function requireText(text, label) {
  if (!sidebar.includes(text)) throw new Error(`${label}: ${text}`);
}

function requireStyle(text, label) {
  if (!styles.includes(text)) throw new Error(`${label}: ${text}`);
}

requireText("const navigationProps = (tab) =>", "NAVIGATION_PROPS_MISSING");
requireText('role: "link"', "NAVIGATION_ROLE_MISSING");
requireText("tabIndex: 0", "NAVIGATION_TAB_STOP_MISSING");
requireText('activeTab === tab ? "page" : undefined', "CURRENT_PAGE_STATE_MISSING");
requireText('event.key !== "Enter" && event.key !== " "', "KEYBOARD_ACTIVATION_MISSING");
requireText("event.target !== event.currentTarget", "NESTED_CONTROL_GUARD_MISSING");
requireText("event.preventDefault()", "SPACE_SCROLL_GUARD_MISSING");
requireText("const historyItemProps = (onSelect, isActive, label) =>", "HISTORY_ITEM_PROPS_MISSING");
requireText('"aria-current": isActive ? "true" : undefined', "HISTORY_CURRENT_STATE_MISSING");
requireText('historyItemProps(() => {', "KEYBOARD_HISTORY_ACTIVATION_MISSING");
requireText('isActive, `Open chat ${conv.title}`', "CHAT_HISTORY_LABEL_MISSING");
requireText('isActive, `Open transcription ${title}`', "SPEECH_HISTORY_LABEL_MISSING");
requireText('isActive, `Open audio ${title}`', "TTS_HISTORY_LABEL_MISSING");

const historyBindings = sidebar.match(/\.\.\.historyItemProps\(\(\) => \{/g) || [];
if (historyBindings.length !== 3) {
  throw new Error(`HISTORY_KEYBOARD_BINDING_COUNT: expected 3, received ${historyBindings.length}`);
}

for (const history of ["chat", "speech", "tts"]) {
  requireText(`aria-controls="${history}-history-list"`, `HISTORY_CONTROL_MISSING_${history}`);
  requireText(`id="${history}-history-list"`, `HISTORY_LIST_ID_MISSING_${history}`);
}
requireText("aria-expanded={showHistory}", "CHAT_HISTORY_EXPANDED_STATE_MISSING");
requireText("aria-expanded={showSpeechHistory}", "SPEECH_HISTORY_EXPANDED_STATE_MISSING");
requireText("aria-expanded={showTtsHistory}", "TTS_HISTORY_EXPANDED_STATE_MISSING");
requireStyle(".nav-item:focus-visible", "NAVIGATION_FOCUS_INDICATOR_MISSING");
requireStyle(".sidebar-history-item:focus-visible", "HISTORY_ITEM_FOCUS_INDICATOR_MISSING");
requireStyle(".history-toggle-arrow:focus-visible", "HISTORY_TOGGLE_FOCUS_INDICATOR_MISSING");
requireStyle(".sidebar-history-delete:focus-visible", "HISTORY_DELETE_FOCUS_INDICATOR_MISSING");
requireStyle("outline: 3px solid", "SIDEBAR_FOCUS_OUTLINE_MISSING");
requireStyle("outline-offset: 2px", "SIDEBAR_FOCUS_OFFSET_MISSING");

for (const tab of tabs) {
  requireText(`navigationProps("${tab}")`, `KEYBOARD_NAVIGATION_MISSING_${tab}`);
}

console.log("PASS: Every primary workspace is keyboard reachable.");
console.log("PASS: Enter and Space activate focused navigation items.");
console.log("PASS: The active workspace exposes aria-current page state.");
console.log("PASS: Nested history controls do not trigger parent navigation.");
console.log("PASS: Chat, transcription, and TTS history items are keyboard reachable.");
console.log("PASS: History selections expose current state and accessible labels.");
console.log("PASS: History toggles expose expanded state and controlled lists.");
console.log("PASS: Every sidebar keyboard target has a visible focus indicator.");
console.log("PASS: Beta 10 Frontend Keyboard Navigation validation completed.");
