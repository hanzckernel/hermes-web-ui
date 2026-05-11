/**
 * Tests for session-sync service
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb } from '../../packages/server/src/db/index'
import { initAllStores } from '../../packages/server/src/db/hermes/init'
import {
  listSessionSummaries,
  getSessionDetailFromDbWithProfile,
} from '../../packages/server/src/db/hermes/sessions-db'
import { syncAllHermesSessionsOnStartup } from '../../packages/server/src/services/hermes/session-sync'

vi.mock('../../packages/server/src/db/hermes/sessions-db', () => ({
  listSessionSummaries: vi.fn().mockResolvedValue([]),
  getSessionDetailFromDbWithProfile: vi.fn(),
}))

const apiServerSession = {
  id: 'hermes-api-session-1',
  source: 'api_server',
  user_id: null,
  model: 'gpt-4',
  title: 'Imported API session',
  started_at: 1000,
  ended_at: 1010,
  end_reason: 'completed',
  message_count: 2,
  tool_call_count: 0,
  input_tokens: 11,
  output_tokens: 7,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  billing_provider: null,
  estimated_cost_usd: 0.01,
  actual_cost_usd: null,
  cost_status: '',
  preview: 'api preview',
  last_active: 1010,
}

const webuiSession = {
  ...apiServerSession,
  id: 'hermes-webui-session-1',
  source: 'webui',
  title: 'Imported WebUI session',
  started_at: 2000,
  ended_at: 2010,
  preview: 'webui preview',
  last_active: 2010,
}

const ephemeralSession = {
  ...apiServerSession,
  id: 'eph_internal-session',
  source: 'webui',
  title: 'Ephemeral session',
  started_at: 3000,
  ended_at: 3010,
  preview: 'ephemeral preview',
  last_active: 3010,
}

const sessionDetails = new Map([
  [apiServerSession.id, {
    ...apiServerSession,
    thread_session_count: 1,
    messages: [
      { id: 1, session_id: apiServerSession.id, role: 'user', content: 'api question', tool_call_id: null, tool_calls: null, tool_name: null, timestamp: 1001, token_count: 2, finish_reason: null, reasoning: null },
      { id: 2, session_id: apiServerSession.id, role: 'assistant', content: 'api answer', tool_call_id: null, tool_calls: null, tool_name: null, timestamp: 1002, token_count: 3, finish_reason: 'stop', reasoning: null },
    ],
  }],
  [webuiSession.id, {
    ...webuiSession,
    thread_session_count: 1,
    messages: [
      { id: 1, session_id: webuiSession.id, role: 'user', content: 'webui question', tool_call_id: null, tool_calls: null, tool_name: null, timestamp: 2001, token_count: 2, finish_reason: null, reasoning: null },
      { id: 2, session_id: webuiSession.id, role: 'assistant', content: 'webui answer', tool_call_id: null, tool_calls: null, tool_name: null, timestamp: 2002, token_count: 3, finish_reason: 'stop', reasoning: null },
    ],
  }],
])

function resetSessionTables(): void {
  initAllStores()

  const db = getDb()
  if (db) {
    db.exec('DELETE FROM messages')
    db.exec('DELETE FROM sessions')
  }
}

function sessionCount(): number {
  const db = getDb()!
  const result = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }
  return result.count
}

function messageCount(sessionId: string): number {
  const db = getDb()!
  const result = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number }
  return result.count
}

function sessionRow(sessionId: string): any {
  return getDb()!.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId)
}

function insertLocalSession(id: string, overrides: Record<string, unknown> = {}): void {
  const db = getDb()!
  const row = {
    profile: 'default',
    source: 'api_server',
    model: 'gpt-4',
    title: 'Existing local session',
    started_at: 900,
    last_active: 910,
    preview: 'existing preview',
    ...overrides,
  }
  db.prepare(`
    INSERT INTO sessions (id, profile, source, model, title, started_at, last_active, preview)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, row.profile, row.source, row.model, row.title, row.started_at, row.last_active, row.preview)
}

function mockHermesSessions(): void {
  vi.mocked(listSessionSummaries).mockImplementation(async (source?: string, _limit?: number, profile?: string) => {
    if (profile !== 'default') return []
    if (source === 'api_server') return [apiServerSession]
    if (source === 'webui') return [webuiSession, ephemeralSession]
    return []
  })
  vi.mocked(getSessionDetailFromDbWithProfile).mockImplementation(async (sessionId: string) => {
    return sessionDetails.get(sessionId) as any
  })
}

describe('session-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionTables()
    vi.mocked(listSessionSummaries).mockResolvedValue([])
    vi.mocked(getSessionDetailFromDbWithProfile).mockResolvedValue(null as any)
  })

  afterEach(() => {
    resetSessionTables()
  })

  it('imports missing Hermes sessions even when the local DB already has sessions', async () => {
    const db = getDb()
    expect(db).not.toBeNull()
    insertLocalSession('existing-local-session')
    mockHermesSessions()

    await syncAllHermesSessionsOnStartup()

    expect(vi.mocked(listSessionSummaries)).toHaveBeenCalledWith('api_server', 10000, 'default')
    expect(vi.mocked(listSessionSummaries)).toHaveBeenCalledWith('webui', 10000, 'default')
    expect(sessionCount()).toBe(3)
    expect(sessionRow(apiServerSession.id)).toMatchObject({ id: apiServerSession.id, source: 'api_server', title: apiServerSession.title })
    expect(sessionRow(webuiSession.id)).toMatchObject({ id: webuiSession.id, source: 'webui', title: webuiSession.title })
    expect(sessionRow(ephemeralSession.id)).toBeUndefined()
    expect(messageCount(apiServerSession.id)).toBe(2)
    expect(messageCount(webuiSession.id)).toBe(2)
  })

  it('is idempotent when startup sync runs repeatedly', async () => {
    mockHermesSessions()

    await syncAllHermesSessionsOnStartup()
    await syncAllHermesSessionsOnStartup()

    expect(sessionCount()).toBe(2)
    expect(messageCount(apiServerSession.id)).toBe(2)
    expect(messageCount(webuiSession.id)).toBe(2)
  })

  it('does not duplicate older random-ID imports with the same session fingerprint', async () => {
    insertLocalSession('legacy-random-id', {
      source: webuiSession.source,
      title: webuiSession.title,
      started_at: webuiSession.started_at,
      last_active: webuiSession.last_active,
      preview: webuiSession.preview,
    })
    mockHermesSessions()

    await syncAllHermesSessionsOnStartup()

    expect(sessionRow('legacy-random-id')).toBeTruthy()
    expect(sessionRow(webuiSession.id)).toBeUndefined()
    expect(sessionRow(apiServerSession.id)).toBeTruthy()
    expect(sessionCount()).toBe(2)
  })

  it('removes partial imports so a later startup can retry the same canonical session id', async () => {
    vi.mocked(listSessionSummaries).mockImplementation(async (source?: string, _limit?: number, profile?: string) => {
      if (profile !== 'default') return []
      if (source === 'api_server') return [apiServerSession]
      return []
    })
    vi.mocked(getSessionDetailFromDbWithProfile).mockResolvedValueOnce({
      ...apiServerSession,
      thread_session_count: 1,
      messages: [
        { id: 1, session_id: apiServerSession.id, role: 'user', content: null, tool_call_id: null, tool_calls: null, tool_name: null, timestamp: 1001, token_count: 2, finish_reason: null, reasoning: null },
      ],
    } as any)

    await syncAllHermesSessionsOnStartup()

    expect(sessionRow(apiServerSession.id)).toBeUndefined()

    vi.mocked(getSessionDetailFromDbWithProfile).mockResolvedValue(sessionDetails.get(apiServerSession.id) as any)

    await syncAllHermesSessionsOnStartup()

    expect(sessionRow(apiServerSession.id)).toMatchObject({ id: apiServerSession.id, source: 'api_server' })
    expect(messageCount(apiServerSession.id)).toBe(2)
  })
})
