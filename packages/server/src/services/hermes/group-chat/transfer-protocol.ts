export type GroupTransferCardType =
    | 'handoff'
    | 'publish_request'
    | 'artifact_reference'
    | 'private_fact_create'
    | 'private_fact_revoke'
    | 'approval'

export interface GroupTransferCard {
    id?: string
    type: GroupTransferCardType
    title?: string
    summary?: string
    targetActorId?: string
    targetAgent?: string
    artifactId?: string
    artifactUrl?: string
    factId?: string
    factType?: string
    content?: string
    approvalId?: string
    choices?: string[]
    metadata?: Record<string, unknown>
}

const TRANSFER_BLOCK_RE = /```(?:group-chat-transfer|gc-transfer)\s*\n([\s\S]*?)```/gi
const TYPE_ALIASES: Record<string, GroupTransferCardType> = {
    handoff: 'handoff',
    publish: 'publish_request',
    publish_request: 'publish_request',
    artifact: 'artifact_reference',
    artifact_reference: 'artifact_reference',
    private_fact: 'private_fact_create',
    private_fact_create: 'private_fact_create',
    private_fact_revoke: 'private_fact_revoke',
    approval: 'approval',
}

export function extractGroupTransferCards(content: unknown): GroupTransferCard[] {
    const text = explicitTransferText(content)
    if (!text) return []
    const cards: GroupTransferCard[] = []
    for (const match of text.matchAll(TRANSFER_BLOCK_RE)) {
        const block = match[1]?.trim()
        if (!block) continue
        const parsed = parseJson(block)
        const values = Array.isArray(parsed) ? parsed : [parsed]
        for (const value of values) {
            const card = normalizeTransferCard(value)
            if (card) cards.push(card)
        }
    }
    return cards
}

function explicitTransferText(content: unknown): string {
    if (typeof content !== 'string') return ''
    const trimmed = content.trim()
    if (!trimmed.startsWith('[')) return content
    try {
        const blocks = JSON.parse(trimmed)
        if (!Array.isArray(blocks)) return content
        return blocks
            .map(block => typeof block?.text === 'string' ? block.text : '')
            .filter(Boolean)
            .join('\n')
    } catch {
        return content
    }
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function normalizeTransferCard(value: unknown): GroupTransferCard | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const rawType = String(record.type || record.kind || '').trim().toLowerCase().replace(/[.-]/g, '_')
    const type = TYPE_ALIASES[rawType]
    if (!type) return null
    const card: GroupTransferCard = {
        type,
        id: stringField(record.id),
        title: stringField(record.title),
        summary: stringField(record.summary),
        targetActorId: stringField(record.targetActorId || record.actorId),
        targetAgent: stringField(record.targetAgent || record.agentName),
        artifactId: stringField(record.artifactId),
        artifactUrl: stringField(record.artifactUrl || record.url),
        factId: stringField(record.factId),
        factType: stringField(record.factType) || 'note',
        content: stringField(record.content || record.fact),
        approvalId: stringField(record.approvalId || record.approval_id),
        choices: Array.isArray(record.choices)
            ? record.choices.map(choice => String(choice || '').trim()).filter(Boolean)
            : undefined,
        metadata: objectField(record.metadata),
    }
    if (type === 'private_fact_create' && !card.content) return null
    if (type === 'private_fact_revoke' && !card.factId) return null
    if (type === 'artifact_reference' && !card.artifactId && !card.artifactUrl) return null
    if (type === 'approval' && !card.approvalId && !card.title && !card.summary) return null
    return card
}

function stringField(value: unknown): string | undefined {
    const text = typeof value === 'string' ? value.trim() : ''
    return text || undefined
}

function objectField(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
