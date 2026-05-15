import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodePath from 'path'

type UpdateControllerMocks = {
  execFileSync: ReturnType<typeof vi.fn>
  spawn: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  existsSync: ReturnType<typeof vi.fn>
}

type PathApi = Pick<typeof nodePath, 'delimiter' | 'dirname' | 'join'>

type LoadOptions = {
  platform?: NodeJS.Platform
  execPath?: string
  pathApi?: PathApi
  execFileSync?: ReturnType<typeof vi.fn>
  spawn?: ReturnType<typeof vi.fn>
  existsSync?: ReturnType<typeof vi.fn>
}

const originalPort = process.env.PORT
const originalPath = process.env.PATH
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const originalExecPathDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

function createMockCtx() {
  return {
    status: 200,
    body: null as unknown,
  }
}

function mockChildProcess() {
  const child = {
    unref: vi.fn(),
    on: vi.fn(),
  }
  child.on.mockReturnValue(child)
  return child
}

function mockExistingPaths(paths: string[]) {
  const existing = new Set(paths)
  return vi.fn((candidate: string) => existing.has(candidate))
}

function setProcessRuntime(platform: NodeJS.Platform, execPath: string) {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  })
  Object.defineProperty(process, 'execPath', {
    configurable: true,
    value: execPath,
  })
}

function restoreProcessRuntime() {
  if (originalPlatformDescriptor) Object.defineProperty(process, 'platform', originalPlatformDescriptor)
  if (originalExecPathDescriptor) Object.defineProperty(process, 'execPath', originalExecPathDescriptor)
}

async function loadUpdateController(options: LoadOptions = {}) {
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath
  const pathApi = options.pathApi ?? nodePath
  const restart = mockChildProcess()
  const execFileSync = options.execFileSync ?? vi.fn().mockReturnValue('updated')
  const spawn = options.spawn ?? vi.fn(() => restart)
  const existsSync = options.existsSync ?? vi.fn(() => true)

  vi.resetModules()
  setProcessRuntime(platform, execPath)
  vi.doMock('child_process', () => ({ execFileSync, spawn }))
  vi.doMock('fs', () => ({ existsSync }))
  vi.doMock('path', () => ({
    delimiter: pathApi.delimiter,
    dirname: pathApi.dirname,
    join: pathApi.join,
  }))

  const mod = await import('../../packages/server/src/controllers/update')
  return {
    ...mod,
    mocks: { execFileSync, spawn, unref: restart.unref, on: restart.on, existsSync } as UpdateControllerMocks,
  }
}

function makeNpmExecutor(globalRoot: string) {
  return vi.fn((_command: string, args: string[]) => {
    const joinedArgs = args.join(' ')
    if (args.includes('cache') || /\bcache\b/.test(joinedArgs)) return ''
    if (args.includes('root') || /\broot\b/.test(joinedArgs)) return globalRoot
    if (args.includes('install') || /\binstall\b/.test(joinedArgs)) return 'updated'
    throw new Error(`unexpected npm args: ${joinedArgs}`)
  })
}

function expectPathChecked(mock: ReturnType<typeof vi.fn>, expectedPath: string) {
  expect(mock.mock.calls.some(([candidate]) => candidate === expectedPath)).toBe(true)
}

