/** Plugin-owned Remote methods; authorization messages never enter the shared event bus. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { AccountView, AttemptId, ConnectEvent, PromptId, ProviderId, ClaudeSessionId, ClaudeSessionView, ClaudeMessage, ClaudeTurnEvent } from './types.ts'
import type {} from './service.ts'
import type {} from './native-sessions.ts'
import type {} from '@deepseek-ai/dsh-host-webserver'

declare module '@deepseek-ai/cordis' {
  interface Context { thirdPartyAuthController: AccountController }
}
const providerSchema = z.enum(['chatgpt', 'claude'])

/**
 * Validate a model-facing or wire-owned value without returning raw parser input.
 * @param id - requested provider id.
 * @returns the supported provider identity.
 */
function provider(id: ProviderId): ProviderId {
  const result = providerSchema.safeParse(id)
  if (!result.success) throw new RemoteError('gateway/bad-request', 'Unknown account provider', {})
  return result.data
}

/** Transport consumer for the optional account service. */
export class AccountController extends TypertRemoteService {
  static inject = ['thirdPartyAuth', 'thirdPartyClaude']
  /** @param ctx - account service owned by this plugin. */
  constructor(ctx: Context) { super(ctx, 'thirdPartyAuthController', { namespace: 'thirdPartyAuth' }) }

  /**
   * Read account cards without exposing credentials.
   * @param signal - caller cancellation.
   * @returns provider status and discovered models.
   */
  @Remote
  list(signal: AbortSignal): Promise<AccountView[]> {
    this.requireLocalHost()
    return this.ctx.thirdPartyAuth.list(signal)
  }

  /**
   * Watch account invalidations independently of private authorization streams.
   * @param signal - page subscription lifetime.
   * @returns coalesced markers requesting a fresh account read.
   */
  @Remote({ mode: 'stream' })
  changes(signal: AbortSignal): AsyncIterable<number> {
    this.requireLocalHost()
    return this.ctx.thirdPartyAuth.changes(signal)
  }

  /**
   * Start a private login stream; closing it cancels its attempt.
   * @param id - account provider.
   * @param signal - stream lifetime.
   * @returns scoped authorization notices, prompts, and settlement.
   */
  @Remote({ mode: 'stream' })
  connect(id: ProviderId, signal: AbortSignal): AsyncIterable<ConnectEvent> {
    this.requireLocalHost()
    return this.ctx.thirdPartyAuth.connect(provider(id), signal)
  }

  /**
   * Submit an answer using the capability from the originating stream.
   * @param attemptId - opaque attempt capability.
   * @param promptId - pending prompt identity.
   * @param answer - user input, never returned or persisted.
   */
  @Remote
  answer(attemptId: AttemptId, promptId: PromptId, answer: string): void {
    this.requireLocalHost()
    if (!z.string().uuid().safeParse(attemptId).success || !z.string().uuid().safeParse(promptId).success
      || answer.length > 16_384) throw new RemoteError('gateway/bad-request', 'Invalid authorization answer', {})
    this.ctx.thirdPartyAuth.answer(attemptId, promptId, answer)
  }

  /**
   * Disconnect only this integration's account use.
   * @param id - connected account provider.
   */
  @Remote
  async disconnect(id: ProviderId): Promise<void> {
    this.requireLocalHost()
    await this.ctx.thirdPartyAuth.disconnect(provider(id))
    if (id === 'claude') await this.ctx.thirdPartyClaude.stop()
  }

  /**
   * Save one provider's default for future sessions.
   * @param id - connected provider.
   * @param model - discovered model id.
   * @param signal - caller cancellation.
   */
  @Remote
  selectModel(id: ProviderId, model: string, signal: AbortSignal): Promise<void> {
    this.requireLocalHost()
    return this.ctx.thirdPartyAuth.selectModel(provider(id), model, signal)
  }

  /** List native conversations in this integration.
   * @returns persisted conversation metadata.
   */
  @Remote
  claudeList(): ClaudeSessionView[] { this.requireLocalHost(); return this.ctx.thirdPartyClaude.list() }

  /**
   * Allocate a native conversation in a user-selected workspace.
   * @param cwd - absolute workspace directory.
   * @param model - discovered native model.
   * @param signal - caller cancellation.
   * @returns native conversation metadata.
   */
  @Remote
  claudeCreate(cwd: string, model: string, signal: AbortSignal): Promise<ClaudeSessionView> {
    this.requireLocalHost()
    return this.ctx.thirdPartyClaude.create(cwd, model, signal)
  }

  /**
   * Read displayed text from a native transcript.
   * @param id - conversation owned by the native workspace.
   * @returns native user and assistant text.
   */
  @Remote
  claudeHistory(id: ClaudeSessionId): ClaudeMessage[] { this.requireLocalHost(); return this.ctx.thirdPartyClaude.history(id) }

  /**
   * Run a native turn without entering the default Harness Agent factory.
   * @param id - native conversation.
   * @param text - next user message.
   * @param model - model fixed for this turn.
   * @param signal - originating stream cancellation.
   * @returns text, tool activity, and private approval events.
   */
  @Remote({ mode: 'stream' })
  claudeTurn(id: ClaudeSessionId, text: string, model: string, signal: AbortSignal): AsyncIterable<ClaudeTurnEvent> {
    this.requireLocalHost()
    return this.ctx.thirdPartyClaude.turn(id, text, model, signal)
  }

  /**
   * Answer one native turn's approval prompt.
   * @param attempt - private stream capability.
   * @param prompt - pending prompt identity.
   * @param answer - user's response.
   */
  @Remote
  claudeAnswer(attempt: AttemptId, prompt: PromptId, answer: string): void {
    this.requireLocalHost()
    this.ctx.thirdPartyClaude.answer(attempt, prompt, answer)
  }

  /**
   * Stop an owned native turn and acknowledge after managed-process cleanup.
   * @param attempt - private turn capability.
   */
  @Remote
  claudeCancel(attempt: AttemptId): Promise<void> {
    this.requireLocalHost()
    return this.ctx.thirdPartyClaude.cancel(attempt)
  }

  private requireLocalHost(): void {
    if (this.ctx.get('webServer')?.host === '0.0.0.0') {
      throw new RemoteError('gateway/bad-request', 'Account management requires a local Host', {})
    }
  }
}
