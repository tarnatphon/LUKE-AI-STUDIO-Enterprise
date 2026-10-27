import React from "react";
import { AlertTriangle, CheckCircle2, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { BUILD_STATE_TH, diagnoseBuild } from "../lib/build-info.mjs";

/**
 * One line that answers "am I looking at the build I just made?".
 *
 * A stale bundle is indistinguishable from a broken feature, and the only way
 * to tell them apart used to be opening devtools and comparing chunk hashes.
 * This prints the commit the bundle was built from, and when the server says
 * something different it prints the fix instead.
 */
export default function BuildStamp({ health = null, compact = false, className = "" }) {
  const diagnosis = diagnoseBuild({ health });
  const { state, label, detail, hint } = diagnosis;
  const Icon = state === "ok" ? CheckCircle2
    : state === "info" ? GitCommitHorizontal
    : state === "unknown" ? GitCommitHorizontal
    : AlertTriangle;
  const problem = state === "stale" || state === "cached";

  const title = [
    `รุ่นที่ build: ${label}`,
    detail,
    hint && `วิธีแก้: ${hint}`,
    problem ? "" : "",
  ].filter(Boolean).join("\n");

  return (
    <div
      className={`build-stamp ${state}${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
      title={title}
      data-build-state={state}
      data-build-commit={label}
    >
      <Icon size={11} aria-hidden="true" />
      <span className="build-stamp-label">{label}</span>
      <span className="build-stamp-state">{BUILD_STATE_TH[state] || state}</span>
      {problem && hint && (
        <span className="build-stamp-hint">
          <RefreshCw size={10} aria-hidden="true" /> {hint}
        </span>
      )}
    </div>
  );
}
