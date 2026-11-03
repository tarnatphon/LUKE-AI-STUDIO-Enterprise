import React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

/**
 * The strip shown at the top of Edit project when /api/work/folder/restore
 * could not grant one or more saved folders (usually because the folder was
 * moved or deleted). It names each path and the reason, then offers one button
 * to forget all of them at once. Nothing is deleted from disk.
 *
 * Kept presentational so the validation suite can render it without a browser.
 */
export default function MissingFoldersBanner({ entries = [], onForget }) {
  if (entries.length === 0) return null;
  return (
    <div className="chat-project-missing" data-testid="missing-folders-banner" role="status">
      <div className="chat-project-missing-head">
        <AlertTriangle size={16} />
        <strong>
          {entries.length} saved folder{entries.length === 1 ? "" : "s"} could not be granted
        </strong>
      </div>
      <ul className="chat-project-missing-list">
        {entries.map((entry) => (
          <li key={entry.root}>
            <span title={entry.root}>{entry.root}</span>
            <small>{entry.error}</small>
          </li>
        ))}
      </ul>
      <div className="chat-project-missing-actions">
        <button
          type="button"
          className="chat-project-forget"
          data-testid="forget-missing-folders"
          onClick={onForget}
        >
          <Trash2 size={15} /> Forget missing folders
        </button>
        <span>Removes these saved paths from this project immediately. Files on disk are not deleted.</span>
      </div>
    </div>
  );
}
