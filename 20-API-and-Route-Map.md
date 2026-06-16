<!--
agent_page_id: api-and-route-map
source_repo: hanzckernel/hermes-web-ui
upstream_repo: EKKOLearnAI/hermes-web-ui
synced_from_upstream: EKKOLearnAI/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3
last_verified: 2026-06-16
primary_routes:
  - /hermes/chat
  - /hermes/session/:sessionId
  - /hermes/history
  - /hermes/history/session/:sessionId
  - /hermes/global-agent
  - /hermes/global-agent/session/:sessionId
  - /hermes/jobs
  - /hermes/kanban
  - /hermes/models
  - /hermes/profiles
primary_files:
  - packages/client/src/router/index.ts
  - docs/openapi.json
  - packages/server/src/routes/index.ts
screenshot_assets:
-->

# API and Route Map

> Agent summary: route/API inventory generated from latest-main `packages/client/src/router/index.ts` and `docs/openapi.json`. Use this as a map, not as a substitute for reading handlers/tests.

## Client routes

| Path | Route name |
| --- | --- |
| `/` | `login` |
| `/hermes/chat` | `hermes.chat` |
| `/hermes/session/:sessionId` | `hermes.session` |
| `/hermes/history` | `hermes.history` |
| `/hermes/history/session/:sessionId` | `hermes.historySession` |
| `/hermes/global-agent` | `hermes.globalAgent` |
| `/hermes/global-agent/session/:sessionId` | `hermes.globalAgentSession` |
| `/hermes/jobs` | `hermes.jobs` |
| `/hermes/kanban` | `hermes.kanban` |
| `/hermes/models` | `hermes.models` |
| `/hermes/profiles` | `hermes.profiles` |
| `/hermes/logs` | `hermes.logs` |
| `/hermes/usage` | `hermes.usage` |
| `/hermes/performance` | `hermes.performance` |
| `/hermes/skills-usage` | `hermes.skillsUsage` |
| `/hermes/skills` | `hermes.skills` |
| `/hermes/plugins` | `hermes.plugins` |
| `/hermes/memory` | `hermes.memory` |
| `/hermes/settings` | `hermes.settings` |
| `/hermes/channels` | `hermes.channels` |
| `/hermes/terminal` | `hermes.terminal` |
| `/hermes/devices` | `hermes.devices` |
| `/hermes/group-chat` | `hermes.groupChat` |
| `/hermes/group-chat/room/:roomId` | `hermes.groupChatRoom` |
| `/hermes/files` | `hermes.files` |
| `/hermes/coding-agents` | `hermes.codingAgents` |
| `/hermes/version-preview` | `hermes.versionPreview` |
| `/hermes/mcp` | `hermes.mcp` |
| `/hermes/chat` | `login` |

## Server OpenAPI paths

Total OpenAPI paths: 227.

