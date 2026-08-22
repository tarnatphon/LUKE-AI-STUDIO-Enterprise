#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Installing / repairing macOS whisper.cpp speech backend..."
bash scripts/setup/setup-whisper.sh
echo ""
echo "Done. You can relaunch Uncensored Local Studio."
read -rp "Press Enter to close..." || true
