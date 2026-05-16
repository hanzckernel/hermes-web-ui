import type MarkdownIt from 'markdown-it'
import { tex } from '@mdit/plugin-tex'
import katex from 'katex'

export type MathRenderEnv = {
  mathHtml: string[]
  mathCount: number
}

const MATH_PLACEHOLDER_PREFIX = '<!--hermes-math-'
const MATH_PLACEHOLDER_SUFFIX = '-->'
const MAX_MATH_PER_RENDER = 64
const MAX_INLINE_MATH_LENGTH = 2_000
const MAX_DISPLAY_MATH_LENGTH = 8_000

const katexOptions = {
  throwOnError: true,
  trust: false,
  strict: 'ignore' as const,
  maxSize: 12,
  maxExpand: 1_000,
  macros: {},
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function reserveMathHtml(env: MathRenderEnv, html: string): string {
  const index = env.mathHtml.length
  env.mathHtml.push(html)
  return `${MATH_PLACEHOLDER_PREFIX}${index}${MATH_PLACEHOLDER_SUFFIX}`
}

function getEnv(rawEnv: unknown): MathRenderEnv {
  const env = rawEnv as Partial<MathRenderEnv>
  if (!Array.isArray(env.mathHtml)) env.mathHtml = []
  if (typeof env.mathCount !== 'number') env.mathCount = 0
  return env as MathRenderEnv
}

function mathFallback(content: string, displayMode: boolean): string {
  const className = displayMode ? 'math-fallback math-fallback-display' : 'math-fallback'
  const tag = displayMode ? 'div' : 'span'
  return `<${tag} class="${className}">${escapeHtml(content)}</${tag}>`
}

function literalMath(content: string, displayMode: boolean): string {
  return mathFallback(displayMode ? `$$\n${content}\n$$` : `$${content}$`, displayMode)
}

function escapedLiteralMath(content: string, displayMode: boolean): string {
  return escapeHtml(displayMode ? `$$\n${content}\n$$` : `$${content}$`)
}

function looksLikeShellDollarReference(content: string): boolean {
  const normalized = content.trim()
  return /^[A-Z_][A-Z0-9_]*\/$/.test(normalized)
    || /^[A-Z_][A-Z0-9_]*(\/[A-Z_][A-Z0-9_]*)+$/.test(normalized)
    || /^\d+(?:\.\d+)?(?:[\s.,;:!?]|$)/.test(normalized)
    || /^[@<*?]$/.test(normalized)
}

function renderMath(content: string, displayMode: boolean, rawEnv: unknown): string {
  const env = getEnv(rawEnv)

  if (!displayMode && looksLikeShellDollarReference(content)) {
    return reserveMathHtml(env, escapedLiteralMath(content, displayMode))
  }

  env.mathCount += 1

  if (env.mathCount > MAX_MATH_PER_RENDER) {
    return reserveMathHtml(env, literalMath(content, displayMode))
  }

  const maxLength = displayMode ? MAX_DISPLAY_MATH_LENGTH : MAX_INLINE_MATH_LENGTH
  if (content.length > maxLength) {
    return reserveMathHtml(env, literalMath(content, displayMode))
  }

  try {
    const html = katex.renderToString(content, {
      ...katexOptions,
      displayMode,
      macros: {},
    })
    return reserveMathHtml(env, html)
  } catch {
    return reserveMathHtml(env, mathFallback(content, displayMode))
  }
}

type OpenFence = {
  marker: string
  length: number
  rest: string
}

function parseFenceLine(line: string): OpenFence | null {
  const fence = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/)
  if (!fence) return null
  return { marker: fence[2][0], length: fence[2].length, rest: fence[3] }
}

function isClosingFence(candidate: OpenFence, opener: OpenFence): boolean {
  return candidate.marker === opener.marker
    && candidate.length >= opener.length
    && candidate.rest.trim() === ''
}

function isValidOpeningFence(candidate: OpenFence): boolean {
  return candidate.marker !== '`' || !candidate.rest.includes('`')
}

type OpenDisplayDollarMath = {
  openerLine: number
  displayLeadingContentLines: number[]
}

function findDisplayDollarOpener(line: string): RegExpMatchArray | null {
  return line.match(/^( {0,3})\$\$(.*)$/)
}

function closesDisplayDollarOnSameLine(rest: string): boolean {
  return /\S[\s\S]*\$\$\s*$/.test(rest)
}

function isDisplayDollarCloseLine(rest: string): boolean {
  return rest.trim() === '' || closesDisplayDollarOnSameLine(rest)
}

function protectUnclosedDisplayDollarMath(content: string): string {
  if (!content.includes('$$')) return content

  const lines = content.split('\n')
  const output = [...lines]
  let openFence: OpenFence | null = null
  const openDisplayDollarMath: OpenDisplayDollarMath[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fence = parseFenceLine(line)
    if (fence) {
      if (!openFence && isValidOpeningFence(fence)) {
        openFence = fence
      } else if (openFence && isClosingFence(fence, openFence)) {
        openFence = null
      }
      continue
    }

    if (openFence) continue

    const displayOpener = findDisplayDollarOpener(line)
    if (displayOpener) {
      const rest = displayOpener[2]
      const currentOpen = openDisplayDollarMath.at(-1)
      if (currentOpen) {
        if (isDisplayDollarCloseLine(rest)) {
          openDisplayDollarMath.pop()
        } else {
          currentOpen.displayLeadingContentLines.push(i)
        }
      } else if (!closesDisplayDollarOnSameLine(rest)) {
        openDisplayDollarMath.push({ openerLine: i, displayLeadingContentLines: [] })
      }
      continue
    }

    if (openDisplayDollarMath.length > 0 && /\$\$\s*$/.test(line)) {
      openDisplayDollarMath.pop()
    }
  }

  for (const openMath of openDisplayDollarMath) {
    output[openMath.openerLine] = output[openMath.openerLine].replace('$$', '\\$\\$')
    for (const index of openMath.displayLeadingContentLines) {
      output[index] = output[index].replace('$$', '\\$\\$')
    }
  }

  return output.join('\n')
}

export function prepareMathMarkdown(content: string): string {
  return protectUnclosedDisplayDollarMath(content)
}

export function createMathRenderEnv(): MathRenderEnv {
  return { mathHtml: [], mathCount: 0 }
}

export function restoreMathPlaceholders(html: string, env: MathRenderEnv): string {
  return html.replace(/<!--hermes-math-(\d+)-->/g, (placeholder, index) => {
    return env.mathHtml[Number(index)] ?? placeholder
  })
}

export function installMathRenderer(md: MarkdownIt): void {
  md.use(tex, {
    delimiters: 'all',
    allowInlineWithSpace: false,
    mathFence: false,
    render: renderMath,
  })
}

export const MATH_RENDER_LIMITS = {
  maxMathPerRender: MAX_MATH_PER_RENDER,
  maxInlineMathLength: MAX_INLINE_MATH_LENGTH,
  maxDisplayMathLength: MAX_DISPLAY_MATH_LENGTH,
}
