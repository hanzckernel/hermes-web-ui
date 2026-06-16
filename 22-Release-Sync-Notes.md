<!--
agent_page_id: release-sync-notes
source_repo: hanzckernel/hermes-web-ui
upstream_repo: EKKOLearnAI/hermes-web-ui
synced_from_upstream: EKKOLearnAI/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3
last_verified: 2026-06-16
primary_routes:
primary_files:
  - package.json
  - docs/openapi.json
screenshot_assets:
-->

# Release Sync Notes

> Agent summary: this records freshness and validation evidence for the wiki.

## Synced refs

- Upstream: `EKKOLearnAI/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3`
- Fork main after fast-forward: `hanzckernel/hermes-web-ui@0cb047c31e36da2d5e11eb7751c4fa6c48748df3`
- Package version: `0.6.15`
- Date: 2026-06-16 Europe/Berlin

## Validation performed

```bash
npm ci
npm test -- --run tests/server/health-controller.test.ts tests/server/sessions-controller.test.ts tests/client/app-store.test.ts
npm run build
```

Observed result before wiki authoring:

- `npm ci`: completed; npm reported existing audit vulnerabilities from dependency tree.
- Targeted tests: 3 files passed, 55 tests passed.
- `npm run build`: completed; generated OpenAPI spec with 227 endpoints / 38 tags; Vite reported large chunk warnings but build passed.

## Remote mutation boundary

- Fork main was pushed only to `hanzckernel/hermes-web-ui`.
- Nothing was pushed to `EKKOLearnAI/hermes-web-ui`.
- Wiki is for review on Han's own GitHub fork before any broader/upstream action.

## Refresh rule

When upstream advances, regenerate this wiki's route map, API map, screenshots, and release notes. Do not silently reuse stale screenshots for changed UI surfaces.
