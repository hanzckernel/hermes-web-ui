import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('group chat identity spoofing guards', () => {
  it('does not classify group chat agents by display name alone', () => {
    const source = readFileSync('packages/client/src/components/hermes/group-chat/GroupMessageItem.vue', 'utf8')

    expect(source).toContain('a.agentId === props.message.senderId')
    expect(source).not.toContain('a.name === props.message.senderName')
  })
})
