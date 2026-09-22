#!/usr/bin/env bash
#
# LUKE AI STUDIO - undo the skip-worktree arrangement, and finish one migration
#
# This script used to mark state files "skip-worktree" so git would stop
# comparing them. That kept `git status` quiet, but it did not stop an update
# from needing the file: when one did, `git pull --ff-only` was refused, and the
# usual remedy could not clear it, because git will not match a skip-worktree
# pathspec and answers
#
#   error: pathspec '...' did not match any file(s) known to git
#
# The arrangement is no longer needed. Nothing under app/runtime-state is
# tracked, and the one tracked config file the app used to rewrite -
# app/config/llm-model-settings.json - now writes to app/runtime-state instead,
# reading the tracked copy only as a seed. So there is nothing left to hide from
# git, and hiding it was the thing that broke updates.
#
# What this script does now, idempotently:
#
#   1. clears any skip-worktree flag it previously set, so ordinary git works
#   2. for llm-model-settings.json, if this machine has settings saved into the
#      tracked copy, moves them to app/runtime-state and restores the tracked
#      copy - which is where the app reads and writes them from now on
#
# Run automatically by mac.sh. Safe to run by hand, and safe to run twice.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT_DIR" || exit 0

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

SETTINGS_SEED="app/config/llm-model-settings.json"
SETTINGS_STATE="app/runtime-state/llm-model-settings.json"

# ── 1. release every skip-worktree flag ──────────────────────────────────────

cleared=0
while IFS= read -r line; do
  # `git ls-files -v` prefixes a skip-worktree entry with "S ".
  file="${line#S }"
  [[ -n "$file" ]] || continue
  if git update-index --no-skip-worktree -- "$file" >/dev/null 2>&1; then
    cleared=$((cleared + 1))
  fi
done < <(git ls-files -v -- app/runtime-state app/config 2>/dev/null | grep '^S ')

if [[ "$cleared" -gt 0 ]]; then
  echo "  [git] released $cleared file(s) git had been told to ignore (updates work normally again)"
fi

# ── 2. move this machine's model settings out of the tracked copy ─────────────
#
# The app used to save them into app/config, which is in git. It reads that file
# as a seed and writes to app/runtime-state now, so a machine that already has
# settings there keeps them either way - this just puts them where they belong
# and leaves the tracked copy as it was committed.

if [[ -f "$SETTINGS_SEED" ]]; then
  if [[ -n "$(git status --porcelain -- "$SETTINGS_SEED" 2>/dev/null)" ]]; then
    if [[ ! -f "$SETTINGS_STATE" ]]; then
      mkdir -p "$(dirname "$SETTINGS_STATE")"
      if cp -p "$SETTINGS_SEED" "$SETTINGS_STATE" 2>/dev/null; then
        echo "  [git] moved this machine's model settings to $SETTINGS_STATE"
      fi
    fi

    # Only restore once the settings are safely elsewhere, or not needed.
    if [[ -f "$SETTINGS_STATE" ]]; then
      git checkout -- "$SETTINGS_SEED" >/dev/null 2>&1 \
        && echo "  [git] restored $SETTINGS_SEED to its committed state"
    fi
  fi
fi

# ── 3. say so only when there was something to say ───────────────────────────

if [[ "$cleared" -eq 0 ]]; then
  echo "  [git] nothing tracked is hidden from git on this machine."
fi

exit 0
