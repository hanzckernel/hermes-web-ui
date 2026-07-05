import { io } from 'socket.io-client'
import { request, getApiKey } from '../client'

// ─── Types ──────────────────────────────────────────────────

export interface RoomInfo {
    id: string
    name: string
    inviteCode: string | null
    triggerTokens?: number
    maxHistoryTokens?: number
    tailMessageCount?: number
    totalTokens?: number
}

export interface RoomAgent {
    id: string
    roomId: string
    agentId: string
    profile: string
    name: string
    description: string
    invited: number
}

export interface AgentAddResult {
    profile: string
    ok: boolean
    agent?: RoomAgent
    code?: string
    error?: string
    reason?: string
}

export interface ChatMessage {
    id: string
    roomId: string
    senderId: string
    senderName: string
    content: string
    timestamp: number
    role?: string
    tool_call_id?: string | null
    tool_calls?: any[] | null
    tool_name?: string | null
    finish_reason?: 'streaming' | 'tool_calls' | 'error' | string | null
    reasoning?: string | null
    reasoning_details?: string | null
    reasoning_content?: string | null
    channelId?: string | null
    threadId?: string | null
    visibility?: 'public' | 'private' | 'agent-only' | 'system-only' | 'audit-only' | 'external' | string | null
    audienceJson?: string | null
    scope?: string | null
    originEventId?: string | null
    metadataJson?: string | null
    isStreaming?: boolean
    toolName?: string
    toolCallId?: string
    toolArgs?: unknown
    toolPreview?: string
    toolResult?: unknown
    toolStatus?: 'running' | 'done' | 'error'
    firstSeenAt?: number
    attachments?: Array<{ id: string; name: string; type: string; size: number; url: string }>
}

export interface MemberInfo {
    id: string
    userId: string
    name: string
    description: string
    joinedAt: number
    avatar?: string
}

export interface GroupActor {
    id: string
    roomId: string
    kind: 'human' | 'agent' | 'system' | 'tool' | 'external_user' | 'workflow' | string
    source: string
    displayName: string
    description?: string | null
    profile?: string | null
    agentKind?: string | null
    status?: string
    capabilities?: string[]
    metadata?: Record<string, unknown>
}

export interface GroupChannel {
    id: string
    roomId: string
    kind: 'public' | 'private' | 'team' | 'agent' | 'task' | 'approval' | 'system' | 'audit' | 'external' | string
    name: string
    parentChannelId?: string | null
    defaultVisibility?: string
    createdBy?: string
    createdAt?: number
    updatedAt?: number
    metadata?: Record<string, unknown>
}

export interface JoinResult {
    roomId: string
    roomName: string
    members: MemberInfo[]
    messages: ChatMessage[]
    agents?: RoomAgent[]
    actors?: GroupActor[]
    channels?: GroupChannel[]
    actorId?: string
    rooms: string[]
}

// ─── Socket.IO Client ──────────────────────────────────────

let socket: ReturnType<typeof io> | null = null

export function connectGroupChat(opts?: { userId?: string; userName?: string; description?: string; authUserId?: number }): ReturnType<typeof io> {
    if (socket?.connected) return socket

    const token = getApiKey()
    const userId = opts?.userId || localStorage.getItem('gc_user_id') || generateUUID()
    if (!opts?.userId) localStorage.setItem('gc_user_id', userId)

    socket = io('/group-chat', {
        auth: {
            token: token || undefined,
            userId,
            name: opts?.userName || localStorage.getItem('gc_user_name') || undefined,
            description: opts?.description || localStorage.getItem('gc_user_description') || undefined,
            authUserId: opts?.authUserId,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        randomizationFactor: 0.5,
        timeout: 30000,
    })

    return socket
}

export function getStoredUserId(): string {
    let id = localStorage.getItem('gc_user_id')
    if (!id) {
        id = generateUUID()
        localStorage.setItem('gc_user_id', id)
    }
    return id
}

export function getStoredUserName(): string | null {
    return localStorage.getItem('gc_user_name')
}

function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0
        const v = c === 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
    })
}

