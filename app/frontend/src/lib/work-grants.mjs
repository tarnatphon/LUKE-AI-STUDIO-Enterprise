/**
 * Work project folders live in the browser (they are part of the project the
 * user saved), but the permission that lets the server read them lives in the
 * server's memory and is gone after a restart.
 *
 * Instead of sending the user back into "Edit project" after every launch, the
 * folders a project already saved are re-granted for this session — the same
 * folders, still nothing else.
 */

/**
 * A grant id written down by an earlier session is worth nothing: the server
 * keeps permissions in memory and forgets them when it restarts, while the
 * project — saved in the browser — still lists a folder with an id attached.
 * Trusting that id is how Work ended up permanently "needing permission":
 * nothing looked missing, so nothing was ever re-granted.
 *
 * So only a grant this session actually received counts. Folders whose id came
 * from storage are unknown here, so they are granted again — cheap,
 * idempotent, and limited to the folders the project itself already named.
 */
export function missingGrants(project) {
  const roots = Array.isArray(project?.sourceFolders) ? project.sourceFolders : [];
  return roots.filter((root) => Boolean(root) && !project?.sessionGrants?.[root]);
}

/** Permissions are granted again when the user asks, whatever was remembered. */
export function allProjectFolders(project) {
  const roots = Array.isArray(project?.sourceFolders) ? project.sourceFolders : [];
  return roots.filter((root) => Boolean(root));
}

/**
 * Permissions are session state, so they are stripped before a project is
 * written down. Saving a grant id is what made the app believe it still had
 * access after a restart: nothing looked missing, so nothing was re-granted,
 * and every Work panel stayed dead until the folder was granted by hand.
 */
export function stripGrants(project) {
  if (!project || typeof project !== "object") return project;
  if (Object.keys(project.folderGrants || {}).length === 0 && Object.keys(project.sessionGrants || {}).length === 0) return project;
  return { ...project, folderGrants: {}, sessionGrants: {} };
}

export async function restoreProjectGrants(project, { force = false } = {}) {
  // A button press must always be able to unstick a folder, so it ignores what
  // the project remembers and re-grants every folder it names.
  const missing = force ? allProjectFolders(project) : missingGrants(project);
  if (!project?.id || missing.length === 0) return { grants: {}, failed: [] };
  const response = await fetch("/api/work/folder/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: project.id, roots: missing }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not restore folder access.");
  return { grants: data.grants || {}, failed: data.failed || [] };
}

/**
 * Turn the server's `failed` array into a small, safe list for the UI.
 * The endpoint returns `{ root, error }`; a hand-edited or older reply could
 * contain anything, so nothing here is trusted as a path without being trimmed,
 * and duplicate roots are collapsed.
 */
export function normaliseFailedFolders(failed) {
  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(failed) ? failed : []) {
    const root = String(item?.root || "").trim();
    const error = String(item?.error || "").trim();
    if (!root || seen.has(root)) continue;
    seen.add(root);
    entries.push({ root, error: error || "This folder could not be granted." });
  }
  return entries;
}

/**
 * Only failures for folders the project STILL saves are worth showing. A
 * failure left over from a folder the user already removed is stale — without
 * this filter "Forget missing folders" would come back after being used.
 */
export function missingFolderEntries(project, failures = []) {
  const saved = new Set(allProjectFolders(project));
  return normaliseFailedFolders(failures).filter((entry) => saved.has(entry.root));
}

/**
 * Drop folders from a project without touching anything on disk. Returns the
 * grant ids that should be revoked, so the caller never has to guess which
 * ones belonged to the forgotten paths.
 */
export function pruneProjectFolders(project, roots = []) {
  const doomed = new Set((Array.isArray(roots) ? roots : []).map(String));
  if (!project || doomed.size === 0) return { project, grantIds: [], removed: [] };
  const grantIds = [];
  const prune = (map) => Object.fromEntries(
    Object.entries(map || {}).filter(([root]) => !doomed.has(root)),
  );
  for (const [root, grantId] of Object.entries(project.folderGrants || {})) {
    if (doomed.has(root) && grantId) grantIds.push(grantId);
  }
  const sourceFolders = allProjectFolders(project);
  return {
    project: {
      ...project,
      sourceFolders: sourceFolders.filter((root) => !doomed.has(root)),
      folderGrants: prune(project.folderGrants),
      sessionGrants: prune(project.sessionGrants),
    },
    grantIds,
    removed: sourceFolders.filter((root) => doomed.has(root)),
  };
}

/** The whole "Forget missing folders" click, as a pure plan. */
export function forgetMissingFolders(project, failures = []) {
  const entries = missingFolderEntries(project, failures);
  const pruned = pruneProjectFolders(project, entries.map((entry) => entry.root));
  return { entries, roots: pruned.removed, project: pruned.project, grantIds: pruned.grantIds };
}

/** Merge freshly restored grant ids into one project. */
export function withRestoredGrants(project, grants) {
  const entries = Object.entries(grants || {});
  if (!entries.length) return project;
  const merged = { ...(project?.folderGrants || {}) };
  const session = { ...(project?.sessionGrants || {}) };
  for (const [root, grantId] of entries) {
    merged[root] = grantId;
    // Marked so a launch restores each folder once instead of every render —
    // and so a remembered id from a dead session is never trusted again.
    session[root] = true;
  }
  return { ...project, folderGrants: merged, sessionGrants: session };
}
