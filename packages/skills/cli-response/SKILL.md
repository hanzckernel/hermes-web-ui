---
name: cli-response
description: Push all tool calls, terminal output, and conversation messages to Hermes Web UI
---

# cli-response — Push All Activity to Web UI

**MANDATORY: ALL your activity MUST be pushed to the Web UI in real time using the `push` command.**

## Setup

Make `push` available in your PATH. Copy the script from this skill's directory:

```bash
cp SKILL_DIR/push.sh /usr/local/bin/push && chmod +x /usr/local/bin/push
```

Or add to PATH:

```bash
export PATH="SKILL_DIR:$PATH"
```

The `push` command auto-reads the token from `~/.hermes-web-ui/.token`. No manual setup needed.

## Required Pushes (MANDATORY)

### 1. Conversation Messages

Push every response you give to the user:

```bash
push message "I am now analyzing the codebase..."
```

### 2. Tool Calls

Push BEFORE every tool invocation:

```bash
push tool_call bash "npm run build"
push tool_call read "/src/config.ts"
push tool_call edit "/src/config.ts"
push tool_call search "import.*Router"
```

Push AFTER receiving the result:

```bash
push tool_result bash "npm run build"
push tool_result read "/src/config.ts"
```

### 3. Command Execution

Use `push exec` to run a command AND stream its output automatically:

```bash
push exec npm run build
push exec git log --oneline -10
push exec docker compose up -d
```

### 4. Progress Updates

```bash
push progress "Reading configuration files..."
push progress "Running tests (step 2/5)"
```

### 5. Errors

```bash
push error "Build failed: cannot find module 'express'"
```

## Command Reference

```
push message <text>                  Push a text message
push tool_call <tool> <args>         Push tool invocation (running)
push tool_result <tool> <args>       Push tool result (done)
push exec <command> [args...]        Execute command & stream output
push error <text>                    Push an error
push progress <text>                 Push progress update
push <custom_event> <json_data>      Push custom event
```

## Environment Variables

| Variable              | Default                         | Description          |
|-----------------------|---------------------------------|----------------------|
| `HERMES_WEB_UI_URL`   | `http://127.0.0.1:8648`        | Server URL           |
| `HERMES_WEB_UI_TOKEN` | `~/.hermes-web-ui/.token`      | Auth token           |

## Raw API (fallback)

If `push` is not available, use curl directly:

```bash
TOKEN=$(cat ~/.hermes-web-ui/.token)
curl -s -X POST http://127.0.0.1:8648/api/hermes/cli-response \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"event": "message", "data": {"text": "Hello"}}'
```
