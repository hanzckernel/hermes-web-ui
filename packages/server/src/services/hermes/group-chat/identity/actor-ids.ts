export function humanActorId(roomId: string, userId: string): string {
    return `gc:${roomId}:human:${userId}`
}

export function authenticatedHumanActorId(roomId: string, authUserId: number): string {
    return `gc:${roomId}:human:auth:${authUserId}`
}

export function agentActorId(roomId: string, agentId: string): string {
    return `gc:${roomId}:agent:${agentId}`
}

export function systemActorId(roomId: string): string {
    return `gc:${roomId}:system`
}

export function toolActorId(roomId: string, toolName: string): string {
    return `gc:${roomId}:tool:${toolName || 'unknown'}`
}
