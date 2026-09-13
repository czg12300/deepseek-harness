/** Continuing Claude conversations owned by the optional plugin, outside the default Agent factory. */
import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { NativeStore } from './native-store.ts'
import { ConnectAttempt } from './attempt.ts'
import { ClaudeRuntime, type ClaudeConfig } from './claude-runtime.ts'
import { startNativeQuery, claudeModels } from './claude-sdk.ts'
import type { AttemptId, ClaudeMessage, ClaudeSessionId, ClaudeSessionView, ClaudeTurnEvent, PromptId } from './types.ts'
import type {} from './service.ts'

declare module '@deepseek-ai/cordis' { interface Context { thirdPartyClaude: NativeSessions } }

/** Native storage and bounded streaming choices. */
export interface NativeSessionConfig extends ClaudeConfig {
  databasePath: string
  turnTimeoutMs: number
  maxTurnEvents: number
}
type OutputEvent = Exclude<ClaudeTurnEvent, { kind: 'started' | 'notice' | 'prompt' | 'withdrawn' | 'settled' }>
const messageSchema = z.object({
  content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())]),
})
const questionsSchema = z.object({ questions: z.array(z.object({ question: z.string() }).passthrough()) })

/** Own native turns, transcript storage, and private approval interactions. */
export class NativeSessions extends Service {
  static inject = ['thirdPartyAuth', 'subprocess']
  private database: NativeStore | undefined
  private readonly active = new Map<ClaudeSessionId, { channel: ConnectAttempt<OutputEvent>; done: Promise<void> }>()
  private readonly runtime: ClaudeRuntime

  /**
   * @param ctx - plugin-scoped authorization and subprocess services.
   * @param config - native storage location and execution limits.
   */
  constructor(ctx: Context, private readonly config: NativeSessionConfig) {
    super(ctx, 'thirdPartyClaude')
    this.runtime = new ClaudeRuntime(ctx, config)
    ctx.effect(() => ctx.thirdPartyAuth.preferences.watch(async (preferences) => {
      if (preferences.accounts.claude?.enabled !== true) await this.stop()
    }), 'third-party-auth: native connection withdrawal')
    ctx.effect(() => async () => {
      const running = [...this.active.values()]
      for (const entry of running) entry.channel.controller.abort()
      await Promise.all(running.map(entry => entry.done))
      this.database?.close()
    }, 'third-party-auth: native session lifetime')
  }

  /** List this integration's native conversations.
   * @returns plugin-owned native conversations, without scanning other Claude sessions.
   */
  list(): ClaudeSessionView[] { return this.store().list() }

  /**
   * Create a conversation in the workspace the user selected.
   * @param cwd - absolute existing workspace directory.
   * @param model - native catalog model.
   * @param signal - caller cancellation.
   * @returns persisted native session metadata.
   */
  async create(cwd: string, model: string, signal: AbortSignal): Promise<ClaudeSessionView> {
    await this.connected(signal)
    if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('workspace must be an absolute directory')
    if (!(await claudeModels(this.ctx, this.config, signal)).some(item => item.id === model)) throw new Error('model is unavailable')
    return this.store().create(cwd, model)
  }

  /**
   * Project readable text from the native mirror, preserving raw records for official resume.
   * @param id - plugin-owned native conversation.
   * @returns user and assistant text from the native main transcript.
   */
  history(id: ClaudeSessionId): ClaudeMessage[] {
    return this.store().records(id).flatMap((entry) => {
      if (entry.type !== 'user' && entry.type !== 'assistant') return []
      const message = messageSchema.safeParse(entry.message)
      if (!message.success) return []
      const content = message.data.content
      const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
      return text.length === 0 ? [] : [{ role: entry.type, text }]
    })
  }

