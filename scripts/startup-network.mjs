/** Resolve proxy settings for startup.sh before package dependencies are available. */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createConnection } from 'node:net'
import { parseEnv, promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const ROUTE_KEYS = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]']

/** Read only proxy variables; never execute a dotenv file or carry credentials from other fields. */
async function readProxyEnv(directory) {
  let text
  try { text = await readFile(join(directory, '.env'), 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error(`Cannot read proxy configuration in ${join(directory, '.env')}`)
  }
  const parsed = parseEnv(text)
  return Object.fromEntries([...ROUTE_KEYS, 'no_proxy', 'NO_PROXY'].filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]]))
}

function routeConfigured(env) { return ROUTE_KEYS.some(key => (env[key] ?? '').trim() !== '') }
function value(env, lower, upper) { return env[lower]?.trim() || env[upper]?.trim() || '' }

/** Only the URL authority is printed; proxy passwords and URL suffixes remain private. */
function describe(url) { return `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}` }

function proxyUrl(raw, field, source) {
  if (!raw) return undefined
  if (/[\0\r\n]/.test(raw)) throw new Error(`${source}: ${field} contains unsupported control characters`)
  let url
  try { url = new URL(raw) } catch { throw new Error(`${source}: ${field} is not a valid proxy URL`) }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error(`${source}: ${field} requires an http:// or https:// proxy; SOCKS and PAC are not supported by this launcher`)
  }
  return url
}

function resolved(env, source, noProxy) {
  if (/[\0\r\n]/.test(noProxy)) throw new Error(`${source}: NO_PROXY contains unsupported control characters`)
  const all = value(env, 'all_proxy', 'ALL_PROXY')
  const http = value(env, 'http_proxy', 'HTTP_PROXY') || all
  const https = value(env, 'https_proxy', 'HTTPS_PROXY') || all || http
  const httpUrl = proxyUrl(http, 'HTTP_PROXY', source)
  const httpsUrl = proxyUrl(https, 'HTTPS_PROXY', source)
  const bypass = [...new Set([...noProxy.split(',').map(item => item.trim()).filter(Boolean), ...LOOPBACK])].join(',')
  return {
    source,
    env: { HTTP_PROXY: http, http_proxy: http, HTTPS_PROXY: https, https_proxy: https,
      ALL_PROXY: '', all_proxy: '', NO_PROXY: bypass, no_proxy: bypass },
    endpoints: [...new Map([httpUrl, httpsUrl].filter(Boolean).map(url => [url.origin, url])).values()],
  }
}

/** macOS static HTTP proxies are usable by the backend; a PAC URL is not a proxy endpoint. */
function macProxy(text) {
  const field = name => new RegExp(`\\b${name}\\s*:\\s*([^\\r\\n]+)`).exec(text)?.[1].trim()
  const env = {}
  for (const [prefix, key] of [['HTTP', 'HTTP_PROXY'], ['HTTPS', 'HTTPS_PROXY']]) {
    if (field(`${prefix}Enable`) !== '1') continue
    const host = field(`${prefix}Proxy`)
    const port = field(`${prefix}Port`)
    if (!host || !port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error(`macOS ${prefix} proxy has an invalid host or port`)
    }
    const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    env[key] = `http://${authority}:${port}`
  }
  if (!routeConfigured(env) && (field('ProxyAutoConfigEnable') === '1' || field('SOCKSEnable') === '1')) {
    throw new Error('macOS has only a PAC/SOCKS proxy; set HTTP_PROXY or HTTPS_PROXY to its HTTP proxy endpoint')
  }
  const exceptions = /ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/.exec(text)?.[1] ?? ''
  env.NO_PROXY = [...exceptions.matchAll(/\d+\s*:\s*([^\r\n]+)/g)].map(match => match[1].trim()).join(',')
  return env
}

/** Probe the configured listener, not an arbitrary provider or authenticated URL. */
function probeProxy(url, timeoutMs) {
  return new Promise((resolveProbe, reject) => {
    const socket = createConnection({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) })
    const finish = (error) => {
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(new Error(`Proxy endpoint ${describe(url)} is not reachable (${error})`))
      else resolveProbe()
    }
    const timer = setTimeout(() => { finish('timeout') }, timeoutMs)
    socket.once('connect', () => { finish() })
    socket.once('error', error => { finish(error.code ?? 'connection failed') })
  })
}

/**
 * Select and validate this startup's proxy without editing either Harness home.
 * @param options - launch environment and injectable operating-system probes.
 * @returns normalized proxy variables and secret-free diagnostics.
 */
