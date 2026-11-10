#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
APP_DIR="$ROOT_DIR/app"
TOOLS_DIR="$APP_DIR/tools"
RELEASE="${LLAMA_RELEASE:-b9668}"
PLATFORM="$(uname -s)"
ARCH="$(uname -m)"
LLAMA_REPO="ggml-org/llama.cpp"

# Ask for a reinstall even when what is installed looks new enough.
FORCE="${LLAMA_FORCE:-0}"

# ── what the release publishes ───────────────────────────────────────────────
# Asset names are built from the release tag, but they are not stable across
# builds: upstream renamed the Linux CUDA asset from `cuda-12.4` to `cuda-12.8`
# and `cuda-13.5`, and the ROCm one from `rocm` to `rocm-10.0`. A script that
# only constructs names therefore 404s on the next bump and — because those two
# are optional — silently installs a machine with no GPU acceleration at all.
# So the tag's own asset list is consulted first, and these are the names to fall
# back on when there is no network.

asset_for() {
  case "$1" in
    macos-arm64)        echo "llama-$RELEASE-bin-macos-arm64.tar.gz" ;;
    macos-x64)          echo "llama-$RELEASE-bin-macos-x64.tar.gz" ;;
    linux-arm64)        echo "llama-$RELEASE-bin-ubuntu-arm64.tar.gz" ;;
    linux-vulkan-arm64) echo "llama-$RELEASE-bin-ubuntu-vulkan-arm64.tar.gz" ;;
    linux-cuda-x64)     echo "llama-$RELEASE-bin-ubuntu-cuda-12.4-x64.tar.gz" ;;
    linux-rocm-x64)     echo "llama-$RELEASE-bin-ubuntu-rocm-x64.tar.gz" ;;
    linux-sycl-x64)     echo "llama-$RELEASE-bin-ubuntu-sycl-fp32-x64.tar.gz" ;;
    linux-vulkan-x64)   echo "llama-$RELEASE-bin-ubuntu-vulkan-x64.tar.gz" ;;
    linux-cpu-x64)      echo "llama-$RELEASE-bin-ubuntu-x64.tar.gz" ;;
    *)                  echo "" ;;
  esac
}

# The part of an asset name that a renamed build keeps: the platform and the
# archive type. The version in the middle is allowed to move.
asset_pattern() {
  case "$1" in
    macos-arm64)        printf '%s\n' '-bin-macos-arm64\.tar\.gz$' ;;
    macos-x64)          printf '%s\n' '-bin-macos-x64\.tar\.gz$' ;;
    linux-arm64)        printf '%s\n' '-bin-ubuntu-arm64\.tar\.gz$' ;;
    linux-vulkan-arm64) printf '%s\n' '-bin-ubuntu-vulkan-arm64\.tar\.gz$' ;;
    linux-cuda-x64)     printf '%s\n' '-bin-ubuntu-cuda-[0-9.]+-x64\.tar\.gz$' ;;
    linux-rocm-x64)     printf '%s\n' '-bin-ubuntu-rocm-[0-9.]+-x64\.tar\.gz$' ;;
    linux-sycl-x64)     printf '%s\n' '-bin-ubuntu-sycl-fp32-x64\.tar\.gz$' ;;
    linux-vulkan-x64)   printf '%s\n' '-bin-ubuntu-vulkan-x64\.tar\.gz$' ;;
    linux-cpu-x64)      printf '%s\n' '-bin-ubuntu-x64\.tar\.gz$' ;;
    *)                  printf '%s\n' '' ;;
  esac
}

# One line per asset the tag actually published. Empty when there is no network.
release_assets() {
  curl -fsSL --max-time 20 "https://api.github.com/repos/$LLAMA_REPO/releases/tags/$RELEASE" 2>/dev/null \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | sed -e 's/.*\///' -e 's/"$//' \
    | grep '^llama-' \
    || true
}

# Highest version wins among matches, so `cuda-13.5` beats `cuda-12.8`.
pick_best_asset() {
  awk '{
    if (match($0, /(cuda|rocm)-[0-9]+(\.[0-9]+)*/)) {
      v = substr($0, RSTART, RLENGTH); sub(/^(cuda|rocm)-/, "", v); print v "\t" $0
    } else {
      print "0\t" $0
    }
  }' | sort -t "$(printf '\t')" -k1,1gr | cut -f2 | head -1
}

# The asset to download for a kind of backend: what the release publishes, or
# the name built from the tag when that cannot be asked.
resolve_asset() {
  local kind="$1"
  local pattern chosen default_name
  default_name="$(asset_for "$kind")"
  pattern="$(asset_pattern "$kind")"
  if [[ -n "$pattern" ]]; then
    # -e, because every one of these patterns starts with a dash.
    chosen="$(release_assets | grep -E -e "$pattern" | pick_best_asset || true)"
    if [[ -n "$chosen" ]]; then
      echo "$chosen"
      return 0
    fi
  fi
  echo "$default_name"
}

# ── what is already installed ────────────────────────────────────────────────
# `llama-server --version` prints `version: 9668 (32120c10e)`. The build number
# is the only thing that answers "is this older than what I asked for".
installed_release() {
  local dir="$1" line number
  if [[ ! -x "$dir/llama-server" ]]; then
    return 0
  fi
  line="$("$dir/llama-server" --version 2>/dev/null | head -1 || true)"
  number="$(printf '%s\n' "$line" | sed -n 's/^version: *\([0-9][0-9]*\).*/\1/p')"
  echo "${number:-unknown}"
}

# b12242 -> 12242. Anything else (v0.9.0) is not a build number and is not
# compared: guessing there would be worse than asking the file.
release_number() {
  case "$1" in
    b[0-9]*) echo "${1#b}" ;;
    *) echo "" ;;
  esac
}

