"use strict";

/**
 * Content-part translation between the three wire shapes LUKE can speak.
 *
 * TextChat stores attachments as OpenAI-style `content` arrays
 * (`{ type: "text" }`, `{ type: "image_url", image_url: { url } }`). The old
 * chain filtered on `typeof content === "string"`, so a picture attached to a
 * chat turn vanished without a word. That is the bug this file exists to fix.
 *
 * Nothing here fetches a URL. Remote images are refused: a cloud provider
 * must never be handed an internal loopback address or asked to fetch a file
 * off this machine. Only inline data: URLs are forwarded, capped in size.
 */

const MAX_PARTS = 8;
const MAX_INLINE_BASE64 = 8 * 1024 * 1024;
const IMAGE_PLACEHOLDER = "[Attached image omitted: this provider takes text only]";

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") return String(part.text || "");
      if (part.type === "input_text") return String(part.text || "");
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function dataUrlInfo(url) {
  const match = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ""));
  if (!match) return null;
  if (match[2].length > MAX_INLINE_BASE64) return null;
  return { mediaType: match[1], data: match[2] };
}

/** OpenAI Chat Completions / OpenAI-compatible Gemini and Mistral. */
function openAiParts(rawParts) {
  return rawParts.map((part) => {
    if (part.type === "text" || part.type === "input_text") {
      return { type: "text", text: String(part.text || "") };
    }
    const url = String(part?.image_url?.url || part?.url || "");
    const inline = dataUrlInfo(url);
    if (inline) return { type: "image_url", image_url: { url } };
    return { type: "text", text: IMAGE_PLACEHOLDER };
  });
}

/** Anthropic Messages (the Free Claude Code bridge). */
function anthropicParts(rawParts) {
  return rawParts.map((part) => {
    if (part.type === "text" || part.type === "input_text") {
      return { type: "text", text: String(part.text || "") };
    }
    const url = String(part?.image_url?.url || part?.url || "");
    const inline = dataUrlInfo(url);
    if (inline) {
      return {
        type: "image",
        source: { type: "base64", media_type: inline.mediaType, data: inline.data },
      };
    }
    return { type: "text", text: IMAGE_PLACEHOLDER };
  });
}

/** Gemini generateContent parts, for a future native adapter. */
function geminiParts(rawParts) {
  return rawParts.map((part) => {
    if (part.type === "text" || part.type === "input_text") {
      return { text: String(part.text || "") };
    }
    const url = String(part?.image_url?.url || part?.url || "");
    const inline = dataUrlInfo(url);
    if (inline) return { inline_data: { mime_type: inline.mediaType, data: inline.data } };
    return { text: IMAGE_PLACEHOLDER };
  });
}

function rawParts(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];

  return content.slice(0, MAX_PARTS).map((part) => {
    if (typeof part === "string") return { type: "text", text: part };
    if (!part || typeof part !== "object") return { type: "text", text: "" };

    // Anthropic-shaped input, if a caller ever hands one in.
    if (part.type === "image" && part?.source?.type === "base64") {
      return {
        type: "image_url",
        image_url: {
          url: `data:${String(part.source.media_type || "image/png")};base64,${String(part.source.data || "")}`,
        },
      };
    }
    if (part.inline_data) {
      return {
        type: "image_url",
        image_url: {
          url: `data:${String(part.inline_data.mime_type || "image/png")};base64,${String(part.inline_data.data || "")}`,
        },
      };
    }
    return part;
  });
}

/**
 * Normalize one message's content for a given wire format.
 * `allowedModalities` is the provider's own list from the catalogue: a text-only
 * link gets a placeholder instead of silently dropping the whole turn.
 */
function normalizeContentParts(content, apiFormat = "openai-chat", options = {}) {
  const allowed = Array.isArray(options.allowedModalities) && options.allowedModalities.length
    ? options.allowedModalities
    : ["text"];
  const allowImage = allowed.includes("image") || allowed.includes("pdf") || allowed.includes("video");

  const parts = rawParts(content);
  const prepared = allowImage ? parts : parts.map((part) => (
    part.type === "image_url" ? { type: "text", text: IMAGE_PLACEHOLDER } : part
  ));

  if (apiFormat === "anthropic-messages") {
    const translated = anthropicParts(prepared);
    return translated.length === 1 && translated[0].type === "text"
      ? translated[0].text
      : translated;
  }

  if (apiFormat === "gemini-generate") return geminiParts(prepared);

  const translated = openAiParts(prepared);
  return translated.length === 1 && translated[0].type === "text"
    ? translated[0].text
    : translated;
}

/** Merge two adjacent same-role turns without losing attached parts. */
function mergeContent(previous, next, apiFormat = "openai-chat", options = {}) {
  const a = normalizeContentParts(previous, apiFormat, options);
  const b = normalizeContentParts(next, apiFormat, options);

  if (typeof a === "string" && typeof b === "string") return `${a}\n\n${b}`;
  const partsA = Array.isArray(a) ? a : [{ type: "text", text: a }];
  const partsB = Array.isArray(b) ? b : [{ type: "text", text: b }];
  return [...partsA, ...partsB].slice(0, MAX_PARTS * 2);
}

module.exports = {
  MAX_PARTS,
  MAX_INLINE_BASE64,
  IMAGE_PLACEHOLDER,
  textOf,
  rawParts,
  normalizeContentParts,
  mergeContent,
  openAiParts,
  anthropicParts,
  geminiParts,
};
