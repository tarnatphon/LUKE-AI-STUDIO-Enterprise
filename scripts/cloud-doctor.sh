#!/usr/bin/env bash
#
# LUKE AI STUDIO — cloud brain doctor.
#
#     bash scripts/cloud-doctor.sh
#
# Finds the Node the app ships with first, because a Mac that has never had a
# system Node installed still has to be able to run this. Everything else is
# passed through to the doctor itself (--json, for instance).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_BIN=""

for candidate in \
  "$ROOT/app/tools/node-mac/bin/node" \
  "$ROOT/app/tools/node-linux/bin/node" \
  "$ROOT/app/tools/node-win/node.exe"
do
  if [[ -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [[ -z "$NODE_BIN" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  else
    echo "cloud doctor needs Node.js. Run ./mac.sh once so the app downloads its own, then try again." >&2
    exit 2
  fi
fi

exec "$NODE_BIN" "$SCRIPT_DIR/cloud-doctor.cjs" "$@"
