// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import GroupMessageItem from '@/components/hermes/group-chat/GroupMessageItem.vue'
import type { ChatMessage, RoomAgent } from '@/api/hermes/group-chat'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({ useMessage: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('@/stores/hermes/profiles', () => ({ useProfilesStore: () => ({ profiles: [] }) }))
vi.mock('@/components/hermes/profiles/ProfileAvatar.vue', () => ({
  default: { name: 'ProfileAvatar', props: ['name'], template: '<span class="avatar-stub">{{ name }}</span>' },
}))
vi.mock('@/components/hermes/chat/MarkdownRenderer.vue', () => ({
  default: { name: 'MarkdownRenderer', props: ['content'], template: '<span class="markdown-stub">{{ content }}</span>' },
}))
vi.mock('@/composables/useSpeech', () => ({
  useGlobalSpeech: () => ({
    isSupported: true,
    currentCustomMessageId: ref(null),
    isCustomPlaying: ref(false),
    isCustomPaused: ref(false),
    currentMessageId: ref(null),
    isPlaying: ref(false),
    isPaused: ref(false),
    speak: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}))
vi.mock('@/composables/useVoiceSettings', () => ({ useVoiceSettings: () => ({ provider: ref('edge') }) }))
vi.mock('@/api/hermes/download', () => ({ getDownloadUrl: (path: string) => path }))

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    roomId: 'room-1',
    senderId: 'human-1',
    senderName: 'Agent',
    content: 'hello',
    timestamp: 1,
    role: 'user',
    ...overrides,
  }
}

const agents: RoomAgent[] = [{
  id: 'row-agent-1',
  roomId: 'room-1',
  agentId: 'agent-1',
  profile: 'default',
  name: 'Agent',
  description: 'real agent',
  invited: 1,
}]

describe('group chat identity spoofing guards', () => {
  it('classifies agent messages by stable agent id, not spoofable display name', () => {
    const spoofedHuman = mount(GroupMessageItem, {
      props: { message: message(), agents },
    })
    expect(spoofedHuman.find('.group-message').classes()).not.toContain('agent')
    expect(spoofedHuman.find('.agent-desc').exists()).toBe(false)

    const realAgent = mount(GroupMessageItem, {
      props: { message: message({ senderId: 'agent-1', role: 'assistant' }), agents },
    })
    expect(realAgent.find('.group-message').classes()).toContain('agent')
    expect(realAgent.find('.agent-desc').text()).toBe('real agent')
  })
})
