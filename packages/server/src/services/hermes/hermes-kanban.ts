import { execFile, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { promisify } from 'util'
import { logger } from '../logger'
import { readConfigYaml } from '../config-helpers'

const execFileAsync = promisify(execFile)

const execOpts = { windowsHide: true }
const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const NO_WORKER_LOG_PATTERNS = [
  /^\(no log for [^)]+?\s+—\s+task may not have spawned yet\)$/i,
  /^no worker log(?: for [^\n]+)?$/i,
]

function resolveHermesBin(): string {
  const envBin = process.env.HERMES_BIN?.trim()
  if (envBin) return envBin
  return 'hermes'
}

const HERMES_BIN = resolveHermesBin()
const CLI_MAX_BUFFER_BYTES = 50 * 1024 * 1024
const CLI_TIMEOUT_MS = 30000

export interface KanbanBackendAdapterMetadata {
  kind: 'cli'
  mode: 'bridge'
  canonicalProxy: 'missing'
  notes: string[]
}

interface KanbanBackendAdapter {
  metadata: KanbanBackendAdapterMetadata
  execText(args: string[], logMessage: string, failureMessage: string): Promise<string>
  execJson<T>(args: string[], logMessage: string, failureMessage: string): Promise<T>
  execVoid(args: string[], logMessage: string, failureMessage: string): Promise<void>
  spawn(args: string[]): ChildProcess
}

function createCliKanbanAdapter(): KanbanBackendAdapter {
  async function execText(args: string[], logMessage: string, failureMessage: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(HERMES_BIN, args, {
        maxBuffer: CLI_MAX_BUFFER_BYTES,
        timeout: CLI_TIMEOUT_MS,
        ...execOpts,
      })
      return stdout
    } catch (err: any) {
      logger.error(err, logMessage)
      throw new Error(`${failureMessage}: ${err.message}`)
    }
  }

  return {
    metadata: {
      kind: 'cli',
      mode: 'bridge',
      canonicalProxy: 'missing',
      notes: [
        'WUI currently bridges to Hermes kanban CLI commands with explicit board context.',
        'A plugin-native canonical proxy is still deferred.',
      ],
    },
    execText,
    async execJson<T>(args: string[], logMessage: string, failureMessage: string) {
      const stdout = await execText(args, logMessage, failureMessage)
      try {
        return JSON.parse(stdout) as T
      } catch (err: any) {
        logger.error(err, logMessage)
        throw new Error(`${failureMessage}: ${err.message}`)
      }
    },
    async execVoid(args: string[], logMessage: string, failureMessage: string) {
      await execText(args, logMessage, failureMessage)
    },
    spawn(args: string[]) {
      return spawn(HERMES_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...execOpts,
      })
    },
  }
}

const kanbanAdapter = createCliKanbanAdapter()

export function getKanbanAdapterMetadata(): KanbanBackendAdapterMetadata {
  return kanbanAdapter.metadata
}

export function normalizeBoardSlug(board?: string | null): string {
  if (board === undefined || board === null) return 'default'
  const trimmed = board.trim().toLowerCase()
  if (!trimmed) throw new Error('Invalid kanban board slug')
  if (!BOARD_SLUG_RE.test(trimmed)) {
    throw new Error('Invalid kanban board slug')
  }
  return trimmed
}

function boardArgs(board?: string | null): string[] {
  return ['kanban', '--board', normalizeBoardSlug(board)]
}

// ─── Types ──────────────────────────────────────────────────────

export type KanbanTaskStatus = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done' | 'archived'

export interface KanbanTask {
  id: string
  title: string
  body: string | null
  assignee: string | null
  status: KanbanTaskStatus
  priority: number
  created_by: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
  workspace_kind: string
  workspace_path: string | null
  tenant: string | null
  result: string | null
  skills: string[] | null
}

export interface KanbanRun {
  id: number
  task_id: string
  profile: string | null
  status: string
  started_at: number
  ended_at: number | null
  outcome: string | null
  summary: string | null
  error: string | null
}

export interface KanbanComment {
  id: number
  task_id: string
  author: string
  body: string
  created_at: number
}

