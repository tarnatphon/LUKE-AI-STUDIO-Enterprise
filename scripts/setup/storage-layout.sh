#!/usr/bin/env bash
#
# LUKE AI STUDIO — choose WHERE each heavy folder lives.
#
# The owner did not want to be told to move the whole app off an external SSD.
# They wanted to decide, folder by folder, what stays on the fast internal SSD
# (code, built UI, chat state) and what can sit on an external SSD (multi-GB
# models, downloaded runtimes). This is that choice.
#
# It does NOT rewrite the app's paths. serve.cjs still reads app/<id>; the
# launcher replaces that directory with a symlink to the chosen location before
# the server starts. No code change, no git impact (every managed folder is
# gitignored), reversible with --reset, and nothing moves while the app runs.
#
#   bash scripts/setup/storage-layout.sh --list
#   bash scripts/setup/storage-layout.sh --set llm-models /Volumes/SSD/LUKE/llm-models
#   bash scripts/setup/storage-layout.sh --reset llm-models
#   bash scripts/setup/storage-layout.sh --apply       # launcher calls this
#   bash scripts/setup/storage-layout.sh --choose      # interactive
#
# Layout is a machine-local file: storage-layout.conf (gitignored). The folder
# registry lives in scripts/config/storage-folders.json (committed).
#
# Test overrides: LUKE_STORAGE_ROOT, LUKE_STORAGE_FOLDERS_FILE,
# LUKE_STORAGE_LAYOUT_FILE — used by test-storage-locations.cjs so no real
# folder is ever touched by the validation suite.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${LUKE_STORAGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
FOLDERS_FILE="${LUKE_STORAGE_FOLDERS_FILE:-$ROOT_DIR/scripts/config/storage-folders.json}"
LAYOUT_FILE="${LUKE_STORAGE_LAYOUT_FILE:-$ROOT_DIR/storage-layout.conf}"
APP_DIR="$ROOT_DIR/app"

log()  { printf '  [storage] %s\n' "$1" >&2; }
warn() { printf '  [storage] WARNING: %s\n' "$1" >&2; }
die()  { printf '  [storage] ERROR: %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash scripts/setup/storage-layout.sh <command>

  --list                    show every folder, its current location, volume and status
  --set <id> <abs-path>     choose where <id> lives (writes config only)
  --reset <id>              put <id> back inside the checkout (writes config only)
  --apply                   apply the layout: move data + create symlinks (launcher)
  --choose                  interactive picker for --list / --set / --reset
  --detect <path>           print internal / external for a path

--set/--reset never move data while the app is running. Restart with ./mac.sh
or ./linux.sh; the launcher calls --apply before starting serve.cjs.
EOF
}

# The registry is JSON on purpose (the Node API reads the same file). Bash only
# needs the ids, and the file is committed, controlled and one id per line.
folder_ids() {
  [[ -f "$FOLDERS_FILE" ]] || return 0
  grep -oE '"id"[[:space:]]*:[[:space:]]*"[a-z0-9-]+"' "$FOLDERS_FILE" \
    | sed -E 's/.*"([a-z0-9-]+)"$/\1/'
}

folder_recommended() {
  local id="$1" line
  while IFS= read -r line; do
    if [[ "$line" == *"\"id\": \"$id\""* || "$line" == *"\"id\":\"$id\""* ]]; then
      printf '%s' "$line" | sed -nE 's/.*"recommended"[[:space:]]*:[[:space:]]*"([a-z]+)".*/\1/p'
      return 0
    fi
  done < "$FOLDERS_FILE"
}

