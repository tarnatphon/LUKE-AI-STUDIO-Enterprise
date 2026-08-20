#!/bin/bash

set -u
set -o pipefail

PROJECT_DIR="$(
  CDPATH= cd -- "$(dirname -- "$0")/../.." &&
  pwd
)"

cd "$PROJECT_DIR" || exit 1

VERSION="${LUKE_AI_BUILD_VERSION:-1.0.0-beta.6}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

OUTPUT_ROOT="${LUKE_AI_BUILD_OUTPUT_ROOT:-$PROJECT_DIR/releases}"
RELEASE_DIR="$OUTPUT_ROOT/$VERSION"
STAGING_ROOT="${LUKE_AI_STAGING_ROOT:-$OUTPUT_ROOT/staging-$VERSION}"
PACKAGE_DIR="$STAGING_ROOT/LUKE-AI-STUDIO-$VERSION"

ZIP_FILE="$RELEASE_DIR/LUKE-AI-STUDIO-$VERSION.zip"
SHA_FILE="$ZIP_FILE.sha256"
MANIFEST_FILE="$RELEASE_DIR/latest-$VERSION.json"
NOTES_FILE="$RELEASE_DIR/RELEASE-NOTES.md"
REPORT_FILE="$RELEASE_DIR/BUILD-REPORT.txt"

RUNTIME_METADATA="$PROJECT_DIR/app/tools/node-mac/runtime.json"
VALIDATION_FILE="$PROJECT_DIR/scripts/validation/validate-release.sh"

STATUS=0

log() {
  printf '%s\n' "$1" | tee -a "$REPORT_FILE"
}

find_runtime_cache() {
  local candidate

  while IFS= read -r candidate; do
    if [ -x "$candidate/bin/node" ] \
      && [ -x "$candidate/bin/npm" ] \
      && [ -x "$candidate/bin/npx" ] \
      && [ -f "$candidate/lib/node_modules/npm/package.json" ] \
      && "$candidate/bin/node" --version >/dev/null 2>&1 \
      && "$candidate/bin/npm" --version >/dev/null 2>&1 \
      && "$candidate/bin/npx" --version >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(
    find "$HOME/Library/Caches/LUKE-AI-STUDIO" \
      -type d \
      -name "node-mac-runtime" \
      -print 2>/dev/null |
    while IFS= read -r directory; do
      modified="$(
        stat -f '%m' "$directory" 2>/dev/null ||
        echo 0
      )"

      printf '%s\t%s\n' "$modified" "$directory"
    done |
    sort -nr |
    cut -f2-
  )

  return 1
}

mkdir -p "$RELEASE_DIR"
rm -rf "$STAGING_ROOT"
rm -f "$ZIP_FILE" "$SHA_FILE"

: >"$REPORT_FILE"

log "============================================================"
log " LUKE AI STUDIO - BUILD $VERSION"
log "============================================================"

log ""
log "[1/9] ตรวจ Source Workspace"

# LUKE_AI_BUILD_WORKTREE_POLICY_V2
WORKTREE_STATUS="$(git status --porcelain)"

IGNORED_BUILD_STATUS="$(
  printf '%s\n' "$WORKTREE_STATUS" |
  grep -vE     '^[?][?][[:space:]]+scripts/release/$|^[?][?][[:space:]]+scripts/release/build-beta6\\.sh$|^[ MARC?]{1,2}[[:space:]]+scripts/release/build-beta6\\.sh$' ||
  true
)"

if [ -n "$IGNORED_BUILD_STATUS" ]; then
  log "FAIL: Working Tree มีไฟล์ค้างที่ไม่อนุญาต"
  printf '%s\n' "$IGNORED_BUILD_STATUS" | tee -a "$REPORT_FILE"
  STATUS=1
elif [ -n "$WORKTREE_STATUS" ]; then
  log "NOTICE: อนุญาตเฉพาะ Build Script ที่กำลังทดสอบก่อน Commit"
  printf '%s\n' "$WORKTREE_STATUS" | tee -a "$REPORT_FILE"
else
  log "PASS: Working Tree สะอาด"
fi

if [ ! -f "$RUNTIME_METADATA" ] \
  || ! python3 -m json.tool "$RUNTIME_METADATA" >/dev/null 2>&1; then
  log "FAIL: Runtime Metadata ไม่พร้อม"
  STATUS=1
else
  log "PASS: Runtime Metadata พร้อม"
fi

if [ ! -f "$VALIDATION_FILE" ]; then
  log "FAIL: ไม่พบ Release Validation"
  STATUS=1
fi

