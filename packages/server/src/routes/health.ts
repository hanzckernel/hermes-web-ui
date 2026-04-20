import Router from '@koa/router'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { getGatewayManager } from './hermes/gateways'
import * as hermesCli from '../services/hermes/hermes-cli'
import { config } from '../config'

function getLocalVersion(): string {
  const candidates = [
    resolve(__dirname, '../../../package.json'),
    resolve(__dirname, '../../../../package.json'),
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

export async function checkLatestVersion(): Promise<void> {
  try {
    const res = await fetch('https://registry.npmjs.org/hermes-web-ui/latest', {
      signal: AbortSignal.timeout(5000),
      headers: { 'Cache-Control': 'no-cache' },
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

export function startVersionCheck(): void {
  checkLatestVersion()
  setInterval(checkLatestVersion, 60 * 60 * 1000)
}

export const healthRoutes = new Router()

healthRoutes.get('/health', async (ctx) => {
  const raw = await hermesCli.getVersion()
  const hermesVersion = raw.split('\n')[0].replace('Hermes Agent ', '') || ''

  let gatewayOk = false
  try {
    const mgr = getGatewayManager()
    const upstream = mgr?.getUpstream() || config.upstream
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
})
