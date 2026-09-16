"use strict";

/**
 * Repository understanding for the Work agent.
 *
 * A 9B model cannot hold a codebase in its head, and it should not have to:
 * the map, the symbol table and the search index live here instead. The agent
 * asks "where is this defined", "who calls it", "show me every file that
 * imports this" and gets a short, exact answer instead of spending rounds
 * listing directories.
 *
 * Only the granted folder is ever walked. Nothing outside it is read, and no
 * file content leaves this machine.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { canonicaliseRoot, resolveInsideRoot, createHttpError } = require("./work-path-guard.cjs");

const MAX_FILES = 30000;
const MAX_WALK_MS = 20000;
const MAX_INDEX_FILE_BYTES = 512 * 1024;
const MAX_OUTLINE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 40;
const MAX_SNIPPET_CHARS = 240;
const MAX_MAP_CHARS = 9000;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".gradle",
  ".idea",
  ".vscode",
  ".cache",
  "coverage",
  ".tox",
  "Pods",
  ".terraform",
]);

const IGNORED_FILE_SUFFIXES = [".min.js", ".map", ".lock", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".pdf", ".zip", ".tar", ".gz", ".mp4", ".mov", ".mp3", ".wav", ".woff", ".woff2", ".ttf", ".eot", ".pyc", ".so", ".dylib", ".dll", ".exe", ".gguf", ".bin", ".onnx", ".pt", ".pth", ".safetensors"];

const LANGUAGE_BY_EXTENSION = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".scala": "scala",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".sql": "sql",
  ".html": "html",
  ".css": "css",
  ".scss": "css",
  ".vue": "vue",
  ".svelte": "svelte",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
};

const SYMBOL_PATTERNS = {
  javascript: [
    { kind: "class", regex: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/ },
    { kind: "function", regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/ },
    { kind: "method", regex: /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/ },
  ],
  typescript: [
    { kind: "interface", regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: "type", regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
    { kind: "enum", regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
    { kind: "class", regex: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/ },
    { kind: "method", regex: /^\s{2,}(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)(?:\s*:\s*[^{]+)?\s*\{/ },
  ],
  python: [
    { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/ },
    { kind: "function", regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  ],
  go: [
    { kind: "function", regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
    { kind: "type", regex: /^type\s+([A-Za-z_]\w*)/ },
  ],
  rust: [
    { kind: "function", regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
    { kind: "struct", regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/ },
    { kind: "enum", regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/ },
    { kind: "trait", regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/ },
    { kind: "impl", regex: /^\s*impl(?:<[^>]*>)?\s+([A-Za-z_]\w*)/ },
  ],
  java: [
    { kind: "class", regex: /^\s*(?:public\s+|abstract\s+|final\s+)*class\s+([A-Za-z_]\w*)/ },
    { kind: "interface", regex: /^\s*(?:public\s+)?interface\s+([A-Za-z_]\w*)/ },
    { kind: "method", regex: /^\s{2,}(?:public|private|protected|static|final|\s)*[\w<>,\[\]]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/ },
  ],
  csharp: [
    { kind: "class", regex: /^\s*(?:public\s+|internal\s+|abstract\s+|sealed\s+)*class\s+([A-Za-z_]\w*)/ },
    { kind: "interface", regex: /^\s*(?:public\s+|internal\s+)?interface\s+([A-Za-z_]\w*)/ },
    { kind: "method", regex: /^\s{2,}(?:public|private|protected|internal|static|async|virtual|override|\s)*[\w<>,\\[\\]]+\s+([A-Za-z_]\w*)\s*\(/ },
  ],
  php: [
    { kind: "class", regex: /^\s*(?:final\s+|abstract\s+)?class\s+([A-Za-z_]\w*)/ },
    { kind: "function", regex: /^\s*(?:public|private|protected|static)?\s*function\s+([A-Za-z_]\w*)/ },
  ],
  ruby: [
    { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/ },
    { kind: "module", regex: /^\s*module\s+([A-Za-z_]\w*)/ },
    { kind: "function", regex: /^\s*def\s+([A-Za-z_]\w*)/ },
  ],
  swift: [
    { kind: "class", regex: /^\s*(?:public\s+|final\s+|open\s+)?class\s+([A-Za-z_]\w*)/ },
    { kind: "struct", regex: /^\s*(?:public\s+)?struct\s+([A-Za-z_]\w*)/ },
    { kind: "function", regex: /^\s*(?:public\s+|private\s+|fileprivate\s+)?func\s+([A-Za-z_]\w*)/ },
  ],
};

const IMPORT_PATTERNS = {
  javascript: [
    /(?:^|\n)\s*import\s+(?:[^'"\n]*?from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*(?:const|let|var)\s+[^=]*?=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  typescript: [
    /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"\n]*?from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*(?:const|let|var)\s+[^=]*?=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  python: [
    /(?:^|\n)\s*from\s+([.\w]+)\s+import\s/g,
    /(?:^|\n)\s*import\s+([.\w]+)/g,
  ],
  go: [/(?:^|\n)\s*(?:import\s+)?["']([\w./\-][^"']*)["']/g],
  rust: [/(?:^|\n)\s*use\s+([\w:]+)/g],
  java: [/(?:^|\n)\s*import\s+(?:static\s+)?([\w.]+)/g],
};

function reject(message, statusCode = 400) {
  return createHttpError(message, statusCode);
}

function languageOf(filePath) {
  return LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] || null;
}

function isIgnoredFile(name) {
  return IGNORED_FILE_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix));
}

/** Walk the granted folder. Symlinks are never followed out of it. */
async function walk(root) {
  const files = [];
  const directories = [root];
  const startedAt = Date.now();
  let truncated = false;

  while (directories.length > 0) {
    if (files.length >= MAX_FILES || Date.now() - startedAt > MAX_WALK_MS) {
      truncated = true;
      break;
    }
    const directory = directories.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        directories.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isIgnoredFile(entry.name)) continue;
      if (files.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      let stat = null;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      files.push({
        path: path.relative(root, full).split(path.sep).join("/"),
        bytes: stat.size,
        language: languageOf(full),
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  return { files, truncated };
}

function extractSymbols(content, language) {
  const patterns = SYMBOL_PATTERNS[language];
  if (!patterns) return [];
  const lines = content.split("\n");
  const symbols = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { kind, regex } of patterns) {
      const match = line.match(regex);
      if (!match) continue;
      const name = match[1];
      if (!name) continue;
      const key = `${kind}:${name}:${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ name, kind, line: index + 1, signature: line.trim().slice(0, 160) });
      break;
    }
  }
  return symbols;
}

function extractImports(content, language) {
  const patterns = IMPORT_PATTERNS[language];
  if (!patterns) return [];
  const imports = new Set();
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const value = String(match[1] || "").trim();
      if (value) imports.add(value);
      if (imports.size >= 60) break;
    }
  }
  return [...imports];
}

const indexCache = new Map();

function indexKey(root) {
  return root;
}

function summarise(files) {
  const byLanguage = new Map();
  let totalBytes = 0;
  for (const file of files) {
    const key = file.language || "other";
    byLanguage.set(key, (byLanguage.get(key) || 0) + 1);
    totalBytes += file.bytes;
  }
  return {
    fileCount: files.length,
    totalBytes,
    languages: [...byLanguage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([language, count]) => ({ language, count })),
  };
}

/**
 * Build (or reuse) the index for a granted folder. Rebuilt when the folder's
 * newest file changes or the file count moves, so it never goes stale while
 * the agent is working.
 */
async function buildRepoIndex(rootValue, { force = false } = {}) {
  const root = await canonicaliseRoot(rootValue);
  const { files, truncated } = await walk(root);
  const newest = files.reduce((max, file) => Math.max(max, file.mtimeMs || 0), 0);
  const fingerprint = `${files.length}:${Math.round(newest)}`;
  const cached = indexCache.get(indexKey(root));
  if (!force && cached && cached.fingerprint === fingerprint) return cached.index;

  const symbols = [];
  const imports = new Map();
  const codeFiles = files.filter((file) => file.language && ["javascript", "typescript", "python", "go", "rust", "java", "csharp", "php", "ruby", "swift"].includes(file.language));

  for (const file of codeFiles) {
    if (file.bytes > MAX_INDEX_FILE_BYTES) continue;
    let content = null;
    try {
      content = await fsp.readFile(path.join(root, file.path), "utf8");
    } catch {
      continue;
    }
    const found = extractSymbols(content, file.language);
    for (const symbol of found) symbols.push({ ...symbol, file: file.path });
    const fileImports = extractImports(content, file.language);
    if (fileImports.length) imports.set(file.path, fileImports);
  }

  const byName = new Map();
  for (const symbol of symbols) {
    const list = byName.get(symbol.name) || [];
    list.push(symbol);
    byName.set(symbol.name, list);
  }

  const index = {
    root,
    createdAt: Date.now(),
    filesIndexed: files.length,
    truncated,
    summary: summarise(files),
    files,
    symbols,
    symbolsByName: byName,
    imports,
  };
  indexCache.set(indexKey(root), { fingerprint, index });
  return index;
}

/** Bounded directory map: enough shape to navigate, never the whole tree. */
function repoMap(rootValue, { limit = MAX_MAP_CHARS } = {}) {
  return buildRepoIndex(rootValue).then((index) => {
    const directories = new Map();
    for (const file of index.files) {
      const directory = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      const entry = directories.get(directory) || { files: [], bytes: 0 };
      entry.files.push(file.path.slice(directory ? directory.length + 1 : 0));
      entry.bytes += file.bytes;
      directories.set(directory, entry);
    }
    const lines = [];
    for (const [directory, entry] of [...directories.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`${directory || "."}/  (${entry.files.length} file${entry.files.length === 1 ? "" : "s"})`);
      for (const name of entry.files.sort().slice(0, 40)) lines.push(`  ${name}`);
      if (entry.files.length > 40) lines.push(`  … ${entry.files.length - 40} more`);
    }
    const entryPoints = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "README.md", "AGENTS.md", "LUKE.md", "Makefile"]
      .filter((name) => index.files.some((file) => file.path === name));
    let text = lines.join("\n");
    let shortened = false;
    if (text.length > limit) {
      text = text.slice(0, limit);
      shortened = true;
    }
    return {
      root: index.root,
      summary: index.summary,
      entryPoints,
      truncated: index.truncated || shortened,
      map: text,
    };
  });
}

/** Regex search over file contents, bounded and always inside the folder. */
async function searchCode(rootValue, { pattern, limit = MAX_SEARCH_RESULTS, extension = null, flags = "" } = {}) {
  const root = await canonicaliseRoot(rootValue);
  if (!pattern || typeof pattern !== "string") throw reject("A search pattern is required.", 400);
  let regex;
  try {
    regex = new RegExp(pattern, flags.includes("i") ? "gi" : "g");
  } catch {
    throw reject("That search pattern is not a valid regular expression.", 400);
  }
  const index = await buildRepoIndex(root);
  const results = [];
  const cappedLimit = Math.max(1, Math.min(Number(limit) || MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS));

  for (const file of index.files) {
    if (results.length >= cappedLimit) break;
    if (file.bytes > MAX_INDEX_FILE_BYTES) continue;
    if (extension && !file.path.toLowerCase().endsWith(String(extension).toLowerCase())) continue;
    let content = null;
    try {
      content = await fsp.readFile(path.join(root, file.path), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let index2 = 0; index2 < lines.length; index2 += 1) {
      if (results.length >= cappedLimit) break;
      regex.lastIndex = 0;
      const line = lines[index2];
      if (!regex.test(line)) continue;
      results.push({
        file: file.path,
        line: index2 + 1,
        text: line.trim().slice(0, MAX_SNIPPET_CHARS),
      });
    }
  }
  return { root, pattern, count: results.length, results, limitReached: results.length >= cappedLimit };
}

/** Where a symbol is defined, and where it is used. */
async function findSymbol(rootValue, { name, limit = 20 } = {}) {
  const index = await buildRepoIndex(rootValue);
  const wanted = String(name || "").trim();
  if (!wanted) throw reject("A symbol name is required.", 400);
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 20, 60));

  const exact = [...(index.symbolsByName.get(wanted) || [])];
  const partial = [];
  if (exact.length === 0) {
    const lowered = wanted.toLowerCase();
    for (const symbol of index.symbols) {
      if (symbol.name.toLowerCase().includes(lowered)) partial.push(symbol);
      if (partial.length >= cappedLimit) break;
    }
  }
  const definitions = (exact.length ? exact : partial).slice(0, cappedLimit);

  const usageResults = await searchCode(rootValue, { pattern: `\\b${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, limit: cappedLimit });
  const usages = usageResults.results.filter((usage) => !definitions.some((definition) => definition.file === usage.file && definition.line === usage.line));

  return {
    root: index.root,
    name: wanted,
    exactMatch: exact.length > 0,
    definitions: definitions.map(({ file, name: symbolName, kind, line, signature }) => ({ file, name: symbolName, kind, line, signature })),
    usages: usages.slice(0, cappedLimit),
  };
}

/**
 * The skeleton of one file. Reading a 900-line file to change 3 lines is the
 * most expensive habit a small model has; the outline removes the need.
 */
async function outlineFile(rootValue, filePath) {
  const { targetPath } = await resolveInsideRoot({ root: rootValue, targetPath: filePath, allowMissing: false });
  const stat = await fsp.stat(targetPath);
  if (stat.size > MAX_OUTLINE_FILE_BYTES) throw reject("That file is too large to outline.", 413);
  const content = await fsp.readFile(targetPath, "utf8");
  const language = languageOf(targetPath);
  const symbols = extractSymbols(content, language);
  const imports = extractImports(content, language);
  return {
    path: filePath,
    language,
    lines: content.split("\n").length,
    bytes: stat.size,
    imports: imports.slice(0, 40),
    symbols: symbols.slice(0, 120),
  };
}

function invalidateRepoIndex(rootValue) {
  return canonicaliseRoot(rootValue).then((root) => indexCache.delete(indexKey(root)));
}

module.exports = {
  buildRepoIndex,
  findSymbol,
  invalidateRepoIndex,
  outlineFile,
  repoMap,
  searchCode,
  IGNORED_DIRECTORIES,
};
