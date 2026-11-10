#!/usr/bin/env bash
#
# LUKE AI STUDIO - Linux Launcher
# Double-click or run: ./linux.sh
# Use --max-perf to enable ROCm backend downloads on Linux first setup.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"

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

PLATFORM="$(uname -s)"

if [[ "$PLATFORM" != "Linux" ]]; then
  echo "[ERROR] This script is for Linux only. Please run ./mac.sh on macOS." >&2
  exit 1
fi

NODE_DIR="$APP_DIR/tools/node-linux"
NODE_BIN="$NODE_DIR/bin/node"
BACKEND_PATH="$APP_DIR/backend/linux/vulkan/sd-vulkan"
CPU_BACKEND_PATH="$APP_DIR/backend/linux/cpu/sd-cpu"
PLATFORM_LABEL="Linux"

DIST_INDEX="$APP_DIR/dist/index.html"
SETUP_SCRIPT="$SCRIPT_DIR/scripts/setup/setup.sh"
SERVE_SCRIPT="$SCRIPT_DIR/scripts/server/serve.cjs"

FRONTEND_PORT="${FRONTEND_PORT:-1420}"
LLM_PORT="${LLM_PORT:-10086}"
SETUP_REASON=""
SETUP_MODE="Repair"
MAX_PERF_FLAG=""
SETUP_OPENVINO=0

# Parse args
for arg in "$@"; do
  case "$arg" in
    --max-perf)
      MAX_PERF_FLAG="--max-perf"
      ;;
    --setup-openvino)
      SETUP_OPENVINO=1
      ;;
    *)
      echo "[ERROR] Unknown option: $arg" >&2
      echo "Usage: ./linux.sh [--max-perf] [--setup-openvino]" >&2
      exit 1
      ;;
  esac
done

if [[ $SETUP_OPENVINO -eq 1 ]]; then
  bash "$SCRIPT_DIR/scripts/setup/setup-openvino-npu.sh"
fi

# ── Setup node_modules to avoid OS conflicts ────────────────────────────────
FRONTEND_NODE_MODULES="$APP_DIR/frontend/node_modules"
LINUX_NODE_MODULES="$APP_DIR/frontend/node_modules_linux"
ACTIVE_OS_FILE="$APP_DIR/frontend/.active_modules_os"

# Same guard as mac.sh: a node_modules symlink to an EMPTY folder is worse
# than none. `npm run build` then dies with ERR_MODULE_NOT_FOUND and the app
# still looks healthy because serve.cjs only serves app/dist. See
# docs/beta7/mac-launcher-deps-guard.md for the full root-cause write-up.
has_frontend_deps() {
  [[ -f "$1/vite/package.json" && -f "$1/vite/bin/vite.js" ]]
}
FRONTEND_DEPS_INCOMPLETE=0

# Attempt to create a test symlink to check if filesystem supports symlinks
USE_SYMLINKS=true
TEST_LINK="$APP_DIR/frontend/.test_symlink"
rm -f "$TEST_LINK"
if ln -s "node_modules_linux" "$TEST_LINK" 2>/dev/null; then
  rm -f "$TEST_LINK"
else
  USE_SYMLINKS=false
fi

if [ "$USE_SYMLINKS" = true ]; then
  if [[ -d "$FRONTEND_NODE_MODULES" && ! -L "$FRONTEND_NODE_MODULES" ]]; then
    # npm install replaces the symlink with a real directory. Only keep that
    # copy when it is the healthier one, so a complete node_modules_linux is
    # never deleted to make room for an empty directory.
    if has_frontend_deps "$FRONTEND_NODE_MODULES" || ! has_frontend_deps "$LINUX_NODE_MODULES"; then
      echo "  >> Migrating existing node_modules to node_modules_linux..."
      rm -rf "$LINUX_NODE_MODULES"
      mv "$FRONTEND_NODE_MODULES" "$LINUX_NODE_MODULES"
    else
      echo "  >> Discarding an incomplete node_modules; node_modules_linux is complete."
      rm -rf "$FRONTEND_NODE_MODULES"
    fi
  fi

  # GUARD: check the target BEFORE creating the symlink.
  if has_frontend_deps "$LINUX_NODE_MODULES"; then
    rm -f "$FRONTEND_NODE_MODULES"
    ln -sfn "node_modules_linux" "$FRONTEND_NODE_MODULES"
  else
    rm -f "$FRONTEND_NODE_MODULES"
    FRONTEND_DEPS_INCOMPLETE=1
    echo "  [deps] $LINUX_NODE_MODULES has no vite — refusing to link to an empty folder."
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
  
  if [[ -d "$FRONTEND_NODE_MODULES" && "$PREV_OS" != "linux" ]]; then
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
  
  if [[ -d "$LINUX_NODE_MODULES" && ! -d "$FRONTEND_NODE_MODULES" ]]; then
    echo "  >> Swapping in node_modules_linux..."
    mv "$LINUX_NODE_MODULES" "$FRONTEND_NODE_MODULES"
  elif [[ ! -d "$FRONTEND_NODE_MODULES" ]]; then
    mkdir -p "$FRONTEND_NODE_MODULES"
  fi
  
  echo "linux" > "$ACTIVE_OS_FILE"

  if ! has_frontend_deps "$FRONTEND_NODE_MODULES"; then
    FRONTEND_DEPS_INCOMPLETE=1
    echo "  [deps] $FRONTEND_NODE_MODULES has no vite — setup will reinstall dependencies."
  fi
