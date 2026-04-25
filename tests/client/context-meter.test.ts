// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { estimateActiveContextTokens, selectContextMeterTokens } from '@/utils/context-meter'

describe('context meter token accounting', () => {
  it('uses loaded active-session messages instead of cumulative billing usage', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'hello world', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'short answer', timestamp: 2 },
    ]

    expect(selectContextMeterTokens(messages)).toBe(
      estimateActiveContextTokens(messages),
    )
  })

  it('hides the meter instead of falling back to cumulative billing usage when no messages are loaded', () => {
    expect(selectContextMeterTokens([])).toBe(0)
  })

  it('uses Hermes token_count when available and estimates missing streaming/local messages', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'this exact content should not matter', timestamp: 1, tokenCount: 123 },
      { id: 'a1', role: 'assistant' as const, content: 'abcd', timestamp: 2 },
    ]

    expect(estimateActiveContextTokens(messages)).toBe(124)
  })
})
