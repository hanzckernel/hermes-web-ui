import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import { config } from '../config'

// Token stored in ~/.hermes-web-ui/.token (global), fallback to project data directory (dev)
const HOME_TOKEN_DIR = join(homedir(), '.hermes-web-ui')
const HOME_TOKEN_FILE = join(HOME_TOKEN_DIR, '.token')
const LOCAL_TOKEN_FILE = join(config.dataDir, '.token')

async function getTokenFile(): Promise<{ path: string; token: string }> {
  // Prefer global token (~/.hermes-web-ui/.token)
  try {
    const token = await readFile(HOME_TOKEN_FILE, 'utf-8')
    return { path: HOME_TOKEN_FILE, token: token.trim() }
  } catch { /* not found, try local */ }

  // Fallback to local dev token
  try {
    const token = await readFile(LOCAL_TOKEN_FILE, 'utf-8')
    return { path: LOCAL_TOKEN_FILE, token: token.trim() }
  } catch { /* not found */ }

  return { path: HOME_TOKEN_FILE, token: '' }
}

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Get or create the auth token. Returns null if auth is disabled.
 */
export async function getToken(): Promise<string | null> {
  // Auth can be disabled via env var
  if (process.env.AUTH_DISABLED === '1' || process.env.AUTH_DISABLED === 'true') {
    return null
  }

  // Custom token via env var
  if (process.env.AUTH_TOKEN) {
    return process.env.AUTH_TOKEN
  }

  const { path, token } = await getTokenFile()
  if (token) return token

  // Generate a new token (save to ~/.hermes-web-ui/.token)
  const newToken = generateToken()
  await mkdir(HOME_TOKEN_DIR, { recursive: true })
  await writeFile(path, newToken + '\n', { mode: 0o600 })
  return newToken
}

/**
 * Koa middleware: check Authorization header for API routes.
 * Skips /health, /webhook, and static file requests.
 */
export async function authMiddleware(token: string | null) {
  return async (ctx: any, next: () => Promise<void>) => {
    // If auth is disabled, skip
    if (!token) {
      await next()
      return
    }

    // Skip non-API paths (static files, health check, SPA)
    const path = ctx.path
    if (
      path === '/health' ||
      (!path.startsWith('/api') && !path.startsWith('/v1') && path !== '/webhook')
    ) {
      await next()
      return
    }

    const auth = ctx.headers.authorization || ''
    const provided = auth.startsWith('Bearer ')
      ? auth.slice(7)
      : (ctx.query.token as string) || ''

    if (!provided || provided !== token) {
      ctx.status = 401
      ctx.set('Content-Type', 'application/json')
      ctx.body = { error: 'Unauthorized' }
      return
    }

    await next()
  }
}
