/**
 * Work project folders live in the browser (they are part of the project the
 * user saved), but the permission that lets the server read them lives in the
 * server's memory and is gone after a restart.
 *
 * Instead of sending the user back into "Edit project" after every launch, the
 * folders a project already saved are re-granted for this session — the same
 * folders, still nothing else.
 */

export function missingGrants(project) {
  const roots = Array.isArray(project?.sourceFolders) ? project.sourceFolders : [];
  return roots.filter((root) => Boolean(root) && !project?.folderGrants?.[root]);
}

export async function restoreProjectGrants(project) {
  const missing = missingGrants(project);
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

/** Merge freshly restored grant ids into one project. */
export function withRestoredGrants(project, grants) {
  const entries = Object.entries(grants || {});
  if (!entries.length) return project;
  const merged = { ...(project?.folderGrants || {}) };
  for (const [root, grantId] of entries) merged[root] = grantId;
  return { ...project, folderGrants: merged };
}