fi

# ── First-time setup check ─────────────────────────────────────────────────
if [[ ! -d "$NODE_DIR" ]]; then
  SETUP_MODE="First-Time Setup"
fi

if [[ ! -x "$NODE_BIN" ]]; then
  SETUP_REASON="Portable Node.js for Linux is missing."
fi

if [[ ! -f "$DIST_INDEX" ]]; then
  SETUP_REASON="Frontend build is missing."
fi

# At minimum we need CPU or Vulkan backend on Linux, and both CLI and server binaries must be executable
CPU_SERVER_PATH="$APP_DIR/backend/linux/cpu/sd-server-cpu"
VULKAN_SERVER_PATH="$APP_DIR/backend/linux/vulkan/sd-server-vulkan"
LLM_CUDA_PATH="$APP_DIR/llm-backend/linux/cuda/llama-server"
LLM_ROCM_PATH="$APP_DIR/llm-backend/linux/rocm/llama-server"
LLM_SYCL_PATH="$APP_DIR/llm-backend/linux/sycl/llama-server"
LLM_VULKAN_PATH="$APP_DIR/llm-backend/linux/vulkan/llama-server"
LLM_CPU_PATH="$APP_DIR/llm-backend/linux/cpu/llama-server"
SPEECH_BACKEND_PATH="$APP_DIR/speech-backend/linux/cpu/whisper-cli"
TTS_RUNTIME_PATH="$APP_DIR/tts-runtime/node_modules/kokoro-js"
if [[ ! -x "$CPU_BACKEND_PATH" || ! -x "$CPU_SERVER_PATH" ]] && [[ ! -x "$BACKEND_PATH" || ! -x "$VULKAN_SERVER_PATH" ]]; then
  SETUP_REASON="Linux backend binaries are missing or not executable."
fi
if [[ ! -x "$LLM_CUDA_PATH" && ! -x "$LLM_ROCM_PATH" && ! -x "$LLM_SYCL_PATH" && ! -x "$LLM_VULKAN_PATH" && ! -x "$LLM_CPU_PATH" ]]; then
  SETUP_REASON="Linux llama.cpp text backend is missing or not executable."
fi
if [[ ! -x "$SPEECH_BACKEND_PATH" ]]; then
  SETUP_REASON="Linux whisper.cpp speech backend is missing or not executable."
fi
if [[ ! -d "$TTS_RUNTIME_PATH" ]]; then
  SETUP_REASON="Kokoro text-to-speech runtime is missing."
fi

# On an already installed machine, setup.sh is not about to run and there is
# nothing left to repair the dependency folder. Stop with the exact repair
# instead of launching over a build chain that cannot build. A fresh checkout
# has SETUP_REASON set (no portable Node and/or no app/dist), so setup.sh
# still installs the dependencies there.
if [[ "$FRONTEND_DEPS_INCOMPLETE" == "1" && -z "$SETUP_REASON" ]]; then
  echo "" >&2
  echo "  [ERROR] Frontend dependencies are incomplete: vite was not found." >&2
  echo "          LUKE will not start with a broken build chain." >&2
  echo "" >&2
  echo "  Repair once, then start again:" >&2
  echo "      cd \"$SCRIPT_DIR/app/frontend\"" >&2
  echo "      rm -rf node_modules" >&2
  echo "      npm ci" >&2
  echo "      cd \"$SCRIPT_DIR\" && ./linux.sh" >&2
  echo "" >&2
  echo "  (npm ci needs the npm cache or a network connection, once.)" >&2
  exit 1
fi

