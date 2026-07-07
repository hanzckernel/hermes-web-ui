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

  it('does not coerce non-string public audiences to room-public realtime activity', async () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Worker', '', 1)
    const agentActor = 'gc:room-1:agent:agent-1'
    const aliceSocket = await connect(port, 'alice', 'Alice')
    const bobSocket = await connect(port, 'bob', 'Bob')
    const agentSocket = await connect(port, 'agent-1', 'Worker', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })

    try {
      await emitAck<any>(aliceSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(bobSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(agentSocket, 'join', { roomId: 'room-1' })

      await expect(emitAck(aliceSocket, 'message', {
        roomId: 'room-1',
        content: 'not room public',
        channelId: 'public',
        visibility: 'public',
        audienceJson: ['gc:room-1:human:alice'],
      })).resolves.toEqual({ error: 'Cannot write to channel' })

      const publicTotalTokens = storage.getRoom('room-1').totalTokens
      const bobStatus = once<any>(bobSocket, 'context_status', 100)
      agentSocket.emit('context_status', {
        roomId: 'room-1',
        agentName: 'Worker',
        status: 'replying',
        totalTokens: 999,
        channelId: 'public',
        visibility: 'public',
        audienceJson: [agentActor],
      })
      await expect(bobStatus).rejects.toThrow('timeout waiting for context_status')
      expect(storage.getRoom('room-1').totalTokens).toBe(publicTotalTokens)

      const bobStream = once<any>(bobSocket, 'message_stream_start', 100)
      agentSocket.emit('message_stream_start', {
        roomId: 'room-1',
        id: 'audience-array-stream',
        channelId: 'public',
        visibility: 'public',
        audienceJson: [agentActor],
      })
      await expect(bobStream).rejects.toThrow('timeout waiting for message_stream_start')
    } finally {
      aliceSocket.disconnect()
      bobSocket.disconnect()
      agentSocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('keeps socket actor identity scoped per joined room', async () => {
    vi.mocked(isAuthEnabled).mockResolvedValue(true)
    vi.mocked(authenticateUserToken).mockImplementation(async (token: string) => {
      if (token === 'alice-token') return { id: 1, username: 'Alice', role: 'user', profiles: ['default'] } as any
      if (token === 'bob-token') return { id: 2, username: 'Bob', role: 'user', profiles: ['default'] } as any
      return null as any
    })
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.saveRoom('room-2', 'Room 2', 'ROOM2')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Agent', '', 1)
    storage.addRoomAgent('room-2', 'agent-1', 'default', 'Agent', '', 1)
    const aliceSocket = await connect(port, 'alice', 'Alice', { token: 'alice-token' })
    const bobSocket = await connect(port, 'bob', 'Bob', { token: 'bob-token' })
    const agentSocket = await connect(port, 'agent-1', 'Agent', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })

    try {
      const aliceJoin = await emitAck<any>(aliceSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(bobSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(agentSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(agentSocket, 'join', { roomId: 'room-2' })
      const alice = aliceJoin.actorId
      storage.createChannel({
        roomId: 'room-1',
        id: 'private-1',
        kind: 'private',
        name: 'Alice private',
        createdBy: alice,
        members: [
          { actorId: alice, canRead: true, canWrite: true },
          { actorId: 'gc:room-1:agent:agent-1', canRead: true, canWrite: true },
        ],
      })

      const aliceStatus = once<any>(aliceSocket, 'context_status')
      const bobStatus = once<any>(bobSocket, 'context_status', 100)
      agentSocket.emit('context_status', {
        roomId: 'room-1',
        agentName: 'Agent',
        status: 'replying',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })

      expect(await aliceStatus).toMatchObject({ roomId: 'room-1', status: 'replying', channelId: 'private-1' })
      await expect(bobStatus).rejects.toThrow('timeout waiting for context_status')
    } finally {
      aliceSocket.disconnect()
      bobSocket.disconnect()
      agentSocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('rejects authenticated Socket.IO room joins for non-members without matching room profiles', async () => {
    vi.mocked(isAuthEnabled).mockResolvedValue(true)
    vi.mocked(authenticateUserToken).mockImplementation(async (token: string) => {
      if (token === 'owner-token') return { id: 1, username: 'Owner', role: 'user', profiles: ['owner-profile'] } as any
      if (token === 'mallory-token') return { id: 2, username: 'Mallory', role: 'user', profiles: [] } as any
      return null as any
    })
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Secret Room', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'owner-profile', 'Agent', '', 1)
    const ownerSocket = await connect(port, 'owner', 'Owner', { token: 'owner-token' })
    const mallorySocket = await connect(port, 'mallory', 'Mallory', { token: 'mallory-token' })

    try {
      await expect(emitAck<any>(mallorySocket, 'join', { roomId: 'room-1' })).resolves.toEqual({ error: 'Room not found' })
      await expect(emitAck<any>(mallorySocket, 'join', { roomId: 'missing-room' })).resolves.toEqual({ error: 'Room not found' })
      expect(storage.getRoom('missing-room')).toBeUndefined()
      expect(storage.getMemberByAuthUserId('room-1', 2)).toBeNull()

      const ownerJoin = await emitAck<any>(ownerSocket, 'join', { roomId: 'room-1' })
      expect(ownerJoin.roomName).toBe('Secret Room')
      expect(ownerJoin.actorId).toEqual(expect.any(String))
      expect(storage.getMemberByAuthUserId('room-1', 1)).toMatchObject({ userId: 'auth:1', name: 'Owner' })
    } finally {
      ownerSocket.disconnect()
      mallorySocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('allows super admin Socket.IO joins without membership or profile linkage', async () => {
    vi.mocked(isAuthEnabled).mockResolvedValue(true)
    vi.mocked(authenticateUserToken).mockImplementation(async (token: string) => {
      if (token === 'admin-token') return { id: 1, username: 'Root', role: 'super_admin', profiles: [] } as any
      return null as any
    })
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Secret Room', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'owner-profile', 'Agent', '', 1)
    const socket = await connect(port, 'root', 'Spoofed Root', { token: 'admin-token' })

    try {
      const joined = await emitAck<any>(socket, 'join', { roomId: 'room-1' })
      expect(joined.roomName).toBe('Secret Room')
      expect(joined.actorId).toBe('gc:room-1:system')
      expect(joined.agents).toEqual([expect.objectContaining({ profile: 'owner-profile' })])
      expect(storage.getMemberByAuthUserId('room-1', 1)).toBeNull()
    } finally {
      socket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('uses actor visibility for REST room detail', async () => {
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
      const publicBody = await publicDetail.json()
      expect(publicBody.messages.map((m: any) => m.id)).toEqual(['public-msg'])
      expect(publicBody.room).toMatchObject({ id: 'room-1', name: '', inviteCode: null })
      expect(publicBody.agents).toEqual([])
      expect(publicBody.members).toEqual([])
      expect(publicBody.actors).toBeUndefined()

      const aliceDetail = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1?actorId=${encodeURIComponent(alice)}`)
      const aliceBody = await aliceDetail.json()
      expect(aliceBody.messages.map((m: any) => m.id)).toEqual(['public-msg'])
      expect(aliceBody.channels.map((c: any) => c.id)).toEqual(['public'])

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
      expect(joined.roomName).toBe('')
      expect(joined.messages.map((m: any) => m.id)).toEqual(['public-msg'])
      expect(joined.channels.map((c: any) => c.id)).toEqual(['public'])
      expect(joined.agents).toEqual([])
      expect(joined.members).toEqual([])
      expect(joined.actors).toBeUndefined()
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
      if (token === 'alice-token') return { id: 1, username: 'Alice', role: 'user', profiles: ['default'] } as any
      if (token === 'bob-token') return { id: 2, username: 'Bob', role: 'user', profiles: ['default'] } as any
      return null as any
    })
    const storage = server.getStorage() as any
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Agent', '', 1)
    storage.addRoomAgent('room-1', 'agent-2', 'default', 'Other Agent', '', 1)
    const aliceSocket = await connect(port, 'alice', 'Alice', { token: 'alice-token' })
    const bobSocket = await connect(port, 'bob', 'Bob', { token: 'bob-token' })
    let agentSocket: ClientSocket | undefined
    let agent2Socket: ClientSocket | undefined

    try {
      const aliceJoin = await emitAck<any>(aliceSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(bobSocket, 'join', { roomId: 'room-1' })
      const alice = aliceJoin.actorId
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
      agent2Socket = await connect(port, 'agent-2', 'Other Agent', { source: 'agent', agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET })
      await emitAck<any>(agentSocket, 'join', { roomId: 'room-1' })
      await emitAck<any>(agent2Socket, 'join', { roomId: 'room-1' })

      const spoofedStatus = once<any>(aliceSocket, 'context_status')
      agent2Socket.emit('context_status', { roomId: 'room-1', agentName: 'Agent', status: 'replying' })
      expect(await spoofedStatus).toMatchObject({ agentName: 'Other Agent', status: 'replying' })
      const spoofedReady = once<any>(aliceSocket, 'context_status')
      agent2Socket.emit('context_status', { roomId: 'room-1', agentName: 'Agent', status: 'ready' })
      expect(await spoofedReady).toMatchObject({ agentName: 'Other Agent', status: 'ready' })

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
      let bobSawPrivateTyping = false
      bobSocket.on('context_status', (message: any) => {
        if (message.channelId === 'private-1') bobSawPrivateStatus = true
      })
      bobSocket.on('room_updated', (message: any) => {
        if (message.totalTokens === 321) bobSawPrivateRoomUpdate = true
      })
      bobSocket.on('typing', (message: any) => {
        if (message.channelId === 'private-1') bobSawPrivateTyping = true
      })
      bobSocket.on('stop_typing', (message: any) => {
        if (message.channelId === 'private-1') bobSawPrivateTyping = true
      })
      const aliceTyping = once<any>(aliceSocket, 'typing')
      agentSocket.emit('typing', {
        roomId: 'room-1',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })
      expect(await aliceTyping).toMatchObject({ channelId: 'private-1' })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawPrivateTyping).toBe(false)
      const aliceStopTyping = once<any>(aliceSocket, 'stop_typing')
      agentSocket.emit('stop_typing', { roomId: 'room-1' })
      expect(await aliceStopTyping).toMatchObject({ channelId: 'private-1' })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawPrivateTyping).toBe(false)

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

      const aliceReady = once<any>(aliceSocket, 'context_status')
      const bobPublicReady = once<any>(bobSocket, 'context_status', 100)
      agentSocket.emit('context_status', {
        roomId: 'room-1',
        agentName: 'Agent',
        status: 'ready',
        channelId: 'public',
        visibility: 'public',
        audienceJson: '[]',
      })
      expect(await aliceReady).toMatchObject({ status: 'ready', channelId: 'private-1' })
      await expect(bobPublicReady).rejects.toThrow('timeout waiting for context_status')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawPrivateStatus).toBe(false)

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

      bobSawPrivateStatus = false
      const aliceInterruptStatus = once<any>(aliceSocket, 'context_status')
      agentSocket.emit('context_status', {
        roomId: 'room-1',
        agentName: 'Agent',
        status: 'replying',
        channelId: 'private-1',
        visibility: 'private',
        audienceJson: JSON.stringify([alice]),
      })
      expect(await aliceInterruptStatus).toMatchObject({ status: 'replying', channelId: 'private-1' })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(bobSawPrivateStatus).toBe(false)

      const interruptSpy = vi.spyOn(server.agentClients as any, 'interruptAgent').mockResolvedValue(undefined)
      await expect(emitAck(bobSocket, 'interrupt_agent', { roomId: 'room-1', agentName: 'Agent' })).resolves.toEqual({ error: 'Cannot interrupt invisible agent activity' })
      expect(interruptSpy).not.toHaveBeenCalled()

      const aliceReadyFromInterrupt = once<any>(aliceSocket, 'context_status')
      await expect(emitAck(aliceSocket, 'interrupt_agent', { roomId: 'room-1', agentName: 'Agent' })).resolves.toEqual({ ok: true })
      expect(interruptSpy).toHaveBeenCalledWith('room-1', 'Agent', expect.objectContaining({ channelId: 'private-1', visibility: 'private' }))
      expect(await aliceReadyFromInterrupt).toMatchObject({ status: 'ready', channelId: 'private-1' })
    } finally {
      aliceSocket.disconnect()
      agentSocket?.disconnect()
      agent2Socket?.disconnect()
      bobSocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('does not route private mentions to agents outside the channel audience', async () => {
    vi.mocked(isAuthEnabled).mockResolvedValue(true)
    vi.mocked(authenticateUserToken).mockImplementation(async (token: string) => {
      if (token === 'alice-token') return { id: 1, username: 'Alice', role: 'user', profiles: ['default'] } as any
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

  it('removes scoped context snapshots when clearing and deleting a room', () => {
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const storage = server.getStorage() as any
    const message = {
      id: 'm1',
      roomId: 'room-1',
      senderId: 'agent-1',
      senderName: 'Agent',
      content: 'private context',
      timestamp: 1,
      role: 'assistant',
      channelId: 'private-1',
      visibility: 'private',
      audienceJson: JSON.stringify(['gc:room-1:agent:agent-1']),
    }

    try {
      storage.saveRoom('room-1', 'Room 1', 'ROOM1')
      storage.saveRoom('room-2', 'Room 2', 'ROOM2')
      storage.saveScopedContextSnapshot('ctx-room-1', 'room-1', 'gc:room-1:agent:agent-1', message, 'summary', 'm1', 1)
      expect((db.prepare('SELECT COUNT(*) AS count FROM gc_scoped_context_snapshots WHERE roomId = ?').get('room-1') as any).count).toBe(1)

      storage.clearRoomContext('room-1')
      expect((db.prepare('SELECT COUNT(*) AS count FROM gc_scoped_context_snapshots WHERE roomId = ?').get('room-1') as any).count).toBe(0)

      storage.saveScopedContextSnapshot('ctx-room-2', 'room-2', 'gc:room-2:agent:agent-1', { ...message, roomId: 'room-2' }, 'summary', 'm1', 1)
      expect((db.prepare('SELECT COUNT(*) AS count FROM gc_scoped_context_snapshots WHERE roomId = ?').get('room-2') as any).count).toBe(1)

      storage.deleteRoom('room-2')
      expect((db.prepare('SELECT COUNT(*) AS count FROM gc_scoped_context_snapshots WHERE roomId = ?').get('room-2') as any).count).toBe(0)
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })

  it('hides room metadata and realtime delivery from actors without message.read', async () => {
    const app = new Koa()
    app.use(bodyParser())
    app.use(async (ctx, next) => {
      ctx.state.user = { id: 1, username: 'AgentUser', role: 'user', profiles: ['default'] } as any
      await next()
    })
    app.use(groupChatRoutes.routes())
    const httpServer = createServer(app.callback())
    const server = new GroupChatServer(httpServer)
    const { baseUrl, port } = await listen(httpServer)
    const storage = server.getStorage() as any
    setGroupChatServer(server)
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomAgent('room-1', 'agent-1', 'default', 'Agent', '', 1)
    const agentActor = 'gc:room-1:agent:agent-1'
    const humanActor = storage.resolveHumanActorId('room-1', 'auth:1', 'AgentUser', 1)
    for (const actor of [agentActor, humanActor]) {
      db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 0, ?)')
        .run(actor, 'message.read', Date.now())
    }
    storage.createChannel({
      roomId: 'room-1',
      id: 'private-1',
      kind: 'private',
      name: 'Should stay hidden',
      createdBy: agentActor,
      members: [{ actorId: agentActor, canRead: true, canWrite: true }],
    })
    const agentSocket = await connect(port, 'agent-1', 'Agent', {
      source: 'agent',
      agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET,
    })
    const humanSocket = await connect(port, 'human-1', 'Human')

    try {
      const joined = await emitAck<any>(agentSocket, 'join', { roomId: 'room-1' })
      expect(joined.roomName).toBe('')
      expect(joined.messages).toEqual([])
      expect(joined.channels.map((channel: any) => channel.id)).toEqual(['public'])
      expect(joined.actors).toBeUndefined()
      expect(joined.agents).toEqual([])
      expect(joined.members).toEqual([])

      const detail = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1`)
      expect(detail.status).toBe(403)
      await expect(detail.json()).resolves.toEqual({ error: 'message.read required' })

      let sawMessage = false
      let sawMemberEvent = false
      agentSocket.on('message', () => { sawMessage = true })
      agentSocket.on('member_joined', () => { sawMemberEvent = true })
      await emitAck(humanSocket, 'join', { roomId: 'room-1' })
      await emitAck(humanSocket, 'message', { roomId: 'room-1', content: 'public but not readable by revoked actor' })
      await new Promise(resolve => setTimeout(resolve, 120))
      expect(sawMessage).toBe(false)
      expect(sawMemberEvent).toBe(false)

      let sawRoomCleared = false
      let sawRoomUpdated = false
      agentSocket.on('room_cleared', () => { sawRoomCleared = true })
      agentSocket.on('room_updated', () => { sawRoomUpdated = true })
      server.clearRoomRuntimeState('room-1')
      await new Promise(resolve => setTimeout(resolve, 120))
      expect(sawRoomCleared).toBe(false)
      expect(sawRoomUpdated).toBe(false)
    } finally {
      agentSocket.disconnect()
      humanSocket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

})
