export type GroupActorKind = 'human' | 'agent' | 'system'
export type GroupActorSource = 'web-ui' | 'group-chat-agent' | 'system'
export type GroupAgentKind = 'hermes' | 'claude-code' | 'codex' | 'custom'

export interface GroupActor {
    id: string
    roomId: string
    kind: GroupActorKind
    source: GroupActorSource
    displayName: string
    description: string
    profile?: string | null
    agentKind?: GroupAgentKind | null
    authUserId?: number | null
    status: 'active' | 'inactive' | 'removed'
    capabilities?: string[]
    metadata: Record<string, unknown>
    createdAt: number
    updatedAt: number
}
