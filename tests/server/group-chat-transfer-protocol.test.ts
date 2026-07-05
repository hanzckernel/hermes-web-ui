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
import { extractGroupTransferCards } from '../../packages/server/src/services/hermes/group-chat/transfer-protocol'

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

async function connect(port: number, userId: string, name: string): Promise<ClientSocket> {
  const socket = clientIo(`http://127.0.0.1:${port}/group-chat`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { userId, name },
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

  it('parses only explicit transfer blocks', () => {
    expect(extractGroupTransferCards('please handoff to Worker')).toEqual([])
    expect(extractGroupTransferCards(`before\n\n\`\`\`group-chat-transfer\n{"type":"handoff","targetAgent":"Worker","summary":"take this"}\n\`\`\``)).toEqual([
      expect.objectContaining({ type: 'handoff', targetAgent: 'Worker', summary: 'take this' }),
    ])
    expect(extractGroupTransferCards(`\`\`\`gc-transfer\nnot-json\n\`\`\``)).toEqual([])
  })

  it('emits transfer cards and projects created private facts into scoped context', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'alice', 'Alice', '')
    const alice = await connect(port, 'alice', 'Alice')

    try {
      await emitAck<any>(alice, 'join', { roomId: 'room-1' })
      const transferEvent = once<any>(alice, 'transfer.card')
      const content = `remember this\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","factType":"preference","content":"Prefer short answers"}\n\`\`\``
      const ack = await emitAck<any>(alice, 'message', { roomId: 'room-1', content })
      expect(ack.id).toBeTruthy()
      const event = await transferEvent
      expect(event.card).toMatchObject({ type: 'private_fact_create', status: 'accepted', factType: 'preference' })
      expect(event.card.factId).toBeTruthy()

      const saved = storage.getMessagesForContext('room-1').find((message: any) => message.id === ack.id)
      const metadata = JSON.parse(saved.metadataJson)
      expect(metadata.transferCards[0]).toMatchObject({ type: 'private_fact_create', status: 'accepted', factType: 'preference' })
      expect(storage.getActorContextProjection('room-1', event.card.targetActorId).privateFacts).toEqual([
        expect.objectContaining({ factType: 'preference', content: 'Prefer short answers' }),
      ])

      const revokeEvent = once<any>(alice, 'transfer.card')
      await emitAck<any>(alice, 'message', {
        roomId: 'room-1',
        content: `\`\`\`group-chat-transfer\n{"type":"private_fact_revoke","factId":"${event.card.factId}"}\n\`\`\``,
      })
      const revoked = await revokeEvent
      expect(revoked.card).toMatchObject({ type: 'private_fact_revoke', status: 'accepted', factId: event.card.factId })
      expect(storage.getActorContextProjection('room-1', event.card.targetActorId).privateFacts).toEqual([])
    } finally {
      alice.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })
})
