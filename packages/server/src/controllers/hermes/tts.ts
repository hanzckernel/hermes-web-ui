import type { Context } from 'koa'
import { textToSpeech, openaiCompatibleTts, speedToEdgeRate } from '../../services/hermes/tts'
import { getTtsProvider } from '../../services/hermes/tts-providers'
import {
  assertStoredTtsProvider,
  clearStoredTtsSecret,
  getTtsProviderSetting,
  isStoredTtsProvider,
  listTtsProviderSettings,
  removeTtsBaseUrlPreset,
  saveTtsProviderSetting,
  TtsSettingsValidationError,
} from '../../db/hermes/tts-settings-store'

function currentUserId(ctx: Context): number | null {
  const rawUserId = ctx.state?.user?.id
  const userId = typeof rawUserId === 'number' ? rawUserId : Number.NaN
  return Number.isInteger(userId) && userId > 0 ? userId : null
}

function authUserId(ctx: Context): number | null {
  const userId = currentUserId(ctx)
  if (!userId) {
    ctx.status = 401
    ctx.body = { error: 'Unauthorized' }
    return null
  }
  return userId
}

function handleSettingsError(ctx: Context, error: unknown): boolean {
  if (error instanceof TtsSettingsValidationError) {
    ctx.status = 400
    ctx.body = { error: error.message }
    return true
  }
  return false
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function mergeStoredTtsOptions(ctx: Context, providerName: string, options: Record<string, unknown>): Record<string, unknown> {
  const userId = currentUserId(ctx)
  if (!userId || !isStoredTtsProvider(providerName)) {
    return options
  }

  const stored = getTtsProviderSetting(userId, providerName, { includeSecrets: true })
  if (!stored) return options

  const requestOptions = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== '' && value !== undefined && value !== null),
  )

  return {
    ...stored.settings,
    ...stored.secrets,
    ...requestOptions,
  }
}

export async function listSettings(ctx: Context) {
  const userId = authUserId(ctx)
  if (!userId) return

  try {
    ctx.body = {
      settings: listTtsProviderSettings(userId),
    }
  } catch (error) {
    if (handleSettingsError(ctx, error)) return
    throw error
  }
}

export async function saveSettings(ctx: Context) {
  const userId = authUserId(ctx)
  if (!userId) return

  const provider = ctx.params.provider || ''
  const body = ctx.request.body as { settings?: unknown; secrets?: unknown } | undefined

  try {
    const setting = saveTtsProviderSetting(userId, assertStoredTtsProvider(provider), {
      settings: body?.settings,
      secrets: body?.secrets,
    })
    ctx.body = { setting }
  } catch (error) {
    if (handleSettingsError(ctx, error)) return
    throw error
  }
}

export async function deleteBaseUrlPreset(ctx: Context) {
  const userId = authUserId(ctx)
  if (!userId) return

  const provider = ctx.params.provider || ''
  const rawUrl = typeof ctx.query.url === 'string' ? ctx.query.url : ''
  if (!rawUrl.trim()) {
    ctx.status = 400
    ctx.body = { error: 'baseUrl is required' }
    return
  }

  try {
    const setting = removeTtsBaseUrlPreset(userId, assertStoredTtsProvider(provider), rawUrl)
    ctx.body = { success: true, setting }
  } catch (error) {
    if (handleSettingsError(ctx, error)) return
    throw error
  }
}

export async function deleteSecret(ctx: Context) {
  const userId = authUserId(ctx)
  if (!userId) return

  const provider = ctx.params.provider || ''
  const secretName = ctx.params.secretName || ''

  try {
    const setting = clearStoredTtsSecret(userId, assertStoredTtsProvider(provider), secretName)
    ctx.body = { success: true, setting }
  } catch (error) {
    if (handleSettingsError(ctx, error)) return
    throw error
  }
}

export async function generate(ctx: Context) {
  const { text, lang } = ctx.request.body as {
    text?: string
    lang?: string
  }

  if (!text || typeof text !== 'string') {
    ctx.status = 400
    ctx.body = { error: 'text is required' }
    return
  }

  if (text.length > 5000) {
    ctx.status = 400
    ctx.body = { error: 'text is too long (max 5000 characters)' }
    return
  }

  const { audio, engine } = await textToSpeech({ text, lang })

  ctx.set('Content-Type', 'audio/mpeg')
  ctx.set('Content-Length', String(audio.length))
  ctx.set('X-TTS-Engine', engine)
  ctx.body = audio
}

