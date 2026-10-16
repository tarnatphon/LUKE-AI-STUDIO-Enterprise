#!/usr/bin/env bash
#
# LUKE AI STUDIO - validate the checkout before running it
#
#   ./validate.sh                  # ติดตั้ง dependency (ถ้ายังไม่มี) → build → รันชุดทดสอบทั้งหมด
#   ./validate.sh --filter social  # ส่ง flag ต่อให้ run-all.cjs ได้ทุกตัว
#   ./validate.sh --include-python # ชุดทดสอบที่ต้องใช้ imageio_ffmpeg
#   ./validate.sh --no-install     # ข้าม npm install
#   ./validate.sh --no-build       # ข้าม vite build
#
# This is the whole gate in one command: the suites under scripts/validation are
# plain node programs that exit non-zero on a failed assertion, and some of them
# read the built UI in app/dist - so a checkout that was never built fails them
# for the wrong reason. The script therefore installs what the suites need,
# builds the frontend once, then hands over to run-all.cjs, which prints one
# line per suite plus a summary and writes a report into validation-reports/.
#
# It never touches app/runtime-state (your own clients and calendar live there),
# so it is safe to run on the machine you actually use.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

RUN_INSTALL=1
RUN_BUILD=1
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --no-install) RUN_INSTALL=0 ;;
    --no-build) RUN_BUILD=0 ;;
    -h|--help)
      sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

fail() {
  echo ""
  echo "[validate] $1" >&2
  exit 1
}

echo "== LUKE AI STUDIO · validate =="

if ! command -v node >/dev/null 2>&1; then
  fail "ต้องมี node ก่อน (ติดตั้ง Node 20+ แล้วรันใหม่) — บน macOS ใช้ ./start.sh เพื่อให้ตัวรันติดตั้ง node ให้เอง"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "node $NODE_MAJOR เก่าเกินไป — ต้องใช้ Node 20 ขึ้นไป"
fi
echo "  [node] $(node --version)"

# ── dependencies: the suites require serve.cjs, so scripts/server needs its
#    packages; the frontend needs vite to build the UI the UI suites read ──
if [[ "$RUN_INSTALL" == "1" ]]; then
  if [[ ! -d "scripts/server/node_modules" ]]; then
    echo "  [deps] scripts/server: npm install (ครั้งแรก)"
    npm install --prefix scripts/server --no-audit --no-fund || fail "ติดตั้ง dependency ของ scripts/server ไม่สำเร็จ"
  else
    echo "  [deps] scripts/server: มีอยู่แล้ว (ข้าม)"
  fi
  if [[ ! -d "app/frontend/node_modules" ]]; then
    echo "  [deps] app/frontend: npm install (ครั้งแรก)"
    (cd app/frontend && npm install --no-audit --no-fund) || fail "ติดตั้ง dependency ของ app/frontend ไม่สำเร็จ"
  else
    echo "  [deps] app/frontend: มีอยู่แล้ว (ข้าม)"
  fi
fi

# ── build: several suites assert against app/dist, and mac.sh/linux.sh both
#    expect a built UI, so build it here rather than let 30 suites fail ──
if [[ "$RUN_BUILD" == "1" ]]; then
  echo "  [build] vite build …"
  (cd app/frontend && npx vite build >/dev/null 2>&1) || fail "vite build ไม่ผ่าน — เปิด log ด้วย: (cd app/frontend && npx vite build)"
  echo "  [build] เสร็จ"
fi

# ── the suites ──
echo "  [tests] node scripts/validation/run-all.cjs ${PASSTHROUGH[*]:-}"
echo ""
node scripts/validation/run-all.cjs "${PASSTHROUGH[@]}"
STATUS=$?

echo ""
if [[ "$STATUS" == "0" ]]; then
  echo "[validate] ผ่านทั้งหมด — เริ่มใช้งานได้ด้วย ./start.sh"
else
  echo "[validate] มีชุดทดสอบที่ไม่ผ่าน (exit $STATUS) — ดูรายละเอียดด้านบนและใน validation-reports/" >&2
fi
exit "$STATUS"