trim() { printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'; }

get_target() {
  local id="$1" line key value
  [[ -f "$LAYOUT_FILE" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    [[ "$line" =~ ^[[:space:]]*([a-z0-9-]+)[[:space:]]*=[[:space:]]*(.+)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="$(trim "${BASH_REMATCH[2]}")"
    [[ "$key" == "$id" ]] || continue
    printf '%s' "$value"
    return 0
  done < "$LAYOUT_FILE"
  return 0
}

is_known_folder() {
  local id="$1" candidate
  while IFS= read -r candidate; do
    [[ "$candidate" == "$id" ]] && return 0
  done < <(folder_ids)
  return 1
}

# Overridable so the validation suite can exercise the macOS /Volumes rules on
# a Linux runner (and vice versa) without touching a real external disk.
platform_name() { printf '%s' "${LUKE_STORAGE_PLATFORM:-$(uname -s)}"; }

classify() {
  local path="$1"
  case "$(platform_name)" in
    Darwin)
      if [[ "$path" == /Volumes/* ]]; then printf 'external'; else printf 'internal'; fi ;;
    Linux)
      case "$path" in
        /media/*|/mnt/*|/run/media/*) printf 'external' ;;
        *) printf 'internal' ;;
      esac ;;
    *) printf 'unknown' ;;
  esac
}

# An unmounted external volume must never be created on the boot disk: macOS
# happily makes /Volumes/<name> on the internal drive when the disk is away,
# and then gigabytes of models would silently land there.
volume_available() {
  local target="$1" vol
  case "$(platform_name)" in
    Darwin)
      if [[ "$target" == /Volumes/* ]]; then
        vol="/Volumes/$(printf '%s' "${target#/Volumes/}" | cut -d/ -f1)"
        [[ -d "$vol" ]] || return 1
      fi ;;
    Linux)
      if [[ "$target" == /media/* ]]; then
        vol="$(printf '%s' "$target" | cut -d/ -f1-3)"
        [[ -d "$vol" ]] || return 1
      elif [[ "$target" == /run/media/* ]]; then
        vol="$(printf '%s' "$target" | cut -d/ -f1-4)"
        [[ -d "$vol" ]] || return 1
      fi ;;
  esac
  return 0
}

validate_target() {
  local id="$1" target="$2" other other_target
  is_known_folder "$id" || die "unknown folder id '$id' (see --list)"
  target="${target%/}"
  [[ -n "$target" && "$target" == /* ]] || die "path must be absolute, e.g. /Volumes/SSD/LUKE/$id"
  [[ "$target" != "/" ]] || die "refusing '/' as a storage location"
  [[ "$target" != "$ROOT_DIR" && "$ROOT_DIR" != "$target"/* ]] \
    || die "refusing the checkout root (or one of its parents) as a storage location"
  [[ "$target" != "$ROOT_DIR/.git"* ]] || die "refusing a path inside .git"
  [[ "$target" != "$APP_DIR/frontend"* ]] || die "refusing a path inside app/frontend"
  [[ "$target" != "$APP_DIR/$id" && "$target" != "$APP_DIR/$id"/* ]] \
    || die "refusing a path inside $id itself"
  while IFS= read -r other; do
    [[ "$other" == "$id" ]] && continue
    [[ "$target" != "$APP_DIR/$other" && "$target" != "$APP_DIR/$other"/* ]] \
      || die "refusing a path inside another managed folder '$other'"
    # Two folders cannot share one directory: whichever is copied first would be
    # mixed into the same place and both symlinked there. This was allowed —
    # `runtime-state=` and `dist=` with the same path passed validation, and only
    # the "target is not empty" check downstream stopped the copy, which reads
    # like a warning rather than the misconfiguration it is.
    other_target="$(get_target "$other")"
    other_target="${other_target%/}"
    [[ -z "$other_target" || "$other_target" != "$target" ]] \
      || die "$other is already configured to use $target — each folder needs its own directory"
  done < <(folder_ids)
  [[ ! -f "$target" ]] || die "$target is a file, not a folder"
  return 0
}

write_target() {
  local id="$1" target="$2" tmp
  mkdir -p "$(dirname "$LAYOUT_FILE")" 2>/dev/null || die "cannot create $(dirname "$LAYOUT_FILE")"
  tmp="$(mktemp "${LAYOUT_FILE}.XXXXXX")" || die "cannot create temp file"
  if [[ -f "$LAYOUT_FILE" ]]; then
    grep -v -E "^[[:space:]]*$id[[:space:]]*=" "$LAYOUT_FILE" > "$tmp" 2>/dev/null || true
  fi
  if [[ ! -s "$tmp" ]]; then
    printf '# LUKE AI STUDIO — machine-local storage choices. Restart to apply.\n' >> "$tmp"
  fi
  printf '%s=%s\n' "$id" "$target" >> "$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" "$LAYOUT_FILE" || die "cannot write $LAYOUT_FILE"
}

remove_target() {
  local id="$1" tmp
  [[ -f "$LAYOUT_FILE" ]] || return 0
  tmp="$(mktemp "${LAYOUT_FILE}.XXXXXX")" || die "cannot create temp file"
  grep -v -E "^[[:space:]]*$id[[:space:]]*=" "$LAYOUT_FILE" > "$tmp" 2>/dev/null || true
  mv "$tmp" "$LAYOUT_FILE" || die "cannot write $LAYOUT_FILE"
}

# ── --list ──────────────────────────────────────────────────────────────────
cmd_list() {
  local id target src current state recommended
  printf '%-16s %-9s %-10s %-18s %s\n' FOLDER RECOMMEND VOLUME STATE LOCATION
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    src="$APP_DIR/$id"
    target="$(get_target "$id")"
    recommended="$(folder_recommended "$id")"
    if [[ -L "$src" ]]; then
      current="$(readlink "$src")"
      if [[ -n "$target" && "$current" == "${target%/}" ]]; then state="applied";
      elif [[ -z "$target" ]]; then state="pending-reset";
      else state="pending-move"; fi
    elif [[ -n "$target" ]]; then
      current="$src (checkout)"
      state="pending-restart"
    else
      current="$src (checkout)"
      state="applied"
    fi
    printf '%-16s %-9s %-10s %-18s %s\n' \
      "$id" "$recommended" "$(classify "$current")" "$state" "$current"
  done < <(folder_ids)
}

# ── --apply ─────────────────────────────────────────────────────────────────
# Returns 0 even when a single folder is skipped: a storage preference must
# never prevent LUKE from starting. Problems are printed loud and left alone.
apply_one() {
  local id="$1" target src current n1 n2 old
  src="$APP_DIR/$id"
  target="$(get_target "$id")"
  target="${target%/}"

  if [[ -z "$target" ]]; then
    if [[ -L "$src" ]]; then
      old="$(readlink "$src")"
      rm -f "$src" || { warn "$id: cannot remove the old symlink"; return 0; }
      if [[ -d "$old" ]]; then
        mv "$old" "$src" 2>/dev/null || { mkdir -p "$src"; warn "$id: could not move data back from $old; created an empty folder"; return 0; }
        log "$id: moved back into the checkout ($old → app/$id)"
      else
        mkdir -p "$src"
        warn "$id: previous location $old is missing (external disk unmounted?); created an empty folder"
      fi
    fi
    return 0
  fi

  if [[ -L "$src" ]]; then
    current="$(readlink "$src")"
    [[ "$current" == "$target" ]] && return 0
    warn "$id already points at $current but the config says $target — run --reset $id first, then --set again"
    return 0
  fi

  # validate_target calls die() on a bad path. Run it in a subshell so a
  # hand-edited config can only skip ONE folder, never abort ./mac.sh.
  if ! ( validate_target "$id" "$target" ); then
    warn "$id: configured path $target is unsafe — skipping"
    return 0
  fi

  volume_available "$target" || {
    warn "$id: the volume for $target is not mounted — leaving app/$id where it is"
    return 0
  }

  if [[ -d "$target" ]] && [[ -n "$(ls -A "$target" 2>/dev/null)" ]]; then
    warn "$id: $target is not empty — refusing to merge silently"
    return 0
  fi

  mkdir -p "$target" 2>/dev/null || {
    warn "$id: cannot create $target (read-only volume?) — leaving app/$id where it is"
    return 0
  }

  if [[ -d "$src" ]]; then
    cp -pR "$src/." "$target/" 2>/dev/null || {
      warn "$id: copy to $target failed — nothing was removed"
      return 0
    }
    n1="$(find "$src" -type f 2>/dev/null | wc -l | tr -d ' ')"
    n2="$(find "$target" -type f 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "$n1" != "$n2" ]]; then
      warn "$id: copy verification failed ($n1 vs $n2 files) — nothing was removed"
      return 0
    fi
    rm -rf "$src" || { warn "$id: cannot remove the old directory"; return 0; }
  fi

  ln -s "$target" "$src" 2>/dev/null || {
    warn "$id: cannot create symlink — data is at $target but app/$id is missing"
    return 0
  }
  log "$id: now at $target ($(classify "$target") SSD)"
}

cmd_apply() {
  local id
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    apply_one "$id"
  done < <(folder_ids)
  return 0
}

# ── --choose ────────────────────────────────────────────────────────────────
cmd_choose() {
  local answer id path
  while true; do
    printf '\n'
    cmd_list
    printf '\n  เลือกโฟลเดอร์ (พิมพ์ id), r = reset, q = ออก: '
    IFS= read -r answer || return 0
    answer="$(trim "$answer")"
    [[ "$answer" == "q" || -z "$answer" ]] && return 0
    if [[ "$answer" == r* ]]; then
      id="$(trim "${answer#r}")"
      is_known_folder "$id" || { warn "unknown id: $id"; continue; }
      remove_target "$id"
      log "$id: จะย้ายกลับเข้า checkout เมื่อ restart"
      continue
    fi
    is_known_folder "$answer" || { warn "unknown id: $answer"; continue; }
    printf '  พาธปลายทาง (สัมบูรณ์) สำหรับ %s: ' "$answer"
    IFS= read -r path || return 0
    path="$(trim "$path")"
    [[ -n "$path" ]] || continue
    validate_target "$answer" "$path" || continue
    write_target "$answer" "${path%/}"
    log "$answer: บันทึกแล้ว → restart ด้วย ./mac.sh หรือ ./linux.sh เพื่อ apply"
  done
}

case "${1:-}" in
  --list)   cmd_list ;;
  --set)
    [[ $# -eq 3 ]] || die "usage: --set <folder-id> <absolute-path>"
    validate_target "$2" "$3"
    write_target "$2" "${3%/}"
    log "$2 → ${3%/} ($(classify "${3%/}")) — บันทึกแล้ว; restart ด้วย launcher เพื่อ apply"
    ;;
  --reset)
    [[ $# -eq 2 ]] || die "usage: --reset <folder-id>"
    is_known_folder "$2" || die "unknown folder id '$2'"
    remove_target "$2"
    log "$2: จะย้ายกลับเข้า checkout เมื่อ restart"
    ;;
  --apply)  cmd_apply ;;
  --choose) cmd_choose ;;
  --detect)
    [[ $# -eq 2 ]] || die "usage: --detect <path>"
    classify "$2"
    printf '\n'
    ;;
  *) usage; [[ -z "${1:-}" ]] && exit 0; exit 1 ;;
esac
