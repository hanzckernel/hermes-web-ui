import { getDb } from '../../../../db'
import type { GroupChannel, GroupChannelKind, GroupChannelMember, GroupMessageVisibility } from './types'

interface ChannelRow extends Omit<GroupChannel, 'metadata'> { metadataJson: string }
interface ChannelMemberRow {
    roomId: string
    channelId: string
    actorId: string
    canRead: number
    canWrite: number
    canInvite: number
    canModerate: number
    updatedAt: number
}

export class ChannelStore {
    private db() { return getDb() }

    ensureDefaultPublicChannel(roomId: string, createdBy = 'system'): GroupChannel {
        const now = Date.now()
        this.db()?.prepare(
            `INSERT INTO gc_channels (id, roomId, kind, name, parentChannelId, defaultVisibility, createdBy, createdAt, updatedAt, metadataJson)
             VALUES ('public', ?, 'public', 'Public', NULL, 'public', ?, ?, ?, '{}')
             ON CONFLICT(roomId, id) DO UPDATE SET updatedAt = excluded.updatedAt`
        ).run(roomId, createdBy, now, now)
        return this.getChannel(roomId, 'public')!
    }

    createChannel(input: {
        roomId: string
        id?: string
        kind: Exclude<GroupChannelKind, 'public'> | GroupChannelKind
        name: string
        createdBy: string
        parentChannelId?: string | null
        defaultVisibility?: GroupMessageVisibility
        members?: Array<Partial<Omit<GroupChannelMember, 'roomId' | 'channelId' | 'updatedAt'>> & { actorId: string }>
        metadata?: Record<string, unknown>
    }): GroupChannel {
        const now = Date.now()
        const id = input.id || `${input.kind}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const metadataJson = JSON.stringify(input.metadata || {})
        this.db()?.prepare(
            `INSERT INTO gc_channels (id, roomId, kind, name, parentChannelId, defaultVisibility, createdBy, createdAt, updatedAt, metadataJson)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(roomId, id) DO UPDATE SET
                kind = excluded.kind,
                name = excluded.name,
                parentChannelId = excluded.parentChannelId,
                defaultVisibility = excluded.defaultVisibility,
                updatedAt = excluded.updatedAt,
                metadataJson = excluded.metadataJson`
        ).run(
            id,
            input.roomId,
            input.kind,
            input.name,
            input.parentChannelId ?? null,
            input.defaultVisibility || defaultVisibilityForKind(input.kind),
            input.createdBy,
            now,
            now,
            metadataJson,
        )
        for (const member of input.members || []) {
            this.addChannelMember(input.roomId, id, member.actorId, member)
        }
        return this.getChannel(input.roomId, id)!
    }

    listChannels(roomId: string): GroupChannel[] {
        const rows = (this.db()?.prepare(
            `SELECT id, roomId, kind, name, parentChannelId, defaultVisibility, createdBy, createdAt, updatedAt, metadataJson
             FROM gc_channels WHERE roomId = ? ORDER BY CASE id WHEN 'public' THEN 0 ELSE 1 END, createdAt, id`
        ).all(roomId) || []) as unknown as ChannelRow[]
        return rows.map(row => this.mapChannel(row))
    }

    getChannel(roomId: string, channelId: string): GroupChannel | null {
        const row = this.db()?.prepare(
            `SELECT id, roomId, kind, name, parentChannelId, defaultVisibility, createdBy, createdAt, updatedAt, metadataJson
             FROM gc_channels WHERE roomId = ? AND id = ?`
        ).get(roomId, channelId) as ChannelRow | undefined
        return row ? this.mapChannel(row) : null
    }

    addChannelMember(
        roomId: string,
        channelId: string,
        actorId: string,
        grants: Partial<Omit<GroupChannelMember, 'roomId' | 'channelId' | 'actorId' | 'updatedAt'>> = {},
    ): GroupChannelMember {
        const now = Date.now()
        this.db()?.prepare(
            `INSERT INTO gc_channel_members (roomId, channelId, actorId, canRead, canWrite, canInvite, canModerate, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(roomId, channelId, actorId) DO UPDATE SET
                canRead = excluded.canRead,
                canWrite = excluded.canWrite,
                canInvite = excluded.canInvite,
                canModerate = excluded.canModerate,
                updatedAt = excluded.updatedAt`
        ).run(
            roomId,
            channelId,
            actorId,
            grants.canRead === false ? 0 : 1,
            grants.canWrite ? 1 : 0,
            grants.canInvite ? 1 : 0,
            grants.canModerate ? 1 : 0,
            now,
        )
        return this.getChannelMember(roomId, channelId, actorId)!
    }

    listChannelMembers(roomId: string, channelId: string): GroupChannelMember[] {
        const rows = (this.db()?.prepare(
            `SELECT roomId, channelId, actorId, canRead, canWrite, canInvite, canModerate, updatedAt
             FROM gc_channel_members WHERE roomId = ? AND channelId = ? ORDER BY actorId`
        ).all(roomId, channelId) || []) as unknown as ChannelMemberRow[]
        return rows.map(row => this.mapMember(row))
    }

    getChannelMember(roomId: string, channelId: string, actorId: string): GroupChannelMember | null {
        const row = this.db()?.prepare(
            `SELECT roomId, channelId, actorId, canRead, canWrite, canInvite, canModerate, updatedAt
             FROM gc_channel_members WHERE roomId = ? AND channelId = ? AND actorId = ?`
        ).get(roomId, channelId, actorId) as ChannelMemberRow | undefined
        return row ? this.mapMember(row) : null
    }

    deleteRoomChannels(roomId: string): void {
        const db = this.db()
        if (!db) return
        db.prepare('DELETE FROM gc_channel_members WHERE roomId = ?').run(roomId)
        db.prepare('DELETE FROM gc_channels WHERE roomId = ?').run(roomId)
    }

    private mapChannel(row: ChannelRow): GroupChannel {
        let metadata: Record<string, unknown> = {}
        try {
            const parsed = JSON.parse(row.metadataJson || '{}')
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed
        } catch {
            metadata = {}
        }
        return { ...row, metadata }
    }

    private mapMember(row: ChannelMemberRow): GroupChannelMember {
        return {
            ...row,
            canRead: Number(row.canRead) === 1,
            canWrite: Number(row.canWrite) === 1,
            canInvite: Number(row.canInvite) === 1,
            canModerate: Number(row.canModerate) === 1,
        }
    }
}

function defaultVisibilityForKind(kind: string): GroupMessageVisibility {
    if (kind === 'public') return 'public'
    if (kind === 'agent') return 'agent-only'
    if (kind === 'system') return 'system-only'
    if (kind === 'audit') return 'audit-only'
    if (kind === 'external') return 'external'
    return 'private'
}
