import { getDb } from '../../../../db'
import type { GroupActor } from './types'

export type GroupCapability =
    | 'message.read'
    | 'message.write'
    | 'channel.join'
    | 'channel.create.private'
    | 'channel.create.task'
    | 'channel.moderate.own'
    | 'agent.invoke'
    | 'agent.handoff'
    | 'tool.read'
    | 'tool.write'
    | 'tool.execute'
    | 'approval.request'
    | 'approval.respond'
    | 'artifact.create'
    | 'artifact.publish'
    | 'platform.post'
    | 'platform.edit'

const HUMAN_DEFAULTS = new Set<GroupCapability>([
    'message.read',
    'message.write',
    'approval.respond',
])

const AGENT_DEFAULTS = new Set<GroupCapability>([
    'message.read',
    'message.write',
    'approval.request',
])

export class CapabilityPolicy {
    private db() { return getDb() }

    can(actor: GroupActor, capability: GroupCapability | string): boolean {
        if (actor.status !== 'active') return false
        const explicit = this.explicitCapability(actor.id, capability)
        if (explicit != null) return explicit
        if (actor.kind === 'human') return HUMAN_DEFAULTS.has(capability as GroupCapability)
        if (actor.kind === 'agent') return AGENT_DEFAULTS.has(capability as GroupCapability)
        return false
    }

    canCreateChannel(actor: GroupActor, kind: string): boolean {
        const capability = `channel.create.${kind}`
        const explicit = this.explicitCapability(actor.id, capability)
        if (explicit != null) return actor.status === 'active' && explicit
        if (kind === 'private' || kind === 'task') return this.can(actor, capability)
        if (kind === 'public' || kind === 'system' || kind === 'audit') {
            return actor.status === 'active' && actor.kind === 'system'
        }
        return false
    }

    defaultCapabilities(actor: GroupActor): string[] {
        if (actor.status !== 'active') return []
        if (actor.kind === 'human') return [...HUMAN_DEFAULTS]
        if (actor.kind === 'agent') return [...AGENT_DEFAULTS]
        return []
    }

    effectiveCapabilities(actor: GroupActor): string[] {
        const capabilities = new Set(this.defaultCapabilities(actor))
        const rows = (this.db()?.prepare(
            'SELECT capability, enabled FROM gc_actor_capabilities WHERE actorId = ?'
        ).all(actor.id) || []) as Array<{ capability: string; enabled: number }>
        for (const row of rows) {
            if (Number(row.enabled) === 1) capabilities.add(row.capability)
            else capabilities.delete(row.capability)
        }
        return [...capabilities].sort()
    }

    private explicitCapability(actorId: string, capability: string): boolean | null {
        const row = this.db()?.prepare(
            'SELECT enabled, scopeJson FROM gc_actor_capabilities WHERE actorId = ? AND capability = ?'
        ).get(actorId, capability) as { enabled: number; scopeJson?: string } | undefined
        if (!row) return null
        this.parseScope(row.scopeJson)
        return Number(row.enabled) === 1
    }

    private parseScope(value: unknown): Record<string, unknown> {
        if (typeof value !== 'string' || !value) return {}
        try {
            const parsed = JSON.parse(value)
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch {
            return {}
        }
    }
}
