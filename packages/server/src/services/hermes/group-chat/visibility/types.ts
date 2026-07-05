export type GroupChannelKind = 'public' | 'private' | 'team' | 'agent' | 'task' | 'approval' | 'system' | 'audit' | 'external'
export type GroupMessageVisibility = 'public' | 'private' | 'shared' | 'agent-only' | 'system-only' | 'audit-only' | 'external'
export type GroupMessageScope = 'conversation' | 'task' | 'private_fact' | 'approval' | 'tool' | 'artifact' | 'system_notice'

export interface GroupChannel {
    id: string
    roomId: string
    kind: GroupChannelKind
    name: string
    parentChannelId?: string | null
    defaultVisibility: GroupMessageVisibility
    createdBy: string
    createdAt: number
    updatedAt: number
    metadata: Record<string, unknown>
}

export interface GroupChannelMember {
    roomId: string
    channelId: string
    actorId: string
    canRead: boolean
    canWrite: boolean
    canInvite: boolean
    canModerate: boolean
    updatedAt: number
}

export interface VisibleGroupMessage {
    id: string
    roomId: string
    senderId: string
    senderName?: string
    content?: string
    timestamp: number
    role?: string
    channelId?: string | null
    threadId?: string | null
    visibility?: GroupMessageVisibility | string | null
    audienceJson?: string | null
    scope?: GroupMessageScope | string | null
    originEventId?: string | null
    metadataJson?: string | null
}

export function normalizeChannelId(channelId: string | null | undefined): string {
    const value = String(channelId || '').trim()
    return value || 'public'
}

export function normalizeVisibility(visibility: string | null | undefined): GroupMessageVisibility {
    const value = String(visibility || '').trim() as GroupMessageVisibility
    return value || 'public'
}

export function normalizeScope(scope: string | null | undefined): GroupMessageScope {
    const value = String(scope || '').trim() as GroupMessageScope
    return value || 'conversation'
}
