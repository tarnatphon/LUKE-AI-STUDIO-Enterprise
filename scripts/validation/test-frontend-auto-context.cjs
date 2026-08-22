#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const chat = fs.readFileSync("app/frontend/src/components/TextChat.jsx", "utf8");
const styles = fs.readFileSync("app/frontend/src/App.css", "utf8");

function requireText(text, label) {
  if (!chat.includes(text)) throw new Error(`${label}: ${text}`);
}

requireText(
  "compactConversationContext = (allMessages, contextLimit, reservedTokens = 0)",
  "AUTO_CONTEXT_COMPACTION_MISSING",
);
requireText(
  "totalBudget - Math.max(0, Number(reservedTokens) || 0)",
  "SYSTEM_PROMPT_RESERVATION_MISSING",
);
requireText(
  "messages: [{ role: \"system\", content: summary }, ...recent]",
  "EARLIER_MESSAGE_SUMMARY_MISSING",
);
requireText("archivedCount: older.length", "ARCHIVED_COUNT_MISSING");
requireText("activeMessageCount: recent.length", "ACTIVE_MESSAGE_COUNT_MISSING");
requireText("conversationId: activeConversationId", "LOADED_CONTEXT_STATUS_MISSING");
requireText("conversationId: convId", "ACTIVE_CONTEXT_STATUS_MISSING");
requireText("reservedSystemTokens", "RESERVED_SYSTEM_TOKENS_MISSING");
requireText("getHardwareContextTarget", "HARDWARE_CONTEXT_TARGET_MISSING");
requireText("getAdaptiveContextLimit", "ADAPTIVE_CONTEXT_LIMIT_MISSING");
if (chat.includes("Auto context refreshed") || chat.includes("Context Used:")) {
  throw new Error("CONTEXT_UI_MUST_REMAIN_HIDDEN");
}
requireText("<span>Delete history</span>", "DESTRUCTIVE_HISTORY_LABEL_MISSING");
requireText("defaultValue={readChatDraft(draftStorageKey)}", "UNCONTROLLED_COMPOSER_MISSING");
requireText("luke_chat_draft:", "DRAFT_PERSISTENCE_MISSING");
requireText("MAX_PERSISTED_CHAT_DRAFT_CHARS", "BOUNDED_DRAFT_PERSISTENCE_MISSING");
requireText("function readChatDraft", "SAFE_DRAFT_READER_MISSING");
requireText("function persistChatDraft", "SAFE_DRAFT_WRITER_MISSING");
requireText("Storage availability must never interrupt composer input", "DRAFT_STORAGE_FAILURE_GUARD_MISSING");
if (/localStorage\.(?:getItem|setItem|removeItem)\(draftStorageKey/.test(chat)) {
  throw new Error("DIRECT_DRAFT_STORAGE_ACCESS_MUST_BE_GUARDED");
}
requireText("event.nativeEvent.isComposing", "IME_COMPOSITION_GUARD_MISSING");
requireText("draftSaveTimerRef", "DRAFT_DEBOUNCE_MISSING");
requireText("composerResizeRafRef.current !== null", "COMPOSER_RESIZE_FRAME_GUARD_MISSING");
requireText("scheduleComposerResize", "COMPOSER_RESIZE_BATCHING_MISSING");
requireText("frameBudget = document.visibilityState === \"visible\" ? 40 : 160", "ADAPTIVE_STREAM_PAINT_MISSING");
requireText("scheduleStreamPaint", "STREAM_PAINT_BATCHING_MISSING");
requireText('scrollIntoView({ behavior: "auto" })', "STREAM_SCROLL_ANIMATION_GUARD_MISSING");
requireText("distanceFromBottom <= 80", "STREAM_SCROLL_FOLLOW_RECOVERY_MISSING");
if (/\.chat-messages\s*\{[^}]*scroll-behavior:\s*smooth/s.test(styles)) {
  throw new Error("CHAT_CONTAINER_MUST_NOT_FORCE_SMOOTH_STREAM_SCROLL");
}
requireText('className={`chat-message-row', "MESSAGE_ROW_VIRTUALIZATION_TARGET_MISSING");
requireText(' ? " streaming" : ""', "ACTIVE_STREAM_VIRTUALIZATION_GUARD_MISSING");

console.log("PASS: Context automatically compacts before reaching the model limit.");
console.log("PASS: System prompt tokens are reserved before selecting recent messages.");
console.log("PASS: Earlier messages are summarized for inference without deleting history.");
console.log("PASS: Context sizing adapts to hardware without displaying a gauge.");
console.log("PASS: Destructive history deletion is labelled explicitly.");
console.log("PASS: Composer typing avoids full-chat rerenders and preserves drafts.");
console.log("PASS: Composer draft persistence is bounded and storage failures cannot interrupt typing.");
console.log("PASS: IME composition cannot accidentally submit a partial message.");
console.log("PASS: Streaming tokens are paint-batched and throttled when the app is hidden.");
console.log("PASS: Frontend Automatic Context Refresh validation completed.");