export interface KanbanEvent {
  id: number
  task_id: string
  kind: string
  payload: Record<string, unknown> | null
  created_at: number
  run_id: number | null
}

export interface KanbanTaskDetail {
  task: KanbanTask
  comments: KanbanComment[]
  events: KanbanEvent[]
  runs: KanbanRun[]
}

export interface KanbanStats {
  by_status: Record<string, number>
  by_assignee: Record<string, number>
  total: number
}

export interface KanbanAssignee {
  name: string
  on_disk: boolean
  counts: Record<string, number> | null
}

export interface KanbanBoard {
  slug: string
  name: string
  description: string
  icon: string
  color: string
  created_at: number | null
  archived: boolean
  db_path?: string
  is_current?: boolean
  counts: Record<string, number>
  total: number
}

export interface KanbanBoardCreateOptions {
  slug: string
  name?: string
  description?: string
  icon?: string
  color?: string
  switchCurrent?: boolean
}

export interface KanbanCapabilities {
  source: 'hermes-cli'
  adapter: KanbanBackendAdapterMetadata
  supports: Record<string, boolean>
  missing: string[]
  capabilities: KanbanCapabilityStatus[]
}

export interface KanbanTaskLog {
  task_id: string
  path: string | null
  exists: boolean
  size_bytes: number
  content: string
  truncated: boolean
}

export interface KanbanCapabilityStatus {
  key: string
  status: 'supported' | 'partial' | 'missing'
  reason?: string
  canonicalRoute?: string
  canonicalCommand?: string
  requiresBoard: boolean
}

export interface KanbanBoardOptions {
  board?: string
}

export interface KanbanWatchOptions extends KanbanBoardOptions {
  interval?: number
}

export interface KanbanBulkTaskUpdateOptions extends KanbanBoardOptions {
  ids: string[]
  status?: KanbanTaskStatus
  assignee?: string | null
  archive?: boolean
  summary?: string
  reason?: string
}

export interface KanbanBulkTaskResult {
  id: string
  ok: boolean
  error?: string
}

export interface KanbanBulkTaskUpdateResult {
  results: KanbanBulkTaskResult[]
}

export interface KanbanHomeChannel {
  platform: string
  chat_id: string
  thread_id: string
  name: string
  subscribed?: boolean
}

export interface KanbanNotifySubscription {
  task_id: string
  platform: string
  chat_id: string
  thread_id?: string | null
  user_id?: string | null
  last_event_id?: number
}

// ─── CLI wrappers ───────────────────────────────────────────────

export async function listBoards(opts?: { includeArchived?: boolean }): Promise<KanbanBoard[]> {
  const args = ['kanban', 'boards', 'list', '--json']
  if (opts?.includeArchived) args.push('--all')

  return kanbanAdapter.execJson<KanbanBoard[]>(args, 'Hermes CLI: kanban boards list failed', 'Failed to list kanban boards')
}

async function findBoard(slug: string, includeArchived = true): Promise<KanbanBoard | null> {
  const boards = await listBoards({ includeArchived })
  return boards.find(board => board.slug === slug) || null
}

export async function createBoard(opts: KanbanBoardCreateOptions): Promise<KanbanBoard> {
  const slug = normalizeBoardSlug(opts.slug)
  const args = ['kanban', 'boards', 'create', slug]
  if (opts.name?.trim()) args.push('--name', opts.name.trim())
  if (opts.description?.trim()) args.push('--description', opts.description.trim())
  if (opts.icon?.trim()) args.push('--icon', opts.icon.trim())
  if (opts.color?.trim()) args.push('--color', opts.color.trim())
  if (opts.switchCurrent) args.push('--switch')

  try {
    await kanbanAdapter.execVoid(args, 'Hermes CLI: kanban boards create failed', 'Failed to create kanban board')
    const board = await findBoard(slug)
    if (!board) throw new Error('created board was not returned by boards list')
    return board
  } catch (err: any) {
    if (String(err?.message || '').startsWith('Failed to create kanban board:')) throw err
    logger.error(err, 'Hermes CLI: kanban boards create failed')
    throw new Error(`Failed to create kanban board: ${err.message}`)
  }
}

