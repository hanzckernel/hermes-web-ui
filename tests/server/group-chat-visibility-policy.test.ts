import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))
vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current, getStoragePath: () => ':memory:' }))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'
import { systemActorId } from '../../packages/server/src/services/hermes/group-chat/identity/actor-ids'
import { ChannelStore } from '../../packages/server/src/services/hermes/group-chat/visibility/channel-store'
import { VisibilityPolicy } from '../../packages/server/src/services/hermes/group-chat/visibility/visibility-policy'
import type { VisibleGroupMessage } from '../../packages/server/src/services/hermes/group-chat/visibility/types'

describe('group chat visibility policy', () => {
  let db: DatabaseSync
  let channels: ChannelStore
  let policy: VisibilityPolicy

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
    initAllHermesTables()
    channels = new ChannelStore()
    policy = new VisibilityPolicy(channels)
    channels.ensureDefaultPublicChannel('room-1')
  })

  afterEach(() => {
    db.close()
    groupChatDbMock.current = null
  })

  function message(overrides: Partial<VisibleGroupMessage> = {}): VisibleGroupMessage {
    return {
      id: 'msg-1',
      roomId: 'room-1',
      senderId: 'gc:room-1:human:alice',
      senderName: 'Alice',
      content: 'hello',
      timestamp: 1,
      role: 'user',
      channelId: 'public',
      visibility: 'public',
      audienceJson: '[]',
      scope: 'conversation',
      metadataJson: '{}',
      ...overrides,
    }
  }

  it('treats existing messages with missing advanced fields as public', () => {
    const legacy = message({ channelId: undefined, visibility: undefined, audienceJson: undefined, scope: undefined })

    expect(policy.canReadMessage('gc:room-1:human:bob', legacy)).toBe(true)
    expect(policy.canWriteChannel('gc:room-1:human:bob', 'room-1', 'public')).toBe(true)
  })

  it('shows public messages to every room actor', () => {
    expect(policy.canReadMessage('gc:room-1:human:bob', message())).toBe(true)
    expect(policy.canReadMessage('gc:room-1:agent:worker', message())).toBe(true)
  })

  it('restricts public-channel audience-scoped messages to the audience', () => {
    const audienceMessage = message({ audienceJson: JSON.stringify(['gc:room-1:human:alice']) })

    expect(policy.canReadMessage('gc:room-1:human:alice', audienceMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:bob', audienceMessage)).toBe(false)
    expect(policy.canReadMessage('gc:room-1:agent:worker', audienceMessage)).toBe(false)
  })

  it('shows private messages only to sender, system, explicit audience, or channel readers', () => {
    channels.createChannel({
      roomId: 'room-1',
      id: 'private-1',
      kind: 'private',
      name: 'Private',
      createdBy: 'gc:room-1:human:alice',
      members: [{ actorId: 'gc:room-1:human:carol', canRead: true, canWrite: false }],
    })
    const privateMessage = message({
      channelId: 'private-1',
      visibility: 'private',
      audienceJson: JSON.stringify(['gc:room-1:human:bob']),
    })

    expect(policy.canReadMessage('gc:room-1:human:alice', privateMessage)).toBe(true)
    expect(policy.canReadMessage(systemActorId('room-1'), privateMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:bob', privateMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:carol', privateMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:dave', privateMessage)).toBe(false)
  })

  it('hides agent-only messages from humans unless explicitly allowed', () => {
    const agentMessage = message({
      senderId: 'gc:room-1:agent:worker',
      visibility: 'agent-only',
      audienceJson: JSON.stringify(['gc:room-1:human:alice']),
    })

    expect(policy.canReadMessage('gc:room-1:agent:reviewer', agentMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:alice', agentMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:bob', agentMessage)).toBe(false)
  })

  it('does not leak private-channel agent-only messages to non-member agents', () => {
    channels.createChannel({
      roomId: 'room-1',
      id: 'private-1',
      kind: 'private',
      name: 'Private',
      createdBy: 'gc:room-1:human:alice',
      members: [
        { actorId: 'gc:room-1:agent:worker', canRead: true, canWrite: true },
        { actorId: 'gc:room-1:human:bob', canRead: true, canWrite: true },
      ],
    })
    const privateAgentMessage = message({ channelId: 'private-1', visibility: 'agent-only' })

    expect(policy.canReadMessage('gc:room-1:agent:worker', privateAgentMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:agent:reviewer', privateAgentMessage)).toBe(false)
    expect(policy.canReadMessage('gc:room-1:human:bob', privateAgentMessage)).toBe(false)
  })

  it('limits task channels to participants', () => {
    channels.createChannel({
      roomId: 'room-1',
      id: 'task-1',
      kind: 'task',
      name: 'Task',
      createdBy: 'gc:room-1:human:alice',
      members: [{ actorId: 'gc:room-1:agent:worker', canRead: true, canWrite: true }],
    })
    const taskMessage = message({ channelId: 'task-1', visibility: 'private', scope: 'task' })

    expect(policy.canReadMessage('gc:room-1:agent:worker', taskMessage)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:bob', taskMessage)).toBe(false)
    expect(policy.canWriteChannel('gc:room-1:agent:worker', 'room-1', 'task-1')).toBe(true)
    expect(policy.canWriteChannel('gc:room-1:human:bob', 'room-1', 'task-1')).toBe(false)
  })

  it('fails closed for invalid private audience metadata', () => {
    const invalid = message({ visibility: 'private', audienceJson: '{bad-json' })

    expect(policy.resolveAudience(invalid)).toEqual([])
    expect(policy.canReadMessage('gc:room-1:human:alice', invalid)).toBe(true)
    expect(policy.canReadMessage(systemActorId('room-1'), invalid)).toBe(true)
    expect(policy.canReadMessage('gc:room-1:human:bob', invalid)).toBe(false)
    expect(policy.canReadMessage('gc:room-1:agent:worker', invalid)).toBe(false)
  })
})
