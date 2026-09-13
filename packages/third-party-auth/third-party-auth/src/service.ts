/** Account registry and durable connection preferences, independent of browser transport. */
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { AccountProvider, AccountSettings, AccountView, AttemptId, ConnectEvent, ProviderId, PromptId } from './types.ts'
import { ConnectAttempt } from './attempt.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { thirdPartyAuth: ThirdPartyAuth }
}

/** Deployment limits for user-guided authorization. */
export interface Config { connectTimeoutMs: number; maxQueuedEvents: number }

/** Own account registration, preferences, and cancellable connection attempts. */
export class ThirdPartyAuth extends Service {
  static inject = ['settings']
  static Config: Schema<Config> = Schema.object({
    connectTimeoutMs: Schema.number().min(1).max(2_147_483_647).default(180_000),
    maxQueuedEvents: Schema.number().min(4).max(1024).step(1).default(64),
  })
  private readonly providers = new Map<ProviderId, AccountProvider>()
  private readonly attempts = new Map<ProviderId, { attempt: ConnectAttempt; done: Promise<void> }>()
  private readonly readers = new Set<() => void>()
  private readonly lifetime = new AbortController()
  /** Non-secret connection intent and per-account default selection. */
  readonly preferences: SettingsScope<AccountSettings>

