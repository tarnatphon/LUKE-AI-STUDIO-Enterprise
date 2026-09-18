import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, ShieldCheck, SquareTerminal, Trash2, X } from "lucide-react";
import { restoreProjectGrants, withRestoredGrants } from "../lib/work-grants.mjs";
import { looksLikeCommand } from "../lib/work-answer-blocks.mjs";
import { CHAT_ONLY_TOOLS, TERMINAL_TOOL_ENDPOINTS, actionBlockMessage, bareToolName, explainNotAProgram, looksLikeCode, parseActionBlock, parseToolCall, planTasksFromMarkdown, summariseToolResult, toolPayload, toolRefusal } from "../lib/work-tool-call.mjs";

const COMMANDS = [
  { id: "git-status", label: "git status" },
  { id: "git-diff", label: "git diff --stat" },
  { id: "git-log", label: "git log -20" },
  { id: "list-files", label: "list files" },
];

const queueStyle = { flex: "0 0 auto", maxHeight: 92, overflow: "auto", padding: "6px 10px", borderTop: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.025)" };
const queueHeadingStyle = { display: "block", margin: "0 4px 3px", color: "#8e9692", fontSize: ".61rem", textTransform: "uppercase", letterSpacing: ".06em" };
const queueItemStyle = { display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 7, minHeight: 25, paddingLeft: 4 };
const queueCodeStyle = { overflow: "hidden", color: "#cbd6d0", fontSize: ".66rem", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const queueRemoveStyle = { display: "grid", placeItems: "center", width: 25, height: 25, border: 0, borderRadius: 6, background: "transparent", color: "#8e9692", cursor: "pointer" };
const approvalStyle = { flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px", borderTop: "1px solid rgba(250,204,21,.28)", background: "rgba(250,204,21,.08)" };
const approvalTextStyle = { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, color: "#f5e6b8", fontSize: ".66rem", lineHeight: 1.4 };
const approvalCodeStyle = { overflow: "hidden", color: "#fff3cd", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".68rem", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const approvalCwdStyle = { overflow: "hidden", opacity: 0.75, textOverflow: "ellipsis", whiteSpace: "nowrap" };
const approvalActionsStyle = { display: "flex", flexShrink: 0, gap: 6 };
const approvalAllowStyle = { padding: "5px 11px", border: "1px solid rgba(250,204,21,.45)", borderRadius: 7, background: "rgba(250,204,21,.18)", color: "#ffe9a8", cursor: "pointer", fontSize: ".66rem", fontWeight: 600 };
const approvalCancelStyle = { padding: "5px 11px", border: "1px solid rgba(255,255,255,.14)", borderRadius: 7, background: "transparent", color: "#c3ccc7", cursor: "pointer", fontSize: ".66rem" };
const commandInputStyle = { flex: 1, minWidth: 0, maxHeight: 96, padding: "6px 8px", border: "1px solid rgba(255,255,255,.12)", borderRadius: 7, background: "rgba(0,0,0,.25)", color: "#e7efea", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".7rem", lineHeight: 1.5, resize: "vertical" };
const queueStatusStyle = { flex: "0 0 auto", color: "#67d391", fontSize: ".62rem", whiteSpace: "nowrap" };
const planStyle = { flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px", borderTop: "1px solid rgba(196,181,253,.3)", background: "rgba(196,181,253,.08)" };
const scriptApprovalStyle = { flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px", borderTop: "1px solid rgba(147,197,253,.3)", background: "rgba(147,197,253,.08)" };
const scriptPreviewStyle = { maxHeight: 92, overflow: "auto", margin: 0, padding: "5px 7px", borderRadius: 6, background: "rgba(0,0,0,.28)", color: "#dbe7f5", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".64rem", lineHeight: 1.45, whiteSpace: "pre-wrap" };
const scriptHintStyle = { opacity: 0.72, fontSize: ".63rem" };
const scriptSelectStyle = { padding: "2px 5px", border: "1px solid rgba(255,255,255,.16)", borderRadius: 6, background: "rgba(0,0,0,.25)", color: "#dbe7f5", fontSize: ".64rem" };
const stagedStyle = { flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "5px 10px", borderTop: "1px solid rgba(103,211,145,.22)", background: "rgba(103,211,145,.07)", color: "#b7e7c8", fontSize: ".66rem" };
const stagedClearStyle = { flexShrink: 0, padding: "3px 8px", border: "1px solid rgba(103,211,145,.3)", borderRadius: 6, background: "transparent", color: "#b7e7c8", cursor: "pointer", fontSize: ".62rem" };
/**
 * Interpreters offered for a pasted script. A subset of what the terminal
 * already runs, and never a shell: the file is the only argument, so nothing
 * in the script is re-read as command syntax.
 */
const SCRIPT_INTERPRETERS = ["node", "python3", "python", "deno", "bun"];

/** Code that belongs in the project still belongs with Work Chat. */
const SCRIPT_HINT = "If this code belongs in the project, ask Work Chat to write the file — it keeps a backup you can undo.";

const MAX_SAVED_DRAFT_CHARS = 8000;
const MAX_SAVED_HISTORY = 50;

/**
 * Replace the "Running…" line with the answer. Reading the marker by position
 * instead of by regex means an answer can never be dropped on the floor — if
 * the marker has moved, the answer is appended rather than lost, which is what
 * left the terminal showing "Running…" forever.
 */
function finishRunningLine(text, answer) {
  const marker = "Running…";
  const at = text.lastIndexOf(marker);
  if (at === -1) return `${text ? `${text}\n` : ""}${answer}`;
  return `${text.slice(0, at)}${answer}`;
}

function terminalSessionKey(projectId, root) {
  return `luke_work_terminal:${projectId || "none"}:${root || "none"}`;
}

function readTerminalSession(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return {
      draft: typeof saved?.draft === "string" ? saved.draft.slice(0, MAX_SAVED_DRAFT_CHARS) : "",
      history: Array.isArray(saved?.history) ? saved.history.filter((item) => typeof item === "string").slice(-MAX_SAVED_HISTORY) : [],
    };
  } catch {
    return { draft: "", history: [] };
  }
}

export default function WorkTerminalDock({ project, setProjects = null, onClose, onUpdatePlan = null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeCommand, setActiveCommand] = useState("");
  const [output, setOutput] = useState("Read-only Work Terminal ready.");
  const [commandText, setCommandText] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [commandQueue, setCommandQueue] = useState([]);
  const [terminalSession, setTerminalSession] = useState(null);
  const [needsGrant, setNeedsGrant] = useState(false);
  const [granting, setGranting] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(null);
  // Commands that came from the answer together with the one in the input.
  // They wait here rather than in commandQueue, because the queue starts the
  // moment the terminal is idle — the user is meant to press Run first, and
  // only then does the rest of the block follow on its own.
  const [staged, setStaged] = useState([]);
  // A pasted script is not a command and cannot be typed as one. It is held
  // here until the user says to run it: a script runs with their access, which
  // reaches further than the folder they granted.
  const [pendingScript, setPendingScript] = useState(null);
  // A block of notes is not always worthless: a task list is the plan, and
  // there is somewhere it belongs.
  const [pendingPlan, setPendingPlan] = useState(null);
  // A command that fills the panel used to look like it did nothing at all,
  // because the answer landed below the fold and nothing scrolled to it. The
  // output now follows the answer — unless the user has scrolled up to read,
  // and then their place is left alone.
  const outputRef = useRef(null);
  const outputFollowsRef = useRef(true);
  // How many times a command has been retried after its grant was restored.
  // One, so a folder that cannot be granted cannot spin forever.
  const retriedRef = useRef(0);
  const roots = project?.sourceFolders || [];
  const [root, setRoot] = useState(() => roots[0] || "");
  const sessionKey = terminalSessionKey(project?.id, root);
  const prompt = terminalSession?.prompt || "$";

  useEffect(() => { setRoot((current) => roots.includes(current) ? current : roots[0] || ""); }, [project?.id, project?.sourceFolders]);
  useEffect(() => {
    const saved = readTerminalSession(sessionKey);
    setCommandQueue([]);
    setCommandText(saved.draft);
    setHistory(saved.history);
    setHistoryIndex(-1);
  }, [sessionKey]);
  useEffect(() => {
    let active = true;
    if (!root) {
      setTerminalSession(null);
      setOutput("Select a granted source folder to start Work Terminal.");
      return () => { active = false; };
    }
    void (async () => {
      try {
        const response = await fetch("/api/work/terminal/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root, projectId: project?.id, grantId: project?.folderGrants?.[root] }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not start Work Terminal in this folder.");
        if (!active) return;
        setNeedsGrant(false);
        setTerminalSession(data.session);
        setOutput(`${data.session.changeDirectoryCommand}\n${data.session.prompt}`);
      } catch (error) {
        if (!active) return;
        setTerminalSession(null);
        const message = error instanceof Error ? error.message : String(error);
        setNeedsGrant(/permission/i.test(message));
        setOutput(message);
      }
    })();
    return () => { active = false; };
  }, [project?.id, project?.folderGrants, root]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(sessionKey, JSON.stringify({ draft: commandText.slice(0, MAX_SAVED_DRAFT_CHARS), history: history.slice(-MAX_SAVED_HISTORY) }));
      } catch {}
    }, 180);
    return () => window.clearTimeout(timer);
  }, [commandText, history, sessionKey]);

  useEffect(() => {
    const element = outputRef.current;
    if (element && outputFollowsRef.current) element.scrollTop = element.scrollHeight;
  }, [output]);

  useEffect(() => {
    const receiveCommand = (event) => {
      const lines = Array.isArray(event.detail?.lines) ? event.detail.lines.filter(Boolean) : [];
      const raw = String(event.detail?.command || "").trim();

      // A tool call first, whatever shape it arrived in: one line, printed
      // across several, or sitting under a "# Update tasks" heading. It is
      // folded back onto one line and left in the input, so the user still
      // presses Run and the queue routes it to the tool runner.
      const call = parseToolCall(raw) || parseToolCall(lines.join("\n"));
      if (call) {
        setStaged([]);
        setPendingScript(null);
        setCommandText(JSON.stringify(call.args));
        return;
      }

      // An action list is neither a command nor a program: it is the list of
      // things Work Chat has been asked to do, and the chat runs that itself.
      const actionBlock = parseActionBlock(raw);
      if (actionBlock) {
        setStaged([]);
        setPendingScript(null);
        setCommandText("");
        setOutput((current) => `${current ? `${current}\n` : ""}${actionBlockMessage(actionBlock)}`);
        return;
      }

      // Just a tool's name, under a heading: turn it into the call it was
      // reaching for and leave it in the input, so the tool runner answers.
      const named = bareToolName(raw);
      if (named) {
        setStaged([]);
        setPendingScript(null);
        setCommandText(JSON.stringify({ tool: named }));
        return;
      }

      if (lines.length > 1 && lines.every((line) => looksLikeCommand(line))) {
        // A whole block arrived from the answer, every line a command. The
        // first waits in the input for the user's Enter; the rest are held
        // until it finishes.
        setPendingScript(null);
        setStaged(lines.slice(1));
        setCommandText(lines[0]);
        return;
      }
      if (lines.length > 1 || raw.includes("\n")) {
        setStaged([]);
        // One piece of code rather than a list of commands. Running its lines
        // one at a time would fail on every line that is not a command, so the
        // whole thing is offered as a script — unless there is no program in
        // it, in which case saying so beats a syntax error from node.
        if (!looksLikeCode(raw)) {
          setCommandText("");
          if (!offerPlan(raw)) setOutput((current) => `${current ? `${current}\n` : ""}${explainNotAProgram(raw)}`);
          return;
        }
        setCommandText("");
        setPendingScript({ code: raw, interpreter: "auto" });
        return;
      }
      setStaged([]);
      setPendingScript(null);
      setCommandText(raw || lines[0] || "");
    };
    window.addEventListener("luke:work-terminal-command", receiveCommand);
    return () => window.removeEventListener("luke:work-terminal-command", receiveCommand);
  }, []);

  /**
   * Re-grant the folders this project already names. It grants nothing the
   * user did not already choose — the server keeps permissions in memory and
   * forgets them when it restarts, so this only hands back what was there.
   */
  const restoreGrants = useCallback(async () => {
    if (!project || !root) return { ok: false, reason: "This project has no source folder to grant. Open Edit project and add the folder you want Work to use." };
    setGranting(true);
    try {
      const { grants, failed } = await restoreProjectGrants(project, { force: true });
      const granted = Object.keys(grants || {}).length;
      if (granted > 0 && typeof setProjects === "function") {
        setProjects((current) => (current || []).map((entry) => (entry.id === project.id ? withRestoredGrants(entry, grants) : entry)));
      }
      // Saying "granted" when nothing was granted is how the user ended up
      // stuck: the folder looks fixed until the next command fails again.
      return granted > 0
        ? { ok: true }
        : { ok: false, reason: failed?.length
          ? failed.map((entry) => `${entry.root}: ${entry.error}`).join("; ")
          : "This project has no source folder to grant. Open Edit project and add the folder you want Work to use." };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      setGranting(false);
    }
  }, [project, root, setProjects]);

  const grantAccess = useCallback(async () => {
    const restored = await restoreGrants();
    if (restored.ok) {
      setNeedsGrant(false);
      setOutput((current) => `${current}\nAccess granted for this session. Type your command again.`);
    } else {
      setOutput((current) => `${current}\nNothing could be granted — ${restored.reason}`);
    }
  }, [restoreGrants]);

  const executeCommand = useCallback(async (command, { approved = false } = {}) => {
    if (!root || !command) return;
    setBusy(true);
    setActiveCommand(command);
    setPendingApproval(null);
    setHistory((current) => [...current.filter((item) => item !== command), command].slice(-50));
    setHistoryIndex(-1);
    setOutput((current) => `${current ? `${current}\n` : ""}${prompt} ${command}\nRunning…`);
    try {
      const response = await fetch("/api/work/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root, command, projectId: project?.id, grantId: project?.folderGrants?.[root], approvalGranted: approved }),
      });
      const data = await response.json();
      if (response.status === 403 && data?.requiresApproval) {
        // Running a script needs the user's say-so, so the terminal asks here
        // rather than failing: nothing has run yet.
        setPendingApproval({ command, preview: data.preview, message: data.error });
        setOutput((current) => finishRunningLine(current, `${data.error}\nNothing has run yet — allow it or cancel below.`));
        return;
      }
      if (!response.ok) throw new Error(data.error || "Work command failed.");
      setNeedsGrant(false);
      retriedRef.current = 0;
      setOutput((current) => finishRunningLine(current, data.result?.output || "No output."));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lapsed = /permission|grant|not granted/i.test(message);
      // The server keeps permissions in memory, so a restart takes them away
      // and nothing in the app says so. Rather than leaving the user to press
      // a button they have to remember, grant it again and run the command
      // once more — once, so a folder that cannot be granted cannot spin.
      if (lapsed && retriedRef.current < 1) {
        retriedRef.current += 1;
        const restored = await restoreGrants();
        if (restored.ok) {
          setOutput((current) => `${current}\nAccess had lapsed — granted again for this session, running it once more.`);
          setCommandQueue((current) => [command, ...current]);
          return;
        }
        setNeedsGrant(true);
        setOutput((current) => finishRunningLine(current, `${message}\nNothing has run — ${restored.reason}`));
        return;
      }
      setNeedsGrant(lapsed);
      setOutput((current) => finishRunningLine(current, message));
    } finally {
      setBusy(false);
    }
  }, [root, project, prompt, restoreGrants]);

  /**
   * {"tool":"repo_map"} and its like are questions about the code, not shell
   * commands. Answered here rather than refused: the user pasted what the
   * model gave them and is entitled to an answer, not a list of programs.
   */
  const runToolCall = useCallback(async ({ tool, args }) => {
    const refusal = toolRefusal(tool);
    if (refusal !== null) {
      setOutput((current) => `${current ? `${current}\n` : ""}${prompt} ${JSON.stringify({ tool, ...args })}\n${refusal}`);
      return;
    }
    setBusy(true);
    setActiveCommand(tool);
    setPendingApproval(null);
    setOutput((current) => `${current ? `${current}\n` : ""}${prompt} ${JSON.stringify({ tool, ...args })}\nRunning…`);
    try {
      const response = await fetch(TERMINAL_TOOL_ENDPOINTS[tool], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toolPayload(tool, args, { root, projectId: project?.id, grantId: project?.folderGrants?.[root] })),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `${tool} failed.`);
      setOutput((current) => finishRunningLine(current, summariseToolResult(tool, data)));
    } catch (error) {
      setOutput((current) => finishRunningLine(current, error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }, [root, project, prompt]);

  /**
   * Run a pasted script. It is written into the granted folder, given to one
   * interpreter as a single argument — no shell ever reads it — and deleted
   * afterwards, so running code never quietly adds files to the project.
   */
  const runScript = useCallback(async ({ code, interpreter }) => {
    const lines = code.split(/\r?\n/).length;
    setPendingScript(null);
    setBusy(true);
    setActiveCommand(`script — ${lines} lines`);
    setPendingApproval(null);
    setOutput((current) => `${current ? `${current}\n` : ""}${prompt} script — ${lines} lines\nRunning…`);
    try {
      const response = await fetch("/api/work/script/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root,
          projectId: project?.id,
          grantId: project?.folderGrants?.[root],
          code,
          interpreter: interpreter === "auto" ? null : interpreter,
          approvalGranted: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The script could not run.");
      const result = data.result || {};
      const footer = `— ${result.interpreter} exited ${result.exitCode} in ${(Number(result.durationMs || 0) / 1000).toFixed(1)}s${result.timedOut ? " (timed out)" : ""}`;
      setOutput((current) => finishRunningLine(current, `${result.command}\n${result.output || "(no output)"}\n${footer}`));
    } catch (error) {
      setOutput((current) => finishRunningLine(current, error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }, [root, project, prompt]);

  /**
   * Notes that turn out to be a plan. Nothing is run; the steps are offered to
   * the Work plan instead, which is where the model meant them to go.
   */
  const offerPlan = useCallback((block) => {
    const tasks = planTasksFromMarkdown(block);
    if (tasks.length === 0 || typeof onUpdatePlan !== "function") return false;
    setPendingPlan({ tasks });
    setOutput((current) => `${current ? `${current}\n` : ""}${NOT_A_PROGRAM} It reads like a plan — ${tasks.length} ${tasks.length === 1 ? "step" : "steps"}.`);
    return true;
  }, [onUpdatePlan]);

  const acceptPlan = () => {
    if (!pendingPlan) return;
    const count = onUpdatePlan?.(pendingPlan.tasks) ?? pendingPlan.tasks.length;
    setOutput((current) => `${current}\nPlan updated — ${count} ${count === 1 ? "step" : "steps"}.`);
    setPendingPlan(null);
  };

  const cancelApproval = () => {
    setPendingApproval(null);
    setOutput((current) => `${current}\nCancelled — nothing was run.`);
  };

  useEffect(() => {
    // pendingApproval matters: without it the next queued command would start
    // the instant this one stopped, replacing the prompt that is waiting for
    // the user's say-so and quietly running what they were asked about.
    if (busy || pendingApproval || !root || commandQueue.length === 0) return;
    const [nextCommand] = commandQueue;
    setCommandQueue((current) => current.slice(1));
    const call = parseToolCall(nextCommand);
    if (call) void runToolCall(call);
    else void executeCommand(nextCommand);
  }, [busy, pendingApproval, commandQueue, executeCommand, runToolCall, root]);

  const queueCommand = () => {
    const command = commandText.trim();
    if (!root || !command) return;
    if (command === "clear") {
      setOutput("");
      setCommandText("");
      setStaged([]);
      return;
    }
    if (command.includes("\n")) {
      const actionBlock = parseActionBlock(command);
      if (actionBlock) {
        setOutput((current) => `${current ? `${current}\n` : ""}${actionBlockMessage(actionBlock)}`);
        return;
      }
      const named = bareToolName(command);
      if (named) {
        setCommandText(JSON.stringify({ tool: named }));
        return;
      }
      const call = parseToolCall(command);
      if (call) {
        setCommandText(JSON.stringify(call.args));
        return;
      }
      if (!looksLikeCode(command)) {
        if (!offerPlan(command)) setOutput((current) => `${current ? `${current}\n` : ""}${explainNotAProgram(command)}`);
        return;
      }
      setPendingScript({ code: command, interpreter: "auto" });
      return;
    }
    setCommandQueue((current) => [...current, command, ...staged].slice(-50));
    setStaged([]);
    setCommandText("");
    setHistoryIndex(-1);
  };

  return (
    <section className={`work-terminal-dock ${collapsed ? "collapsed" : ""}`} aria-label="Bottom Work Terminal">
      <header>
        <div><SquareTerminal size={15} /><strong>Terminal</strong>{roots.length > 1 ? <select value={root} onChange={(event) => { setRoot(event.target.value); setCommandQueue([]); }} aria-label="Terminal source folder">{roots.map((folder) => <option key={folder} value={folder}>{folder.split(/[\\/]/).filter(Boolean).pop() || folder}</option>)}</select> : terminalSession ? <span title={terminalSession.cwd}>{terminalSession.cwd}</span> : activeCommand && <span>{activeCommand}</span>}{(busy || commandQueue.length > 0) && <small style={queueStatusStyle}>{busy ? "Running" : "Ready"} · {commandQueue.length} queued</small>}</div>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1200); }} title="Copy Terminal output">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
        <button type="button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "Expand Terminal" : "Collapse Terminal"}>{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        <button type="button" onClick={onClose} title="Close Terminal"><X size={16} /></button>
      </header>
      {!collapsed && (
        <div className="work-terminal-dock-body">
          <div className="work-terminal-dock-commands">
            {COMMANDS.map((command) => <button type="button" key={command.id} disabled={!root} onClick={() => setCommandText(command.label)}>{command.label}</button>)}
          </div>
          {!root ? <div className="work-terminal-dock-empty">Add a source folder to this Work project to enable Terminal.</div> : <div className="work-terminal-session"><pre ref={outputRef} onScroll={(event) => { const element = event.currentTarget; outputFollowsRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 40; }} aria-live="polite">{output}</pre>{commandQueue.length > 0 && <div className="work-terminal-command-queue" style={queueStyle} aria-label="Queued Terminal commands"><strong style={queueHeadingStyle}>Queued</strong>{commandQueue.map((command, index) => <div style={queueItemStyle} key={`${command}-${index}`}><code style={queueCodeStyle}>{command}</code><button style={queueRemoveStyle} type="button" onClick={() => setCommandQueue((current) => current.filter((_, itemIndex) => itemIndex !== index))} title={`Remove queued command ${command}`}><Trash2 size={13} /></button></div>)}</div>}{needsGrant && <div className="work-terminal-grant" style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px" }}><button type="button" onClick={grantAccess} disabled={granting} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid rgba(103,211,145,.35)", borderRadius: 7, background: "rgba(103,211,145,.12)", color: "#67d391", cursor: "pointer", fontSize: ".66rem" }}><ShieldCheck size={13} />{granting ? "Granting…" : "Grant access to this folder again"}</button></div>}{pendingApproval && <div style={approvalStyle} role="alertdialog" aria-label="Allow this command">
            <div style={approvalTextStyle}>
              <strong>Allow this command?</strong>
              <code style={approvalCodeStyle}>{pendingApproval.preview?.command || pendingApproval.command}</code>
              <span>{pendingApproval.preview?.note || "It runs inside this project folder."}</span>
              <span style={approvalCwdStyle}>in {pendingApproval.preview?.cwd || root}</span>
            </div>
            <div style={approvalActionsStyle}>
              <button type="button" style={approvalAllowStyle} onClick={() => void executeCommand(pendingApproval.command, { approved: true })}>Allow once</button>
              <button type="button" style={approvalCancelStyle} onClick={cancelApproval}>Cancel</button>
            </div>
          </div>}{pendingPlan && <div style={planStyle} role="alertdialog" aria-label="Use this plan">
            <div style={approvalTextStyle}>
              <strong>Use these {pendingPlan.tasks.length} steps as your plan?</strong>
              <span style={scriptHintStyle}>Nothing was run — a plan is not a program. This replaces the plan Work is following.</span>
              <pre style={scriptPreviewStyle}>{pendingPlan.tasks.slice(0, 5).map((task) => `[${task.status === "done" ? "x" : task.status === "doing" ? "-" : " "}] ${task.text}`).join("\n")}{pendingPlan.tasks.length > 5 ? `\n… and ${pendingPlan.tasks.length - 5} more` : ""}</pre>
            </div>
            <div style={approvalActionsStyle}>
              <button type="button" style={approvalAllowStyle} onClick={acceptPlan}>Set as my plan</button>
              <button type="button" style={approvalCancelStyle} onClick={() => { setPendingPlan(null); setOutput((current) => `${current}\nKept the plan as it was.`); }}>Dismiss</button>
            </div>
          </div>}{pendingScript && <div style={scriptApprovalStyle} role="alertdialog" aria-label="Run this script">
            <div style={approvalTextStyle}>
              <strong>Run this script?</strong>
              <span>{pendingScript.code.split(/\r?\n/).length} lines — written into {root}, run with {pendingScript.interpreter === "auto" ? "the language it is written in" : pendingScript.interpreter}, then deleted.</span>
              <span style={scriptHintStyle}>A script runs with your access, so it can change files outside this folder too. {SCRIPT_HINT}</span>
              <pre style={scriptPreviewStyle}>{pendingScript.code.split(/\r?\n/).slice(0, 6).join("\n")}</pre>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Run with
                <select
                  value={pendingScript.interpreter}
                  onChange={(event) => setPendingScript((current) => (current ? { ...current, interpreter: event.target.value } : current))}
                  style={scriptSelectStyle}
                  aria-label="Interpreter for this script"
                >
                  <option value="auto">auto</option>
                  {SCRIPT_INTERPRETERS.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>
            <div style={approvalActionsStyle}>
              <button type="button" style={approvalAllowStyle} onClick={() => void runScript(pendingScript)}>Run it</button>
              <button type="button" style={approvalCancelStyle} onClick={() => { setPendingScript(null); setOutput((current) => `${current}\nCancelled — the script was not run.`); }}>Cancel</button>
            </div>
          </div>}{staged.length > 0 && <div style={stagedStyle} aria-label="Commands that run after this one"><span>{staged.length} more {staged.length === 1 ? "command" : "commands"} run after this one</span><button type="button" style={stagedClearStyle} onClick={() => setStaged([])} title="Do not run the rest of the block">Clear</button></div>}<form onSubmit={(event) => { event.preventDefault(); queueCommand(); }}><span title={terminalSession?.cwd}>{prompt}</span><textarea rows={1} autoComplete="off" spellCheck="false" value={commandText} onChange={(event) => setCommandText(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                queueCommand();
                return;
              }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              const nextIndex = Math.min(history.length - 1, historyIndex + 1);
              setHistoryIndex(nextIndex);
              if (nextIndex >= 0) setCommandText(history[history.length - 1 - nextIndex]);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              const nextIndex = historyIndex - 1;
              setHistoryIndex(nextIndex);
              setCommandText(nextIndex >= 0 ? history[history.length - 1 - nextIndex] : "");
            }
          }} placeholder={busy ? "Type the next command while this one runs…" : "git status · cat file · ls · pwd · npm install · node app.js · clear"} aria-label="Work Terminal command" style={commandInputStyle} /><button type="submit" disabled={!commandText.trim()} title={commandText.trim() ? "" : "Type a command first"}>{busy ? "Queue" : "Run"}</button></form></div>}
        </div>
      )}
    </section>
  );
}
