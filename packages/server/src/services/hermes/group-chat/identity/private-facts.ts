import { getDb } from '../../../../db'

export interface GroupPrivateFact {
    id: string
    roomId: string
    actorId: string
    factType: string
    content: string
    createdBy: string
    createdAt: number
}

type FactRow = GroupPrivateFact

export class PrivateFactsStore {
    private db() { return getDb() }

    createPrivateFact(input: {
        id?: string
        roomId: string
        actorId: string
        factType: string
        content: string
        createdBy: string
    }): GroupPrivateFact {
        const fact: GroupPrivateFact = {
            id: input.id || this.generateId(),
            roomId: input.roomId,
            actorId: input.actorId,
            factType: input.factType,
            content: input.content,
            createdBy: input.createdBy,
            createdAt: Date.now(),
        }
        this.db()?.prepare(
            `INSERT INTO gc_actor_private_facts
                (id, roomId, actorId, factType, content, createdBy, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
            fact.id,
            fact.roomId,
            fact.actorId,
            fact.factType,
            fact.content,
            fact.createdBy,
            fact.createdAt,
        )
        return fact
    }

    listPrivateFacts(roomId: string, actorId: string): GroupPrivateFact[] {
        const rows = (this.db()?.prepare(
            `SELECT id, roomId, actorId, factType, content, createdBy, createdAt
             FROM gc_actor_private_facts
             WHERE roomId = ?
               AND actorId = ?
             ORDER BY createdAt, id`
        ).all(roomId, actorId) || []) as unknown as FactRow[]
        return rows.map(row => this.mapFact(row))
    }

    revokePrivateFact(roomId: string, actorId: string, factId: string): boolean {
        const result = this.db()?.prepare(
            'DELETE FROM gc_actor_private_facts WHERE roomId = ? AND actorId = ? AND id = ?'
        ).run(roomId, actorId, factId)
        return Boolean(result?.changes)
    }

    private mapFact(row: FactRow): GroupPrivateFact {
        return { ...row }
    }

    private generateId(): string {
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    }
}
