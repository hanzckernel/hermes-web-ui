import { createServer, type Server as HttpServer } from 'http'
import { DatabaseSync } from 'node:sqlite'
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))
vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current, getStoragePath: () => ':memory:' }))
vi.mock('../../packages/server/src/middleware/user-auth', () => ({
  isAuthEnabled: vi.fn(async () => false),
  authenticateUserToken: vi.fn(),
}))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'
import { GroupChatServer } from '../../packages/server/src/services/hermes/group-chat'
import { GROUP_CHAT_AGENT_SOCKET_SECRET } from '../../packages/server/src/services/hermes/group-chat/agent-clients'
import { extractGroupTransferCards, stripGroupTransferBlocksFromText } from '../../packages/server/src/services/hermes/group-chat/transfer-protocol'

function listen(server: HttpServer): Promise<{ port: number }> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('missing address')
    resolve({ port: addr.port })
  }))
}

function once<T = any>(socket: ClientSocket, event: string, timeoutMs = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs)
    socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload) })
  })
}

function emitAck<T = any>(socket: ClientSocket, event: string, payload: unknown, timeoutMs = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event} ack`)), timeoutMs)
    socket.emit(event, payload, (response: T) => { clearTimeout(timer); resolve(response) })
  })
}

async function connect(port: number, userId: string, name: string, auth: Record<string, unknown> = {}): Promise<ClientSocket> {
  const socket = clientIo(`http://127.0.0.1:${port}/group-chat`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { userId, name, ...auth },
  })
  await once(socket, 'connect')
  return socket
}

