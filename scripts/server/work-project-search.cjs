"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const SEARCHABLE_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".rtf", ".tex", ".diff", ".patch",
  ".json", ".jsonl", ".xml", ".yaml", ".yml", ".toml", ".ini", ".env", ".properties", ".conf", ".cfg",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".css", ".scss", ".html", ".java", ".cpp", ".c", ".h",
  ".rs", ".go", ".sh", ".bat", ".ps1", ".sql", ".vue", ".svelte", ".php", ".rb", ".swift", ".kt",
  ".gradle", ".cmake",
]);
const SEARCHABLE_NAMES = new Set(["dockerfile", "makefile"]);
const SEARCHABLE_DOCUMENTS = new Set([".pdf", ".doc", ".docx", ".pptx", ".xlsx"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".cache", "coverage", "vendor"]);
const MAX_FILES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 250;
const CACHE_TTL_MS = 30_000;
const indexCache = new Map();

async function extractProjectDocument(buffer, extension) {
  if (extension === ".pptx") {
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((left, right) => Number(left.match(/slide(\d+)/i)?.[1]) - Number(right.match(/slide(\d+)/i)?.[1]))
      .slice(0, 500);
    const decodeXml = (value) => value.replace(/&#(x?[\da-f]+);|&(amp|lt|gt|quot|apos);/gi, (match, numeric, named) => {
      if (numeric) return String.fromCodePoint(Number.parseInt(numeric.replace(/^x/i, ""), /^x/i.test(numeric) ? 16 : 10));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()];
    });
    const output = [];
    let characters = 0;
    for (const [index, name] of slides.entries()) {
      const xml = await zip.file(name).async("string");
      const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi)].map((match) => decodeXml(match[1]).trim()).filter(Boolean).join("\n");
      if (text) {
        const section = `[Slide ${index + 1}]\n${text}`;
        output.push(section);
        characters += section.length;
        if (characters >= 2_000_000) break;
      }
    }
    return output.join("\n\n").trim();
  }
  if (extension === ".xlsx") {
    const readXlsxFile = require("read-excel-file/node").default;
    const sheets = await readXlsxFile(buffer);
    const output = [];
    for (const sheet of sheets.slice(0, 50)) {
      output.push(`[Sheet: ${sheet.sheet}]\n${sheet.data.map((row) => row.map((cell) => String(cell ?? "").replace(/\t|\r?\n/g, " ")).join("\t")).join("\n")}`);
    }
    return output.join("\n\n").trim();
  }
  if (extension === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return String(result.value || "").trim();
  }
  if (extension === ".pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: new Uint8Array(buffer), disableWorker: true });
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
  if (extension === ".doc") {
    const ascii = buffer.toString("latin1").match(/[\x20-\x7E\xA0-\xFF]{4,}/g) || [];
    const utf16 = new TextDecoder("utf-16le").decode(buffer).match(/[\p{L}\p{N}\p{P}\p{Zs}]{4,}/gu) || [];
    return [...utf16, ...ascii].map((value) => value.replace(/\s+/g, " ").trim()).filter((value, index, values) => value && values.indexOf(value) === index).join("\n").trim();
  }
  return "";
}

function tokenize(value) {
  const words = String(value || "").toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const tokens = new Set(words);
  for (const word of words) {
    if (word.length >= 5) for (let index = 0; index <= word.length - 3; index += 1) tokens.add(word.slice(index, index + 3));
  }
  return [...tokens];
}

