#!/usr/bin/env bash
#
# LUKE AI STUDIO - keep machine state out of git
#
# LUKE AI STUDIO runs from a git checkout on the user's own disk. While it is
# used it rewrites its own state: storage watcher files, model settings, job
# queues, conversation history. Those files are unique to this machine, so if
# git keeps tracking their contents every `git pull` fails with:
#
#   error: Your local changes to the following files would be overwritten by
#   merge: app/config/text-chat/model-arena-policy.json
#
# This script marks the state files as "skip-worktree": they stay on disk and
# the app keeps using them, but git stops comparing them, so updates never
# collide with normal usage. Run it once per machine - it is idempotent.

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

FILES="$(git ls-files app/runtime-state 2>/dev/null)"

for extra in \
  app/config/text-chat/model-arena-policy.json \
  app/config/llm-model-settings.json \
  app/config/text-chat/model-memory-budget.json; do
  if git ls-files --error-unmatch "$extra" >/dev/null 2>&1; then
    FILES="$FILES
$extra"
  fi
done

if [[ -z "$FILES" ]]; then
  exit 0
fi

COUNT="$(printf '%s\n' "$FILES" | grep -c . || true)"

printf '%s\n' "$FILES" | while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  git update-index --skip-worktree -- "$file" >/dev/null 2>&1 || true
done

echo "  [git] $COUNT machine-state files are ignored locally (git pull stays fast)."

exit 0
