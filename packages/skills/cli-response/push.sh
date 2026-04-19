#!/usr/bin/env bash
# push — Send messages to Hermes Web UI via cli-response
#
# Usage:
#   push message <text>                  Push a text message
#   push tool_call <tool> <args>         Push tool invocation
#   push tool_result <tool> <args>       Push tool result
#   push exec <command> [args...]        Execute command and stream output
#   push error <text>                    Push an error
#   push progress <text>                 Push progress update
#   push <custom_event> <json_data>      Push custom event

set -euo pipefail

TOKEN="${HERMES_WEB_UI_TOKEN:-$(cat ~/.hermes-web-ui/.token 2>/dev/null || true)}"
URL="${HERMES_WEB_UI_URL:-http://127.0.0.1:8648}"
ENDPOINT="${URL}/api/hermes/cli-response"

_send() {
  local event="$1" data="$2"
  if [ -z "$TOKEN" ]; then
    curl -s -X POST "$ENDPOINT" \
      -H "Content-Type: application/json" \
      -d "{\"event\":\"$event\",\"data\":$data}" > /dev/null 2>&1 || true
  else
    curl -s -X POST "$ENDPOINT" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"event\":\"$event\",\"data\":$data}" > /dev/null 2>&1 || true
  fi
}

_json_str() {
  if command -v jq &>/dev/null; then
    printf '%s' "$1" | jq -Rs .
  else
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\t'/\\t}"
    printf '"%s"' "$s"
  fi
}

_do_message() {
  local text="${*:1}"
  [ -z "$text" ] && return 0
  _send message "{\"text\":$(_json_str "$text")}"
}

_do_tool_call() {
  local tool="${1:-}" args="${*:2}"
  _send tool_call "{\"tool\":$(_json_str "$tool"),\"args\":$(_json_str "$args"),\"status\":\"running\"}"
}

_do_tool_result() {
  local tool="${1:-}" args="${*:2}"
  _send tool_result "{\"tool\":$(_json_str "$tool"),\"args\":$(_json_str "$args"),\"status\":\"done\"}"
}

_do_exec() {
  local cmd="$*"
  if [ -z "$cmd" ]; then
    echo "Usage: push exec <command>" >&2
    exit 1
  fi
  _send output "{\"text\":\"$ $cmd\"}"
  eval "$cmd" 2>&1 | while IFS= read -r line; do
    _send output "{\"text\":$(_json_str "$line")}"
  done
}

_do_error() {
  local text="${*:1}"
  _send error "{\"message\":$(_json_str "$text")}"
}

_do_progress() {
  local text="${*:1}"
  _send progress "{\"step\":$(_json_str "$text")}"
}

case "${1:-}" in
  -h|--help|help)
    cat <<'EOF'
Usage: push <event> [args...]

Events:
  push message <text>                  Push a text message
  push tool_call <tool> <args>         Push tool invocation (running)
  push tool_result <tool> <args>       Push tool result (done)
  push exec <command> [args...]        Execute & stream output
  push error <text>                    Push an error
  push progress <text>                 Push progress update
  push <custom_event> <json_data>      Push custom event

Env:
  HERMES_WEB_UI_URL   Server URL (default: http://127.0.0.1:8648)
  HERMES_WEB_UI_TOKEN Auth token (default: ~/.hermes-web-ui/.token)
EOF
    ;;
  message)
    shift
    _do_message "$@"
    ;;
  tool_call)
    shift
    _do_tool_call "$@"
    ;;
  tool_result)
    shift
    _do_tool_result "$@"
    ;;
  exec)
    shift
    _do_exec "$@"
    ;;
  error)
    shift
    _do_error "$@"
    ;;
  progress)
    shift
    _do_progress "$@"
    ;;
  *)
    # Default: treat as custom event
    local event="${1:-}"
    local data="${*:2}"
    if [ -z "$event" ]; then
      echo "Usage: push <event> [args...]" >&2
      exit 1
    fi
    _send "$event" "{\"text\":$(_json_str "$data")}"
    ;;
esac
