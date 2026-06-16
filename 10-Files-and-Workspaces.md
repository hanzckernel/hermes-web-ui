<!--
agent_page_id: files-and-workspaces
source_repo: hanzckernel/hermes-web-ui
upstream_repo: EKKOLearnAI/hermes-web-ui
synced_from_upstream: EKKOLearnAI/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3
last_verified: 2026-06-16
primary_routes:
  - /hermes/files
primary_files:
  - packages/client/src/views/hermes/FilesView.vue
  - packages/client/src/stores/hermes/files.ts
  - packages/server/src/routes/hermes/files.ts
  - packages/server/src/services/hermes/file-provider.ts
screenshot_assets:
  - assets/screenshots/files-workspace-drawer.png
-->

# Files and Workspaces

> Agent summary: 文件浏览、上传/下载、预览/编辑、重命名/复制/移动/删除，多 backend 路径处理。

## What it is

文件浏览、上传/下载、预览/编辑、重命名/复制/移动/删除，多 backend 路径处理。 本页面把可见 UI、route、源码锚点和截图放在一起，便于人审查，也便于 agent 快速定位。

## Routes

- `/hermes/files`

## How to use it

1. 打开对应 route 或从左侧导航进入。
2. 先确认当前 profile、auth token、provider/model 或 runtime 状态。
3. 在 UI 中完成目标动作；涉及配置、文件、终端、cron、channel、provider 的动作都有本地或远程副作用，执行前确认范围。
4. 如果要让 agent 修改此区域，先让 agent 读取本页 metadata 和源码锚点，再回源检查 tests/API。

## Screenshots

![files workspace drawer](assets/screenshots/files-workspace-drawer.png)

<sub>files workspace drawer — isolated latest-main product/manual screenshot; no private Han data.</sub>

## Source anchors

- `packages/client/src/views/hermes/FilesView.vue`
- `packages/client/src/stores/hermes/files.ts`
- `packages/server/src/routes/hermes/files.ts`
- `packages/server/src/services/hermes/file-provider.ts`

## Agent notes

- 页面描述的是 latest-main 的已观察/源码支持行为；不要把 wiki 当成唯一 spec。
- 涉及 tokens、profiles、logs、workspace paths 的页面截图必须使用 demo/sanitized 数据。
- 改动前先找现有 tests；没有覆盖时优先补最小 regression test。

## Related pages

- [Agent Index](00-Agent-Index.md)
- [API and Route Map](20-API-and-Route-Map.md)
- [Screenshot Gallery](21-Screenshot-Gallery.md)