export async function archiveBoard(slugInput: string): Promise<void> {
  const slug = normalizeBoardSlug(slugInput)
  if (slug === 'default') throw new Error('Cannot archive the default kanban board')

  await kanbanAdapter.execVoid(['kanban', 'boards', 'rm', slug], 'Hermes CLI: kanban boards archive failed', 'Failed to archive kanban board')
}

export async function getCapabilities(): Promise<KanbanCapabilities> {
  const capabilities: KanbanCapabilityStatus[] = [
    { key: 'explicitBoard', status: 'supported', canonicalCommand: '--board', requiresBoard: true },
    { key: 'boardsList', status: 'supported', canonicalRoute: '/boards', canonicalCommand: 'boards list', requiresBoard: false },
    { key: 'boardCreate', status: 'supported', canonicalRoute: '/boards', canonicalCommand: 'boards create', requiresBoard: false },
    { key: 'boardArchive', status: 'supported', canonicalRoute: '/boards/{slug}', canonicalCommand: 'boards rm', requiresBoard: false },
    { key: 'cliCurrentSwitch', status: 'partial', reason: 'Backend keeps explicit board context and does not expose a WUI route for mutating canonical CLI current board', canonicalRoute: '/boards/{slug}/switch', canonicalCommand: 'boards switch', requiresBoard: false },
    { key: 'taskCrudLite', status: 'supported', canonicalRoute: '/tasks', canonicalCommand: 'list/show/create/complete/block/unblock/assign', requiresBoard: true },
    { key: 'commentsWrite', status: 'supported', canonicalRoute: '/tasks/{task_id}/comments', canonicalCommand: 'comment', requiresBoard: true },
    { key: 'commentsRead', status: 'supported', reason: 'Comments are returned on task detail responses', canonicalRoute: '/tasks/{task_id}', canonicalCommand: 'show --json', requiresBoard: true },
    { key: 'taskLog', status: 'supported', canonicalRoute: '/tasks/{task_id}/log', canonicalCommand: 'log', requiresBoard: true },
    { key: 'diagnostics', status: 'supported', canonicalRoute: '/diagnostics', canonicalCommand: 'diagnostics', requiresBoard: true },
    { key: 'reclaim', status: 'supported', canonicalRoute: '/tasks/{task_id}/reclaim', canonicalCommand: 'reclaim', requiresBoard: true },
    { key: 'reassign', status: 'supported', canonicalRoute: '/tasks/{task_id}/reassign', canonicalCommand: 'reassign', requiresBoard: true },
    { key: 'specify', status: 'supported', canonicalRoute: '/tasks/{task_id}/specify', canonicalCommand: 'specify', requiresBoard: true },
    { key: 'dispatch', status: 'supported', canonicalRoute: '/dispatch', canonicalCommand: 'dispatch', requiresBoard: true },
    { key: 'links', status: 'supported', canonicalRoute: '/links', canonicalCommand: 'link/unlink', requiresBoard: true },
    { key: 'bulk', status: 'partial', reason: 'WUI applies supported bulk-equivalent CLI transitions per id and returns per-task outcomes; direct priority/status patch parity remains deferred', canonicalRoute: '/tasks/bulk', canonicalCommand: 'bulk-equivalent via complete/block/unblock/archive/assign', requiresBoard: true },
    { key: 'events', status: 'partial', reason: 'WUI exposes a board-scoped WebSocket bridge backed by the canonical `kanban watch` stream; payload is currently a refresh invalidation signal, not a typed event model', canonicalRoute: '/events', canonicalCommand: 'watch', requiresBoard: true },
    { key: 'homeSubscriptions', status: 'partial', reason: 'WUI exposes configured config.yaml home-channel toggles backed by notify-* CLI commands; env-overlay homes and plugin-native proxy parity remain deferred', canonicalRoute: '/home-channels and subscription routes', canonicalCommand: 'notify-*', requiresBoard: true },
    { key: 'canonicalProxy', status: 'missing', reason: 'WUI still owns per-route bridge semantics over the CLI adapter; plugin-native canonical proxy/adapter contract remains the next architecture slice', canonicalRoute: '/api/hermes/kanban/*', requiresBoard: false },
  ]
  const supports = Object.fromEntries(capabilities.map(capability => [capability.key, capability.status === 'supported'])) as Record<string, boolean>
  const missing = capabilities
    .filter(capability => capability.status !== 'supported')
    .map(capability => capability.key)
  return { source: 'hermes-cli', adapter: getKanbanAdapterMetadata(), supports, missing, capabilities }
}

