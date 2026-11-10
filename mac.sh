#!/usr/bin/env bash
#
# LUKE AI STUDIO - macOS Launcher
# Double-click or run: ./mac.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
PLATFORM="$(uname -s)"

if [[ "$PLATFORM" != "Darwin" ]]; then
  echo "[ERROR] This script is for macOS only. Please run ./linux.sh on Linux." >&2
  exit 1
fi

# ── Keep machine state out of git so updates never collide with local usage ──
if [[ -f "$SCRIPT_DIR/scripts/setup/git-local-state.sh" ]]; then
  bash "$SCRIPT_DIR/scripts/setup/git-local-state.sh" || true
fi


# Choose where each heavy folder lives (internal SSD vs external SSD). The
# owner decides per folder in storage-layout.conf or Settings → Storage
# locations. This runs BEFORE the frontend freshness check and the server, and
# is deliberately non-fatal: an unmounted external disk must not stop LUKE.
if [[ -f "$SCRIPT_DIR/scripts/setup/storage-layout.sh" ]]; then
  bash "$SCRIPT_DIR/scripts/setup/storage-layout.sh" --apply || true
fi

NODE_DIR="$APP_DIR/tools/node-mac"
NODE_BIN="$NODE_DIR/bin/node"
NPM_CLI="$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js"
BACKEND_PATH="$APP_DIR/backend/mac/sd"
if [[ "$(uname -m)" == "arm64" ]]; then
  LLM_BACKEND_PATH="$APP_DIR/llm-backend/mac/arm64/llama-server"
else
  LLM_BACKEND_PATH="$APP_DIR/llm-backend/mac/x64/llama-server"
fi
TTS_RUNTIME_PATH="$APP_DIR/tts-runtime/node_modules/kokoro-js"
SPEECH_BACKEND_PATH="$APP_DIR/speech-backend/mac/cpu/whisper-cli"
SPEECH_BACKEND_ALT1="$APP_DIR/speech-backend/mac/cpu/whisper-cpp"
SPEECH_BACKEND_ALT2="$APP_DIR/speech-backend/mac/cpu/main"
PLATFORM_LABEL="macOS"

DIST_INDEX="$APP_DIR/dist/index.html"
SETUP_SCRIPT="$SCRIPT_DIR/scripts/setup/setup.sh"

# ── Frontend freshness is checked AFTER the dependency guard ───────────────
# It used to live here as a manifest-only self-heal that called
# `npm run build` with its output swallowed. That ran before the node_modules
# guard, so a broken dependency folder made it fail silently while the app
# cheerfully served the previous bundle. Both checks (commit stamp + emitted
# assets) now live in scripts/setup/check-frontend-build.sh, called after the
# guard and after first-time setup, where vite is guaranteed to be usable.
SERVE_SCRIPT="$SCRIPT_DIR/scripts/server/serve.cjs"

FRONTEND_PORT="${FRONTEND_PORT:-1420}"
LLM_PORT="${LLM_PORT:-10086}"
SETUP_REASON=""
SETUP_MODE="Repair"

# ── Setup node_modules to avoid OS conflicts ────────────────────────────────
FRONTEND_NODE_MODULES="$APP_DIR/frontend/node_modules"
MAC_NODE_MODULES="$APP_DIR/frontend/node_modules_mac"
ACTIVE_OS_FILE="$APP_DIR/frontend/.active_modules_os"

# A node_modules that points at an EMPTY folder is worse than no node_modules
# at all. npm and vite then resolve nothing, `npm run build` dies with
# ERR_MODULE_NOT_FOUND, the self-heal above swallows that error, and the app
# still prints "Running!". That is exactly what happened when node_modules_mac
# was renamed while `node_modules` was a symlink to it: `mkdir -p` + `ln`
# quietly manufactured a brand new empty target on every launch.
#
# So: never create the symlink unless the folder it points at really contains
# vite. A fresh checkout is the exception — it has no dependencies yet and
# setup.sh installs them into the (still empty) link later. The fatal check
# below only fires when setup is NOT going to run, i.e. on an installed
# machine that has lost its dependencies.
has_frontend_deps() {
  [[ -f "$1/vite/package.json" && -f "$1/vite/bin/vite.js" ]]
}
FRONTEND_DEPS_INCOMPLETE=0

