#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(
  CDPATH= cd -- "$(dirname -- "$0")" &&
  pwd
)"

export LUKE_AI_BUILD_VERSION="${LUKE_AI_BUILD_VERSION:-1.0.0-beta.11}"
exec "$SCRIPT_DIR/build-beta10.sh" "$@"
