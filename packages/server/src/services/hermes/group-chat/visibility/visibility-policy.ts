import { systemActorId } from '../identity/actor-ids'
import { ChannelStore } from './channel-store'
import { normalizeChannelId, normalizeScope, normalizeVisibility, type VisibleGroupMessage } from './types'

interface ParsedAudience {
    actorIds: string[]
    valid: boolean
}

interface NormalizedVisibleMessage extends VisibleGroupMessage {
    id: string
    roomId: string
    senderId: string
    timestamp: number
    channelId: string
    visibility: string
    scope: string
    audienceJson: string
    metadataJson: string
}

export class VisibilityPolicy {
    constructor(private readonly channels = new ChannelStore()) {}

    canReadMessage(actorId: string, message: VisibleGroupMessage): boolean {
        const normalized = this.normalizeMessage(message)
        if (actorId === normalized.senderId || actorId === systemActorId(normalized.roomId)) return true

        const audience = this.parseAudience(normalized.audienceJson)
        const visibility = normalized.visibility
        if (!audience.valid) return false
        if (visibility === 'public' && normalized.channelId === 'public') {
            return audience.actorIds.length === 0 || audience.actorIds.includes(actorId)
        }
        if (audience.actorIds.includes(actorId)) return true

        const membership = this.channels.getChannelMember(normalized.roomId, normalizeChannelId(normalized.channelId), actorId)
        if (membership?.canRead) return true

        if (visibility === 'agent-only') return actorId.includes(':agent:')
        if (visibility === 'system-only' || visibility === 'audit-only') return false
        if (visibility === 'external') return false

        return false
    }

    canWriteChannel(actorId: string, roomId: string, channelId: string): boolean {
        const normalizedChannelId = normalizeChannelId(channelId)
        if (normalizedChannelId === 'public') return true
        return Boolean(this.channels.getChannelMember(roomId, normalizedChannelId, actorId)?.canWrite)
    }

    resolveAudience(message: VisibleGroupMessage): string[] {
        return this.parseAudience(message.audienceJson).actorIds
    }

    normalizeMessage(message: VisibleGroupMessage): NormalizedVisibleMessage {
        return {
            ...message,
            id: message.id,
            roomId: message.roomId,
            senderId: message.senderId,
            timestamp: message.timestamp,
            channelId: normalizeChannelId(message.channelId),
            visibility: normalizeVisibility(message.visibility),
            scope: normalizeScope(message.scope),
            audienceJson: typeof message.audienceJson === 'string' ? message.audienceJson : '[]',
            metadataJson: typeof message.metadataJson === 'string' ? message.metadataJson : '{}',
        }
    }

    private parseAudience(value: unknown): ParsedAudience {
        if (value == null || value === '') return { actorIds: [], valid: true }
        if (Array.isArray(value)) return this.sanitizeActorIds(value)
        if (typeof value !== 'string') return { actorIds: [], valid: false }
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) return this.sanitizeActorIds(parsed)
            if (parsed && typeof parsed === 'object') {
                const record = parsed as Record<string, unknown>
                const actorIds = record.actorIds || record.audienceActorIds || record.actors
                if (Array.isArray(actorIds)) return this.sanitizeActorIds(actorIds)
            }
            return { actorIds: [], valid: false }
        } catch {
            return { actorIds: [], valid: false }
        }
    }

    private sanitizeActorIds(values: unknown[]): ParsedAudience {
        const actorIds = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        return { actorIds: [...new Set(actorIds)], valid: actorIds.length === values.length }
    }
}
