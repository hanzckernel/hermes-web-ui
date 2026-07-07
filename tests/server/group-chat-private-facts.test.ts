import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))

vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current }))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'
import { ActorStore } from '../../packages/server/src/services/hermes/group-chat/identity/actor-store'
import { PrivateFactsStore } from '../../packages/server/src/services/hermes/group-chat/identity/private-facts'

describe('group chat private facts', () => {
  let db: DatabaseSync
  let actorStore: ActorStore
  let facts: PrivateFactsStore

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
    initAllHermesTables()
    actorStore = new ActorStore()
    facts = new PrivateFactsStore()
  })

  afterEach(() => {
    db.close()
    groupChatDbMock.current = null
  })

  it('stores and lists facts only for the target actor', () => {
    const alice = actorStore.ensureHumanActor({ roomId: 'room-1', userId: 'alice', displayName: 'Alice' })
    const bob = actorStore.ensureHumanActor({ roomId: 'room-1', userId: 'bob', displayName: 'Bob' })

    facts.createPrivateFact({
      id: 'fact-1',
      roomId: 'room-1',
      actorId: alice.id,
      factType: 'preference',
      content: 'likes concise replies',
      createdBy: bob.id,
    })

    expect(facts.listPrivateFacts('room-1', alice.id)).toEqual([
      expect.objectContaining({ id: 'fact-1', actorId: alice.id, content: 'likes concise replies' }),
    ])
    expect(facts.listPrivateFacts('room-1', bob.id)).toEqual([])
  })

  it('does not write private facts into group chat messages', () => {
    const alice = actorStore.ensureHumanActor({ roomId: 'room-1', userId: 'alice', displayName: 'Alice' })

    facts.createPrivateFact({
      id: 'fact-1',
      roomId: 'room-1',
      actorId: alice.id,
      factType: 'note',
      content: 'do not prompt-inject',
      createdBy: alice.id,
    })

    expect(db.prepare('SELECT COUNT(*) AS count FROM gc_messages WHERE roomId = ?').get('room-1')).toMatchObject({ count: 0 })
  })
})