  /**
   * Register account preferences and own outstanding work until quiescence.
   * @param ctx - plugin context with durable settings.
   * @param config - validated authorization limits.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'thirdPartyAuth')
    this.preferences = ctx.settings.register('third-party-auth', Schema.object({
      accounts: Schema.dict(Schema.object({
        enabled: Schema.boolean().default(false), model: Schema.string(), managedRoute: Schema.boolean(),
      })).default({}),
    }))
    ctx.effect(() => this.preferences.watch(() => this.changed()), 'third-party-auth: preference invalidation')
    ctx.on('credentials/record-updated', () => this.changed())
    ctx.effect(() => async () => {
      this.lifetime.abort()
      this.readers.clear()
      const active = [...this.attempts.values()]
      for (const { attempt } of active) attempt.controller.abort()
      await Promise.all(active.map(entry => entry.done))
    }, 'third-party-auth: settle attempts')
  }

  /**
   * Follow coalesced account invalidations without disclosing prompts or credentials.
   * @param signal - subscribing page lifetime.
   * @returns an initial readiness marker and subsequent refresh markers.
   */
  async *changes(signal: AbortSignal): AsyncIterable<number> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.(); wake = undefined }
    this.readers.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!signal.aborted) {
        if (dirty) { dirty = false; yield 0 }
        else await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally { this.readers.delete(changed); signal.removeEventListener('abort', changed) }
  }

  /**
   * Contribute one account provider until its plugin unloads.
   * @param provider - owner of native login and routing.
   * @returns asynchronous disposer that waits for its login to stop.
   */
  register(provider: AccountProvider): () => Promise<void> {
    if (this.providers.has(provider.id)) throw new Error('account provider already registered')
    return this.ctx.effect(() => {
      this.providers.set(provider.id, provider)
      return async () => {
        this.providers.delete(provider.id)
        const running = this.attempts.get(provider.id)
        running?.attempt.controller.abort()
        await running?.done
      }
    }, 'third-party-auth: provider')
  }

  /**
   * Describe authentication and catalog failures independently.
   * @param signal - cancellation of this read.
   * @returns secret-free provider cards.
   */
  async list(signal: AbortSignal): Promise<AccountView[]> {
    return Promise.all([...this.providers.values()].map(async (provider) => {
      const preference = this.preferences.get().accounts[provider.id]
      let status: Awaited<ReturnType<AccountProvider['status']>>
      try { status = await provider.status(signal) }
      catch {
        // Native diagnostics can include credential material; one provider's failure must not hide the other card.
        signal.throwIfAborted()
        status = { connected: false, unavailable: 'status-failed' }
      }
      let models: AccountView['models'] = []
      let catalogFailed = false
      if (status.connected && preference?.enabled === true) {
        try { models = await provider.models(signal) }
        catch {
          // Discovery failure is independent of the already observed authentication state.
          signal.throwIfAborted()
          catalogFailed = true
        }
      }
      return { ...status, id: provider.id, enabled: preference?.enabled === true,
        connecting: this.attempts.has(provider.id), models, catalogFailed,
        ...(preference?.model === undefined ? {} : { model: preference.model }) }
    }))
  }

  /**
   * Stream one private authorization conversation and enable only its committed result.
   * @param id - installed account provider.
   * @param signal - originating stream lifetime.
   * @returns notices, prompts, and terminal outcome.
   */
  async *connect(id: ProviderId, signal: AbortSignal): AsyncIterable<ConnectEvent> {
    const provider = this.require(id)
    if (this.attempts.has(id)) throw new Error('account authorization already running')
    const attempt = new ConnectAttempt(signal, this.config.connectTimeoutMs, this.config.maxQueuedEvents)
    const done = Promise.resolve().then(async () => {
      let status: 'connected' | 'cancelled' | 'failed' = 'failed'
      try {
        attempt.signal.throwIfAborted()
        if (await provider.connect(attempt)) {
          attempt.signal.throwIfAborted()
          await provider.activate(attempt.signal)
          attempt.signal.throwIfAborted()
          await this.preferences.update({ accounts: { [id]: { enabled: true } } })
          if (attempt.signal.aborted) {
            await this.preferences.update({ accounts: { [id]: { enabled: false } } })
            await provider.deactivate()
            attempt.signal.throwIfAborted()
          }
          status = 'connected'
        } else status = 'cancelled'
      } catch {
        // Native login failures may contain credentials; the UI receives only a fixed outcome.
        status = attempt.signal.aborted ? 'cancelled' : 'failed'
      } finally {
        this.attempts.delete(id)
        this.changed()
        attempt.push({ kind: 'settled', status })
        attempt.close()
      }
    })
    this.attempts.set(id, { attempt, done })
    this.changed()
    try { yield* attempt.stream() } finally { attempt.controller.abort(); await done }
  }

  /**
   * Reply through the capability delivered on the initiating stream.
   * @param attemptId - unguessable live attempt capability.
   * @param promptId - prompt carried by that attempt.
   * @param answer - user's answer; never persisted.
   */
  answer(attemptId: AttemptId, promptId: PromptId, answer: string): void {
    const entry = [...this.attempts.values()].find(item => item.attempt.id === attemptId)
    if (entry === undefined) throw new Error('authorization attempt is no longer available')
    entry.attempt.answer(promptId, answer)
  }

  /**
   * Disable this integration without signing out other native clients.
   * @param id - account to disconnect.
   */
  async disconnect(id: ProviderId): Promise<void> {
    const provider = this.require(id)
    const running = this.attempts.get(id)
    running?.attempt.controller.abort()
    await running?.done
    await this.preferences.update({ accounts: { [id]: { enabled: false } } })
    await provider.deactivate()
  }

  /**
   * Save a discovered model for future sessions of this provider.
   * @param id - connected provider.
   * @param model - exact catalog model id.
   * @param signal - cancellation of model discovery.
   */
  async selectModel(id: ProviderId, model: string, signal: AbortSignal): Promise<void> {
    if (this.preferences.get().accounts[id]?.enabled !== true) throw new Error('account is not connected')
    const provider = this.require(id)
    if (!(await provider.models(signal)).some(entry => entry.id === model)) throw new Error('model is unavailable')
    await this.preferences.update({ accounts: { [id]: { model } } })
  }

  private require(id: ProviderId): AccountProvider {
    const provider = this.providers.get(id)
    if (provider === undefined) throw new Error('account provider is not installed')
    return provider
  }

  private changed(): void { for (const wake of this.readers) wake() }
}
