# Hermes Web UI Wiki

![Hermes Web UI chat overview](assets/screenshots/chat-main-overview.png)

这是 Han 的 fork `hanzckernel/hermes-web-ui` 的审查用 GitHub Wiki。内容基于 upstream `EKKOLearnAI/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3`，fork `main` 已同步到该 SHA。Wiki 目标是同时服务两类读者：

- 人：快速理解功能、安装、使用、部署和排错。
- Agent：快速定位 route、源码文件、API、截图证据和边界条件。

## Start here

- [Quick Start](01-Quick-Start.md)
- [Architecture](02-Architecture.md)
- [Chat and Sessions](03-Chat-and-Sessions.md)
- [Agent Index](00-Agent-Index.md)
- [Screenshot Gallery](21-Screenshot-Gallery.md)

## Core feature map

| Area | Page | Route | Screenshot |
| --- | --- | --- | --- |
| Chat | [Chat and Sessions](03-Chat-and-Sessions.md) | `/hermes/chat` | `chat-main-overview.png` |
| History | [History and Search](04-History-and-Search.md) | `/hermes/history` | `history-sessions.png` |
| Models | [Models and Providers](05-Models-and-Providers.md) | `/hermes/models` | `models-management.png` |
| Profiles | [Profiles](06-Profiles.md) | `/hermes/profiles` | `profiles-management.png` |
| Group Chat | [Group Chat](07-Group-Chat.md) | `/hermes/group-chat` | `group-chat-rooms.png` |
| Kanban | [Kanban](08-Kanban.md) | `/hermes/kanban` | `kanban-board.png` |
| Jobs | [Jobs and Cron](09-Jobs-and-Cron.md) | `/hermes/jobs` | `jobs-manager.png` |
| Files | [Files and Workspaces](10-Files-and-Workspaces.md) | `/hermes/files` | `files-workspace-drawer.png` |
| Analytics | [Usage, Performance, and Skills Analytics](12-Usage-Performance-and-Skills-Analytics.md) | `/hermes/usage` | `usage-analytics.png` |
| Coding/MCP | [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md) | `/hermes/coding-agents` | `coding-agents.png` |

## For agents

先读 [Agent Index](00-Agent-Index.md)，再读 `assets/wiki-index.json`。每个页面顶部都有 HTML 注释形式的 metadata，包含 `agent_page_id`、routes、source files、screenshots。页面正文只描述 latest-main 已存在的产品行为；不要把 wiki 当成产品 spec 修改依据，改代码前仍要回源到源码和 tests。

## Privacy note

截图来自 latest-main 仓库内的 product/manual screenshots，或 isolated demo runtime。不要把截图中的演示数据当成 Han 的真实会话、token、profile 或日志。
