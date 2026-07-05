---
date: 2026-07-05
pr: pending
feature: Group Chat channel visibility hardening
impact: Private channel realtime activity now keeps interrupt controls and stream lifecycle events bound to the same actor-visible envelope as the underlying message/status.
---

Phase 03 hardens Group Chat channel visibility after final review. Agent interrupt requests now require the caller to see the active context-status envelope before cancelling private work, so public-only room members cannot stop unseen private agent activity. Streaming ownership is keyed by room plus stream id, preventing cross-room stream replay while still allowing independent rooms to use the same stream id safely. Human sockets also cannot reserve a room agent display name or persist assistant/tool metadata, and the client classifies agents by stable agent id rather than display name.