function chunkText(content, filePath) {
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(content.length, start + CHUNK_CHARS);
    if (end < content.length) {
      const boundary = Math.max(content.lastIndexOf("\n", end), content.lastIndexOf(" ", end));
      if (boundary > start + CHUNK_CHARS / 2) end = boundary;
    }
    const text = content.slice(start, end).trim();
    if (text) chunks.push({ path: filePath, start, end, text, tokens: tokenize(`${filePath} ${text}`) });
    if (end >= content.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

async function buildProjectIndex(rootValue) {
  const root = await fs.realpath(path.resolve(String(rootValue)));
  const cached = indexCache.get(root);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached;
  const chunks = [];
  const queue = [root];
  let filesIndexed = 0;
  let bytesIndexed = 0;
  while (queue.length && filesIndexed < MAX_FILES && bytesIndexed < MAX_TOTAL_BYTES) {
    const directory = queue.shift();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") && entry.name !== ".env") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) queue.push(target);
        continue;
      }
      if (!entry.isFile() || filesIndexed >= MAX_FILES || bytesIndexed >= MAX_TOTAL_BYTES) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!SEARCHABLE_EXTENSIONS.has(extension) && !SEARCHABLE_DOCUMENTS.has(extension) && !SEARCHABLE_NAMES.has(entry.name.toLowerCase())) continue;
      const stats = await fs.stat(target).catch(() => null);
      const fileByteLimit = SEARCHABLE_DOCUMENTS.has(extension) ? MAX_DOCUMENT_BYTES : MAX_FILE_BYTES;
      if (!stats || stats.size > fileByteLimit || bytesIndexed + stats.size > MAX_TOTAL_BYTES) continue;
      const buffer = await fs.readFile(target).catch(() => null);
      if (!buffer) continue;
      let content = "";
      if (SEARCHABLE_DOCUMENTS.has(extension)) {
        content = await extractProjectDocument(buffer, extension).catch(() => "");
      } else {
        if (buffer.includes(0)) continue;
        content = buffer.toString("utf8");
      }
      if (!content) continue;
      const relativePath = path.relative(root, target).replace(/\\/g, "/");
      chunks.push(...chunkText(content, relativePath));
      filesIndexed += 1;
      bytesIndexed += stats.size;
    }
  }
  const index = { root, chunks, filesIndexed, bytesIndexed, createdAt: Date.now() };
  indexCache.set(root, index);
  return index;
}

async function searchProjectFiles({ root, query, limit = 8 }) {
  const terms = tokenize(query);
  if (!terms.length) return { root, query: String(query || ""), results: [], filesIndexed: 0, chunksIndexed: 0 };
  const index = await buildProjectIndex(root);
  const cappedLimit = Math.max(1, Math.min(12, Number(limit) || 8));
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  const ranked = index.chunks.map((chunk) => {
    const tokenSet = new Set(chunk.tokens);
    const normalizedText = chunk.text.toLocaleLowerCase();
    const normalizedPath = chunk.path.toLocaleLowerCase();
    let score = 0;
    for (const term of terms) {
      if (tokenSet.has(term)) score += term.length >= 5 ? 4 : 1;
      if (normalizedPath.includes(term)) score += 3;
    }
    if (normalizedQuery.length >= 4 && normalizedText.includes(normalizedQuery)) score += 20;
    if (normalizedQuery.length >= 4 && normalizedPath.includes(normalizedQuery)) score += 12;
    return { ...chunk, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const selected = [];
  const perFile = new Map();
  for (const item of ranked) {
    const sameFile = perFile.get(item.path) || [];
    if (sameFile.length >= 3 || sameFile.some((candidate) => Math.abs(candidate.start - item.start) < CHUNK_CHARS / 2)) continue;
    selected.push(item);
    sameFile.push(item);
    perFile.set(item.path, sameFile);
    if (selected.length >= cappedLimit) break;
  }
  const results = selected.map(({ tokens, ...item }) => item);
  return { root: index.root, query: String(query), results, filesIndexed: index.filesIndexed, chunksIndexed: index.chunks.length, indexedAt: new Date(index.createdAt).toISOString() };
}

async function invalidateProjectIndex(rootValue) {
  const root = await fs.realpath(path.resolve(String(rootValue)));
  return indexCache.delete(root);
}

module.exports = { buildProjectIndex, extractProjectDocument, invalidateProjectIndex, searchProjectFiles, tokenize, chunkText };
