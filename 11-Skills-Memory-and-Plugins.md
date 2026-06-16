<!--
agent_page_id: skills-memory-plugins
source_repo: hanzckernel/hermes-web-ui
upstream_repo: EKKOLearnAI/hermes-web-ui
synced_from_upstream: EKKOLearnAI/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3
last_verified: 2026-06-16
primary_routes:
  - /hermes/skills
  - /hermes/memory
  - /hermes/plugins
primary_files:
  - packages/client/src/views/hermes/SkillsView.vue
  - packages/client/src/views/hermes/MemoryView.vue
  - packages/client/src/views/hermes/PluginsView.vue
  - packages/server/src/routes/hermes/skills.ts
  - packages/server/src/routes/hermes/memory.ts
  - packages/server/src/routes/hermes/plugins.ts
screenshot_assets:
  - assets/screenshots/skills-list.png
  - assets/screenshots/memory-notes.png
  - assets/screenshots/plugins-inventory.png
-->

# Skills, Memory, and Plugins

> Agent summary: Skill 浏览/详情、Memory/Profile notes、plugin inventory 与 agent 可复用能力。

## What it is

Skill 浏览/详情、Memory/Profile notes、plugin inventory 与 agent 可复用能力。 本页面把可见 UI、route、源码锚点和截图放在一起，便于人审查，也便于 agent 快速定位。

## Routes

- `/hermes/skills`
- `/hermes/memory`
- `/hermes/plugins`

## How to use it

1. 打开对应 route 或从左侧导航进入。
2. 先确认当前 profile、auth token、provider/model 或 runtime 状态。
3. 在 UI 中完成目标动作；涉及配置、文件、终端、cron、channel、provider 的动作都有本地或远程副作用，执行前确认范围。
4. 如果要让 agent 修改此区域，先让 agent 读取本页 metadata 和源码锚点，再回源检查 tests/API。

## Screenshots

![skills list](assets/screenshots/skills-list.png)

<sub>skills list — isolated latest-main product/manual screenshot; no private Han data.</sub>

![memory notes](assets/screenshots/memory-notes.png)

<sub>memory notes — isolated latest-main product/manual screenshot; no private Han data.</sub>

![plugins inventory](assets/screenshots/plugins-inventory.png)

<sub>plugins inventory — isolated latest-main product/manual screenshot; no private Han data.</sub>

## Source anchors

- `packages/client/src/views/hermes/SkillsView.vue`
- `packages/client/src/views/hermes/MemoryView.vue`
- `packages/client/src/views/hermes/PluginsView.vue`
- `packages/server/src/routes/hermes/skills.ts`
- `packages/server/src/routes/hermes/memory.ts`
- `packages/server/src/routes/hermes/plugins.ts`

## Agent notes

- 页面描述的是 latest-main 的已观察/源码支持行为；不要把 wiki 当成唯一 spec。
- 涉及 tokens、profiles、logs、workspace paths 的页面截图必须使用 demo/sanitized 数据。
- 改动前先找现有 tests；没有覆盖时优先补最小 regression test。

## Related pages

- [Agent Index](00-Agent-Index.md)
- [API and Route Map](20-API-and-Route-Map.md)
- [Screenshot Gallery](21-Screenshot-Gallery.md)
