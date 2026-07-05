---
date: 2026-07-05
pr: pending
feature: Group Chat actor identity
impact: Group Chat now records stable room-scoped actor identity and capability/private-fact primitives while preserving existing room/member/agent behavior.
---

Phase 02 adds the actor/capability/private-fact foundation for later channel visibility, scoped context, and information transfer work. Existing public group-chat behavior remains unchanged: messages, members, agents, streaming, approvals, and context clearing continue to use the current room-level flow. Actor summaries are public-safe: numeric auth user IDs are omitted and authenticated actor IDs use persisted opaque identifiers rather than reversible/sequential IDs; legacy persisted rooms, members, and agents are backfilled when summaries are read.

Review boundary: this does not implement channel visibility, private message filtering, scoped LLM context, structured transfer cards, durable outbox, or external platform adapters.
