# Technical Appendix: Release Sync Notes

This appendix tracks how the manual maps to recent Hermes Web UI releases. It is written for maintainers and agents checking whether the public manual still covers the product surface.

## 0.6.15 coverage checklist

| Release item | Manual coverage | Visual coverage |
| --- | --- | --- |
| Redesigned chat sidebars and tuned history loading controls | [Chat and Sessions](03-Chat-and-Sessions.md), [History and Search](04-History-and-Search.md) | Existing chat/history screenshots |
| Skill command picker in chat input | [Chat and Sessions](03-Chat-and-Sessions.md), [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md) | `chat-skill-command-picker.png` |
| Claude and Gemini OAuth providers, Gemini model ID normalization, and model/config refresh | [Models and Providers](05-Models-and-Providers.md) | `models-refresh-and-oauth-overview.png`, `models-oauth-provider-picker.png`, `models-claude-oauth-modal.png` |
| Refreshed thinking indicator and toolbar layout | [Chat and Sessions](03-Chat-and-Sessions.md) | Covered textually; no separate screenshot required unless the live state changes materially |
| Dark-theme input and select border fixes | [Settings and Security](14-Settings-and-Security.md), [Troubleshooting](19-Troubleshooting.md) | Covered textually as a visual/UX fix; no separate screenshot required |
| Runtime setup checks local runtime before download-source choices and keeps startup state visible | [Quick Start](01-Quick-Start.md), [Settings and Security](14-Settings-and-Security.md), [Docker and Deployment](18-Docker-and-Deployment.md) | Existing startup/settings screenshots |
| Desktop self-updates handle stale app processes and Windows gateway cleanup better | [Devices, Version, and Logs](17-Devices-Version-Logs.md), [Troubleshooting](19-Troubleshooting.md) | Existing version/log screenshots |
| Managed gateways stop on app shutdown and unexpectedly exited gateways can respawn in managed runtime sessions | [Channels and Gateways](13-Channels-and-Gateways.md), [Docker and Deployment](18-Docker-and-Deployment.md) | Existing channels/settings/log screenshots |
| Desktop server shutdown reduces orphaned backend, bridge, and gateway processes | [Devices, Version, and Logs](17-Devices-Version-Logs.md), [Troubleshooting](19-Troubleshooting.md) | Existing logs/version screenshots |
| README and website showcase use walkthrough GIF/static preview | [Screenshot Gallery](21-Screenshot-Gallery.md) and this appendix | Not a Web UI in-app workflow screenshot |

## 0.6.14 coverage checklist

| Release item | Manual coverage | Visual coverage |
| --- | --- | --- |
| Website/docs refresh and Hermes Studio client manual | Home, [Screenshot Gallery](21-Screenshot-Gallery.md) | Contact sheet and gallery screenshots |
| Completion notifications from desktop shell and supported browsers | [Jobs and Cron](09-Jobs-and-Cron.md), [Settings and Security](14-Settings-and-Security.md) | Covered textually |
| Desktop title bar, startup splash, approval drawers, centered loading, Linux controls | [Quick Start](01-Quick-Start.md), [Settings and Security](14-Settings-and-Security.md), [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md) | `skills-write-approvals.png`, startup/settings screenshots |
| Workspace folder direct actions | [Files and Workspaces](10-Files-and-Workspaces.md) | `files-workspace-drawer.png` |
| Profile/runtime startup, reserved profile rename protection, Linux deb launch fixes, resume checks | [Profiles](06-Profiles.md), [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md), [Troubleshooting](19-Troubleshooting.md) | Existing profile/coding-agent screenshots |
| Group chat identity alignment | [Group Chat](07-Group-Chat.md) | Existing group-chat screenshots |
| Safer static asset delivery | [Docker and Deployment](18-Docker-and-Deployment.md), [Troubleshooting](19-Troubleshooting.md) | Textual deployment note |
| Device pairing safety: per-start codes, approval requests, throttling, LAN discovery | [Devices, Version, and Logs](17-Devices-Version-Logs.md) | `devices-pairing-overview.png`, `devices-pairing-code-modal.png`, `devices-requests-drawer.png` |
| Desktop Claude Code detection via shell PATH and package-manager locations | [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md), [Troubleshooting](19-Troubleshooting.md) | Existing coding-agent screenshot |
| Write-gate controls for memory and skills | [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md) | `skills-write-approvals.png` |

## 0.6.13 coverage checklist

| Release item | Manual coverage | Visual coverage |
| --- | --- | --- |
| Alibaba Coding Plan qwen3.7-plus preset | [Models and Providers](05-Models-and-Providers.md), [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md) | Existing model/coding-agent screenshots |
| Safer file handling for literal-dot paths and malformed skill-import filenames | [Files and Workspaces](10-Files-and-Workspaces.md), [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md) | Existing file/skills screenshots |
| Chat stability on mobile and browsers without speech synthesis | [Chat and Sessions](03-Chat-and-Sessions.md), [Troubleshooting](19-Troubleshooting.md) | Textual reliability note |
| Agent failure tails and Claude Code root-permission launch reliability | [Coding Agents, Global Agent, and MCP](16-Coding-Agents-Global-Agent-and-MCP.md), [Troubleshooting](19-Troubleshooting.md) | Existing coding-agent/log screenshots |
| Desktop update reliability and release-feed fallback | [Devices, Version, and Logs](17-Devices-Version-Logs.md), [Troubleshooting](19-Troubleshooting.md) | Existing version/log screenshots |
| Release automation separates Web UI/Docker releases from desktop Latest promotion | [Docker and Deployment](18-Docker-and-Deployment.md), this appendix | Textual release note |

## Refresh checklist

- Review `packages/client/src/data/changelog.ts` and localized changelog strings before every manual refresh.
- Map each release item to either a user-facing manual page, this appendix, or an explicit "not an in-app workflow" note.
- Add screenshots for visible user workflows; keep runtime-only, shutdown-only, and packaging-only changes textual unless a stable UI state exists.
- Review screenshots for stale UI and sensitive data before publishing.
- Check that visible pages avoid code-first and provenance-heavy language.
- Validate that internal links resolve as GitHub Wiki pages.
- Keep archived translations separate from the English manual until translation work resumes.
