import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { ArrowDown, ArrowUp, Bot, Brain, Check, ChevronLeft, ChevronRight, Copy, Hand, LoaderCircle, PanelBottom, PanelRight, Pencil, RefreshCw, Search, Send, Settings2, ShieldAlert, ShieldCheck, Trash2, Square, History, Paperclip, X, ChevronDown, Globe2, Plus } from "lucide-react";
import WorkToolsPanel from "./WorkToolsPanel";
import WorkTerminalDock from "./WorkTerminalDock";
import ProjectMemoryPanel, { createWorkCheckpoint, getProjectMemory } from "./ProjectMemoryPanel";
import {
  getDownloadProgress,
  getSpeechStatus,
  getLlmStatus,
  listSpeechModels,
  listLlmModels,
  streamChatWithLlm,
  startLlm,
  startSpeech,
  stopLlm,
  transcribeSpeech,
} from "../services/api";

const processMessageContent = (rawText, apiReasoning = "", enableThinking = true) => {
  if (typeof rawText !== "string") {
    return { content: rawText, reasoning: apiReasoning || "" };
  }

  const cleanReasoningControlTags = (value) => String(value || "")
    .replace(/<\|channel\|>thought/g, "")
    .replace(/<\|channel\|>model/g, "")
    .replace(/<\|turn\|>model/g, "")
    .replace(/<\|im_start\|>model/g, "")
    .replace(/<\|think\|>|<\|thought\|>|<thinking>|<thought>/g, "")
    .replace(/<\|\/think\|>|<\|\/thought\|>|<\/thinking>|<\/thought>/g, "")
    .trim();

  const startTags = ["<|channel|>thought", "<|think|>", "<|thought|>", "<thinking>", "<thought>"];
  const endTags = ["<|channel|>model", "<|turn>model", "<|im_start|>model", "</thinking>", "</thought>", "<|/think|>", "<|/thought|>"];

  if (!enableThinking) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let startIdx = -1;
  let matchedStartTag = "";

  for (const tag of startTags) {
    const idx = rawText.indexOf(tag);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
      matchedStartTag = tag;
    }
  }

  if (startIdx === -1) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let endIdx = -1;
  for (const tag of endTags) {
    const idx = rawText.indexOf(tag, startIdx + matchedStartTag.length);
    if (idx !== -1 && (endIdx === -1 || idx < endIdx)) {
      endIdx = idx;
    }
  }

  if (endIdx === -1) {
    const rawReasoning = rawText.substring(startIdx + matchedStartTag.length);
    return { content: "", reasoning: cleanReasoningControlTags(rawReasoning) };
  }

  const rawReasoning = rawText.substring(startIdx + matchedStartTag.length, endIdx);
  const rawContent = rawText.substring(endIdx);

  return {
    content: cleanReasoningControlTags(rawContent),
    reasoning: cleanReasoningControlTags(rawReasoning)
  };
};

const MAX_WORK_AGENT_ROUNDS = 6;
const MAX_WORK_TOOL_RESULT_CHARS = 24000;
const MAX_ATTACHED_TEXT_CHARS = 2_000_000;
const MAX_ATTACHED_AUDIO_BYTES = 100 * 1024 * 1024;
const DOCUMENT_CHUNK_CHARS = 1400;
const DOCUMENT_CHUNK_OVERLAP = 250;
const MAX_DOCUMENT_CONTEXT_CHARS = 12000;

function tokenizeForRetrieval(value) {
  const words = String(value || "").toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const tokens = new Set(words);
  for (const word of words) {
    if (word.length >= 5) for (let index = 0; index <= word.length - 3; index += 1) tokens.add(word.slice(index, index + 3));
  }
  return [...tokens];
}

function selectRelevantDocumentChunks(attachments, query) {
  const queryTokens = tokenizeForRetrieval(query);
  const chunks = [];
  for (const attachment of attachments) {
    const content = String(attachment.content || "");
    let start = 0;
    let chunkIndex = 0;
    while (start < content.length) {
      let end = Math.min(content.length, start + DOCUMENT_CHUNK_CHARS);
      if (end < content.length) {
        const boundary = Math.max(content.lastIndexOf("\n", end), content.lastIndexOf(" ", end));
        if (boundary > start + DOCUMENT_CHUNK_CHARS / 2) end = boundary;
      }
      const text = content.slice(start, end).trim();
      if (text) {
        const haystack = new Set(tokenizeForRetrieval(`${attachment.name} ${text}`));
        const score = queryTokens.reduce((total, token) => total + (haystack.has(token) ? (token.length >= 5 ? 4 : 1) : 0), 0);
        chunks.push({ attachment, text, chunkIndex, score });
      }
      if (end >= content.length) break;
      start = Math.max(start + 1, end - DOCUMENT_CHUNK_OVERLAP);
      chunkIndex += 1;
    }
  }
  const ranked = chunks.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
  const selected = [];
  const selectedPerAttachment = new Map();
  let characters = 0;
  for (const chunk of ranked) {
    const attachmentCount = selectedPerAttachment.get(chunk.attachment.id) || 0;
    if (attachmentCount >= 3) continue;
    if (selected.length >= 8 || characters + chunk.text.length > MAX_DOCUMENT_CONTEXT_CHARS) continue;
    selected.push(chunk);
    selectedPerAttachment.set(chunk.attachment.id, attachmentCount + 1);
    characters += chunk.text.length;
  }
  return selected;
}

async function extractPdfText(file) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true });
  const pdf = await task.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(`[Page ${pageNumber}]\n${text.items.map((item) => item.str || "").join(" ")}`);
    }
  } finally {
    await pdf.destroy();
  }
  return pages.join("\n\n").trim();
}

async function extractWordText(file) {
  if (/\.docx$/i.test(file.name)) {
    const { default: mammoth } = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { content: String(result.value || "").trim(), legacy: false };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ascii = new TextDecoder("windows-1252").decode(bytes).match(/[\x20-\x7E\u00A0-\u024F]{4,}/g) || [];
  const utf16 = new TextDecoder("utf-16le").decode(bytes).match(/[\p{L}\p{N}\p{P}\p{Zs}]{4,}/gu) || [];
  const content = [...utf16, ...ascii]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join("\n")
    .trim();
  return { content, legacy: true };
}

async function extractPowerPointText(file) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/slide(\d+)/i)?.[1]) - Number(right.match(/slide(\d+)/i)?.[1]))
    .slice(0, 500);
  const output = [];
  let characters = 0;
  for (const [index, name] of slides.entries()) {
    const xml = await zip.file(name).async("string");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const text = [...document.getElementsByTagNameNS("*", "t")].map((node) => node.textContent?.trim()).filter(Boolean).join("\n");
    if (text) {
      const section = `[Slide ${index + 1}]\n${text}`;
      output.push(section);
      characters += section.length;
      if (characters >= MAX_ATTACHED_TEXT_CHARS) break;
    }
  }
  return output.join("\n\n").trim();
}

function encodeAudioBufferAsWav(audioBuffer) {
  const sampleRate = 16000;
  const sourceRate = audioBuffer.sampleRate;
  const sourceSamples = audioBuffer.length;
  const mono = new Float32Array(sourceSamples);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < sourceSamples; index += 1) mono[index] += data[index] / audioBuffer.numberOfChannels;
  }
  const samples = Math.max(1, Math.round(sourceSamples * sampleRate / sourceRate));
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const sourcePosition = sampleIndex * sourceRate / sampleRate;
    const left = Math.min(sourceSamples - 1, Math.floor(sourcePosition));
    const right = Math.min(sourceSamples - 1, left + 1);
    const mix = sourcePosition - left;
    const sample = Math.max(-1, Math.min(1, mono[left] + (mono[right] - mono[left]) * mix));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function parseWorkActions(content) {
  const actions = [];
  const pattern = /```luke-actions\s*([\s\S]*?)```/gi;
  let match;
  while ((match = pattern.exec(String(content || "")))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const batch = Array.isArray(parsed) ? parsed : parsed?.actions;
      if (Array.isArray(batch)) actions.push(...batch);
    } catch {}
  }
  return actions.slice(0, 8);
}

function ChatThinkingSection({ reasoning, timeElapsed, isComplete }) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formattedTime = timeElapsed > 0 
    ? ` (${timeElapsed.toFixed(timeElapsed < 10 ? 1 : 0)}s)`
    : "";

  return (
    <div className="chat-thinking-container">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="chat-thinking-header"
      >
        <span className="chat-thinking-title">
          {isComplete ? `Thought process${formattedTime}` : `Thinking...${formattedTime}`}
        </span>
        <ChevronDown
          size={14}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>
      {isExpanded && (
        <div className="chat-thinking-content">
          {reasoning}
        </div>
      )}
    </div>
  );
}

const messageContainsImage = (message) => (
  Array.isArray(message?.content) &&
  message.content.some((item) => item?.type === "image_url" && item?.image_url?.url)
);

