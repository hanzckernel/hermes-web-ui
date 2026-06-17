# Hermes Web UI Manual Source Package

This directory contains the source package for the Hermes Web UI user manual. It mirrors the GitHub Wiki-style manual as regular repository documentation so it can be reviewed through a normal pull request.

## Human entry points

- [Home](Home.md)
- [Quick Start](01-Quick-Start.md)
- [Chat and Sessions](03-Chat-and-Sessions.md)
- [Models and Providers](05-Models-and-Providers.md)
- [Skills, Memory, and Plugins](11-Skills-Memory-and-Plugins.md)
- [Devices, Version, and Logs](17-Devices-Version-Logs.md)
- [Screenshot Gallery](21-Screenshot-Gallery.md)
- [Release Sync Notes](22-Release-Sync-Notes.md)

## Agent entry points

- [Agent Index](00-Agent-Index.md) is the natural first page for agents.
- `assets/wiki-index.json` maps pages, capabilities, related pages, and screenshot references.
- `assets/manual-briefs.json` preserves page-writing constraints and notes to retain during future refreshes.
- `assets/manual-version-audit-0.6.15.json` maps release coverage, screenshot provenance, and privacy-review status.

## Packaging note

This package intentionally lives under top-level `docs/`. The root npm package currently includes only `bin/` and `dist/`, and the desktop bundler excludes top-level `docs/` from the packaged `webui` resource. Keep screenshot-heavy manuals here unless the intent is to publish them through the website build.