export function getSocket(): ReturnType<typeof io> | null {
    return socket?.connected ? socket : null
}

export function disconnectGroupChat(): void {
    if (socket) {
        socket.disconnect()
        socket = null
    }
}

// ─── REST API ───────────────────────────────────────────────

export async function createRoom(data: {
    name: string
    inviteCode: string
    agents?: { profile: string; name?: string; description?: string; invited?: boolean }[]
    compression?: { triggerTokens?: number; maxHistoryTokens?: number; tailMessageCount?: number }
}): Promise<{ room: RoomInfo; agents: RoomAgent[]; agentResults?: AgentAddResult[] }> {
    return request('/api/hermes/group-chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
}

export async function cloneRoom(roomId: string, data?: { name?: string; inviteCode?: string }): Promise<{ room: RoomInfo; agents: RoomAgent[]; agentResults?: AgentAddResult[] }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
    })
}

export async function listRooms(): Promise<{ rooms: RoomInfo[] }> {
    return request('/api/hermes/group-chat/rooms')
}

export async function getRoomDetail(
    roomId: string,
    options: { offset?: number; limit?: number; actorId?: string } = {},
): Promise<{ room: RoomInfo; messages: ChatMessage[]; agents: RoomAgent[]; members: MemberInfo[]; actors?: GroupActor[]; channels?: GroupChannel[]; actorId?: string; total?: number; offset?: number; limit?: number; hasMore?: boolean }> {
    const params = new URLSearchParams()
    if (options.offset != null) params.set('offset', String(options.offset))
    if (options.limit != null) params.set('limit', String(options.limit))
    if (options.actorId) params.set('actorId', options.actorId)
    const query = params.toString()
    return request(`/api/hermes/group-chat/rooms/${roomId}${query ? `?${query}` : ''}`)
}

export async function listChannels(roomId: string, actorId?: string): Promise<{ channels: GroupChannel[]; actorId?: string }> {
    const params = new URLSearchParams()
    if (actorId) params.set('actorId', actorId)
    const query = params.toString()
    return request(`/api/hermes/group-chat/rooms/${roomId}/channels${query ? `?${query}` : ''}`)
}

export async function createChannel(roomId: string, data: {
    id?: string
    kind: GroupChannel['kind']
    name: string
    members?: Array<string | { actorId?: string; canRead?: boolean; canWrite?: boolean; canInvite?: boolean; canModerate?: boolean }>
    metadata?: Record<string, unknown>
}): Promise<{ channel: GroupChannel; channels: GroupChannel[]; actorId?: string }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
}

export async function joinRoomByCode(code: string): Promise<{ room: RoomInfo }> {
    return request(`/api/hermes/group-chat/rooms/join/${code}`)
}

export async function updateInviteCode(roomId: string, inviteCode: string): Promise<void> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/invite-code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
    })
}

export async function addAgent(roomId: string, data: {
    profile: string
    name?: string
    description?: string
    invited?: boolean
}): Promise<{ agent: RoomAgent }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
}

export async function listAgents(roomId: string): Promise<{ agents: RoomAgent[] }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/agents`)
}

export async function removeAgent(roomId: string, agentId: string): Promise<{ success: boolean; agents: RoomAgent[]; members: MemberInfo[]; actors?: GroupActor[] }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/agents/${agentId}`, {
        method: 'DELETE',
    })
}

export async function deleteRoom(roomId: string): Promise<void> {
    return request(`/api/hermes/group-chat/rooms/${roomId}`, {
        method: 'DELETE',
    })
}

export async function clearRoomContext(roomId: string): Promise<{ success: boolean; room: RoomInfo }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/clear-context`, {
        method: 'POST',
    })
}

export async function updateRoomConfig(roomId: string, config: { triggerTokens?: number; maxHistoryTokens?: number; tailMessageCount?: number }): Promise<{ room: RoomInfo }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    })
}

export async function forceCompress(roomId: string): Promise<{ success: boolean; summary: string }> {
    return request(`/api/hermes/group-chat/rooms/${roomId}/compress`, {
        method: 'POST',
    })
}
