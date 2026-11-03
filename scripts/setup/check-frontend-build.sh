#!/usr/bin/env bash
#
# LUKE AI STUDIO — make sure the served frontend belongs to THIS checkout.
#
# mac.sh and linux.sh call this AFTER the node_modules dependency guard and
# AFTER first-time setup has had a chance to install dependencies and build.
# That ordering is deliberate: a rebuild can never be attempted on a broken
# dependency folder, so vite.config.js never has a chance to die with a
# swallowed ERR_MODULE_NOT_FOUND.
#
# vite.config.js stamps `git rev-parse HEAD` into app/dist/build-info.json.
# serve.cjs reports `frontend.stale` when that stamp differs from the checkout,
# but the launchers never used to look at it: after `git pull` the browser kept
# the previous version's bundle while everything still said "Running!".
#
# Exit codes: 0 = bundle is good (or there is no git to compare against),
#             1 = the bundle could not be brought up to date (do not launch).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="$ROOT_DIR/app"
FRONTEND_DIR="$APP_DIR/frontend"
DIST_DIR="$APP_DIR/dist"
DIST_INDEX="$DIST_DIR/index.html"
BUILD_INFO="$DIST_DIR/build-info.json"
MANIFEST="$DIST_DIR/.vite/manifest.json"

PLATFORM="$(uname -s)"
if [[ "$PLATFORM" == "Darwin" ]]; then
  LAUNCHER="./mac.sh"
  NODE_DIR="$APP_DIR/tools/node-mac"
else
  LAUNCHER="./linux.sh"
  NODE_DIR="$APP_DIR/tools/node-linux"
fi
NODE_BIN="$NODE_DIR/bin/node"
NPM_CLI="$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js"

# ── No git → nothing honest to compare ─────────────────────────────────────
# A zip/exported source tree has no .git, and rev-parse fails there. Offline
# first: skip quietly rather than blocking the app or attempting a rebuild.
if ! command -v git >/dev/null 2>&1; then
  exit 0
fi
HEAD_COMMIT="$(git -C "$ROOT_DIR" rev-parse --verify HEAD 2>/dev/null || true)"
if [[ -z "$HEAD_COMMIT" ]]; then
  exit 0
fi
SHORT="${HEAD_COMMIT:0:7}"

read_stamp_commit() {
  [[ -f "$BUILD_INFO" ]] || return 0
  sed -n 's/^[[:space:]]*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BUILD_INFO" | head -1
}

STAMP_COMMIT="$(read_stamp_commit)"

# ── Decide whether a rebuild is needed ─────────────────────────────────────
NEEDS_BUILD=0
REASON=""

if [[ ! -f "$DIST_INDEX" ]]; then
  NEEDS_BUILD=1
  REASON="app/dist/index.html is missing"
elif [[ ! -f "$BUILD_INFO" ]]; then
  NEEDS_BUILD=1
  REASON="app/dist/build-info.json is missing"
elif [[ -z "$STAMP_COMMIT" ]]; then
  NEEDS_BUILD=1
  REASON="the bundle has no commit stamp"
elif [[ "$STAMP_COMMIT" != "$HEAD_COMMIT" ]]; then
  NEEDS_BUILD=1
  REASON="bundle was built from ${STAMP_COMMIT:0:7}, checkout is $SHORT"
elif [[ ! -f "$MANIFEST" ]]; then
  NEEDS_BUILD=1
  REASON="the build manifest is missing"
else
  # index.html names only the entry point. The authoritative list of emitted
  # files (code-split chunks for Asset Library, Settings, Generator, ...) is
  # the manifest vite writes beside the output. Only "file" and the
  # "css"/"assets" arrays name emitted files — "src" names source paths under
  # node_modules, which would make us rebuild on every launch.
  while IFS= read -r asset; do
    [[ -z "$asset" ]] && continue
    if [[ ! -f "$DIST_DIR/$asset" ]]; then
      NEEDS_BUILD=1
      REASON="a bundle asset is missing ($asset)"
      break
    fi
  done < <(tr -d ' \t\n' < "$MANIFEST" \
    | grep -oE '"file":"[^"]*"|"(css|assets)":\[[^]]*\]' \
    | grep -oE '"[^"]+\.[a-zA-Z0-9]+"' | tr -d '"' | sort -u)
fi

if [[ "$NEEDS_BUILD" == "0" ]]; then
  echo "  [dist] Frontend bundle matches $SHORT."
  exit 0
fi

echo "  [dist] $REASON — rebuilding the frontend."

fail_rebuild() {
  echo "" >&2
  echo "  [ERROR] $1" >&2
  echo "          LUKE will not serve a bundle that does not belong to $SHORT." >&2
  echo "" >&2
  echo "  Rebuild by hand, then start the app again:" >&2
  echo "      cd \"$FRONTEND_DIR\"" >&2
  echo "      npm ci" >&2
  echo "      npm run build" >&2
  echo "      cd \"$ROOT_DIR\" && $LAUNCHER" >&2
  echo "" >&2
  exit 1
}

# ── Never rebuild on a broken dependency folder ────────────────────────────
# The launchers already refuse to create a node_modules symlink to an empty
# folder, but this helper is also callable on its own. Checking here makes it
# impossible to turn a missing vite into a cryptic config-load error.
if [[ ! -f "$FRONTEND_DIR/node_modules/vite/package.json" \
   || ! -f "$FRONTEND_DIR/node_modules/vite/bin/vite.js" ]]; then
  fail_rebuild "Cannot rebuild: vite is missing from app/frontend/node_modules."
fi

# Prefer the bundled portable npm: the launchers only export NODE_DIR/bin when
# they actually start the server, which happens after this check.
if [[ -x "$NODE_BIN" && -f "$NPM_CLI" ]]; then
  BUILD_CMD=("$NODE_BIN" "$NPM_CLI" run build)
elif command -v npm >/dev/null 2>&1; then
  BUILD_CMD=(npm run build)
else
  fail_rebuild "No npm is available to rebuild the frontend."
fi

if ! (cd "$FRONTEND_DIR" && "${BUILD_CMD[@]}"); then
  fail_rebuild "Frontend rebuild failed (npm run build)."
fi

# A build that exits 0 but leaves the wrong stamp behind is exactly the stale
# UI this check exists to prevent. Verify before allowing the app to launch.
if [[ "$(read_stamp_commit)" != "$HEAD_COMMIT" || ! -f "$DIST_INDEX" ]]; then
  fail_rebuild "Rebuild finished but app/dist/build-info.json still does not match HEAD."
fi

echo "  [dist] Rebuilt at $SHORT."