log ""
log "[2/9] ค้นหา Portable Runtime Cache"

RUNTIME_CACHE="$(find_runtime_cache || true)"

if [ -n "$RUNTIME_CACHE" ]; then
  log "PASS: Runtime Cache = $RUNTIME_CACHE"
  log "Node: $("$RUNTIME_CACHE/bin/node" --version)"
  log "npm : $("$RUNTIME_CACHE/bin/npm" --version)"
  log "npx : $("$RUNTIME_CACHE/bin/npx" --version)"
else
  log "FAIL: ไม่พบ Portable Runtime Cache ที่สมบูรณ์"
  STATUS=1
fi

log ""
log "[3/9] รัน Source Validation"

if [ "$STATUS" -eq 0 ]; then
  LUKE_AI_PACKAGING_MODE=0 \
    bash "$VALIDATION_FILE" 2>&1 |
    tee -a "$REPORT_FILE"

  VALIDATION_STATUS=${PIPESTATUS[0]}

  if [ "$VALIDATION_STATUS" -eq 0 ]; then
    log "PASS: Source Validation ผ่าน"
  else
    log "FAIL: Source Validation ไม่ผ่าน"
    STATUS=1
  fi
fi

log ""
log "[4/9] สร้าง Clean Staging Package"

if [ "$STATUS" -eq 0 ]; then
  mkdir -p "$PACKAGE_DIR"

  rsync -a \
    --exclude ".git/" \
    --exclude ".DS_Store" \
    --exclude "node_modules/" \
    --exclude "node_modules_mac/" \
    --exclude "app/tools/node-mac/bin/" \
    --exclude "app/tools/node-mac/lib/" \
    --exclude "app/backend/mac/coreml_venv/" \
    --exclude "app/backend/mac/libstable-diffusion.dylib" \
    --exclude "app/backend/mac/sd" \
    --exclude ".venv/" \
    --exclude "venv/" \
    --exclude "__pycache__/" \
    --exclude "*.pyc" \
    --exclude "models/" \
    --exclude "outputs/" \
    --exclude "cache/" \
    --exclude "runtime-logs/" \
    --exclude "validation-reports/" \
    --exclude "backups/" \
    --exclude "releases/" \
    "$PROJECT_DIR/" \
    "$PACKAGE_DIR/"

  log "PASS: Source ถูกคัดลอกเข้า Staging"
fi

log ""
log "[5/9] นำ Portable Runtime เข้า Package"

if [ "$STATUS" -eq 0 ]; then
  mkdir -p "$PACKAGE_DIR/app/tools/node-mac"

  rsync -a \
    --delete \
    "$RUNTIME_CACHE/bin/" \
    "$PACKAGE_DIR/app/tools/node-mac/bin/"

  rsync -a \
    --delete \
    "$RUNTIME_CACHE/lib/" \
    "$PACKAGE_DIR/app/tools/node-mac/lib/"

  cp \
    "$RUNTIME_METADATA" \
    "$PACKAGE_DIR/app/tools/node-mac/runtime.json"

  chmod 755 \
    "$PACKAGE_DIR/app/tools/node-mac/bin/node" \
    "$PACKAGE_DIR/app/tools/node-mac/bin/npm" \
    "$PACKAGE_DIR/app/tools/node-mac/bin/npx"

  if "$PACKAGE_DIR/app/tools/node-mac/bin/node" --version >/dev/null 2>&1 \
    && "$PACKAGE_DIR/app/tools/node-mac/bin/npm" --version >/dev/null 2>&1 \
    && "$PACKAGE_DIR/app/tools/node-mac/bin/npx" --version >/dev/null 2>&1; then
    log "PASS: Portable Runtime ถูกติดตั้งใน Package"
  else
    log "FAIL: Portable Runtime ใน Package ใช้งานไม่ได้"
    STATUS=1
  fi
fi

log ""
log "[6/9] อัปเดต Version Metadata ใน Package"

if [ "$STATUS" -eq 0 ]; then
  python3 - "$PACKAGE_DIR" "$VERSION" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
version = sys.argv[2]

files = [
    root / "app/version.json",
    root / "app/config/update.json",
    root / "app/frontend/package.json",
    root / "app/update-state/status.json",
    root / "app/update-state/managed-files.json",
]

for path in files:
    if not path.is_file():
        continue

    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = version

    if "currentVersion" in data or path.name in {
        "update.json",
        "status.json",
    }:
        data["currentVersion"] = version

    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
