import Koa from 'koa'
import bodyParser from '@koa/bodyparser'
import { createServer, type Server as HttpServer } from 'http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupChatRoutes, setGroupChatServer } from '../../packages/server/src/routes/hermes/group-chat'

function listen(server: HttpServer): Promise<string> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('missing address')
    resolve(`http://127.0.0.1:${addr.port}`)
  }))
}

describe('group chat REST route baseline', () => {
  let httpServer: HttpServer
  let baseUrl: string
  let storage: any
  let agentClients: any
  let contextEngine: any
  let clearRoomRuntimeState: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    storage = {
      rooms: new Map<string, any>(),
      agents: new Map<string, any[]>(),
      messages: new Map<string, any[]>(),
      members: new Map<string, any[]>(),
      actors: new Map<string, any[]>(),
      channels: new Map<string, any[]>(),
      saveRoom: vi.fn((id, name, inviteCode, config) => storage.rooms.set(id, { id, name, inviteCode, totalTokens: 0, sessionSeed: '0', ...config })),
      getRoom: vi.fn((id) => storage.rooms.get(id)),
      getAllRooms: vi.fn(() => [...storage.rooms.values()]),
      getRoomsForProfiles: vi.fn(() => [...storage.rooms.values()]),
      getRecentMessagesForUI: vi.fn((roomId, limit = 150, offset = 0) => (storage.messages.get(roomId) || []).slice(offset, offset + limit)),
      getVisibleMessagesForUI: vi.fn((roomId, _actorId, limit = 150, offset = 0) => (storage.messages.get(roomId) || []).slice(offset, offset + limit)),
      getMessageCount: vi.fn((roomId) => (storage.messages.get(roomId) || []).length),
      getVisibleMessageCount: vi.fn((roomId) => (storage.messages.get(roomId) || []).length),
      getRoomAgents: vi.fn((roomId) => storage.agents.get(roomId) || []),
      getRoomMembers: vi.fn((roomId) => storage.members.get(roomId) || []),
      getActors: vi.fn((roomId) => storage.actors.get(roomId) || []),
      getChannels: vi.fn((roomId) => storage.channels.get(roomId) || [{ id: 'public', roomId, kind: 'public', name: 'Public' }]),
      ensureDefaultPublicChannel: vi.fn((roomId) => {
        const channel = { id: 'public', roomId, kind: 'public', name: 'Public' }
        storage.channels.set(roomId, [channel])
        return channel
      }),
      createChannel: vi.fn((input) => {
        const channel = { id: input.id || `${input.kind}-1`, roomId: input.roomId, kind: input.kind, name: input.name, createdBy: input.createdBy }
        storage.channels.set(input.roomId, [...(storage.channels.get(input.roomId) || []), channel])
        return channel
      }),
      getRoomByInviteCode: vi.fn((code) => [...storage.rooms.values()].find((r: any) => r.inviteCode === code)),
      addRoomAgent: vi.fn((roomId, agentId, profile, name, description, invited) => {
        const row = { id: `row-${agentId}`, roomId, agentId, profile, name, description, invited }
        storage.agents.set(roomId, [...(storage.agents.get(roomId) || []), row])
        return row
      }),
      getRoomAgent: vi.fn((roomId, ref) => (storage.agents.get(roomId) || []).find((a: any) => a.id === ref || a.agentId === ref) || null),
      removeRoomMembersForAgent: vi.fn(),
      removeRoomAgent: vi.fn((roomId, ref) => storage.agents.set(roomId, (storage.agents.get(roomId) || []).filter((a: any) => a.id !== ref && a.agentId !== ref))),
      addRoomMember: vi.fn((roomId, userId, name, description = '', avatar = '', authUserId = null) => {
        const member = { roomId, userId, name, description, avatar, authUserId }
        storage.members.set(roomId, [...(storage.members.get(roomId) || []), member])
        return member
      }),
      clearRoomContext: vi.fn((roomId) => { const room = storage.rooms.get(roomId); if (room) Object.assign(room, { totalTokens: 0, sessionSeed: 'rotated' }) }),
      deleteRoom: vi.fn((roomId) => storage.rooms.delete(roomId)),
      resolveHumanActorId: vi.fn((roomId, userId) => `${roomId}:${userId}:actor`),
      resolveExistingHumanActorId: vi.fn((roomId, userId) => `${roomId}:${userId}:actor`),
      canAuthenticatedUserAccessRoom: vi.fn(() => true),
    }
    agentClients = {
      createAgent: vi.fn(async (cfg: any) => {
        if (cfg.profile === 'bad-profile') throw new Error('agent runtime unavailable')
        return { ...cfg, joinRoom: vi.fn(async () => ({})), disconnect: vi.fn() }
      }),
      addAgentToRoom: vi.fn(async () => ({})),
      removeAgentFromRoom: vi.fn(),
      disconnectRoom: vi.fn(),
    }
    contextEngine = { forceCompress: vi.fn(async () => 'private summary') }
    clearRoomRuntimeState = vi.fn()
    setGroupChatServer({ getStorage: () => storage, getContextEngine: () => contextEngine, agentClients, clearRoomRuntimeState } as any)
    const app = new Koa()
    app.use(async (ctx, next) => {
      const userId = ctx.get('x-test-user-id')
      if (userId) ctx.state.user = { id: Number(userId), username: ctx.get('x-test-username') || `user-${userId}`, role: ctx.get('x-test-role') || 'user', profiles: (ctx.get('x-test-profiles') || '').split(',').map(p => p.trim()).filter(Boolean) }
      await next()
    })
    app.use(bodyParser())
    app.use(groupChatRoutes.routes())
    httpServer = createServer(app.callback())
    baseUrl = await listen(httpServer)
  })

  afterEach(() => {
    httpServer.close()
    setGroupChatServer(null as any)
  })

  it('requires name and inviteCode when creating a room', async () => {
    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Room' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'name and inviteCode are required' })
  })

  it('rejects reserved @all agent names when creating a room', async () => {
    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Room', inviteCode: 'ROOM1', agents: [{ profile: 'default', name: 'all' }] }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: '`all` is reserved for @all mentions' })
  })

  it('creates a room, persists successful agents, and reports agent connection failures', async () => {
    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Room',
        inviteCode: 'ROOM1',
        agents: [
          { profile: 'default', name: 'Worker' },
          { profile: 'bad-profile', name: 'Broken' },
        ],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.room).toMatchObject({ name: 'Room', inviteCode: 'ROOM1' })
    expect(body.agents).toHaveLength(1)
    expect(body.agentResults).toEqual([
      expect.objectContaining({ profile: 'default', ok: true }),
      expect.objectContaining({ profile: 'bad-profile', ok: false, code: 'PROFILE_AGENT_CONNECT_FAILED' }),
    ])
    expect(storage.saveRoom).toHaveBeenCalled()
    expect(storage.addRoomAgent.mock.invocationCallOrder[0]).toBeLessThan(agentClients.addAgentToRoom.mock.invocationCallOrder[0])
  })

  it('returns room detail with paging metadata, agents, and members', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' })
    storage.messages.set('room-1', [{ id: 'msg-1' }, { id: 'msg-2' }])
    storage.agents.set('room-1', [{ id: 'row-agent', agentId: 'agent-1', profile: 'default', name: 'Agent' }])
    storage.members.set('room-1', [{ userId: 'user-1', name: 'Alice' }])


    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1?limit=1&offset=1`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      room: { id: 'room-1', name: 'Room' },
      messages: [{ id: 'msg-2' }],
      agents: [{ agentId: 'agent-1' }],
      members: [{ userId: 'user-1' }],
      total: 2,
      offset: 1,
      limit: 1,
      hasMore: false,
    })
  })

  it('does not leak agent metadata through the direct agents route when message.read is revoked', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' })
    storage.agents.set('room-1', [{ id: 'row-agent', agentId: 'agent-1', profile: 'default', name: 'Agent' }])
    storage.canReadRoomAsActor = vi.fn(() => false)

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, {
      headers: { 'x-test-user-id': '42', 'x-test-username': 'Alice' },
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'message.read required' })
    expect(storage.resolveHumanActorId).toHaveBeenCalledWith('room-1', 'auth:42', 'Alice', 42)
    expect(storage.getRoomAgents).not.toHaveBeenCalledWith('room-1')
  })

  it('redacts adjacent REST room metadata when message.read is revoked', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Secret Room', inviteCode: 'ROOM1' })
    storage.canReadRoomAsActor = vi.fn(() => false)

    const listRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms`, {
      headers: { 'x-test-user-id': '42', 'x-test-username': 'Alice' },
    })
    const listBody = await listRes.json()
    expect(listRes.status).toBe(200)
    expect(listBody.rooms).toEqual([{ id: 'room-1', name: '', inviteCode: null }])

    const inviteRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/join/ROOM1`, {
      headers: { 'x-test-user-id': '42', 'x-test-username': 'Alice' },
    })
    expect(inviteRes.status).toBe(403)
    await expect(inviteRes.json()).resolves.toEqual({ error: 'message.read required' })
  })

  it('redacts anonymous adjacent room metadata when read gates are present', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Secret Room', inviteCode: 'ROOM1' })
    storage.canReadRoomAsActor = vi.fn(() => false)

    const listRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms`)
    const listBody = await listRes.json()
    expect(listRes.status).toBe(200)
    expect(listBody.rooms).toEqual([{ id: 'room-1', name: '', inviteCode: null }])

    const inviteRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/join/ROOM1`)
    const inviteBody = await inviteRes.json()
    expect(inviteRes.status).toBe(200)
    expect(inviteBody.room).toEqual({ id: 'room-1', name: '', inviteCode: null })
  })

  it('lists authenticated member rooms even without matching room-agent profiles', async () => {
    storage.rooms.set('member-room', { id: 'member-room', name: 'Member Room', inviteCode: 'MEMBER' })
    storage.rooms.set('other-room', { id: 'other-room', name: 'Other Room', inviteCode: 'OTHER' })
    storage.members.set('member-room', [{ userId: 'auth:42', name: 'Alice', authUserId: 42 }])
    storage.canAuthenticatedUserAccessRoom = vi.fn((roomId, input) => {
      return Boolean((storage.members.get(roomId) || []).some((member: any) => member.authUserId === input.authUserId || member.userId === input.userId))
    })

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms`, {
      headers: { 'x-test-user-id': '42', 'x-test-username': 'Alice', 'x-test-profiles': '' },
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.rooms.map((room: any) => room.id)).toEqual(['member-room'])
    expect(storage.getRoomsForProfiles).not.toHaveBeenCalled()
  })

  it('adds the cloning requester as a member of the cloned room', async () => {
    storage.rooms.set('source-room', { id: 'source-room', name: 'Source Room', inviteCode: 'SOURCE', triggerTokens: 1000, maxHistoryTokens: 2000, tailMessageCount: 3 })
    storage.members.set('source-room', [{ userId: 'auth:42', name: 'Alice', authUserId: 42 }])
    storage.canAuthenticatedUserAccessRoom = vi.fn((roomId, input) => {
      return Boolean((storage.members.get(roomId) || []).some((member: any) => member.authUserId === input.authUserId || member.userId === input.userId))
    })

    const cloneRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/source-room/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user-id': '42', 'x-test-username': 'Alice' },
      body: JSON.stringify({ name: 'Cloned Room', inviteCode: 'CLONED' }),
    })
    const cloneBody = await cloneRes.json()
    const clonedRoomId = cloneBody.room.id

    expect(cloneRes.status).toBe(200)
    expect(storage.members.get(clonedRoomId)).toContainEqual(expect.objectContaining({ userId: 'auth:42', authUserId: 42, name: 'Alice' }))

    const detailRes = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/${clonedRoomId}`, {
      headers: { 'x-test-user-id': '42', 'x-test-username': 'Alice' },
    })
    const detailBody = await detailRes.json()
    expect(detailRes.status).toBe(200)
    expect(detailBody.room).toMatchObject({ id: clonedRoomId, name: 'Cloned Room', inviteCode: 'CLONED' })
  })

  it('blocks REST room write surfaces when message.write is revoked for the request actor', async () => {
    const agent = { id: 'row-agent', roomId: 'room-1', agentId: 'agent-1', profile: 'default', name: 'Agent' }
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' })
    storage.agents.set('room-1', [agent])
    storage.canActor = vi.fn(() => false)

    const authed = { 'x-test-user-id': '42', 'x-test-username': 'Alice' }
    const requests: Array<Promise<Response>> = [
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/invite-code`, { method: 'PUT', headers: { ...authed, 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode: 'NEXT1' }) }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/clone`, { method: 'POST', headers: { ...authed, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Clone', inviteCode: 'CLONE1' }) }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, { method: 'POST', headers: { ...authed, 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: 'new-agent' }) }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents/row-agent`, { method: 'DELETE', headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1`, { method: 'DELETE', headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/clear-context`, { method: 'POST', headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/config`, { method: 'PUT', headers: { ...authed, 'Content-Type': 'application/json' }, body: JSON.stringify({ triggerTokens: 1 }) }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/compress`, { method: 'POST', headers: authed }),
    ]
    for (const res of await Promise.all(requests)) {
      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({ error: 'message.write required' })
    }

    expect(storage.saveRoom).not.toHaveBeenCalled()
    expect(storage.deleteRoom).not.toHaveBeenCalled()
    expect(storage.clearRoomContext).not.toHaveBeenCalled()
    expect(storage.removeRoomAgent).not.toHaveBeenCalled()
    expect(agentClients.removeAgentFromRoom).not.toHaveBeenCalled()
    expect(contextEngine.forceCompress).not.toHaveBeenCalled()
  })

  it('blocks authenticated non-members from direct room REST read and write surfaces without minting an actor', async () => {
    const agent = { id: 'row-agent', roomId: 'room-1', agentId: 'agent-1', profile: 'owner-profile', name: 'Agent' }
    storage.rooms.set('room-1', { id: 'room-1', name: 'Secret Room', inviteCode: 'ROOM1' })
    storage.agents.set('room-1', [agent])
    storage.members.set('room-1', [{ userId: 'auth:1', name: 'Owner', authUserId: 1 }])
    storage.canAuthenticatedUserAccessRoom = vi.fn(() => false)
    storage.canReadRoomAsActor = vi.fn(() => true)
    storage.canActor = vi.fn(() => true)
    storage.resolveExistingHumanActorId = vi.fn(() => null)
    const authed = { 'x-test-user-id': '42', 'x-test-username': 'Mallory' }

    const requests: Array<Promise<Response>> = [
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1`, { headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, { headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/join/ROOM1`, { headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/clone`, { method: 'POST', headers: { ...authed, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Clone' }) }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/clear-context`, { method: 'POST', headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/compress`, { method: 'POST', headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1`, { method: 'DELETE', headers: authed }),
    ]

    for (const res of await Promise.all(requests)) {
      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'Room not found' })
    }

    const missingRequests: Array<Promise<Response>> = [
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/missing-room`, { headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/join/MISSING`, { headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/missing-room/clone`, { method: 'POST', headers: { ...authed, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Clone' }) }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/missing-room/clear-context`, { method: 'POST', headers: authed }),
      fetch(`${baseUrl}/api/hermes/group-chat/rooms/missing-room/compress`, { method: 'POST', headers: authed }),
    ]
    for (const res of await Promise.all(missingRequests)) {
      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'Room not found' })
    }
    expect(storage.resolveExistingHumanActorId).not.toHaveBeenCalled()
    expect(storage.getRoomAgents).not.toHaveBeenCalledWith('room-1')
    expect(storage.clearRoomContext).not.toHaveBeenCalled()
    expect(storage.deleteRoom).not.toHaveBeenCalled()
  })

  it('allows super admins to read and compress rooms without membership or profile linkage', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Secret Room', inviteCode: 'ROOM1' })
    storage.messages.set('room-1', [{ id: 'msg-1' }])
    storage.canAuthenticatedUserAccessRoom = vi.fn(() => false)
    storage.canReadRoomAsActor = vi.fn((_roomId, actorId) => actorId === 'gc:room-1:system')
    storage.canActor = vi.fn(() => false)
    const admin = { 'x-test-user-id': '1', 'x-test-username': 'Root', 'x-test-role': 'super_admin' }

    const detail = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1`, { headers: admin })
    const detailBody = await detail.json()
    expect(detail.status).toBe(200)
    expect(detailBody.room).toMatchObject({ id: 'room-1', name: 'Secret Room', inviteCode: 'ROOM1' })
    expect(detailBody.actorId).toBe('gc:room-1:system')
    expect(storage.canAuthenticatedUserAccessRoom).not.toHaveBeenCalled()

    const compress = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/compress`, { method: 'POST', headers: admin })
    expect(compress.status).toBe(200)
    expect(contextEngine.forceCompress).toHaveBeenCalledWith('room-1', undefined, 'gc:room-1:system')
  })

  it('forces compression without returning generated summary text', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' })

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/compress`, { method: 'POST' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(contextEngine.forceCompress).toHaveBeenCalledWith('room-1', undefined, null)
    expect(body).toEqual({ success: true })
  })

  it('rejects duplicate room agent profiles', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' })
    storage.agents.set('room-1', [{ id: 'row-agent', agentId: 'agent-1', profile: 'default', name: 'Agent' }])

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'default', name: 'Agent' }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'Agent already in room' })
  })

  it('rejects duplicate room agent display names', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' })
    storage.agents.set('room-1', [{ id: 'row-agent', agentId: 'agent-1', profile: 'default', name: 'Worker' }])

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'other-profile', name: ' worker ' }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'Agent display name already in room' })
    expect(agentClients.createAgent).not.toHaveBeenCalled()
  })

  it('rejects adding an agent with an existing human member display name', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' })
    storage.members.set('room-1', [{ userId: 'human-worker', name: 'Worker' }])

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'default', name: ' worker ' }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'Member identity already in room' })
    expect(agentClients.createAgent).not.toHaveBeenCalled()
  })

  it('rejects duplicate agent display names when creating a room', async () => {
    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Room',
        inviteCode: 'ROOM1',
        agents: [
          { profile: 'default', name: 'Worker' },
          { profile: 'other-profile', name: ' worker ' },
        ],
      }),
    })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'Agent display name already in room' })
    expect(storage.saveRoom).not.toHaveBeenCalled()
    expect(agentClients.createAgent).not.toHaveBeenCalled()
  })

  it('removes an agent by row id and disconnects runtime by persisted agent id', async () => {
    const agent = { id: 'row-agent', roomId: 'room-1', agentId: 'agent-1', profile: 'default', name: 'Agent' }
    storage.agents.set('room-1', [agent])

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/agents/row-agent`, { method: 'DELETE' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(storage.removeRoomMembersForAgent).toHaveBeenCalledWith('room-1', agent)
    expect(storage.removeRoomAgent).toHaveBeenCalledWith('room-1', 'row-agent')
    expect(agentClients.removeAgentFromRoom).toHaveBeenCalledWith('room-1', 'agent-1')
    expect(body).toMatchObject({ success: true, agents: [], members: [] })
  })

  it('clears room context and runtime state while returning the updated room', async () => {
    storage.rooms.set('room-1', { id: 'room-1', name: 'Room', inviteCode: 'ROOM1', totalTokens: 99, sessionSeed: 'old' })

    const res = await fetch(`${baseUrl}/api/hermes/group-chat/rooms/room-1/clear-context`, { method: 'POST' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(storage.clearRoomContext).toHaveBeenCalledWith('room-1')
    expect(clearRoomRuntimeState).toHaveBeenCalledWith('room-1')
    expect(body).toMatchObject({ success: true, room: { id: 'room-1', totalTokens: 0, sessionSeed: 'rotated' } })
  })
})
