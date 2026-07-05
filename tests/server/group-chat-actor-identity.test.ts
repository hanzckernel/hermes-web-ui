import bodyParser from '@koa/bodyparser'
import Koa from 'koa'
import { createServer, type Server as HttpServer } from 'http'
import { DatabaseSync } from 'node:sqlite'
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))

vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current }))
vi.mock('../../packages/server/src/middleware/user-auth', () => ({
  isAuthEnabled: vi.fn(async () => false),
  authenticateUserToken: vi.fn(),
}))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'
import { ActorStore } from '../../packages/server/src/services/hermes/group-chat/identity/actor-store'
import { agentActorId } from '../../packages/server/src/services/hermes/group-chat/identity/actor-ids'
import { GroupChatServer } from '../../packages/server/src/services/hermes/group-chat'
import { groupChatRoutes, setGroupChatServer } from '../../packages/server/src/routes/hermes/group-chat'

async function listen(server: HttpServer): Promise<{ baseUrl: string; port: number }> {
  return await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('missing address')
    resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port })
  }))
}

function emitAck<T = any>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise(resolve => {
    socket.emit(event, payload, (response: T) => resolve(response))
  })
}

async function createRouteHarness(): Promise<{
  server: GroupChatServer
  httpServer: HttpServer
  baseUrl: string
  cleanup: () => void
}> {
  const app = new Koa()
  app.use(bodyParser())
  app.use(groupChatRoutes.routes())
  const httpServer = createServer(app.callback())
  const server = new GroupChatServer(httpServer)
  setGroupChatServer(server)
  const { baseUrl } = await listen(httpServer)
  return {
    server,
    httpServer,
    baseUrl,
    cleanup: () => {
      setGroupChatServer(null as any)
      server.getIO().close()
      httpServer.close()
    },
  }
}

