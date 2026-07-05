import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectGroupChatClient,
  createTestGroupChatServer,
  emitAck,
  once,
} from './group-chat-test-helpers'
import type { GroupChatServer } from '../../packages/server/src/services/hermes/group-chat'
import { GROUP_CHAT_AGENT_SOCKET_SECRET } from '../../packages/server/src/services/hermes/group-chat/agent-clients'

describe('group chat approval and context baseline', () => {
  let harness: Awaited<ReturnType<typeof createTestGroupChatServer>>
  let groupServer: GroupChatServer
  let port: number

  beforeEach(async () => {
    vi.clearAllMocks()
    harness = await createTestGroupChatServer()
    groupServer = harness.groupServer
    port = harness.port
    groupServer.getStorage().saveRoom('room-1', 'Room 1', 'ROOM1')
  })

  afterEach(() => {
    harness?.cleanup()
  })

  async function joinPair() {
    groupServer.getStorage().addRoomAgent('room-1', 'agent-1', 'default', 'Agent', '', 1)
    const agent = await connectGroupChatClient(port, 'agent-1', 'Agent', { source: 'agent', agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET })
    const human = await connectGroupChatClient(port, 'human-1', 'Human')
    harness.sockets.push(agent, human)
    await emitAck(agent, 'join', { roomId: 'room-1' })
    await emitAck(human, 'join', { roomId: 'room-1' })
    return { agent, human }
  }

  it('relays context status and updates room token count', async () => {
    const { agent, human } = await joinPair()
    const statusEvent = once<any>(human, 'context_status')
    const roomUpdated = once<any>(human, 'room_updated')

    agent.emit('context_status', { roomId: 'room-1', agentName: 'Agent', status: 'replying', totalTokens: 123 })

    expect(await statusEvent).toEqual({ roomId: 'room-1', agentName: 'Agent', status: 'replying' })
    expect(await roomUpdated).toEqual({ roomId: 'room-1', totalTokens: 123 })
    expect(groupServer.getStorage().getRoom('room-1')).toMatchObject({ totalTokens: 123 })
  })

  it('clears ready context status from join recovery', async () => {
    const { agent } = await joinPair()
    agent.emit('context_status', { roomId: 'room-1', agentName: 'Agent', status: 'replying' })
    agent.emit('context_status', { roomId: 'room-1', agentName: 'Agent', status: 'ready' })

    const lateJoiner = await connectGroupChatClient(port, 'human-2', 'Late')
    harness.sockets.push(lateJoiner)
    const joined = await emitAck<any>(lateJoiner, 'join', { roomId: 'room-1' })

    expect(joined.contextStatuses).toEqual([])
  })

  it('relays approval requested with default choices', async () => {
    const { agent, human } = await joinPair()
    const requested = once<any>(human, 'approval.requested')

    agent.emit('approval.requested', {
      roomId: 'room-1',
      agentName: 'Agent',
      approval_id: 'approval-1',
      command: 'touch file',
      description: 'needs approval',
    })

    expect(await requested).toMatchObject({
      event: 'approval.requested',
      roomId: 'room-1',
      agentName: 'Agent',
      approval_id: 'approval-1',
      choices: ['once', 'session', 'deny'],
    })
  })

  it('uses socket identity for stream starts', async () => {
    const { agent, human } = await joinPair()
    const started = once<any>(human, 'message_stream_start')

    agent.emit('message_stream_start', {
      roomId: 'room-1',
      id: 'trusted-stream',
      senderId: 'human-1',
      senderName: 'Human',
    })

    expect(await started).toMatchObject({
      id: 'trusted-stream',
      senderId: 'agent-1',
      senderName: 'Agent',
    })
  })

  it('does not relay approval requests from agents without request capability', async () => {
    const { agent, human } = await joinPair()
    harness.db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 0, ?)')
      .run('gc:room-1:agent:agent-1', 'approval.request', Date.now())
    let sawRequest = false
    human.on('approval.requested', () => { sawRequest = true })

    agent.emit('approval.requested', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-disabled' })
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(sawRequest).toBe(false)
  })

  it('relays approval resolved with normalized choice', async () => {
    const { agent, human } = await joinPair()
    agent.emit('approval.requested', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-1' })
    await once<any>(human, 'approval.requested')
    const resolved = once<any>(human, 'approval.resolved')

    agent.emit('approval.resolved', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-1', choice: 'deny' })

    expect(await resolved).toEqual({
      event: 'approval.resolved',
      roomId: 'room-1',
      agentName: 'Agent',
      approval_id: 'approval-1',
      choice: 'deny',
    })
  })

  it('rejects approval responses from agent sockets without respond capability', async () => {
    const { agent, human } = await joinPair()
    agent.emit('approval.requested', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-agent-denied' })
    await once<any>(human, 'approval.requested')

    await expect(emitAck(agent, 'approval.respond', { roomId: 'room-1', approval_id: 'approval-agent-denied', choice: 'once' })).resolves.toEqual({ error: 'Cannot respond to approval' })
  })

  it('rejects approval responses outside the advertised choices', async () => {
    const { agent, human } = await joinPair()
    agent.emit('approval.requested', {
      roomId: 'room-1',
      agentName: 'Agent',
      approval_id: 'approval-no-always',
      choices: ['once', 'session', 'deny'],
      allow_permanent: false,
    })
    await once<any>(human, 'approval.requested')

    await expect(emitAck(human, 'approval.respond', { roomId: 'room-1', approval_id: 'approval-no-always', choice: 'always' })).resolves.toEqual({ error: 'Approval choice not allowed' })
  })

  it('only lets the requesting agent resolve its approval', async () => {
    const { agent, human } = await joinPair()
    groupServer.getStorage().addRoomAgent('room-1', 'agent-2', 'default', 'Other Agent', '', 1)
    const other = await connectGroupChatClient(port, 'agent-2', 'Other Agent', { source: 'agent', agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET })
    harness.sockets.push(other)
    await emitAck(other, 'join', { roomId: 'room-1' })

    agent.emit('approval.requested', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-owned' })
    await once<any>(human, 'approval.requested')
    let resolvedByOther = false
    human.on('approval.resolved', (event: any) => {
      if (event.approval_id === 'approval-owned') resolvedByOther = true
    })

    other.emit('approval.requested', { roomId: 'room-1', agentName: 'Other Agent', approval_id: 'approval-owned' })
    other.emit('approval.resolved', { roomId: 'room-1', agentName: 'Other Agent', approval_id: 'approval-owned', choice: 'deny' })
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(resolvedByOther).toBe(false)

    const resolved = once<any>(human, 'approval.resolved')
    agent.emit('approval.resolved', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-owned', choice: 'deny' })
    expect(await resolved).toMatchObject({ approval_id: 'approval-owned', agentName: 'Agent', choice: 'deny' })
  })

  it('rejects approval responses from sockets that have not joined the room', async () => {
    const outsider = await connectGroupChatClient(port, 'outsider', 'Outsider')
    harness.sockets.push(outsider)

    await expect(emitAck(outsider, 'approval.respond', { roomId: 'room-1', approval_id: 'approval-1', choice: 'deny' })).resolves.toEqual({ error: 'Not in room' })
  })

  it('emits room_cleared and room_updated when runtime state is cleared', async () => {
    const { human } = await joinPair()
    const cleared = once<any>(human, 'room_cleared')
    const updated = once<any>(human, 'room_updated')

    groupServer.clearRoomRuntimeState('room-1')

    expect(await cleared).toEqual({ roomId: 'room-1', totalTokens: 0 })
    expect(await updated).toEqual({ roomId: 'room-1', totalTokens: 0 })
  })
})
