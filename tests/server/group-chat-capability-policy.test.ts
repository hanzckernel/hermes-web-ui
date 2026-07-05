import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const groupChatDbMock = vi.hoisted(() => ({ current: null as DatabaseSync | null }))

vi.mock('../../packages/server/src/db/index', () => ({ getDb: () => groupChatDbMock.current }))

import { initAllHermesTables } from '../../packages/server/src/db/hermes/schemas'
import { ActorStore } from '../../packages/server/src/services/hermes/group-chat/identity/actor-store'
import { CapabilityPolicy } from '../../packages/server/src/services/hermes/group-chat/identity/capability-policy'
import type { GroupActor } from '../../packages/server/src/services/hermes/group-chat/identity/types'

describe('group chat capability policy', () => {
  let db: DatabaseSync
  let actorStore: ActorStore
  let policy: CapabilityPolicy

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    groupChatDbMock.current = db
    initAllHermesTables()
    actorStore = new ActorStore()
    policy = new CapabilityPolicy()
  })

  afterEach(() => {
    db.close()
    groupChatDbMock.current = null
  })

  it('allows active humans to message, respond to approvals, and create private/task channels', () => {
    const human = actorStore.ensureHumanActor({ roomId: 'room-1', userId: 'user-1', displayName: 'Alice' })

    expect(policy.can(human, 'message.read')).toBe(true)
    expect(policy.can(human, 'message.write')).toBe(true)
    expect(policy.can(human, 'approval.respond')).toBe(true)
    expect(policy.canCreateChannel(human, 'private')).toBe(true)
    expect(policy.canCreateChannel(human, 'task')).toBe(true)
    expect(policy.canCreateChannel(human, 'public')).toBe(false)
  })

  it('allows agents to message, hand off, request approvals, and create artifacts', () => {
    const agent = actorStore.ensureAgentActor({
      roomId: 'room-1',
      agentId: 'agent-1',
      profile: 'default',
      displayName: 'Worker',
    })

    expect(policy.can(agent, 'message.read')).toBe(true)
    expect(policy.can(agent, 'message.write')).toBe(true)
    expect(policy.can(agent, 'agent.handoff')).toBe(true)
    expect(policy.can(agent, 'approval.request')).toBe(true)
    expect(policy.can(agent, 'artifact.create')).toBe(true)
    expect(policy.can(agent, 'channel.create.private')).toBe(false)
  })

  it('keeps system and tool read/write explicit while reserving public channel creation for system', () => {
    const system = actorStore.ensureSystemActor('room-1')
    const tool: GroupActor = {
      id: 'gc:room-1:tool:search',
      roomId: 'room-1',
      kind: 'tool',
      source: 'system',
      displayName: 'search',
      description: '',
      status: 'active',
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    }

    expect(policy.can(system, 'message.read')).toBe(false)
    expect(policy.canCreateChannel(system, 'public')).toBe(true)
    expect(policy.canCreateChannel(system, 'audit')).toBe(true)
    expect(policy.can(tool, 'message.write')).toBe(false)

    db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 1, ?)').run(tool.id, 'message.write', 1)
    expect(policy.can(tool, 'message.write')).toBe(true)
  })

  it('lets a disabled explicit capability override default allows', () => {
    const human = actorStore.ensureHumanActor({ roomId: 'room-1', userId: 'user-1', displayName: 'Alice' })
    db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 0, ?)').run(human.id, 'message.write', 1)

    expect(policy.can(human, 'message.write')).toBe(false)
  })
})
