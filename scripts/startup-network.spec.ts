/** Startup proxy discovery respects explicit routes and keeps local callback traffic direct. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareStartupProxy, type StartupProxyOptions } from './startup-network.mjs'

const execFileAsync = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-startup-network-'))
  roots.push(root)
  const userHome = join(root, 'user')
  const dataHome = join(root, 'checkout with spaces', '.dsh-local')
  await mkdir(join(userHome, '.dsh'), { recursive: true })
  await mkdir(dataHome, { recursive: true })
  const probe = vi.fn(async () => {})
  const options: StartupProxyOptions = { userHome, dataHome, environment: {}, platform: 'linux', probe }
  return { root, userHome, dataHome, probe, options }
}

const mac = (port: number) => `<dictionary> {
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : ${port}
  HTTPSEnable : 1
  HTTPSProxy : 127.0.0.1
  HTTPSPort : ${port}
  ExceptionsList : <array> { 0 : *.local
  }
}`

describe('source launcher proxy preparation', () => {
  it('uses the shared home after DSH_HOME changes without copying unrelated values or writing a local file', async () => {
    const f = await fixture()
    const shared = join(f.userHome, '.dsh', '.env')
    const original = 'HTTP_PROXY=http://127.0.0.1:7890\nHTTPS_PROXY=http://127.0.0.1:7890\nAPI_KEY=private-value\n'
    await writeFile(shared, original)
    const result = await prepareStartupProxy(f.options)
    expect(result.source).toBe(shared)
    expect(result.env).toMatchObject({ HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890' })
    expect(result.env).not.toHaveProperty('API_KEY')
    expect(result.env.NO_PROXY).toContain('localhost')
    expect(result.env.NO_PROXY).toContain('127.0.0.1')
    expect(result.env.NO_PROXY).toContain('::1')
    expect(f.probe).toHaveBeenCalledTimes(1)
    expect(await readFile(shared, 'utf8')).toBe(original)
    await expect(readFile(join(f.dataHome, '.env'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(shared, 'HTTPS_PROXY=http://127.0.0.1:7891\n')
    expect((await prepareStartupProxy(f.options)).env.HTTPS_PROXY).toBe('http://127.0.0.1:7891')
  })

  it('keeps launch-environment routes ahead of home files and never logs proxy credentials', async () => {
    const f = await fixture()
    await writeFile(join(f.dataHome, '.env'), 'HTTP_PROXY=http://home.example:80\n')
    const result = await prepareStartupProxy({ ...f.options, environment: {
      HTTP_PROXY: 'http://ignored.example:80', http_proxy: 'http://user:private-password@proxy.example:8080',
      NO_PROXY: 'intranet.example',
    } })
    expect(result.env.HTTP_PROXY).toBe(result.env.http_proxy)
    expect(result.messages.join('\n')).toContain('lowercase setting takes precedence')
    expect(result.env.HTTPS_PROXY).toBe('http://user:private-password@proxy.example:8080')
    expect(result.env.NO_PROXY).toContain('intranet.example')
    expect(result.messages.join('\n')).not.toContain('private-password')
    expect(result.messages.join('\n')).toContain('http://proxy.example:8080')
  })

  it('honors a current-home proxy without consulting a different shared home', async () => {
    const f = await fixture()
    await writeFile(join(f.dataHome, '.env'), 'HTTPS_PROXY=https://local.example:8443\n')
    await writeFile(join(f.userHome, '.dsh', '.env'), 'HTTPS_PROXY=http://shared.example:80\n')
    expect((await prepareStartupProxy(f.options)).env.HTTPS_PROXY).toBe('https://local.example:8443')
  })

  it('fails an explicit unreachable proxy instead of switching routes', async () => {
    const f = await fixture()
    const systemProxy = vi.fn(async () => mac(7890))
    f.probe.mockRejectedValue(new Error('listener unavailable'))
    await expect(prepareStartupProxy({ ...f.options, platform: 'darwin', systemProxy,
      environment: { HTTPS_PROXY: 'http://explicit.example:80' },
    })).rejects.toThrow('listener unavailable')
    expect(systemProxy).not.toHaveBeenCalled()
  })

  it('replaces an unreachable automatically discovered shared proxy with the live system proxy', async () => {
    const f = await fixture()
    await writeFile(join(f.userHome, '.dsh', '.env'), 'HTTPS_PROXY=http://old.example:80\n')
    f.probe.mockRejectedValueOnce(new Error('old endpoint unavailable'))
    const result = await prepareStartupProxy({ ...f.options, platform: 'darwin', systemProxy: async () => mac(7891) })
    expect(result.env.HTTPS_PROXY).toBe('http://127.0.0.1:7891')
    expect(result.env.NO_PROXY).toContain('*.local')
    expect(result.messages.join('\n')).toContain('Shared proxy unavailable')
  })

  it('does not silently fall back to direct networking after a failed discovered proxy', async () => {
    const f = await fixture()
    await writeFile(join(f.userHome, '.dsh', '.env'), 'HTTP_PROXY=http://old.example:80\n')
    f.probe.mockRejectedValue(new Error('closed'))
    await expect(prepareStartupProxy(f.options)).rejects.toThrow('closed')
  })

  it('supports intentional direct mode even when proxy configuration is broken', async () => {
    const f = await fixture()
    const result = await prepareStartupProxy({ ...f.options,
      environment: { DSH_STARTUP_PROXY: 'direct', HTTP_PROXY: 'broken', https_proxy: 'socks5://localhost:1234' },
    })
    expect(result.env).toMatchObject({ HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '' })
    expect(f.probe).not.toHaveBeenCalled()
  })

  it('uses direct routing when no proxy was configured and preserves NO_PROXY=* without claiming a listener probe', async () => {
    const f = await fixture()
    expect((await prepareStartupProxy(f.options)).env.HTTPS_PROXY).toBe('')
    const result = await prepareStartupProxy({ ...f.options, environment: { HTTPS_PROXY: 'http://proxy.example:80', NO_PROXY: '*' } })
    expect(result.messages.join('\n')).toContain('bypasses all proxies')
    expect(result.messages.join('\n')).not.toContain('listener reachable')
    expect(f.probe).not.toHaveBeenCalled()
  })

  it.each(['SOCKSEnable', 'ProxyAutoConfigEnable'])('reports unsupported system-only %s routing', async (name) => {
    const f = await fixture()
    await expect(prepareStartupProxy({ ...f.options, platform: 'darwin', systemProxy: async () => `${name} : 1` }))
      .rejects.toThrow('PAC/SOCKS')
  })

  it.each(['not-a-url', 'socks5://localhost:7890', 'http://localhost:bad'])('rejects invalid explicit proxy %s', async (proxy) => {
    const f = await fixture()
    await expect(prepareStartupProxy({ ...f.options, environment: { HTTPS_PROXY: proxy } })).rejects.toThrow('HTTPS_PROXY')
    expect(f.probe).not.toHaveBeenCalled()
  })

  it('refuses delimiter injection from dotenv values and treats shell syntax as data', async () => {
    const f = await fixture()
    await writeFile(join(f.dataHome, '.env'), 'HTTPS_PROXY="http://localhost:7890\0NODE_OPTIONS\0injected"\n')
    await expect(prepareStartupProxy(f.options)).rejects.toThrow('control characters')
    await writeFile(join(f.dataHome, '.env'), 'HTTPS_PROXY="http://user:$(id)@proxy.example:8080"\n')
    const result = await prepareStartupProxy(f.options)
    expect(result.env.HTTPS_PROXY).toContain('$(id)')
    expect(result.messages.join('\n')).not.toContain('$(id)')
  })

  it.each([{ DSH_STARTUP_PROXY: 'typo' }, { DSH_STARTUP_PROXY_TIMEOUT_MS: '0' }, { DSH_STARTUP_PROXY_TIMEOUT_MS: 'nan' }])('rejects invalid launcher options %j', async (environment) => {
    const f = await fixture()
    await expect(prepareStartupProxy({ ...f.options, environment })).rejects.toThrow('DSH_STARTUP_PROXY')
  })

  it.skipIf(process.platform === 'win32')('runs the real startup preflight without installing packages or starting the application', async () => {
    const f = await fixture()
    const server = createServer((socket) => { socket.end() })
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('TCP listener address unavailable')
      const excluded = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'DSH_STARTUP_PROXY', 'DSH_STARTUP_PROXY_TIMEOUT_MS'])
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !excluded.has(key)))
      env.DSH_HOME = f.dataHome
      env.HTTPS_PROXY = `http://127.0.0.1:${address.port}`
      const { stdout } = await execFileAsync('bash', [resolve('startup.sh'), '--check-network'], { env })
      expect(stdout).toContain('Proxy source: launch environment')
      expect(stdout).toContain('Proxy listener reachable')
      expect(stdout).not.toContain('Building native modules')
      expect(stdout).not.toContain('Starting Web UI')
    } finally {
      await new Promise<void>((resolveClose, reject) => { server.close((error) => { if (error) reject(error); else resolveClose() }) })
    }
  })
})
