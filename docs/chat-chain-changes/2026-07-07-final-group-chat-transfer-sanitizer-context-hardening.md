---
date: 2026-07-07
commit: pending-local
feature: Group Chat final transfer sanitizer, room authorization, and scoped context projection hardening
impact: Transfer-fence payloads fail closed across storage/realtime/context side channels; scoped model context projection strips routing mentions with boundary-aware parsing; authenticated room access now requires existing membership, matching room profile access, or super-admin scope before REST/Socket.IO metadata or write surfaces are exposed.
---

Final local PR4 blocker hardening after independent review.

Changed chain files:
- `packages/server/src/routes/hermes/group-chat.ts`
- `packages/server/src/services/hermes/group-chat/index.ts`
- `packages/server/src/services/hermes/group-chat/transfer-protocol.ts`
- `packages/server/src/services/hermes/group-chat/mention-routing.ts`
- `packages/server/src/services/hermes/group-chat/context-projection.ts`

Behavior impact:
- Sanitizes transfer-fence payloads from additional assistant/tool-call side channels before storage, realtime delivery, REST history/detail, and model/context projection.
- Redacts anonymous adjacent room metadata on list / invite lookup when read gates exist, so room names and invite codes are not leaked without an actor-capability read gate.
- Lists authenticated rooms through the same access rule used by direct room reads, including existing human membership as well as matching room-agent profiles; cloning a room persists the requester as a member of the clone.
- Uses range/state-machine transfer-fence stripping so crafted, malformed, or unterminated `group-chat-transfer` / `gc-transfer` fences fail closed instead of leaking raw tails. Streamed opener detection also buffers full opener names plus trailing spaces/CR across chunks, so payloads split immediately before the opener newline are not emitted.
- Restores scoped context projection mention stripping for routing mentions while preserving boundary-aware parsing to avoid email-like false positives.
- Blocks authenticated non-members from using guessed room IDs to read room detail/agent metadata, mutate room state, or join existing Socket.IO rooms unless they are already room members, have a matching profile through the room agents, or are super admins. Existing-but-forbidden rooms now return the same not-found shape as missing rooms on direct REST room routes, invite-code lookup, and authenticated Socket.IO joins, closing the private-room existence oracle. Authorized profile-linked users may still join and are then persisted as room members/actors.
- Treats `super_admin` as room-wide system visibility for REST metadata/detail/compression and Socket.IO joins, without requiring room membership or profile linkage, so admin compression and review paths use full room-visible context instead of public-only fallbacks.

Non-goal: this remains a minimal private-fact transfer subset; it does not claim the full Phase 05 handoff/publish/artifact/approval transfer protocol.
