// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createPinia, setActivePinia } from 'pinia'
import GroupChatPanel from '@/components/hermes/group-chat/GroupChatPanel.vue'
import { useGroupChatStore } from '@/stores/hermes/group-chat'

const groupChatApiMock = vi.hoisted(() => {
  const socket: any = {
    connected: true,
    on: vi.fn(() => socket),
    emit: vi.fn((event: string, _data?: any, ack?: Function) => {
      if (event === 'join' && ack) ack({ members: [], agents: [], actors: [], typingUsers: [], contextStatuses: [] })
      return socket
    }),
    disconnect: vi.fn(),
  }
  return {
    socket,
    connectGroupChat: vi.fn(() => socket),
    disconnectGroupChat: vi.fn(),
    getSocket: vi.fn(() => socket),
    getStoredUserId: vi.fn(() => 'user-1'),
    getStoredUserName: vi.fn(() => 'Alice'),
    createRoom: vi.fn(),
    listRooms: vi.fn(),
    getRoomDetail: vi.fn(),
    joinRoomByCode: vi.fn(),
    addAgent: vi.fn(),
    listAgents: vi.fn(),
    removeAgent: vi.fn(),
    cloneRoom: vi.fn(),
    deleteRoom: vi.fn(),
    clearRoomContext: vi.fn(),
    updateRoomConfig: vi.fn(),
    forceCompress: vi.fn(),
  }
})

vi.mock('@/api/hermes/group-chat', () => groupChatApiMock)
vi.mock('@/api/client', () => ({
  getApiKey: vi.fn(() => 'test-token'),
  getActiveProfileName: vi.fn(() => 'default'),
  getStoredUsername: vi.fn(() => 'Alice'),
  request: vi.fn(async () => ({ profiles: [] })),
}))
vi.mock('@/api/auth', () => ({ fetchCurrentUser: vi.fn(async () => { throw new Error('no auth') }) }))
vi.mock('@/api/hermes/download', () => ({ getDownloadUrl: vi.fn((path: string) => `/download?path=${path}`) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), resolve: vi.fn(() => ({ href: '/room' })) }) }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'groupChat.actorIdentity': 'Actor identity',
      'groupChat.actorKindHuman': 'Human',
      'groupChat.actorKindAgent': 'Agent',
      'groupChat.actorKindSystem': 'System',
      'groupChat.actorBackendHermes': 'Hermes',
      'groupChat.actorCapabilities': 'Capabilities',
      'groupChat.channels': 'Channels',
      'groupChat.channelKindPublic': 'Public',
      'groupChat.channelKindPrivate': 'Private',
      'groupChat.channelKindTask': 'Task',
      'groupChat.channelKindAgent': 'Agent',
      'groupChat.you': 'You',
      'groupChat.agents': 'Agents',
      'groupChat.addAgent': 'Add Agent',
      'groupChat.members': 'members',
    } as Record<string, string>)[key] || key,
  }),
}))
vi.mock('naive-ui', () => ({
  useMessage: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
  NInput: { template: '<input />' },
  NButton: { template: '<button type="button"><slot /></button>' },
  NSpace: { template: '<div><slot /></div>' },
  NSelect: { template: '<select />' },
  NPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
  NPopconfirm: { template: '<div><slot name="trigger" /><slot /></div>' },
  NInputNumber: { template: '<input />' },
  NDropdown: { template: '<div><slot /></div>' },
}))
vi.mock('@/components/hermes/group-chat/GroupMessageList.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/hermes/group-chat/GroupChatInput.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/hermes/profiles/ProfileAvatar.vue', () => ({ default: { template: '<span class="avatar">{{ name }}</span>', props: ['name'] } }))
vi.mock('@/components/layout/PageSidebarNav.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/layout/SettingsCircuitBadge.vue', () => ({ default: { template: '<div />' } }))

const actor = {
  id: 'gc:room-1:agent:agent-1',
  roomId: 'room-1',
  kind: 'agent',
  source: 'group-chat-agent',
  displayName: 'Worker',
  profile: 'default',
  agentKind: 'hermes',
  status: 'active',
  capabilities: ['message.read', 'agent.handoff'],
}

describe('group chat actor summaries', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
    groupChatApiMock.getRoomDetail.mockResolvedValue({
      room: { id: 'room-1', name: 'Room', inviteCode: 'ROOM1' },
      messages: [],
      agents: [],
      members: [],
      actors: [actor],
      total: 0,
      hasMore: false,
    })
  })

  it('stores actors from room detail and realtime join state', async () => {
    const store = useGroupChatStore()
    groupChatApiMock.socket.emit.mockImplementation((event: string, _data?: any, ack?: Function) => {
      if (event === 'join' && ack) ack({ roomName: 'Room', members: [], agents: [], actors: [actor], typingUsers: [], contextStatuses: [] })
      return groupChatApiMock.socket
    })

    await store.joinRoom('room-1')

    expect(store.actors).toEqual([actor])
  })

  it('renders read-only actor identity labels in the participant popover', () => {
    const pinia = createTestingPinia({ stubActions: false, createSpy: vi.fn })
    const store = useGroupChatStore()
    store.currentRoomId = 'room-1'
    store.roomName = 'Room'
    store.userName = 'Alice'
    store.agents = [{ id: 'row-agent', roomId: 'room-1', agentId: 'agent-1', profile: 'default', name: 'Worker', description: '', invited: 0 }]
    store.actors = [actor]

    const wrapper = mount(GroupChatPanel, {
      global: { plugins: [pinia], stubs: { Transition: false } },
    })

    expect(wrapper.text()).toContain('Actor identity')
    expect(wrapper.text()).toContain('Agent')
    expect(wrapper.text()).toContain('Hermes')
    expect(wrapper.text()).toContain('Capabilities')
  })

  it('renders visible channel tabs', () => {
    const pinia = createTestingPinia({ stubActions: false, createSpy: vi.fn })
    const store = useGroupChatStore()
    store.currentRoomId = 'room-1'
    store.roomName = 'Room'
    store.userName = 'Alice'
    store.channels = [
      { id: 'public', roomId: 'room-1', kind: 'public', name: 'Public', defaultVisibility: 'public' },
      { id: 'task-1', roomId: 'room-1', kind: 'task', name: 'Task', defaultVisibility: 'private' },
    ]
    store.activeChannelId = 'task-1'

    const wrapper = mount(GroupChatPanel, {
      global: { plugins: [pinia], stubs: { Transition: false } },
    })

    expect(wrapper.text()).toContain('Public')
    expect(wrapper.text()).toContain('Task')
  })
})
