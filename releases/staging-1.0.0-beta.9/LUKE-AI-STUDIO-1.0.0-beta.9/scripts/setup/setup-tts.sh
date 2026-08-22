#!/usr/bin/env bash
#
# LUKE AI STUDIO - Kokoro TTS setup for Linux/macOS
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
APP_DIR="$ROOT_DIR/app"
TOOLS_DIR="$APP_DIR/tools"
PLATFORM="$(uname -s)"

if [[ "$PLATFORM" == "Darwin" ]]; then
  NODE_DIR="$TOOLS_DIR/node-mac"
else
  NODE_DIR="$TOOLS_DIR/node-linux"
fi

NODE_BIN="$NODE_DIR/bin/node"
NPM_BIN="$NODE_DIR/bin/npm"
NPM_CLI="$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js"
RUNTIME_DIR="$APP_DIR/tts-runtime"
MODELS_DIR="$APP_DIR/tts-models"
OUTPUTS_DIR="$APP_DIR/tts-outputs"
CACHE_DIR="$APP_DIR/tts-cache"

print_ok() { echo "   OK   $1"; }
print_info() { echo "   >>   $1"; }
print_fail() { echo "   XX   $1"; }

echo ""
echo "  ============================================================"
echo "   Setting up Kokoro ONNX Text-to-Speech runtime"
echo "  ============================================================"
echo ""

mkdir -p "$RUNTIME_DIR" "$MODELS_DIR" "$OUTPUTS_DIR" "$CACHE_DIR"

if [[ ! -x "$NODE_BIN" || ! -f "$NPM_CLI" ]]; then
  print_fail "Portable Node.js/npm is incomplete. Run scripts/setup/setup.sh first."
  exit 1
fi
if ! "$NODE_BIN" "$NPM_CLI" --version >/dev/null 2>&1; then
  print_fail "Portable npm failed its health check. Run scripts/setup/setup.sh to repair it."
  exit 1
fi

if [[ ! -f "$RUNTIME_DIR/package.json" ]]; then
  cat > "$RUNTIME_DIR/package.json" <<'JSON'
{"private":true,"type":"module","dependencies":{"kokoro-js":"^1.2.1"}}
JSON
fi

cd "$RUNTIME_DIR"
export PATH="$NODE_DIR/bin:$PATH"
print_info "Installing kokoro-js into app/tts-runtime..."
"$NODE_BIN" "$NPM_CLI" install --prefer-offline --no-audit --no-fund

if [[ ! -d "$RUNTIME_DIR/node_modules/kokoro-js" ]]; then
  print_fail "Kokoro installation finished without creating node_modules/kokoro-js."
  exit 1
fi

print_ok "Kokoro TTS runtime is ready."