function parseJsonPayload(stdout: string): unknown[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed)
  if (Array.isArray(parsed)) return parsed
  return [parsed]
}

function isNoWorkerLogError(err: any): boolean {
  const lines = [err?.stderr, err?.stdout, err?.message]
    .filter(Boolean)
    .flatMap(value => String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean))
  return lines.some(line => NO_WORKER_LOG_PATTERNS.some(pattern => pattern.test(line)))
}

function pushOptional(args: string[], flag: string, value?: string | number | null): void {
  if (value !== undefined && value !== null && String(value).trim() !== '') args.push(flag, String(value))
}

export function buildWatchArgs(opts?: KanbanWatchOptions): string[] {
  const args = [...boardArgs(opts?.board), 'watch']
  pushOptional(args, '--interval', opts?.interval ?? 0.5)
  return args
}

export function watchEvents(opts?: KanbanWatchOptions): ChildProcess {
  return kanbanAdapter.spawn(buildWatchArgs(opts))
}

function homeChannelFromConfig(platform: string, node: any): KanbanHomeChannel | null {
  const raw = node?.home_channel ?? node?.homeChannel
  if (!raw) return null
  if (typeof raw === 'string') {
    const chatId = raw.trim()
    if (!chatId) return null
    return { platform, chat_id: chatId, thread_id: '', name: 'Home' }
  }
  if (typeof raw !== 'object') return null
  const chatId = raw.chat_id ?? raw.chatId ?? raw.channel_id ?? raw.channelId
  if (chatId === undefined || chatId === null || String(chatId).trim() === '') return null
  const threadId = raw.thread_id ?? raw.threadId ?? ''
  const name = raw.name ?? 'Home'
  return { platform, chat_id: String(chatId), thread_id: threadId === undefined || threadId === null ? '' : String(threadId), name: String(name || 'Home') }
}

export async function listConfiguredHomeChannels(): Promise<KanbanHomeChannel[]> {
  const config = await readConfigYaml()
  const platforms = (config.gateway?.platforms ?? config.platforms) as Record<string, any> | undefined
  if (!platforms || typeof platforms !== 'object') return []
  return Object.entries(platforms)
    .map(([platform, node]) => homeChannelFromConfig(platform, node))
    .filter((home): home is KanbanHomeChannel => Boolean(home))
    .sort((a, b) => a.platform.localeCompare(b.platform))
}

function notifySubKey(sub: KanbanNotifySubscription): string {
  return `${sub.platform}\u0000${String(sub.chat_id)}\u0000${String(sub.thread_id || '')}`
}

function homeKey(home: KanbanHomeChannel): string {
  return `${home.platform}\u0000${String(home.chat_id)}\u0000${String(home.thread_id || '')}`
}

function findHomeChannel(homes: KanbanHomeChannel[], platform: string): KanbanHomeChannel | null {
  return homes.find(home => home.platform === platform) || null
}

export async function listNotifySubscriptions(taskId?: string, opts?: KanbanBoardOptions): Promise<KanbanNotifySubscription[]> {
  const args = [...boardArgs(opts?.board), 'notify-list']
  if (taskId?.trim()) args.push(taskId.trim())
  args.push('--json')
  const stdout = await kanbanAdapter.execText(args, 'Hermes CLI: kanban notify-list failed', 'Failed to list kanban notifications')
  try {
    return parseJsonPayload(stdout) as KanbanNotifySubscription[]
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban notify-list failed')
    throw new Error(`Failed to list kanban notifications: ${err.message}`)
  }
}