  /**
   * Run a turn using official native resume and stream its output and approval questions.
   * @param id - plugin-owned native conversation.
   * @param text - the user's next message.
   * @param model - model fixed for this turn.
   * @param signal - initiating stream lifetime.
   * @returns output and private approval events until the native process exits.
   */
  async *turn(id: ClaudeSessionId, text: string, model: string, signal: AbortSignal): AsyncIterable<ClaudeTurnEvent> {
    if (this.active.has(id)) throw new Error('native session is busy')
    if (!text.trim()) throw new Error('message is empty')
    const session = this.store().get(id)
    const channel = new ConnectAttempt<OutputEvent>(signal, this.config.turnTimeoutMs, this.config.maxTurnEvents)
    const run = async (): Promise<void> => {
      let native: Awaited<ReturnType<typeof startNativeQuery>> | undefined
      let outcome: 'success' | 'cancelled' | 'failed' = 'failed'
      try {
        await this.connected(channel.signal)
        if (!(await claudeModels(this.ctx, this.config, channel.signal)).some(item => item.id === model)) {
          throw new Error('native model is unavailable')
        }
        const hasHistory = this.store().records(id).length > 0
        native = await startNativeQuery(this.ctx, this.config, text, {
          cwd: session.cwd, model, ...(hasHistory ? { resume: id } : { sessionId: id }),
          sessionStore: this.store(), sessionStoreFlush: 'eager', includePartialMessages: true,
          permissionMode: 'default',
          canUseTool: async (tool, input, request) => {
            if (tool === 'AskUserQuestion') {
              const questions = questionsSchema.parse(input)
              const answers: Array<[string, string]> = []
              for (const item of questions.questions) answers.push([item.question, await channel.prompt({
                kind: 'text', message: item.question, signal: request.signal,
              })])
              return { behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(answers) } }
            }
            const answer = await channel.prompt({ kind: 'select', signal: request.signal,
              message: `${tool}\n${JSON.stringify(input)}`, options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] })
            return answer === 'allow' ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'The user denied this operation.' }
          },
        }, channel.signal)
        const streamed = new Set<string>()
        let currentMessage = ''
        for await (const message of native.query) {
          if (message.type === 'stream_event') {
            if (message.event.type === 'message_start') currentMessage = message.event.message.id
            if (message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
              streamed.add(currentMessage)
              channel.emit({ kind: 'text', text: message.event.delta.text })
            }
          } else if (message.type === 'assistant') {
            for (const block of message.message.content) {
              if (block.type === 'text' && !streamed.has(message.message.id)) channel.emit({ kind: 'text', text: block.text })
              if (block.type === 'tool_use') channel.emit({ kind: 'tool', name: block.name })
            }
          } else if (message.type === 'result') {
            outcome = message.subtype === 'success' && !message.is_error ? 'success' : 'failed'
          } else if (message.type === 'system' && message.subtype === 'mirror_error') {
            throw new Error('native transcript could not be mirrored')
          }
        }
        channel.signal.throwIfAborted()
        this.store().touch(id, model, text)
      } catch {
        // Raw native exceptions can include credential or environment details; expose only the turn outcome.
        outcome = channel.signal.aborted ? 'cancelled' : 'failed'
      } finally {
        await native?.close()
        this.active.delete(id)
        channel.finish({ kind: 'completed', outcome })
      }
    }
    const done = Promise.resolve().then(() => this.config.databasePath === ':memory:' ? run()
      : withFileLock(`${this.config.databasePath}.${id}.turn`, run, { waitMs: 0 })).catch(() => {
      this.active.delete(id)
      channel.finish({ kind: 'completed', outcome: channel.signal.aborted ? 'cancelled' : 'failed' })
    })
    this.active.set(id, { channel, done })
    try { yield* channel.stream() } finally { channel.controller.abort(); await done }
  }

  /**
   * Answer a pending native approval or question from its owning stream.
   * @param attempt - private turn capability.
   * @param prompt - pending question identity.
   * @param answer - user response.
   */
  answer(attempt: AttemptId, prompt: PromptId, answer: string): void {
    const running = [...this.active.values()].find(entry => entry.channel.id === attempt)
    if (running === undefined) throw new Error('native turn is no longer available')
    running.channel.answer(prompt, answer)
  }

  /**
   * Stop the turn owned by one private stream and wait for native process cleanup.
   * @param attempt - capability delivered to the turn's initiating client.
   */
  async cancel(attempt: AttemptId): Promise<void> {
    const running = [...this.active.values()].find(entry => entry.channel.id === attempt)
    if (running === undefined) return
    running.channel.controller.abort()
    await running.done
  }

  /** Stop all plugin-owned native turns before disconnecting this integration. */
  async stop(): Promise<void> {
    const running = [...this.active.values()]
    for (const entry of running) entry.channel.controller.abort()
    await Promise.all(running.map(entry => entry.done))
  }

  private store(): NativeStore { return this.database ??= new NativeStore(this.config.databasePath) }

  private async connected(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const status = await this.runtime.status(signal)
    if (this.ctx.thirdPartyAuth.preferences.get().accounts.claude?.enabled !== true
      || !status.loggedIn) throw new Error('Claude connection is not enabled')
  }
}
