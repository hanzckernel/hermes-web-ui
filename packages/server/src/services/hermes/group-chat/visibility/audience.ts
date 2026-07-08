export function normalizeAudienceJsonInput(value: unknown): string {
    if (value == null || value === '') return '[]'
    if (typeof value === 'string') return value
    try {
        return JSON.stringify(value)
    } catch {
        return 'null'
    }
}

export function canonicalAudience(value: unknown): string[] {
    if (value == null || value === '') return []
    let parsed: unknown = value
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value)
        } catch {
            const trimmed = value.trim()
            return trimmed ? [trimmed] : []
        }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        parsed = record.actorIds || record.audienceActorIds || record.actors
    }
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
        .filter((actor): actor is string => typeof actor === 'string' && actor.trim().length > 0)
        .map(actor => actor.trim())
        .sort())]
}

export function audienceFingerprint(value: unknown): string {
    if (value == null || value === '') return '[]'
    if (typeof value === 'string') {
        try {
            return JSON.stringify(canonicalAudience(JSON.parse(value)))
        } catch {
            return value.trim()
        }
    }
    return JSON.stringify(canonicalAudience(value))
}
