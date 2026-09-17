import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, GitPullRequest, LoaderCircle, RefreshCw, X } from "lucide-react";

/**
 * GitHub inside Work.
 *
 * The whole loop lives here: see the connection, pick a repository, read its
 * issues and pull requests, clone it into the granted folder, branch, commit,
 * push and open a pull request.
 *
 * Two promises are visible in the interface itself:
 *
 * - nothing that writes, and nothing that leaves the machine, happens on one
 *   click. The first click asks, the server answers with the exact command it
 *   would run, and the panel shows that command before anything is executed.
 * - the token lives on the server, inside the app folder. It is never shown
 *   back, and the GitHub CLI is offered first because then the app holds no
 *   secret at all.
 *
 * Styling is inline on purpose: this panel must not add to the stylesheet the
 * app ships on first paint.
 */

const styles = {
  panel: {
    width: "380px",
    borderLeft: "1px solid var(--border-color, rgba(255,255,255,.12))",
    background: "var(--md-sys-color-surface-container, #14161a)",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-color, rgba(255,255,255,.12))",
  },
  title: { display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem", fontWeight: 600, margin: 0 },
  body: { padding: "12px 14px", overflowY: "auto", flex: 1, fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: "12px" },
  section: { border: "1px solid var(--border-color, rgba(255,255,255,.12))", borderRadius: "10px", padding: "10px" },
  sectionTitle: { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: ".06em", opacity: 0.7, marginBottom: "8px" },
  row: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
  input: {
    flex: 1,
    minWidth: "120px",
    background: "rgba(255,255,255,.05)",
    border: "1px solid var(--border-color, rgba(255,255,255,.14))",
    borderRadius: "8px",
    padding: "6px 8px",
    color: "inherit",
    fontSize: "0.78rem",
  },
  button: {
    background: "rgba(255,255,255,.08)",
    border: "1px solid var(--border-color, rgba(255,255,255,.16))",
    borderRadius: "8px",
    padding: "6px 10px",
    color: "inherit",
    cursor: "pointer",
    fontSize: "0.76rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  primary: { background: "rgba(80,160,255,.22)", borderColor: "rgba(120,180,255,.5)" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" },
  item: {
    border: "1px solid var(--border-color, rgba(255,255,255,.1))",
    borderRadius: "8px",
    padding: "7px 9px",
    cursor: "pointer",
    background: "transparent",
    textAlign: "left",
    color: "inherit",
    width: "100%",
  },
  itemActive: { borderColor: "rgba(120,180,255,.6)", background: "rgba(80,160,255,.12)" },
  meta: { opacity: 0.65, fontSize: "0.7rem" },
  preview: {
    border: "1px solid rgba(255,190,90,.5)",
    background: "rgba(255,190,90,.1)",
    borderRadius: "8px",
    padding: "9px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.72rem",
    wordBreak: "break-all",
    background: "rgba(0,0,0,.25)",
    padding: "7px",
    borderRadius: "6px",
  },
  error: { color: "#ff9d9d", fontSize: "0.74rem" },
  note: { opacity: 0.7, fontSize: "0.72rem", lineHeight: 1.45 },
};