# Attempt to create a test symlink to check if filesystem supports symlinks
USE_SYMLINKS=true
TEST_LINK="$APP_DIR/frontend/.test_symlink"
rm -f "$TEST_LINK"
if ln -s "node_modules_mac" "$TEST_LINK" 2>/dev/null; then
  rm -f "$TEST_LINK"
else
  USE_SYMLINKS=false
fi

if [ "$USE_SYMLINKS" = true ]; then
  if [[ -d "$FRONTEND_NODE_MODULES" && ! -L "$FRONTEND_NODE_MODULES" ]]; then
    # `npm install` replaces the symlink with a real directory. Only move that
    # directory in when it is the healthier copy: deleting a complete
    # node_modules_mac to make room for an empty one lost vite just as surely.
    if has_frontend_deps "$FRONTEND_NODE_MODULES" || ! has_frontend_deps "$MAC_NODE_MODULES"; then
      echo "  >> Migrating existing node_modules to node_modules_mac..."
      rm -rf "$MAC_NODE_MODULES"
      mv "$FRONTEND_NODE_MODULES" "$MAC_NODE_MODULES"
    else
      echo "  >> Discarding an incomplete node_modules; node_modules_mac is complete."
      rm -rf "$FRONTEND_NODE_MODULES"
    fi
  fi

  # GUARD: check the target BEFORE creating the symlink.
  if has_frontend_deps "$MAC_NODE_MODULES"; then
    rm -f "$FRONTEND_NODE_MODULES"
    ln -sfn "node_modules_mac" "$FRONTEND_NODE_MODULES"
  else
    rm -f "$FRONTEND_NODE_MODULES"
    FRONTEND_DEPS_INCOMPLETE=1
    echo "  [deps] $MAC_NODE_MODULES has no vite — refusing to link to an empty folder."
    echo "         Setup will reinstall the frontend dependencies."
  fi
else
  # Fallback: Filesystem does not support symlinks (e.g. FAT32/exFAT)
  echo "  >> Filesystem does not support symlinks. Using directory swapping fallback..."
  
  if [[ -L "$FRONTEND_NODE_MODULES" || -f "$FRONTEND_NODE_MODULES" ]]; then
    rm -f "$FRONTEND_NODE_MODULES"
  fi
  
  PREV_OS=""
  if [[ -f "$ACTIVE_OS_FILE" ]]; then
    PREV_OS=$(cat "$ACTIVE_OS_FILE")
  fi
  
  if [[ -d "$FRONTEND_NODE_MODULES" && "$PREV_OS" != "mac" ]]; then
    if [[ -n "$PREV_OS" ]]; then
      echo "  >> Swapping out node_modules to node_modules_$PREV_OS..."
      rm -rf "$APP_DIR/frontend/node_modules_$PREV_OS"
      mv "$FRONTEND_NODE_MODULES" "$APP_DIR/frontend/node_modules_$PREV_OS"
    else
      echo "  >> Saving node_modules as node_modules_windows..."
      rm -rf "$APP_DIR/frontend/node_modules_windows"
      mv "$FRONTEND_NODE_MODULES" "$APP_DIR/frontend/node_modules_windows"
    fi
  fi
  
  if [[ -d "$MAC_NODE_MODULES" && ! -d "$FRONTEND_NODE_MODULES" ]]; then
    echo "  >> Swapping in node_modules_mac..."
    mv "$MAC_NODE_MODULES" "$FRONTEND_NODE_MODULES"
  elif [[ ! -d "$FRONTEND_NODE_MODULES" ]]; then
    mkdir -p "$FRONTEND_NODE_MODULES"
  fi
  
  echo "mac" > "$ACTIVE_OS_FILE"

  # No symlink here, but the same silent failure applies: an empty real
  # directory leaves `vite build` broken with nothing said about it.
  if ! has_frontend_deps "$FRONTEND_NODE_MODULES"; then
    FRONTEND_DEPS_INCOMPLETE=1
    echo "  [deps] $FRONTEND_NODE_MODULES has no vite — setup will reinstall dependencies."
  fi
fi

# ── First-time setup check ─────────────────────────────────────────────────
if [[ ! -d "$NODE_DIR" ]]; then
  SETUP_MODE="First-Time Setup"