export async function getHomeChannels(opts?: KanbanBoardOptions & { taskId?: string }): Promise<{ home_channels: KanbanHomeChannel[] }> {
  const homes = await listConfiguredHomeChannels()
  if (!opts?.taskId?.trim()) return { home_channels: homes.map(home => ({ ...home, subscribed: false })) }
  const subscriptions = await listNotifySubscriptions(opts.taskId, opts)
  const subscribed = new Set(subscriptions.map(notifySubKey))
  return { home_channels: homes.map(home => ({ ...home, subscribed: subscribed.has(homeKey(home)) })) }
}

export async function subscribeHome(taskId: string, platform: string, opts?: KanbanBoardOptions): Promise<{ ok: boolean; task_id: string; home_channel: KanbanHomeChannel; output: string }> {
  const homes = await listConfiguredHomeChannels()
  const home = findHomeChannel(homes, platform)
  if (!home) throw new Error(`No home channel configured for platform ${platform}`)
  const args = [...boardArgs(opts?.board), 'notify-subscribe', taskId, '--platform', platform, '--chat-id', home.chat_id]
  pushOptional(args, '--thread-id', home.thread_id)
  const stdout = await kanbanAdapter.execText(args, 'Hermes CLI: kanban notify-subscribe failed', 'Failed to subscribe kanban home notifications')
  return { ok: true, task_id: taskId, home_channel: home, output: stdout }
}

export async function unsubscribeHome(taskId: string, platform: string, opts?: KanbanBoardOptions): Promise<{ ok: boolean; task_id: string; home_channel: KanbanHomeChannel; output: string }> {
  const homes = await listConfiguredHomeChannels()
  const home = findHomeChannel(homes, platform)
  if (!home) throw new Error(`No home channel configured for platform ${platform}`)
  const args = [...boardArgs(opts?.board), 'notify-unsubscribe', taskId, '--platform', platform, '--chat-id', home.chat_id]
  pushOptional(args, '--thread-id', home.thread_id)
  const stdout = await kanbanAdapter.execText(args, 'Hermes CLI: kanban notify-unsubscribe failed', 'Failed to unsubscribe kanban home notifications')
  return { ok: true, task_id: taskId, home_channel: home, output: stdout }
}

export async function linkTasks(parentId: string, childId: string, opts?: KanbanBoardOptions): Promise<{ ok: boolean; output: string }> {
  const stdout = await kanbanAdapter.execText([...boardArgs(opts?.board), 'link', parentId, childId], 'Hermes CLI: kanban link failed', 'Failed to link kanban tasks')
  return { ok: true, output: stdout }
}

export async function unlinkTasks(parentId: string, childId: string, opts?: KanbanBoardOptions): Promise<{ ok: boolean; output: string }> {
  const stdout = await kanbanAdapter.execText([...boardArgs(opts?.board), 'unlink', parentId, childId], 'Hermes CLI: kanban unlink failed', 'Failed to unlink kanban tasks')
  return { ok: true, output: stdout }
}

export async function addComment(taskId: string, body: string, opts?: KanbanBoardOptions & { author?: string }): Promise<{ ok: boolean; output: string }> {
  const args = [...boardArgs(opts?.board), 'comment', taskId, body]
  pushOptional(args, '--author', opts?.author)
  const stdout = await kanbanAdapter.execText(args, 'Hermes CLI: kanban comment failed', 'Failed to comment on kanban task')
  return { ok: true, output: stdout }
}

export async function getTaskLog(taskId: string, opts?: KanbanBoardOptions & { tail?: number }): Promise<KanbanTaskLog> {
  const args = [...boardArgs(opts?.board), 'log', taskId]
  pushOptional(args, '--tail', opts?.tail)
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    const sizeBytes = Buffer.byteLength(stdout, 'utf8')
    return {
      task_id: taskId,
      path: null,
      exists: true,
      size_bytes: sizeBytes,
      content: stdout,
      truncated: opts?.tail !== undefined && sizeBytes >= opts.tail,
    }
  } catch (err: any) {
    const detail = await getTask(taskId, opts)
    if (!detail) throw new Error('Kanban task not found')
    if ((err.code === 1 || err.status === 1) && isNoWorkerLogError(err)) {
      return {
        task_id: taskId,
        path: null,
        exists: false,
        size_bytes: 0,
        content: '',
        truncated: false,
      }
    }
    logger.error(err, 'Hermes CLI: kanban log failed')
    throw new Error(`Failed to read kanban task log: ${err.message}`)
  }
}

