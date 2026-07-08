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

  it('strips transfer fences from approval request text and metadata payloads', async () => {
    const { agent, human } = await joinPair()
    const requested = once<any>(human, 'approval.requested')

    agent.emit('approval.requested', {
      roomId: 'room-1',
      agentName: 'Agent',
      approval_id: 'approval-transfer-sanitize',
      command: `safe command\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_APPROVAL_COMMAND"}\n\`\`\``,
      description: `safe description\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_APPROVAL_DESCRIPTION"}\n\`\`\``,
      metadataJson: JSON.stringify({
        note: `safe metadata\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_APPROVAL_METADATA"}\n\`\`\``,
        transferCards: [{ content: 'SECRET_APPROVAL_CARD' }],
      }),
    })

    const payload = await requested
    expect(payload.command).toBe('safe command')
    expect(payload.description).toBe('safe description')
    expect(JSON.stringify(payload)).not.toContain('SECRET_APPROVAL_COMMAND')
    expect(JSON.stringify(payload)).not.toContain('SECRET_APPROVAL_DESCRIPTION')
    expect(JSON.stringify(payload)).not.toContain('SECRET_APPROVAL_METADATA')
    expect(JSON.stringify(payload)).not.toContain('SECRET_APPROVAL_CARD')
    expect(JSON.stringify(payload)).not.toContain('group-chat-transfer')
    const metadata = JSON.parse(payload.metadataJson)
    expect(metadata.note).toBe('safe metadata')
    expect(metadata.transferCards).toBeUndefined()
  })

  it('strips transfer fences from context status and approval resolved payloads', async () => {
    const { agent, human } = await joinPair()
    const statusEvent = once<any>(human, 'context_status')

    agent.emit('context_status', {
      roomId: 'room-1',
      agentName: 'Agent',
      status: `safe status\n\n\`\`\`group-chat-transfer\n{"type":"private_fact_create","content":"SECRET_STATUS"}\n\`\`\``,
    })

    const statusPayload = await statusEvent
    expect(statusPayload.status).toBe('safe status')
    expect(JSON.stringify(statusPayload)).not.toContain('SECRET_STATUS')
    expect(JSON.stringify(statusPayload)).not.toContain('group-chat-transfer')

    agent.emit('approval.requested', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-resolved-sanitize' })
    await once<any>(human, 'approval.requested')
    const resolved = once<any>(human, 'approval.resolved')
    agent.emit('approval.resolved', {
      roomId: 'room-1',
      agentName: 'Agent',
      approval_id: 'approval-resolved-sanitize',
      choice: `deny\n\n\`\`\`gc-transfer\n{"type":"private_fact_create","content":"SECRET_RESOLVED"}\n\`\`\``,
    })

    const resolvedPayload = await resolved
    expect(resolvedPayload.choice).toBe('deny')
    expect(JSON.stringify(resolvedPayload)).not.toContain('SECRET_RESOLVED')
    expect(JSON.stringify(resolvedPayload)).not.toContain('gc-transfer')
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

  it('rejects messages and stream starts from actors without message.write', async () => {
    const { agent, human } = await joinPair()
    harness.db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 0, ?)')
      .run('gc:room-1:human:human-1', 'message.write', Date.now())

    await expect(emitAck(human, 'message', { roomId: 'room-1', content: 'blocked' })).resolves.toEqual({ error: 'Cannot write to channel' })
    expect(groupServer.getStorage().getMessagesForContext('room-1')).toEqual([])

    harness.db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 0, ?)')
      .run('gc:room-1:agent:agent-1', 'message.write', Date.now())
    const started = once<any>(human, 'message_stream_start', 100)
    agent.emit('message_stream_start', { roomId: 'room-1', id: 'blocked-stream' })

    await expect(started).rejects.toThrow('timeout waiting for message_stream_start')
  })

  it('rejects typing and status events from actors without message.write', async () => {
    const { agent, human } = await joinPair()
    harness.db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 0, ?)')
      .run('gc:room-1:agent:agent-1', 'message.write', Date.now())
    const initialTokens = groupServer.getStorage().getRoom('room-1').totalTokens
    let sawTyping = false
    let sawStatus = false
    let sawRoomUpdated = false
    human.on('typing', () => { sawTyping = true })
    human.on('context_status', () => { sawStatus = true })
    human.on('room_updated', () => { sawRoomUpdated = true })

    agent.emit('typing', { roomId: 'room-1' })
    agent.emit('context_status', { roomId: 'room-1', agentName: 'Agent', status: 'replying', totalTokens: initialTokens + 999 })

    await new Promise(resolve => setTimeout(resolve, 120))
    expect(sawTyping).toBe(false)
    expect(sawStatus).toBe(false)
    expect(sawRoomUpdated).toBe(false)
    expect(groupServer.getStorage().getRoom('room-1').totalTokens).toBe(initialTokens)
  })

  it('does not expose realtime or context reads to actors without message.read', async () => {
    const { agent, human } = await joinPair()
    harness.db.prepare('INSERT INTO gc_actor_capabilities (actorId, capability, enabled, updatedAt) VALUES (?, ?, 0, ?)')
      .run('gc:room-1:agent:agent-1', 'message.read', Date.now())
    let sawHiddenMessage = false
    agent.on('message', () => { sawHiddenMessage = true })

    await expect(emitAck(human, 'message', { roomId: 'room-1', content: 'hidden public answer' })).resolves.toMatchObject({ id: expect.any(String) })

    await new Promise(resolve => setTimeout(resolve, 120))
    expect(sawHiddenMessage).toBe(false)
    expect(groupServer.getStorage().getVisibleMessagesForUI('room-1', 'gc:room-1:agent:agent-1')).toEqual([])
    expect(groupServer.getStorage().getVisibleMessagesForContext('room-1', 'gc:room-1:agent:agent-1')).toEqual([])
    expect(groupServer.getStorage().getVisibleMessagesForUI('room-1', null).map(message => message.content)).toEqual(['hidden public answer'])
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

  it('does not let another room claim a duplicate bridge approval id', async () => {
    const { agent, human } = await joinPair()
    groupServer.getStorage().saveRoom('room-2', 'Room 2', 'ROOM2')
    groupServer.getStorage().addRoomAgent('room-2', 'agent-2', 'default', 'Other Agent', '', 1)
    const otherAgent = await connectGroupChatClient(port, 'agent-2', 'Other Agent', { source: 'agent', agentSocketSecret: GROUP_CHAT_AGENT_SOCKET_SECRET })
    const otherHuman = await connectGroupChatClient(port, 'human-2', 'Other Human')
    harness.sockets.push(otherAgent, otherHuman)
    await emitAck(otherAgent, 'join', { roomId: 'room-2' })
    await emitAck(otherHuman, 'join', { roomId: 'room-2' })

    agent.emit('approval.requested', { roomId: 'room-1', agentName: 'Agent', approval_id: 'approval-shared' })
    await once<any>(human, 'approval.requested')
    otherAgent.emit('approval.requested', { roomId: 'room-2', agentName: 'Other Agent', approval_id: 'approval-shared' })
    await new Promise(resolve => setTimeout(resolve, 80))

    await expect(emitAck(otherHuman, 'approval.respond', { roomId: 'room-2', approval_id: 'approval-shared', choice: 'once' })).resolves.toEqual({ error: 'Approval not found' })
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