fi

if [[ ! -x "$NODE_BIN" || ! -f "$NPM_CLI" ]]; then
  SETUP_REASON="Portable Node.js/npm for macOS is missing or incomplete."
elif ! "$NODE_BIN" "$NPM_CLI" --version >/dev/null 2>&1; then
  SETUP_REASON="Portable npm failed its health check."
fi

if [[ ! -f "$DIST_INDEX" ]]; then
  SETUP_REASON="Frontend build is missing."
fi

if [[ ! -x "$BACKEND_PATH" ]]; then
  SETUP_REASON="No macOS Metal backend binary is installed."
fi
if [[ ! -x "$LLM_BACKEND_PATH" ]]; then
  SETUP_REASON="No macOS llama.cpp text backend is installed."
fi
if [[ ! -d "$TTS_RUNTIME_PATH" ]]; then
  SETUP_REASON="Kokoro text-to-speech runtime is missing."
fi
if [[ ! -x "$SPEECH_BACKEND_PATH" ]]; then
  if [[ -x "$SPEECH_BACKEND_ALT1" ]]; then
    cp "$SPEECH_BACKEND_ALT1" "$SPEECH_BACKEND_PATH" 2>/dev/null || true
    chmod +x "$SPEECH_BACKEND_PATH" 2>/dev/null || true
  elif [[ -x "$SPEECH_BACKEND_ALT2" ]]; then
    cp "$SPEECH_BACKEND_ALT2" "$SPEECH_BACKEND_PATH" 2>/dev/null || true
    chmod +x "$SPEECH_BACKEND_PATH" 2>/dev/null || true
  fi
fi
if [[ ! -x "$SPEECH_BACKEND_PATH" ]]; then
  SETUP_REASON="macOS whisper.cpp speech backend is missing."
fi

# On a machine that is already set up, an incomplete dependency folder has
# nothing left to repair it: setup.sh is not about to run, and the self-heal at
# the top only rebuilds app/dist (which needs vite). Stop with the exact repair
# instead of printing "Running!" over a build chain that cannot build.
#
# A fresh checkout is unaffected: it has no portable Node and/or no app/dist,
# so SETUP_REASON is already set and setup.sh installs the dependencies.
if [[ "$FRONTEND_DEPS_INCOMPLETE" == "1" && -z "$SETUP_REASON" ]]; then
  echo "" >&2
  echo "  [ERROR] Frontend dependencies are incomplete: vite was not found." >&2
  echo "          LUKE will not start with a broken build chain." >&2
  echo "" >&2
  echo "  Repair once, then start again:" >&2
  echo "      cd \"$SCRIPT_DIR/app/frontend\"" >&2
  echo "      rm -rf node_modules" >&2
  echo "      npm ci" >&2
  echo "      cd \"$SCRIPT_DIR\" && ./mac.sh" >&2
  echo "" >&2
  echo "  (npm ci needs the npm cache or a network connection, once.)" >&2
  exit 1
fi

if [[ -n "$SETUP_REASON" ]]; then
  echo ""
  echo "  ============================================================"
  echo "   LUKE AI STUDIO      |  $PLATFORM_LABEL $SETUP_MODE"
  echo "  ============================================================"
  echo ""
  if [[ "$SETUP_MODE" == "First-Time Setup" ]]; then
    echo "  This looks like your first run on macOS. Setting up automatically..."
  else
    echo "  LUKE AI STUDIO needs a quick repair before launch."
  fi
  echo "  Reason: $SETUP_REASON"
  echo "  Models are not downloaded during setup. Download or import them in the app."
  echo ""
  read -rp "  Press Enter to continue, or Ctrl+C to cancel."

  # Clear any existing frontend and backend server processes
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -i:"${FRONTEND_PORT}" -i:8080 -i:"${LLM_PORT}" | xargs kill -9 >/dev/null 2>&1 || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${FRONTEND_PORT}/tcp" >/dev/null 2>&1 || true
    fuser -k "8080/tcp" >/dev/null 2>&1 || true
    fuser -k "${LLM_PORT}/tcp" >/dev/null 2>&1 || true
  fi

  if ! bash "$SETUP_SCRIPT"; then
    echo ""
    echo "  [ERROR] Setup failed. Please check the output above."
    read -rp "  Press Enter to close..."
    exit 1
  fi
