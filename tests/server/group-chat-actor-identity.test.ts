import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))

vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current }))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'

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
})
