/**
 * Incrementally sync Hermes sessions from all profiles on startup.
 * Reads durable Hermes state.db sessions and mirrors missing chat-visible
 * sessions into WebUI's local session DB.
 *
 * Uses sessions-db.ts query logic to properly aggregate session chains.
 */
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import {
  createSession,
  addMessages,
  updateSession,
  deleteSession,
} from '../../db/hermes/session-store'
import { getDb } from '../../db/index'
import { logger } from '../logger'
import {
  listSessionSummaries as listHermesSessionSummaries,
  getSessionDetailFromDbWithProfile,
} from '../../db/hermes/sessions-db'
import { detectHermesHome } from './hermes-path'

const HERMES_BASE = detectHermesHome()
const PROFILES_DIR = join(HERMES_BASE, 'profiles')
const SYNC_SOURCES = ['api_server', 'webui'] as const

type SyncSource = typeof SYNC_SOURCES[number]
type HermesSessionSummary = Awaited<ReturnType<typeof listHermesSessionSummaries>>[number]

/**
 * Get all available profile names including 'default'
 */
function getAllProfiles(): string[] {
  const profiles = ['default']

  if (existsSync(PROFILES_DIR)) {
    const dirs = readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
    profiles.push(...dirs)
  }

  return profiles
}

function localSessionExists(profile: string, hermesSession: HermesSessionSummary, source: SyncSource): boolean {
  const db = getDb()
  if (!db) return false

  const canonical = db.prepare('SELECT id FROM sessions WHERE id = ? LIMIT 1').get(hermesSession.id)
  if (canonical) return true

  // Older startup imports used a random local UUID. Detect those rows by their
  // stable summary fingerprint so the first incremental sync does not create a
  // duplicate copy under the canonical Hermes session id.
  const legacy = db.prepare(`
    SELECT id FROM sessions
    WHERE profile = ?
      AND source = ?
      AND started_at = ?
      AND last_active = ?
      AND COALESCE(title, '') = ?
      AND COALESCE(preview, '') = ?
    LIMIT 1
  `).get(
    profile,
    hermesSession.source || source,
    hermesSession.started_at,
    hermesSession.last_active,
    hermesSession.title || '',
    hermesSession.preview || '',
  )

  return Boolean(legacy)
}

/**
 * Sync chat-visible sessions from a single profile.
 * Uses sessions-db.ts query logic to properly aggregate session chains.
 */
async function syncProfileSessions(profile: string): Promise<{
  synced: number
  skipped: number
  errors: string[]
}> {
  const result = { synced: 0, skipped: 0, errors: [] as string[] }

  for (const source of SYNC_SOURCES) {
    try {
      // Use listSessionSummaries to get aggregated session chains.
      // This returns only root sessions with aggregated stats from the entire chain.
      const summaries = await listHermesSessionSummaries(source, 10000, profile)

      logger.info(`[session-sync] profile '${profile}' source '${source}': found ${summaries.length} aggregated session chains`)

      for (const hermesSession of summaries) {
        // Skip ephemeral sessions created internally by chat-run-socket.
        if (hermesSession.id.startsWith('eph_')) {
          result.skipped++
          continue
        }

        if (localSessionExists(profile, hermesSession, source)) {
          result.skipped++
          continue
        }

        try {
          // Get full detail including all messages from the session chain before
          // creating the local row. That avoids partial imports when detail load fails.
          const detail = await getSessionDetailFromDbWithProfile(hermesSession.id, profile)

          if (!detail || !detail.messages) {
            result.errors.push(`session ${hermesSession.id}: failed to load messages`)
            logger.warn(`[session-sync] failed to load messages for session ${hermesSession.id}`)
            continue
          }

          let createdLocalSession = false
          try {
            createSession({
              id: hermesSession.id,
              profile,
              source: hermesSession.source || source,
              model: hermesSession.model,
              title: hermesSession.title || undefined,
            })
            createdLocalSession = true

            addMessages(detail.messages.map(msg => ({
              session_id: hermesSession.id,
              role: msg.role,
              content: msg.content,
              tool_call_id: msg.tool_call_id,
              tool_calls: msg.tool_calls,
              tool_name: msg.tool_name,
              timestamp: msg.timestamp,
              token_count: msg.token_count,
              finish_reason: msg.finish_reason,
              reasoning: msg.reasoning,
              reasoning_details: msg.reasoning_details,
              reasoning_content: msg.reasoning_content,
            })))

            // Update session with aggregated stats from Hermes.
            updateSession(hermesSession.id, {
              source: hermesSession.source || source,
              user_id: hermesSession.user_id,
              started_at: hermesSession.started_at,
              ended_at: hermesSession.ended_at,
              end_reason: hermesSession.end_reason,
              message_count: hermesSession.message_count,
              tool_call_count: hermesSession.tool_call_count,
              input_tokens: hermesSession.input_tokens,
              output_tokens: hermesSession.output_tokens,
              cache_read_tokens: hermesSession.cache_read_tokens,
              cache_write_tokens: hermesSession.cache_write_tokens,
              reasoning_tokens: hermesSession.reasoning_tokens,
              billing_provider: hermesSession.billing_provider,
              estimated_cost_usd: hermesSession.estimated_cost_usd,
              actual_cost_usd: hermesSession.actual_cost_usd,
              cost_status: hermesSession.cost_status,
              preview: hermesSession.preview,
              last_active: hermesSession.last_active,
            })
          } catch (err) {
            if (createdLocalSession) {
              deleteSession(hermesSession.id)
            }
            throw err
          }

          result.synced++
          logger.info(`[session-sync] synced Hermes session ${hermesSession.id} (${detail.messages.length} messages, thread_session_count=${detail.thread_session_count})`)
        } catch (err: any) {
          result.errors.push(`session ${hermesSession.id}: ${err.message}`)
          logger.warn(err, `[session-sync] failed to sync session ${hermesSession.id}`)
        }
      }
    } catch (err: any) {
      if (!err.message.includes('state.db not found')) {
        result.errors.push(`${source}: ${err.message}`)
        logger.warn(err, `[session-sync] failed to open state.db for profile '${profile}', source '${source}'`)
      }
    }
  }

  return result
}

/**
 * Main entry point: sync all profiles on startup.
 * Runs incrementally so sessions created outside the local WebUI DB are imported
 * after every restart without duplicating sessions already mirrored locally.
 */
export async function syncAllHermesSessionsOnStartup(): Promise<void> {
  const db = getDb()
  if (!db) {
    logger.info('[session-sync] SQLite not available, skipping Hermes sync')
    return
  }

  logger.info('[session-sync] starting incremental Hermes session sync...')

  const profiles = getAllProfiles()
  logger.info(`[session-sync] found ${profiles.length} profiles: ${profiles.join(', ')}`)

  let totalSynced = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const profile of profiles) {
    const result = await syncProfileSessions(profile)
    totalSynced += result.synced
    totalSkipped += result.skipped
    totalErrors += result.errors.length

    if (result.errors.length > 0) {
      logger.warn(`[session-sync] profile '${profile}' had ${result.errors.length} errors`)
      for (const err of result.errors.slice(0, 5)) {
        logger.warn(`[session-sync]   - ${err}`)
      }
      if (result.errors.length > 5) {
        logger.warn(`[session-sync]   - ... and ${result.errors.length - 5} more errors`)
      }
    }
  }

  logger.info(`[session-sync] sync complete: synced=${totalSynced}, skipped=${totalSkipped}, errors=${totalErrors}`)
}
