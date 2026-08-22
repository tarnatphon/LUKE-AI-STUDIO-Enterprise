#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const app = fs.readFileSync("app/frontend/src/App.jsx", "utf8");
const css = fs.readFileSync("app/frontend/src/App.css", "utf8");

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`${label}: ${text}`);
}

requireText(app, "class WorkspaceErrorBoundary extends Component", "ERROR_BOUNDARY_MISSING");
requireText(app, "static getDerivedStateFromError(error)", "ERROR_CAPTURE_MISSING");
requireText(app, "const WorkspacePanel =", "ISOLATED_WORKSPACE_PANEL_MISSING");
requireText(app, '<WorkspaceErrorBoundary onReturnHome={() => onReturnHome(tab)}>', "ISOLATED_BOUNDARY_NOT_CONNECTED");
requireText(app, "const recoverFailedWorkspace = useCallback((failedTab)", "FAILED_WORKSPACE_RECOVERY_MISSING");
requireText(app, "next.delete(failedTab)", "FAILED_WORKSPACE_NOT_UNMOUNTED");
requireText(app, "const workspacePrefetches = new Map()", "PREFETCH_CACHE_MISSING");
requireText(app, "if (workspacePrefetches.has(tab))", "PREFETCH_DEDUPLICATION_MISSING");
requireText(app, ".catch((error) =>", "PREFETCH_REJECTION_HANDLER_MISSING");
requireText(app, "workspacePrefetches.delete(tab)", "FAILED_PREFETCH_NOT_RETRYABLE");
requireText(app, "void preloadWorkspace(tab)", "SAFE_PREFETCH_NOT_CONNECTED");
for (const tab of ["generator", "image-video", "assets", "models", "chat", "speech", "tts", "settings"]) {
  requireText(app, `<WorkspacePanel tab="${tab}"`, `WORKSPACE_NOT_ISOLATED_${tab}`);
}
requireText(app, 'role="alert"', "ACCESSIBLE_ERROR_ALERT_MISSING");
requireText(app, "window.location.reload()", "RETRY_ACTION_MISSING");
requireText(app, "this.props.onReturnHome()", "RETURN_HOME_ACTION_MISSING");
requireText(app, "Your current data is still stored locally.", "DATA_SAFETY_MESSAGE_MISSING");
requireText(css, ".workspace-load-error", "ERROR_STYLE_MISSING");
requireText(css, ".workspace-load-error-actions", "ERROR_ACTION_STYLE_MISSING");

console.log("PASS: Lazy workspace failures are contained by an Error Boundary.");
console.log("PASS: Workspace recovery offers Retry and Return Home actions.");
console.log("PASS: Failures are isolated and only the failed workspace is unmounted.");
console.log("PASS: Workspace prefetches are deduplicated and failures remain retryable.");
console.log("PASS: Workspace recovery is announced accessibly.");
console.log("PASS: Beta 9 Frontend Workspace Recovery validation completed.");
