// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const sessionApi = vi.hoisted(() => ({
  fetchSessionMessagesPage: vi.fn(),
}))

vi.mock('@/api/hermes/chat', () => ({
  startRunViaSocket: vi.fn(),
  resumeSession: vi.fn(),
  registerSessionHandlers: vi.fn(),
  unregisterSessionHandlers: vi.fn(),
  getChatRunSocket: vi.fn(() => ({ emit: vi.fn() })),
  respondToolApproval: vi.fn(),
  respondClarify: vi.fn(),
  onPeerUserMessage: vi.fn(() => vi.fn()),
  onSessionCommand: vi.fn(() => vi.fn()),
  onSessionTitleUpdated: vi.fn(() => vi.fn()),
}))

vi.mock('@/api/client', () => ({
  getActiveProfileName: () => 'default',
  hasApiKey: () => false,
}))

vi.mock('@/api/hermes/sessions', () => ({
  archiveSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchRuntimeSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionMessagesPage: sessionApi.fetchSessionMessagesPage,
  fetchSessions: vi.fn(),
  setSessionModel: vi.fn(),
}))

vi.mock('@/api/hermes/download', () => ({
  getDownloadUrl: (_path: string, name: string) => `/download/${name}`,
}))

vi.mock('@/api/hermes/system', () => ({
  checkHealth: vi.fn(),
  fetchAvailableModels: vi.fn(),
  addCustomModel: vi.fn(),
  removeCustomModel: vi.fn(),
  updateDefaultModel: vi.fn(),
  updateModelVisibility: vi.fn(),
  updateModelAlias: vi.fn(),
}))

vi.mock('@/utils/completion-sound', () => ({
  primeCompletionSound: vi.fn(),
  playCompletionSound: vi.fn(),
}))

import { useChatStore, type Session } from '@/stores/hermes/chat'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'cached-session',
    title: 'Cached session',
    source: 'cli',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    inputTokens: 3600,
    outputTokens: 1200,
    cacheReadTokens: 76400,
    ...overrides,
  }
}

describe('chat store cache-read context metadata', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('preserves cached-token counts when active-session refresh omits cache fields', async () => {
    const store = useChatStore()
    const session = makeSession()
    store.sessions = [session]
    store.activeSessionId = session.id
    store.activeSession = session

    sessionApi.fetchSessionMessagesPage.mockResolvedValue({
      session: {
        id: session.id,
        title: session.title,
        input_tokens: 4000,
        output_tokens: 1500,
      },
      messages: [],
      total: 0,
      hasMore: false,
    })

    await store.refreshActiveSession()

    expect(store.activeSession?.inputTokens).toBe(4000)
    expect(store.activeSession?.outputTokens).toBe(1500)
    expect(store.activeSession?.cacheReadTokens).toBe(76400)
  })
})
