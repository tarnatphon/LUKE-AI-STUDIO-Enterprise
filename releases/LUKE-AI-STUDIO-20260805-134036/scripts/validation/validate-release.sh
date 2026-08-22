#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fail(){ echo "FAIL: $*" >&2; exit 1; }
pass(){ echo "PASS: $*"; }

bash -n "$ROOT/mac.sh" || fail "mac.sh syntax"
bash -n "$ROOT/scripts/setup/setup.sh" || fail "setup.sh syntax"
bash -n "$ROOT/scripts/setup/setup-tts.sh" || fail "setup-tts.sh syntax"
node --check "$ROOT/scripts/server/serve.cjs" || fail "server syntax"
node --check "$ROOT/scripts/updater/update.cjs" || fail "updater syntax"
python3 -m py_compile "$ROOT/scripts/workers/image_to_video_worker.py" || fail "image-to-video worker"
python3 -m py_compile "$ROOT/scripts/workers/install_image_to_video_runtime.py" || fail "image-to-video installer"
[ -f "$ROOT/app/capabilities/image-to-video/manifest.json" ] || fail "capability manifest missing"
[ -f "$ROOT/app/frontend/src/components/ImageToVideo.jsx" ] || fail "ImageToVideo UI missing"
find "$ROOT" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$ROOT" -type f -name '*.pyc' -delete
! [ -d "$ROOT/app/tools/node-mac" ] || fail "stale portable Node runtime present"
pass "release structure and syntax"