describe('update controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('child_process')
    vi.doUnmock('fs')
    vi.doUnmock('path')
    restoreProcessRuntime()
    if (originalPort === undefined) {
      delete process.env.PORT
    } else {
      process.env.PORT = originalPort
    }
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
  })

  afterAll(() => {
    exitSpy.mockRestore()
  })

  it('installs through the current Node npm-cli and restarts the updated global package script', async () => {
    process.env.PORT = '9129'
    const pathApi = nodePath.posix
    const execPath = '/opt/node/bin/node'
    const npmCli = '/opt/node/lib/node_modules/npm/bin/npm-cli.js'
    const globalRoot = '/opt/node/lib/node_modules'
    const cliScript = '/opt/node/lib/node_modules/hermes-web-ui/bin/hermes-web-ui.mjs'
    const execFileSync = makeNpmExecutor(globalRoot)

    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'linux',
      execPath,
      pathApi,
      execFileSync,
      existsSync: mockExistingPaths([npmCli, cliScript]),
    })
    const ctx = createMockCtx()

    await handleUpdate(ctx)

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      execPath,
      [npmCli, 'install', '-g', 'hermes-web-ui@latest'],
      expect.objectContaining({
        encoding: 'utf-8',
        timeout: 10 * 60 * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.objectContaining({
          npm_node_execpath: execPath,
          PATH: expect.stringMatching(new RegExp(`^${escapeRegExp(pathApi.dirname(execPath))}${pathApi.delimiter}`)),
        }),
      }),
    )
    expect(ctx.body).toEqual({ success: true, message: 'updated' })

    vi.runAllTimers()

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      execPath,
      [npmCli, 'root', '-g'],
      expect.objectContaining({ env: expect.objectContaining({ npm_node_execpath: execPath }) }),
    )
    expect(mocks.spawn).toHaveBeenCalledWith(
      execPath,
      [cliScript, 'restart', '--port', '9129'],
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: true }),
    )
    expect(mocks.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(mocks.on).toHaveBeenCalledWith('exit', expect.any(Function))
    expect(mocks.unref).toHaveBeenCalledOnce()
    expect(exitSpy).not.toHaveBeenCalled()
  })


  it('falls back to the default port when PORT is not set', async () => {
    delete process.env.PORT
    const { handleUpdate, mocks } = await loadUpdateController()
    const ctx = createMockCtx()

    await handleUpdate(ctx)
    vi.runAllTimers()

    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.any(String), 'restart', '--port', '8648'],
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: true }),
    )
  })

  it('does not log a restart error when the restart helper exits successfully', async () => {
    const handlers = new Map<string, (...args: any[]) => void>()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const restart = {
      unref: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler)
        return restart
      }),
    }
    const spawn = vi.fn(() => restart)
    const { handleUpdate } = await loadUpdateController({ spawn })
    const ctx = createMockCtx()

    await handleUpdate(ctx)
    vi.runAllTimers()
    handlers.get('exit')?.(0, null)

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('finds Homebrew npm-cli outside the Node Cellar path before resolving the global package root', async () => {
    const pathApi = nodePath.posix
    const execPath = '/opt/homebrew/Cellar/node/25.7.0/bin/node'
    const cellarNpmCli = '/opt/homebrew/Cellar/node/25.7.0/lib/node_modules/npm/bin/npm-cli.js'
    const homebrewNpmCli = '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js'
    const globalRoot = '/opt/homebrew/lib/node_modules'
    const cliScript = '/opt/homebrew/lib/node_modules/hermes-web-ui/bin/hermes-web-ui.mjs'
    const execFileSync = makeNpmExecutor(globalRoot)

    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'darwin',
      execPath,
      pathApi,
      execFileSync,
      existsSync: mockExistingPaths([homebrewNpmCli, cliScript]),
    })

    await handleUpdate(createMockCtx())
    vi.runAllTimers()

    expectPathChecked(mocks.existsSync, cellarNpmCli)
    expectPathChecked(mocks.existsSync, homebrewNpmCli)
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      execPath,
      [homebrewNpmCli, 'install', '-g', 'hermes-web-ui@latest'],
      expect.any(Object),
    )
    expect(mocks.spawn).toHaveBeenCalledWith(
      execPath,
      [cliScript, 'restart', '--port', '8648'],
      expect.any(Object),
    )
  })

  it('uses a co-located Windows npm.cmd fallback through cmd.exe and restarts the package script without invoking a cmd shim', async () => {
    process.env.PORT = '9444'
    const pathApi = nodePath.win32
    const execPath = 'C:\\Program Files\\nodejs\\node.exe'
    const nodeBinDir = pathApi.dirname(execPath)
    const npmCmd = pathApi.join(nodeBinDir, 'npm.cmd')
    const globalRoot = 'C:\\Users\\han\\AppData\\Roaming\\npm\\node_modules'
    const cliScript = pathApi.join(globalRoot, 'hermes-web-ui', 'bin', 'hermes-web-ui.mjs')
    const execFileSync = makeNpmExecutor(globalRoot)

    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'win32',
      execPath,
      pathApi,
      execFileSync,
      existsSync: mockExistingPaths([npmCmd, cliScript]),
    })

    await handleUpdate(createMockCtx())
    vi.runAllTimers()

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/s', '/c', `"${npmCmd}" install -g hermes-web-ui@latest`],
      expect.objectContaining({
        env: expect.objectContaining({
          npm_node_execpath: execPath,
          PATH: expect.stringMatching(new RegExp(`^${escapeRegExp(nodeBinDir)}${pathApi.delimiter}`)),
        }),
      }),
    )
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/s', '/c', `"${npmCmd}" root -g`],
      expect.any(Object),
    )
    expect(mocks.spawn).toHaveBeenCalledWith(
      execPath,
      [cliScript, 'restart', '--port', '9444'],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('uses Termux npm-cli and npm root -g to avoid hard-coded lib/node_modules guesses', async () => {
    const pathApi = nodePath.posix
    const execPath = '/data/data/com.termux/files/usr/bin/node'
    const npmCli = '/data/data/com.termux/files/usr/lib/node_modules/npm/bin/npm-cli.js'
    const globalRoot = '/data/data/com.termux/files/usr/lib/node_modules'
    const cliScript = '/data/data/com.termux/files/usr/lib/node_modules/hermes-web-ui/bin/hermes-web-ui.mjs'
    const execFileSync = makeNpmExecutor(globalRoot)

    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'linux',
      execPath,
      pathApi,
      execFileSync,
      existsSync: mockExistingPaths([npmCli, cliScript]),
    })

    await handleUpdate(createMockCtx())
    vi.runAllTimers()

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      execPath,
      [npmCli, 'root', '-g'],
      expect.any(Object),
    )
    expect(mocks.spawn).toHaveBeenCalledWith(
      execPath,
      [cliScript, 'restart', '--port', '8648'],
      expect.any(Object),
    )
  })

  it('uses a co-located Linux npm executable fallback without resolving npm from PATH', async () => {
    const pathApi = nodePath.posix
    const execPath = '/usr/bin/node'
    const npmBin = '/usr/bin/npm'
    const globalRoot = '/usr/lib/node_modules'
    const cliScript = '/usr/lib/node_modules/hermes-web-ui/bin/hermes-web-ui.mjs'
    const execFileSync = makeNpmExecutor(globalRoot)

    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'linux',
      execPath,
      pathApi,
      execFileSync,
      existsSync: mockExistingPaths([npmBin, cliScript]),
    })

    await handleUpdate(createMockCtx())
    vi.runAllTimers()

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      npmBin,
      ['install', '-g', 'hermes-web-ui@latest'],
      expect.any(Object),
    )
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      npmBin,
      ['root', '-g'],
      expect.any(Object),
    )
    expect(mocks.spawn).toHaveBeenCalledWith(
      execPath,
      [cliScript, 'restart', '--port', '8648'],
      expect.any(Object),
    )
  })

  it('fails closed when neither npm-cli nor a co-located npm executable exists', async () => {
    const execPath = '/isolated/node/bin/node'
    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'linux',
      execPath,
      pathApi: nodePath.posix,
      existsSync: mockExistingPaths([]),
    })
    const ctx = createMockCtx()

    await handleUpdate(ctx)

    expect(ctx.status).toBe(500)
    expect(ctx.body).toEqual({
      success: false,
      message: expect.stringContaining(`Unable to locate npm for ${execPath}`),
    })
    expect(mocks.execFileSync).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('does not kill the current server when the updated CLI script cannot be resolved after install', async () => {
    const execPath = '/opt/node/bin/node'
    const npmCli = '/opt/node/lib/node_modules/npm/bin/npm-cli.js'
    const execFileSync = makeNpmExecutor('/opt/node/lib/node_modules')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'linux',
      execPath,
      pathApi: nodePath.posix,
      execFileSync,
      existsSync: mockExistingPaths([npmCli]),
    })
    const ctx = createMockCtx()

    await handleUpdate(ctx)
    vi.runAllTimers()

    expect(ctx.body).toEqual({ success: true, message: 'updated' })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[update] failed to spawn restart:', expect.any(Error))
    consoleError.mockRestore()
  })

  it('rejects duplicate in-app update requests until the delegated restart finishes or fails', async () => {
    const execPath = '/opt/node/bin/node'
    const npmCli = '/opt/node/lib/node_modules/npm/bin/npm-cli.js'
    const globalRoot = '/opt/node/lib/node_modules'
    const cliScript = '/opt/node/lib/node_modules/hermes-web-ui/bin/hermes-web-ui.mjs'
    const execFileSync = makeNpmExecutor(globalRoot)
    const { handleUpdate, mocks } = await loadUpdateController({
      platform: 'linux',
      execPath,
      pathApi: nodePath.posix,
      execFileSync,
      existsSync: mockExistingPaths([npmCli, cliScript]),
    })
    const first = createMockCtx()
    const second = createMockCtx()

    await handleUpdate(first)
    await handleUpdate(second)

    expect(second.status).toBe(409)
    expect(second.body).toEqual({
      success: false,
      message: 'hermes-web-ui update is already in progress',
    })

    vi.runAllTimers()
    const exitHandler = mocks.on.mock.calls.find(([event]) => event === 'exit')?.[1] as (code: number, signal: string | null) => void
    exitHandler(1, null)

    const third = createMockCtx()
    await handleUpdate(third)
    expect(third.status).toBe(200)
    expect(third.body).toEqual({ success: true, message: 'updated' })
  })

  it('returns a 500 with stderr and resets the update lock when installation fails', async () => {
    const execFileSync = vi.fn(() => {
      const error = new Error('install failed') as Error & { stderr?: Buffer }
      error.stderr = Buffer.from('engine mismatch')
      throw error
    })
    const { handleUpdate, mocks } = await loadUpdateController({ execFileSync })
    const failed = createMockCtx()

    await handleUpdate(failed)

    expect(failed.status).toBe(500)
    expect(failed.body).toEqual({ success: false, message: 'engine mismatch' })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()

    const retry = createMockCtx()
    await handleUpdate(retry)
    expect(retry.status).toBe(500)
    expect(retry.body).toEqual({ success: false, message: 'engine mismatch' })
  })
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
