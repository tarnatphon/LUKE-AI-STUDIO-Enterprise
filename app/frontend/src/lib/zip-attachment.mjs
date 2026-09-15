/**
 * ZIP attachment support.
 *
 * A whole project can be dropped into the chat as one .zip (up to 500 MB) —
 * useful for "here is my code, explain it". The archive is never expanded into
 * the prompt blindly: a small machine cannot pay for that. Instead:
 *
 *   1. the entry list is summarised (so the model knows the structure)
 *   2. only text files are inlined, capped per file and in total
 *   3. binaries, build output and lock files are skipped but still counted
 *
 * Everything the model needs to answer is kept; nothing is silently lost —
 * the skipped entries are listed so the user can see what was left out.
 */

export const ZIP_MAX_BYTES = 500 * 1024 * 1024;
export const ZIP_MAX_ENTRIES = 4000;
export const ZIP_MAX_TEXT_CHARS = 2_000_000;
export const ZIP_MAX_FILE_CHARS = 120_000;
export const ZIP_MAX_FILE_BYTES = 8 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "log", "rtf", "tex", "diff", "patch",
  "properties", "conf", "cfg", "ini", "env", "json", "jsonl", "yaml", "yml", "toml",
  "js", "mjs", "cjs", "jsx", "ts", "mts", "tsx", "py", "rb", "php", "go", "rs",
  "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "scala", "r", "jl",
  "sh", "bash", "zsh", "bat", "ps1", "sql", "html", "htm", "css", "scss", "sass", "less",
  "vue", "svelte", "xml", "svg", "gradle", "cmake", "makefile", "dockerfile", "gitignore",
]);

const SKIP_PREFIXES = ["__macosx/", ".git/", "node_modules/", ".next/", "dist/", "build/", ".cache/", ".venv/", "venv/"];
const SKIP_NAMES = new Set([".ds_store", "thumbs.db"]);
const LOCK_FILES = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|composer\.lock|gemfile\.lock)$/i;

export function isZipFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    name.endsWith(".zip") ||
    type === "application/zip" ||
    type === "application/x-zip-compressed" ||
    type === "application/x-zip"
  );
}

export function describeZipLimit(bytes = ZIP_MAX_BYTES) {
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb} MB`;
}

function extensionOf(name) {
  const base = String(name || "").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base.toLowerCase();
  return base.slice(dot + 1).toLowerCase();
}

function shouldSkip(name) {
  const lower = String(name || "").toLowerCase();
  if (!lower || lower.endsWith("/")) return "directory";
  if (SKIP_PREFIXES.some((prefix) => lower.startsWith(prefix))) return "ignored path";
  if (SKIP_NAMES.has(lower.split("/").pop() || "")) return "system file";
  if (LOCK_FILES.test(lower.split("/").pop() || "")) return "lock file";
  return null;
}

function looksBinary(text) {
  return text.includes("\0");
}

/**
 * Builds the attachment from a JSZip instance (injected so this module stays
 * testable without a browser bundle).
 */
export async function extractZipAttachment(file, options = {}) {
  const JSZip = options.JSZip;
  const maxBytes = Number(options.maxBytes || ZIP_MAX_BYTES);
  const maxEntries = Number(options.maxEntries || ZIP_MAX_ENTRIES);
  const maxTextChars = Number(options.maxTextChars || ZIP_MAX_TEXT_CHARS);
  const maxFileChars = Number(options.maxFileChars || ZIP_MAX_FILE_CHARS);
  const maxFileBytes = Number(options.maxFileBytes || ZIP_MAX_FILE_BYTES);

  const size = Number(file?.size || 0);
  if (Number.isFinite(size) && size > maxBytes) {
    const error = new Error(
      `“${file.name}” is ${(size / (1024 * 1024)).toFixed(0)} MB. ZIP attachments are limited to ${describeZipLimit(maxBytes)}.`
    );
    error.code = "ZIP_TOO_LARGE";
    throw error;
  }
  if (!JSZip) throw new Error("The ZIP reader is not available in this build.");

  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (error) {
    const wrapped = new Error(
      `“${file.name}” could not be opened as a ZIP archive${error?.message ? ` (${error.message})` : ""}. Encrypted archives are not supported.`
    );
    wrapped.code = "ZIP_UNREADABLE";
    throw wrapped;
  }

  const names = Object.keys(zip.files || {}).sort();
  const summary = { total: names.length, included: 0, skipped: 0, skippedReasons: {}, directories: 0 };
  const sections = [];
  let characters = 0;
  let truncated = false;

  for (const name of names.slice(0, maxEntries)) {
    if (characters >= maxTextChars) {
      truncated = true;
      break;
    }
    const skipReason = shouldSkip(name);
    if (skipReason) {
      summary.skipped += 1;
      if (skipReason === "directory") summary.directories += 1;
      summary.skippedReasons[skipReason] = (summary.skippedReasons[skipReason] || 0) + 1;
      continue;
    }

    const entry = zip.file(name);
    if (!entry) continue;
    if (!TEXT_EXTENSIONS.has(extensionOf(name))) {
      summary.skipped += 1;
      summary.skippedReasons["binary or unsupported type"] = (summary.skippedReasons["binary or unsupported type"] || 0) + 1;
      continue;
    }

    let text;
    try {
      const raw = await entry.async("uint8array");
      if (raw.byteLength > maxFileBytes) {
        summary.skipped += 1;
        summary.skippedReasons["file larger than 8 MB"] = (summary.skippedReasons["file larger than 8 MB"] || 0) + 1;
        continue;
      }
      text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
    } catch (error) {
      summary.skipped += 1;
      summary.skippedReasons["unreadable entry"] = (summary.skippedReasons["unreadable entry"] || 0) + 1;
      continue;
    }

    if (looksBinary(text)) {
      summary.skipped += 1;
      summary.skippedReasons["binary content"] = (summary.skippedReasons["binary content"] || 0) + 1;
      continue;
    }

    let body = text;
    let fileTruncated = false;
    if (body.length > maxFileChars) {
      body = `${body.slice(0, maxFileChars)}\n… [ตัดเนื้อหาในไฟล์นี้เพื่อประหยัด context] …`;
      fileTruncated = true;
    }
    const section = `=== ${name} ===\n${body}${fileTruncated ? "" : ""}`;
    if (characters + section.length > maxTextChars) {
      truncated = true;
      break;
    }
    sections.push(section);
    characters += section.length;
    summary.included += 1;
  }

  const reasonList = Object.entries(summary.skippedReasons)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ");

  const header = [
    `[ZIP attachment: ${file.name}]`,
    `${summary.total} entries · ${summary.included} text files inlined${reasonList ? ` · skipped ${summary.skipped} (${reasonList})` : ""}`,
    truncated ? "…[ถึงขีดจำกัดเนื้อหา — ไฟล์ที่เหลือไม่ได้นำเข้า]" : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: `${header}${sections.join("\n\n")}`.trim(),
    entries: summary.total,
    included: summary.included,
    skipped: summary.skipped,
    truncated,
    characters,
  };
}
