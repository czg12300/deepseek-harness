/** Pinned official Claude runtime discovery and managed CLI invocations. */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import type { AccountProvider, ConnectInteraction } from './types.ts'

/** Limits and native working directory for account metadata and official sign-in. */
export interface ClaudeConfig { cwd: string; graceMs: number; statusTimeoutMs: number; outputBytes: number; nativeConfigDir?: string }
const statusSchema = z.object({ loggedIn: z.boolean(), authMethod: z.string(), apiProvider: z.string(), email: z.string().optional() })

/**
 * Resolve the CLI carried by the pinned SDK rather than searching the user's PATH.
 * @returns installed executable path, or undefined when its platform payload is absent.
 */
export function claudeExecutable(): string | undefined {
  const root = dirname(realpathSync(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'))))
  const report = process.platform === 'linux' ? process.report.getReport() as { header: { glibcVersionRuntime?: string } } : undefined
  const libc = report !== undefined && report.header.glibcVersionRuntime === undefined ? '-musl' : ''
  const executable = join(root, '..', `claude-agent-sdk-${process.platform}-${process.arch}${libc}`,
    process.platform === 'win32' ? 'claude.exe' : 'claude')
  return existsSync(executable) ? executable : undefined
}

/** Own the official CLI process through the existing subprocess service. */
export class ClaudeRuntime {
  /**
   * @param ctx - Host context carrying the managed subprocess provider.
   * @param config - native execution limits.
   */
  constructor(private readonly ctx: Context, private readonly config: ClaudeConfig) {}

  /**
   * Run native account status, returning only declared account fields.
   * @param signal - initiating caller cancellation.
   * @returns authenticated native account facts, never tokens or native paths.
   */
  async status(signal: AbortSignal): Promise<z.infer<typeof statusSchema>> {
    const child = this.spawn(['auth', 'status', '--json'], AbortSignal.any([
      signal, AbortSignal.timeout(this.config.statusTimeoutMs),
    ]), false)
    try {
      const outcome = await child.done
      if (outcome.signal !== null || (outcome.exitCode !== 0 && outcome.exitCode !== 1)) {
        throw new Error('Claude account status failed')
      }
      const output = child.collected.stdout?.readFrom(0)
      if (output === undefined || output.lossy) throw new Error('Claude account status output unavailable')
      return statusSchema.parse(JSON.parse(output.text))
    } finally { child.terminate(); await child.waitForExit() }
  }

  /**
   * Let the unmodified CLI own browser sign-in and credential persistence.
   * @param interaction - private login stream and lifetime.
   * @returns true only after CLI success and native status confirmation.
   */
  async login(interaction: ConnectInteraction): Promise<boolean> {
    const child = this.spawn(['auth', 'login', '--claudeai'], interaction.signal, true)
    if (child.stdout === undefined) {
      child.terminate()
      await child.waitForExit()
      throw new Error('Claude login requires a managed stdout pipe')
    }
    const lines = createInterface({ input: child.stdout })
    try {
      for await (const line of lines) {
        if (Buffer.byteLength(line, 'utf8') > this.config.outputBytes) throw new Error('Claude login output limit exceeded')
        const candidate = /https:\/\/[^\s]+/.exec(line)?.[0]
        if (candidate !== undefined) {
          const url = new URL(candidate)
          if (url.hostname === 'claude.ai' || url.hostname === 'platform.claude.com' || url.hostname === 'console.anthropic.com') {
            interaction.notify({ message: 'Complete sign-in in the official Claude browser flow.', url: url.href })
          }
        }
      }
      const outcome = await child.done
      interaction.signal.throwIfAborted()
      if (outcome.exitCode !== 0) throw new Error('Claude sign-in failed')
      return (await this.status(interaction.signal)).loggedIn
    } finally { lines.close(); child.terminate(); await child.waitForExit() }
  }

  private spawn(args: string[], signal: AbortSignal, stream: boolean): SubprocessHandle {
    signal.throwIfAborted()
    const executable = claudeExecutable()
    if (executable === undefined) throw new Error('Claude runtime is not installed')
    return this.ctx.subprocess.spawn({
      argv: [executable, ...args], cwd: this.config.cwd, graceMs: this.config.graceMs, signal,
      ...(this.config.nativeConfigDir === undefined ? {} : { env: { CLAUDE_CONFIG_DIR: this.config.nativeConfigDir } }),
      stdio: { stdin: 'ignore', stdout: stream ? 'pipe' : { maxBytes: this.config.outputBytes },
        stderr: { maxBytes: this.config.outputBytes } },
    })
  }
}

/**
 * Create a native account provider, leaving token storage to official Claude Code.
 * @param runtime - managed native CLI operations.
 * @param models - SDK catalog reader, called only for a connected account.
 * @returns native account connection operations.
 */
export function claudeProvider(runtime: ClaudeRuntime, models: AccountProvider['models']): AccountProvider {
  return {
    id: 'claude',
    async status(signal) {
      if (claudeExecutable() === undefined) return { connected: false, unavailable: 'runtime-missing' }
      const status = await runtime.status(signal)
      return { connected: status.loggedIn, ...(status.email === undefined ? {} : { email: status.email }) }
    },
    models,
    connect: interaction => runtime.login(interaction),
    async activate(signal) {
      if (!(await runtime.status(signal)).loggedIn) throw new Error('Claude native sign-in is required')
    },
    async deactivate() { /* Harness connection preferences are separate from the native account shared with other tools. */ },
  }
}
