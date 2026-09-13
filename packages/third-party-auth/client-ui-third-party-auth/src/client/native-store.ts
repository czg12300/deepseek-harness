/** Client state for the independently mounted native Claude conversation window. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AccountModel, AccountPrompt, AttemptId, ClaudeMessage, ClaudeSessionId, ClaudeSessionView, ClaudeTurnEvent, PromptId } from '@deepseek-ai/dsh-third-party-auth/types'

/** Native conversation transport, distinct from the default Harness Session API. */
export interface NativeOperations {
  list(): Promise<ClaudeSessionView[]>
  create(cwd: string, model: string, signal: AbortSignal): Promise<ClaudeSessionView>
  history(id: ClaudeSessionId): Promise<ClaudeMessage[]>
  turn(id: ClaudeSessionId, text: string, model: string, signal: AbortSignal): AsyncIterable<ClaudeTurnEvent>
  answer(attempt: AttemptId, prompt: PromptId, answer: string): Promise<void>
  cancel(attempt: AttemptId): Promise<void>
}
/** The native workspace's observable state. */
export interface NativePageState {
  open: boolean
  sessions: ClaudeSessionView[]
  session: ClaudeSessionView | null
  models: AccountModel[]
  model: string
  cwd: string
  messages: ClaudeMessage[]
  streaming: string
  tool: string | null
  busy: boolean
  failed: boolean
  cancelled: boolean
  prompt: { id: PromptId; value: AccountPrompt } | null
}

/** Own a native conversation view and its single initiating stream. */
export class NativePageStore {
  /** Observable native workspace view, excluding private answer values. */
  readonly state = createSnapshotStore<NativePageState>({
    open: false, sessions: [], session: null, models: [], model: '', cwd: '', messages: [], streaming: '', tool: null,
    busy: false, failed: false, cancelled: false, prompt: null,
  })
  private running: AbortController | undefined
  private attempt: AttemptId | undefined
  private revision = 0
  private disposed = false

  /** @param operations - native-session Remote calls. */
  constructor(private readonly operations: NativeOperations) {}

  /**
   * Open the separate native conversation workspace without replacing the current Harness Session.
   * @param model - account default.
   * @param models - discovered native models.
   * @param cwd - currently selected workspace, if known.
   */
  async open(model: string, models: AccountModel[], cwd: string): Promise<void> {
    await this.stop()
    this.state.update((value) => {
      value.open = true; value.models = models; value.model = model; value.cwd = cwd; value.failed = false
      value.session = null; value.messages = []; value.streaming = ''; value.cancelled = false
    })
    try {
      const sessions = await this.operations.list()
      if (!this.disposed) this.state.update((value) => { value.sessions = sessions })
    } catch { if (!this.disposed) this.state.update((value) => { value.failed = true }) }
  }

  /**
   * Reopen one persisted native conversation.
   * @param session - an entry returned by the native session list.
   */
  async select(session: ClaudeSessionView): Promise<void> {
    if (this.running) return
    const revision = ++this.revision
    try {
      const messages = await this.operations.history(session.id)
      if (revision === this.revision && !this.disposed) this.state.update((value) => {
        value.session = session; value.cwd = session.cwd; value.model = session.model; value.messages = messages; value.failed = false
      })
    } catch { if (revision === this.revision) this.state.update((value) => { value.failed = true }) }
  }

  /** Prepare an empty native conversation without discarding persisted history. */
  fresh(): void {
    if (this.running) return
    this.revision++
    this.state.update((value) => { value.session = null; value.messages = []; value.streaming = ''; value.failed = false })
  }

  /**
   * Run one native turn and refresh its durable transcript afterward.
   * @param text - explicit user message.
   */
  async send(text: string): Promise<void> {
    if (this.running || !text.trim()) return
    const controller = new AbortController()
    this.running = controller
    const { cwd, model } = this.state.getSnapshot()
    let session = this.state.getSnapshot().session
    this.state.update((value) => { value.busy = true; value.failed = false; value.cancelled = false; value.streaming = '' })
    try {
      session ??= await this.operations.create(cwd, model, controller.signal)
      const owned = session
      this.state.update((value) => { value.session = owned; value.messages.push({ role: 'user', text }) })
      for await (const event of this.operations.turn(owned.id, text, model, controller.signal)) {
        if (controller.signal.aborted) break
        switch (event.kind) {
          case 'started': this.attempt = event.attemptId; break
          case 'text': this.state.update((value) => { value.streaming += event.text }); break
          case 'tool': this.state.update((value) => { value.tool = event.name }); break
          case 'prompt': this.state.update((value) => { value.prompt = { id: event.id, value: event.prompt } }); break
          case 'withdrawn': this.state.update((value) => { if (value.prompt?.id === event.id) value.prompt = null }); break
          case 'completed': this.state.update((value) => { value.failed = event.outcome === 'failed'; value.cancelled = event.outcome === 'cancelled' }); break
          // Connection-only notices are part of the shared interaction channel, not native turn output.
          case 'notice': case 'settled': break
        }
      }
      if (!controller.signal.aborted) {
        const messages = await this.operations.history(owned.id)
        const sessions = await this.operations.list()
        if (!this.disposed && !controller.signal.aborted) this.state.update((value) => {
          value.messages = messages; value.sessions = sessions; value.streaming = ''
        })
      }
    } catch {
      if (!this.disposed) this.state.update((value) => {
        value.failed = !controller.signal.aborted; value.cancelled = controller.signal.aborted
      })
    } finally {
      this.running = undefined; this.attempt = undefined
      if (!this.disposed) this.state.update((value) => { value.busy = false; value.prompt = null; value.tool = null })
    }
  }

  /** Submit a private native permission or question response.
   * @param answer - user response.
   */
  async answer(answer: string): Promise<void> {
    const prompt = this.state.getSnapshot().prompt
    if (!this.attempt || !prompt) return
    try { await this.operations.answer(this.attempt, prompt.id, answer) }
    catch { this.state.update((value) => { value.failed = true }) }
  }

  /** Stop the active turn and await the Host's native-process cleanup acknowledgement. */
  async stop(): Promise<void> {
    const running = this.running
    if (running === undefined) return
    try { if (this.attempt !== undefined) await this.operations.cancel(this.attempt) }
    catch { if (!this.disposed) this.state.update((value) => { value.failed = true }) }
    finally { running.abort() }
  }
  /** Close only the plugin-owned conversation window and stop its active turn. */
  close(): void { this.revision++; void this.stop(); this.state.update((value) => { value.open = false }) }
  /** Release the plugin's stream when it unloads. */
  async dispose(): Promise<void> { this.disposed = true; await this.stop() }
}
