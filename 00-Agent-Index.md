<!--
agent_page_id: agent-index
source_repo: hanzckernel/hermes-web-ui
upstream_repo: EKKOLearnAI/hermes-web-ui
synced_from_upstream: EKKOLearnAI/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3
last_verified: 2026-06-16
primary_routes:
  - /
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
  - /hermes/logs
  - /hermes/usage
  - /hermes/performance
  - /hermes/skills-usage
  - /hermes/skills
  - /hermes/plugins
  - /hermes/memory
  - /hermes/settings
  - /hermes/channels
  - /hermes/terminal
  - /hermes/devices
  - /hermes/group-chat
  - /hermes/group-chat/room/:roomId
  - /hermes/files
  - /hermes/coding-agents
  - /hermes/version-preview
  - /hermes/mcp
  - /hermes/chat
primary_files:
  - packages/client/src/router/index.ts
  - docs/openapi.json
screenshot_assets:
-->

# Agent Index

> Agent summary: this is the compact map for machine reading. Use it to route questions to the right wiki page, source file, screenshot, or API family. Always verify behavior against latest source before editing code.

## Repository state

- Fork: `hanzckernel/hermes-web-ui`
- Upstream: `EKKOLearnAI/hermes-web-ui`
- Upstream SHA: `0cb047c31e36da2d5e11eb7751c4fa6c48748df3`
- Fork main SHA after sync: `0cb047c31e36da2d5e11eb7751c4fa6c48748df3`
- Package version: `0.6.15`
- OpenAPI paths: `227`
- Client routes: `29`

## Route to page map