PY

  PACKAGE_VERSION="$(
    python3 -c '
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle).get("version", ""))
' "$PACKAGE_DIR/app/version.json"
  )"

  if [ "$PACKAGE_VERSION" = "$VERSION" ]; then
    log "PASS: Package Version = $VERSION"
  else
    log "FAIL: Package Version ไม่ถูกต้อง"
    STATUS=1
  fi
fi

log ""
log "[7/9] รัน Packaging Validation"

if [ "$STATUS" -eq 0 ]; then
  (
    cd "$PACKAGE_DIR" &&
    LUKE_AI_PACKAGING_MODE=1 \
      bash scripts/validation/validate-release.sh
  ) 2>&1 |
    tee -a "$REPORT_FILE"

  PACKAGE_VALIDATION_STATUS=${PIPESTATUS[0]}

  if [ "$PACKAGE_VALIDATION_STATUS" -eq 0 ]; then
    log "PASS: Packaging Validation ผ่าน"
  else
    log "FAIL: Packaging Validation ไม่ผ่าน"
    STATUS=1
  fi
fi

log ""
log "[8/9] สร้าง ZIP, SHA256 และ Manifest"

if [ "$STATUS" -eq 0 ]; then
  ditto \
    -c \
    -k \
    --sequesterRsrc \
    --keepParent \
    "$PACKAGE_DIR" \
    "$ZIP_FILE"

  if unzip -tq "$ZIP_FILE" >/dev/null 2>&1; then
    shasum -a 256 "$ZIP_FILE" >"$SHA_FILE"

    ZIP_SHA="$(awk '{print $1}' "$SHA_FILE")"
    ZIP_SIZE="$(stat -f%z "$ZIP_FILE")"
    ZIP_NAME="$(basename "$ZIP_FILE")"

    log "PASS: ZIP Integrity ผ่าน"
    log "SHA256: $ZIP_SHA"
  else
    log "FAIL: ZIP Integrity ไม่ผ่าน"
    STATUS=1
  fi
fi

if [ "$STATUS" -eq 0 ]; then
  python3 - \
    "$MANIFEST_FILE" \
    "$VERSION" \
    "$ZIP_NAME" \
    "$ZIP_SIZE" \
    "$ZIP_SHA" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

output = pathlib.Path(sys.argv[1])
version = sys.argv[2]
filename = sys.argv[3]
size = int(sys.argv[4])
sha256 = sys.argv[5]

target = "darwin-arm64"

data = {
    "product": "LUKE AI STUDIO",
    "version": version,
    "channel": "beta",
    "releasedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
    "platform": "darwin",
    "architecture": "arm64",
    "target": target,
    "targets": [target],
    "filename": filename,
    "sizeBytes": size,
    "sha256": sha256,
    "minimumMacOS": "13.0",
    "offlineFirst": True,
    "stagedUpdate": True,
    "cleanupOldVersion": True,
    "portableRuntimeIncluded": True,
    "validated": True,
}

output.write_text(
    json.dumps(data, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
PY

  printf '%s\n' \
    "# LUKE AI STUDIO $VERSION" \
    "" \
    "Build date: $(date '+%Y-%m-%d %H:%M:%S')" \
    "" \
    "## Included" \
    "" \
    "- Portable Node.js" \
    "- Portable npm" \
    "- Portable npx" \
    "- API contract validation" \
    "- Backend positive and negative API tests" \
    "- Strict runtime packaging validation" \
    "" \
    "## SHA256" \
    "" \
    "$ZIP_SHA" \
    >"$NOTES_FILE"

  if python3 -m json.tool "$MANIFEST_FILE" >/dev/null 2>&1; then
    log "PASS: Manifest และ Release Notes พร้อม"
  else
    log "FAIL: Manifest ไม่ถูกต้อง"
    STATUS=1
  fi
fi

log ""
log "[9/9] สรุปผล"

log "============================================================"

if [ "$STATUS" -eq 0 ]; then
  log " BETA 6 BUILD PASSED"
  log "============================================================"
  log "Version : $VERSION"
  log "Package : $PACKAGE_DIR"
  log "ZIP     : $ZIP_FILE"
  log "SHA256  : $SHA_FILE"
  log "Manifest: $MANIFEST_FILE"
  log "Notes   : $NOTES_FILE"
  log "Runtime : $RUNTIME_CACHE"
  log "Report  : $REPORT_FILE"
else
  log " BETA 6 BUILD FAILED"
  log "============================================================"
  log "ยังไม่มีการเผยแพร่ Release"
  log "Report: $REPORT_FILE"
fi

cd "$PROJECT_DIR" || exit 1

echo
echo "Terminal พร้อมรับคำสั่งถัดไป"

exit "$STATUS"
