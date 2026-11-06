#!/usr/bin/env bash
#
# luke-agent-env.sh — point an offline coding agent at LUKE's text engine.
#
# LUKE's llama-server (default 127.0.0.1:10086) speaks both OpenAI Chat
# Completions and the Anthropic Messages API, so Claude Code and OpenCode can
# use the loaded GGUF model directly. Nothing here leaves the machine: every URL
# this script prints or writes is a loopback address.
#
# Usage
#   eval "$(scripts/tools/luke-agent-env.sh env)"   # Claude Code in this shell
#   scripts/tools/luke-agent-env.sh opencode .      # opencode.json for a project
#   scripts/tools/luke-agent-env.sh check           # do the sockets answer?
#   scripts/tools/luke-agent-env.sh port            # the port llama-server got
#   scripts/tools/luke-agent-env.sh model           # its model id
#
# Environment
#   LUKE_URL        LUKE's own API (default http://127.0.0.1:1420)
#   LUKE_LLM_PORT   skip discovery and use this port
#
# The port is not always 10086: if that port is busy LUKE moves to 28121-28160,
# which is why the port is read from GET /api/llm/status instead of assumed.
#
# See docs/beta7/offline-coding-agents.md.

set -u

LUKE_URL="${LUKE_URL:-http://127.0.0.1:1420}"
LUKE_LLM_PORT="${LUKE_LLM_PORT:-}"
DEFAULT_PORT=10086

say() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 1; }

http_get() { curl -fsS --max-time 10 "$1" 2>/dev/null; }

first_number_after() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -n 1
}

first_string_after() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

# Sets RESOLVED_PORT. A subshell cannot be used for this: `die` inside
# $( ) would only end the subshell and leave the caller with an empty port.
RESOLVED_PORT=""
resolve_port() {
  if [ -n "$LUKE_LLM_PORT" ]; then
    RESOLVED_PORT="$LUKE_LLM_PORT"
    return 0
  fi
  status="$(http_get "$LUKE_URL/api/llm/status")"
  if [ -n "$status" ]; then
    port="$(printf '%s' "$status" | first_number_after port)"
    if [ -n "$port" ]; then
      RESOLVED_PORT="$port"
      return 0
    fi
  fi
  if curl -fsS --max-time 3 "http://127.0.0.1:$DEFAULT_PORT/v1/models" >/dev/null 2>&1; then
    RESOLVED_PORT="$DEFAULT_PORT"
    return 0
  fi
  return 1
}

detect_model() {
  models="$(http_get "http://127.0.0.1:$1/v1/models")"
  [ -n "$models" ] || return 1
  id="$(printf '%s' "$models" | first_string_after id)"
  [ -n "$id" ] || return 1
  printf '%s' "$id"
}

detect_context() {
  status="$(http_get "$LUKE_URL/api/llm/status")"
  [ -n "$status" ] || return 1
  ctx="$(printf '%s' "$status" | first_number_after contextSize)"
  [ -n "$ctx" ] || return 1
  printf '%s' "$ctx"
}

require_port() {
  if resolve_port; then
    return 0
  fi
  die "LUKE is not answering on $LUKE_URL, and nothing is listening on 127.0.0.1:$DEFAULT_PORT.
Start LUKE (./mac.sh), open Text Chat, and load a GGUF model. The model is the server."
}

cmd_port() {
  require_port
  printf '%s\n' "$RESOLVED_PORT"
}

cmd_model() {
  require_port
  port="$RESOLVED_PORT"
  model="$(detect_model "$port")" || die "llama-server on 127.0.0.1:$port has no /v1/models. Is a model loaded?"
  printf '%s\n' "$model"
}

cmd_env() {
  require_port
  port="$RESOLVED_PORT"
  model="$(detect_model "$port" || printf 'local-model')"
  ctx="$(detect_context || printf '20000')"
  base="http://127.0.0.1:$port"

  printf '# LUKE AI STUDIO — offline coding agent (%s)\n' "$base"
  printf '# model: %s\n' "$model"
  printf 'export ANTHROPIC_BASE_URL="%s"\n' "$base"
  printf 'export ANTHROPIC_AUTH_TOKEN="luke-local"\n'
  printf 'export ANTHROPIC_API_KEY=""\n'
  printf 'export ANTHROPIC_DEFAULT_OPUS_MODEL="%s"\n' "$model"
  printf 'export ANTHROPIC_DEFAULT_SONNET_MODEL="%s"\n' "$model"
  printf 'export ANTHROPIC_DEFAULT_HAIKU_MODEL="%s"\n' "$model"
  printf 'export ANTHROPIC_MODEL="%s"\n' "$model"
  printf 'export CLAUDE_CODE_SUBAGENT_MODEL="%s"\n' "$model"
  printf 'export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\n'
  printf 'export DISABLE_TELEMETRY=1\n'
  printf 'export DISABLE_ERROR_REPORTING=1\n'
  printf 'export DISABLE_AUTOUPDATER=1\n'
  printf 'export API_TIMEOUT_MS=600000\n'
  # What the local-Claude-Code guides converge on: this header is reported to
  # cost most of the throughput against a local endpoint, and Claude Code has to
  # be told the real window or it assumes 200k and overruns the server.
  printf 'export CLAUDE_CODE_ATTRIBUTION_HEADER=0\n'
  printf 'export CLAUDE_CODE_MAX_CONTEXT_TOKENS="%s"\n' "$ctx"
  # Compaction must happen below the window the server allocated. Below 32K the
  # only honest setting is the window itself, so the variable is skipped rather
  # than set to a value that would re-break the 4K trap in reverse.
  if [ "$ctx" -ge 32768 ]; then
    compact=$((ctx * 3 / 4))
    if [ "$compact" -gt 100000 ]; then compact=100000; fi
    printf 'export CLAUDE_CODE_AUTO_COMPACT_WINDOW="%s"\n' "$compact"
  else
    printf '# CLAUDE_CODE_AUTO_COMPACT_WINDOW omitted: this window (%s) is already\n' "$ctx"
    printf '# small; Claude Code compacts at the limit instead of a round number.\n'
  fi
  printf 'export LUKE_CONTEXT_TOKENS="%s"\n' "$ctx"
}