export async function getDiagnostics(opts?: KanbanBoardOptions & { task?: string; severity?: string }): Promise<unknown[]> {
  const args = [...boardArgs(opts?.board), 'diagnostics', '--json']
  pushOptional(args, '--task', opts?.task)
  pushOptional(args, '--severity', opts?.severity)
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban diagnostics failed')
    throw new Error(`Failed to get kanban diagnostics: ${err.message}`)
  }
}

export async function reclaimTask(taskId: string, opts?: KanbanBoardOptions & { reason?: string }): Promise<{ ok: boolean; output: string }> {
  const args = [...boardArgs(opts?.board), 'reclaim', taskId]
  pushOptional(args, '--reason', opts?.reason)
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return { ok: true, output: stdout }
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban reclaim failed')
    throw new Error(`Failed to reclaim kanban task: ${err.message}`)
  }
}

export async function reassignTask(taskId: string, profile: string, opts?: KanbanBoardOptions & { reclaim?: boolean; reason?: string }): Promise<{ ok: boolean; output: string }> {
  const args = [...boardArgs(opts?.board), 'reassign', taskId, profile]
  if (opts?.reclaim) args.push('--reclaim')
  pushOptional(args, '--reason', opts?.reason)
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return { ok: true, output: stdout }
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban reassign failed')
    throw new Error(`Failed to reassign kanban task: ${err.message}`)
  }
}

export async function specifyTask(taskId: string, opts?: KanbanBoardOptions & { author?: string }): Promise<unknown[]> {
  const args = [...boardArgs(opts?.board), 'specify', taskId, '--json']
  pushOptional(args, '--author', opts?.author)
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return parseJsonPayload(stdout)
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban specify failed')
    throw new Error(`Failed to specify kanban task: ${err.message}`)
  }
}

export async function dispatch(opts?: KanbanBoardOptions & { dryRun?: boolean; max?: number; failureLimit?: number }): Promise<unknown> {
  const args = [...boardArgs(opts?.board), 'dispatch', '--json']
  if (opts?.dryRun) args.push('--dry-run')
  pushOptional(args, '--max', opts?.max)
  pushOptional(args, '--failure-limit', opts?.failureLimit)
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban dispatch failed')
    throw new Error(`Failed to dispatch kanban tasks: ${err.message}`)
  }
}

export async function listTasks(opts?: {
  board?: string
  status?: string
  assignee?: string
  tenant?: string
}): Promise<KanbanTask[]> {
  const args = [...boardArgs(opts?.board), 'list', '--json']
  if (opts?.status) args.push('--status', opts.status)
  if (opts?.assignee) args.push('--assignee', opts.assignee)
  if (opts?.tenant) args.push('--tenant', opts.tenant)

  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban list failed')
    throw new Error(`Failed to list kanban tasks: ${err.message}`)
  }
}

export async function getTask(taskId: string, opts?: KanbanBoardOptions): Promise<KanbanTaskDetail | null> {
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, [...boardArgs(opts?.board), 'show', taskId, '--json'], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    if (err.code === 1 || err.status === 1) return null
    logger.error(err, 'Hermes CLI: kanban show failed')
    throw new Error(`Failed to get kanban task: ${err.message}`)
  }
}

export async function createTask(
  title: string,
  opts?: {
    board?: string
    body?: string
    assignee?: string
    priority?: number
    tenant?: string
  },
): Promise<KanbanTask> {
  const args = [...boardArgs(opts?.board), 'create', title, '--json']
  if (opts?.body) args.push('--body', opts.body)
  if (opts?.assignee) args.push('--assignee', opts.assignee)
  if (opts?.priority !== undefined) args.push('--priority', String(opts.priority))
  if (opts?.tenant) args.push('--tenant', opts.tenant)

  try {
    const { stdout } = await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban create failed')
    throw new Error(`Failed to create kanban task: ${err.message}`)
  }
}

