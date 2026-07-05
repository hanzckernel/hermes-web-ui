import { DatabaseSync } from 'node:sqlite'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))
vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current, getStoragePath: () => ':memory:' }))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'
import { ChannelStore } from '../../packages/server/src/services/hermes/group-chat/visibility/channel-store'

describe('group chat channel visibility schema and store', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
  })

  afterEach(() => {
    db.close()
    groupChatDbMock.current = null
  })

  it('initializes channel tables and message visibility columns', () => {
    initAllHermesTables()

    const messageColumns = db.prepare('PRAGMA table_info(gc_messages)').all() as Array<{ name: string }>
    expect(messageColumns.map(c => c.name)).toEqual(expect.arrayContaining([
      'channelId',
      'threadId',
      'visibility',
      'audienceJson',
      'scope',
      'originEventId',
      'metadataJson',
    ]))

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['gc_channels', 'gc_channel_members']))

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>
    expect(indexes.map(i => i.name)).toEqual(expect.arrayContaining([
      'idx_gc_messages_channel',
      'idx_gc_messages_thread',
      'idx_gc_channels_room',
      'idx_gc_channel_members_actor',
    ]))
  })

  it('migrates legacy message rows to public defaults and adds indexes', () => {
    db.exec(`CREATE TABLE gc_messages (
      id TEXT PRIMARY KEY,
      roomId TEXT NOT NULL,
      senderId TEXT NOT NULL,
      senderName TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    )`)
    db.prepare('INSERT INTO gc_messages (id, roomId, senderId, senderName, content, timestamp, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('msg-1', 'room-1', 'alice', 'Alice', 'hello', 1, 'user')

    initAllHermesTables()

    const row = db.prepare('SELECT id, channelId, visibility, audienceJson, scope, metadataJson FROM gc_messages WHERE id = ?')
      .get('msg-1') as any
    expect(row).toMatchObject({
      id: 'msg-1',
      channelId: 'public',
      visibility: 'public',
      audienceJson: '[]',
      scope: 'conversation',
      metadataJson: '{}',
    })

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>
    expect(indexes.map(i => i.name)).toEqual(expect.arrayContaining(['idx_gc_messages_channel', 'idx_gc_messages_thread']))
  })

  it('ensures a room-scoped public channel idempotently', () => {
    initAllHermesTables()
    const store = new ChannelStore()

    const first = store.ensureDefaultPublicChannel('room-1', 'gc:room-1:system')
    const second = store.ensureDefaultPublicChannel('room-1', 'gc:room-1:system')
    const otherRoom = store.ensureDefaultPublicChannel('room-2', 'gc:room-2:system')

    expect(second.id).toBe(first.id)
    expect(store.listChannels('room-1')).toHaveLength(1)
    expect(first).toMatchObject({ roomId: 'room-1', id: 'public', kind: 'public', defaultVisibility: 'public' })
    expect(otherRoom).toMatchObject({ roomId: 'room-2', id: 'public' })
  })

  it('creates private task and agent channels with members and metadata', () => {
    initAllHermesTables()
    const store = new ChannelStore()
    store.ensureDefaultPublicChannel('room-1')

    const channel = store.createChannel({
      roomId: 'room-1',
      id: 'task-1',
      kind: 'task',
      name: 'Task 1',
      createdBy: 'gc:room-1:human:alice',
      members: [
        { actorId: 'gc:room-1:human:alice', canRead: true, canWrite: true, canInvite: true },
        { actorId: 'gc:room-1:agent:worker', canRead: true, canWrite: true },
      ],
      metadata: { ticket: 123 },
    })

    expect(channel).toMatchObject({ id: 'task-1', roomId: 'room-1', kind: 'task', defaultVisibility: 'private', metadata: { ticket: 123 } })
    expect(store.listChannelMembers('room-1', 'task-1')).toEqual([
      expect.objectContaining({ actorId: 'gc:room-1:agent:worker', canRead: true, canWrite: true, canInvite: false }),
      expect.objectContaining({ actorId: 'gc:room-1:human:alice', canRead: true, canWrite: true, canInvite: true }),
    ])
  })

  it('deletes room channels and channel memberships together', () => {
    initAllHermesTables()
    const store = new ChannelStore()
    store.ensureDefaultPublicChannel('room-1')
    store.createChannel({
      roomId: 'room-1',
      id: 'private-1',
      kind: 'private',
      name: 'Private',
      createdBy: 'alice',
      members: [{ actorId: 'alice', canRead: true, canWrite: true }],
    })

    store.deleteRoomChannels('room-1')

    expect(store.listChannels('room-1')).toEqual([])
    expect(store.listChannelMembers('room-1', 'private-1')).toEqual([])
  })
})