cmd_opencode() {
  dir="${1:-.}"
  [ -d "$dir" ] || die "No such folder: $dir"
  require_port
  port="$RESOLVED_PORT"
  model="$(detect_model "$port")" || die "llama-server on 127.0.0.1:$port has no /v1/models. Is a model loaded?"
  ctx="$(detect_context || printf '20000')"
  target="$dir/opencode.json"

  if [ -e "$target" ]; then
    die "$target already exists — move it aside first, this script never overwrites a project config."
  fi

  cat > "$target" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "luke": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LUKE AI STUDIO (local)",
      "options": {
        "baseURL": "http://127.0.0.1:$port/v1"
      },
      "models": {
        "$model": {
          "name": "LUKE local GGUF",
          "limit": {
            "context": $ctx,
            "output": 4096
          }
        }
      }
    }
  },
  "model": "luke/$model"
}
JSON

  say "Wrote $target"
  say "Open this folder in OpenCode and pick the model with /models."
  say "First run needs the '@ai-sdk/openai-compatible' adapter available to OpenCode;"
  say "install it once while you still have a network, then it works offline."
}

cmd_check() {
  require_port
  port="$RESOLVED_PORT"
  base="http://127.0.0.1:$port"
  model="$(detect_model "$port" || printf 'local-model')"
  failures=0

  printf 'LUKE API      %s  ' "$LUKE_URL"
  if [ -n "$(http_get "$LUKE_URL/api/llm/status")" ]; then printf 'ok\n'; else printf 'no answer\n'; failures=$((failures + 1)); fi

  printf 'llama-server  %s  ' "$base"
  if [ -n "$(http_get "$base/v1/models")" ]; then printf 'ok (%s)\n' "$model"; else printf 'no answer\n'; failures=$((failures + 1)); fi

  printf 'OpenAI route  POST /v1/chat/completions  '
  openai_answer="$(curl -fsS --max-time 300 -X POST "$base/v1/chat/completions" \
    -H 'content-type: application/json' \
    --data '{"model":"'"$model"'","max_tokens":16,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}' 2>/dev/null)"
  if printf '%s' "$openai_answer" | grep -qi 'ready'; then printf 'ok\n'; else printf 'no usable answer\n'; failures=$((failures + 1)); fi

  printf 'Anthropic     POST /v1/messages          '
  anthropic_answer="$(curl -fsS --max-time 300 -X POST "$base/v1/messages" \
    -H 'content-type: application/json' \
    --data '{"model":"'"$model"'","max_tokens":16,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}' 2>/dev/null)"
  if printf '%s' "$anthropic_answer" | grep -qi 'ready'; then printf 'ok\n'; else
    printf 'no usable answer\n'
    say "  Claude Code needs this route. If it 404s, the bundled llama.cpp build is older"
    say "  than the one LUKE pins (b9668) — re-run scripts/setup/setup-llama.sh."
    failures=$((failures + 1))
  fi

  printf 'Tool calling  tools[] in /v1/messages    '
  tool_answer="$(curl -fsS --max-time 300 -X POST "$base/v1/messages" \
    -H 'content-type: application/json' \
    --data '{"model":"'"$model"'","max_tokens":96,"tools":[{"name":"read_file","description":"Read a file from the project","input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}],"messages":[{"role":"user","content":"Use the read_file tool to read README.md"}]}' 2>/dev/null)"
  if printf '%s' "$tool_answer" | grep -q '"tool_use"'; then
    printf 'ok\n'
  else
    printf 'no tool_use\n'
    say "  The model answered without calling the tool. Either this llama.cpp build has no"
    say "  --jinja support (LUKE adds it when --help advertises it), or the model's chat"
    say "  template has no tool section. See docs/beta7/offline-coding-agents.md section 2."
  fi

  if [ "$failures" -gt 0 ]; then
    say ""
    say "$failures check(s) failed."
    exit 1
  fi
  say ""
  say "All required checks passed. The agent can work offline against this model."
}

usage() {
  sed -n '3,/^set -u$/p' "$0" | sed '/^set -u$/d; s/^# \{0,1\}//'
}

command="${1:-help}"
case "$command" in
  env) shift || true; cmd_env ;;
  opencode) shift || true; cmd_opencode "$@" ;;
  check) shift || true; cmd_check ;;
  port) shift || true; cmd_port ;;
  model) shift || true; cmd_model ;;
  help | -h | --help) usage ;;
  *) usage; exit 2 ;;
esac
