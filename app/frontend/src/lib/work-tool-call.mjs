/**
 * Work tool calls, understood outside the chat.
 *
 * The model asks Work questions as {"tool":"repo_map"}. Pasted into the
 * Terminal that used to be refused: "not one of the programs Work can run" —
 * true, and useless, because the user is then left holding an instruction with
 * nowhere to put it. The Terminal now answers it instead.
 *
 * Only tools that read are run here. Anything that changes a file goes back to
 * Work Chat, which asks first and keeps a backup the user can undo — running
 * it from a prompt the user typed would have neither.
 */

/** Tools that only look, so the Terminal can answer them on its own. */
export const TERMINAL_TOOL_ENDPOINTS = {
  repo_map: "/api/work/index/map",
  read_outline: "/api/work/index/outline",
  find_symbol: "/api/work/index/symbol",
  search_code: "/api/work/index/search",
  list_directory: "/api/work/directory",
  read_file: "/api/work/file/read",
};

/** Tools that change things: the chat owns these, with approval and undo. */
export const CHAT_ONLY_TOOLS = [
  "write_file",
  "apply_patch",
  "create_file",
  "run_check",
  "terminal",
  "review_diff",
  "update_tasks",
];

/**
 * Read a line as a tool call. Anything else — a command, a sentence, a piece
 * of JSON that is not a tool call — comes back null, so a command is never
 * mistaken for one.
 */
export function parseToolCall(line) {
  const text = String(line == null ? "" : line).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const tool = String(parsed.tool || "").trim();
  if (!tool) return null;
  return { tool, args: parsed };
}

/** The body one tool expects, mirroring what Work Chat sends for the same call. */
export function toolPayload(tool, args, base = {}) {
  const options = args && typeof args === "object" ? args : {};
  if (tool === "repo_map") return { ...base, limit: Number(options.limit) || 0 };
  if (tool === "find_symbol") {
    return { ...base, name: String(options.name || options.symbol || ""), limit: Number(options.limit) || 20 };
  }
  if (tool === "search_code") {
    return {
      ...base,
      pattern: String(options.pattern || options.query || ""),
      limit: Number(options.limit) || 25,
      extension: options.extension || null,
      flags: typeof options.flags === "string" ? options.flags : "",
    };
  }
  return { ...base, path: String(options.path || options.file || options.filePath || "") };
}

/** A tool's answer, printed the way a terminal prints it. */
export function summariseToolResult(tool, data, { maxChars = 4000 } = {}) {
  const payload = data && typeof data === "object" && "result" in data ? data.result : data;
  if (payload == null) return `${tool}: nothing came back.`;
  if (typeof payload === "string") return payload;
  let text = "";
  try {
    text = JSON.stringify(payload, null, 2);
  } catch {
    text = String(payload);
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… trimmed — ${text.length} characters in total.`;
}

/** Why a tool is not going to run here, and where it belongs instead. */
export function toolRefusal(tool) {
  if (TERMINAL_TOOL_ENDPOINTS[tool]) return null;
  if (CHAT_ONLY_TOOLS.includes(tool)) {
    return [
      `${tool} changes things, so it does not run from the Terminal.`,
      "Send it in the Work chat instead: it asks before it writes, and the",
      "run keeps a backup you can undo in one click.",
    ].join("\n");
  }
  return [
    `"${tool}" is not something Work knows how to do.`,
    "Commands the Terminal runs: node, npm, npx, yarn, pnpm, bun, deno,",
    "python3, python, make — and read-only ones like ls, cat, pwd and git status.",
    "Asking about the code itself: {\"tool\":\"repo_map\"}, {\"tool\":\"search_code\",\"pattern\":\"…\"},",
    "{\"tool\":\"read_outline\",\"path\":\"src/app.js\"}, {\"tool\":\"find_symbol\",\"name\":\"…\"}.",
  ].join("\n");
}


/**
 * Does this block hold a program, or notes about one?
 *
 * The model writes "# Update tasks" above a tool call, and a task list that is
 * a handful of markdown lines. Both arrive in a ```code block. Handing either
 * to node produces a syntax error, which is the terminal telling the user
 * something they already suspect and cannot act on.
 *
 * So the block is read before it is run: a tool call is a tool call, a list of
 * notes is notes, and only something with statements in it is offered to run.
 */
export function looksLikeCode(text) {
  const lines = String(text == null ? "" : text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
  if (lines.length === 0) return false;
  const body = lines.join("\n");

  // A tool call is data. It may look like a JavaScript object, and node will
  // still refuse it as a program — so it is recognised here instead.
  try {
    JSON.parse(body);
    return false;
  } catch {}

  // Headings, bullets and checkbox lists: a plan, not a program.
  if (lines.every((line) => /^(?:#{1,6}\s|[-*+]\s|\[[ xX]\]|\d+[.)]\s|>\s)/.test(line))) return false;

  return /[=;(){}[\]]/.test(body)
    || /^\s*(?:const|let|var|function|return|if|for|while|class|def|print|import|from|export|module|require|console|async|await)\b/m.test(body);
}

/** What to say when a block holds no program at all. Short: it is a terminal. */
export const NOT_A_PROGRAM = "No program in that block — it reads like notes. Nothing was run.";

/**
 * A task list, read as a plan.
 *
 * The model is asked to post its plan with update_tasks, and sometimes writes
 * it as markdown instead — "- [ ] move the parser", "- [x] read the file".
 * That is not a program, but it is not nothing either: it is the plan, and
 * there is somewhere it belongs.
 */
export function planTasksFromMarkdown(text) {
  const tasks = [];
  const add = (line, status) => {
    const value = String(line || "").trim().slice(0, 200);
    if (value) tasks.push({ id: String(tasks.length + 1), text: value, status });
  };
  for (const rawLine of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^#{1,6}\s+/, "");
    if (!line) continue;
    const checkbox = line.match(/^(?:[-*+]|\d+[.)])?\s*\[([ xX~-])\]\s*(.*)$/);
    if (checkbox) {
      const mark = checkbox[1];
      add(checkbox[2], mark === " " ? "todo" : (mark === "-" || mark === "~" ? "doing" : "done"));
      continue;
    }
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (bullet) add(bullet[1], "todo");
  }
  // The Work plan holds 24 steps, the same cap the agent works to.
  return tasks.slice(0, 24);
}
