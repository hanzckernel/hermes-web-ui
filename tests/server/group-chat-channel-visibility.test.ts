import bodyParser from '@koa/bodyparser'
import Koa from 'koa'
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
import { groupChatRoutes, setGroupChatServer } from '../../packages/server/src/routes/hermes/group-chat'

function listen(server: HttpServer): Promise<{ baseUrl: string; port: number }> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('missing address')
    resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port })
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

describe('group chat channel visibility runtime', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
    initAllHermesTables()
  })

  afterEach(() => {
    setGroupChatServer(null as any)
    db.close()
    groupChatDbMock.current = null
  })

  function seedPrivateRoom(server: GroupChatServer) {
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'alice', 'Alice', '')
    storage.addRoomMember('room-1', 'bob', 'Bob', '')
    const alice = storage.resolveHumanActorId('room-1', 'alice', 'Alice')
    const bob = storage.resolveHumanActorId('room-1', 'bob', 'Bob')
    storage.createChannel({
      roomId: 'room-1',
      id: 'private-1',
      kind: 'private',
      name: 'Alice private',
      createdBy: alice,
      members: [{ actorId: alice, canRead: true, canWrite: true }],
    })
    storage.saveMessageAndRefreshRoom({
      id: 'public-msg',
      roomId: 'room-1',
      senderId: 'alice',
      senderName: 'Alice',
      content: 'public hello',
      timestamp: 1,
      role: 'user',
    })
    storage.saveMessageAndRefreshRoom({
      id: 'private-msg',
      roomId: 'room-1',
      senderId: alice,
      senderName: 'Alice',
      content: 'private hello',
      timestamp: 2,
      role: 'user',
      channelId: 'private-1',
      visibility: 'private',
      audienceJson: JSON.stringify([alice]),
      scope: 'conversation',
    })
    return { storage, alice, bob }
  }

  it('filters UI and context reads by actor while keeping public defaults', () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { storage, alice, bob } = seedPrivateRoom(server)

    try {
      expect(storage.getVisibleMessagesForUI('room-1', null).map((m: any) => m.id)).toEqual(['public-msg'])
      expect(storage.getVisibleMessagesForUI('room-1', bob).map((m: any) => m.id)).toEqual(['public-msg'])
      expect(storage.getVisibleMessagesForUI('room-1', alice).map((m: any) => m.id)).toEqual(['public-msg', 'private-msg'])
      expect(storage.getVisibleMessagesForContext('room-1', bob).map((m: any) => m.id)).toEqual(['public-msg'])
      expect(storage.getVisibleMessageCount('room-1', alice)).toBe(2)
      expect(storage.getVisibleMessageCount('room-1', bob)).toBe(1)
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })

  it('uses the same actor visibility for REST room detail and channel APIs', async () => {
    const app = new Koa()
    app.use(bodyParser())
    app.use(groupChatRoutes.routes())
    const httpServer = createServer(app.callback())
    const server = new GroupChatServer(httpServer)
    const { baseUrl } = await listen(httpServer)
    const { alice, bob } = seedPrivateRoom(server)
    setGroupChatServer(server)

    try {
      const publicDetail = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1`)
      expect((await publicDetail.json()).messages.map((m: any) => m.id)).toEqual(['public-msg'])

      const aliceDetail = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1?actorId=${encodeURIComponent(alice)}`)
      const aliceBody = await aliceDetail.json()
      expect(aliceBody.messages.map((m: any) => m.id)).toEqual(['public-msg', 'private-msg'])
      expect(aliceBody.channels.map((c: any) => c.id)).toEqual(expect.arrayContaining(['public', 'private-1']))

      const bobChannels = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/channels?actorId=${encodeURIComponent(bob)}`)
      expect((await bobChannels.json()).channels.map((c: any) => c.id)).toEqual(['public'])

      const createRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: alice, id: 'task-1', kind: 'task', name: 'Task 1' }),
      })
      expect(createRes.status).toBe(200)
      expect((await createRes.json()).channel).toMatchObject({ id: 'task-1', kind: 'task', createdBy: alice })
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })

  it('filters Socket.IO message delivery for private channels', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    const aliceSocket = await connect(port, 'alice', 'Alice')
    const bobSocket = await connect(port, 'bob', 'Bob')

    try {
      const aliceJoin = await emitAck<any>(aliceSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(bobSocket, 'join', { roomId: 'room-1' })
      const alice = aliceJoin.actorId
      storage.createChannel({
        roomId: 'room-1',
        id: 'private-1',
        kind: 'private',
        name: 'Alice private',
        createdBy: alice,
        members: [{ actorId: alice, canRead: true, canWrite: true }],
      })

      const publicForBob = once<any>(bobSocket, 'message')
      await emitAck(aliceSocket, 'message', { roomId: 'room-1', id: 'public-live', content: 'public live' })
      expect((await publicForBob).id).toBe('public-live')

      let bobSawPrivate = false
      bobSocket.on('message', (message: any) => {
        if (message.id === 'private-live') bobSawPrivate = true
      })
      const alicePrivate = once<any>(aliceSocket, 'message')
      await emitAck(aliceSocket, 'message', {
        roomId: 'room-1',
        id: 'private-live',
        content: 'private live',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })
      expect((await alicePrivate).id).toBe('private-live')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawPrivate).toBe(false)
    } finally {
      aliceSocket.disconnect()
      bobSocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })
})
