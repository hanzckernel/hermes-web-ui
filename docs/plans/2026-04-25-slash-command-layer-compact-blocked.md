# Slash command layer: compact blocked on backend primitive

Status: prototype only; do not PR as product UI yet.

## Decision

Do not merge user-visible `/compress` or `/compact` into `main` until Hermes Agent exposes a real structured HTTP compact primitive.

Reason: if a user types a slash command and it only returns “unsupported” or does nothing, the UI creates a false affordance. That is worse than not advertising the command.

## What was prototyped locally

A local Web UI prototype proved the command-layer shape:

- parse leading slash commands before normal chat send
- `/compress [focus]` as primary command name
- `/compact [focus]` as compatibility alias
- `/help` handled locally without starting a run
- `//text` escape to send literal slash-prefixed text
- dedicated command route: `POST /api/hermes/sessions/:id/commands`
- strict server whitelist so commands never fall through to `/v1/runs`
- explicit 501 unsupported response while compact is unavailable
- future mocked-success tests for continuation-session hydration and race guards

Local prototype verification:

- targeted slash-command suite passed: 6 files / 26 tests
- `npm run build` passed
- live prototype route returned expected 501 unsupported-first response
- human testing exposed a separate token-login route mismatch: `LoginView.vue` probes `/api/sessions` while server routes expose `/api/hermes/sessions`

## Why this branch is only a staging branch

The old prototype patch was cut against an earlier base and no longer applies cleanly to current `origin/main`; the conflict is mainly in `packages/client/src/stores/hermes/chat.ts`, where upstream session/cache recovery code changed.

Before any real PR:

1. Start from current `origin/main`.
2. Re-port the command layer manually instead of forcing the old patch.
3. Strip prototype-only files/scripts and local server bind changes.
4. Decide whether token-login validation should be fixed separately.
5. Re-check whether Hermes Agent has added a compact HTTP API.
6. Re-run targeted tests, `npm run build`, and one full `npm test` with baseline failures classified.
7. Run a fresh blocker-only independent review on the final diff.

## Backend contract needed

Preferred direction: Hermes Agent exposes a structured compact primitive, for example:

```http
POST /v1/sessions/:id/compact
```

Minimum response shape needed by Web UI:

```json
{
  "ok": true,
  "session_id": "source-session-id",
  "new_session_id": "continuation-session-id",
  "message": "Compacted into continuation session"
}
```

Web UI needs `new_session_id` when compact creates a continuation session, so it can atomically switch active session state and avoid sending the next user message to the wrong source session.

## Proposed PR split later

1. Small cleanup PR if still needed:
   - fix token-login validation endpoint mismatch (`/api/sessions` vs `/api/hermes/sessions`)

2. Slash-command layer PR after backend contract is clear:
   - parser
   - local `/help`
   - `/compress` and `/compact` only if backed by real compact API, or hidden/disabled if not
   - `//` escape
   - no command leakage into `/v1/runs`
   - continuation/race guard tests

## Current branch purpose

Use this branch to track the design and future re-port. Do not treat it as a ready product PR.
