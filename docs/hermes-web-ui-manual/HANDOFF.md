# WUI Manual Handoff

This branch is a handoff draft for the Hermes Web UI manual/wiki work. It is not upstream-ready as-is.

## Status

- Source PR reference: https://github.com/EKKOLearnAI/hermes-studio/pull/1613
- That PR was closed and should not be merged as-is.
- The manual structure, release coverage mapping, and agent-readable assets are reusable.
- Many screenshots are old and must be refreshed from latest `main` before any upstream PR.

## Reusable parts

- Markdown manual pages under `docs/hermes-web-ui-manual/`
- `00-Agent-Index.md` for agent entry
- `assets/wiki-index.json` for page/capability/screenshot mapping
- `assets/manual-briefs.json` for rewrite constraints
- `assets/manual-version-audit-0.6.15.json` for release coverage
- `22-Release-Sync-Notes.md` for 0.6.13–0.6.15 release-to-manual mapping

## Do before reopening/submitting upstream

1. Rebase or recreate from latest `main`.
2. Run a clean latest-main build.
3. Recapture core screenshots from the live UI.
4. Replace stale screenshots.
5. Regenerate `assets/screenshots-contact-sheet.jpg`.
6. Update screenshot refs/counts in `assets/wiki-index.json` and `assets/manual-briefs.json`.
7. Run OCR/privacy scan and visual UAT.
8. Keep the manual under top-level `docs/`, not `packages/website/public/docs/`, unless website artifact growth is explicitly desired.

## Packaging note

Current packaging excludes top-level `docs/` from npm package and desktop bundled `webui` resources. This was verified during the original draft with `npm pack --dry-run --ignore-scripts --json` showing `docs_entries=0`.
