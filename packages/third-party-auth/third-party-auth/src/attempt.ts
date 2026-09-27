/** Bounded, initiator-owned authorization stream and prompt lifetime. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization/types'
import type { AccountPrompt, AttemptId, ConnectEvent, ConnectInteraction, PromptId } from './types.ts'

/** Own one login's queue, cancellation, and outstanding questions. */
export class ConnectAttempt<Extra = never> implements ConnectInteraction {
  /** Capability disclosed only to the initiating stream. */
  readonly id: AttemptId = brandString<AttemptId>(randomUUID())
  /** Cancellation owned by the attempt and its initiating stream. */
  readonly controller = new AbortController()
  readonly signal = this.controller.signal
  private readonly events: Array<ConnectEvent | Extra> = []
  private readonly prompts = new Map<PromptId, { answer: (text: string) => void }>()
  private wake: (() => void) | undefined
  private ended = false
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly withdraw: () => void

  /**
   * Tie the login to its originating stream and a deployment timeout.
   * @param parent - caller stream lifetime.
   * @param timeoutMs - maximum authorization duration.
   * @param maxEvents - maximum queued notices and prompts.
   */
  constructor(private readonly parent: AbortSignal, timeoutMs: number, private readonly maxEvents: number) {
    this.withdraw = () => { this.controller.abort() }
    parent.addEventListener('abort', this.withdraw, { once: true })
    if (parent.aborted) this.withdraw()
    this.timer = setTimeout(() => {
      this.controller.abort(new DOMException('Account authorization timed out', 'TimeoutError'))
    }, timeoutMs)
    this.push({ kind: 'started', attemptId: this.id })
  }

  /** @param notice - provider-owned guidance, delivered only to the initiating stream. */
  notify(notice: AuthorizationNotice): void { this.push({ kind: 'notice', notice }) }

  /**
   * Await an answer or withdrawal of this particular prompt.
   * @param prompt - provider question, optionally carrying its own cancellation.
   * @returns the submitted answer.
   */
  async prompt(prompt: AuthorizationPrompt): Promise<string> {
    const signal = prompt.signal === undefined ? this.signal : AbortSignal.any([this.signal, prompt.signal])
    signal.throwIfAborted()
    const id = brandString<PromptId>(randomUUID())
    const view: AccountPrompt = prompt.kind === 'select'
      ? { kind: prompt.kind, message: prompt.message, options: prompt.options }
      : { kind: prompt.kind, message: prompt.message, ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }) }
    let cancel = (): void => {}
    try {
      return await new Promise<string>((resolve, reject) => {
        cancel = () => { reject(new Error('authorization prompt withdrawn')) }
        signal.addEventListener('abort', cancel, { once: true })
        this.prompts.set(id, {
          answer: (text) => {
            if (prompt.kind === 'select' && !prompt.options.some(option => option.id === text)) {
              throw new Error('invalid authorization choice')
            }
            resolve(text)
          },
        })
        this.push({ kind: 'prompt', id, prompt: view })
      })
    } finally {
      signal.removeEventListener('abort', cancel)
      this.prompts.delete(id)
      this.push({ kind: 'withdrawn', id })
    }
  }

  /**
   * Answer a live prompt; stale or foreign identifiers fail closed.
   * @param id - prompt from this stream.
   * @param text - user's answer.
   */
  answer(id: PromptId, text: string): void {
    this.signal.throwIfAborted()
    const pending = this.prompts.get(id)
    if (pending === undefined) throw new Error('authorization prompt is no longer available')
    pending.answer(text)
    this.prompts.delete(id)
  }

  /** Enqueue bounded authorization guidance.
   * @param event - private-stream event.
   */
  push(event: ConnectEvent): void {
    if (this.ended) return
    if (this.events.length >= this.maxEvents) {
      this.controller.abort()
      if (event.kind !== 'settled') return
      this.events.shift()
    }
    this.events.push(event)
    this.wake?.()
    this.wake = undefined
  }

  /** Enqueue a caller-owned stream payload.
   * @param event - bounded payload.
   */
  emit(event: Extra): void {
    if (this.ended) return
    if (this.events.length >= this.maxEvents) { this.controller.abort(); return }
    this.events.push(event)
    this.wake?.()
    this.wake = undefined
  }

  /**
   * Publish a terminal caller event even when the consumer exceeded its queue budget.
   * @param event - final caller-owned outcome.
   */
  finish(event: Extra): void {
    if (this.ended) return
    if (this.events.length >= this.maxEvents) this.events.shift()
    this.events.push(event)
    this.close()
  }

  /** Read the private event stream.
   * @returns ordered notices and prompts until settlement.
   */
  async *stream(): AsyncGenerator<ConnectEvent | Extra> {
    while (!this.ended || this.events.length > 0) {
      const event = this.events.shift()
      if (event !== undefined) yield event
      else await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }

  /** Release timers, parent subscriptions, and pending questions after provider settlement. */
  close(): void {
    this.ended = true
    this.controller.abort()
    clearTimeout(this.timer)
    this.parent.removeEventListener('abort', this.withdraw)
    this.wake?.()
    this.wake = undefined
  }
}
