import React, { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, SquareTerminal, Trash2, X } from "lucide-react";

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
const queueStatusStyle = { flex: "0 0 auto", color: "#67d391", fontSize: ".62rem", whiteSpace: "nowrap" };
const MAX_SAVED_DRAFT_CHARS = 8000;
const MAX_SAVED_HISTORY = 50;

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

export default function WorkTerminalDock({ project, onClose }) {
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
    void fetch("/api/work/terminal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root, projectId: project?.id, grantId: project?.folderGrants?.[root] }),
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start Work Terminal in this folder.");
      if (!active) return;
      setTerminalSession(data.session);
      setOutput(`${data.session.changeDirectoryCommand}\n${data.session.prompt}`);
    }).catch((error) => {
      if (!active) return;
      setTerminalSession(null);
      setOutput(error instanceof Error ? error.message : String(error));
    });
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
    const receiveCommand = (event) => setCommandText(String(event.detail?.command || ""));
    window.addEventListener("luke:work-terminal-command", receiveCommand);
    return () => window.removeEventListener("luke:work-terminal-command", receiveCommand);
  }, []);

  const executeCommand = useCallback(async (command) => {
    if (!root || !command) return;
    setBusy(true);
    setActiveCommand(command);
    setHistory((current) => [...current.filter((item) => item !== command), command].slice(-50));
    setHistoryIndex(-1);
    setOutput((current) => `${current ? `${current}\n` : ""}${prompt} ${command}\nRunning…`);
    try {
      const response = await fetch("/api/work/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root, command, projectId: project?.id, grantId: project?.folderGrants?.[root] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Work command failed.");
      setOutput((current) => current.replace(/Running…$/, data.result?.output || "No output."));
    } catch (error) {
      setOutput((current) => current.replace(/Running…$/, error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }, [root, project, prompt]);

  useEffect(() => {
    if (busy || !root || commandQueue.length === 0) return;
    const [nextCommand] = commandQueue;
    setCommandQueue((current) => current.slice(1));
    void executeCommand(nextCommand);
  }, [busy, commandQueue, executeCommand, root]);

  const queueCommand = () => {
    const command = commandText.trim();
    if (!root || !command) return;
    if (command === "clear") {
      setOutput("");
      setCommandText("");
      return;
    }
    setCommandQueue((current) => [...current, command].slice(-50));
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
          {!root ? <div className="work-terminal-dock-empty">Add a source folder to this Work project to enable Terminal.</div> : <div className="work-terminal-session"><pre aria-live="polite">{output}</pre>{commandQueue.length > 0 && <div className="work-terminal-command-queue" style={queueStyle} aria-label="Queued Terminal commands"><strong style={queueHeadingStyle}>Queued</strong>{commandQueue.map((command, index) => <div style={queueItemStyle} key={`${command}-${index}`}><code style={queueCodeStyle}>{command}</code><button style={queueRemoveStyle} type="button" onClick={() => setCommandQueue((current) => current.filter((_, itemIndex) => itemIndex !== index))} title={`Remove queued command ${command}`}><Trash2 size={13} /></button></div>)}</div>}<form onSubmit={(event) => { event.preventDefault(); queueCommand(); }}><span title={terminalSession?.cwd}>{prompt}</span><input autoComplete="off" spellCheck="false" value={commandText} onChange={(event) => setCommandText(event.target.value)} onKeyDown={(event) => {
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
          }} placeholder={busy ? "Type the next command while this one runs…" : "git status, cat file, head/tail file, clear…"} aria-label="Work Terminal command" /><button type="submit" disabled={!commandText.trim()}>{busy ? "Queue" : "Run"}</button></form></div>}
        </div>
      )}
    </section>
  );
}