export async function synthesize(ctx: Context) {
  const body = ctx.request.body as {
    provider?: string
    text?: string
    options?: unknown
  }

  if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
    ctx.status = 400
    ctx.body = { error: 'text is required' }
    return
  }

  if (body.options !== undefined && (typeof body.options !== 'object' || body.options === null || Array.isArray(body.options))) {
    ctx.status = 400
    ctx.body = { error: 'options must be an object' }
    return
  }

  const requestOptions = asRecord(body.options)
  const options = mergeStoredTtsOptions(ctx, body.provider || '', requestOptions)

  const provider = getTtsProvider(body.provider || '')
  if (!provider) {
    ctx.status = 400
    ctx.body = { error: 'unknown TTS provider' }
    return
  }

  const controller = createRequestAbortController(ctx)

  try {
    const result = await provider.synthesize(
      { text: body.text, signal: controller.signal },
      options,
    )

    ctx.set('Content-Type', result.contentType)
    ctx.set('Content-Length', String(result.audio.length))
    ctx.set('X-TTS-Engine', result.engine)
    ctx.set('X-TTS-Provider', result.provider)
    ctx.body = result.audio
  } catch (error) {
    if (isAbortError(error)) {
      ctx.status = 499
      ctx.body = { error: 'TTS request aborted' }
      return
    }

    ctx.status = statusForTtsError(error)
    ctx.body = {
      error: 'TTS synthesis failed',
      detail: sanitizeTtsError(error),
    }
  }
}

function statusForTtsError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  const upstreamStatus = /returned\s+(\d{3})/.exec(message)?.[1]
  const parsedStatus = upstreamStatus ? Number(upstreamStatus) : Number.NaN

  if (Number.isInteger(parsedStatus) && parsedStatus >= 400 && parsedStatus < 500) {
    return parsedStatus
  }

  if (/baseUrl|api key|apiKey|model|voice|required|empty/i.test(message)) {
    return 400
  }

  return 502
}

function sanitizeTtsError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[redacted]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[redacted]"')
    .replace(/'api[_-]?key'\s*:\s*'[^']+'/gi, "'apiKey':'[redacted]'")
    .replace(/api[_-]?key=[^\s&]+/gi, 'apiKey=[redacted]')
    .replace(/\*{3,}/g, '[redacted]')

  return redacted.length > 600 ? `${redacted.slice(0, 600)}…` : redacted
}

function createRequestAbortController(ctx: Context): AbortController {
  const controller = new AbortController()

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  if (ctx.req?.on) {
    // IncomingMessage "close" fires after the request body is fully consumed in
    // normal POSTs, which aborted every TTS test request before synthesis could
    // complete. Only "aborted" is a reliable client-disconnect signal here.
    ctx.req.on('aborted', abort)
  }

  if (ctx.res?.on) {
    ctx.res.on('close', () => {
      // ServerResponse "close" also fires after successful completion; abort
      // only when the response did not finish normally.
      if (!ctx.res.writableEnded) {
        abort()
      }
    })
  }

  return controller
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

/**
 * OpenAI-compatible TTS endpoint.
 * Accepts: { model, input, voice, speed }
 * Returns audio/mpeg stream.
 */
export async function openaiProxy(ctx: Context) {
  const body = ctx.request.body as {
    input?: string
    voice?: string
    speed?: number
    model?: string
    rate?: string
    pitch?: string
  }

  if (!body.input || typeof body.input !== 'string') {
    ctx.status = 400
    ctx.body = { error: 'input is required' }
    return
  }

  if (body.input.length > 5000) {
    ctx.status = 400
    ctx.body = { error: 'input is too long (max 5000 characters)' }
    return
  }

  const { audio, engine } = await openaiCompatibleTts({
    input: body.input,
    voice: body.voice,
    speed: body.speed,
    model: body.model,
    rate: body.rate,
    pitch: body.pitch,
  })

  ctx.set('Content-Type', 'audio/mpeg')
  ctx.set('Content-Length', String(audio.length))
  ctx.set('X-TTS-Engine', engine)
  ctx.body = audio
}
