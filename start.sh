#!/usr/bin/env bash
#
# LUKE AI STUDIO - start the app on this machine
#
#   ./start.sh              # macOS → ./mac.sh · Linux → ./linux.sh
#   ./start.sh --help       # ผ่าน flag ต่อให้ launcher ของแพลตฟอร์ม
#
# mac.sh and linux.sh are the real launchers (bundled node, model folders,
# backend binaries, dist self-heal, first-run setup). This wrapper exists so the
# same command works on every machine: on a Mac it must be run from the volume
# that holds the checkout (เช่น /Volumes/AI) and on Linux from the clone.
#
# ถ้าเพิ่ง git pull มา แนะนำรัน ./validate.sh ก่อนหนึ่งรอบ เพื่อ build UI และ
# ตรวจว่า dependency ครบ (แอปจะได้ไม่ต้อง rebuild ตอนเปิด)
#
# หลังเปิดแอป: แท็บ Text Models → โหลดโมเดลก่อนใช้ฟีเจอร์ Local AI ทุกตัว

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

PLATFORM="$(uname -s)"

case "$PLATFORM" in
  Darwin)
    LAUNCHER="$SCRIPT_DIR/mac.sh"
    ;;
  Linux)
    LAUNCHER="$SCRIPT_DIR/linux.sh"
    ;;
  *)
    echo "[start] แพลตฟอร์มนี้ยังไม่รองรับโดยตรง ($PLATFORM) — บน Windows ใช้ windows.bat" >&2
    exit 1
    ;;
esac

if [[ ! -f "$LAUNCHER" ]]; then
  echo "[start] ไม่พบ $(basename "$LAUNCHER") ในโฟลเดอร์นี้ — ตรวจว่าอยู่ในโฟลเดอร์เรโปที่ถูกต้อง" >&2
  exit 1
fi

if [[ "$PLATFORM" == "Darwin" ]]; then
  # A checkout on an external volume is the normal setup on a Mac, and macOS
  # refuses to execute a script there via double-click while still allowing it
  # from a terminal — say so instead of failing with "Operation not permitted".
  if [[ "$SCRIPT_DIR" == /Volumes/* ]] && [[ ! -x "$LAUNCHER" ]]; then
    chmod +x "$LAUNCHER" 2>/dev/null || true
  fi
  if [[ ! -d "$SCRIPT_DIR/app/frontend/node_modules" ]]; then
    echo "[start] ยังไม่ได้ติดตั้ง dependency ของ frontend — รัน ./validate.sh ก่อนสักรอบ" >&2
  fi
fi

echo "[start] $(basename "$LAUNCHER") · $SCRIPT_DIR"
exec "$LAUNCHER" "$@"
