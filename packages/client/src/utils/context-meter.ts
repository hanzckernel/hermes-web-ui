import type { Message } from '@/stores/hermes/chat'

/**
 * Lightweight UI-only estimate for the prompt-sized context currently loaded in
 * the active session. This is deliberately not billing usage: input/output usage
 * is cumulative over model calls and grows even after Hermes compacts a session.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  const cjkChars = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const otherChars = text.length - cjkChars
  return Math.ceil(cjkChars * 1.5 + otherChars * 0.25)
}

export function estimateActiveContextTokens(messages: Array<Pick<Message, 'content' | 'reasoning' | 'toolArgs' | 'toolResult' | 'toolPreview' | 'tokenCount'>>): number {
  return messages.reduce((sum, message) => {
    if (typeof message.tokenCount === 'number' && Number.isFinite(message.tokenCount) && message.tokenCount > 0) {
      return sum + message.tokenCount
    }

    return sum + estimateTextTokens([
      message.content,
      message.reasoning,
      message.toolArgs,
      message.toolResult,
      message.toolPreview,
    ].filter(Boolean).join('\n'))
  }, 0)
}

export function selectContextMeterTokens(
  messages: Array<Pick<Message, 'content' | 'reasoning' | 'toolArgs' | 'toolResult' | 'toolPreview' | 'tokenCount'>>,
): number {
  if (messages.length === 0) return 0
  return estimateActiveContextTokens(messages)
}