describe('group chat transfer protocol', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
    initAllHermesTables()
  })

  afterEach(() => {
    db.close()
    groupChatDbMock.current = null
  })

  it('parses only explicit private-fact transfer blocks', () => {
    expect(extractGroupTransferCards('please handoff to Worker')).toEqual([])
    expect(extractGroupTransferCards(`before\n\n\`\`\`group-chat-transfer\n{"type":"handoff","targetAgent":"Worker","summary":"take this"}\n\`\`\``)).toEqual([])
    expect(extractGroupTransferCards(`before\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"short"}\n\`\`\``)).toEqual([
      expect.objectContaining({ type: 'private_fact_create', content: 'short' }),
    ])
    expect(extractGroupTransferCards(`\`\`\`gc-transfer\nnot-json\n\`\`\``)).toEqual([])
  })

  it('strips crafted and truncated transfer fences without leaking raw tails', () => {
    const crafted = `visible\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET\`\`\`TAIL"}\n\`\`\`\nafter`
    const strippedCrafted = stripGroupTransferBlocksFromText(crafted)
    expect(strippedCrafted).toContain('visible')
    expect(strippedCrafted).toContain('after')
    expect(strippedCrafted).not.toContain('SECRET')
    expect(strippedCrafted).not.toContain('TAIL')
    expect(strippedCrafted).not.toContain('group-chat-transfer')

    const truncated = `visible\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_TRUNCATED"}`
    const strippedTruncated = stripGroupTransferBlocksFromText(truncated)
    expect(strippedTruncated).toBe('visible')
    expect(strippedTruncated).not.toContain('SECRET_TRUNCATED')
  })

  it('parses consecutive transfer blocks without regex state bleed', () => {
    const first = `\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"one"}\n\`\`\``
    const secondBlocks = JSON.stringify([
      { type: 'text', text: `\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"two"}\n\`\`\`` },
    ])

    expect(extractGroupTransferCards(first)).toEqual([
      expect.objectContaining({ type: 'private_fact_create', content: 'one' }),
    ])
    expect(extractGroupTransferCards(secondBlocks)).toEqual([
      expect.objectContaining({ type: 'private_fact_create', content: 'two' }),
    ])
  })

  it('strips unsupported or invalid transfer fences from stored and realtime content', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'alice', 'Alice', '')
    const alice = await connect(port, 'alice', 'Alice')

    try {
      await emitAck<any>(alice, 'join', { roomId: 'room-1' })
      const unsupportedEvent = once<any>(alice, 'message')
      const unsupportedContent = `visible\n\n\`\`\`group-chat-transfer\n{"type":"handoff","summary":"SECRET HANDOFF"}\n\`\`\``
      const unsupportedAck = await emitAck<any>(alice, 'message', { roomId: 'room-1', id: 'unsupported-transfer', content: unsupportedContent })
      expect(unsupportedAck.id).toBe('unsupported-transfer')
      const unsupportedLive = await unsupportedEvent
      expect(unsupportedLive.content).toBe('visible')
      expect(unsupportedLive.content).not.toContain('SECRET HANDOFF')
      expect(storage.getMessage('unsupported-transfer').content).toBe('visible')

      const invalidEvent = once<any>(alice, 'message')
      await emitAck<any>(alice, 'message', {
        roomId: 'room-1',
        id: 'invalid-transfer',
        content: `also visible\n\n\`\`\`gc-transfer\nnot-json SECRET INVALID\n\`\`\``,
      })
      const invalidLive = await invalidEvent
      expect(invalidLive.content).toBe('also visible')
      expect(invalidLive.content).not.toContain('SECRET INVALID')
      expect(storage.getMessage('invalid-transfer').content).toBe('also visible')
    } finally {
      alice.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('sanitizes content-block transfer fences before mention routing input', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'alice', 'Alice', '')
    const mentionSpy = vi.spyOn(server.agentClients, 'processMentions').mockResolvedValue(undefined as any)
    const alice = await connect(port, 'alice', 'Alice')

    try {
      await emitAck<any>(alice, 'join', { roomId: 'room-1' })
      await emitAck<any>(alice, 'message', {
        roomId: 'room-1',
        id: 'content-block-transfer',
        content: [
          {
            type: 'text',
            text: `@Worker visible request\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET BLOCK FACT"}\n\`\`\``,
          },
        ],
      })

      expect(mentionSpy).toHaveBeenCalledTimes(1)
      const routed = mentionSpy.mock.calls[0][1] as any
      expect(JSON.stringify(routed.input)).toContain('@Worker visible request')
      expect(JSON.stringify(routed.input)).not.toContain('group-chat-transfer')
      expect(JSON.stringify(routed.input)).not.toContain('SECRET BLOCK FACT')
      expect(routed.content).toContain('@Worker visible request')
      expect(routed.content).not.toContain('SECRET BLOCK FACT')
    } finally {
      mentionSpy.mockRestore()
      alice.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('sanitizes non-text content-block fields before storage, realtime delivery, and mention routing', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'alice', 'Alice', '')
    const mentionSpy = vi.spyOn(server.agentClients, 'processMentions').mockResolvedValue(undefined as any)
    const alice = await connect(port, 'alice', 'Alice')

    try {
      await emitAck<any>(alice, 'join', { roomId: 'room-1' })
      const messageEvent = once<any>(alice, 'message')
      await emitAck<any>(alice, 'message', {
        roomId: 'room-1',
        id: 'content-block-field-transfer',
        content: [
          { type: 'text', text: '@Worker inspect attachment' },
          {
            type: 'file',
            name: `visible file\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_FILE_NAME"}\n\`\`\``,
            path: `/tmp/visible\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_FILE_PATH"}\n\`\`\``,
          },
          {
            type: 'image',
            name: `visible image\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_IMAGE_NAME"}\n\`\`\``,
            path: `/tmp/image.png`,
          },
        ],
      })

      const liveMessage = await messageEvent
      const liveJson = JSON.stringify(liveMessage)
      expect(liveJson).not.toContain('SECRET_FILE_NAME')
      expect(liveJson).not.toContain('SECRET_FILE_PATH')
      expect(liveJson).not.toContain('SECRET_IMAGE_NAME')
      expect(liveJson).not.toContain('group-chat-transfer')
      expect(liveJson).not.toContain('gc-transfer')
      const liveBlocks = JSON.parse(liveMessage.content)
      expect(liveBlocks[1].name).toBe('visible file')
      expect(liveBlocks[1].path).toBe('/tmp/visible')
      expect(liveBlocks[2].name).toBe('visible image')
      const savedJson = JSON.stringify(storage.getMessage('content-block-field-transfer'))
      expect(savedJson).not.toContain('SECRET_FILE_NAME')
      expect(savedJson).not.toContain('SECRET_FILE_PATH')
      expect(savedJson).not.toContain('SECRET_IMAGE_NAME')
      expect(mentionSpy).toHaveBeenCalledTimes(1)
      const routed = mentionSpy.mock.calls[0][1] as any
      expect(JSON.stringify(routed.input)).not.toContain('SECRET_FILE_NAME')
      expect(JSON.stringify(routed.input)).not.toContain('SECRET_FILE_PATH')
      expect(routed.content).not.toContain('SECRET_FILE_NAME')
      expect(routed.content).not.toContain('SECRET_FILE_PATH')
    } finally {
      mentionSpy.mockRestore()
      alice.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('applies private-fact transfer side effects without exposing a transfer-card protocol', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'alice', 'Alice', '')
    const alice = await connect(port, 'alice', 'Alice')

    try {
      await emitAck<any>(alice, 'join', { roomId: 'room-1' })
      const actorId = storage.resolveHumanActorId('room-1', 'alice', 'Alice')
      let sawTransferEvent = false
      alice.on('transfer.card', () => { sawTransferEvent = true })
      const messageEvent = once<any>(alice, 'message')
      const content = `remember this\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","factType":"preference","content":"Prefer short answers","metadata":{"sourceText":"SECRET METADATA"}}\n\`\`\``
      const ack = await emitAck<any>(alice, 'message', { roomId: 'room-1', content })
      expect(ack.id).toBeTruthy()
      const liveMessage = await messageEvent
      expect(liveMessage.content).toBe('remember this')
      expect(liveMessage.content).not.toContain('group-chat-transfer')
      expect(liveMessage.content).not.toContain('Prefer short answers')

      const saved = storage.getMessagesForContext('room-1').find((message: any) => message.id === ack.id)
      expect(saved.content).toBe('remember this')
      const metadata = JSON.parse(saved.metadataJson)
      expect(metadata.transferCards).toBeUndefined()
      expect(JSON.stringify(metadata)).not.toContain('Prefer short answers')
      expect(JSON.stringify(metadata)).not.toContain('SECRET METADATA')
      const projected = storage.getActorContextProjection('room-1', actorId).privateFacts
      expect(projected).toEqual([
        expect.objectContaining({ factType: 'preference', content: 'Prefer short answers' }),
      ])

      const factId = projected[0].id
      await emitAck<any>(alice, 'message', {
        roomId: 'room-1',
        content: `\`\`\`group-chat-transfer\n{"type":"private_fact_revoke","factId":"${factId}"}\n\`\`\``,
      })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(sawTransferEvent).toBe(false)
      expect(storage.getActorContextProjection('room-1', actorId).privateFacts).toEqual([])
    } finally {
      alice.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('strips transfer fences from message metadata before storage and realtime delivery', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'alice', 'Alice', '')
    storage.addRoomMember('room-1', 'bob', 'Bob', '')
    const alice = await connect(port, 'alice', 'Alice')
    const bob = await connect(port, 'bob', 'Bob')

    try {
      await emitAck<any>(alice, 'join', { roomId: 'room-1' })
      await emitAck<any>(bob, 'join', { roomId: 'room-1' })
      const messageEvent = once<any>(bob, 'message')
      const metadataJson = JSON.stringify({
        note: `visible metadata\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_METADATA_FACT"}\n\`\`\``,
        [`unsafe-key\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_METADATA_KEY"}\n\`\`\``]: 'visible key metadata',
        nested: {
          unsafe: `\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_NESTED_METADATA"}\n\`\`\``,
          [`nested-key\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_NESTED_KEY"}\n\`\`\``]: 'visible nested key',
        },
        transferCards: [{ content: 'SECRET_TRANSFER_CARD_METADATA' }],
      })
      const ack = await emitAck<any>(alice, 'message', {
        roomId: 'room-1',
        content: 'visible content',
        metadataJson,
        threadId: `visible thread\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_THREAD"}\n\`\`\``,
        originEventId: `visible origin\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_ORIGIN"}\n\`\`\``,
      })
      const liveMessage = await messageEvent
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_METADATA_FACT')
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_NESTED_METADATA')
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_METADATA_KEY')
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_NESTED_KEY')
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_TRANSFER_CARD_METADATA')
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_THREAD')
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_ORIGIN')
      expect(JSON.stringify(liveMessage)).not.toContain('group-chat-transfer')
      expect(liveMessage.threadId).toBe('visible thread')
      expect(liveMessage.originEventId).toBe('visible origin')
      const liveMetadata = JSON.parse(liveMessage.metadataJson)
      expect(liveMetadata.note).toBe('visible metadata')
      expect(liveMetadata['unsafe-key']).toBe('visible key metadata')
      expect(liveMetadata.nested.unsafe).toBeNull()
      expect(liveMetadata.nested['nested-key']).toBe('visible nested key')
      expect(liveMetadata.transferCards).toBeUndefined()
      expect(JSON.stringify(storage.getMessage(ack.id))).not.toContain('SECRET_METADATA_FACT')
      expect(JSON.stringify(storage.getMessage(ack.id))).not.toContain('SECRET_METADATA_KEY')
      expect(JSON.stringify(storage.getMessage(ack.id))).not.toContain('SECRET_NESTED_KEY')
      expect(JSON.stringify(storage.getMessage(ack.id))).not.toContain('SECRET_TRANSFER_CARD_METADATA')
    } finally {
      alice.disconnect()
      bob.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('strips transfer fences from assistant tool call payloads before storage and realtime delivery', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Worker', '', 1)
    storage.addRoomMember('room-1', 'bob', 'Bob', '')
    const agent = await connect(port, 'agent-1', 'Worker', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })
    const bob = await connect(port, 'bob', 'Bob')

    try {
      await emitAck<any>(agent, 'join', { roomId: 'room-1' })
      await emitAck<any>(bob, 'join', { roomId: 'room-1' })
      const messageEvent = once<any>(bob, 'message')
      const toolArguments = JSON.stringify({
        query: `visible query\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_TOOL_ARGUMENT_VALUE"}\n\`\`\``,
        [`unsafe-key\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_TOOL_ARGUMENT_KEY"}\n\`\`\``]: 'visible key value',
      })
      await emitAck<any>(agent, 'message', {
        roomId: 'room-1',
        id: 'tool-call-transfer',
        role: 'assistant',
        content: 'visible answer',
        tool_call_id: `call-visible\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_TOOL_CALL_ID"}\n\`\`\``,
        tool_name: `lookup\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_TOOL_NAME"}\n\`\`\``,
        finish_reason: `tool_calls\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_FINISH_REASON"}\n\`\`\``,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: {
            name: `search\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_TOOL_FUNCTION_NAME"}\n\`\`\``,
            arguments: toolArguments,
          },
        }],
      })
      const liveMessage = await messageEvent
      const liveJson = JSON.stringify(liveMessage)
      expect(liveJson).not.toContain('SECRET_TOOL_ARGUMENT_VALUE')
      expect(liveJson).not.toContain('SECRET_TOOL_ARGUMENT_KEY')
      expect(liveJson).not.toContain('SECRET_TOOL_CALL_ID')
      expect(liveJson).not.toContain('SECRET_TOOL_NAME')
      expect(liveJson).not.toContain('SECRET_FINISH_REASON')
      expect(liveJson).not.toContain('SECRET_TOOL_FUNCTION_NAME')
      expect(liveJson).not.toContain('group-chat-transfer')
      expect(liveJson).not.toContain('gc-transfer')
      expect(liveMessage.tool_call_id).toBe('call-visible')
      expect(liveMessage.tool_name).toBe('lookup')
      expect(liveMessage.finish_reason).toBe('tool_calls')
      expect(liveMessage.tool_calls[0].function.name).toBe('search')
      const parsedArgs = JSON.parse(liveMessage.tool_calls[0].function.arguments)
      expect(parsedArgs.query).toBe('visible query')
      expect(parsedArgs['unsafe-key']).toBe('visible key value')
      const savedJson = JSON.stringify(storage.getMessage('tool-call-transfer'))
      expect(savedJson).not.toContain('SECRET_TOOL_ARGUMENT_VALUE')
      expect(savedJson).not.toContain('SECRET_TOOL_ARGUMENT_KEY')
      expect(savedJson).not.toContain('SECRET_TOOL_FUNCTION_NAME')
    } finally {
      agent.disconnect()
      bob.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('strips transfer fences from assistant reasoning fields before storage and realtime delivery', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Worker', '', 1)
    storage.addRoomMember('room-1', 'bob', 'Bob', '')
    const agent = await connect(port, 'agent-1', 'Worker', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })
    const bob = await connect(port, 'bob', 'Bob')

    try {
      await emitAck<any>(agent, 'join', { roomId: 'room-1' })
      await emitAck<any>(bob, 'join', { roomId: 'room-1' })
      const messageEvent = once<any>(bob, 'message')
      const reasoning = `visible thought\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_REASONING_FACT"}\n\`\`\``
      await emitAck<any>(agent, 'message', {
        roomId: 'room-1',
        id: 'reasoning-transfer',
        role: 'assistant',
        content: 'visible answer',
        reasoning,
        reasoning_content: reasoning,
        reasoning_details: reasoning,
      })
      const liveMessage = await messageEvent
      expect(liveMessage.reasoning).toBe('visible thought')
      expect(liveMessage.reasoning_content).toBe('visible thought')
      expect(liveMessage.reasoning_details).toBe('visible thought')
      expect(JSON.stringify(liveMessage)).not.toContain('SECRET_REASONING_FACT')
      expect(JSON.stringify(storage.getMessage('reasoning-transfer'))).not.toContain('SECRET_REASONING_FACT')
    } finally {
      agent.disconnect()
      bob.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('strips transfer fences that arrive inside streamed content deltas', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Worker', '', 1)
    storage.addRoomMember('room-1', 'bob', 'Bob', '')
    const agent = await connect(port, 'agent-1', 'Worker', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })
    const bob = await connect(port, 'bob', 'Bob')

    try {
      await emitAck<any>(agent, 'join', { roomId: 'room-1' })
      await emitAck<any>(bob, 'join', { roomId: 'room-1' })
      await new Promise<void>(resolve => {
        const chunks: string[] = []
        bob.on('message_stream_delta', payload => chunks.push(String((payload as any).delta || '')))
        bob.once('message_stream_end', () => {
          const combined = chunks.join('')
          expect(combined).toContain('visible before')
          expect(combined).toContain('visible after')
          expect(combined).not.toContain('group-chat-transfer')
          expect(combined).not.toContain('SECRET_STREAM_CONTENT')
          expect(combined).not.toContain('TAIL')
          resolve()
        })
        agent.emit('message_stream_start', { roomId: 'room-1', id: 'content-stream-transfer' })
        agent.emit('message_stream_delta', { roomId: 'room-1', id: 'content-stream-transfer', delta: 'visible before ' })
        agent.emit('message_stream_delta', { roomId: 'room-1', id: 'content-stream-transfer', delta: '```gc-transfer   \r' })
        agent.emit('message_stream_delta', { roomId: 'room-1', id: 'content-stream-transfer', delta: '\n{"type":"private_fact_create","content":"SECRET_STREAM_CONTENT```TAIL"}' })
        agent.emit('message_stream_delta', { roomId: 'room-1', id: 'content-stream-transfer', delta: '\n```\nvisible after' })
        agent.emit('message_stream_end', { roomId: 'room-1', id: 'content-stream-transfer' })
      })
    } finally {
      agent.disconnect()
      bob.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('strips transfer fences that arrive inside streamed reasoning deltas', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Worker', '', 1)
    storage.addRoomMember('room-1', 'bob', 'Bob', '')
    const agent = await connect(port, 'agent-1', 'Worker', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })
    const bob = await connect(port, 'bob', 'Bob')

    try {
      await emitAck<any>(agent, 'join', { roomId: 'room-1' })
      await emitAck<any>(bob, 'join', { roomId: 'room-1' })
      await new Promise<void>(resolve => {
        const chunks: string[] = []
        bob.on('message_reasoning_delta', payload => chunks.push(String((payload as any).delta || '')))
        bob.once('message_stream_end', () => {
          const combined = chunks.join('')
          expect(combined).toContain('safe reasoning')
          expect(combined).toContain('after fence')
          expect(combined).not.toContain('group-chat-transfer')
          expect(combined).not.toContain('SECRET_STREAM_REASONING')
          expect(combined).not.toContain('TAIL')
          resolve()
        })
        agent.emit('message_stream_start', { roomId: 'room-1', id: 'reasoning-stream-transfer' })
        agent.emit('message_reasoning_delta', { roomId: 'room-1', id: 'reasoning-stream-transfer', delta: 'safe reasoning ' })
        agent.emit('message_reasoning_delta', { roomId: 'room-1', id: 'reasoning-stream-transfer', delta: '```group-chat-transfer   ' })
        agent.emit('message_reasoning_delta', { roomId: 'room-1', id: 'reasoning-stream-transfer', delta: '\n{"type":"private_fact_create","content":"SECRET_STREAM_REASONING```TAIL"}' })
        agent.emit('message_reasoning_delta', { roomId: 'room-1', id: 'reasoning-stream-transfer', delta: '\n```\nafter fence' })
        agent.emit('message_stream_end', { roomId: 'room-1', id: 'reasoning-stream-transfer' })
      })
    } finally {
      agent.disconnect()
      bob.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })
})
