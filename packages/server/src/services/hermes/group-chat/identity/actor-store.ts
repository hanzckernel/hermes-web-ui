import { getDb } from '../../../../db'
import { CapabilityPolicy } from './capability-policy'
import { agentActorId, humanActorId, newAuthenticatedHumanActorId, systemActorId } from './actor-ids'
import type { GroupActor, GroupActorKind, GroupActorSource, GroupAgentKind } from './types'

type ActorRow = Omit<GroupActor, 'metadata'> & { metadataJson: string }

interface EnsureActorInput {
    id: string
    roomId: string
    kind: GroupActorKind
    source: GroupActorSource
    displayName?: string
    description?: string
    profile?: string | null
    agentKind?: GroupAgentKind | null
    authUserId?: number | null
    metadata?: Record<string, unknown>
}

export class ActorStore {
    private readonly capabilityPolicy = new CapabilityPolicy()
    private db() { return getDb() }

    ensureHumanActor(input: {
        roomId: string
        userId: string
        displayName?: string
        description?: string
        authUserId?: number | null
        metadata?: Record<string, unknown>
    }): GroupActor {
        const authUserId = typeof input.authUserId === 'number' && input.authUserId > 0 ? input.authUserId : null
        const existingAuthActor = authUserId ? this.getHumanActorByAuthUserId(input.roomId, authUserId) : null
        return this.ensureActor({
            id: existingAuthActor?.id || (authUserId
                ? newAuthenticatedHumanActorId(input.roomId)
                : humanActorId(input.roomId, input.userId)),
            roomId: input.roomId,
            kind: 'human',
            source: 'web-ui',
            displayName: input.displayName,
            description: input.description,
            authUserId,
            metadata: input.metadata,
        })
    }

    ensureAgentActor(input: {
        roomId: string
        agentId: string
        profile: string
        displayName?: string
        description?: string
        agentKind?: GroupAgentKind
        metadata?: Record<string, unknown>
    }): GroupActor {
        return this.ensureActor({
            id: agentActorId(input.roomId, input.agentId),
            roomId: input.roomId,
            kind: 'agent',
            source: 'group-chat-agent',
            displayName: input.displayName,
            description: input.description,
            profile: input.profile,
            agentKind: input.agentKind || 'hermes',
            metadata: input.metadata,
        })
    }

    ensureSystemActor(roomId: string): GroupActor {
        return this.ensureActor({
            id: systemActorId(roomId),
            roomId,
            kind: 'system',
            source: 'system',
            displayName: 'System',
        })
    }

    listActors(roomId: string): GroupActor[] {
        const rows = (this.db()?.prepare(
            `SELECT id, roomId, kind, source, displayName, description, profile, agentKind, authUserId,
                    status, createdAt, updatedAt, metadataJson
             FROM gc_actors
             WHERE roomId = ?
             ORDER BY createdAt, rowid`
        ).all(roomId) || []) as unknown as ActorRow[]
        return rows.map(row => this.mapActor(row))
    }

    deleteActor(actorId: string): void {
        const db = this.db()
        if (!db) return
        db.prepare('DELETE FROM gc_actor_capabilities WHERE actorId = ?').run(actorId)
        db.prepare('DELETE FROM gc_actor_private_facts WHERE actorId = ?').run(actorId)
        db.prepare('DELETE FROM gc_actors WHERE id = ?').run(actorId)
    }

    deleteRoomActors(roomId: string): void {
        const db = this.db()
        if (!db) return
        db.prepare('DELETE FROM gc_actor_capabilities WHERE actorId IN (SELECT id FROM gc_actors WHERE roomId = ?)').run(roomId)
        db.prepare('DELETE FROM gc_actor_private_facts WHERE roomId = ?').run(roomId)
        db.prepare('DELETE FROM gc_actors WHERE roomId = ?').run(roomId)
    }

    canCreateChannel(actorId: string, kind: string): boolean {
        const actor = this.getActor(actorId)
        return actor ? this.capabilityPolicy.canCreateChannel(actor, kind) : false
    }

    private ensureActor(input: EnsureActorInput): GroupActor {
        const now = Date.now()
        const metadataJson = JSON.stringify(input.metadata || {})
        this.db()?.prepare(
            `INSERT INTO gc_actors (
                id, roomId, kind, source, displayName, description, profile, agentKind, authUserId,
                status, createdAt, updatedAt, metadataJson
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                displayName = excluded.displayName,
                description = excluded.description,
                profile = excluded.profile,
                agentKind = excluded.agentKind,
                authUserId = excluded.authUserId,
                status = 'active',
                updatedAt = excluded.updatedAt,
                metadataJson = excluded.metadataJson`
        ).run(
            input.id,
            input.roomId,
            input.kind,
            input.source,
            input.displayName || '',
            input.description || '',
            input.profile ?? null,
            input.agentKind ?? null,
            input.authUserId ?? null,
            now,
            now,
            metadataJson,
        )
        return this.getActor(input.id)!
    }

    getActor(id: string): GroupActor | null {
        const row = this.db()?.prepare(
            `SELECT id, roomId, kind, source, displayName, description, profile, agentKind, authUserId,
                    status, createdAt, updatedAt, metadataJson
             FROM gc_actors
             WHERE id = ?`
        ).get(id) as ActorRow | undefined
        return row ? this.mapActor(row) : null
    }

    private getHumanActorByAuthUserId(roomId: string, authUserId: number): GroupActor | null {
        const row = this.db()?.prepare(
            `SELECT id, roomId, kind, source, displayName, description, profile, agentKind, authUserId,
                    status, createdAt, updatedAt, metadataJson
             FROM gc_actors
             WHERE roomId = ? AND kind = 'human' AND authUserId = ?
             ORDER BY createdAt, rowid
             LIMIT 1`
        ).get(roomId, authUserId) as ActorRow | undefined
        return row ? this.mapActor(row) : null
    }

    private mapActor(row: ActorRow): GroupActor {
        let metadata: Record<string, unknown> = {}
        try {
            const parsed = JSON.parse(row.metadataJson || '{}')
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed
        } catch {
            metadata = {}
        }
        const actor = { ...row, metadata }
        return { ...actor, capabilities: this.capabilityPolicy.effectiveCapabilities(actor) }
    }
}