| Route | Vue route name | Wiki page |
| --- | --- | --- |
| `/` | `login` | [Quick Start](01-Quick-Start.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/chat` | `hermes.chat` | [Quick Start](01-Quick-Start.md), [Architecture](02-Architecture.md), [Chat and Sessions](03-Chat-and-Sessions.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/session/:sessionId` | `hermes.session` | [Quick Start](01-Quick-Start.md), [Chat and Sessions](03-Chat-and-Sessions.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/history` | `hermes.history` | [Quick Start](01-Quick-Start.md), [Architecture](02-Architecture.md), [History and Search](04-History-and-Search.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/history/session/:sessionId` | `hermes.historySession` | [Quick Start](01-Quick-Start.md), [Architecture](02-Architecture.md), [History and Search](04-History-and-Search.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/global-agent` | `hermes.globalAgent` | [Quick Start](01-Quick-Start.md), [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/global-agent/session/:sessionId` | `hermes.globalAgentSession` | [Quick Start](01-Quick-Start.md), [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/jobs` | `hermes.jobs` | [Quick Start](01-Quick-Start.md), [Jobs and Cron](09-Jobs-and-Cron.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/kanban` | `hermes.kanban` | [Quick Start](01-Quick-Start.md), [Kanban](08-Kanban.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/models` | `hermes.models` | [Quick Start](01-Quick-Start.md), [Models and Providers](05-Models-and-Providers.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/profiles` | `hermes.profiles` | [Quick Start](01-Quick-Start.md), [Profiles](06-Profiles.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |
| `/hermes/logs` | `hermes.logs` | [Quick Start](01-Quick-Start.md), [Devices, Version Preview, and Logs](17-Devices-Version-Logs.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/usage` | `hermes.usage` | [Quick Start](01-Quick-Start.md), [Usage, Performance, and Skills Analytics](12-Usage-Performance-and-Skills-Analytics.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/performance` | `hermes.performance` | [Quick Start](01-Quick-Start.md), [Usage, Performance, and Skills Analytics](12-Usage-Performance-and-Skills-Analytics.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/skills-usage` | `hermes.skillsUsage` | [Quick Start](01-Quick-Start.md), [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md), [Usage, Performance, and Skills Analytics](12-Usage-Performance-and-Skills-Analytics.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/skills` | `hermes.skills` | [Quick Start](01-Quick-Start.md), [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/plugins` | `hermes.plugins` | [Quick Start](01-Quick-Start.md), [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/memory` | `hermes.memory` | [Quick Start](01-Quick-Start.md), [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/settings` | `hermes.settings` | [Quick Start](01-Quick-Start.md), [Settings and Security](14-Settings-and-Security.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/channels` | `hermes.channels` | [Quick Start](01-Quick-Start.md), [Channels and Gateways](13-Channels-and-Gateways.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/terminal` | `hermes.terminal` | [Quick Start](01-Quick-Start.md), [Web Terminal](15-Web-Terminal.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/devices` | `hermes.devices` | [Quick Start](01-Quick-Start.md), [Devices, Version Preview, and Logs](17-Devices-Version-Logs.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/group-chat` | `hermes.groupChat` | [Quick Start](01-Quick-Start.md), [Group Chat](07-Group-Chat.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/group-chat/room/:roomId` | `hermes.groupChatRoom` | [Quick Start](01-Quick-Start.md), [Group Chat](07-Group-Chat.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/files` | `hermes.files` | [Quick Start](01-Quick-Start.md), [Files and Workspaces](10-Files-and-Workspaces.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/coding-agents` | `hermes.codingAgents` | [Quick Start](01-Quick-Start.md), [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/version-preview` | `hermes.versionPreview` | [Quick Start](01-Quick-Start.md), [Devices, Version Preview, and Logs](17-Devices-Version-Logs.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/mcp` | `hermes.mcp` | [Quick Start](01-Quick-Start.md), [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md), [Docker and Deployment](18-Docker-and-Deployment.md) |
| `/hermes/chat` | `login` | [Quick Start](01-Quick-Start.md), [Architecture](02-Architecture.md), [Chat and Sessions](03-Chat-and-Sessions.md), [Docker and Deployment](18-Docker-and-Deployment.md), [API and Route Map](20-API-and-Route-Map.md) |

## API family counts

| API family | Path count |
| --- | ---: |
| `/api/auth/avatar` | 1 |
| `/api/auth/change-password` | 1 |
| `/api/auth/change-username` | 1 |
| `/api/auth/locked-ips` | 1 |
| `/api/auth/login` | 1 |
| `/api/auth/mcu-login` | 1 |
| `/api/auth/me` | 1 |
| `/api/auth/password` | 1 |
| `/api/auth/setup` | 1 |
| `/api/auth/status` | 1 |
| `/api/auth/users` | 2 |
| `/api/chat-run/runs` | 1 |
| `/api/coding-agents` | 1 |
| `/api/coding-agents/runs` | 2 |
| `/api/coding-agents/{id}` | 6 |
| `/api/cron-history` | 1 |
| `/api/cron-history/{jobId}` | 1 |
| `/api/devices` | 1 |
| `/api/devices/link-info` | 1 |
| `/api/devices/link-request` | 1 |
| `/api/devices/link-status` | 1 |
| `/api/devices/manual-request` | 1 |
| `/api/devices/pairing-link` | 1 |
| `/api/devices/peer-connections` | 11 |
| `/api/devices/scan` | 1 |
| `/api/devices/{id}` | 7 |
| `/api/hermes/auth` | 20 |
| `/api/hermes/available-models` | 1 |
| `/api/hermes/config` | 7 |
| `/api/hermes/custom-model` | 1 |
| `/api/hermes/download` | 1 |
| `/api/hermes/files` | 9 |
| `/api/hermes/group-chat` | 10 |
| `/api/hermes/jobs` | 5 |
| `/api/hermes/kanban` | 22 |
| `/api/hermes/logs` | 2 |
| `/api/hermes/mcp` | 5 |
| `/api/hermes/media` | 2 |
| `/api/hermes/memory` | 1 |
| `/api/hermes/model-alias` | 1 |
| `/api/hermes/model-context` | 2 |
| `/api/hermes/model-visibility` | 1 |
| `/api/hermes/openapi.json` | 1 |
| `/api/hermes/performance` | 1 |
| `/api/hermes/plugins` | 1 |
| `/api/hermes/profiles` | 11 |
| `/api/hermes/provider-models` | 2 |
| `/api/hermes/runtime-versions` | 9 |
| `/api/hermes/search` | 1 |
| `/api/hermes/sessions` | 17 |
| `/api/hermes/skills` | 9 |
| `/api/hermes/stt` | 6 |
| `/api/hermes/terminal` | 1 |
| `/api/hermes/tts` | 6 |
| `/api/hermes/update` | 7 |
| `/api/hermes/usage` | 1 |
| `/api/hermes/weixin` | 3 |
| `/api/hermes/workspace` | 2 |
| `/api/hermes/write-gate` | 4 |
| `/api/openapi.json` | 1 |
| `/api/tts/proxy` | 1 |
| `/api/voice/providers` | 1 |
| `/health` | 1 |
| `/upload` | 1 |
| `/webhook` | 1 |

## Screenshot asset map

See [Screenshot Gallery](21-Screenshot-Gallery.md). Assets live under `assets/screenshots/`.

## Agent task routing hints

- Chat/session bugs: start at [Chat and Sessions](03-Chat-and-Sessions.md), then inspect `packages/client/src/stores/hermes/chat.ts` and server `run-chat` services.
- History/search bugs: check [History and Search](04-History-and-Search.md); do not assume Chat session scope equals History scope.
- Model/provider issues: check [Models and Providers](05-Models-and-Providers.md); credential pool and custom provider behavior are sensitive.
- Group chat/member/routing bugs: check [Group Chat](07-Group-Chat.md); profile uniqueness and agent runtime readiness matter.
- Kanban bugs: check [Kanban](08-Kanban.md); compare dashboard parity before UI-only changes.
- Cron/jobs: check [Jobs and Cron](09-Jobs-and-Cron.md); external delivery and script execution can have side effects.
- Secrets/settings/platform channels: use [Settings and Security](14-Settings-and-Security.md) and [Channels and Gateways](13-Channels-and-Gateways.md); avoid exposing tokens in logs/screenshots.

## Machine-readable index

- `assets/wiki-index.json`
