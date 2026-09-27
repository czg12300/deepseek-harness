/** Private account operations and state for one settings-page instance. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AccountView, AccountPrompt, AttemptId, ConnectEvent, PromptId, ProviderId } from '@deepseek-ai/dsh-third-party-auth/types'
import type { AccountKey } from './locales.ts'

/** The page's transport abstraction, implemented with the generated Remote contribution. */
export interface AccountOperations {
  changes(signal: AbortSignal): AsyncIterable<number>
  list(signal: AbortSignal): Promise<AccountView[]>
  connect(id: ProviderId, signal: AbortSignal): AsyncIterable<ConnectEvent>
  answer(attempt: AttemptId, prompt: PromptId, answer: string): Promise<void>
  disconnect(id: ProviderId): Promise<void>
  selectModel(id: ProviderId, model: string, signal: AbortSignal): Promise<void>
}
/** Observable state; secrets remain in the transient input element, never this store. */
export interface AccountPageState {
  accounts: AccountView[]
  loading: boolean
  busy: boolean
  message: AccountKey | null
  active: ProviderId | null
  url: string | null
  code: string | null
  notice: string | null
  prompt: { id: PromptId; value: AccountPrompt } | null
}

/** Own private login streams independently of React render cycles. */
export class AccountPageStore {
  /** Observable account cards and current authorization guidance. */
  readonly state = createSnapshotStore<AccountPageState>({
    accounts: [], loading: true, busy: false, message: null, active: null, url: null, code: null, notice: null, prompt: null,
  })
  private lifetime = new AbortController()
  private login: AbortController | undefined
  private attempt: AttemptId | undefined
  private revision = 0

  /** @param operations - secret-free reads and private authorization calls. */
  constructor(private readonly operations: AccountOperations) {}

  /**
   * Refresh while this page is open; close its login when the page leaves.
   * @returns the disposer for the page-owned subscription.
   */
  watch(): () => void {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    void (async () => {
      for await (const _marker of this.operations.changes(signal)) {
        if (signal.aborted) return
        await this.load()
      }
    })().catch(() => {
      if (!signal.aborted) this.state.update((value) => { value.loading = false; value.message = 'failed' })
    })
    return () => { controller.abort(); this.cancel() }
  }

  /** Load current account facts; stale requests cannot overwrite newer reads. */
  async load(): Promise<void> {
    const revision = ++this.revision
    try {
      const accounts = await this.operations.list(this.lifetime.signal)
      if (revision === this.revision && !this.lifetime.signal.aborted) {
        this.state.update((value) => { value.accounts = accounts; value.loading = false })
      }
    } catch {
      if (revision === this.revision && !this.lifetime.signal.aborted) {
        this.state.update((value) => { value.loading = false; value.message = 'failed' })
      }
    }
  }

  /** Start the chosen account authorization.
   * @param provider - account whose official flow to start.
   */
  async connect(provider: ProviderId): Promise<void> {
    if (this.login !== undefined) return
    const login = new AbortController()
    this.login = login
    const signal = AbortSignal.any([login.signal, this.lifetime.signal])
    this.state.update((value) => { value.active = provider; value.message = null; value.busy = true })
    try {
      for await (const event of this.operations.connect(provider, signal)) {
        if (signal.aborted) break
        switch (event.kind) {
          case 'started': this.attempt = event.attemptId; break
          case 'notice':
            this.state.update((value) => {
              value.notice = event.notice.message
              if (event.notice.url !== undefined && new URL(event.notice.url).protocol === 'https:') value.url = event.notice.url
              if (event.notice.code !== undefined) value.code = event.notice.code
            }); break
          case 'prompt': this.state.update((value) => { value.prompt = { id: event.id, value: event.prompt } }); break
          case 'withdrawn': this.state.update((value) => { if (value.prompt?.id === event.id) value.prompt = null }); break
          case 'settled': this.revision++; this.state.update((value) => {
            const account = value.accounts.find(account => account.id === provider)
            if (account !== undefined) {
              account.connecting = false
              if (event.status === 'connected') {
                account.connected = true
                account.enabled = true
              }
            }
            value.message = event.status === 'connected' ? 'connectedNotice' : event.status === 'cancelled' ? 'cancelled'
              : event.reason === 'timeout' ? 'loginTimedOut' : event.reason === 'activation' ? 'activationFailed'
                : event.reason === 'authorization' ? 'authorizationFailed' : 'failed'
          }); break
        }
      }
    } catch {
      if (!this.lifetime.signal.aborted) this.state.update((value) => { value.message = signal.aborted ? 'cancelled' : 'failed' })
    } finally {
      this.login = undefined
      this.attempt = undefined
      this.state.update((value) => {
        value.active = null; value.busy = false; value.url = null; value.code = null; value.notice = null; value.prompt = null
      })
      if (!this.lifetime.signal.aborted) await this.load()
    }
  }

  /** Withdraw the page-owned login stream. */
  cancel(): void { this.login?.abort() }

  /**
   * Submit the transient prompt input without retaining it in observable state.
   * @param text - user input.
   */
  async answer(text: string): Promise<void> {
    const prompt = this.state.getSnapshot().prompt
    if (this.attempt === undefined || prompt === null) return
    try { await this.operations.answer(this.attempt, prompt.id, text) }
    catch { this.state.update((value) => { value.message = 'failed' }) }
  }

  /** Disable one account for this integration.
   * @param id - connected account.
   */
  async disconnect(id: ProviderId): Promise<void> {
    await this.write(() => this.operations.disconnect(id), 'disconnectedNotice')
  }

  /**
   * Persist a provider-local default model.
   * @param id - connected account.
   * @param model - discovered model id.
   */
  async selectModel(id: ProviderId, model: string): Promise<void> {
    await this.write(() => this.operations.selectModel(id, model, this.lifetime.signal), 'saved')
  }

  /** Stop requests and discard private authorization prompts when the page closes. */
  dispose(): void { this.revision++; this.lifetime.abort(); this.cancel() }

  private async write(operation: () => Promise<void>, message: AccountKey): Promise<void> {
    if (this.state.getSnapshot().busy) return
    this.state.update((value) => { value.busy = true; value.message = null })
    try { await operation(); this.state.update((value) => { value.message = message }) }
    catch { this.state.update((value) => { value.message = 'failed' }) }
    finally { this.state.update((value) => { value.busy = false }); await this.load() }
  }
}
