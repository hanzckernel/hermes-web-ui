import { execFileSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, dirname, join } from 'path'

let updateInProgress = false

function getNodeBinDir() {
  return dirname(process.execPath)
}

function getNodePrefix() {
  return process.platform === 'win32' ? getNodeBinDir() : dirname(getNodeBinDir())
}

function getHomebrewPrefix() {
  const match = process.execPath.match(/^(.*)\/Cellar\/[^/]+\/[^/]+\/bin\/node$/)
  return match?.[1] || null
}

function getNpmCliCandidates() {
  const prefix = getNodePrefix()
  const homebrewPrefix = getHomebrewPrefix()

  return process.platform === 'win32'
    ? [
        join(prefix, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        join(getNodeBinDir(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ]
    : [
        join(prefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        ...(homebrewPrefix ? [join(homebrewPrefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')] : []),
      ]
}

function getNpmCliPath() {
  const candidates = getNpmCliCandidates()
  const npmCli = candidates.find(existsSync)

  return npmCli || null
}

function getNpmBinCandidate() {
  return join(getNodeBinDir(), process.platform === 'win32' ? 'npm.cmd' : 'npm')
}

function getNpmBinPath() {
  const npmBin = getNpmBinCandidate()
  return existsSync(npmBin) ? npmBin : null
}

function getGlobalPackageBin(root: string) {
  return join(root, 'hermes-web-ui', 'bin', 'hermes-web-ui.mjs')
}

function getCurrentNodeEnv() {
  return {
    ...process.env,
    PATH: [getNodeBinDir(), process.env.PATH].filter(Boolean).join(delimiter),
    npm_node_execpath: process.execPath,
  }
}

function quoteCmdArg(value: string) {
  return /[\s&()^|<>"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function getNpmInvocation(args: string[]) {
  const npmCli = getNpmCliPath()
  if (npmCli) {
    return { command: process.execPath, args: [npmCli, ...args] }
  }

  const npmBin = getNpmBinPath()
  if (!npmBin) {
    throw new Error(`Unable to locate npm for ${process.execPath}`)
  }

  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
    return { command: comspec, args: ['/d', '/s', '/c', [npmBin, ...args].map(quoteCmdArg).join(' ')] }
  }

  return { command: npmBin, args }
}

function runNpm(args: string[], options: { timeout?: number } = {}) {
  const npm = getNpmInvocation(args)

  return execFileSync(npm.command, npm.args, {
    encoding: 'utf-8',
    timeout: options.timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: getCurrentNodeEnv(),
  }).trim()
}

function getGlobalRoot() {
  return runNpm(['root', '-g'])
}

function getGlobalCliScript() {
  const cli = getGlobalPackageBin(getGlobalRoot())
  if (!existsSync(cli)) {
    throw new Error(`Updated hermes-web-ui CLI not found: ${cli}`)
  }
  return cli
}

function runUpdateInstall() {
  try {
    runNpm(['cache', 'clean', '--force'], { timeout: 2 * 60 * 1000 })
  } catch (err) {
    console.warn('[update] failed to clean npm cache, continuing update:', err)
  }

  return runNpm(['install', '-g', 'hermes-web-ui@latest'], { timeout: 10 * 60 * 1000 })
}

function spawnRestart(port: string) {
  const cli = getGlobalCliScript()

  return spawn(process.execPath, [cli, 'restart', '--port', port], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: getCurrentNodeEnv(),
  })
}

export async function handleUpdate(ctx: any) {
  if (updateInProgress) {
    ctx.status = 409
    ctx.body = {
      success: false,
      message: 'hermes-web-ui update is already in progress',
    }
    return
  }

  updateInProgress = true

  try {
    const output = runUpdateInstall()

    ctx.body = {
      success: true,
      message: output.trim() || 'hermes-web-ui updated successfully',
    }

    setTimeout(() => {
      let restart
      try {
        restart = spawnRestart(process.env.PORT || '8648')
      } catch (err) {
        updateInProgress = false
        console.error('[update] failed to spawn restart:', err)
        return
      }

      restart.on('error', (err) => {
        updateInProgress = false
        console.error('[update] restart process failed:', err)
      })
      restart.on('exit', (code, signal) => {
        updateInProgress = false
        const failed = (typeof code === 'number' && code !== 0) || Boolean(signal)
        if (failed) {
          console.error(`[update] restart process exited before replacing server: code=${code} signal=${signal}`)
        }
      })
      restart.unref()
    }, 3000)
  } catch (err: any) {
    updateInProgress = false
    ctx.status = 500
    ctx.body = {
      success: false,
      message: err.stderr?.toString() || err.message || String(err),
    }
  }
}
