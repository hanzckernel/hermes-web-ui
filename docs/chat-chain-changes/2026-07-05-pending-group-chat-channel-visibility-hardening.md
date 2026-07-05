---
date: 2026-07-05
pr: pending
feature: Group Chat channel visibility hardening
impact: Private channel realtime activity now keeps interrupt controls and stream lifecycle events bound to the same actor-visible envelope as the underlying message/status.
---

Phase 03 hardens Group Chat channel visibility after final review. Agent interrupt requests now require the caller to see the active context-status visibility envelope before cancelling private work, and ready status reuses the stored active envelope instead of trusting client-supplied public fields. Streaming ownership is keyed by room plus stream id and stream starts are accepted only from verified agent sockets, preventing human assistant-stream spoofing and cross-room stream replay while still allowing independent rooms to use the same stream id safely. Human sockets also cannot reserve a room agent display name or persist assistant/tool metadata, add-agent routes reject human/agent display-name collisions before runtime connection, and the client classifies agents by stable agent id rather than display name. Actor-scoped agent context and token refreshes are bounded to public plus the active reply visibility envelope, and bridge session ids include the visibility envelope so private bridge-side state is not reused by later public turns. Realtime context-status identity is derived from the connected agent socket instead of a client-supplied display name.
