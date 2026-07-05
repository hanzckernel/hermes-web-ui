export type GroupActorKind = 'human' | 'agent' | 'system' | 'tool' | 'external_user' | 'workflow'
export type GroupActorSource = 'web-ui' | 'group-chat-agent' | 'chat-run' | 'discord' | 'telegram' | 'system'
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
    externalPlatform?: string | null
    externalUserId?: string | null
    status: 'active' | 'inactive' | 'removed'
    metadata: Record<string, unknown>
    createdAt: number
    updatedAt: number
}
