import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from '@koa/bodyparser'
import serve from 'koa-static'
import send from 'koa-send'
import { resolve } from 'path'
import { mkdir } from 'fs/promises'
import { readFileSync } from 'fs'
import { config } from './config'
import { hermesRoutes, setupTerminalWebSocket, proxyMiddleware } from './routes/hermes'
import { uploadRoutes } from './routes/upload'
import { webhookRoutes } from './routes/webhook'
import * as hermesCli from './services/hermes/hermes-cli'
import { CliResponse } from './services/cli-response'
import { installSkills } from './services/skill-installer'
import { getToken, authMiddleware } from './services/auth'

function getLocalVersion(): string {
  // production: dist/server → ../../package.json
  // dev: packages/server/src → ../../../package.json
  const candidates = [
    resolve(__dirname, '../../package.json'),
    resolve(__dirname, '../../../package.json'),
  ]
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8')).version
    } catch { }
  }
  return '0.0.0'
}

const LOCAL_VERSION = getLocalVersion()

let cachedLatestVersion = ''

async function checkLatestVersion(): Promise<void> {
  try {
    const res = await fetch('https://registry.npmjs.org/hermes-web-ui/latest', {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      const latest = data.version || ''
      if (latest && latest !== cachedLatestVersion) {
        cachedLatestVersion = latest
        if (latest !== LOCAL_VERSION) {
          console.log(`⬆ New version available: v${LOCAL_VERSION} → v${latest}`)
        }
      }
    }
  } catch { }
}

const app = new Koa()
const { restartGateway, startGateway, startGatewayBackground, getVersion } = hermesCli

let server: any = null
let isShuttingDown = false

// 👉 如果你有子进程，一定要存
let gatewayPid: number | null = null
let gatewayManager: any = null

export async function bootstrap() {
  await mkdir(config.uploadDir, { recursive: true })
  await mkdir(config.dataDir, { recursive: true })

  // Auth (after mkdir so data dir exists)
  const authToken = await getToken()
  if (authToken) {
    app.use(await authMiddleware(authToken))
    console.log(`🔐 Auth enabled — token: ${authToken}`)
  }

  await initGatewayManager()

  app.use(cors({ origin: config.corsOrigins }))
  app.use(bodyParser())

  app.use(webhookRoutes.routes())
  app.use(uploadRoutes.routes())

  // CliResponse instance (attach later after server is created)
  const cliResponse = new CliResponse()

  // update (must be before hermesRoutes which includes proxy routes)
  app.use(async (ctx, next) => {
    if (ctx.path === '/api/hermes/update' && ctx.method === 'POST') {
      const isWin = process.platform === 'win32'
      const cmd = isWin
        ? 'cmd /c hermes-web-ui update'
        : 'hermes-web-ui update'

      try {
        const { execSync } = await import('child_process')
        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 120000,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        ctx.body = { success: true, message: output.trim() }
      } catch (err: any) {
        ctx.status = 500
        ctx.body = { success: false, message: err.stderr || err.message }
      }
      return
    }
    await next()
  })

  // cli-response HTTP route (must be before hermesRoutes which includes proxy)
  app.use(cliResponse.getRoutes().routes())

  app.use(hermesRoutes.routes())
  app.use(proxyMiddleware)

  // health
  app.use(async (ctx, next) => {
    if (ctx.path === '/health') {
      const raw = await getVersion()
      const hermesVersion = raw.split('\n')[0].replace('Hermes Agent ', '') || ''

      let gatewayOk = false
      try {
        const upstream = gatewayManager?.getUpstream() || config.upstream
        const res = await fetch(`${upstream.replace(/\/$/, '')}/health`, {
          signal: AbortSignal.timeout(5000),
        })
        gatewayOk = res.ok
      } catch { }

      ctx.body = {
        status: gatewayOk ? 'ok' : 'error',
        platform: 'hermes-agent',
        version: hermesVersion,
        gateway: gatewayOk ? 'running' : 'stopped',
        webui_version: LOCAL_VERSION,
        webui_latest: cachedLatestVersion,
        webui_update_available: cachedLatestVersion && cachedLatestVersion !== LOCAL_VERSION,
      }
      return
    }
    await next()
  })

  // SPA
  const distDir = resolve(__dirname, '..', 'client')
  app.use(serve(distDir))
  app.use(async (ctx) => {
    if (!ctx.path.startsWith('/api') &&
      ctx.path !== '/health' &&
      ctx.path !== '/upload' &&
      ctx.path !== '/webhook') {
      await send(ctx, 'index.html', { root: distDir })
    }
  })

  // 🚀 启动服务
  server = app.listen(config.port, '0.0.0.0')

  // Terminal WebSocket (must be after server is created)
  setupTerminalWebSocket(server)

  // Socket.IO message service
  cliResponse.attach(server)

  server.on('listening', () => {
    console.log(`➜ Server: http://localhost:${config.port}`)
    console.log(`➜ Upstream: ${config.upstream}`)
  })

  server.on('error', (err: any) => {
    console.error('Server error:', err.message)
  })

  // 👇 绑定退出信号
  bindShutdown()

  // Install cli-response skill to Hermes / Claude Code if not present
  installSkills()

  // Check for updates every 4 hours
  checkLatestVersion()
  setInterval(checkLatestVersion, 4 * 60 * 60 * 1000)
}

// ============================
// ✅ 统一关闭逻辑（核心）
// ============================
function bindShutdown() {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log(`\n[${signal}] shutting down...`)

    try {
      // ✅ 1. 关闭 HTTP server
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => {
            console.log('✓ http server closed')
            resolve()
          })
        })
      }

      // gateway 是系统服务，不随 dev server 退出而停止

    } catch (err) {
      console.error('shutdown error:', err)
    }

    process.exit(0)
  }

  // 👉 nodemon 专用（必须 once）
  process.once('SIGUSR2', shutdown)

  // 👉 正常退出
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // 👉 防止异常退出没处理
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err)
    shutdown('uncaughtException')
  })

  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection:', err)
    shutdown('unhandledRejection')
  })
}

// ============================
// Gateway Manager
// ============================

async function initGatewayManager() {
  const { GatewayManager } = await import('./services/hermes/gateway-manager')
  const { getActiveProfileName } = await import('./services/hermes/hermes-profile')
  const { setGatewayManager } = await import('./routes/hermes/gateways')

  const activeProfile = getActiveProfileName()
  gatewayManager = new GatewayManager(activeProfile)
  setGatewayManager(gatewayManager)

  // Detect all running gateways
  await gatewayManager.detectAllOnStartup()

  // Start all gateways that aren't running
  await gatewayManager.startAll()
}

bootstrap()
