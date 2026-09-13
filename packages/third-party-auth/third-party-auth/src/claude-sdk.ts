/** Metadata queries through the official SDK with managed native process ownership. */
import { EventEmitter } from 'node:events'
import { query, type SpawnedProcess, type SpawnOptions, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Context } from '@deepseek-ai/cordis'
import { scrubbedParentEnv, type SubprocessHandle, type SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { AccountModel } from './types.ts'
import { claudeExecutable, type ClaudeConfig } from './claude-runtime.ts'

/** SDK process interface backed by the shared managed subprocess service. */
class NativeProcess extends EventEmitter implements SpawnedProcess {
  readonly stdin
  readonly stdout
  readonly stderr
  private result: SubprocessOutcome | undefined
  killed = false
  constructor(readonly child: SubprocessHandle) {
    super()
    if (child.stdin === undefined || child.stdout === undefined || child.stderr === undefined) {
      throw new Error('native SDK requires all three managed pipes')
    }
    this.stdin = child.stdin
    this.stdout = child.stdout
    this.stderr = child.stderr
    void child.done.then((outcome) => {
      this.result = outcome
      this.emit('exit', outcome.exitCode, outcome.signal)
    }, (error: unknown) => { this.emit('error', error) })
  }
  get exitCode(): number | null { return this.result?.exitCode ?? null }
  get signalCode(): NodeJS.Signals | null { return this.result?.signal ?? null }
  kill(): boolean { this.killed = true; this.child.terminate(); return true }
}

/**
 * Read the native model catalog without submitting an inference prompt.
 * @param ctx - managed subprocess service.
 * @param config - runtime limits and metadata working directory.
 * @param signal - caller lifetime.
 * @returns models reported by the pinned native runtime, not an entitlement guarantee.
 */
export async function claudeModels(ctx: Context, config: ClaudeConfig, signal: AbortSignal): Promise<AccountModel[]> {
  const abort = new AbortController()
  async function* input(): AsyncGenerator<never> {
    if (!abort.signal.aborted) await new Promise<void>(resolve => abort.signal.addEventListener('abort', () => resolve(), { once: true }))
  }
  const native = await startNativeQuery(ctx, config, input(), { persistSession: false },
    AbortSignal.any([signal, AbortSignal.timeout(config.statusTimeoutMs)]))
  try { return (await native.query.supportedModels()).map(model => ({ id: model.value, name: model.displayName })) }
  finally { abort.abort(); await native.close() }
}

/**
 * Start one official query while retaining managed ownership of every spawned process.
 * @param ctx - managed subprocess service.
 * @param config - runtime limits.
 * @param prompt - user input or streaming input source.
 * @param options - native per-query choices and transcript mirror.
 * @param signal - owner cancellation.
 * @returns the official query and asynchronous whole-process cleanup.
 */
export async function startNativeQuery(
  ctx: Context, config: ClaudeConfig, prompt: string | AsyncIterable<SDKUserMessage>, options: Options, signal: AbortSignal,
): Promise<{ query: Query; close(): Promise<void> }> {
  signal.throwIfAborted()
  const executable = claudeExecutable()
  if (executable === undefined) throw new Error('Claude runtime is not installed')
  const abort = new AbortController()
  const lifetime = AbortSignal.any([signal, abort.signal])
  const processes: SubprocessHandle[] = []
  let runner: Query
  try {
    runner = query({ prompt, options: {
      ...options, cwd: options.cwd ?? config.cwd, pathToClaudeCodeExecutable: executable,
      abortController: abort, env: { ...scrubbedParentEnv(),
        ...(config.nativeConfigDir === undefined ? {} : { CLAUDE_CONFIG_DIR: config.nativeConfigDir }) },
      spawnClaudeCodeProcess(options: SpawnOptions): SpawnedProcess {
        const env: NodeJS.ProcessEnv = { ...options.env }
        for (const key of Object.keys(scrubbedParentEnv())) if (!(key in options.env)) env[key] = undefined
        const child = ctx.subprocess.spawn({ argv: [options.command, ...options.args], cwd: options.cwd ?? config.cwd,
          graceMs: config.graceMs, signal: lifetime, env,
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })
        processes.push(child)
        return new NativeProcess(child)
      },
    } })
  } catch (error) {
    abort.abort()
    for (const process of processes) process.terminate()
    await Promise.all(processes.map(process => process.waitForExit()))
    throw error
  }
  return { query: runner, async close() {
    abort.abort(); runner.close()
    for (const process of processes) process.terminate()
    await Promise.all(processes.map(process => process.waitForExit()))
  } }
}