describe('group chat actor identity', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
  })

  afterEach(() => {
    db.close()
    groupChatDbMock.current = null
  })

  it('initializes actor identity tables additively', () => {
    initAllHermesTables()

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining([
      'gc_actors',
      'gc_actor_capabilities',
      'gc_actor_private_facts',
    ]))

    const actorColumns = db.prepare('PRAGMA table_info(gc_actors)').all() as Array<{ name: string }>
    expect(actorColumns.map(c => c.name)).toEqual(expect.arrayContaining([
      'id',
      'roomId',
      'kind',
      'source',
      'displayName',
      'profile',
      'agentKind',
      'authUserId',
      'metadataJson',
    ]))
  })

  it('ensures stable human and agent actors', () => {
    initAllHermesTables()
    const store = new ActorStore()

    const human = store.ensureHumanActor({ roomId: 'room-1', userId: 'user-1', displayName: 'Alice' })
    const agent = store.ensureAgentActor({
      roomId: 'room-1',
      agentId: 'agent-1',
      profile: 'default',
      displayName: 'Worker',
      agentKind: 'hermes',
    })

    expect(human).toMatchObject({ id: 'gc:room-1:human:user-1', kind: 'human', source: 'web-ui' })
    expect(human.capabilities).toEqual(expect.arrayContaining(['message.read', 'message.write']))
    expect(agent).toMatchObject({ id: 'gc:room-1:agent:agent-1', kind: 'agent', agentKind: 'hermes' })
    expect(agent.capabilities).toEqual(expect.arrayContaining(['message.read', 'message.write', 'approval.request']))
    expect(agent.capabilities).not.toContain('agent.handoff')
    expect(store.listActors('room-1').map(a => a.id)).toEqual([human.id, agent.id])
  })

  it('does not expose numeric auth user ids in public actor summaries', () => {
    initAllHermesTables()
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const storage = server.getStorage()
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'auth:42', 'Alice', '', '', 42)

    try {
      const actors = storage.getActors('room-1') as any[]
      const human = actors.find(actor => actor.kind === 'human')
      expect(human.id).toMatch(/^gc:room-1:human:auth:[a-f0-9]{16}$/)
      expect(human.id).not.toContain('42')
      expect(human).not.toHaveProperty('authUserId')
      expect(human).not.toHaveProperty('externalUserId')
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })

  it('backfills actor summaries for legacy persisted members and agents', () => {
    initAllHermesTables()
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const storage = server.getStorage()
    storage.saveRoom('legacy-room', 'Legacy Room', 'LEGACY')
    db.prepare('INSERT INTO gc_room_members (id, roomId, userId, userName, description, joinedAt, updatedAt, avatar, authUserId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('member-1', 'legacy-room', 'auth:42', 'Alice', '', 1, 1, '', 42)
    db.prepare('INSERT INTO gc_room_agents (id, roomId, agentId, profile, name, description, invited) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('agent-row-1', 'legacy-room', 'agent-1', 'default', 'Worker', '', 0)

    try {
      const actors = storage.getActors('legacy-room') as any[]
      expect(actors).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^gc:legacy-room:human:auth:[a-f0-9]{16}$/), kind: 'human', displayName: 'Alice' }),
        expect.objectContaining({ id: 'gc:legacy-room:agent:agent-1', kind: 'agent', displayName: 'Worker' }),
      ]))
      expect(actors.every(actor => !('authUserId' in actor) && !('externalUserId' in actor))).toBe(true)
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })

  it('updates repeated ensures without changing actor ids', () => {
    initAllHermesTables()
    const store = new ActorStore()

    const first = store.ensureHumanActor({
      roomId: 'room-1',
      userId: 'user-1',
      displayName: 'Alice',
      metadata: { color: 'blue' },
    })
    const second = store.ensureHumanActor({
      roomId: 'room-1',
      userId: 'user-1',
      displayName: 'Alicia',
      metadata: { color: 'green' },
    })

    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ displayName: 'Alicia', metadata: { color: 'green' } })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
  })

  it('ensures one system actor and does not pre-create tool actors', () => {
    initAllHermesTables()
    const store = new ActorStore()

    const system = store.ensureSystemActor('room-1')
    store.ensureSystemActor('room-1')

    expect(system).toMatchObject({ id: 'gc:room-1:system', kind: 'system', source: 'system' })
    expect(store.listActors('room-1').map(a => a.kind)).toEqual(['system'])
  })

  it('creates or updates a human actor when a socket joins', async () => {
    initAllHermesTables()
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const { port } = await listen(httpServer)
    const socket = clientIo(`http://127.0.0.1:${port}/group-chat`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { userId: 'user-1', name: 'Alice' },
    })

    try {
      server.getStorage().saveRoom('room-1', 'Room 1', 'ROOM1')
      await new Promise<void>(resolve => socket.once('connect', () => resolve()))
      const joined = await emitAck<any>(socket, 'join', { roomId: 'room-1' })

      expect(joined).toMatchObject({ roomId: 'room-1' })
      expect(joined.actors).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'gc:room-1:human:user-1', kind: 'human', displayName: 'Alice' }),
      ]))
      expect(server.getStorage().getActors('room-1')).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'gc:room-1:human:user-1', kind: 'human', displayName: 'Alice' }),
      ]))
    } finally {
      socket.disconnect()
      server.getIO().close()
      httpServer.close()
    }
  })

  it('creates an agent actor only after a successful add-agent route call', async () => {
    initAllHermesTables()
    const harness = await createRouteHarness()
    const createAgent = vi.spyOn(harness.server.agentClients, 'createAgent').mockImplementation(async (cfg: any) => {
      if (cfg.profile === 'bad-profile') throw new Error('agent runtime unavailable')
      return { ...cfg, joinRoom: vi.fn(async () => ({})), disconnect: vi.fn() } as any
    })
    vi.spyOn(harness.server.agentClients, 'addAgentToRoom').mockResolvedValue({} as any)

    try {
      harness.server.getStorage().saveRoom('room-1', 'Room 1', 'ROOM1')

      const ok = await fetch(`${harness.baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'default', name: 'Worker' }),
      })
      const bad = await fetch(`${harness.baseUrl}/api/hermes/group-chat/rooms/room-1/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'bad-profile', name: 'Broken' }),
      })

      expect(ok.status).toBe(200)
      expect(bad.status).toBe(502)
      expect(createAgent).toHaveBeenCalledTimes(2)
      expect(harness.server.getStorage().getActors('room-1')).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^gc:room-1:agent:/), kind: 'agent', displayName: 'Worker' }),
      ]))
      expect(harness.server.getStorage().getActors('room-1')).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ displayName: 'Broken' }),
      ]))
    } finally {
      harness.cleanup()
    }
  })

  it('removes an agent actor with its capabilities and private facts', async () => {
    initAllHermesTables()
    const harness = await createRouteHarness()
    vi.spyOn(harness.server.agentClients, 'removeAgentFromRoom').mockImplementation(() => undefined)

    try {
      const storage = harness.server.getStorage()
      storage.saveRoom('room-1', 'Room 1', 'ROOM1')
      const agent = storage.addRoomAgent('room-1', 'agent-1', 'default', 'Worker', '', 0)
      const actorId = agentActorId('room-1', 'agent-1')
      db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, updatedAt) VALUES (?, ?, ?)').run(actorId, 'message.write', 1)
      db.prepare('INSERT INTO gc_actor_private_facts (id, roomId, actorId, factType, content, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run('fact-1', 'room-1', actorId, 'note', 'secret', 'tester', 1)

      const res = await fetch(`${harness.baseUrl}/api/hermes/group-chat/rooms/room-1/agents/${agent.id}`, { method: 'DELETE' })

      expect(res.status).toBe(200)
      expect(db.prepare('SELECT COUNT(*) AS count FROM gc_actors WHERE id = ?').get(actorId)).toMatchObject({ count: 0 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM gc_actor_capabilities WHERE actorId = ?').get(actorId)).toMatchObject({ count: 0 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM gc_actor_private_facts WHERE actorId = ?').get(actorId)).toMatchObject({ count: 0 })
    } finally {
      harness.cleanup()
    }
  })

  it('deletes room actors, capabilities, and private facts with the room', () => {
    initAllHermesTables()
    const httpServer = createServer()
    const server = new GroupChatServer(httpServer)
    const storage = server.getStorage()
    storage.saveRoom('room-1', 'Room 1', 'ROOM1')
    storage.addRoomMember('room-1', 'user-1', 'Alice', '')
    const actorId = 'gc:room-1:human:user-1'
    db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, updatedAt) VALUES (?, ?, ?)').run(actorId, 'message.write', 1)
    db.prepare('INSERT INTO gc_actor_private_facts (id, roomId, actorId, factType, content, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run('fact-1', 'room-1', actorId, 'note', 'secret', 'tester', 1)

    try {
      storage.deleteRoom('room-1')

      expect(db.prepare('SELECT COUNT(*) AS count FROM gc_actors WHERE roomId = ?').get('room-1')).toMatchObject({ count: 0 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM gc_actor_capabilities WHERE actorId = ?').get(actorId)).toMatchObject({ count: 0 })
      expect(db.prepare('SELECT COUNT(*) AS count FROM gc_actor_private_facts WHERE roomId = ?').get('room-1')).toMatchObject({ count: 0 })
    } finally {
      server.getIO().close()
      httpServer.close()
    }
  })
})
