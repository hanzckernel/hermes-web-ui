/**
 * Chat run via Socket.IO — namespace /chat-run.
 *
 * Replaces HTTP POST + SSE. Socket.IO decouples message handling
 * from connection lifecycle: the server continues streaming upstream
 * events even after the client disconnects or refreshes.
 *
 * Uses Socket.IO rooms keyed by session_id. On client reconnect,
 * the client emits 'resume' to rejoin its session room.
 */
import type { Server, Socket } from 'socket.io'
import { EventSource } from 'eventsource'
import { setRunSession } from '../../routes/hermes/proxy-handler'
import {
  getSession,
  getSessionDetail,
  getSessionDetailPaginated,
  createSession,
  addMessage,
  useLocalSessionStore,
} from '../../db/hermes/session-store'
import {
  getChatSessionRunByHermesSessionId,
  getLatestRepairableChatSessionRun,
  markChatSessionRunCompleted,
  recordChatSessionRun,
} from '../../db/hermes/chat-run-store'
import { getSessionDetailFromDb } from '../../db/hermes/sessions-db'
import { repairUnsyncedChatRuns, syncHermesRunToLocalSession } from './chat-run-sync'
import { getModelContextLength } from './model-context'
import { ChatContextCompressor, countTokens, SUMMARY_PREFIX } from '../../lib/context-compressor'
import { getCompressionSnapshot } from '../../db/hermes/compression-snapshot'
import { parseLLMJSON, parseToolArguments, parseAnthropicContentArray } from '../../lib/llm-json'
import { logger } from '../logger'

/**
 * Content block types for Anthropic-compatible message format
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; name: string; path: string; media_type: string }
  | { type: 'file'; name: string; path: string; media_type?: string }

/**
 * Convert ContentBlock[] to string for display/storage
 * - string → 直接返回
 * - ContentBlock[] → 返回 JSON 字符串
 */
function contentBlocksToString(input: string | ContentBlock[]): string {
  if (typeof input === 'string') return input
  return JSON.stringify(input)
}

/**
 * Extract text content from ContentBlock[] for title preview
 */
function extractTextForPreview(input: string | ContentBlock[]): string {
  if (typeof input === 'string') return input

  return input
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * Check if input is ContentBlock array
 */
function isContentBlockArray(input: any): input is ContentBlock[] {
  return Array.isArray(input) && input.length > 0 && ('type' in input[0])
}

/**
 * Convert file/image blocks with path to base64 format for upstream API
 *
 * Converts images to base64 data URLs for Anthropic/OpenAI API compatibility.
 * File attachments are converted to text mentions.
 */
async function convertContentBlocks(blocks: ContentBlock[]): Promise<string> {
  let contentStr = ''

  for (const block of blocks) {
    if (block.type === 'text') {
      contentStr += block.text
    } else if (block.type === 'image') {
      contentStr += `[Image: ${block.path}]`
    } else if (block.type === 'file') {
      contentStr += `[File: ${block.path}]`
    }
  }

  return contentStr
}

const compressor = new ChatContextCompressor()

// --- Helper: Convert OpenAI format to Anthropic format ---
function convertToAnthropicFormat(messages: any[]): any[] {
  const result: any[] = []

  for (const m of messages) {
    const role = m.role
    const content = m.content || ''

    if (role === 'assistant') {
      const blocks: any[] = []

      // Add thinking block if reasoning_content exists
      if (m.reasoning) {
        blocks.push({ type: 'thinking', thinking: m.reasoning })
      }

      // Add text content
      if (content) {
        if (typeof content === 'string') {
          blocks.push({ type: 'text', text: content })
        } else if (Array.isArray(content)) {
          blocks.push(...content)
        }
      }

      // Add tool_use blocks
      if (m.tool_calls && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (tc.id && tc.function) {
            try {
              const args = parseToolArguments(tc.function.arguments || '{}')
              blocks.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: args
              })
            } catch (e) {
              logger.warn(e, '[chat-run-socket] failed to parse tool arguments for tool %s', tc.id)
              blocks.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: {}
              })
            }
          }
        }
      }

      // Handle empty content
      if (blocks.length === 0) {
        blocks.push({ type: 'text', text: '' })
      }

      result.push({ role: 'assistant', content: blocks })
      continue
    }

    if (role === 'tool') {
      // Convert tool message to tool_result in user message
      // Follow Hermes official format: content is a string (not array)
      const toolContent = content || '(no output)'

      // Normalize tool_result content to string format
      // Use robust LLM JSON parser if content looks like JSON
      let resultContent: string
      if (typeof toolContent === 'string') {
        try {
          // Try to parse as JSON first (handles Python format, single quotes, etc.)
          const parsed = parseLLMJSON(toolContent, 2)
          // Re-serialize to ensure clean JSON string
          resultContent = JSON.stringify(parsed)
        } catch {
          // Not valid JSON, use as-is
          resultContent = toolContent
        }
      } else if (typeof toolContent === 'object' && toolContent !== null) {
        // Object or array, serialize to JSON string
        resultContent = JSON.stringify(toolContent)
      } else {
        // Primitive type (null, undefined, number, boolean)
        resultContent = String(toolContent !== null && toolContent !== undefined ? toolContent : '(no output)')
      }

      const toolResult = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || '',
        content: resultContent
      }

      // Merge with previous user message if it ends with tool_result
      if (
        result.length > 0 &&
        result[result.length - 1].role === 'user' &&
        Array.isArray(result[result.length - 1].content) &&
        result[result.length - 1].content.length > 0 &&
        result[result.length - 1].content[result[result.length - 1].content.length - 1].type === 'tool_result'
      ) {
        result[result.length - 1].content.push(toolResult)
      } else {
        result.push({ role: 'user', content: [toolResult] })
      }
      continue
    }

    // Regular user message
    if (role === 'user') {
      // Format: { role: 'user', content: [{ type: 'text', text: '...' }] }
      if (typeof content === 'string') {
        result.push({ role: 'user', content: [{ type: 'text', text: content || '' }] })
      } else if (Array.isArray(content)) {
        // Already in array format, assume it's correct
        result.push({ role: 'user', content })
      } else if (content) {
        // Fallback for other types
        result.push({ role: 'user', content: [{ type: 'text', text: String(content) }] })
      }
      continue
    }
  }
  return result
}

// --- Session state tracking ---

