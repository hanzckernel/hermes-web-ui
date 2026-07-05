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
import { GROUP_CHAT_AGENT_SOCKET_SECRET } from '../../packages/server/src/services/hermes/group-chat/agent-clients'
import { groupChatRoutes, setGroupChatServer } from '../../packages/server/src/routes/hermes/group-chat'
import { authenticateUserToken, isAuthEnabled } from '../../packages/server/src/middleware/user-auth'

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

async function connect(port: number, userId: string, name: string, authExtra: Record<string, unknown> = {}): Promise<ClientSocket> {
  const socket = clientIo(`http://127.0.0.1:${port}/group-chat`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { userId, name, ...authExtra },
  })
  await once(socket, 'connect')
  return socket
}

describe('group chat channel visibility runtime', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
    vi.mocked(isAuthEnabled).mockResolvedValue(false)
    vi.mocked(authenticateUserToken).mockResolvedValue(null as any)
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
      expect(aliceBody.messages.map((m: any) => m.id)).toEqual(['public-msg'])
      expect(aliceBody.channels.map((c: any) => c.id)).toEqual(['public'])

      const bobChannels = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/channels?actorId=${encodeURIComponent(bob)}`)
      expect((await bobChannels.json()).channels.map((c: any) => c.id)).toEqual(['public'])

      const createRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: alice, id: 'task-1', kind: 'task', name: 'Task 1' }),
      })
      expect(createRes.status).toBe(403)
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })


  it('allows authenticated actors with explicit channel-create capability to create channels', async () => {
    const app = new Koa()
    app.use(bodyParser())
    app.use(async (ctx, next) => {
      ctx.state.user = { id: 1, username: 'Alice', role: 'user', profiles: [] }
      await next()
    })
    app.use(groupChatRoutes.routes())
    const httpServer = createServer(app.callback())
    const server = new GroupChatServer(httpServer)
    const { baseUrl } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    const alice = storage.resolveHumanActorId('room-1', 'auth:1', 'Alice', 1)
    db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 1, ?)')
      .run(alice, 'channel.create.task', Date.now())
    setGroupChatServer(server)

    try {
      const createRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'task-1', kind: 'task', name: 'Task 1' }),
      })
      expect(createRes.status).toBe(200)
      expect((await createRes.json()).channel).toMatchObject({ id: 'task-1', kind: 'task', createdBy: alice })
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })


  it('ignores socket-supplied authUserId when auth is disabled', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.saveMessageAndRefreshRoom({
      id: 'public-msg',
      roomId: 'room-1',
      senderId: 'alice',
      senderName: 'Alice',
      content: 'public hello',
      timestamp: 1,
      role: 'user',
    })
    const authActor = storage.resolveHumanActorId('room-1', 'auth:1', 'Alice', 1)
    storage.createChannel({
      roomId: 'room-1',
      id: 'private-1',
      kind: 'private',
      name: 'Auth private',
      createdBy: authActor,
      members: [{ actorId: authActor, canRead: true, canWrite: true }],
    })
    storage.saveMessageAndRefreshRoom({
      id: 'private-msg',
      roomId: 'room-1',
      senderId: authActor,
      senderName: 'Alice',
      content: 'private hello',
      timestamp: 2,
      role: 'user',
      channelId: 'private-1',
      visibility: 'private',
      audienceJson: JSON.stringify([authActor]),
    })
    const socket = await connect(port, 'guest', 'Guest', { authUserId: 1 })

    try {
      const joined = await emitAck<any>(socket, 'join', { roomId: 'room-1' })
      expect(joined.actorId).toBeNull()
      expect(joined.messages.map((m: any) => m.id)).toEqual(['public-msg'])
      expect(joined.channels.map((c: any) => c.id)).toEqual(['public'])
      await expect(emitAck(socket, 'message', {
        roomId: 'room-1',
        id: 'spoof-private',
        content: 'spoof',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([authActor]),
      })).resolves.toEqual({ error: 'Cannot write to channel' })
      await expect(emitAck(socket, 'message', {
        roomId: 'room-1',
        id: 'spoof-public-private',
        content: 'spoof public private',
        channelId: 'public',
        visibility: 'private',
        audienceJson: JSON.stringify([authActor]),
      })).resolves.toEqual({ error: 'Cannot write to channel' })
      let sawSpoofStream = false
      socket.on('message_stream_start', (message: any) => {
        if (message.id === 'spoof-stream') sawSpoofStream = true
      })
      socket.emit('message_stream_start', {
        roomId: 'room-1',
        id: 'spoof-stream',
        channelId: 'public',
        visibility: 'private',
        audienceJson: JSON.stringify([authActor]),
      })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(sawSpoofStream).toBe(false)
    } finally {
      socket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('filters Socket.IO message delivery for private channels', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    vi.mocked(isAuthEnabled).mockResolvedValue(true)
    vi.mocked(authenticateUserToken).mockImplementation(async (token: string) => {
      if (token === 'alice-token') return { id: 1, username: 'Alice', role: 'user', profiles: [] } as any
      if (token === 'bob-token') return { id: 2, username: 'Bob', role: 'user', profiles: [] } as any
      return null as any
    })
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    const aliceSocket = await connect(port, 'alice', 'Alice', { token: 'alice-token' })
    const bobSocket = await connect(port, 'bob', 'Bob', { token: 'bob-token' })
    let agentSocket: ClientSocket | undefined

    try {
      const aliceJoin = await emitAck<any>(aliceSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(bobSocket, 'join', { roomId: 'room-1' })
      const alice = aliceJoin.actorId
      storage.addRoomAgent('room-1', 'agent-1', 'default', 'Agent', '', 1)
      const agent = `gc:room-1:agent:agent-1`
      storage.createChannel({
        roomId: 'room-1',
        id: 'private-1',
        kind: 'private',
        name: 'Alice private',
        createdBy: alice,
        members: [
          { actorId: alice, canRead: true, canWrite: true },
          { actorId: agent, canRead: true, canWrite: true },
        ],
      })
      agentSocket = await connect(port, 'agent-1', 'Agent', { source: 'agent', agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET })
      await emitAck<any>(agentSocket, 'join', { roomId: 'room-1' })

      const publicForBob = once<any>(bobSocket, 'message')
      await emitAck(aliceSocket, 'message', { roomId: 'room-1', id: 'public-live', content: 'public live' })
      expect((await publicForBob).id).toBe('public-live')
      const publicTotalTokens = storage.getRoom('room-1').totalTokens
      expect(publicTotalTokens).toBeGreaterThan(0)

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
      expect(storage.getRoom('room-1').totalTokens).toBe(publicTotalTokens)
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawPrivate).toBe(false)

      let bobSawApproval = false
      bobSocket.on('approval.requested', (message: any) => {
        if (message.approval_id === 'private-approval') bobSawApproval = true
      })
      const aliceApproval = once<any>(aliceSocket, 'approval.requested')
      agentSocket.emit('approval.requested', {
        roomId: 'room-1',
        approval_id: 'private-approval',
        command: 'secret command',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })
      expect(await aliceApproval).toMatchObject({ approval_id: 'private-approval', channelId: 'private-1', visibility: 'private' })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawApproval).toBe(false)
      await expect(emitAck(bobSocket, 'approval.respond', { roomId: 'room-1', approval_id: 'private-approval', choice: 'once' })).resolves.toEqual({ error: 'Approval not visible' })

      let bobSawPrivateStatus = false
      let bobSawPrivateRoomUpdate = false
      bobSocket.on('context_status', (message: any) => {
        if (message.channelId === 'private-1') bobSawPrivateStatus = true
      })
      bobSocket.on('room_updated', (message: any) => {
        if (message.totalTokens === 321) bobSawPrivateRoomUpdate = true
      })
      const aliceStatus = once<any>(aliceSocket, 'context_status')
      agentSocket.emit('context_status', {
        roomId: 'room-1',
        agentName: 'Agent',
        status: 'replying',
        totalTokens: 321,
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })
      expect(await aliceStatus).toMatchObject({ status: 'replying', channelId: 'private-1' })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawPrivateStatus).toBe(false)
      expect(bobSawPrivateRoomUpdate).toBe(false)
      expect(storage.getRoom('room-1').totalTokens).toBe(publicTotalTokens)

      let aliceSawBobStream = false
      aliceSocket.on('message_stream_start', (message: any) => {
        if (message.id === 'bob-private-stream') aliceSawBobStream = true
      })
      bobSocket.emit('message_stream_start', {
        roomId: 'room-1',
        id: 'bob-private-stream',
        content: 'stream leak',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(aliceSawBobStream).toBe(false)
    } finally {
      aliceSocket.disconnect()
      agentSocket?.disconnect()
      bobSocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('does not route private mentions to agents outside the channel audience', async () => {
    vi.mocked(isAuthEnabled).mockResolvedValue(true)
    vi.mocked(authenticateUserToken).mockImplementation(async (token: string) => {
      if (token === 'alice-token') return { id: 1, username: 'Alice', role: 'user', profiles: [] } as any
      return null as any
    })
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-worker', 'default', 'Worker', '', 0)
    const aliceSocket = await connect(port, 'alice', 'Alice', { token: 'alice-token' })
    const agentSocket = await connect(port, 'agent-worker', 'Worker', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })

    try {
      const aliceJoin = await emitAck<any>(aliceSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(agentSocket, 'join', { roomId: 'room-1' })
      const alice = aliceJoin.actorId
      storage.createChannel({
        roomId: 'room-1',
        id: 'private-1',
        kind: 'private',
        name: 'Alice private',
        createdBy: alice,
        members: [{ actorId: alice, canRead: true, canWrite: true }],
      })
      const routed = vi.spyOn(server.agentClients as any, '_processAgentMention')

      await emitAck(aliceSocket, 'message', {
        roomId: 'room-1',
        id: 'private-mention',
        content: '@Worker private request',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })
      await new Promise(resolve => setTimeout(resolve, 80))

      expect(routed).not.toHaveBeenCalled()
    } finally {
      aliceSocket.disconnect()
      agentSocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

})