async function post(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

export default function WorkGithubPanel({ project, onClose }) {
  const folders = useMemo(() => project?.sourceFolders || [], [project?.sourceFolders]);
  const [selectedRoot, setSelectedRoot] = useState(folders[0] || "");
  const [status, setStatus] = useState(null);
  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState("");
  const [issues, setIssues] = useState([]);
  const [pulls, setPulls] = useState([]);
  const [local, setLocal] = useState(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [branch, setBranch] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [directory, setDirectory] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (folders.length && !folders.includes(selectedRoot)) setSelectedRoot(folders[0]);
  }, [folders, selectedRoot]);

  const scopedBody = useCallback(
    (extra = {}) => ({
      ...extra,
      root: selectedRoot,
      projectId: project?.id,
      grantId: project?.folderGrants?.[selectedRoot],
    }),
    [project, selectedRoot],
  );

  const refreshStatus = useCallback(async () => {
    const { data } = await post("/api/work/github/status", { projectId: project?.id });
    setStatus(data?.result || null);
  }, [project?.id]);

  const refreshLocal = useCallback(async () => {
    if (!selectedRoot) return;
    const { data } = await post("/api/work/github/repository", scopedBody());
    setLocal(data?.ok ? data.result : null);
  }, [scopedBody, selectedRoot]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  /**
   * One click asks; the server answers with the exact command. Only a second,
   * explicit click runs it.
   */
  const act = async (endpoint, payload, label) => {
    setBusy(label);
    setError("");
    setNotice("");
    setPreview(null);
    try {
      const answer = await post(endpoint, scopedBody(payload));
      if (answer.status === 403 && answer.data?.requiresApproval) {
        setPreview({ endpoint, payload, preview: answer.data.preview, label });
        return null;
      }
      if (!answer.data?.ok) throw new Error(answer.data?.error || `Could not ${label.toLowerCase()}.`);
      setNotice(`${label} done.`);
      await refreshLocal();
      return answer.data.result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setBusy("");
    }
  };

  const confirm = async () => {
    if (!preview) return;
    const { endpoint, payload, label } = preview;
    setPreview(null);
    await act(endpoint, { ...payload, approvalGranted: true }, label);
  };

  const loadRepos = async () => {
    setBusy("Loading repositories");
    setError("");
    try {
      const { data } = await post("/api/work/github/repos", scopedBody({ limit: 30 }));
      if (!data?.ok) throw new Error(data?.error || "Could not load repositories.");
      setRepos(data.result || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  const loadRemote = async (slug) => {
    const target = String(slug || repo || "").trim();
    if (!target) return;
    setBusy("Loading issues");
    setError("");
    try {
      const [issueAnswer, prAnswer] = await Promise.all([
        post("/api/work/github/issues", scopedBody({ repo: target, limit: 20 })),
        post("/api/work/github/pull-requests", scopedBody({ repo: target, limit: 20 })),
      ]);
      setIssues(issueAnswer.data?.ok ? issueAnswer.data.result : []);
      setPulls(prAnswer.data?.ok ? prAnswer.data.result : []);
      if (!issueAnswer.data?.ok) throw new Error(issueAnswer.data?.error || "Could not load issues.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  const saveToken = async () => {
    setBusy("Saving");
    setError("");
    try {
      const { data } = await post("/api/work/github/token", scopedBody({ token }));
      if (!data?.ok) throw new Error(data?.error || "Could not save the token.");
      setToken("");
      setStatus(data.result?.status || null);
      setNotice("Token saved in the app folder.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  const forgetToken = async () => {
    setBusy("Forgetting");
    setError("");
    try {
      const { data } = await post("/api/work/github/token", scopedBody({ clear: true }));
      setStatus(data?.result?.status || null);
      setNotice("Token deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  const signedIn = Boolean(status?.loggedIn);

  return (
    <aside style={styles.panel} aria-label="GitHub">
      <div style={styles.header}>
        <h3 style={styles.title}>
          <GitBranch size={16} /> GitHub
        </h3>
        <button type="button" style={styles.button} onClick={onClose} aria-label="Close GitHub panel">
          <X size={14} />
        </button>
      </div>

      <div style={styles.body}>
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Connection</div>
          <div style={styles.row}>
            <span>
              {status
                ? signedIn
                  ? `Signed in as ${status.login || "you"} · ${status.mode === "gh-cli" ? "GitHub CLI" : "token"}`
                  : status.mode === "none"
                    ? "Not connected"
                    : "Connected, but GitHub refused the credentials"
                : "Checking…"}
            </span>
            <button type="button" style={styles.button} onClick={refreshStatus} disabled={Boolean(busy)}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {status?.hint ? <p style={styles.note}>{status.hint}</p> : null}
          {status?.mode === "none" ? (
            <>
              <p style={styles.note}>
                Paste a personal access token below. It is stored inside the app folder — on the same external disk — with
                owner-only permissions, and it is never sent back to this page. It covers everything: reading repositories,
                cloning and pushing private ones, and opening pull requests. The GitHub CLI is optional: if it is ever installed
                and signed in, Work uses it instead.
              </p>
              <div style={styles.row}>
                <input
                  style={styles.input}
                  type="password"
                  value={token}
                  placeholder="github_pat_… or ghp_…"
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                />
                <button type="button" style={styles.button} onClick={saveToken} disabled={Boolean(busy) || !token.trim()}>
                  Save
                </button>
              </div>
            </>
          ) : null}
          {status?.tokenStored ? (
            <div style={styles.row}>
              <button type="button" style={styles.button} onClick={forgetToken} disabled={Boolean(busy)}>
                Forget the saved token
              </button>
            </div>
          ) : null}
        </div>

        {folders.length > 1 ? (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Work folder</div>
            <select style={styles.input} value={selectedRoot} onChange={(event) => setSelectedRoot(event.target.value)}>
              {folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div style={styles.section}>
          <div style={styles.sectionTitle}>This folder</div>
          {local?.isRepo ? (
            <>
              <div>
                Branch <strong>{local.branch || "—"}</strong>
                {local.dirtyCount ? ` · ${local.dirtyCount} changed file(s)` : " · clean"}
                {local.ahead ? ` · ${local.ahead} ahead` : ""}
                {local.behind ? ` · ${local.behind} behind` : ""}
              </div>
              {local.lastCommit ? <div style={styles.meta}>{local.lastCommit}</div> : null}
              {local.remote ? <div style={styles.meta}>{local.remote}</div> : <div style={styles.meta}>No remote yet</div>}
            </>
          ) : (
            <p style={styles.note}>Not a git repository yet. Clone one into this folder below.</p>
          )}
          <div style={{ ...styles.row, marginTop: "8px" }}>
            <input
              style={styles.input}
              value={directory}
              placeholder="folder name"
              onChange={(event) => setDirectory(event.target.value)}
            />
            <input style={styles.input} value={repo} placeholder="owner/name" onChange={(event) => setRepo(event.target.value)} />
            <button
              type="button"
              style={styles.button}
              onClick={() => act("/api/work/github/clone", { repo, directory: directory || undefined }, "Cloning")}
              disabled={Boolean(busy) || !repo.trim()}
            >
              Clone here
            </button>
          </div>
          <p style={styles.note}>A clone always lands inside the granted Work folder — never outside it.</p>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Branch and commit</div>
          <div style={styles.row}>
            <input style={styles.input} value={branch} placeholder="new branch name" onChange={(event) => setBranch(event.target.value)} />
            <button
              type="button"
              style={styles.button}
              onClick={() => act("/api/work/github/branch", { name: branch }, "Branching")}
              disabled={Boolean(busy) || !branch.trim()}
            >
              <GitBranch size={12} /> Branch
            </button>
          </div>
          <div style={{ ...styles.row, marginTop: "6px" }}>
            <input style={styles.input} value={message} placeholder="commit message" onChange={(event) => setMessage(event.target.value)} />
            <button
              type="button"
              style={styles.button}
              onClick={() => act("/api/work/github/commit", { message }, "Committing")}
              disabled={Boolean(busy) || !message.trim()}
            >
              Commit
            </button>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Send to GitHub</div>
          <div style={styles.row}>
            <button
              type="button"
              style={styles.button}
              onClick={() => act("/api/work/github/push", {}, "Pushing")}
              disabled={Boolean(busy) || !local?.isRepo}
            >
              Push
            </button>
            <input style={styles.input} value={prTitle} placeholder="pull request title" onChange={(event) => setPrTitle(event.target.value)} />
            <button
              type="button"
              style={styles.button}
              onClick={() => act("/api/work/github/pull-request", { title: prTitle }, "Opening a pull request")}
              disabled={Boolean(busy) || !local?.isRepo}
            >
              <GitPullRequest size={12} /> Open PR
            </button>
          </div>
        </div>

        {preview ? (
          <div style={styles.preview}>
            <strong>Approve this first</strong>
            <span style={styles.note}>{preview.label} will run exactly this, and nothing else:</span>
            <div style={styles.code}>
              {(preview.preview?.tool || "git")} {(preview.preview?.args || []).join(" ")}
            </div>
            <div style={styles.row}>
              <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={confirm}>
                Run it
              </button>
              <button type="button" style={styles.button} onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Repositories</div>
          <div style={styles.row}>
            <button type="button" style={styles.button} onClick={loadRepos} disabled={Boolean(busy) || !signedIn}>
              <RefreshCw size={12} /> {busy === "Loading repositories" ? "Loading…" : "Load mine"}
            </button>
            <button type="button" style={styles.button} onClick={() => loadRemote(repo)} disabled={Boolean(busy) || !repo.trim()}>
              Issues and PRs
            </button>
          </div>
          {repos.length ? (
            <ul style={{ ...styles.list, marginTop: "8px" }}>
              {repos.map((entry) => (
                <li key={entry.nameWithOwner}>
                  <button
                    type="button"
                    style={{ ...styles.item, ...(repo === entry.nameWithOwner ? styles.itemActive : null) }}
                    onClick={() => {
                      setRepo(entry.nameWithOwner);
                      void loadRemote(entry.nameWithOwner);
                    }}
                  >
                    <div>{entry.nameWithOwner}</div>
                    {entry.description ? <div style={styles.meta}>{entry.description}</div> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {issues.length ? (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Open issues · {repo}</div>
            <ul style={styles.list}>
              {issues.map((issue) => (
                <li key={issue.number} style={styles.item}>
                  <div>
                    #{issue.number} {issue.title}
                  </div>
                  <div style={styles.meta}>{issue.author ? `by ${issue.author}` : ""}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {pulls.length ? (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Open pull requests · {repo}</div>
            <ul style={styles.list}>
              {pulls.map((pull) => (
                <li key={pull.number} style={styles.item}>
                  <div>
                    #{pull.number} {pull.title}
                  </div>
                  <div style={styles.meta}>
                    {pull.headRefName || ""} {pull.author ? `· ${pull.author}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {busy ? (
          <div style={styles.meta}>
            <LoaderCircle size={12} /> {busy}…
          </div>
        ) : null}
        {error ? <div style={styles.error}>{error}</div> : null}
        {notice ? <div style={styles.meta}>{notice}</div> : null}
      </div>
    </aside>
  );
}
