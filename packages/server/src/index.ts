import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from '@koa/bodyparser'
import serve from 'koa-static'
import send from 'koa-send'
import os from 'os'
import { resolve } from 'path'
import { mkdir } from 'fs/promises'
import { config } from './config'
import { hermesRoutes, setupTerminalWebSocket, proxyMiddleware } from './routes/hermes'
import { uploadRoutes } from './routes/upload'
import { webhookRoutes } from './routes/webhook'
import { updateRoutes } from './routes/update'
import { healthRoutes, startVersionCheck } from './routes/health'
import { getToken, authMiddleware } from './services/auth'
import { initGatewayManager } from './services/gateway-bootstrap'
import { bindShutdown } from './services/shutdown'

let server: any = null

export async function bootstrap() {
  await mkdir(config.uploadDir, { recursive: true })
  await mkdir(config.dataDir, { recursive: true })

  const authToken = await getToken()
  const app = new Koa()

  if (authToken) {
    app.use(await authMiddleware(authToken))
    console.log(`🔐 Auth enabled — token: ${authToken}`)
  }

  await initGatewayManager()
  app.use(cors({ origin: config.corsOrigins }))
  app.use(bodyParser())

  // Shared routes (no agent prefix)
  app.use(webhookRoutes.routes())
  app.use(uploadRoutes.routes())
  app.use(updateRoutes.routes())

  // Hermes routes (must be after update — proxy catch-all matches everything)
  app.use(hermesRoutes.routes())
  app.use(proxyMiddleware)

  // Health check
  app.use(healthRoutes.routes())

  // SPA fallback
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

  // Start server
  server = app.listen(config.port, '0.0.0.0')

  setupTerminalWebSocket(server)

  server.on('listening', () => {
    const interfaces = os.networkInterfaces()
    const localIp = Object.values(interfaces).flat().find(i => i?.family === 'IPv4' && !i?.internal)?.address || 'localhost'
    console.log(`➜ Server: http://localhost:${config.port} (LAN: http://${localIp}:${config.port})`)
    console.log(`➜ Upstream: ${config.upstream}`)
  })

  server.on('error', (err: any) => {
    console.error('Server error:', err.message)
  })

  bindShutdown(server)
  startVersionCheck()
}

bootstrap()
