// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, source: string) => ({
    svg: `<svg id="${id}" data-testid="mermaid-svg"><text>${source}</text></svg>`,
  })),
}))

vi.mock('mermaid', () => ({
  default: mermaidMock,
}))

async function flushMermaidRender(): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    await nextTick()
    await Promise.resolve()
  }
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/api/hermes/download', () => ({
  downloadFile: vi.fn(),
  getDownloadUrl: (path: string) => `http://test.local/api/hermes/download?path=${encodeURIComponent(path)}`,
}))

import MarkdownRenderer from '@/components/hermes/chat/MarkdownRenderer.vue'
import { MATH_RENDER_LIMITS } from '@/components/hermes/chat/mathRenderer'

describe('MarkdownRenderer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    mermaidMock.initialize.mockClear()
    mermaidMock.render.mockClear()
    mermaidMock.render.mockImplementation(async (id: string, source: string) => ({
      svg: `<svg id="${id}" data-testid="mermaid-svg"><text>${source}</text></svg>`,
    }))

    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('highlights vue fenced blocks instead of rendering them as plain text', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```vue\n<template><div>Hello</div></template>\n```',
      },
    })

    expect(wrapper.find('.code-lang').text()).toBe('vue')
    expect(wrapper.find('code.hljs').html()).toContain('hljs-tag')
  })

  it('keeps shell-session fences on the shell grammar', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```shell\n$ ls\nfoo.txt\n```',
      },
    })

    expect(wrapper.find('.code-lang').text()).toBe('shell')
    expect(wrapper.find('code.hljs').html()).toContain('hljs-meta')
  })

  it('still highlights long supported code fences', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: `\`\`\`json\n${JSON.stringify({ content: 'x'.repeat(2500), ok: true })}\n\`\`\``,
      },
    })

    expect(wrapper.find('.code-lang').text()).toBe('json')
    expect(wrapper.find('code.hljs').html()).toMatch(/hljs-(attr|string|punctuation)/)
  })

  it('falls back to plain escaped text when a fence language is unsupported', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```foobar\n{"answer":42,"ok":true}\n```',
      },
    })

    expect(wrapper.find('.code-lang').text()).toBe('foobar')
    expect(wrapper.find('code.hljs').findAll('span')).toHaveLength(0)
    expect(wrapper.find('code.hljs').text()).toContain('{"answer":42,"ok":true}')
  })

  it('keeps unlabeled code fences as plain text instead of guessing a grammar', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```\nINFO Starting server\nConnected to 127.0.0.1\nDone\n```',
      },
    })

    expect(wrapper.find('.code-lang').text()).toBe('text')
    expect(wrapper.find('code.hljs').findAll('span')).toHaveLength(0)
    expect(wrapper.find('code.hljs').text()).toContain('INFO Starting server')
  })

  it('renders outer markdown draft fences as markdown while preserving nested fenced examples', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '下面是可直接手动编辑的 PR draft。',
          '',
          '```md',
          '标题: fix(chat): 保留附件在同一聊天后续轮次的上下文',
          '',
          '## Summary',
          '',
          '附件上传后，首轮 `startRun()` 的 `input` 已包含上传文件引用:',
          '',
          '```md',
          '[File: screenshot.png](/uploaded/path)',
          '```',
          '',
          '但本地保存的用户消息只保留 UI 可见文本。',
          '',
          '## Fix',
          '- Preserve context.',
          '```',
        ].join('\n'),
      },
    })

    expect(wrapper.findAll('.hljs-code-block')).toHaveLength(1)
    expect(wrapper.find('.code-lang').text()).toBe('md')
    expect(wrapper.find('code.hljs').text()).toContain('[File: screenshot.png](/uploaded/path)')
    expect(wrapper.find('.markdown-body').findAll('h2')).toHaveLength(2)
    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Summary')
    expect(wrapper.find('.markdown-body').text()).toContain('但本地保存的用户消息只保留 UI 可见文本。')
    expect(wrapper.find('.markdown-body').text()).toContain('Preserve context.')
  })

  it('keeps markdown examples with their own nested fences intact after unwrapping a draft fence', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '```md',
          '## Regression Coverage',
          '',
          '```md',
          '下面是一个 PR draft。',
          '',
          '```md',
          '[File: Screenshot.png](/tmp/example.png)',
          '```',
          '',
          '## Fix',
          '',
          '- 后续 heading 不应被截断。',
          '```',
          '',
          '## Local Verification',
          '',
          '- localhost renders after the example.',
          '```',
        ].join('\n'),
      },
    })

    const headings = wrapper.find('.markdown-body').findAll('h2').map(heading => heading.text())
    expect(headings).toEqual(['Regression Coverage', 'Local Verification'])
    expect(wrapper.findAll('.hljs-code-block')).toHaveLength(1)

    const codeText = wrapper.find('code.hljs').text()
    expect(codeText).toContain('下面是一个 PR draft。')
    expect(codeText).toContain('```md\n[File: Screenshot.png](/tmp/example.png)\n```')
    expect(codeText).toContain('## Fix')
    expect(codeText).toContain('- 后续 heading 不应被截断。')
    expect(wrapper.find('.markdown-body').text()).toContain('localhost renders after the example.')
  })

  it('keeps markdown examples with unlabeled nested fences intact', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '```md',
          '## Unlabeled Fence Example',
          '',
          '```md',
          '```',
          'plain nested block',
          '```',
          '```',
          '',
          'Done outside.',
          '```',
        ].join('\n'),
      },
    })

    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Unlabeled Fence Example')
    expect(wrapper.findAll('.hljs-code-block')).toHaveLength(1)
    expect(wrapper.find('code.hljs').text()).toContain('```\nplain nested block\n```')
    expect(wrapper.find('.markdown-body').text()).toContain('Done outside.')
  })

  it('renders local mov links as inline video players', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '[录屏2026-05-08 15.19.46.mov](/Users/ekko/Desktop/录屏2026-05-08%2015.19.46.mov)',
      },
    })

    const video = wrapper.find('video.markdown-video')
    expect(video.exists()).toBe(true)
    expect(video.attributes('src')).toContain('/api/hermes/download?path=')
    const src = new URL(video.attributes('src'))
    expect(decodeURIComponent(src.searchParams.get('path') || '')).toBe('/Users/ekko/Desktop/录屏2026-05-08 15.19.46.mov')
    expect(wrapper.find('.markdown-video-footer .att-name').text()).toBe('录屏2026-05-08 15.19.46.mov')
  })

  it('keeps tilde-fenced markdown examples with nested tilde fences intact', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '```md',
          '## Tilde Example',
          '',
          '~~~md',
          '~~~yaml',
          'ok: true',
          '~~~',
          '~~~',
          '',
          'Done outside.',
          '```',
        ].join('\n'),
      },
    })

    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Tilde Example')
    expect(wrapper.findAll('.hljs-code-block')).toHaveLength(1)
    expect(wrapper.find('code.hljs').text()).toContain('~~~yaml\nok: true\n~~~')
    expect(wrapper.find('.markdown-body').text()).toContain('Done outside.')
  })

  it('keeps already-valid longer markdown example fences valid', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '```md',
          '## Longer Fence Example',
          '',
          '````md',
          '```ts',
          'const answer = 42',
          '```',
          '````',
          '',
          'Done outside.',
          '```',
        ].join('\n'),
      },
    })

    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Longer Fence Example')
    expect(wrapper.findAll('.hljs-code-block')).toHaveLength(1)
    expect(wrapper.find('code.hljs').text()).toContain('```ts\nconst answer = 42\n```')
    expect(wrapper.find('.markdown-body').text()).toContain('Done outside.')
  })

  it('renders inline and display math formulas with KaTeX', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          'Euler identity: $e^{i\\pi}+1=0$.',
          '',
          '$$',
          'E = mc^2',
          '$$',
        ].join('\n'),
      },
    })

    expect(wrapper.findAll('.katex').length).toBeGreaterThanOrEqual(2)
    expect(wrapper.find('.katex-display').exists()).toBe(true)
    expect(wrapper.find('.markdown-body').text()).toContain('Euler identity')
  })

  it('does not treat paragraph-level double dollars as inline math', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: 'Keep paragraph $$x+1$$ literal.',
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('.markdown-body').text()).toContain('$$x+1$$')
  })

  it('renders bracket-delimited math formulas', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: 'Inline \\(a+b\\) and block:\n\\[c+d\\]',
      },
    })

    expect(wrapper.findAll('.katex').length).toBeGreaterThanOrEqual(2)
    expect(wrapper.find('.katex-display').exists()).toBe(true)
  })

  it('falls back to readable text for malformed math while preserving surrounding markdown', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: 'Before $\\notacommand{}$ after **bold**',
      },
    })

    expect(wrapper.find('.math-fallback').exists()).toBe(true)
    expect(wrapper.find('.math-fallback').text()).toContain('\\notacommand')
    expect(wrapper.find('strong').text()).toBe('bold')
  })

  it('does not render math inside inline code or fenced code blocks', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          'Inline code `$x+1$` remains literal.',
          '',
          '```math',
          'E = mc^2',
          '```',
        ].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('code:not(.hljs)').text()).toBe('$x+1$')
    expect(wrapper.find('.hljs-code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('math')
  })

  it('renders math inside repaired outer markdown draft fences without parsing nested code examples', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '```md',
          '## Formula draft',
          '',
          'Inline $x^2$ renders.',
          '',
          '```md',
          'Literal math example: $y^2$',
          '```',
          '```',
        ].join('\n'),
      },
    })

    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Formula draft')
    expect(wrapper.findAll('.katex')).toHaveLength(1)
    expect(wrapper.find('code.hljs').text()).toContain('Literal math example: $y^2$')
  })

  it('keeps incomplete streaming display math readable instead of swallowing following markdown', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: ['Start', '$$', 'E = mc^2', '## Still heading'].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Still heading')
    expect(wrapper.find('.markdown-body').text()).toContain('E = mc^2')
  })

  it('keeps same-line incomplete display math readable', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: ['Start', '$$ E = mc^2', '## Still heading'].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Still heading')
    expect(wrapper.find('.markdown-body').text()).toContain('E = mc^2')
  })

  it('keeps incomplete bracket display math readable while streaming', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: ['Start', '\\[', 'E = mc^2', '## Still heading'].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Still heading')
    expect(wrapper.find('.markdown-body').text()).toContain('E = mc^2')
  })

  it('renders completed bracket display math after a streaming prop update', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: ['Start', '\\[', 'E = mc^2', '## Still heading'].join('\n'),
      },
    })

    await wrapper.setProps({
      content: ['Start', '\\[', 'E = mc^2', '\\]', '## Still heading'].join('\n'),
    })

    expect(wrapper.find('.katex-display').exists()).toBe(true)
    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Still heading')
  })

  it('keeps invalid streaming display close lines readable', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: ['Start', '$$', 'E = mc^2', '$$ not a valid close yet', '## Still heading'].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Still heading')
    expect(wrapper.find('.markdown-body').text()).toContain('not a valid close yet')
  })

  it('does not let invalid backtick fence openers hide unclosed display math', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: ['``` bad ` info', '$$', 'E = mc^2', '## Still heading'].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Still heading')
    expect(wrapper.find('.markdown-body').text()).toContain('E = mc^2')
  })

  it('does not escape display math markers inside longer fenced code blocks', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: ['`````md', '````js', '$$', 'not math', '````', '`````'].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('code.hljs').text()).toContain('$$')
    expect(wrapper.find('code.hljs').text()).toContain('not math')
  })

  it('falls back after the per-render math count limit', () => {
    const content = Array.from({ length: MATH_RENDER_LIMITS.maxMathPerRender + 2 }, (_, index) => `$x_{${index}}$`).join(' ')
    const wrapper = mount(MarkdownRenderer, {
      props: { content },
    })

    expect(wrapper.findAll('.katex')).toHaveLength(MATH_RENDER_LIMITS.maxMathPerRender)
    expect(wrapper.findAll('.math-fallback')).toHaveLength(2)
  })

  it('resets math count state between prop updates', async () => {
    const limitedContent = Array.from({ length: MATH_RENDER_LIMITS.maxMathPerRender + 1 }, (_, index) => `$x_{${index}}$`).join(' ')
    const wrapper = mount(MarkdownRenderer, {
      props: { content: limitedContent },
    })

    expect(wrapper.findAll('.math-fallback')).toHaveLength(1)

    await wrapper.setProps({ content: '$y+1$' })

    expect(wrapper.findAll('.katex')).toHaveLength(1)
    expect(wrapper.find('.math-fallback').exists()).toBe(false)
  })

  it('falls back for oversized inline and display math without breaking surrounding markdown', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          `Before $${'x'.repeat(MATH_RENDER_LIMITS.maxInlineMathLength + 1)}$ after`,
          '',
          '$$',
          'y'.repeat(MATH_RENDER_LIMITS.maxDisplayMathLength + 1),
          '$$',
          '',
          '**bold** still works.',
        ].join('\n'),
      },
    })

    expect(wrapper.findAll('.math-fallback')).toHaveLength(2)
    expect(wrapper.findAll('.katex')).toHaveLength(0)
    expect(wrapper.find('strong').text()).toBe('bold')
  })

  it('does not let KaTeX macro definitions leak between formulas', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '$\\gdef\\foo{x}$ then $\\foo$',
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(true)
    expect(wrapper.find('.math-fallback').exists()).toBe(true)
    expect(wrapper.find('.math-fallback').text()).toContain('\\foo')
  })

  it('does not treat common currency or shell dollar text as math', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          'Prices are USD $20 and $30 today.',
          'Do not create HTML from $20 <img src=x onerror=alert(1)> and $30.',
          'Run `export FOO=$BAR` or echo $PATH/$HOME.',
          'Use npm config set prefix $HOME/.npm-global.',
          'Make expands target $@ and first prerequisite $<.',
        ].join('\n'),
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.find('.math-fallback').exists()).toBe(false)
    const text = wrapper.find('.markdown-body').text()
    expect(text).toContain('USD $20 and $30')
    expect(text).toContain('$20 <img src=x onerror=alert(1)> and $30')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('<img')
    expect(text).toContain('$PATH/$HOME')
    expect(text).toContain('$HOME/.npm-global')
    expect(text).toContain('$@')
    expect(text).toContain('$<')
  })

  it('still renders numeric-leading inline formulas when they are not currency-like text', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: 'Math $2+2=4$ and $1/n$ should render.',
      },
    })

    expect(wrapper.findAll('.katex')).toHaveLength(2)
    expect(wrapper.find('.math-fallback').exists()).toBe(false)
  })

  it('protects rendered math from mention and local-link postprocessing', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        mentionNames: ['alice'],
        content: 'Formula $\\text{@alice /tmp/file.pdf}$ outside @alice now.',
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(true)
    expect(wrapper.findAll('.mention-highlight')).toHaveLength(1)
    expect(wrapper.find('.katex .mention-highlight').exists()).toBe(false)
    expect(wrapper.find('.markdown-file-card').exists()).toBe(false)
  })

  it('does not render trusted KaTeX links or HTML extensions as clickable HTML', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: 'Safe $x+1$ and unsafe $\\href{javascript:alert(1)}{x}$ plus $\\htmlClass{danger}{x}$',
      },
    })

    expect(wrapper.find('.katex').exists()).toBe(true)
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('class="danger"')
  })

  it('renders mermaid fences as diagrams instead of raw highlighted code', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '```mermaid',
          'flowchart TD',
          'A[User] --> B[Web UI<br/>command]',
          '```',
          '',
          '具体 behavior:',
          '- Markdown below still renders.',
        ].join('\n'),
      },
    })

    await flushMermaidRender()

    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
    }))
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.stringMatching(/^hermes-mermaid-/),
      expect.stringContaining('flowchart TD'),
    )
    expect(wrapper.find('[data-testid="mermaid-svg"]').exists()).toBe(true)
    expect(wrapper.findAll('.hljs-code-block')).toHaveLength(0)
    expect(wrapper.find('.markdown-body').find('ul').exists()).toBe(true)
  })

  it('renders mermaid inside repaired outer markdown draft fences', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: [
          '```md',
          '## Command flow',
          '',
          '```Mermaid title',
          'flowchart LR',
          'A --> B',
          '```',
          '',
          'Done outside.',
          '```',
        ].join('\n'),
      },
    })

    await flushMermaidRender()

    expect(wrapper.find('.markdown-body').find('h2').text()).toBe('Command flow')
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.stringMatching(/^hermes-mermaid-/),
      expect.stringContaining('flowchart LR'),
    )
    expect(wrapper.find('[data-testid="mermaid-svg"]').exists()).toBe(true)
    expect(wrapper.find('.markdown-body').text()).toContain('Done outside.')
  })

  it('falls back to a copyable code block when mermaid rendering fails', async () => {
    mermaidMock.render.mockImplementationOnce((id: string) => {
      const errorContainer = document.createElement('div')
      errorContainer.id = `d${id}`
      errorContainer.textContent = 'Syntax error in text\nmermaid version 11.14.0'
      document.body.appendChild(errorContainer)
      return Promise.reject(new Error('bad diagram'))
    })
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```mermaid\nnot valid mermaid\n```',
      },
    })

    await flushMermaidRender()

    expect(wrapper.find('[data-testid="mermaid-svg"]').exists()).toBe(false)
    expect(wrapper.find('.hljs-code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('mermaid')
    expect(wrapper.find('code.hljs').text()).toContain('not valid mermaid')
    expect(wrapper.find('[data-copy-code="true"]').exists()).toBe(true)
    expect(document.body.textContent).not.toContain('Syntax error in text')
  })

  it('falls back to copyable code blocks when mermaid initialization fails', async () => {
    mermaidMock.initialize.mockImplementationOnce(() => {
      throw new Error('init failed')
    })

    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```mermaid\nflowchart TD\nA --> B\n```',
      },
    })

    await flushMermaidRender()

    expect(mermaidMock.render).not.toHaveBeenCalled()
    expect(wrapper.find('.hljs-code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('mermaid')
    expect(wrapper.find('code.hljs').text()).toContain('flowchart TD')
  })

  it('falls back without initializing mermaid when every pending diagram is oversized', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: `\`\`\`mermaid\n${'A'.repeat(20_001)}\n\`\`\``,
      },
    })

    await flushMermaidRender()

    expect(mermaidMock.initialize).not.toHaveBeenCalled()
    expect(mermaidMock.render).not.toHaveBeenCalled()
    expect(wrapper.find('.hljs-code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('mermaid')
  })

  it('falls back without initializing mermaid when every pending diagram is empty', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```mermaid\n```',
      },
    })

    await flushMermaidRender()

    expect(mermaidMock.initialize).not.toHaveBeenCalled()
    expect(mermaidMock.render).not.toHaveBeenCalled()
    expect(wrapper.find('.hljs-code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('mermaid')
  })

  it('falls back to copyable code when mermaid rendering never settles', async () => {
    vi.useFakeTimers()
    mermaidMock.render.mockImplementationOnce(() => new Promise(() => {}))

    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```mermaid\nflowchart TD\nA --> B\n```',
      },
    })

    await nextTick()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_001)
    await flushMermaidRender()

    expect(wrapper.find('.mermaid-loading').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mermaid-svg"]').exists()).toBe(false)
    expect(wrapper.find('.hljs-code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('mermaid')
    expect(wrapper.find('code.hljs').text()).toContain('flowchart TD')
  })

  it('does not load or render mermaid when the message has no mermaid block', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```ts\nconst answer = 42\n```',
      },
    })

    await flushMermaidRender()

    expect(mermaidMock.initialize).not.toHaveBeenCalled()
    expect(mermaidMock.render).not.toHaveBeenCalled()
    expect(wrapper.find('.code-lang').text()).toBe('ts')
  })

  it('does not let stale async mermaid renders mutate newer message content', async () => {
    let resolveRender: ((value: { svg: string }) => void) | undefined
    mermaidMock.render.mockImplementationOnce((id: string) => new Promise(resolve => {
      resolveRender = resolve
    }))

    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```mermaid\nflowchart TD\nA --> B\n```',
      },
    })

    await nextTick()
    await wrapper.setProps({ content: 'No diagram now.' })
    resolveRender?.({ svg: '<svg data-testid="stale-mermaid-svg"></svg>' })
    await flushMermaidRender()

    expect(wrapper.find('[data-testid="stale-mermaid-svg"]').exists()).toBe(false)
    expect(wrapper.find('.markdown-body').text()).toContain('No diagram now.')
  })

  it('copies code through the delegated click handler', async () => {
    const writeText = vi.mocked(navigator.clipboard.writeText)
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```ts\nconst answer = 42\n```',
      },
    })

    const expected = wrapper.find('code.hljs').element.textContent ?? ''
    await wrapper.find('[data-copy-code="true"]').trigger('click')

    expect(writeText).toHaveBeenCalledWith(expected)
  })

  it('falls back to legacy clipboard copy when the Clipboard API is unavailable', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '```ts\nconst answer = 42\n```',
      },
    })

    await wrapper.find('[data-copy-code="true"]').trigger('click')

    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