| Path | Methods |
| --- | --- |
| `/api/auth/avatar` | GET, PUT |
| `/api/auth/change-password` | POST |
| `/api/auth/change-username` | POST |
| `/api/auth/locked-ips` | GET, DELETE |
| `/api/auth/login` | POST |
| `/api/auth/mcu-login` | POST |
| `/api/auth/me` | GET |
| `/api/auth/password` | DELETE |
| `/api/auth/setup` | POST |
| `/api/auth/status` | GET |
| `/api/auth/users` | GET, POST |
| `/api/auth/users/{id}` | PUT, DELETE |
| `/api/chat-run/runs` | POST |
| `/api/coding-agents` | GET |
| `/api/coding-agents/runs/{sessionId}` | DELETE |
| `/api/coding-agents/runs/{sessionId}/input` | POST |
| `/api/coding-agents/{id}` | DELETE |
| `/api/coding-agents/{id}/config-files/{key}` | GET, PUT |
| `/api/coding-agents/{id}/install` | POST |
| `/api/coding-agents/{id}/launch/native` | POST |
| `/api/coding-agents/{id}/launch/prepare` | POST |
| `/api/coding-agents/{id}/runs` | POST |
| `/api/cron-history` | GET |
| `/api/cron-history/{jobId}/{fileName}` | GET |
| `/api/devices` | GET |
| `/api/devices/link-info` | GET |
| `/api/devices/link-request` | POST |
| `/api/devices/link-status` | POST |
| `/api/devices/manual-request` | POST |
| `/api/devices/pairing-link` | GET |
| `/api/devices/peer-connections` | GET |
| `/api/devices/peer-connections/{connectionId}/disconnect` | POST |
| `/api/devices/peer-connections/{connectionId}/download` | POST |
| `/api/devices/peer-connections/{connectionId}/exec` | POST |
| `/api/devices/peer-connections/{connectionId}/terminal` | POST |
| `/api/devices/peer-connections/{connectionId}/terminal/{terminalId}/close` | POST |
| `/api/devices/peer-connections/{connectionId}/terminal/{terminalId}/input` | POST |
| `/api/devices/peer-connections/{connectionId}/terminal/{terminalId}/read` | GET |
| `/api/devices/peer-connections/{connectionId}/terminal/{terminalId}/resize` | POST |
| `/api/devices/peer-connections/{connectionId}/terminals` | GET |
| `/api/devices/peer-connections/{connectionId}/upload` | POST |
| `/api/devices/scan` | POST |
| `/api/devices/{id}/approve` | POST |
| `/api/devices/{id}/block` | POST |
| `/api/devices/{id}/connect` | POST |
| `/api/devices/{id}/reject` | POST |
| `/api/devices/{id}/request` | POST |
| `/api/devices/{id}/request-history` | DELETE |
| `/api/devices/{id}/unblock` | POST |
| `/api/hermes/auth/anthropic/start` | POST |
| `/api/hermes/auth/anthropic/status` | GET |
| `/api/hermes/auth/anthropic/submit/{sessionId}` | POST |
| `/api/hermes/auth/codex/poll/{sessionId}` | GET |
| `/api/hermes/auth/codex/start` | POST |
| `/api/hermes/auth/codex/status` | GET |
| `/api/hermes/auth/copilot/check-token` | GET |
| `/api/hermes/auth/copilot/disable` | POST |
| `/api/hermes/auth/copilot/enable` | POST |
| `/api/hermes/auth/copilot/poll/{sessionId}` | GET |
| `/api/hermes/auth/copilot/start` | POST |
| `/api/hermes/auth/gemini/poll/{sessionId}` | GET |
| `/api/hermes/auth/gemini/start` | POST |
| `/api/hermes/auth/gemini/status` | GET |
| `/api/hermes/auth/nous/poll/{sessionId}` | GET |
| `/api/hermes/auth/nous/start` | POST |
| `/api/hermes/auth/nous/status` | GET |
| `/api/hermes/auth/xai/poll/{sessionId}` | GET |
| `/api/hermes/auth/xai/start` | POST |
| `/api/hermes/auth/xai/status` | GET |
| `/api/hermes/available-models` | GET |
| `/api/hermes/config` | GET, PUT |
| `/api/hermes/config/auxiliary-models` | GET, PUT |
| `/api/hermes/config/credentials` | PUT |
| `/api/hermes/config/model` | PUT |
| `/api/hermes/config/models` | GET |
| `/api/hermes/config/providers` | POST |
| `/api/hermes/config/providers/{poolKey}` | PUT, DELETE |
| `/api/hermes/custom-model` | PUT, DELETE |
| `/api/hermes/download` | GET |
| `/api/hermes/files/copy` | POST |
| `/api/hermes/files/delete` | DELETE |
| `/api/hermes/files/list` | GET |
| `/api/hermes/files/mkdir` | POST |
| `/api/hermes/files/read` | GET |
| `/api/hermes/files/rename` | POST |
| `/api/hermes/files/stat` | GET |
| `/api/hermes/files/upload` | POST |
| `/api/hermes/files/write` | PUT |
| `/api/hermes/group-chat/rooms` | POST, GET |
| `/api/hermes/group-chat/rooms/join/{code}` | GET |
| `/api/hermes/group-chat/rooms/{roomId}` | GET, DELETE |
| `/api/hermes/group-chat/rooms/{roomId}/agents` | POST, GET |
| `/api/hermes/group-chat/rooms/{roomId}/agents/{agentId}` | DELETE |
| `/api/hermes/group-chat/rooms/{roomId}/clear-context` | POST |
| `/api/hermes/group-chat/rooms/{roomId}/clone` | POST |
| `/api/hermes/group-chat/rooms/{roomId}/compress` | POST |
| `/api/hermes/group-chat/rooms/{roomId}/config` | PUT |
| `/api/hermes/group-chat/rooms/{roomId}/invite-code` | PUT |
| `/api/hermes/jobs` | GET, POST |
| `/api/hermes/jobs/{id}` | GET, PATCH, DELETE |
| `/api/hermes/jobs/{id}/pause` | POST |
| `/api/hermes/jobs/{id}/resume` | POST |
| `/api/hermes/jobs/{id}/run` | POST |
| `/api/hermes/kanban` | GET, POST |
| `/api/hermes/kanban/artifact` | GET |
| `/api/hermes/kanban/assignees` | GET |
| `/api/hermes/kanban/boards` | GET, POST |
| `/api/hermes/kanban/boards/{slug}` | DELETE |
| `/api/hermes/kanban/capabilities` | GET |
| `/api/hermes/kanban/complete` | POST |
| `/api/hermes/kanban/diagnostics` | GET |
| `/api/hermes/kanban/dispatch` | POST |
| `/api/hermes/kanban/links` | POST, DELETE |
| `/api/hermes/kanban/search-sessions` | GET |
| `/api/hermes/kanban/stats` | GET |
| `/api/hermes/kanban/tasks/bulk` | POST |
| `/api/hermes/kanban/unblock` | POST |
| `/api/hermes/kanban/{id}` | GET |
| `/api/hermes/kanban/{id}/assign` | POST |
| `/api/hermes/kanban/{id}/block` | POST |
| `/api/hermes/kanban/{id}/comments` | POST |
| `/api/hermes/kanban/{id}/log` | GET |
| `/api/hermes/kanban/{id}/reassign` | POST |
| `/api/hermes/kanban/{id}/reclaim` | POST |
| `/api/hermes/kanban/{id}/specify` | POST |
| `/api/hermes/logs` | GET |
| `/api/hermes/logs/{name}` | GET |
| `/api/hermes/mcp/reload` | POST |
| `/api/hermes/mcp/servers` | GET, POST |
| `/api/hermes/mcp/servers/{name}` | PATCH, DELETE |
| `/api/hermes/mcp/servers/{name}/test` | POST |
| `/api/hermes/mcp/tools` | GET |
| `/api/hermes/media/apikey-image-generate` | POST |
| `/api/hermes/media/grok-image-to-video` | POST |
| `/api/hermes/memory` | GET, POST |
| `/api/hermes/model-alias` | PUT |
| `/api/hermes/model-context` | GET, PUT |
| `/api/hermes/model-context/{provider}/{model}` | GET, PUT |
| `/api/hermes/model-visibility` | PUT |
| `/api/hermes/openapi.json` | GET |
| `/api/hermes/performance/runtime` | GET |
| `/api/hermes/plugins` | GET |
| `/api/hermes/profiles` | GET, POST |
| `/api/hermes/profiles/active` | PUT |
| `/api/hermes/profiles/import` | POST |
| `/api/hermes/profiles/runtime-statuses` | GET |
| `/api/hermes/profiles/{name}` | GET, DELETE |
| `/api/hermes/profiles/{name}/avatar` | PUT, DELETE |
| `/api/hermes/profiles/{name}/export` | POST |
| `/api/hermes/profiles/{name}/gateway/restart` | POST |
| `/api/hermes/profiles/{name}/rename` | POST |
| `/api/hermes/profiles/{name}/restart` | POST |
| `/api/hermes/profiles/{name}/runtime-status` | GET |
| `/api/hermes/provider-models` | POST |
| `/api/hermes/provider-models/cache/refresh` | POST |
| `/api/hermes/runtime-versions` | GET |
| `/api/hermes/runtime-versions/active-runtime` | POST |
| `/api/hermes/runtime-versions/active-webui` | POST |
| `/api/hermes/runtime-versions/jobs` | GET |
| `/api/hermes/runtime-versions/jobs/{id}` | GET |
| `/api/hermes/runtime-versions/runtime/download` | POST |
| `/api/hermes/runtime-versions/runtime/{version}` | DELETE |
| `/api/hermes/runtime-versions/webui/download` | POST |
| `/api/hermes/runtime-versions/webui/{version}` | DELETE |
| `/api/hermes/search/sessions` | GET |
| `/api/hermes/sessions` | GET |
| `/api/hermes/sessions/batch-delete` | POST |
| `/api/hermes/sessions/context-length` | GET |
| `/api/hermes/sessions/conversations` | GET |
| `/api/hermes/sessions/conversations/{id}/messages` | GET |
| `/api/hermes/sessions/conversations/{id}/messages/paginated` | GET |
| `/api/hermes/sessions/hermes` | GET |
| `/api/hermes/sessions/hermes/{id}` | GET |
| `/api/hermes/sessions/hermes/{id}/import` | POST |
| `/api/hermes/sessions/search` | GET |
| `/api/hermes/sessions/usage` | GET |
| `/api/hermes/sessions/{id}` | GET, DELETE |
| `/api/hermes/sessions/{id}/export` | GET |
| `/api/hermes/sessions/{id}/model` | POST |
| `/api/hermes/sessions/{id}/rename` | POST |
| `/api/hermes/sessions/{id}/usage` | GET |
| `/api/hermes/sessions/{id}/workspace` | POST |
| `/api/hermes/skills` | GET |
| `/api/hermes/skills/external-dirs` | GET, PUT |
| `/api/hermes/skills/import` | POST |
| `/api/hermes/skills/pin` | PUT |
| `/api/hermes/skills/toggle` | PUT |
| `/api/hermes/skills/usage/stats` | GET |
| `/api/hermes/skills/{category}/{skill}` | DELETE |
| `/api/hermes/skills/{category}/{skill}/files` | GET |
| `/api/hermes/skills/{path}` | GET |
| `/api/hermes/stt/settings` | GET |
| `/api/hermes/stt/settings/active` | PUT |
| `/api/hermes/stt/settings/{provider}` | PUT |
| `/api/hermes/stt/settings/{provider}/base-url-preset` | DELETE |
| `/api/hermes/stt/settings/{provider}/secret/{secretName}` | DELETE |
| `/api/hermes/stt/transcribe` | POST |
| `/api/hermes/terminal` | GET |
| `/api/hermes/tts` | POST |
| `/api/hermes/tts/settings` | GET |
| `/api/hermes/tts/settings/{provider}` | PUT |
| `/api/hermes/tts/settings/{provider}/base-url-preset` | DELETE |
| `/api/hermes/tts/settings/{provider}/secret/{secretName}` | DELETE |
| `/api/hermes/tts/synthesize` | POST |
| `/api/hermes/update` | POST |
| `/api/hermes/update/preview` | GET |
| `/api/hermes/update/preview/install` | POST |
| `/api/hermes/update/preview/prepare` | POST |
| `/api/hermes/update/preview/start` | POST |
| `/api/hermes/update/preview/stop` | POST |
| `/api/hermes/update/preview/tags` | GET |
| `/api/hermes/usage/stats` | GET |
| `/api/hermes/weixin/qrcode` | GET |
| `/api/hermes/weixin/qrcode/status` | GET |
| `/api/hermes/weixin/save` | POST |
| `/api/hermes/workspace/folders` | GET, POST, DELETE |
| `/api/hermes/workspace/folders/rename` | POST |
| `/api/hermes/write-gate/pending` | GET |
| `/api/hermes/write-gate/pending/{subsystem}/{id}/approve` | POST |
| `/api/hermes/write-gate/pending/{subsystem}/{id}/diff` | GET |
| `/api/hermes/write-gate/pending/{subsystem}/{id}/reject` | POST |
| `/api/openapi.json` | GET |
| `/api/tts/proxy/audio/speech` | POST |
| `/api/voice/providers/probe` | POST |
| `/health` | GET |
| `/upload` | POST |
| `/webhook` | POST |

## Mutating/sensitive API families

- Auth/session/user management: `/api/auth/**`
- Hermes config/providers/credentials: `/api/hermes/config/**`, `/api/hermes/config/providers/**`
- Profiles: `/api/hermes/profiles/**`
- Jobs/cron: `/api/hermes/jobs/**`, `/api/cron-history/**`
- Files/workspaces/download/upload: `/api/hermes/files/**`, `/upload`, `/api/hermes/download`
- Channels/platform settings: config routes and platform settings components
- Terminal/WebSocket: `/api/hermes/terminal` and WS route code
- Group chat and agent runtime dispatch: `/api/hermes/group-chat/**`
- MCP/coding/global-agent: MCP and agent-runner routes

## Agent notes

- Generated OpenAPI docs can lag if route annotations are incomplete; inspect `packages/server/src/routes/**` for final truth.
- For destructive/mutating APIs, run product/UAT checks with isolated homes or fixtures.