export async function prepareStartupProxy(options = {}) {
  const environment = options.environment ?? process.env
  const userHome = options.userHome ?? homedir()
  const expand = path => path === '~' ? userHome : path.startsWith('~/') ? join(userHome, path.slice(2)) : resolve(path)
  const dataHome = expand(options.dataHome ?? environment.DSH_HOME ?? join(process.cwd(), '.dsh-local'))
  const sharedHome = join(userHome, '.dsh')
  const mode = environment.DSH_STARTUP_PROXY ?? 'auto'
  if (!['auto', 'direct'].includes(mode)) throw new Error('DSH_STARTUP_PROXY must be auto or direct')
  const timeoutMs = Number(environment.DSH_STARTUP_PROXY_TIMEOUT_MS ?? '3000')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('DSH_STARTUP_PROXY_TIMEOUT_MS must be an integer from 1 to 60000')
  }
  const messages = []
  const checked = async (env, source, inheritedNoProxy = '') => {
    for (const [lower, upper] of [['http_proxy', 'HTTP_PROXY'], ['https_proxy', 'HTTPS_PROXY'], ['all_proxy', 'ALL_PROXY'], ['no_proxy', 'NO_PROXY']]) {
      if (env[lower]?.trim() && env[upper]?.trim() && env[lower].trim() !== env[upper].trim()) {
        messages.push(`[startup] Both ${lower} and ${upper} differ; the lowercase setting takes precedence.`)
      }
    }
    const config = resolved(env, source, inheritedNoProxy || value(env, 'no_proxy', 'NO_PROXY'))
    if (!config.env.NO_PROXY.split(',').includes('*')) {
      for (const endpoint of config.endpoints) await (options.probe ?? probeProxy)(endpoint, timeoutMs)
    }
    messages.push(`[startup] Proxy source: ${source}`)
    if (!config.env.NO_PROXY.split(',').includes('*')) {
      for (const endpoint of config.endpoints) messages.push(`[startup] Proxy listener reachable: ${describe(endpoint)}`)
    }
    if (config.env.NO_PROXY.split(',').includes('*')) messages.push('[startup] NO_PROXY=* bypasses all proxies.')
    messages.push('[startup] Loopback traffic bypasses the proxy. OAuth success still requires token exchange and credential storage.')
    return { source, env: config.env, messages }
  }
  if (mode === 'direct') {
    const config = resolved({}, 'explicit direct mode', '')
    return { source: config.source, env: config.env, messages: ['[startup] Direct networking explicitly selected.'] }
  }
  const active = await readProxyEnv(dataHome)
  const bypass = value(environment, 'no_proxy', 'NO_PROXY') || value(active, 'no_proxy', 'NO_PROXY')
  if (routeConfigured(environment)) return checked(environment, 'launch environment', bypass)
  if (routeConfigured(active)) return checked(active, join(dataHome, '.env'), bypass)
  let lastError
  if (resolve(sharedHome) !== resolve(dataHome)) {
    const shared = await readProxyEnv(sharedHome)
    if (routeConfigured(shared)) {
      try { return await checked(shared, join(sharedHome, '.env'), bypass) }
      catch (error) { lastError = error; messages.push(`[startup] Shared proxy unavailable: ${error.message}`) }
    }
  }
  if ((options.platform ?? process.platform) === 'darwin') {
    const text = options.systemProxy === undefined
      ? (await execFileAsync('/usr/sbin/scutil', ['--proxy'], { timeout: timeoutMs, maxBuffer: 64 * 1024 })).stdout
      : await options.systemProxy()
    const system = macProxy(text)
    if (routeConfigured(system)) return checked(system, 'macOS system proxy', bypass)
  }
  if (lastError) throw lastError
  const config = resolved({}, 'direct (no proxy configured)', bypass)
  messages.push('[startup] No HTTP proxy configured; using direct networking. Local VPN tunnel routing still applies.')
  return { source: config.source, env: config.env, messages }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const output = process.argv[2]
    if (!output || process.argv.length !== 3) throw new Error('Usage: node scripts/startup-network.mjs <private-env-output>')
    const result = await prepareStartupProxy()
    const payload = Object.entries(result.env).flatMap(([key, value]) => [key, value]).join('\0') + '\0'
    await writeFile(output, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    for (const message of result.messages) console.log(message)
  } catch (error) {
    console.error(`[startup] Network check failed: ${error.message}`)
    console.error('[startup] Fix the explicit proxy settings or start with DSH_STARTUP_PROXY=direct if direct routing is intentional.')
    process.exitCode = 1
  }
}
