export type GroupChannelKind = 'public' | 'private' | 'agent' | 'task'
export type GroupMessageVisibility = 'public' | 'private' | 'agent-only' | 'system-only'
export type GroupMessageScope = 'conversation' | 'task' | 'private_fact' | 'approval' | 'tool'

export interface GroupChannel {
    id: string
    roomId: string
    kind: GroupChannelKind
    name: string
    defaultVisibility: GroupMessageVisibility
    createdBy: string
    createdAt: number
    updatedAt: number
}

export interface GroupChannelMember {
    roomId: string
    channelId: string
    actorId: string
    canRead: boolean
    canWrite: boolean
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
    visibility?: GroupMessageVisibility | null
    audienceJson?: string | null
    scope?: GroupMessageScope | null
    originEventId?: string | null
    metadataJson?: string | null
}

export function normalizeChannelId(channelId: string | null | undefined): string {
    const value = String(channelId || '').trim()
    return value || 'public'
}

export function normalizeVisibility(visibility: string | null | undefined): GroupMessageVisibility {
    const value = String(visibility || '').trim()
    if (!value) return 'public'
    if (value === 'public' || value === 'private' || value === 'agent-only' || value === 'system-only') return value
    return 'private'
}

export function normalizeScope(scope: string | null | undefined): GroupMessageScope {
    const value = String(scope || '').trim()
    if (value === 'task' || value === 'private_fact' || value === 'approval' || value === 'tool') return value
    return 'conversation'
}
