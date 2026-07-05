import { randomUUID } from 'node:crypto'

export function humanActorId(roomId: string, userId: string): string {
    return `gc:${roomId}:human:${userId}`
}

export function newAuthenticatedHumanActorId(roomId: string): string {
    return `gc:${roomId}:human:auth:${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export function agentActorId(roomId: string, agentId: string): string {
    return `gc:${roomId}:agent:${agentId}`
}

export function systemActorId(roomId: string): string {
    return `gc:${roomId}:system`
}