async function copyToClipboard(value) {
  const text = String(value || "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function CopyContentButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const handleCopy = async () => {
    await copyToClipboard(value);
    setCopied(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button type="button" className="chat-copy-button" onClick={handleCopy} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

const MAX_PERSISTED_CHAT_DRAFT_CHARS = 65536;
const MAX_RECOVERED_QUEUE_ITEMS = 20;
const MAX_RECOVERED_QUEUE_TEXT_CHARS = 8000;

function readChatDraft(key) {
  try {
    return String(localStorage.getItem(key) || "").slice(0, MAX_PERSISTED_CHAT_DRAFT_CHARS);
  } catch {
    return "";
  }
}

function persistChatDraft(key, value) {
  try {
    const draft = String(value || "");
    if (draft) localStorage.setItem(key, draft.slice(0, MAX_PERSISTED_CHAT_DRAFT_CHARS));
    else localStorage.removeItem(key);
  } catch {
    // Storage availability must never interrupt composer input.
  }
}

function readRecoveredMessageQueue(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.slice(0, MAX_RECOVERED_QUEUE_ITEMS).flatMap((item, index) => {
      const text = typeof item?.text === "string" ? item.text.slice(0, MAX_RECOVERED_QUEUE_TEXT_CHARS) : "";
      return text.trim() ? [{ id: `recovered_${Date.now()}_${index}`, text, attachments: [], recovered: true }] : [];
    });
  } catch {
    return [];
  }
}

function persistRecoverableMessageQueue(key, queue) {
  try {
    const recoverable = queue.filter((item) => !item.attachments?.length && String(item.text || "").trim()).slice(0, MAX_RECOVERED_QUEUE_ITEMS).map((item) => ({ text: String(item.text).slice(0, MAX_RECOVERED_QUEUE_TEXT_CHARS) }));
    if (recoverable.length) localStorage.setItem(key, JSON.stringify(recoverable));
    else localStorage.removeItem(key);
  } catch {
    // Queue recovery is best-effort and must never interrupt composer input.
  }
}

function TextChat({ 
  specs, 
  showAlert, 
  showConfirm, 
  textSettings, 
  setTextSettings, 
  setActiveModel, 
  setServerRunning,
  conversations,
  setConversations,
  activeConversationId,
  setActiveConversationId,
  showHistory,
  setShowHistory,
  saveConversationState,
  setIsLlmLoaded,
  assistantMode = "chat",
  activeProject = null,
  speechSettings = {},
}) {
  const formatGenerationTime = (seconds) => {
    const value = Number(seconds) || 0;
    if (value < 1) return `${Math.round(value * 1000)} ms`;
    return `${value.toFixed(value < 10 ? 2 : 1)} s`;
  };

  const [models, setModels] = useState([]);
  const [status, setStatus] = useState({ ready: false, running: false, settings: {} });
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState([]);
  const draftStorageKey = `luke_chat_draft:${assistantMode}:${activeProject?.id || "general"}:${activeConversationId || "new"}`;
  const [draftAvailable, setDraftAvailable] = useState(() => Boolean(readChatDraft(draftStorageKey).trim()));
  const [isBusy, setIsBusy] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [webTimeFilter, setWebTimeFilter] = useState("any");
  const [loadingModel, setLoadingModel] = useState(null);
  const [tokenUsage, setTokenUsage] = useState({
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  });
  const [memoryStatus, setMemoryStatus] = useState({ compressed: false, archivedCount: 0 });
  const [approvalMode, setApprovalMode] = useState(() => {
    const saved = localStorage.getItem("luke_work_approval_mode");
    return ["ask", "auto", "full", "custom"].includes(saved) ? saved : "auto";
  });
  const [showApprovalMenu, setShowApprovalMenu] = useState(false);
  const [showWorkTools, setShowWorkTools] = useState(false);
  const [requestedWorkFile, setRequestedWorkFile] = useState(null);
  const [showBottomTerminal, setShowBottomTerminal] = useState(false);
  const sendCodeToTerminal = useCallback((code) => {
    setShowBottomTerminal(true);
    setTimeout(() => window.dispatchEvent(new CustomEvent("luke:work-terminal-command", { detail: { command: code } })), 0);
  }, []);
  const [showProjectMemory, setShowProjectMemory] = useState(false);
  const [messageQueue, setMessageQueue] = useState([]);
  const [messageQueuePaused, setMessageQueuePaused] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [messageSearchIndex, setMessageSearchIndex] = useState(0);
  const [composerAssist, setComposerAssist] = useState("");
  const approvalMenuRef = useRef(null);

  useEffect(() => {
    if (assistantMode === "work") return;
    setShowApprovalMenu(false);
    setShowWorkTools(false);
    setShowBottomTerminal(false);
    setShowProjectMemory(false);
  }, [assistantMode]);

  useEffect(() => {
    localStorage.setItem("luke_work_approval_mode", approvalMode);
  }, [approvalMode]);

  useEffect(() => {
    const closeApprovalMenu = (event) => {
      if (approvalMenuRef.current && !approvalMenuRef.current.contains(event.target)) setShowApprovalMenu(false);
    };
    document.addEventListener("mousedown", closeApprovalMenu);
    return () => document.removeEventListener("mousedown", closeApprovalMenu);
  }, []);

  useEffect(() => {
    if (setIsLlmLoaded) {
      setIsLlmLoaded(status.ready ? (status.settings?.model || true) : false);
    }
  }, [status.ready, status.settings?.model, setIsLlmLoaded]);

  const [showModelMenu, setShowModelMenu] = useState(false);
  const modelMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const estimateTokens = (text) => {
    const value = String(text || "").trim();
    if (!value) return 0;
    const wordCount = value.split(/\s+/).filter(Boolean).length;
    return Math.max(wordCount, Math.ceil(value.length / 4));
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const getHardwareContextTarget = () => {
    const ramGb = Math.max(0, Number(specs?.ram_total_gb) || 0);
    const cpuCores = Math.max(1, Number(specs?.cpu_cores_physical) || 1);
    let target = ramGb >= 64 ? 32768 : ramGb >= 32 ? 16384 : ramGb >= 16 ? 8192 : 4096;
    if (cpuCores <= 4) target = Math.min(target, 8192);
    return target;
  };

  const getAdaptiveContextLimit = () => {
    const hardwareTarget = getHardwareContextTarget();
    const runtimeLimit = Number(status.settings?.contextSize) || hardwareTarget;
    return Math.max(2048, Math.min(hardwareTarget, runtimeLimit));
  };

  const messageText = (message) => {
    if (!message) return "";
    if (Array.isArray(message.content)) {
      return message.content.map((item) => item?.text || "").join(" ").trim();
    }
    return String(message.content || "").trim();
  };

  const normalizedSearchQuery = messageSearchQuery.trim().toLowerCase();
  const searchConversations = activeProject?.id
    ? conversations.filter((conversation) => conversation.projectId === activeProject.id)
    : conversations;
  const messageSearchResults = normalizedSearchQuery
    ? searchConversations.flatMap((conversation) => (conversation.messages || []).flatMap((message, messageIndex) => {
        const text = messageText(message);
        return text.toLowerCase().includes(normalizedSearchQuery)
          ? [{ conversationId: conversation.id, conversationTitle: conversation.title || "Chat Session", messageIndex, role: message.role, text }]
          : [];
      }))
    : [];
  const activeSearchResult = messageSearchResults[messageSearchIndex] || null;

  const openSearchResult = (result) => {
    if (!result) return;
    if (result.conversationId !== activeConversationId) setActiveConversationId(result.conversationId);
    setTimeout(() => document.getElementById(`chat-message-${result.messageIndex}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const moveMessageSearch = (delta) => {
    if (messageSearchResults.length === 0) return;
    const nextIndex = (messageSearchIndex + delta + messageSearchResults.length) % messageSearchResults.length;
    setMessageSearchIndex(nextIndex);
    openSearchResult(messageSearchResults[nextIndex]);
  };

  const compactConversationContext = (allMessages, contextLimit, reservedTokens = 0) => {
    const totalBudget = Math.max(1024, Math.floor(Number(contextLimit || 4096) * 0.72));
    const usableBudget = Math.max(768, totalBudget - Math.max(0, Number(reservedTokens) || 0));
    const recentBudget = Math.max(512, Math.floor(usableBudget * 0.72));
    const recent = [];
    const older = [];
    let recentTokens = 0;

    const clipForContext = (message, tokenCap) => {
      const text = messageText(message);
      const charCap = Math.max(320, Math.floor(tokenCap * 3.2));
      if (text.length <= charCap) return message;
      const headChars = Math.floor(charCap * 0.42);
      const tailChars = charCap - headChars;
      return {
        ...message,
        content: `${text.slice(0, headChars)}\n\n[Earlier content clipped from active model context; full text remains visible in Chat history.]\n\n${text.slice(-tailChars)}`,
      };
    };

    for (let index = allMessages.length - 1; index >= 0; index -= 1) {
      const message = allMessages[index];
      const tokens = estimateTokens(messageText(message)) + 8;
      const remaining = recentBudget - recentTokens;
      if (remaining > 96 && (recentTokens + tokens <= recentBudget || recent.length < 2)) {
        const clipped = clipForContext(message, Math.min(tokens, remaining));
        recent.unshift(clipped);
        recentTokens += estimateTokens(messageText(clipped)) + 8;
      } else {
        older.unshift(message);
      }
    }

    if (older.length === 0) {
      return {
        messages: recent,
        compressed: false,
        archivedCount: 0,
        activeMessageCount: recent.length,
      };
    }

    const facts = [];
    const decisions = [];
    const openItems = [];
    for (const message of older) {
      const text = messageText(message).replace(/\s+/g, " " ).trim();
      if (!text) continue;
      const clipped = text.slice(0, 260);
      if (message.role === "user") {
        if (/\b(remember|prefer|always|never|ต้องการ|อยาก|จำ|จากนี้|ต่อไป)\b/i.test(text)) facts.push(clipped);
        else if (/\?|ไหม|หรือไม่|ทำอย่างไร|next|ต่อ/i.test(text)) openItems.push(clipped);
        else decisions.push(clipped);
      } else if (message.role === "assistant") {
        if (/\b(done|completed|added|fixed|implemented|เรียบร้อย|เพิ่ม|แก้ไข)\b/i.test(text)) decisions.push(clipped);
      }
    }

    const unique = (items, limit) => [...new Set(items)].slice(-limit);
    const summary = [
      "Automatic memory summary from earlier messages. Preserve these details unless the user changes them.",
      ...unique(facts, 6).map((item) => `Persistent fact/preference: ${item}`),
      ...unique(decisions, 8).map((item) => `Prior decision/progress: ${item}`),
      ...unique(openItems, 5).map((item) => `Open item: ${item}`),
    ].join("\n").slice(0, Math.max(1200, Math.floor((usableBudget - recentTokens) * 3.2)));

    return {
      messages: [{ role: "system", content: summary }, ...recent],
      compressed: true,
      archivedCount: older.length,
      activeMessageCount: recent.length,
    };
  };

  const getAutoMaxResponseTokens = (promptTokens, thinkingEnabled) => {
    const contextLimit = getAdaptiveContextLimit();
    const safetyBuffer = thinkingEnabled ? 768 : 512;
    const preferredMinimum = thinkingEnabled ? 512 : 256;
    const available = contextLimit - promptTokens - safetyBuffer;
    if (available <= 0) return 64;
    return clamp(available, Math.min(preferredMinimum, available), 4096);
  };
  
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const completedDownloadRef = useRef("");
  const loadingModelRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const prevMessagesLengthRef = useRef(0);
  const followGenerationRef = useRef(false);
  const abortControllerRef = useRef(null);
  // rAF batching: accumulate token updates and flush once per frame
  const tokenBufferRef = useRef(null);
  const rafRef = useRef(null);
  const streamFlushTimerRef = useRef(null);
  const lastStreamPaintRef = useRef(0);
  const draftSaveTimerRef = useRef(null);
  const queueSaveTimerRef = useRef(null);
  const composerResizeRafRef = useRef(null);
  const draftLatestRef = useRef({ [draftStorageKey]: readChatDraft(draftStorageKey) });
  const queueStorageKey = `luke_chat_queue:${assistantMode}:${activeProject?.id || "general"}:${activeConversationId || "new"}`;

  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const audioTranscriptionChainRef = useRef(Promise.resolve());
  const supportsVision = Boolean(status.ready && status.settings?.supportsVision);
  const supportsThinking = Boolean(status.ready && status.settings?.supportsThinking);
  const deepThinkEnabled = status.ready
    ? status.settings?.enableThinking === true
    : textSettings?.enableThinking === true;
  const visionStatus = status.settings?.visionStatus || "Image input requires a matching mmproj projector file.";

  const resizeComposerInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 104;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  const scheduleComposerResize = useCallback(() => {
    if (composerResizeRafRef.current !== null) return;
    composerResizeRafRef.current = requestAnimationFrame(() => {
      composerResizeRafRef.current = null;
      resizeComposerInput();
    });
  }, [resizeComposerInput]);

  const flushStreamBuffer = useCallback(() => {
    const buffer = tokenBufferRef.current;
    if (buffer) {
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: buffer.content,
            reasoning: buffer.reasoning,
            thinkingDuration: buffer.thinkingDuration,
            generationStats: buffer.stats,
          };
        }
        return updated;
      });
      tokenBufferRef.current = null;
      lastStreamPaintRef.current = performance.now();
    }
    rafRef.current = null;
    streamFlushTimerRef.current = null;
  }, []);

  const scheduleStreamPaint = useCallback(() => {
    if (streamFlushTimerRef.current || rafRef.current) return;
    const frameBudget = document.visibilityState === "visible" ? 40 : 160;
    const elapsed = performance.now() - lastStreamPaintRef.current;
    const delay = Math.max(0, frameBudget - elapsed);
    streamFlushTimerRef.current = setTimeout(() => {
      streamFlushTimerRef.current = null;
      if (document.visibilityState === "visible") rafRef.current = requestAnimationFrame(flushStreamBuffer);
      else flushStreamBuffer();
    }, delay);
  }, [flushStreamBuffer]);

  const cancelPendingStreamPaint = useCallback(() => {
    clearTimeout(streamFlushTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamFlushTimerRef.current = null;
    rafRef.current = null;
    tokenBufferRef.current = null;
  }, []);

  useEffect(() => () => cancelPendingStreamPaint(), [cancelPendingStreamPaint]);

  useEffect(() => () => {
    if (composerResizeRafRef.current !== null) cancelAnimationFrame(composerResizeRafRef.current);
  }, []);

  useLayoutEffect(() => {
    draftLatestRef.current[draftStorageKey] = readChatDraft(draftStorageKey);
    resizeComposerInput();
    setDraftAvailable(Boolean(readChatDraft(draftStorageKey).trim()));
  }, [draftStorageKey, resizeComposerInput]);

  useEffect(() => () => {
    clearTimeout(draftSaveTimerRef.current);
    const latestDraft = draftLatestRef.current[draftStorageKey];
    persistChatDraft(draftStorageKey, latestDraft);
  }, [draftStorageKey]);

  const updateComposerDraft = useCallback((value) => {
    draftLatestRef.current[draftStorageKey] = value;
    const hasText = Boolean(String(value || "").trim());
    setDraftAvailable((current) => current === hasText ? current : hasText);
    clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      persistChatDraft(draftStorageKey, value);
    }, 240);
    scheduleComposerResize();
  }, [draftStorageKey, scheduleComposerResize]);

  const fillComposer = useCallback((value) => {
    if (!textareaRef.current) return;
    textareaRef.current.value = value;
    updateComposerDraft(value);
    textareaRef.current.focus();
  }, [updateComposerDraft]);

  const insertComposerValue = useCallback((value) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const current = textarea.value;
    const next = current.replace(/(?:^|\s)([@/][^\s]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}${value} `);
    fillComposer(next === current ? `${current}${current ? " " : ""}${value} ` : next);
    setComposerAssist("");
  }, [fillComposer]);

  useEffect(() => {
    const recovered = readRecoveredMessageQueue(queueStorageKey);
    setMessageQueue(recovered);
    setMessageQueuePaused(recovered.length > 0);
  }, [queueStorageKey]);

  useEffect(() => {
    clearTimeout(queueSaveTimerRef.current);
    queueSaveTimerRef.current = setTimeout(() => persistRecoverableMessageQueue(queueStorageKey, messageQueue), 300);
    return () => clearTimeout(queueSaveTimerRef.current);
  }, [messageQueue, queueStorageKey]);

  useEffect(() => {
    if (messageQueue.length === 0) setMessageQueuePaused(false);
  }, [messageQueue.length]);

  const isImage = (file) => {
    return /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith("image/");
  };

  const isTextFile = (file) => {
    return /\.(txt|md|csv|log|rtf|tex|diff|patch|properties|conf|cfg|js|jsx|ts|tsx|py|json|jsonl|css|scss|html|java|cpp|c|h|rs|go|sh|bat|ps1|xml|yaml|yml|toml|ini|env|sql|vue|svelte|php|rb|swift|kt|gradle|cmake)$/i.test(file.name) || /^(Dockerfile|Makefile)$/i.test(file.name) || file.type.startsWith("text/") || file.type === "application/rtf";
  };

  const isSpreadsheet = (file) => /\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const isPdfFile = (file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isWordFile = (file) => /\.docx?$/i.test(file.name) || ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.type);
  const isPowerPointFile = (file) => /\.pptx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const isAudioFile = (file) => /\.(wav|mp3|m4a|aac|ogg|webm|flac)$/i.test(file.name) || file.type.startsWith("audio/");

  const transcribeAudioAttachment = async (file, attachmentId) => {
    if (file.size > MAX_ATTACHED_AUDIO_BYTES) throw new Error(`“${file.name}” exceeds the 100 MB audio attachment limit.`);
    const [speechStatus, speechModels] = await Promise.all([getSpeechStatus(), listSpeechModels()]);
    const installed = speechModels.filter((model) => model.installed);
    const selectedModel = speechSettings?.model || speechStatus.settings?.model || installed.find((model) => model.recommended)?.filename || installed[0]?.filename;
    if (!speechStatus.backendInstalled) throw new Error("Install the Speech transcription backend before attaching audio.");
    if (!selectedModel) throw new Error("Install a Whisper Speech model before attaching audio.");
    if (!speechStatus.ready || speechStatus.settings?.model !== selectedModel) {
      await startSpeech(selectedModel, {
        language: speechSettings?.language || "auto",
        threads: speechSettings?.threads || specs?.cpu_cores_physical || 4,
        backendPreference: speechSettings?.backendPreference || "auto",
      });
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Audio decoding is not available in this browser.");
    const audioContext = new AudioContextClass();
    let wavBlob;
    try {
      const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
      wavBlob = encodeAudioBufferAsWav(decoded);
    } finally {
      await audioContext.close();
    }
    const transcription = await transcribeSpeech(wavBlob, {
      model: selectedModel,
      language: speechSettings?.language || "auto",
      threads: speechSettings?.threads || specs?.cpu_cores_physical || 4,
      backendPreference: speechSettings?.backendPreference || "auto",
      translate: speechSettings?.translate === true,
      filename: file.name.replace(/\.[^.]+$/, ".wav"),
    });
    const content = String(transcription?.text || "").trim();
    if (!content) throw new Error(`No speech was detected in “${file.name}”.`);
    setAttachments((current) => current.map((attachment) => attachment.id === attachmentId
      ? { ...attachment, type: "document", transcript: true, content: content.slice(0, MAX_ATTACHED_TEXT_CHARS), truncated: content.length > MAX_ATTACHED_TEXT_CHARS, status: "ready" }
      : attachment));
  };

  const optimizeImageForVision = (file, maxSide = 1024, quality = 0.92) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const originalDataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const sendDataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          previewDataUrl: originalDataUrl,
          sendDataUrl,
          originalWidth: img.width,
          originalHeight: img.height,
          width,
          height,
        });
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });

  const addAttachmentFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files || files.length === 0) return;

    files.forEach((file) => {
      if (isAudioFile(file)) {
        const attachmentId = Math.random().toString(36).substring(7);
        setAttachments((prev) => [...prev, { id: attachmentId, file, type: "audio", name: file.name, status: "transcribing" }]);
        audioTranscriptionChainRef.current = audioTranscriptionChainRef.current.catch(() => {}).then(() => transcribeAudioAttachment(file, attachmentId)).catch((err) => {
          setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
          showAlert({ title: "Audio Transcription Failed", message: err.message || String(err), danger: true });
        });
      } else if (isImage(file)) {
        if (!supportsVision) {
          showAlert({ title: "Vision Model Required", message: `Load a vision-capable model to analyze image “${file.name}”. Text, code and spreadsheet files can still be attached with the current model.`, danger: false });
          return;
        }
        optimizeImageForVision(file)
          .then((image) => {
          setAttachments((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "image",
              name: file.name,
                dataUrl: image.previewDataUrl,
                sendDataUrl: image.sendDataUrl,
                width: image.width,
                height: image.height,
                originalWidth: image.originalWidth,
                originalHeight: image.originalHeight,
            },
          ]);
          })
          .catch((err) => {
            showAlert({ title: "Image Error", message: err.message || String(err), danger: true });
          });
      } else if (isPdfFile(file)) {
        extractPdfText(file).then((content) => {
          if (!content) throw new Error(`No selectable text was found in “${file.name}”. Scanned PDFs need OCR support.`);
          setAttachments((prev) => [...prev, { id: Math.random().toString(36).substring(7), file, type: "document", name: file.name, content: content.slice(0, MAX_ATTACHED_TEXT_CHARS), truncated: content.length > MAX_ATTACHED_TEXT_CHARS }]);
        }).catch((err) => showAlert({ title: "PDF Reading Failed", message: err.message || String(err), danger: true }));
      } else if (isWordFile(file)) {
        extractWordText(file).then(({ content, legacy }) => {
          if (!content) throw new Error(`No readable text was found in “${file.name}”. Try saving this legacy document as DOCX.`);
          setAttachments((prev) => [...prev, { id: Math.random().toString(36).substring(7), file, type: "document", name: file.name, content: content.slice(0, MAX_ATTACHED_TEXT_CHARS), truncated: content.length > MAX_ATTACHED_TEXT_CHARS, legacyWord: legacy }]);
          if (legacy) showAlert({ title: "Legacy DOC attached", message: "Text was recovered from the older DOC format. For the most accurate layout and text, save it as DOCX.", danger: false });
        }).catch((err) => showAlert({ title: "Word Reading Failed", message: err.message || String(err), danger: true }));
      } else if (isPowerPointFile(file)) {
        extractPowerPointText(file).then((content) => {
          if (!content) throw new Error(`No readable slide text was found in “${file.name}”.`);
          setAttachments((prev) => [...prev, { id: Math.random().toString(36).substring(7), file, type: "document", name: file.name, content: content.slice(0, MAX_ATTACHED_TEXT_CHARS), truncated: content.length > MAX_ATTACHED_TEXT_CHARS }]);
        }).catch((err) => showAlert({ title: "PowerPoint Reading Failed", message: err.message || String(err), danger: true }));
      } else if (isSpreadsheet(file)) {
        readXlsxFile(file).then((sheets) => {
          const content = sheets.map((sheet) => `[Sheet: ${sheet.sheet}]\n${sheet.data.map((row) => row.map((cell) => String(cell ?? "").replace(/\t|\r?\n/g, " ")).join("\t")).join("\n")}`).join("\n\n");
          setAttachments((prev) => [...prev, { id: Math.random().toString(36).substring(7), file, type: "document", name: file.name, content: content.slice(0, MAX_ATTACHED_TEXT_CHARS), truncated: content.length > MAX_ATTACHED_TEXT_CHARS }]);
        }).catch((err) => showAlert({ title: "Spreadsheet Error", message: err.message || String(err), danger: true }));
      } else if (isTextFile(file)) {
        if (file.size > MAX_ATTACHED_TEXT_CHARS * 4) {
          showAlert({ title: "File Too Large", message: `“${file.name}” is too large to attach safely. Add its folder to the Project and ask Work Chat to inspect the file directly.`, danger: false });
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = String(event.target.result || "");
          setAttachments((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "document",
              name: file.name,
              content: content.slice(0, MAX_ATTACHED_TEXT_CHARS),
              truncated: content.length > MAX_ATTACHED_TEXT_CHARS,
            },
          ]);
        };
        reader.readAsText(file);
      } else {
        showAlert({
          title: "Unsupported File",
          message: `File "${file.name}" is not supported yet. Select an image, common audio file, PDF, Word, PowerPoint, XLSX spreadsheet, or text/code/config file.`,
          danger: true,
        });
      }
    });

  };

  const handleFileChange = (event) => {
    addAttachmentFiles(event.target.files);
    event.target.value = "";
  };

  useEffect(() => {
    loadingModelRef.current = loadingModel;
  }, [loadingModel]);


  const buildTextStartOptions = (settings) => ({
    threads: settings?.threads || specs?.cpu_cores_physical || 4,
    contextSize: getHardwareContextTarget(),
    gpuLayers: settings?.gpuLayers ?? -1,
    enableThinking: settings?.enableThinking === true,
    flashAttn: settings?.flashAttn,
    cacheTypeK: settings?.cacheTypeK,
    cacheTypeV: settings?.cacheTypeV,
    mlock: settings?.mlock,
    mmap: settings?.mmap,
    cachePrompt: settings?.cachePrompt,
    defragThold: settings?.defragThold,
    batchSize: settings?.batchSize,
    ubatchSize: settings?.ubatchSize,
    performanceProfile: settings?.performanceProfile,
    preferredBackend: settings?.preferredBackend,
  });

  const handleThinkingToggle = async () => {
    const enabled = !deepThinkEnabled;
    const nextSettings = { ...textSettings, enableThinking: enabled };

    if (!status.ready || !status.settings?.model) {
      setTextSettings(nextSettings);
      return;
    }

    const reload = await showConfirm({
      title: enabled ? "Reload With DeepThink?" : "Reload Without DeepThink?",
      message: "Changing DeepThink requires reloading the text model before it affects new replies. Reload now, or skip and keep the currently loaded model as-is?",
      confirmLabel: "Reload",
      cancelLabel: "Skip",
    });
    if (!reload) return;

    setIsBusy(true);
    try {
      setTextSettings(nextSettings);
      await stopLlm();
      const result = await startLlm(status.settings.model, buildTextStartOptions(nextSettings));
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
    } catch (err) {
      showAlert({ title: "Text Model Reload Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!supportsVision) {
      setAttachments((current) => current.filter((attachment) => attachment.type !== "image"));
    }
  }, [supportsVision]);

  // Load conversation messages when activeConversationId changes
  useEffect(() => {
    if (isBusy) return;
    if (activeConversationId) {
      const conv = conversations.find(c => c.id === activeConversationId);
      if (conv) {
        setMessages(conv.messages);
        if (conv.model && models.some(m => m.filename === conv.model)) {
          setSelectedModel(conv.model);
        }
        const contextLimit = getAdaptiveContextLimit();
        const reservedSystemTokens = estimateTokens(
          textSettings?.systemPrompt || "You are a helpful local AI assistant.",
        ) + 16;
        const managedContext = compactConversationContext(
          conv.messages,
          contextLimit,
          reservedSystemTokens,
        );
        const total = managedContext.messages.reduce((sum, m) => {
          const text = Array.isArray(m.content)
            ? m.content.map(c => c.text || "").join(" ")
            : (m.content || "");
          return sum + estimateTokens(text) + estimateTokens(m.reasoning || "");
        }, reservedSystemTokens);
        setTokenUsage({
          prompt_tokens: Math.round(total * 0.7),
          completion_tokens: Math.round(total * 0.3),
          total_tokens: total
        });
        setMemoryStatus({
          compressed: managedContext.compressed,
          archivedCount: managedContext.archivedCount,
          activeMessageCount: managedContext.activeMessageCount,
          conversationId: activeConversationId,
        });
      }
    } else {
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
      setMemoryStatus({ compressed: false, archivedCount: 0, activeMessageCount: 0 });
    }
  }, [activeConversationId, conversations, models, isBusy]);

  const refresh = useCallback(async () => {
    const [nextModels, nextStatus] = await Promise.all([listLlmModels(), getLlmStatus()]);
    const selectableModels = nextModels.filter((model) => !model.isProjector);
    setModels(selectableModels);
    setStatus(nextStatus);
    const active = nextStatus.settings?.model;
    setSelectedModel((current) => {
      const saved = localStorage.getItem("selectedLlmModel");
      const savedExists = selectableModels.some((m) => m.filename === saved);
      return active || current || (savedExists ? saved : "") || selectableModels[0]?.filename || "";
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const timer = setInterval(() => {
      getLlmStatus().then((nextStatus) => {
        setStatus(nextStatus);
        // If it suddenly loaded or became ready externally, update selection and reset loading states
        if (nextStatus.ready && nextStatus.settings?.model) {
          setSelectedModel(nextStatus.settings.model);
          setLoadingModel(null);
        }
      }).catch(() => {});
      getDownloadProgress().then((state) => {
        if (state.kind === "text" && (state.active || state.error || state.progress === 100)) {
          const completionKey = `${state.filename || ""}:${state.downloadedBytes || 0}`;
          if (!state.active && !state.error && completedDownloadRef.current !== completionKey) {
            completedDownloadRef.current = completionKey;
            refresh().catch(() => {});
          }
        }
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;

    const len = messages.length;
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = len;

    const lastMessage = messages[len - 1];
    const isNewUserMessage = len > prevLen && lastMessage?.role === "user";

    if (isNewUserMessage) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (followGenerationRef.current) {
      // Streaming updates already arrive several times per second. Immediate
      // scrolling avoids stacking smooth-scroll animations on the main thread,
      // keeping the composer responsive while the response grows.
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    } else {
      const threshold = 150;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
      if (isNearBottom) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [messages, isBusy, loadingModel]);

  const handleModelChange = async (filename) => {
    if (!filename) {
      if (status.ready) {
        setIsBusy(true);
        try {
          await stopLlm();
          setStatus((prev) => ({ ...prev, ready: false, running: false }));
          setSelectedModel("");
          setMessages([]);
          setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        } catch (err) {
          showAlert({ title: "Unload Failed", message: err.message || String(err), danger: true });
        } finally {
          setIsBusy(false);
        }
      }
      return;
    }

    setSelectedModel(filename);
    localStorage.setItem("selectedLlmModel", filename);
    setIsBusy(true);
    setLoadingModel(filename);
    try {
      // Unload active image engine if running
      if (setActiveModel) setActiveModel(null);
      if (setServerRunning) setServerRunning(false);

      const result = await startLlm(filename, {
        threads: textSettings?.threads || specs?.cpu_cores_physical || 4,
        contextSize: getHardwareContextTarget(),
        gpuLayers: textSettings?.gpuLayers ?? -1,
        enableThinking: textSettings?.enableThinking === true,
        flashAttn: textSettings?.flashAttn,
        cacheTypeK: textSettings?.cacheTypeK,
        cacheTypeV: textSettings?.cacheTypeV,
        mlock: textSettings?.mlock,
        mmap: textSettings?.mmap,
        cachePrompt: textSettings?.cachePrompt,
        defragThold: textSettings?.defragThold,
        batchSize: textSettings?.batchSize,
        ubatchSize: textSettings?.ubatchSize,
        performanceProfile: textSettings?.performanceProfile,
        preferredBackend: textSettings?.preferredBackend,
      });
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    } catch (err) {
      if (loadingModelRef.current === filename) {
        showAlert({ title: "Text Model Load Failed", message: err.message, danger: true });
      }
    } finally {
      setLoadingModel(null);
      setIsBusy(false);
    }
  };

  const handleCancelLlmLoad = async () => {
    try {
      await stopLlm();
    } catch (_) {}
    setLoadingModel(null);
    setIsBusy(false);
    setSelectedModel("");
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
  };

  const executeWorkActions = async (actions) => {
    const roots = activeProject?.sourceFolders || [];
    const results = [];
    for (const [index, rawAction] of actions.entries()) {
      const action = rawAction && typeof rawAction === "object" ? rawAction : {};
      const tool = String(action.tool || "");
      const root = roots.includes(action.root) ? action.root : roots[0];
      const base = { root, projectId: activeProject?.id, grantId: activeProject?.folderGrants?.[root] };
      if (!root) {
        results.push({ index, tool, ok: false, error: "No granted Source Folder is attached to this Work project." });
        continue;
      }
      const changesFiles = tool === "write_file";
      const mustAsk = approvalMode === "ask" || approvalMode === "custom";
      if (mustAsk && !window.confirm(`Allow Work Chat to ${changesFiles ? "write" : "run"} ${tool}${action.path ? `: ${action.path}` : ""}?`)) {
        results.push({ index, tool, ok: false, error: "User denied this action." });
        continue;
      }
      const endpoint = {
        list_directory: "/api/work/directory",
        read_file: "/api/work/file/read",
        write_file: "/api/work/file/write",
        terminal: "/api/work/terminal",
        review_diff: "/api/work/review/diff",
      }[tool];
      if (!endpoint) {
        results.push({ index, tool, ok: false, error: "Unsupported Work tool." });
        continue;
      }
      const payload = tool === "terminal"
        ? { ...base, command: String(action.command || "") }
        : { ...base, path: String(action.path || ""), ...(changesFiles ? { content: String(action.content ?? ""), approvalGranted: true } : {}) };
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `${tool} failed.`);
        results.push({ index, tool, ok: true, path: action.path, command: action.command, result: data.directory || data.file || data.result });
      } catch (error) {
        results.push({ index, tool, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return JSON.stringify({ workToolResults: results }, null, 2).slice(0, MAX_WORK_TOOL_RESULT_CHARS);
  };

  const sendMessage = async (queuedItem = null, fromQueue = false) => {
    const agentRound = Number(queuedItem?.agentRound || 0);
    const sourceAttachments = queuedItem?.attachments || attachments;
    const text = String(queuedItem?.text ?? textareaRef.current?.value ?? "").trim();
    const hasAttachments = sourceAttachments.length > 0;
    if ((!text && !hasAttachments) || !status.ready) return;
    if (sourceAttachments.some((attachment) => attachment.status === "transcribing")) {
      showAlert({ title: "Transcription in progress", message: "Please wait for the attached audio transcript to finish. You can keep typing while it runs.", danger: false });
      return;
    }

    if (!queuedItem && !hasAttachments && text.startsWith("/")) {
      const command = text.toLowerCase();
      if (["/search", "/memory", "/checkpoint", "/new"].includes(command)) {
        if (command === "/search") setShowMessageSearch(true);
        if (command === "/memory" && assistantMode === "work") setShowProjectMemory(true);
        if (command === "/checkpoint" && assistantMode === "work" && activeProject?.id) createWorkCheckpoint(activeProject.id, messages, "Manual slash-command checkpoint");
        if (command === "/new") handleNewChat();
        if (textareaRef.current) textareaRef.current.value = "";
        updateComposerDraft("");
        setComposerAssist("");
        return;
      }
    }

    if (isBusy && !fromQueue) {
      setMessageQueue((current) => [...current, {
        id: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text,
        attachments: sourceAttachments,
      }]);
      if (textareaRef.current) textareaRef.current.value = "";
      setAttachments([]);
      draftLatestRef.current[draftStorageKey] = "";
      persistChatDraft(draftStorageKey, "");
      setDraftAvailable(false);
      scheduleComposerResize();
      return;
    }

    const conversationBase = Array.isArray(queuedItem?.baseMessages) ? queuedItem.baseMessages : messages;
    const recentUserContext = conversationBase.filter((message) => message.role === "user").slice(-2).map((message) => messageText(message).slice(0, 600)).filter(Boolean);
    const retrievalQuery = text.length < 120 ? [...recentUserContext, text].join("\n") : text;
    let convId = activeConversationId;
    let isNew = false;
    if (!convId) {
      convId = "chat_" + Date.now();
      setActiveConversationId(convId);
      isNew = true;
    }

    if (assistantMode === "work" && activeProject?.id && conversationBase.length > 0 && !queuedItem?.preserveComposer) {
      createWorkCheckpoint(activeProject.id, conversationBase, "Before next Work message");
    }

    // Retrieve only relevant chunks from large attachments instead of spending the full model context.
    const documentAttachments = sourceAttachments.filter((attachment) => attachment.type === "document");
    const selectedDocumentChunks = selectRelevantDocumentChunks(documentAttachments, retrievalQuery);
    let documentContext = selectedDocumentChunks.map(({ attachment, text: chunkText, chunkIndex }) =>
      `[Attached File: ${attachment.name}; relevant chunk ${chunkIndex + 1}${attachment.transcript ? "; speech transcript" : ""}${attachment.legacyWord ? "; legacy DOC text recovery" : ""}${attachment.truncated ? "; source preview truncated" : ""}. In Work mode, use write_file to save an edited version inside the granted Project when requested.]\n${chunkText}`
    ).join("\n\n");

    // Project RAG is read-only and every source remains bound to its explicit project folder grant.
    let projectSearchContext = "";
    let retrievedProjectSources = [];
    if (assistantMode === "work" && activeProject?.id && activeProject?.sourceFolders?.length && text.length >= 2) {
      try {
        const response = await fetch("/api/work/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProject.id,
            query: retrievalQuery,
            limit: 8,
            sources: activeProject.sourceFolders.map((root) => ({ root, grantId: activeProject.folderGrants?.[root] })),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Project search failed.");
        const projectResults = data.search?.results || [];
        projectSearchContext = projectResults.map((result, index) =>
          `[Project Search ${index + 1}: ${result.path} (${result.start}-${result.end})]\n${result.text}`
        ).join("\n\n");
        retrievedProjectSources = projectResults.map(({ root, path, start, end, score }) => ({ root, path, start, end, score }));
      } catch (error) {
        console.warn("Project RAG unavailable:", error);
      }
    }

    const imageAttachments = sourceAttachments.filter(att => att.type === "image");
    const conversationHasImage = conversationBase.some(messageContainsImage);
    const requestHasImage = imageAttachments.length > 0 || conversationHasImage;
    const visionInstruction = requestHasImage
      ? "For images in this conversation: answer in natural language, describe the actual image content, and read visible text carefully when relevant. If the user asks a follow-up like \"what is this\" or \"explain\", treat it as referring to the most recent image unless they say otherwise. Do not output raw JSON, arrays, bounding boxes, OCR layout objects, UI class names, or detection labels unless the user explicitly asks for that format."
      : "";
    const requestText = imageAttachments.length > 0
      ? (text && text !== "?" ? text : "Describe what is visible in the image.")
      : text;
    const displayText = text || (imageAttachments.length > 0 ? "Describe what is visible in the image." : "");
    const requestCombinedText = [
      requestText,
      documentContext,
      projectSearchContext,
    ].filter(Boolean).join("\n\n").trim();
    const attachmentSummary = documentAttachments.length
      ? `[Attached documents: ${documentAttachments.map((attachment) => attachment.name).join(", ")}. Relevant sections selected automatically.]`
      : "";
    const displayCombinedText = [displayText, attachmentSummary].filter(Boolean).join("\n\n").trim();

    let userMessageContent;
    let requestUserMessageContent;
    if (imageAttachments.length > 0) {
      userMessageContent = [
        {
          type: "text",
          text: displayCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.dataUrl
          }
        }))
      ];
      requestUserMessageContent = [
        {
          type: "text",
          text: requestCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.sendDataUrl || img.dataUrl
          }
        }))
      ];
    } else {
      userMessageContent = displayCombinedText;
      requestUserMessageContent = requestCombinedText;
    }

    const branchGroupId = queuedItem?.branchGroupId || `branch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userMessage = {
      role: "user",
      content: userMessageContent,
      branchGroupId,
      branchAlternatives: Array.isArray(queuedItem?.branchAlternatives) ? queuedItem.branchAlternatives : [],
      ragSources: retrievedProjectSources,
    };
    const nextMessages = [...conversationBase, userMessage];
    const requestConversationMessages = [...conversationBase, { role: "user", content: requestUserMessageContent }];
    followGenerationRef.current = true;
    setMessages(nextMessages);
    if (!queuedItem?.preserveComposer) {
      setAttachments([]);
      if (textareaRef.current) textareaRef.current.value = "";
      draftLatestRef.current[draftStorageKey] = "";
      clearTimeout(draftSaveTimerRef.current);
      persistChatDraft(draftStorageKey, "");
      setDraftAvailable(false);
      scheduleComposerResize();
    }
    setIsBusy(true);

    const displayTitleText = text || (imageAttachments.length > 0 ? "Sent Image" : "Sent File");
    const firstTitle = isNew ? (displayTitleText.slice(0, 26) + (displayTitleText.length > 26 ? "..." : "")) : null;
    saveConversationState(convId, nextMessages, selectedModel, firstTitle);

    const requestStartedAt = performance.now();
    setMessages([...nextMessages, {
      role: "assistant",
      content: "",
      generationStats: { status: "starting", tokens: 0, tokensPerSecond: 0, seconds: 0, vision: requestHasImage, web: useWebSearch },
    }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = textSettings?.systemPrompt || "You are a helpful local AI assistant.";
      const workInstruction = assistantMode === "work"
        ? [
            "You are in Work mode. Help complete multi-step project work with clear plans, checkpoints, and concrete deliverables.",
            activeProject?.name ? `Active project: ${activeProject.name}.` : "No project is currently selected.",
            activeProject?.sourceFolders?.length
              ? `Project source folders: ${activeProject.sourceFolders.join(", ")}. Treat these paths as project scope; do not claim to have read files unless their contents were provided.`
              : "No source folders are attached to this project.",
            "You can operate the selected project directly. When a tool is needed, emit one fenced ```luke-actions JSON block with {\"actions\":[...]}. Supported actions: {\"tool\":\"list_directory\",\"path\":\"relative/path\"}, {\"tool\":\"read_file\",\"path\":\"relative/file\"}, {\"tool\":\"write_file\",\"path\":\"relative/file\",\"content\":\"complete new content\"}, {\"tool\":\"terminal\",\"command\":\"allowlisted read-only command\"}, and {\"tool\":\"review_diff\",\"path\":\"relative/file\"}. Paths must be relative to a granted Source Folder. Do not ask the user to copy commands. Use tools, inspect their returned results, continue autonomously, and finish with a concise summary when the task is complete.",
            "Relevant Project Search excerpts may be included with the user request. When relying on them, cite the relative file path shown in the excerpt and do not imply that unrelated files were read.",
            `This autonomous Work run is on tool round ${agentRound} of ${MAX_WORK_AGENT_ROUNDS}. Do not request more tools after the final round.`,
          ].join("\n")
        : "You are in Chat mode. Prioritize natural conversation, direct answers, learning, and exploration.";
      const approvalInstruction = assistantMode === "work"
        ? {
            ask: "Approval policy: ask before every action that changes files, runs commands, opens apps, or uses the network.",
            auto: "Approval policy: proceed with safe project-scoped actions, but ask before potentially unsafe, destructive, external, or network actions.",
            full: "Approval policy: broad access was selected, but still explain destructive or irreversible actions clearly before proceeding.",
            custom: "Approval policy: use the custom project permission rules; if a rule is unavailable or ambiguous, ask first.",
          }[approvalMode]
        : "";
      const combinedSystemPrompt = [
        systemPrompt.trim(),
        workInstruction,
        approvalInstruction,
        visionInstruction,
        assistantMode === "work" && activeProject?.id && getProjectMemory(activeProject.id).length
          ? `Project memory:\n${getProjectMemory(activeProject.id).map((item) => `- [${item.type}${item.pinned ? ", pinned" : ""}] ${item.text}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n\n");
      const contextLimit = getAdaptiveContextLimit();
      const reservedSystemTokens = estimateTokens(combinedSystemPrompt) + 16;
      const managedContext = compactConversationContext(
        requestConversationMessages,
        contextLimit,
        reservedSystemTokens,
      );
      const requestMessages = [
        ...(combinedSystemPrompt ? [{ role: "system", content: combinedSystemPrompt }] : []),
        ...managedContext.messages,
      ];
      setMemoryStatus({
        compressed: managedContext.compressed,
        archivedCount: managedContext.archivedCount,
        activeMessageCount: managedContext.activeMessageCount,
        conversationId: convId,
      });
      const promptTokenEstimate = requestMessages.reduce((sum, message) => {
        const messageText = Array.isArray(message.content)
          ? message.content.map((item) => item.text || "").join(" ")
          : (message.content || "");
        return sum + estimateTokens(messageText);
      }, 0);
      setTokenUsage({
        prompt_tokens: promptTokenEstimate,
        completion_tokens: 0,
        total_tokens: promptTokenEstimate,
      });

      let assistantText = "";
      let rawAssistantText = "";
      let assistantReasoning = "";
      let streamedTokens = 0;
      let firstTokenAt = null;
      let thinkingStartedAt = null;
      let thinkingEndedAt = null;
      let thinkingDuration = 0;

      const thinkingEnabled = deepThinkEnabled;
      const manualMaxTokens = textSettings?.maxTokens || 1024;
      const effectiveMaxTokens = textSettings?.responseTokenMode === "manual"
        ? (thinkingEnabled ? Math.max(manualMaxTokens, 1024) : manualMaxTokens)
        : getAutoMaxResponseTokens(promptTokenEstimate, thinkingEnabled);

      const streamOptions = {
        temperature: textSettings?.temperature || 0.7,
        maxTokens: effectiveMaxTokens,
        topP: textSettings?.topP,
        topK: textSettings?.topK,
        minP: textSettings?.minP,
        repeatPenalty: textSettings?.repeatPenalty,
        seed: textSettings?.seed,
        enableThinking: thinkingEnabled,
        useWeb: useWebSearch,
        timeFilter: webTimeFilter,
        signal: controller.signal,
      };
      const handleStreamToken = (_token, fullText, _reasoningToken, fullReasoning) => {
        const now = performance.now();
        if (streamedTokens === 0) {
          firstTokenAt = now;
        }
        streamedTokens += 1;
        const generationSeconds = firstTokenAt
          ? Math.max(0.05, (now - firstTokenAt) / 1000)
          : Math.max(0.05, (now - requestStartedAt) / 1000);
        
        rawAssistantText = fullText;
        const processed = processMessageContent(fullText, fullReasoning, deepThinkEnabled);
        assistantText = processed.content;
        assistantReasoning = processed.reasoning;

        // Calculate thinking duration
        if (processed.reasoning && !thinkingStartedAt) {
          thinkingStartedAt = now;
        }
        if (processed.content && thinkingStartedAt && !thinkingEndedAt) {
          thinkingEndedAt = now;
          thinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
        }
        const currentThinkingDuration = thinkingEndedAt 
          ? thinkingDuration 
          : (thinkingStartedAt ? (now - thinkingStartedAt) / 1000 : 0);

        // Debounced stats update: only update stats every 250ms for smoother UI
        // while text still updates per-frame via rAF batching
        const currentStats = {
          status: "streaming",
          tokens: streamedTokens,
          tokensPerSecond: streamedTokens / generationSeconds,
          seconds: (now - requestStartedAt) / 1000,
        };
        // Adaptive paint batching keeps token intake fast while limiting expensive
        // Markdown/chat renders to ~25 FPS when visible and ~6 FPS in background.
        tokenBufferRef.current = {
          content: processed.content,
          reasoning: processed.reasoning,
          thinkingDuration: currentThinkingDuration,
          stats: currentStats,
        };

        scheduleStreamPaint();
      };
      let response;
      try {
        response = await streamChatWithLlm(requestMessages, streamOptions, handleStreamToken);
      } catch (generationError) {
        const contextOverflow = /context|too many tokens|token limit|exceed(?:ed|s)? .*token|prompt .*large/i.test(String(generationError?.message || ""));
        if (!contextOverflow || streamedTokens > 0 || controller.signal.aborted) throw generationError;
        const systemMessage = requestMessages.find((message) => message.role === "system");
        const emergencyRecent = requestConversationMessages.slice(-2).map((message) => {
          const text = messageText(message);
          return { ...message, content: text.length > 3600 ? `${text.slice(0, 1500)}\n\n[Context refreshed automatically.]\n\n${text.slice(-1900)}` : message.content };
        });
        const emergencyMessages = [...(systemMessage ? [systemMessage] : []), {
          role: "system",
          content: "The model context was refreshed automatically. Full earlier messages remain visible in Chat history. Continue the same task using the recent messages and project memory below.",
        }, ...emergencyRecent];
        setMemoryStatus({ compressed: true, archivedCount: Math.max(0, requestConversationMessages.length - emergencyRecent.length), activeMessageCount: emergencyRecent.length, conversationId: convId });
        response = await streamChatWithLlm(emergencyMessages, { ...streamOptions, maxTokens: Math.min(effectiveMaxTokens, 1024) }, handleStreamToken);
      }

      const completedAt = performance.now();
      let finalThinkingDuration = thinkingDuration;
      if (thinkingStartedAt && !thinkingEndedAt) {
        thinkingEndedAt = completedAt;
        finalThinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
      }

      const exactTokens = Number(response.timings?.predicted_n) || streamedTokens;
      const backendTotalMs = Number(response.timings?.prompt_ms || 0) + Number(response.timings?.predicted_ms || 0);
      const exactSeconds = backendTotalMs > 0
        ? backendTotalMs / 1000
        : (completedAt - requestStartedAt) / 1000;
      const exactTokensPerSecond = Number(response.timings?.predicted_per_second)
        || (exactTokens / Math.max(0.001, exactSeconds));
      const generationStats = {
        status: "complete",
        tokens: exactTokens,
        tokensPerSecond: exactTokensPerSecond,
        seconds: exactSeconds,
        finishReason: response.finishReason || null,
        truncated: response.finishReason === "length",
      };
      
      const processed = processMessageContent(response.content || rawAssistantText || assistantText, response.reasoningContent || assistantReasoning, deepThinkEnabled);
      const finalMessages = [...nextMessages, {
        role: "assistant",
        content: processed.content,
        reasoning: processed.reasoning,
        thinkingDuration: finalThinkingDuration,
        generationStats,
        webSources: response.webSources || [],
      }];
      cancelPendingStreamPaint();
      setMessages(finalMessages);
      saveConversationState(convId, finalMessages, selectedModel);
      const workActions = assistantMode === "work" ? parseWorkActions(processed.content) : [];
      if (workActions.length > 0 && agentRound < MAX_WORK_AGENT_ROUNDS) {
        const toolResults = await executeWorkActions(workActions);
        setMessageQueue((current) => [...current, {
          id: `work_agent_${Date.now()}_${agentRound + 1}`,
          text: `[Automatic Work tool results — continue the task without asking me to copy or paste anything.]\n${toolResults}`,
          attachments: [],
          baseMessages: finalMessages,
          preserveComposer: true,
          agentRound: agentRound + 1,
        }]);
      }
      const finalCompletionEstimate = Math.max(
        exactTokens,
        estimateTokens(processed.content) + estimateTokens(processed.reasoning)
      );
      const finalUsageEstimate = {
        prompt_tokens: promptTokenEstimate,
        completion_tokens: finalCompletionEstimate,
        total_tokens: promptTokenEstimate + finalCompletionEstimate,
      };
      setTokenUsage(response.usage
        ? {
            prompt_tokens: Math.max(Number(response.usage.prompt_tokens) || 0, finalUsageEstimate.prompt_tokens),
            completion_tokens: Math.max(Number(response.usage.completion_tokens) || 0, finalUsageEstimate.completion_tokens),
            total_tokens: Math.max(Number(response.usage.total_tokens) || 0, finalUsageEstimate.total_tokens),
          }
        : finalUsageEstimate
      );
      
    } catch (err) {
      const interruptedBuffer = tokenBufferRef.current;
      cancelPendingStreamPaint();
      if (err.name === "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
            const lastMsg = updated[updated.length - 1];
            updated[updated.length - 1] = {
              ...lastMsg,
              content: interruptedBuffer?.content ?? lastMsg.content,
              reasoning: interruptedBuffer?.reasoning ?? lastMsg.reasoning,
              thinkingDuration: interruptedBuffer?.thinkingDuration ?? lastMsg.thinkingDuration,
              generationStats: (interruptedBuffer?.stats || lastMsg.generationStats) ? {
                ...(interruptedBuffer?.stats || lastMsg.generationStats),
                status: "complete",
              } : null
            };
            saveConversationState(convId, updated, selectedModel);
          }
          return updated;
        });
      } else {
        const finalMessages = [...nextMessages, { role: "assistant", content: `Error: ${err.message}`, error: true }];
        setMessages(finalMessages);
        saveConversationState(convId, finalMessages, selectedModel);
      }
    } finally {
      setIsBusy(false);
      abortControllerRef.current = null;
      setTimeout(() => {
        followGenerationRef.current = false;
      }, 250);
    }
  };

  useEffect(() => {
    if (isBusy || !status.ready || messageQueuePaused || messageQueue.length === 0) return;
    const [nextItem, ...remaining] = messageQueue;
    setMessageQueue(remaining);
    const timer = setTimeout(() => { void sendMessage(nextItem, true); }, 0);
    return () => clearTimeout(timer);
  }, [isBusy, status.ready, messageQueue, messageQueuePaused]);

  const stripBranchAlternatives = (tail) => tail.map((message, index) => index === 0
    ? { ...message, branchAlternatives: [] }
    : message);

  const retryFromUserMessage = (userIndex, replacementText = null) => {
    if (isBusy || userIndex < 0 || messages[userIndex]?.role !== "user") return;
    const originalUser = messages[userIndex];
    if (messageContainsImage(originalUser)) {
      showAlert({ title: "Retry with image", message: "Image branches are not available yet. Start a new message with the image attached.", danger: false });
      return;
    }
    const originalText = messageText(originalUser);
    const nextText = String(replacementText ?? originalText).trim();
    if (!nextText) return;
    const originalTail = stripBranchAlternatives(messages.slice(userIndex));
    const alternatives = [
      ...(originalUser.branchAlternatives || []),
      { id: `alternative_${Date.now()}`, label: "Previous response", messages: originalTail },
    ];
    void sendMessage({
      text: nextText,
      attachments: [],
      baseMessages: messages.slice(0, userIndex),
      branchGroupId: originalUser.branchGroupId || `branch_${Date.now()}`,
      branchAlternatives: alternatives,
      preserveComposer: true,
    }, true);
  };

  const editAndRetryUserMessage = (userIndex) => {
    const currentText = messageText(messages[userIndex]);
    const replacement = window.prompt("Edit this message and create a new response branch:", currentText);
    if (replacement !== null && replacement.trim() && replacement.trim() !== currentText) retryFromUserMessage(userIndex, replacement);
  };

  const switchMessageBranch = (userIndex, alternativeIndex) => {
    if (isBusy) return;
    const activeUser = messages[userIndex];
    const alternatives = activeUser?.branchAlternatives || [];
    const selected = alternatives[alternativeIndex];
    if (!selected?.messages?.length) return;
    const currentTail = stripBranchAlternatives(messages.slice(userIndex));
    const nextAlternatives = [
      ...alternatives.filter((_, index) => index !== alternativeIndex),
      { id: `alternative_${Date.now()}`, label: "Alternate response", messages: currentTail },
    ];
    const selectedTail = selected.messages.map((message, index) => index === 0
      ? { ...message, branchGroupId: activeUser.branchGroupId, branchAlternatives: nextAlternatives }
      : message);
    const nextMessages = [...messages.slice(0, userIndex), ...selectedTail];
    setMessages(nextMessages);
    if (activeConversationId) saveConversationState(activeConversationId, nextMessages, selectedModel);
  };

  const handleClearChat = () => {
    setMessages([]);
    setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    if (activeConversationId) {
      saveConversationState(activeConversationId, [], selectedModel);
    }
  };

  return (
    <div className="text-chat-layout" style={{ display: "flex", height: "100%", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      <section className="text-chat-main" style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
        {/* ─── Header ─────────────────────────────────────────── */}
        <div className="text-chat-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="m3-btn m3-btn-tonal"
              style={{
                height: "34px", width: "34px", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "var(--md-shape-corner-medium)", cursor: "pointer",
                background: showHistory ? "var(--md-sys-color-primary-container)" : "var(--md-sys-color-surface-variant)",
                color: showHistory ? "var(--md-sys-color-on-primary-container)" : "var(--md-sys-color-on-surface)",
                border: "1px solid var(--border-color)", flexShrink: 0
              }}
              title="Toggle Chat History"
            >
              <History size={17} />
            </button>

            <button
              onClick={handleNewChat}
              className="m3-btn m3-btn-tonal"
              style={{
                height: "34px", width: "34px", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "var(--md-shape-corner-medium)", cursor: "pointer",
                background: "var(--md-sys-color-surface-variant)",
                color: "var(--md-sys-color-on-surface)",
                border: "1px solid var(--border-color)", flexShrink: 0
              }}
              title="Start New Chat"
              disabled={isBusy}
            >
              <Plus size={17} />
            </button>

            <div ref={modelMenuRef} style={{ position: "relative", display: "inline-block", flex: "0 1 280px", maxWidth: "280px", width: "100%" }}>
              <button
                onClick={() => !isBusy && setShowModelMenu(!showModelMenu)}
                className={`chat-model-select-trigger ${showModelMenu ? "active" : ""}`}
                disabled={isBusy}
                title="Select GGUF Model"
              >
                <span className="chat-model-select-label">
                  {selectedModel ? selectedModel : "No model loaded (Select GGUF)"}
                </span>
                <ChevronDown size={14} className={`chat-model-select-arrow ${showModelMenu ? "open" : ""}`} />
              </button>

              {showModelMenu && (
                <div className="chat-model-dropdown-menu">
                  <button
                    className={`chat-model-dropdown-item ${!selectedModel ? "selected" : ""}`}
                    onClick={() => {
                      handleModelChange("");
                      setShowModelMenu(false);
                    }}
                  >
                    No model loaded (Select GGUF)
                  </button>
                  {models.map((m) => {
                    const isActive = m.filename === status.settings?.model && status.ready;
                    const isSelected = m.filename === selectedModel;
                    return (
                      <button
                        key={m.filename}
                        className={`chat-model-dropdown-item ${isSelected ? "selected" : ""} ${isActive ? "active" : ""}`}
                        onClick={() => {
                          handleModelChange(m.filename);
                          setShowModelMenu(false);
                        }}
                        title={m.filename}
                      >
                        <span className="chat-model-name-text">{m.filename}</span>
                        {isActive && <span className="chat-model-active-badge">Active</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {selectedModel && (!status.ready || status.settings?.model !== selectedModel) && !loadingModel && (
              <button
                className="m3-btn m3-btn-filled"
                onClick={() => handleModelChange(selectedModel)}
                disabled={isBusy}
                style={{
                  height: "38px", padding: "0 16px", fontSize: "0.85rem",
                  borderRadius: "var(--md-shape-corner-medium)",
                  background: "var(--md-sys-color-primary)",
                  color: "var(--md-sys-color-on-primary)",
                  cursor: "pointer", border: "none", fontWeight: "600",
                  display: "flex", alignItems: "center", gap: "6px"
                }}
              >
                Load Model
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
            <button type="button" className="m3-btn m3-btn-outlined" onClick={() => setShowMessageSearch((open) => !open)} aria-pressed={showMessageSearch} title="Search chats" style={{ height: "32px", padding: "0 9px" }}><Search size={16} /></button>
            {assistantMode === "work" && (
              <>
                <button type="button" className="m3-btn m3-btn-outlined" onClick={() => setShowProjectMemory((open) => !open)} aria-pressed={showProjectMemory} title="Project Memory and checkpoints" style={{ height: "32px", padding: "0 9px" }}><Brain size={16} /></button>
                <button type="button" className="m3-btn m3-btn-outlined" onClick={() => setShowBottomTerminal((open) => !open)} aria-pressed={showBottomTerminal} title="Toggle bottom Terminal" style={{ height: "32px", padding: "0 9px" }}><PanelBottom size={16} /></button>
                <button type="button" className="m3-btn m3-btn-outlined" onClick={() => setShowWorkTools((open) => !open)} aria-pressed={showWorkTools} title="Toggle Work tools" style={{ height: "32px", padding: "0 9px" }}><PanelRight size={16} /></button>
              </>
            )}
            <button
              className="m3-btn m3-btn-outlined"
              style={{ height: "32px", padding: "0 10px", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", borderRadius: "var(--md-shape-corner-medium)" }}
              onClick={handleClearChat}
              disabled={messages.length === 0}
            >
              <Trash2 size={14} />
              <span>Delete history</span>
            </button>
          </div>
        </div>

        {showMessageSearch && (
          <div className="chat-message-search" role="search">
            <Search size={15} />
            <input autoFocus value={messageSearchQuery} onChange={(event) => { setMessageSearchQuery(event.target.value); setMessageSearchIndex(0); }} onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); moveMessageSearch(event.shiftKey ? -1 : 1); }
              if (event.key === "Escape") setShowMessageSearch(false);
            }} placeholder={activeProject?.id ? `Search ${activeProject.name} chats…` : "Search all chats…"} aria-label="Search chat messages" />
            <span>{messageSearchResults.length ? `${messageSearchIndex + 1} / ${messageSearchResults.length}` : "No results"}</span>
            <button type="button" onClick={() => moveMessageSearch(-1)} disabled={!messageSearchResults.length} aria-label="Previous search result"><ChevronLeft size={15} /></button>
            <button type="button" onClick={() => moveMessageSearch(1)} disabled={!messageSearchResults.length} aria-label="Next search result"><ChevronRight size={15} /></button>
            <button type="button" onClick={() => { setShowMessageSearch(false); setMessageSearchQuery(""); }} aria-label="Close chat search"><X size={15} /></button>
            {activeSearchResult && <small title={activeSearchResult.text}>{activeSearchResult.conversationTitle} · {activeSearchResult.role === "user" ? "You" : "LUKE AI"}</small>}
          </div>
        )}

        {/* ─── Messages area ──────────────────────────────────── */}
        <div
          ref={chatMessagesRef}
          className="chat-messages"
          onScroll={(event) => {
            if (!isBusy) return;
            const container = event.currentTarget;
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            followGenerationRef.current = distanceFromBottom <= 80;
          }}
        >
          {loadingModel ? (
            <div className="chat-empty" style={{ maxWidth: "480px", margin: "auto", textAlign: "center", padding: "60px 20px" }}>
              <LoaderCircle className="progress-spinner" size={48} style={{ color: "var(--md-sys-color-primary)", marginBottom: "16px" }} />
              <h3 style={{ fontWeight: 600, fontSize: "1.25rem", marginBottom: "8px", color: "var(--md-sys-color-on-surface)" }}>Loading Text Model</h3>
              <code style={{
                display: "block", background: "var(--md-sys-color-surface-variant)",
                color: "var(--md-sys-color-on-surface-variant)", padding: "8px 12px",
                borderRadius: "6px", fontSize: "0.85rem", marginBottom: "20px",
                wordBreak: "break-all", fontFamily: "monospace"
              }}>
                {loadingModel}
              </code>
              <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-outline)", lineHeight: 1.5, marginBottom: "24px" }}>
                Initializing llama.cpp server and loading the model weights into memory. This can take up to 30 seconds depending on model size and hardware speed.
              </p>
              <button className="m3-btn m3-btn-error" onClick={handleCancelLlmLoad}
                style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 16px", fontSize: "0.85rem", borderRadius: "var(--md-shape-corner-medium)" }}
              >
                <Square size={14} fill="currentColor" />
                <span>Cancel Load</span>
              </button>
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <div className="chat-empty">
                  <div className="chat-empty-icon">
                    <Bot size={30} />
                  </div>
                  <h3>LUKE AI Chat</h3>
                  <p>Your private, offline AI assistant. Choose a GGUF model above and start a conversation — everything stays on your machine.</p>
                  {status.ready && (
                    <div className="chat-suggestions">
                      {[
                        { icon: "✍️", text: "Write a professional email to reschedule a meeting" },
                        { icon: "💡", text: "Explain how transformers work in simple terms" },
                        { icon: "🐛", text: "Help me debug this Python code" },
                        { icon: "📋", text: "Summarize the key points of a topic" },
                      ].map((s, i) => (
                        <button
                          key={i}
                          className="chat-suggestion-chip"
                          onClick={() => fillComposer(s.text)}
                        >
                          <span style={{ fontSize: "1rem", flexShrink: 0 }}>{s.icon}</span>
                          <span>{s.text}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {messages.map((message, index) => {
                const processed = processMessageContent(
                  Array.isArray(message.content) ? "" : (message.content || ""),
                  message.reasoning || "",
                  deepThinkEnabled
                );
                const displayContent = Array.isArray(message.content) ? message.content : processed.content;
                const displayReasoning = processed.reasoning;
                const hasDisplayContent = Array.isArray(displayContent)
                  ? displayContent.length > 0
                  : Boolean(String(displayContent || "").trim());

                return (
                  <div
                    key={`${message.role}-${index}`}
                    id={`chat-message-${index}`}
                    className={`chat-message-row ${message.role === "user" ? "user" : "ai"}${isBusy && index === messages.length - 1 && message.role === "assistant" ? " streaming" : ""}`}
                  >
                    {/* Avatar */}
                    <div className={`chat-avatar ${message.role === "user" ? "user" : "ai"}`}>
                      {message.role === "user" ? "You" : "AI"}
                    </div>

                    {/* Bubble + stats */}
                    <div className="chat-bubble-wrap">
                      <span className="chat-sender-label">
                        {message.role === "user" ? "You" : "LUKE AI"}
                      </span>
                      {message.role === "assistant" && displayReasoning && deepThinkEnabled && (
                        <ThinkingBlock
                          reasoning={displayReasoning}
                          thinkingDuration={message.thinkingDuration}
                          isComplete={!message.generationStats || message.generationStats.status === "complete"}
                        />
                      )}
                      {(hasDisplayContent || message.error) && (
                        <div className={`chat-bubble ${message.error ? "error" : ""}`}>
                          {Array.isArray(displayContent) ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              {displayContent.map((item, idx) => {
                                if (item.type === "text") return <MarkdownRenderer key={idx} content={item.text} workMode={assistantMode === "work"} onSendToTerminal={sendCodeToTerminal} />;
                                if (item.type === "image_url") return (
                                  <img key={idx} src={item.image_url.url} alt="Attached image"
                                    style={{ maxWidth: "240px", maxHeight: "180px", objectFit: "contain", borderRadius: "8px", marginTop: "4px" }}
                                  />
                                );
                                return null;
                              })}
                            </div>
                          ) : (
                            <MarkdownRenderer content={displayContent} workMode={assistantMode === "work"} onSendToTerminal={sendCodeToTerminal} />
                          )}
                        </div>
                      )}
                      {message.role === "user" && Array.isArray(message.ragSources) && message.ragSources.length > 0 && (
                        <details className="chat-rag-sources">
                          <summary><Search size={13} /> Project sources used <span>{message.ragSources.length}</span></summary>
                          <div>{message.ragSources.map((source, sourceIndex) => <button type="button" key={`${source.root}-${source.path}-${source.start}`} onClick={() => { setRequestedWorkFile({ ...source, requestId: Date.now() }); setShowWorkTools(true); }} title={`Open ${source.path} in Work Files`}><code>{sourceIndex + 1}</code><span>{source.path}</span><small>{source.start}–{source.end} · score {source.score}</small></button>)}</div>
                        </details>
                      )}
                      {message.role === "assistant" && hasDisplayContent && (
                        <div className="chat-message-actions">
                          <CopyContentButton value={Array.isArray(displayContent) ? displayContent.map((item) => item?.text || "").join("\n") : displayContent} label="Copy response" />
                          <button type="button" className="chat-copy-button" disabled={isBusy} onClick={() => retryFromUserMessage(index - 1)} aria-label="Retry response"><RefreshCw size={14} /><span>Retry</span></button>
                          {messages[index - 1]?.role === "user" && (messages[index - 1].branchAlternatives || []).length > 0 && (
                            <div className="chat-branch-switcher" aria-label="Response branches">
                              <button type="button" disabled={isBusy} onClick={() => switchMessageBranch(index - 1, 0)} aria-label="Previous response branch"><ChevronLeft size={14} /></button>
                              <span>{(messages[index - 1].branchAlternatives || []).length + 1} branches</span>
                              <button type="button" disabled={isBusy} onClick={() => switchMessageBranch(index - 1, 0)} aria-label="Next response branch"><ChevronRight size={14} /></button>
                            </div>
                          )}
                        </div>
                      )}
                      {message.role === "user" && hasDisplayContent && (
                        <div className="chat-message-actions"><button type="button" className="chat-copy-button" disabled={isBusy} onClick={() => editAndRetryUserMessage(index)} aria-label="Edit message and retry"><Pencil size={14} /><span>Edit</span></button></div>
                      )}
                      {message.role === "assistant" && Array.isArray(message.webSources) && message.webSources.length > 0 && (
                        <div style={{
                          marginTop: "8px",
                          padding: "10px 12px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          background: "var(--md-sys-color-surface-container)",
                          fontSize: "0.8rem",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, marginBottom: "6px" }}>
                            <Globe2 size={13} />
                            <span>Sources</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                            {message.webSources.map((source, sourceIndex) => (
                              <a
                                key={`${source.url}-${sourceIndex}`}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "var(--md-sys-color-primary)", textDecoration: "none", overflowWrap: "anywhere" }}
                              >
                                [{source.index || sourceIndex + 1}] {source.title || source.url}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Generation stats pill */}
                      {message.role === "assistant" && message.generationStats && !message.error && (
                        <>
                          {message.generationStats.truncated && (
                            <div className="chat-generation-warning">
                              Response reached the token limit. Ask "continue" or switch Max Response Tokens to Manual for a larger cap.
                            </div>
                          )}
                          <div className={`chat-generation-stats ${message.generationStats.status}`}>
                          {message.generationStats.status === "starting" ? (
                            <><LoaderCircle size={11} className="progress-spinner" /> {message.generationStats.web ? "Searching web..." : message.generationStats.vision ? "Processing image..." : "Waiting for first token..."}</>
                          ) : message.generationStats.status === "streaming" ? (
                            <><span style={{ opacity: 0.7 }}>⚡</span> {message.generationStats.tokensPerSecond.toFixed(1)} tok/s</>
                          ) : (
                            <>{message.generationStats.tokens} tokens <span style={{ opacity: 0.5 }}>•</span> {formatGenerationTime(message.generationStats.seconds)}</>
                          )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* ─── Composer ───────────────────────────────────────── */}
        <div className="chat-composer" onDragOver={(event) => { if (event.dataTransfer?.types?.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (!event.dataTransfer?.files?.length) return; event.preventDefault(); addAttachmentFiles(event.dataTransfer.files); }}>
          {messageQueue.length > 0 && (
            <div className="chat-message-queue" aria-label="Queued messages" aria-live="polite">
              <div className="chat-message-queue-heading"><strong>Next messages</strong><span>{messageQueue.length} queued{messageQueuePaused ? " · Paused after recovery" : ""}{messageQueuePaused && <button type="button" onClick={() => setMessageQueuePaused(false)} aria-label="Resume recovered queued messages" style={{ marginLeft: 8, padding: "4px 8px", border: "1px solid var(--border-color)", borderRadius: 7, background: "transparent", color: "inherit", cursor: "pointer" }}>Resume</button>}</span></div>
              {messageQueue.map((item, index) => (
                <div className="chat-message-queue-item" key={item.id}>
                  <span className="chat-message-queue-number">{index + 1}</span>
                  <input value={item.text} aria-label={`Edit queued message ${index + 1}`} onChange={(event) => setMessageQueue((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate))} />
                  <button type="button" onClick={() => setMessageQueue((current) => {
                    if (index === 0) return current;
                    const next = [...current];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    return next;
                  })} disabled={index === 0} aria-label={`Move queued message ${index + 1} up`}><ArrowUp size={14} /></button>
                  <button type="button" onClick={() => setMessageQueue((current) => {
                    if (index >= current.length - 1) return current;
                    const next = [...current];
                    [next[index], next[index + 1]] = [next[index + 1], next[index]];
                    return next;
                  })} disabled={index === messageQueue.length - 1} aria-label={`Move queued message ${index + 1} down`}><ArrowDown size={14} /></button>
                  <button type="button" onClick={() => setMessageQueue((current) => current.filter((candidate) => candidate.id !== item.id))} aria-label={`Remove queued message ${index + 1}`}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingBottom: "10px" }}>
              {attachments.map((att) => (
                <div key={att.id} style={{
                  position: "relative", display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 28px 6px 8px",
                  background: "var(--md-sys-color-surface-variant)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px", fontSize: "0.8rem", maxWidth: "200px"
                }}>
                  {att.type === "image" ? (
                    <img src={att.dataUrl} alt={att.name} style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "3px" }} />
                  ) : att.type === "audio" ? (
                    <LoaderCircle size={17} className="spin" aria-label="Transcribing audio" />
                  ) : (
                    <span style={{ fontWeight: 600 }}>{att.transcript ? "🎙️" : "📄"}</span>
                  )}
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--md-sys-color-on-surface-variant)" }} title={att.name}>
                    {att.name}{att.status === "transcribing" ? " · Transcribing…" : att.transcript ? " · Transcript ready" : ""}
                  </span>
                  <button
                    onClick={() => setAttachments(prev => prev.filter(item => item.id !== att.id))}
                    style={{
                      position: "absolute", right: "4px", top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "var(--md-sys-color-error)",
                      cursor: "pointer", padding: "2px", display: "flex", alignItems: "center", justifyContent: "center"
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input container with vertical layout */}
          <div className="chat-composer-inner">
            <div className="chat-composer-textarea-container">
              {composerAssist && (
                <div className="chat-model-dropdown-menu" style={{ top: "auto", bottom: "calc(100% + 6px)", minWidth: 0 }} role="listbox" aria-label="Composer commands and mentions">
                  {composerAssist === "/" && [["/search", "Search chats"], ["/new", "Start a new chat"], ...(assistantMode === "work" ? [["/memory", "Open Project Memory"], ["/checkpoint", "Save conversation checkpoint"]] : [])].map(([value, label]) => <button type="button" className="chat-model-dropdown-item" key={value} onClick={() => { fillComposer(value); setComposerAssist(""); }}><code>{value}</code><span>{label}</span></button>)}
                  {composerAssist === "@" && [["@project", activeProject?.name ? `Project: ${activeProject.name}` : "Current project"], ["@folder", activeProject?.sourceFolders?.[0] || "Project source folder"], ["@file", "Attach a local file"]].map(([value, label]) => <button type="button" className="chat-model-dropdown-item" key={value} onClick={() => {
                    if (value === "@file") { fileInputRef.current?.click(); setComposerAssist(""); return; }
                    if (value === "@folder" && activeProject?.sourceFolders?.[0]) insertComposerValue(`@folder(${activeProject.sourceFolders[0]})`);
                    else if (value === "@project" && activeProject?.name) insertComposerValue(`@project(${activeProject.name})`);
                    else insertComposerValue(value);
                  }}><code>{value}</code><span>{label}</span></button>)}
                </div>
              )}
              <textarea
                key={draftStorageKey}
                ref={textareaRef}
                className="chat-composer-textarea"
                defaultValue={readChatDraft(draftStorageKey)}
                onInput={(event) => { const value = event.currentTarget.value; updateComposerDraft(value); setComposerAssist(value.match(/(?:^|\s)([@/])[^\s]*$/)?.[1] || ""); }}
                onPaste={(event) => { const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); addAttachmentFiles(files); } }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={status.ready ? (assistantMode === "work" ? "What should we work on? (Shift+Enter for new line)" : "Message your local model... (Shift+Enter for new line)") : "Select and load a GGUF model above to begin"}
                disabled={!status.ready}
                rows={1}
              />
            </div>

            <div className="chat-composer-toolbar">
              <div className="chat-composer-toolbar-left">
                <input type="file" ref={fileInputRef} style={{ display: "none" }} multiple accept="image/jpeg,image/png,image/webp,audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/webm,audio/flac,.wav,.mp3,.m4a,.aac,.ogg,.webm,.flac,.pdf,.doc,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.log,.rtf,.tex,.diff,.patch,.properties,.conf,.cfg,.js,.jsx,.ts,.tsx,.py,.json,.jsonl,.css,.scss,.html,.java,.cpp,.c,.h,.rs,.go,.sh,.bat,.ps1,.xml,.yaml,.yml,.toml,.ini,.env,.sql,.vue,.svelte,.php,.rb,.swift,.kt,.gradle,.cmake" onChange={handleFileChange} />
                <button
                  className="chat-composer-attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!status.ready}
                  title={supportsVision ? "Attach, paste, or drop files, images, and audio" : "Attach audio, text, code, or XLSX files. Images require a vision model."}
                >
                  <Paperclip size={17} />
                </button>
                <button
                  className={`chat-composer-deepthink-btn web-search-btn ${useWebSearch ? "active" : ""}`}
                  onClick={() => setUseWebSearch((value) => !value)}
                  disabled={!status.ready}
                  title={useWebSearch ? "Disable web search" : "Enable web search"}
                >
                  <Globe2 size={14} />
                  <span>Web</span>
                </button>

                {status.ready && supportsThinking && (
                  <button
                    className={`chat-composer-deepthink-btn deepthink-btn ${deepThinkEnabled ? "active" : ""}`}
                    onClick={handleThinkingToggle}
                    title={deepThinkEnabled ? "Disable DeepThink reasoning" : "Enable DeepThink reasoning"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={deepThinkEnabled ? "rotate-anim" : ""}>
                      <circle cx="12" cy="12" r="3" />
                      <ellipse cx="12" cy="12" rx="3" ry="9" />
                      <ellipse cx="12" cy="12" rx="9" ry="3" />
                    </svg>
                    <span>DeepThink</span>
                  </button>
                )}
                {assistantMode === "work" && (
                  <div className="work-approval-selector" ref={approvalMenuRef}>
                    <button type="button" className="work-approval-trigger" onClick={() => setShowApprovalMenu((open) => !open)} aria-expanded={showApprovalMenu} aria-haspopup="menu">
                      {approvalMode === "ask" ? <Hand size={14} /> : approvalMode === "full" ? <ShieldAlert size={14} /> : approvalMode === "custom" ? <Settings2 size={14} /> : <ShieldCheck size={14} />}
                      <span>{{ ask: "Ask for approval", auto: "Approve for me", full: "Full Access", custom: "Custom" }[approvalMode]}</span>
                      <ChevronDown size={13} />
                    </button>
                    {showApprovalMenu && (
                      <div className="work-approval-menu" role="menu" aria-label="Work approval policy">
                        <div className="work-approval-heading"><span>How should Work actions be approved?</span></div>
                        {[
                          { id: "ask", icon: Hand, title: "Ask for approval", detail: "Ask before commands, external files, apps, and internet access" },
                          { id: "auto", icon: ShieldCheck, title: "Approve for me", detail: "Only ask for actions detected as potentially unsafe" },
                          { id: "full", icon: ShieldAlert, title: "Full Access", detail: "Broad access to project files, commands, and internet" },
                          { id: "custom", icon: Settings2, title: "Custom", detail: "Use permissions configured for this project" },
                        ].map((option) => {
                          const Icon = option.icon;
                          return (
                            <button type="button" role="menuitemradio" aria-checked={approvalMode === option.id} className={option.id === "full" ? "danger" : ""} key={option.id} onClick={() => {
                              if (option.id === "full" && !window.confirm("Full Access allows broad project-file, command, app, and network access. Enable it for this Work session?")) return;
                              setApprovalMode(option.id);
                              setShowApprovalMenu(false);
                            }}>
                              <Icon size={18} />
                              <span><b>{option.title}</b><small>{option.detail}</small></span>
                              {approvalMode === option.id && <Check size={17} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="chat-composer-toolbar-right">
                {isBusy && status.ready && (
                  <button className="chat-composer-stop-btn" onClick={handleStopGeneration} title="Stop generation">
                    <Square size={15} fill="currentColor" />
                  </button>
                )}
                <button
                  className="chat-composer-send-btn"
                  onClick={() => void sendMessage()}
                  disabled={(!draftAvailable && attachments.length === 0) || !status.ready || attachments.some((attachment) => attachment.status === "transcribing")}
                  title={attachments.some((attachment) => attachment.status === "transcribing") ? "Wait for audio transcription" : isBusy ? "Add message to queue" : "Send message"}
                >
                  <Send size={17} />
                </button>
              </div>
            </div>
          </div>
          <div className="chat-composer-hint">Enter to send &nbsp;·&nbsp; Shift+Enter for new line</div>
        </div>
        {assistantMode === "work" && showBottomTerminal && <WorkTerminalDock project={activeProject} onClose={() => setShowBottomTerminal(false)} />}
      </section>
      {assistantMode === "work" && showWorkTools && <WorkToolsPanel project={activeProject} approvalMode={approvalMode} requestedFile={requestedWorkFile} onClose={() => setShowWorkTools(false)} />}
      {assistantMode === "work" && showProjectMemory && <ProjectMemoryPanel project={activeProject} messages={messages} onRestore={(checkpoint) => { setMessages(checkpoint.messages); if (activeConversationId) saveConversationState(activeConversationId, checkpoint.messages, selectedModel); }} onClose={() => setShowProjectMemory(false)} />}
    </div>
  );
}
function parseInlineMarkdown(text) {
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*|\[.*?\]\(.*?\))/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={idx} style={{ 
        fontFamily: "monospace", 
        background: "var(--md-sys-color-surface-variant)", 
        padding: "2px 4px", 
        borderRadius: "4px",
        fontSize: "0.85rem"
      }}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={idx} style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("[") && part.includes("](") && part.endsWith(")")) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        return (
          <a key={idx} href={match[2]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--md-sys-color-primary)", textDecoration: "underline" }}>
            {match[1]}
          </a>
        );
      }
    }
    return part;
  });
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, workMode = false, onSendToTerminal }) {
  if (typeof content !== 'string') return null;

  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-body" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {parts.map((part, index) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1] : "";
          const code = match ? match[2] : part.slice(3, -3);
          return (
            <div className="chat-code-block" key={index}>
              <div className="chat-code-header">
                <span>{lang || "Code"}</span>
                <span style={{ display: "inline-flex", gap: 6 }}><CopyContentButton value={code.trim()} label="Copy code" />{workMode && onSendToTerminal && <button type="button" className="chat-copy-button" onClick={() => onSendToTerminal(code.trim())} aria-label="Send code to Work Terminal"><PanelBottom size={14} /><span>Terminal</span></button>}</span>
              </div>
              <pre style={{
              background: "var(--md-sys-color-surface-variant)", 
              color: "var(--md-sys-color-on-surface-variant)",
              padding: "12px", 
              borderRadius: "6px", 
              fontFamily: "monospace", 
              fontSize: "0.85rem",
              overflowX: "auto",
              margin: 0,
              border: "1px solid var(--border-color)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all"
            }}>
              <code>{code.trim()}</code>
            </pre>
            </div>
          );
        } else {
          const rawLines = part.split(/\r?\n/);
          const blocks = [];
          let currentBlock = null;

          for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith("### ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h4", content: trimmed.slice(4) });
            } else if (trimmed.startsWith("## ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h3", content: trimmed.slice(3) });
            } else if (trimmed.startsWith("# ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h2", content: trimmed.slice(2) });
            } else if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
              const itemContent = trimmed.slice(2);
              if (currentBlock && currentBlock.type === "ul") {
                currentBlock.items.push(itemContent);
              } else {
                if (currentBlock) { blocks.push(currentBlock); }
                currentBlock = { type: "ul", items: [itemContent] };
              }
            } else {
              const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
              if (numMatch) {
                const itemContent = numMatch[2];
                if (currentBlock && currentBlock.type === "ol") {
                  currentBlock.items.push(itemContent);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "ol", items: [itemContent] };
                }
              } else if (trimmed === "") {
                if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
                blocks.push({ type: "spacer" });
              } else {
                if (currentBlock && currentBlock.type === "p") {
                  currentBlock.lines.push(line);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "p", lines: [line] };
                }
              }
            }
          }
          if (currentBlock) {
            blocks.push(currentBlock);
          }

          return blocks.map((block, blockIdx) => {
            switch (block.type) {
              case "h4":
                return <h4 key={blockIdx} style={{ fontSize: "1.05rem", fontWeight: 700, margin: "10px 0 4px 0", color: "var(--md-sys-color-primary)" }}>{parseInlineMarkdown(block.content)}</h4>;
              case "h3":
                return <h3 key={blockIdx} style={{ fontSize: "1.2rem", fontWeight: 700, margin: "14px 0 6px 0", color: "var(--md-sys-color-primary)" }}>{parseInlineMarkdown(block.content)}</h3>;
              case "h2":
                return <h2 key={blockIdx} style={{ fontSize: "1.35rem", fontWeight: 700, margin: "18px 0 8px 0", color: "var(--md-sys-color-primary)" }}>{parseInlineMarkdown(block.content)}</h2>;
              case "ul":
                return (
                  <ul key={blockIdx} style={{ margin: "6px 0 6px 24px", padding: 0, listStyleType: "disc", display: "block" }}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx} style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "4px", display: "list-item" }}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ul>
                );
              case "ol":
                return (
                  <ol key={blockIdx} style={{ margin: "6px 0 6px 24px", padding: 0, listStyleType: "decimal", display: "block" }}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx} style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "4px", display: "list-item" }}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ol>
                );
              case "spacer":
                return <div key={blockIdx} style={{ height: "6px" }} />;
              case "p":
                return <p key={blockIdx} style={{ margin: "2px 0", fontSize: "0.9rem", lineHeight: 1.5 }}>{parseInlineMarkdown(block.lines.join(" "))}</p>;
              default:
                return null;
            }
          });
        }
      })}
    </div>
  );
});

export default TextChat;
