/**
 * Work answers, split into explanation and commands.
 *
 * The model is told to label explanation as ```text and anything the Terminal
 * should run as ```code. It usually does. A local model sometimes does not,
 * and then the command is stranded in the middle of a paragraph — uncopyable,
 * unrunnable, and exactly the complaint this is meant to answer.
 *
 * So the split is also done here, in code, for the case where the model used
 * no fences at all: consecutive lines that can only be commands are lifted out
 * of the prose and handed to the Terminal as their own block.
 *
 * The test is deliberately cautious. A sentence that merely mentions npm is
 * not a command, and a line that looks ambiguous is left alone — prose is the
 * safer wrong answer, because the user can still read it.
 */

/** The programs Work can run, plus the ones people habitually type. */
export const COMMAND_PROGRAMS = [
  "npm", "npx", "node", "yarn", "pnpm", "bun", "deno",
  "python", "python3", "pip", "pip3",
  "make", "git", "cd", "ls", "cat", "cp", "mv", "mkdir", "touch",
];

const MAX_COMMAND_LINE = 160;

/**
 * True only when a line is unambiguously something to run: it starts with a
 * program, it is short, and it does not read as a sentence.
 */
export function looksLikeCommand(line) {
  const text = String(line == null ? "" : line).trim();
  if (!text) return false;
  const withoutPrompt = text.replace(/^[$>]\s+/, "");
  if (!withoutPrompt || withoutPrompt.length > MAX_COMMAND_LINE) return false;
  // Sentence punctuation means someone is talking about the command.
  if (/[.,;:!?]$/.test(withoutPrompt)) return false;
  const first = withoutPrompt.split(/\s+/)[0].toLowerCase();
  return COMMAND_PROGRAMS.includes(first);
}

/**
 * Split a fence-free answer into text and code blocks, in order.
 * Consecutive command lines become one block, so `npm install` followed by
 * `npm run build` arrives as a single thing to run.
 */
export function splitAnswerBlocks(content) {
  const lines = String(content == null ? "" : content).split(/\r?\n/);
  const blocks = [];
  let current = null;

  const push = (type, text) => {
    if (!text) return;
    if (current && current.type === type) current.lines.push(text);
    else blocks.push((current = { type, lines: [text] }));
  };

  for (const line of lines) {
    if (looksLikeCommand(line)) push("code", line.trim().replace(/^[$>]\s+/, ""));
    else push("text", line);
  }

  return blocks.map((block) => ({
    type: block.type,
    content: block.lines.join("\n").replace(/^\n+|\n+$/g, ""),
  }));
}

/**
 * A model that prefers JSON can answer with it instead of fences:
 *
 *   ```json
 *   {"blocks":[{"type":"text","text":"..."},{"type":"code","code":"npm install"}]}
 *   ```
 *
 * Both are understood, so whichever the model reaches for, the answer still
 * arrives as explanation and as something the Terminal can run.
 */
export function expandJsonAnswer(content) {
  const source = String(content == null ? "" : content);
  const fences = source.match(/```(?:json|luke-answer)\n([\s\S]*?)```/g);
  if (!fences) return source;

  let result = source;
  for (const fence of fences) {
    const inner = fence.replace(/^```(?:json|luke-answer)\n/, "").replace(/```$/, "");
    let parsed = null;
    try {
      parsed = JSON.parse(inner);
    } catch {
      continue;
    }
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : Array.isArray(parsed) ? parsed : null;
    if (!blocks || !blocks.length) continue;
    const mapped = blocks
      .map((block) => {
        const type = String(block?.type || "").toLowerCase() === "code" ? "code" : "text";
        const value = type === "code" ? (block?.code ?? block?.text ?? "") : (block?.text ?? block?.content ?? "");
        return { type, content: String(value == null ? "" : value) };
      })
      .filter((block) => block.content.trim());
    if (!mapped.length) continue;
    const rebuilt = mapped.map((block) => ["```" + block.type, block.content, "```"].join("\n")).join("\n");
    result = result.replace(fence, rebuilt);
  }
  return result;
}