# Prints why, and returns 0 to install, 1 to keep what is there.
should_install() {
  local dir="$1" wanted="$2" installed wanted_number
  installed="$(installed_release "$dir")"
  if [[ -z "$installed" ]]; then
    echo "nothing installed yet"
    return 0
  fi
  if [[ "$FORCE" == "1" ]]; then
    echo "LLAMA_FORCE=1"
    return 0
  fi
  wanted_number="$(release_number "$wanted")"
  if [[ -n "$wanted_number" && "$installed" =~ ^[0-9]+$ ]]; then
    if [[ "$installed" -ge "$wanted_number" ]]; then
      echo "b$installed is already the same as or newer than $wanted"
      return 1
    fi
    echo "b$installed is older than $wanted"
    return 0
  fi
  echo "installed version $installed cannot be compared with $wanted"
  return 1
}

# ── installing ───────────────────────────────────────────────────────────────
fetch_and_extract() {
  local asset="$1" dest="$2" archive="$TOOLS_DIR/$1"
  mkdir -p "$dest"
  rm -f "$archive" "$archive.part"
  echo "   >>   Downloading $asset"
  if ! curl -fSL --progress-bar --max-time 1800 "https://github.com/$LLAMA_REPO/releases/download/$RELEASE/$asset" -o "$archive.part"; then
    rm -f "$archive.part"
    echo "   XX   $asset was not found in $RELEASE" >&2
    return 1
  fi
  mv "$archive.part" "$archive"
  if command -v python3 >/dev/null 2>&1; then
    if ! python3 "$SCRIPT_DIR/extract_tar.py" --archive "$archive" --dest "$dest" --strip-components=1; then
      rm -f "$archive"
      return 1
    fi
  else
    if ! tar -xzf "$archive" -C "$dest" --strip-components=1; then
      rm -f "$archive"
      return 1
    fi
  fi
  rm -f "$archive"
  chmod +x "$dest"/llama-* 2>/dev/null || true
  [[ -x "$dest/llama-server" ]]
}

# Install into a staging folder and only swap it in when it really contains a
# working binary. A failed download used to leave an empty directory that then
# satisfied "already ready" on the next run — and removed the app's only backend
# in the meantime.
ensure_backend() {
  local kind="$1" dest="$2" reason asset staging backup
  if ! reason="$(should_install "$dest" "$RELEASE")"; then
    echo "   OK   llama.cpp backend already ready: $dest ($reason)"
    return 0
  fi
  asset="$(resolve_asset "$kind")"
  if [[ -z "$asset" ]]; then
    echo "   XX   no asset is known for $kind" >&2
    return 1
  fi
  echo "   >>   Installing $asset ($reason)"
  staging="$dest.new"
  backup="$dest.bak"
  rm -rf "$staging"
  if ! fetch_and_extract "$asset" "$staging"; then
    rm -rf "$staging"
    echo "   XX   $asset could not be installed; the existing backend was left untouched" >&2
    return 1
  fi
  if [[ -d "$dest" ]]; then
    rm -rf "$backup"
    mv "$dest" "$backup"
  fi
  mv "$staging" "$dest"
  echo "   OK   $dest now runs b$(installed_release "$dest") (the previous build is in $backup)"
}

# Optional backends: a failure costs acceleration, never the installation.
ensure_optional() {
  local kind="$1" dest="$2" why="$3"
  if ! ensure_backend "$kind" "$dest"; then
    rm -rf "$dest.new"
    echo "   !!   Skipping optional llama.cpp backend for $why" >&2
    return 0
  fi
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

has_linux_gpu_vendor() {
  local vendor="$1"
  [[ -d /sys/bus/pci/devices ]] || return 1
  grep -Ril "$vendor" /sys/bus/pci/devices/*/vendor >/dev/null 2>&1
}

# Sourced by scripts/validation/test-llama-backend-upgrade.cjs, which tests the
# decision functions without installing anything.
if [[ "${LLAMA_SETUP_LIB_ONLY:-0}" != "1" ]]; then

if [[ "$PLATFORM" == "Darwin" ]]; then
  if [[ "$ARCH" == "arm64" ]]; then
    ensure_backend macos-arm64 "$APP_DIR/llm-backend/mac/arm64"
  else
    ensure_backend macos-x64 "$APP_DIR/llm-backend/mac/x64"
  fi
elif [[ "$PLATFORM" == "Linux" ]]; then
  if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    ensure_backend linux-vulkan-arm64 "$APP_DIR/llm-backend/linux/vulkan"
    ensure_backend linux-arm64 "$APP_DIR/llm-backend/linux/cpu"
  else
    if has_command nvidia-smi || has_linux_gpu_vendor "0x10de"; then
      ensure_optional linux-cuda-x64 "$APP_DIR/llm-backend/linux/cuda" "NVIDIA CUDA acceleration"
    fi
    if has_command rocminfo || has_linux_gpu_vendor "0x1002"; then
      ensure_optional linux-rocm-x64 "$APP_DIR/llm-backend/linux/rocm" "AMD ROCm acceleration"
    fi
    if has_linux_gpu_vendor "0x8086"; then
      ensure_optional linux-sycl-x64 "$APP_DIR/llm-backend/linux/sycl" "Intel SYCL acceleration"
    fi
    ensure_backend linux-vulkan-x64 "$APP_DIR/llm-backend/linux/vulkan"
    ensure_backend linux-cpu-x64 "$APP_DIR/llm-backend/linux/cpu"
  fi
else
  echo "Unsupported platform: $PLATFORM" >&2
  exit 1
fi

fi
