export type GroupTransferCardType =
    | 'private_fact_create'
    | 'private_fact_revoke'

export interface GroupTransferCard {
    type: GroupTransferCardType
    factId?: string
    factType?: string
    content?: string
}

const TRANSFER_BLOCK_OPENER_RE = /```(?:group-chat-transfer|gc-transfer)[^\S\r\n]*\r?\n/gi
const TRANSFER_BLOCK_CLOSER_RE = /(?:^|\r?\n)```[^\S\r\n]*(?=\r?\n|$)/g
const TYPE_ALIASES: Record<string, GroupTransferCardType> = {
    private_fact: 'private_fact_create',
    private_fact_create: 'private_fact_create',
    private_fact_revoke: 'private_fact_revoke',
}

export function extractGroupTransferCards(content: unknown): GroupTransferCard[] {
    const text = explicitTransferText(content)
    if (!text) return []
    const cards: GroupTransferCard[] = []
    for (const block of findTransferBlocks(text)) {
        if (!block.closed) continue
        const payload = text.slice(block.contentStart, block.contentEnd).trim()
        if (!payload) continue
        const parsed = parseJson(payload)
        const values = Array.isArray(parsed) ? parsed : [parsed]
        for (const value of values) {
            const card = normalizeTransferCard(value)
            if (card) cards.push(card)
        }
    }
    return cards
}

export function hasGroupTransferBlocks(content: unknown): boolean {
    const text = explicitTransferText(content)
    if (!text) return false
    TRANSFER_BLOCK_OPENER_RE.lastIndex = 0
    return TRANSFER_BLOCK_OPENER_RE.test(text)
}

export function stripGroupTransferBlocksFromText(content: string): string {
    const text = String(content || '')
    const blocks = findTransferBlocks(text)
    if (!blocks.length) return text.replace(/\n{3,}/g, '\n\n').trim()
    let output = ''
    let cursor = 0
    for (const block of blocks) {
        output += text.slice(cursor, block.start)
        cursor = block.end
    }
    output += text.slice(cursor)
    return output
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

type TransferBlockRange = { start: number; contentStart: number; contentEnd: number; end: number; closed: boolean }

function findTransferBlocks(text: string): TransferBlockRange[] {
    const ranges: TransferBlockRange[] = []
    TRANSFER_BLOCK_OPENER_RE.lastIndex = 0
    let opener: RegExpExecArray | null
    while ((opener = TRANSFER_BLOCK_OPENER_RE.exec(text))) {
        const contentStart = TRANSFER_BLOCK_OPENER_RE.lastIndex
        const closer = findTransferCloser(text, contentStart)
        if (!closer) {
            ranges.push({
                start: opener.index,
                contentStart,
                contentEnd: text.length,
                end: text.length,
                closed: false,
            })
            break
        }
        ranges.push({
            start: opener.index,
            contentStart,
            contentEnd: closer.start,
            end: closer.end,
            closed: true,
        })
        TRANSFER_BLOCK_OPENER_RE.lastIndex = closer.end
    }
    return ranges
}

function findTransferCloser(text: string, fromIndex: number): { start: number; end: number } | null {
    const remainder = text.slice(fromIndex)
    TRANSFER_BLOCK_CLOSER_RE.lastIndex = 0
    const match = TRANSFER_BLOCK_CLOSER_RE.exec(remainder)
    if (!match) return null
    const matched = match[0] || ''
    const newlinePrefixLength = matched.startsWith('\r\n') ? 2 : matched.startsWith('\n') ? 1 : 0
    return {
        start: fromIndex + match.index + newlinePrefixLength,
        end: fromIndex + match.index + matched.length,
    }
}

export function stripGroupTransferBlocksFromStoredContent(storedContent: string): string {
    const text = String(storedContent || '')
    const trimmed = text.trim()
    if (!trimmed.startsWith('[')) return hasGroupTransferBlocks(text) ? stripGroupTransferBlocksFromText(text) : text

    try {
        const blocks = JSON.parse(trimmed)
        if (!Array.isArray(blocks)) return stripGroupTransferBlocksFromText(text)
        const nextBlocks = blocks
            .map((block) => sanitizeStoredContentBlock(block))
            .filter((block) => !isEmptyTextContentBlock(block))
        const nextText = JSON.stringify(nextBlocks)
        return nextText === text ? text : nextText
    } catch {
        return stripGroupTransferBlocksFromText(text)
    }
}

function isEmptyTextContentBlock(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const block = value as Record<string, unknown>
    return block.type === 'text' && typeof block.text === 'string' && !block.text.trim()
}

function sanitizeStoredContentBlock(value: unknown): unknown {
    if (typeof value === 'string') {
        if (!hasGroupTransferBlocks(value)) return value
        return stripGroupTransferBlocksFromText(value) || null
    }
    if (Array.isArray(value)) return value.map(item => sanitizeStoredContentBlock(item))
    if (value && typeof value === 'object') {
        const sanitized: Record<string, unknown> = {}
        const source = value as Record<string, unknown>
        for (const [key, nested] of Object.entries(source)) {
            const keyHadTransferBlock = hasGroupTransferBlocks(key)
            const sanitizedKey = keyHadTransferBlock ? stripGroupTransferBlocksFromText(key) || null : key
            if (!sanitizedKey) continue
            if (keyHadTransferBlock && Object.prototype.hasOwnProperty.call(source, sanitizedKey)) continue
            if (Object.prototype.hasOwnProperty.call(sanitized, sanitizedKey)) continue
            const sanitizedNested = sanitizeStoredContentBlock(nested)
            if (sanitizedNested !== undefined) sanitized[sanitizedKey] = sanitizedNested
        }
        return sanitized
    }
    return value
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
        factId: stringField(record.factId),
        factType: stringField(record.factType) || 'note',
        content: stringField(record.content || record.fact),
    }
    if (type === 'private_fact_create' && !card.content) return null
    if (type === 'private_fact_revoke' && !card.factId) return null
    return card
}

function stringField(value: unknown): string | undefined {
    const text = typeof value === 'string' ? value.trim() : ''
    return text || undefined
}