interface SessionMessage {
  id: number | string
  session_id: string
  role: string
  content: string
  hermesSessionId?: string
  tool_call_id?: string | null
  tool_calls?: any[] | null
  tool_name?: string | null
  timestamp: number
  token_count?: number | null
  finish_reason?: string | null
  reasoning?: string | null
  reasoning_details?: string | null
  reasoning_content?: string | null
  codex_reasoning_items?: string | null
}

interface SessionState {
  messages: SessionMessage[]
  isWorking: boolean
  events: Array<{ event: string; data: any }>
  abortController?: AbortController
  runId?: string
  /** Ephemeral session ID used for Hermes (one per run) */
  hermesSessionId?: string
  profile?: string
  inputTokens?: number
  outputTokens?: number
}

// --- ChatRunSocket ---

export class ChatRunSocket {
  private nsp: ReturnType<Server['of']>
  private gatewayManager: any
  /** sessionId → session state (messages, working status, events, run tracking) */
  private sessionMap = new Map<string, SessionState>()
  /** localSessionId:hermesSessionId → pending durable sync retry timer */
  private syncRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(io: Server, gatewayManager: any) {
    this.nsp = io.of('/chat-run')
    this.gatewayManager = gatewayManager
  }

  init() {
    this.nsp.use(this.authMiddleware.bind(this))
    this.nsp.on('connection', this.onConnection.bind(this))
    logger.info('[chat-run-socket] Socket.IO ready at /chat-run')
  }

  private syncRetryKey(localSessionId: string, hermesSessionId: string): string {
    return `${localSessionId}:${hermesSessionId}`
  }