export async function completeTasks(taskIds: string[], summary?: string, opts?: KanbanBoardOptions): Promise<void> {
  const args = [...boardArgs(opts?.board), 'complete', ...taskIds]
  if (summary) args.push('--summary', summary)

  try {
    await execFileAsync(HERMES_BIN, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban complete failed')
    throw new Error(`Failed to complete kanban tasks: ${err.message}`)
  }
}

export async function blockTask(taskId: string, reason: string, opts?: KanbanBoardOptions): Promise<void> {
  try {
    await execFileAsync(HERMES_BIN, [...boardArgs(opts?.board), 'block', taskId, reason], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban block failed')
    throw new Error(`Failed to block kanban task: ${err.message}`)
  }
}

export async function unblockTasks(taskIds: string[], opts?: KanbanBoardOptions): Promise<void> {
  try {
    await execFileAsync(HERMES_BIN, [...boardArgs(opts?.board), 'unblock', ...taskIds], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban unblock failed')
    throw new Error(`Failed to unblock kanban tasks: ${err.message}`)
  }
}

export async function assignTask(taskId: string, profile: string, opts?: KanbanBoardOptions): Promise<void> {
  try {
    await execFileAsync(HERMES_BIN, [...boardArgs(opts?.board), 'assign', taskId, profile], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban assign failed')
    throw new Error(`Failed to assign kanban task: ${err.message}`)
  }
}

export async function archiveTasks(taskIds: string[], opts?: KanbanBoardOptions): Promise<void> {
  try {
    await execFileAsync(HERMES_BIN, [...boardArgs(opts?.board), 'archive', ...taskIds], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban archive failed')
    throw new Error(`Failed to archive kanban tasks: ${err.message}`)
  }
}

async function applyBulkStatus(taskId: string, opts: KanbanBulkTaskUpdateOptions): Promise<void> {
  switch (opts.status) {
    case undefined:
      return
    case 'done':
      return completeTasks([taskId], opts.summary, opts)
    case 'blocked':
      return blockTask(taskId, opts.reason?.trim() || 'Bulk update', opts)
    case 'ready':
      return unblockTasks([taskId], opts)
    case 'archived':
      return archiveTasks([taskId], opts)
    default:
      throw new Error(`Bulk status ${opts.status} is not supported by the CLI bridge`)
  }
}

export async function bulkUpdateTasks(opts: KanbanBulkTaskUpdateOptions): Promise<KanbanBulkTaskUpdateResult> {
  const ids = opts.ids.map(id => id.trim()).filter(Boolean)
  const results: KanbanBulkTaskResult[] = []
  for (const id of ids) {
    try {
      if (opts.archive) await archiveTasks([id], opts)
      else await applyBulkStatus(id, opts)
      if (opts.assignee !== undefined) await assignTask(id, opts.assignee?.trim() || 'none', opts)
      results.push({ id, ok: true })
    } catch (err: any) {
      results.push({ id, ok: false, error: err?.message || String(err) })
    }
  }
  return { results }
}

export async function getStats(opts?: KanbanBoardOptions): Promise<KanbanStats> {
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, [...boardArgs(opts?.board), 'stats', '--json'], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban stats failed')
    throw new Error(`Failed to get kanban stats: ${err.message}`)
  }
}

export async function getAssignees(opts?: KanbanBoardOptions): Promise<KanbanAssignee[]> {
  try {
    const { stdout } = await execFileAsync(HERMES_BIN, [...boardArgs(opts?.board), 'assignees', '--json'], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
      ...execOpts,
    })
    return JSON.parse(stdout)
  } catch (err: any) {
    logger.error(err, 'Hermes CLI: kanban assignees failed')
    throw new Error(`Failed to get kanban assignees: ${err.message}`)
  }
}
