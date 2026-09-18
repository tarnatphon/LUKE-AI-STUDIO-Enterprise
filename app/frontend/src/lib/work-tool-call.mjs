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
 * The refusal, with the block's own first lines under it.
 *
 * "It reads like notes" is no use if the user cannot see which block, or what
 * it says — and a model that labels prose as ```code produces a lot of blocks.
 * Quoting the opening lines turns a dead end into something readable.
 */
export function explainNotAProgram(block, maxLines = 2) {
  const lines = String(block == null ? "" : block)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => `  ${line.slice(0, 120)}`);
  return lines.length ? `${NOT_A_PROGRAM}\n${lines.join("\n")}` : NOT_A_PROGRAM;
}

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
    // Models decorate lists several ways — "•", no space after the mark, an
    // indent — and all of them mean the same step.
    const line = rawLine.trim().replace(/\t/g, " ").replace(/^#{1,6}\s*/, "").replace(/^[•·]/, "-");
    if (!line) continue;
    const checkbox = line.match(/^(?:[-*+]|\d+[.)])?\s*\[([ xX~-])\]\s*(.*)$/);
    if (checkbox) {
      const mark = checkbox[1];
      add(checkbox[2], mark === " " ? "todo" : (mark === "-" || mark === "~" ? "doing" : "done"));
      continue;
    }
    // A mark with no space after it ("-Move the parser") is still a step.
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s*(.+)$/);
    if (bullet) add(bullet[1], "todo");
  }
  // The Work plan holds 24 steps, the same cap the agent works to.
  return tasks.slice(0, 24);
}


/**
 * Remove the harness noise that sometimes lands inside a model's answer —
 * an injected <arena-system-message> block, which is not part of what the
 * model meant to say and makes everything after it unreadable.
 */
export function stripHarnessNoise(text) {
  return String(text == null ? "" : text)
    .replace(/<arena-system-message>[\s\S]*?<\/arena-system-message>/gi, "")
    .replace(/<arena-system-message>[\s\S]*$/gi, "");
}

/** The first complete JSON value in a text that may carry prose around it. */
function extractJsonValue(text) {
  const start = String(text).search(/[[{]/);
  if (start === -1) return null;
  for (let end = text.length; end > start; end -= 1) {
    const slice = text.slice(start, end);
    const last = slice[slice.length - 1];
    if (last !== "}" && last !== "]") continue;
    try {
      return JSON.parse(slice);
    } catch {}
  }
  return null;
}

/**
 * A luke-actions block: {"actions":[{"tool":"repo_map"}, ...]}.
 *
 * That is the list of things Work Chat is asked to do, and the chat already
 * runs it — with approval and a backup. The Terminal has no idea what to do
 * with it, and reading it as a program produces a syntax error, so it is
 * recognised here instead.
 */
export function parseActionBlock(text) {
  const clean = stripHarnessNoise(text)
    .replace(/^\s*luke-actions\s*$/gim, "")
    .replace(/^\s*```[a-z-]*\s*$/gim, "")
    .trim();
  if (!clean) return null;
  const value = extractJsonValue(clean);
  const batch = Array.isArray(value) ? value : (Array.isArray(value?.actions) ? value.actions : null);
  if (!Array.isArray(batch) || batch.length === 0) return null;
  const actions = batch.filter((entry) => entry && typeof entry === "object" && String(entry.tool || "").trim());
  return actions.length > 0 ? { actions } : null;
}

/** What to say about one. Short, and it says where the thing belongs. */
export function actionBlockMessage(block) {
  const count = block?.actions?.length || 0;
  const names = [...new Set(block.actions.map((entry) => String(entry.tool)))].slice(0, 6).join(", ");
  return [
    `That is an action list for Work Chat — ${count} ${count === 1 ? "action" : "actions"} (${names}). The Terminal cannot run it.`,
    "Nothing was run. In the chat, Work runs those itself, with approval and undo.",
  ].join("\n");
}