  private clearDurableSyncRetry(localSessionId: string, hermesSessionId: string): void {
    const key = this.syncRetryKey(localSessionId, hermesSessionId)
    const timer = this.syncRetryTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.syncRetryTimers.delete(key)
    }
  }

  private markPendingDurableRun(localSessionId: string, hermesSessionId: string, profile?: string): void {
    const state = this.getOrCreateSession(localSessionId)
    if (state.isWorking && state.hermesSessionId && state.hermesSessionId !== hermesSessionId) {
      return
    }
    const row = getChatSessionRunByHermesSessionId(hermesSessionId)
    state.isWorking = true
    state.hermesSessionId = hermesSessionId
    state.profile = profile || row?.profile || state.profile
    state.runId = row?.run_id || state.runId
    state.abortController = undefined
    state.events = []
  }

  private scheduleDurableSyncRetry(localSessionId: string, hermesSessionId: string, profile?: string, attempt = 1): void {
    const key = this.syncRetryKey(localSessionId, hermesSessionId)
    if (this.syncRetryTimers.has(key)) return

    const delayMs = Math.min(60_000, Math.max(1_000, attempt * 1_000))
    const timer = setTimeout(() => {
      this.syncRetryTimers.delete(key)
      this.syncFromHermes(localSessionId, hermesSessionId, profile, attempt)
    }, delayMs)
    if (typeof (timer as any).unref === 'function') {
      ;(timer as any).unref()
    }
    this.syncRetryTimers.set(key, timer)
    logger.info('[chat-run-socket] scheduled durable sync retry for session=%s hermes=%s attempt=%d delayMs=%d',
      localSessionId, hermesSessionId, attempt, delayMs)
  }

  // --- Auth middleware ---

  private async authMiddleware(socket: Socket, next: (err?: Error) => void) {
    const token = socket.handshake.auth?.token as string | undefined
    if (!process.env.AUTH_DISABLED && process.env.AUTH_DISABLED !== '1') {
      const { getToken } = await import('../auth')
      const serverToken = await getToken()
      if (serverToken && token !== serverToken) {
        return next(new Error('Authentication failed'))
      }
    }
    next()
  }

  // --- Connection handler ---

  private onConnection(socket: Socket) {
    const profile = (socket.handshake.query?.profile as string) || 'default'

    socket.on('run', async (data: {
      input: string
      session_id?: string
      model?: string
      instructions?: string
    }) => {
      await this.handleRun(socket, data, profile)
    })

    socket.on('resume', async (data: { session_id?: string }) => {
      if (!data.session_id) return
      const sid = data.session_id
      const room = `session:${sid}`
      socket.join(room)
      await this.resumeSession(socket, sid, profile)
    })

    socket.on('abort', (data: { session_id?: string }) => {
      if (data.session_id) {
        this.handleAbort(socket, data.session_id)
      }
    })
  }
  private handleMessage(messages: SessionMessage[], sid: string): any[] {
    let _messages = []
    try {
      _messages = messages
        .filter(m => (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') && m.content !== undefined)
        .map((m, idx, arr) => {
          const msg: any = {
            id: m.id,
            session_id: sid,
            role: m.role,
            content: m.content || '',
            reasoning: m.reasoning || '',
            timestamp: m.timestamp,
          }
          // Convert Anthropic format content to OpenAI format
          // Check if content is a stringified array (Hermes Gateway behavior) - only for assistant messages
          if (m.role === 'assistant' && typeof m.content === 'string') {
            // Handle double-serialized content: "[{'type': 'text', ...}]" -> "[{'type': 'text', ...}]"
            let contentToParse = m.content
            const trimmed = m.content.trim()
            if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
              contentToParse = trimmed.slice(1, -1)
              logger.info('[chat-run-socket] resume message %s: double-serialized, removed outer quotes', m.id)
            }

            if (contentToParse.startsWith('[') && contentToParse.endsWith(']')) {
              try {
                // Use robust LLM JSON parser
                const parsedContent = parseAnthropicContentArray(contentToParse)
                const textBlocks: string[] = []
                const toolCalls: any[] = []
                let reasoningContent: string | null = null

                for (const block of parsedContent) {
                  if (block.type === 'thinking') {
                    reasoningContent = block.thinking || null
                  } else if (block.type === 'text') {
                    textBlocks.push(block.text || '')
                  } else if (block.type === 'tool_use') {
                    toolCalls.push({
                      id: block.id,
                      type: 'function',
                      function: {
                        name: block.name,
                        arguments: typeof block.input === 'object' ? JSON.stringify(block.input) : (block.input ?? '{}')
                      }
                    })
                  }
                }

                msg.content = textBlocks.join('') || ''
                if (toolCalls.length > 0) {
                  msg.tool_calls = toolCalls
                }
                if (reasoningContent) {
                  msg.reasoning = reasoningContent
                }
              } catch (e) {
                logger.warn(e, '[chat-run-socket] failed to parse array content for message %s, keeping original', m.id)
                // Parsing failed, keep original content
                msg.content = m.content
              }
            }
          } else if (Array.isArray(m.content)) {
            const textBlocks: string[] = []
            const toolCalls: any[] = []
            let reasoningContent: string | null = null

            for (const block of m.content) {
              if (block.type === 'thinking') {
                reasoningContent = block.thinking
              } else if (block.type === 'text') {
                textBlocks.push(block.text)
              } else if (block.type === 'tool_use') {
                toolCalls.push({
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input ?? {})
                  }
                })
              }
            }

            msg.content = textBlocks.join('') || ''
            if (toolCalls.length > 0) {
              msg.tool_calls = toolCalls
            }
            if (reasoningContent) {
              msg.reasoning = reasoningContent
            }
          }

          if (m.tool_calls?.length) {
            // Filter out tool_calls with empty/invalid id and remove internal fields
            const cleanedToolCalls = m.tool_calls
              .filter((tc: any) => tc.id && tc.id.length > 0)
              .map((tc: any) => ({
                id: tc.id,
                type: tc.type,
                function: tc.function
              }))
            if (cleanedToolCalls.length > 0) {
              msg.tool_calls = cleanedToolCalls
            }
          }

          // For tool messages, ensure tool_call_id exists
          if (m.role === 'tool') {
            let callId = m.tool_call_id
            if (!callId || callId.length === 0) {
              // Try to reconstruct tool_call_id from previous assistant message
              const prevMsg = arr[idx - 1]
              if (prevMsg?.role === 'assistant' && prevMsg.tool_calls?.length) {
                // Find matching tool_call by tool_name
                const tc = prevMsg.tool_calls.find((t: any) => t.function?.name === m.tool_name)
                if (tc?.id) {
                  callId = tc.id
                }
              }
            }
            // Skip tool message if no valid tool_call_id
            if (!callId || callId.length === 0) {
              return null
            }
            msg.tool_call_id = callId
          }

          if (m.tool_name) msg.tool_name = m.tool_name
          if (m.reasoning) msg.reasoning = m.reasoning
          return msg
        })
        .filter(m => m !== null)
    } catch (error) {

    }
    return _messages
  }
  private async resumeSession(socket: Socket, sid: string, profile?: string) {
    let state = this.sessionMap.get(sid)
    let pendingDurableRun: { hermesSessionId: string; profile?: string } | null = null

    if (useLocalSessionStore() && !(state?.isWorking && state.hermesSessionId)) {
      try {
        const results = await repairUnsyncedChatRuns(sid, profile)
        const inserted = results.reduce((sum, r) => sum + r.inserted, 0)
        for (const result of results) {
          const row = getChatSessionRunByHermesSessionId(result.hermesSessionId)
          if (row && (result.status === 'pending' || (result.status === 'no_data' && row.status !== 'synced'))) {
            pendingDurableRun = { hermesSessionId: result.hermesSessionId, profile: row.profile || profile }
            this.scheduleDurableSyncRetry(sid, result.hermesSessionId, row.profile || profile, 1)
          }
        }
        if (inserted > 0) {
          logger.info('[chat-run-socket] repaired %d missing messages for session %s on resume', inserted, sid)
        }
      } catch (err) {
        logger.warn(err, '[chat-run-socket] failed to repair unsynced runs for session %s on resume', sid)
      }
    }

    // Do not replace a live run's in-memory state with a stale DB snapshot.
    // The live state carries hermesSessionId/runId/abortController and any
    // streamed assistant deltas that have not been persisted yet. Losing that
    // state makes markCompleted skip syncFromHermes(), so the final answer can
    // disappear after refresh/reconnect.
    if (state?.isWorking && state.hermesSessionId) {
      logger.info('[chat-run-socket] preserving live session %s on resume (messages: %d)', sid, state.messages.length)
    } else {
      try {
        const detail = useLocalSessionStore()
          ? getSessionDetailPaginated(sid)
          : await getSessionDetailFromDb(sid)
        const messages = detail?.messages ? this.handleMessage(detail.messages, sid) : []
        // Calculate context tokens — aware of compression snapshot
        let inputTokens: number
        const snapshot = getCompressionSnapshot(sid)
        if (snapshot) {
          const newMessages = messages.slice(snapshot.lastMessageIndex + 1)
          inputTokens = countTokens(SUMMARY_PREFIX + snapshot.summary) +
            newMessages.reduce((sum, m) => sum + countTokens(m.content || ''), 0)
        } else {
          inputTokens = messages.reduce((sum, m) => sum + countTokens(m.content || ''), 0)
        }
        const outputTokens = messages
          .filter(m => m.role === 'assistant')
          .reduce((sum, m) => sum + countTokens(m.content || ''), 0)
        state = {
          messages,
          isWorking: false,
          events: [],
          inputTokens,
          outputTokens,
        }
        this.sessionMap.set(sid, state)
        if (pendingDurableRun) {
          this.markPendingDurableRun(sid, pendingDurableRun.hermesSessionId, pendingDurableRun.profile)
          state = this.sessionMap.get(sid) || state
        }
        logger.info('[chat-run-socket] loaded session %s from DB (%d messages)', sid, messages.length)
      } catch (err) {
        logger.warn(err, '[chat-run-socket] failed to load session %s from DB on resume', sid)
        state = { messages: [], isWorking: false, events: [] }
        this.sessionMap.set(sid, state)
        if (pendingDurableRun) {
          this.markPendingDurableRun(sid, pendingDurableRun.hermesSessionId, pendingDurableRun.profile)
          state = this.sessionMap.get(sid) || state
        }
      }
    }

    socket.emit('resumed', {
      session_id: sid,
      messages: state.messages,
      isWorking: state.isWorking,
      events: state.isWorking ? state.events : [],
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    })

    logger.info('[chat-run-socket] socket %s resumed session %s (working: %s, messages: %d)',
      socket.id, sid, state.isWorking, state.messages.length)
  }
  // --- Run handler ---

  private async handleRun(
    socket: Socket,
    data: { input: string | ContentBlock[]; session_id?: string; model?: string; instructions?: string },
    profile: string,
  ) {
    const { input, session_id, model, instructions } = data
    const upstream = this.gatewayManager.getUpstream(profile).replace(/\/$/, '')
    const apiKey = this.gatewayManager.getApiKey(profile) || undefined

    // Generate ephemeral session ID for Hermes (fresh session per run)
    const hermesSessionId = session_id
      ? `eph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      : undefined

    // Repair any completed prior run before appending the new user message and
    // assembling conversation_history. Otherwise a follow-up can be sent with
    // the previous assistant/tool answer still stranded in Hermes state.db.
    if (session_id && useLocalSessionStore()) {
      const state = this.sessionMap.get(session_id)
      if (!(state?.isWorking && state.hermesSessionId)) {
        try {
          await repairUnsyncedChatRuns(session_id, profile)
        } catch (err) {
          logger.warn(err, '[chat-run-socket] failed to repair unsynced prior runs before new run for session %s', session_id)
        }
      }
    }

    const now = Math.floor(Date.now() / 1000)
    // Mark working immediately on run start, and append user message
    if (session_id) {
      const state = this.getOrCreateSession(session_id)
      state.isWorking = true
      state.hermesSessionId = hermesSessionId
      state.profile = profile

      // Convert ContentBlock[] to string for storage
      const inputStr = contentBlocksToString(input)
      state.messages.push({
        id: state.messages.length + 1,
        session_id,
        role: 'user',
        content: inputStr,
        timestamp: now,
      })

      // Create session in local DB if it doesn't exist
      if (!getSession(session_id)) {
        const previewText = extractTextForPreview(input)
        const preview = previewText.replace(/[\r\n]/g, ' ').substring(0, 100)
        createSession({ id: session_id, profile, model, title: preview })
      }

      // Write user message to local DB immediately
      addMessage({
        session_id,
        role: 'user',
        content: inputStr,
        timestamp: now,
      })

      socket.join(`session:${session_id}`)
    }

    // Emit helper: tag every payload with session_id
    const emit = (event: string, payload: any) => {
      const tagged = session_id ? { ...payload, session_id } : payload
      if (session_id) {
        this.nsp.to(`session:${session_id}`).emit(event, tagged)
      } else if (socket.connected) {
        socket.emit(event, tagged)
      }
    }
    try {
      // Build upstream request body
      const body: Record<string, any> = { input }
      if (hermesSessionId) body.session_id = hermesSessionId
      if (model) body.model = model
      if (instructions) body.instructions = instructions
      // Inject workspace context if set for this session
      if (session_id) {
        const sessionRow = getSession(session_id)
        if (sessionRow?.workspace) {
          const workspaceCtx = `[Current working directory: ${sessionRow.workspace}]`
          body.instructions = body.instructions
            ? `${workspaceCtx}\n${body.instructions}`
            : workspaceCtx
        }
      }
      // Build conversation_history from DB if session_id is provided
      if (session_id) {
        try {
          const detail = useLocalSessionStore()
            ? getSessionDetail(session_id)
            : await getSessionDetailFromDb(session_id)
          if (detail?.messages?.length) {
            // Filter valid messages
            const validMessages = detail.messages.filter(m =>
              (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') && m.content !== undefined
            )

            // Exclude the last user message (just added in handleRun)
            const lastUserMsgIndex = [...validMessages].reverse().findIndex(m => m.role === 'user')
            let history: Array<{
              role: string
              content: string
              tool_calls?: any[]
              tool_call_id?: string
              name?: string
              reasoning_content?: string | null
            }> = (lastUserMsgIndex >= 0
              ? validMessages.slice(0, validMessages.length - lastUserMsgIndex - 1)
              : validMessages
            ).map((m, idx, arr) => {
              const msg: any = { role: m.role, content: m.content || '' }
              if (m.reasoning_content) msg.reasoning_content = m.reasoning_content
              if (m.tool_calls?.length) {
                // Filter out tool_calls with empty/invalid id and remove internal fields
                const cleanedToolCalls = m.tool_calls
                  .filter((tc: any) => tc.id && tc.id.length > 0)
                  .map((tc: any) => ({
                    id: tc.id,
                    type: tc.type,
                    function: tc.function
                  }))
                if (cleanedToolCalls.length > 0) {
                  msg.tool_calls = cleanedToolCalls
                }
              }

              // For tool messages, ensure tool_call_id exists
              if (m.role === 'tool') {
                let callId = m.tool_call_id
                if (!callId || callId.length === 0) {
                  // Try to reconstruct tool_call_id from previous assistant message
                  const prevMsg = arr[idx - 1]
                  if (prevMsg?.role === 'assistant' && prevMsg.tool_calls?.length) {
                    const tc = prevMsg.tool_calls.find((t: any) => t.function?.name === m.tool_name)
                    if (tc?.id) {
                      callId = tc.id
                    }
                  }
                }
                // Skip tool message if no valid tool_call_id
                if (!callId || callId.length === 0) {
                  return null
                }
                msg.tool_call_id = callId
              }

              if (m.tool_name) msg.name = m.tool_name
              return msg
            })
              .filter(m => m !== null)
            // Context compression with snapshot awareness
            const contextLength = getModelContextLength(profile)
            const triggerTokens = Math.floor(contextLength / 2)
            const cState = this.getOrCreateSession(session_id)

            // Calculate inputTokens + outputTokens from DB (unified method)
            const assembledTokens = await this.calcAndUpdateUsage(session_id, cState, emit)
            const totalTokens = assembledTokens.inputTokens + assembledTokens.outputTokens
            // Step 1: Check existing snapshot — if present, assemble summary + new messages
            const snapshot = session_id ? getCompressionSnapshot(session_id) : null
            if (snapshot) {
              const newMessages = history.slice(snapshot.lastMessageIndex + 1)
              logger.info('[context-compress] session=%s: snapshot at %d, %d new messages, assembled ~%d tokens (threshold %d)',
                session_id, snapshot.lastMessageIndex, newMessages.length, totalTokens, triggerTokens)
              if (totalTokens <= triggerTokens) {
                // Under threshold — use assembled context directly, no LLM call needed
                history = [
                  { role: 'user', content: SUMMARY_PREFIX + '\n\n' + snapshot.summary },
                  ...newMessages,
                ]
              } else {
                this.pushState(session_id, 'compression.started', {
                  event: 'compression.started',
                  message_count: newMessages.length,
                  token_count: totalTokens,
                })
                emit('compression.started', {
                  event: 'compression.started',
                  message_count: newMessages.length,
                  token_count: totalTokens,
                })

                try {
                  const result = await compressor.compress(
                    history, upstream, apiKey, session_id,
                  )
                  const afterTokens = await this.calcAndUpdateUsage(session_id, cState, emit)
                  this.replaceState(session_id, 'compression.completed', {
                    event: 'compression.completed',
                    compressed: result.meta.compressed,
                    llmCompressed: result.meta.llmCompressed,
                    totalMessages: result.meta.totalMessages,
                    resultMessages: result.messages.length,
                    beforeTokens: totalTokens,
                    afterTokens: afterTokens.inputTokens + afterTokens.outputTokens,
                    summaryTokens: result.meta.summaryTokenEstimate,
                    verbatimCount: result.meta.verbatimCount,
                    compressedStartIndex: result.meta.compressedStartIndex,
                  })
                  logger.info('[context-compress] AFTER  session=%s: %d messages, ~%d tokens (was %d)', session_id, result.messages.length, afterTokens.inputTokens + afterTokens.outputTokens, totalTokens)

                  emit('compression.completed', {
                    event: 'compression.completed',
                    compressed: result.meta.compressed,
                    llmCompressed: result.meta.llmCompressed,
                    totalMessages: result.meta.totalMessages,
                    resultMessages: result.messages.length,
                    beforeTokens: totalTokens,
                    afterTokens: afterTokens.inputTokens + afterTokens.outputTokens,
                    summaryTokens: result.meta.summaryTokenEstimate,
                    verbatimCount: result.meta.verbatimCount,
                    compressedStartIndex: result.meta.compressedStartIndex,
                  })

                  history = result.messages.map(m => {
                    const msg: any = {
                      role: m.role,
                      content: m.content,
                      tool_call_id: m.tool_call_id,
                      name: m.name,
                    }
                    if (m.reasoning_content) msg.reasoning_content = m.reasoning_content
                    // Filter tool_calls if present, remove internal fields
                    if (m.tool_calls?.length) {
                      const cleanedToolCalls = m.tool_calls
                        .filter((tc: any) => tc.id && tc.id.length > 0)
                        .map((tc: any) => ({
                          id: tc.id,
                          type: tc.type,
                          function: tc.function
                        }))
                      if (cleanedToolCalls.length > 0) {
                        msg.tool_calls = cleanedToolCalls
                      }
                    }
                    return msg
                  })
                  // Update usage from DB (snapshot now updated by compressor)
                  await this.calcAndUpdateUsage(session_id, cState, emit)
                } catch (err: any) {
                  this.replaceState(session_id, 'compression.completed', {
                    event: 'compression.completed',
                    compressed: false,
                    totalMessages: newMessages.length,
                    resultMessages: newMessages.length,
                    beforeTokens: totalTokens,
                    afterTokens: totalTokens,
                    summaryTokens: 0,
                    verbatimCount: newMessages.length,
                    compressedStartIndex: -1,
                    error: err.message,
                  })
                  logger.warn(err, '[chat-run-socket] compression failed for session %s, using assembled context', session_id)
                  emit('compression.completed', {
                    event: 'compression.completed',
                    compressed: false,
                    totalMessages: newMessages.length,
                    resultMessages: newMessages.length,
                    beforeTokens: totalTokens,
                    afterTokens: totalTokens,
                    summaryTokens: 0,
                    verbatimCount: newMessages.length,
                    compressedStartIndex: -1,
                    error: err.message,
                  })
                }
              }
            } else if (history.length > 4) {
              // No snapshot — check if raw history exceeds threshold

              if (totalTokens <= triggerTokens) {
                // Under threshold — use raw history as-is
                logger.info('[context-compress] session=%s: %d messages, ~%d tokens — under threshold, skip', session_id, history.length, totalTokens)
              } else {
                // Over threshold — full LLM compression
                logger.info('[context-compress] BEFORE session=%s: %d messages, ~%d tokens (threshold %d)', session_id, history.length, totalTokens, triggerTokens)

                this.pushState(session_id, 'compression.started', {
                  event: 'compression.started',
                  message_count: history.length,
                  token_count: totalTokens,
                })
                emit('compression.started', {
                  event: 'compression.started',
                  message_count: history.length,
                  token_count: totalTokens,
                })

                try {
                  const result = await compressor.compress(
                    history, upstream, apiKey, session_id,
                  )
                  const cState = this.getOrCreateSession(session_id)
                  const afterTokens = await this.calcAndUpdateUsage(session_id, cState, emit)
                  this.replaceState(session_id, 'compression.completed', {
                    event: 'compression.completed',
                    compressed: result.meta.compressed,
                    llmCompressed: result.meta.llmCompressed,
                    totalMessages: result.meta.totalMessages,
                    resultMessages: result.messages.length,
                    beforeTokens: totalTokens,
                    afterTokens: afterTokens.inputTokens + afterTokens.outputTokens,
                    summaryTokens: result.meta.summaryTokenEstimate,
                    verbatimCount: result.meta.verbatimCount,
                    compressedStartIndex: result.meta.compressedStartIndex,
                  })
                  logger.info('[context-compress] AFTER  session=%s: %d messages, ~%d tokens (was %d)', session_id, result.messages.length, afterTokens.inputTokens + afterTokens.outputTokens, totalTokens)

                  emit('compression.completed', {
                    event: 'compression.completed',
                    compressed: result.meta.compressed,
                    llmCompressed: result.meta.llmCompressed,
                    totalMessages: result.meta.totalMessages,
                    resultMessages: result.messages.length,
                    beforeTokens: totalTokens,
                    afterTokens: afterTokens.inputTokens + afterTokens.outputTokens,
                    summaryTokens: result.meta.summaryTokenEstimate,
                    verbatimCount: result.meta.verbatimCount,
                    compressedStartIndex: result.meta.compressedStartIndex,
                  })

                  history = result.messages.map(m => {
                    const msg: any = {
                      role: m.role,
                      content: m.content,
                      tool_call_id: m.tool_call_id,
                      name: m.name,
                    }
                    if (m.reasoning_content) msg.reasoning_content = m.reasoning_content
                    // Filter tool_calls if present, remove internal fields
                    if (m.tool_calls?.length) {
                      const cleanedToolCalls = m.tool_calls
                        .filter((tc: any) => tc.id && tc.id.length > 0)
                        .map((tc: any) => ({
                          id: tc.id,
                          type: tc.type,
                          function: tc.function
                        }))
                      if (cleanedToolCalls.length > 0) {
                        msg.tool_calls = cleanedToolCalls
                      }
                    }
                    return msg
                  })
                  await this.calcAndUpdateUsage(session_id, cState, emit)
                } catch (err: any) {
                  this.replaceState(session_id, 'compression.completed', {
                    event: 'compression.completed',
                    compressed: false,
                    totalMessages: history.length,
                    resultMessages: history.length,
                    beforeTokens: totalTokens,
                    afterTokens: totalTokens,
                    summaryTokens: 0,
                    verbatimCount: history.length,
                    compressedStartIndex: -1,
                    error: err.message,
                  })
                  logger.warn(err, '[chat-run-socket] compression failed for session %s, using raw history', session_id)
                  emit('compression.completed', {
                    event: 'compression.completed',
                    compressed: false,
                    totalMessages: history.length,
                    resultMessages: history.length,
                    beforeTokens: totalTokens,
                    afterTokens: totalTokens,
                    summaryTokens: 0,
                    verbatimCount: history.length,
                    compressedStartIndex: -1,
                    error: err.message,
                  })
                }
              }
            }

            body.conversation_history = history
          }
        } catch (err) {
          logger.warn(err, '[chat-run-socket] failed to load conversation history for session %s', session_id)
        }
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      // Convert input from ContentBlock[] to Anthropic format (with base64 images)
      if (isContentBlockArray(input)) {
        body.input = await convertContentBlocks(input)
      }

      // Debug: write history to JSON file for analysis (before conversion)

      // Convert conversation_history from OpenAI format to Anthropic format
      if (body.conversation_history && Array.isArray(body.conversation_history)) {
        body.conversation_history = convertToAnthropicFormat(body.conversation_history)
      }
      const res = await fetch(`${upstream}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        emit('run.failed', { event: 'run.failed', error: `Upstream ${res.status}: ${text}` })
        if (session_id) this.markCompleted(socket, session_id, { event: 'run.failed' })
        return
      }

      const runData = await res.json() as any
      const runId = runData.run_id
      if (!runId) {
        emit('run.failed', { event: 'run.failed', error: 'No run_id in upstream response' })
        if (session_id) this.markCompleted(socket, session_id, { event: 'run.failed' })
        return
      }

      if (session_id) {
        setRunSession(runId, session_id)
      }

      const abortController = new AbortController()
      if (session_id) {
        const state = this.getOrCreateSession(session_id)
        state.isWorking = true
        state.runId = runId
        state.abortController = abortController
        if (useLocalSessionStore() && hermesSessionId) {
          recordChatSessionRun({
            wuiSessionId: session_id,
            hermesSessionId,
            runId,
            profile,
            status: 'running',
          })
        }
      }

      emit('run.started', { event: 'run.started', run_id: runId, status: runData.status })

      // Stream upstream events via EventSource — survives socket disconnect
      const eventsUrl = new URL(`${upstream}/v1/runs/${runId}/events`)

      // Use Authorization header instead of query parameter for better compatibility
      const eventSourceInit: any = apiKey ? {
        fetch: (url: string, init: any = {}) => fetch(url, {
          ...init,
          headers: {
            ...(init.headers || {}),
            Authorization: `Bearer ${apiKey}`,
          },
        }),
      } : {}

      // @ts-ignore - eventsource library types are too strict
      const source = new EventSource(eventsUrl.toString(), eventSourceInit)

      source.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data as string)
          // Debug: log all events from upstream
          if (parsed.event?.includes('reasoning') || parsed.event?.includes('thinking')) {
            logger.info('[chat-run-socket] upstream event: %s, data: %j', parsed.event, parsed)
          } else {
            logger.info('[chat-run-socket] upstream event: %s', parsed.event)
          }

          // Track messages into sessionMap
          if (session_id) {
            const state = this.sessionMap.get(session_id)
            if (state) {
              const msgs = state.messages
              const last = msgs[msgs.length - 1]

              switch (parsed.event) {
                case 'message.delta': {
                  let deltaText = parsed.delta || ''

                  // Try to extract text from JSON delta (e.g., "[{\"type\":\"text\",\"text\":\"hello\"}]")
                  if (deltaText.trim().startsWith('[') && deltaText.trim().endsWith(']')) {
                    try {
                      const parsedDelta = parseAnthropicContentArray(deltaText)
                      const textParts = parsedDelta
                        .filter((b: any) => b.type === 'text')
                        .map((b: any) => b.text || '')
                      deltaText = textParts.join('')
                    } catch {
                      // If parsing fails, use delta as-is
                    }
                  }

                  if (last?.role === 'assistant' && last.finish_reason == null) {
                    last.content += deltaText
                  } else {
                    msgs.push({
                      id: msgs.length + 1,
                      session_id,
                      hermesSessionId,
                      role: 'assistant',
                      content: deltaText,
                      timestamp: Math.floor(Date.now() / 1000),
                    })
                  }
                  break
                }
                case 'reasoning.delta':
                case 'thinking.delta': {
                  const text = parsed.text || parsed.delta || ''
                  if (!text) break
                  if (last?.role === 'assistant' && last.finish_reason == null) {
                    last.reasoning = (last.reasoning || '') + text
                  } else {
                    msgs.push({
                      id: msgs.length + 1,
                      session_id,
                      role: 'assistant',
                      hermesSessionId,
                      content: '',
                      reasoning: text,
                      timestamp: Math.floor(Date.now() / 1000),
                    })
                  }
                  break
                }
                case 'tool.started': {
                  if (last?.role === 'assistant' && last.finish_reason == null) {
                    last.finish_reason = 'tool_calls'
                  }
                  msgs.push({
                    id: msgs.length + 1,
                    session_id,
                    role: 'tool',
                    hermesSessionId,
                    content: '',
                    tool_call_id: parsed.tool_call_id || null,
                    tool_name: parsed.tool || parsed.name || null,
                    timestamp: Math.floor(Date.now() / 1000),
                  })
                  break
                }
                case 'tool.completed': {
                  const toolMsg = [...msgs].reverse().find(m => m.role === 'tool' && !m.content)
                  if (toolMsg && parsed.output) {
                    toolMsg.content = typeof parsed.output === 'string' ? parsed.output : JSON.stringify(parsed.output)
                  }
                  break
                }
                case 'run.completed': {
                  logger.info('[chat-run-socket] ENTER run.completed case, session_id: %s, messages: %d',
                    session_id, msgs.length)

                  if (last?.role === 'assistant' && last.finish_reason == null) {
                    last.finish_reason = parsed.finish_reason || 'stop'
                  }

                  // Debug: log run.completed to check if reasoning is included
                  logger.info('[chat-run-socket] run.completed keys: %s', Object.keys(parsed))
                  // Finalize assistant message — if no content was streamed, use output
                  if (parsed.output && !runProducedAssistantText(msgs)) {
                    let outputContent = parsed.output

                    // Parse output if it's a stringified array
                    if (typeof outputContent === 'string' &&
                      outputContent.trim().startsWith('[') &&
                      outputContent.trim().endsWith(']')) {
                      try {
                        const parsedOutput = parseAnthropicContentArray(outputContent)
                        const textParts = parsedOutput
                          .filter((b: any) => b.type === 'text')
                          .map((b: any) => b.text || '')
                        outputContent = textParts.join('')
                      } catch {
                        // If parsing fails, use output as-is
                      }
                    }

                    if (last?.role === 'assistant') {
                      last.content = outputContent
                    } else {
                      msgs.push({
                        id: msgs.length + 1,
                        session_id,
                        hermesSessionId,
                        role: 'assistant',
                        content: outputContent,
                        timestamp: Math.floor(Date.now() / 1000),
                      })
                    }
                  }

                  // Always parse output if it's an array format (for parsed_content field)
                  // Only extract text content (tool_calls and reasoning are already sent via other events)
                  if (parsed.output && typeof parsed.output === 'string' &&
                    parsed.output.trim().startsWith('[') && parsed.output.trim().endsWith(']')) {
                    try {
                      const parsedOutput = parseAnthropicContentArray(parsed.output)
                      const textParts = parsedOutput
                        .filter((b: any) => b.type === 'text')
                        .map((b: any) => b.text || '')

                      // Set parsed_content for frontend (only text content)
                      parsed.parsed_content = textParts.join('') || ''
                      logger.info('[chat-run-socket] parsed output from run.completed event')
                    } catch (e) {
                      logger.error(e, '[chat-run-socket] failed to parse output from run.completed')
                    }
                  }

                  // Parse stringified array content for all assistant messages
                  // Only extract text content (tool_calls and reasoning are already in message fields)
                  let parsedCount = 0
                  for (const msg of msgs) {
                    if (msg.role === 'assistant' && typeof msg.content === 'string' &&
                      msg.content.trim().startsWith('[') && msg.content.trim().endsWith(']')) {
                      try {
                        logger.info('[chat-run-socket] parsing array content for message %s, content preview: %s',
                          msg.id, msg.content.slice(0, 100))
                        const parsedContent = parseAnthropicContentArray(msg.content)
                        const textBlocks = parsedContent
                          .filter((b: any) => b.type === 'text')
                          .map((b: any) => b.text || '')

                        msg.content = textBlocks.join('') || ''
                        parsedCount++
                      } catch (e) {
                        logger.error(e, '[chat-run-socket] failed to parse array content for message %s', msg.id)
                      }
                    }
                  }

                  logger.info('[chat-run-socket] EXIT run.completed case, parsed %d messages', parsedCount)

                  // Attach the last assistant message's parsed content to fix stringified array format
                  const lastAssistantMsg = msgs.filter((m: any) => m.role === 'assistant').pop()
                  if (lastAssistantMsg && parsedCount > 0) {
                    parsed.parsed_content = lastAssistantMsg.content || ''
                    parsed.parsed_tool_calls = lastAssistantMsg.tool_calls || null
                    parsed.parsed_reasoning = lastAssistantMsg.reasoning || null
                    logger.info('[chat-run-socket] attached parsed content to run.completed event for message %s', lastAssistantMsg.id)
                  }

                  break
                }
              }
            }
          }

          // Usage will be calculated after syncFromHermes completes (in markCompleted)

          emit(parsed.event || 'message', parsed)

          if (parsed.event === 'run.completed' || parsed.event === 'run.failed') {
            source.close()
            if (session_id) this.markCompleted(socket, session_id, { event: parsed.event, run_id: parsed.run_id })
          }
        } catch { /* not JSON, skip */ }
      }

      source.onerror = () => {
        source.close()
        emit('run.failed', { event: 'run.failed', error: 'EventSource connection lost' })
        if (session_id) this.markCompleted(socket, session_id, { event: 'run.stream_lost' })
      }
    } catch (err: any) {
      emit('run.failed', { event: 'run.failed', error: err.message })
      if (session_id) this.markCompleted(socket, session_id, { event: 'run.stream_lost' })
    }
  }

  // --- Abort handler ---

  private handleAbort(socket: Socket, sessionId: string) {
    const state = this.sessionMap.get(sessionId)
    if (state?.isWorking && state.abortController) {
      state.abortController.abort()
      this.markCompleted(socket, sessionId, { event: 'run.failed', run_id: state.runId })
    }
  }

  /** Mark a session run as completed/failed so reconnecting clients get notified */
  private markCompleted(socket: Socket, sessionId: string, _info: { event: string; run_id?: string }) {
    const state = this.sessionMap.get(sessionId)
    const runId = _info.run_id || state?.runId
    let hermesId = state?.hermesSessionId
    let profile = state?.profile

    if (!hermesId && useLocalSessionStore()) {
      const row = getLatestRepairableChatSessionRun(sessionId, runId)
      if (row) {
        hermesId = row.hermes_session_id
        profile = profile || row.profile
        logger.warn('[chat-run-socket] recovered Hermes session %s for WUI session %s from durable run mapping', hermesId, sessionId)
      }
    }

    if (state) {
      state.isWorking = false
      state.abortController = undefined
      state.runId = undefined
      state.hermesSessionId = undefined
      state.profile = undefined
      state.events = []
    }

    if (useLocalSessionStore() && hermesId) {
      if (_info.event === 'run.completed' || _info.event === 'run.failed') {
        markChatSessionRunCompleted(hermesId, _info.event === 'run.completed' ? 'completed' : 'failed')
      }
      this.syncFromHermes(sessionId, hermesId, profile)
    }
  }

  /**
   * Calculate usage from DB and update state + emit to clients.
   * @returns { inputTokens, outputTokens } for the caller to use
   */
  private async calcAndUpdateUsage(
    sid: string, state: SessionState, emit: (event: string, payload: any) => void,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    try {
      const detail = useLocalSessionStore()
        ? getSessionDetail(sid)
        : await getSessionDetailFromDb(sid)
      const msgs = detail?.messages
        ?.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool') || []

      const snapshot = getCompressionSnapshot(sid)
      let inputTokens: number
      if (snapshot && msgs.length) {
        const newMessages = msgs.slice(snapshot.lastMessageIndex + 1)
        inputTokens = countTokens(SUMMARY_PREFIX + snapshot.summary) +
          newMessages.reduce((sum, m) => sum + countTokens(m.content || ''), 0)
      } else {
        inputTokens = msgs.reduce((sum, m) => sum + countTokens(m.content || ''), 0)
      }

      const outputTokens = msgs
        .filter(m => m.role === 'assistant')
        .reduce((sum, m) => sum + countTokens(m.content || ''), 0)
      state.inputTokens = inputTokens
      state.outputTokens = outputTokens
      emit('usage.updated', {
        event: 'usage.updated',
        session_id: sid,
        inputTokens,
        outputTokens,
      })
      return { inputTokens, outputTokens }
    } catch (err: any) {
      logger.warn(err, '[chat-run-socket] failed to calculate usage for session %s', sid)
      return { inputTokens: 0, outputTokens: 0 }
    }
  }

  /**
   * Read complete messages from the durable Hermes run session and write them
   * idempotently into the local WUI chat. This path intentionally goes through
   * chat-run-sync so reconnects, backend restarts, and repair-on-resume use the
   * same durable mapping and de-duplication logic.
   */
  private syncFromHermes(localSessionId: string, hermesSessionId: string, profile?: string, attempt = 1) {
    const memoryMessages = (this.sessionMap.get(localSessionId)?.messages || [])
      .map(m => ({ role: m.role, reasoning: m.reasoning ?? null }))
    syncHermesRunToLocalSession({
      localSessionId,
      hermesSessionId,
      profile,
      memoryMessages,
    })
      .then((result) => {
        const runRow = getChatSessionRunByHermesSessionId(hermesSessionId)
        if (!getSession(localSessionId) || !runRow || runRow.wui_session_id !== localSessionId) {
          this.clearDurableSyncRetry(localSessionId, hermesSessionId)
          const state = this.sessionMap.get(localSessionId)
          if (state?.hermesSessionId === hermesSessionId) {
            this.sessionMap.delete(localSessionId)
          }
          logger.info('[chat-run-socket] stopped durable sync for deleted/unmapped session=%s hermes=%s',
            localSessionId, hermesSessionId)
          return
        }
        const shouldRetry = result.status === 'pending'
          || (result.status === 'no_data' && runRow.status !== 'synced' && runRow.status !== 'failed')
        if (shouldRetry) {
          this.markPendingDurableRun(localSessionId, hermesSessionId, runRow.profile || profile)
          this.scheduleDurableSyncRetry(localSessionId, hermesSessionId, runRow.profile || profile, attempt + 1)
          logger.info('[chat-run-socket] syncFromHermes pending: session=%s hermes=%s status=%s attempt=%d',
            localSessionId, hermesSessionId, result.status, attempt)
          return
        }

        if (result.status !== 'synced' && runRow.status !== 'synced') {
          logger.warn('[chat-run-socket] syncFromHermes did not sync session=%s hermes=%s status=%s',
            localSessionId, hermesSessionId, result.status)
          return
        }

        this.clearDurableSyncRetry(localSessionId, hermesSessionId)
        const state = this.getOrCreateSession(localSessionId)
        const activeDifferentRun = state.isWorking && state.hermesSessionId && state.hermesSessionId !== hermesSessionId
        if (!activeDifferentRun) {
          const detail = getSessionDetail(localSessionId)
          if (detail?.messages?.length) {
            state.messages = this.handleMessage(detail.messages, localSessionId)
          }
          state.isWorking = false
          state.abortController = undefined
          state.runId = undefined
          state.hermesSessionId = undefined
          state.profile = undefined
          state.events = []
          const emit = (event: string, payload: any) => {
            this.nsp.to(`session:${localSessionId}`).emit(event, { ...payload, session_id: localSessionId })
          }
          void this.calcAndUpdateUsage(localSessionId, state, emit)
        } else {
          logger.info('[chat-run-socket] durable sync completed for prior Hermes session %s while session %s has a newer active run',
            hermesSessionId, localSessionId)
        }
        logger.info('[chat-run-socket] syncFromHermes: session=%s hermes=%s status=%s inserted=%d skipped=%d',
          localSessionId, hermesSessionId, result.status, result.inserted, result.skipped)
      })
      .catch((err: any) => {
        logger.warn(err, '[chat-run-socket] syncFromHermes failed for session %s (hermesId: %s, profile: %s)', localSessionId, hermesSessionId, profile || 'default')
      })
  }


  /** Get or create session state in sessionMap */
  private getOrCreateSession(sessionId: string): SessionState {
    let state = this.sessionMap.get(sessionId)
    if (!state) {
      state = { messages: [], isWorking: false, events: [] }
      this.sessionMap.set(sessionId, state)
    }
    return state
  }

  /** Append a state event for a session (used for replay on reconnect) */
  private pushState(sessionId: string, event: string, data: any) {
    const state = this.getOrCreateSession(sessionId)
    state.events.push({ event, data })
  }

  /** Replace the last state with the same event name, or append if different */
  private replaceState(sessionId: string, event: string, data: any) {
    const state = this.sessionMap.get(sessionId)
    if (state) {
      const idx = state.events.findIndex(s => s.event === event)
      if (idx >= 0) {
        state.events[idx] = { event, data }
        return
      }
    }
    this.pushState(sessionId, event, data)
  }
}

/** Check if any assistant message in the list has non-empty content */
function runProducedAssistantText(messages: SessionMessage[]): boolean {
  return messages.some(m => m.role === 'assistant' && m.content?.trim())
}
