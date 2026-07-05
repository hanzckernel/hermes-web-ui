import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))

vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current }))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'
import { ActorStore } from '../../packages/server/src/services/hermes/group-chat/identity/actor-store'

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
    expect(agent).toMatchObject({ id: 'gc:room-1:agent:agent-1', kind: 'agent', agentKind: 'hermes' })
    expect(store.listActors('room-1').map(a => a.id)).toEqual([human.id, agent.id])
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
})