fi

# ── Make the served frontend belong to this checkout ───────────────────────
# Called AFTER the node_modules guard and AFTER first-time setup, so a rebuild
# can never run on a broken dependency folder. A `git pull` without a rebuild
# used to leave the browser on the previous version while /api/health reported
# stale: True and the launcher still said "Running!". The helper compares the
# commit stamped into app/dist/build-info.json with HEAD, rebuilds when they
# differ (or an emitted asset is missing), verifies the new stamp, and exits
# non-zero rather than serving a stale UI when it cannot. No .git => skips
# quietly, which keeps zip/offline installs working.
CHECK_FRONTEND_BUILD="$SCRIPT_DIR/scripts/setup/check-frontend-build.sh"
if ! bash "$CHECK_FRONTEND_BUILD"; then
  echo "  [ERROR] Frontend bundle check failed — LUKE will not serve a stale UI." >&2
  exit 1
fi

# ── Offline-first automatic update check ────────────────────────────────────
# Never blocks Local AI when the internet or update server is unavailable.
UPDATER_SCRIPT="$SCRIPT_DIR/scripts/updater/update.cjs"
if [[ -x "$NODE_BIN" && -f "$UPDATER_SCRIPT" ]]; then
  "$NODE_BIN" "$UPDATER_SCRIPT" --launch-check || true
fi

# ── Launch ─────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
echo ""
echo "  ============================================================"
echo "   LUKE AI STUDIO      |  Launching..."
echo "  ============================================================"
echo ""

# Clear frontend and backend ports
if command -v lsof >/dev/null 2>&1; then
  lsof -t -i:"${FRONTEND_PORT}" -i:8080 -i:"${LLM_PORT}" | xargs kill -9 >/dev/null 2>&1 || true
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "${FRONTEND_PORT}/tcp" >/dev/null 2>&1 || true
  fuser -k "8080/tcp" >/dev/null 2>&1 || true
  fuser -k "${LLM_PORT}/tcp" >/dev/null 2>&1 || true
fi

# Start the server
echo "  Starting LUKE AI STUDIO..."
export PATH="$NODE_DIR/bin:$PATH"
export FRONTEND_PORT="$FRONTEND_PORT"

# Run server in background and capture PID
"$NODE_BIN" "$SERVE_SCRIPT" &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Open browser
if command -v open >/dev/null 2>&1; then
  echo "  Opening browser at http://localhost:${FRONTEND_PORT}"
  open "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1 &
else
  echo "  Open your browser to: http://localhost:${FRONTEND_PORT}"
fi

echo ""
echo "  ============================================================"
echo "   Running!"
echo "   Web UI:     http://localhost:${FRONTEND_PORT}"
echo "   GPU API:    Auto-selected by the app (starts at 8080)"
echo "   Text API:   Starts when a GGUF model is loaded (port ${LLM_PORT})"
echo "   Speech:     Managed locally by the app"
echo "   TTS:        Managed locally by the app"
echo ""
echo "   Press Ctrl+C in this window to stop all services."
echo "  ============================================================"
echo ""

# Cleanup on exit
cleanup() {
  echo ""
  echo "  Shutting down..."
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill -TERM "$SERVER_PID" >/dev/null 2>&1 || true
    sleep 1
    kill -KILL "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  echo "  Done. Goodbye!"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Keep script alive
# The backend can ask to be restarted by exiting with 75 (POST /api/restart).
# This loop is what makes that request mean "start again" instead of "the app
# stopped": the launcher owns the process tree and the Ctrl+C trap, so nobody
# else may spawn a replacement without escaping both.
while :; do
  # Capture the status of the *wait*, not of a `|| true` after it — that would
  # always be 0 and the loop would never restart.
  wait "$SERVER_PID"
  RESTART_STATUS=$?
  if [[ "$RESTART_STATUS" -eq 75 ]]; then
    echo ""
    echo "  [restart] the backend asked for a restart — starting it again from this folder"
    echo ""
    "$NODE_BIN" "$SERVE_SCRIPT" &
    SERVER_PID=$!
    sleep 2
    continue
  fi
  break
done
cleanup