# ── Stopping an earlier copy, politely ──────────────────────────────────────
# This used to be `lsof -t -i:1420 -i:8080 -i:10086 | xargs kill -9`. Two
# launcher windows therefore killed each other: the second one SIGKILLed the
# first one's server, which printed "Killed: 9" in a window that was running
# perfectly well, was given no chance to shut anything down, and left its
# llama-server holding port 10086. A second launch should replace the first
# cleanly, and say that it is doing it.
stop_existing_servers() {
  local pids found port pid waited alive
  pids=""
  if command -v lsof >/dev/null 2>&1; then
    for port in "$FRONTEND_PORT" 8080 "$LLM_PORT"; do
      found="$(lsof -t -i:"$port" 2>/dev/null | tr '\n' ' ' || true)"
      pids="$pids $found"
    done
  elif command -v fuser >/dev/null 2>&1; then
    for port in "$FRONTEND_PORT" 8080 "$LLM_PORT"; do
      fuser -k "$port/tcp" >/dev/null 2>&1 || true
    done
    return 0
  else
    return 0
  fi
  # One process can hold several of the ports; ask each PID only once.
  pids="$(printf '%s\n' $pids 2>/dev/null | sort -u | tr '\n' ' ' || true)"
  pids="$(printf '%s' "$pids" | sed -e 's/^ *//' -e 's/ *$//')"
  if [[ -z "$pids" ]]; then
    return 0
  fi
  echo "  >>   An earlier copy is still holding port $FRONTEND_PORT — stopping it: $pids"
  # Ask first. SIGTERM lets the server unload its model and stop llama-server.
  kill $pids 2>/dev/null || true
  waited=0
  while [[ "$waited" -lt 10 ]]; do
    alive=0
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then alive=1; fi
    done
    if [[ "$alive" -eq 0 ]]; then break; fi
    sleep 0.5
    waited=$((waited + 1))
  done
  # Only what refused to go.
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "  >>   PID $pid ignored the request to stop; killing it."
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  return 0
}

if [[ -n "$SETUP_REASON" ]]; then
  echo ""
  echo "  ============================================================"
  echo "   LUKE AI STUDIO      |  $PLATFORM_LABEL $SETUP_MODE"
  echo "  ============================================================"
  echo ""
  if [[ "$SETUP_MODE" == "First-Time Setup" ]]; then
    echo "  This looks like your first run on Linux. Setting up automatically..."
  else
    echo "  LUKE AI STUDIO needs a quick repair before launch."
  fi
  echo "  Reason: $SETUP_REASON"
  echo "  Models are not downloaded during setup. Download or import them in the app."
  echo ""
  read -rp "  Press Enter to continue, or Ctrl+C to cancel."

  # Stop an earlier copy politely — defined above, outside this branch.
  stop_existing_servers

  if ! bash "$SETUP_SCRIPT" $MAX_PERF_FLAG; then
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

stop_existing_servers

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
if command -v xdg-open >/dev/null 2>&1; then
  echo "  Opening browser at http://localhost:${FRONTEND_PORT}"
  xdg-open "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1 &
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
EXIT_STATUS=0
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
  EXIT_STATUS=$RESTART_STATUS
  break
done

# A backend that exits while nobody asked it to has crashed — and saying
# "Shutting down... Done. Goodbye!" for that reads as a normal stop, which is
# how a failed start gets mistaken for a clean one.
if [[ "$EXIT_STATUS" -ne 0 ]]; then
  echo "" >&2
  # A shell reports a killed child as 128+signal, and the difference matters:
  # nothing in this app exits by signal, so a number above 128 means something
  # outside it — the system, or a kill from another window — took the process.
  if [[ "$EXIT_STATUS" -gt 128 ]]; then
    SIGNAL_NUMBER=$((EXIT_STATUS - 128))
    case "$SIGNAL_NUMBER" in
      9)  SIGNAL_NAME="SIGKILL (kill -9, or the system under memory pressure)" ;;
      15) SIGNAL_NAME="SIGTERM (something asked it to stop)" ;;
      11) SIGNAL_NAME="SIGSEGV (it crashed in native code)" ;;
      6)  SIGNAL_NAME="SIGABRT (it aborted)" ;;
      *)  SIGNAL_NAME="signal $SIGNAL_NUMBER" ;;
    esac
    echo "  [error] the backend was killed by $SIGNAL_NAME." >&2
    echo "  [error] It did not exit on its own, so this is not a shutdown: an exit code above 128" >&2
    echo "  [error] means a signal, sent from outside the app." >&2
    if [[ "$SIGNAL_NUMBER" -eq 9 || "$SIGNAL_NUMBER" -eq 15 ]]; then
      echo "  [error] On macOS that is usually memory pressure (the system's own out-of-memory kill)." >&2
      echo "  [error] To see what was resident:   ps aux -m | head -5" >&2
      echo "  [error] To see who was killed:     log show --last 15m | grep -i jetsam | tail -5" >&2
    fi
  else
    echo "  [error] the backend exited with status $EXIT_STATUS without being asked to stop." >&2
    echo "  [error] That is a crash or a failed start, not a shutdown — the log above has the reason." >&2
  fi
  echo "  [error] If a model was loaded, its llama-server may still be running:" >&2
  echo "  [error]   ps aux | grep -c '[l]lama-server'" >&2
  exit "$EXIT_STATUS"
fi

cleanup
