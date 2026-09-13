/** Public, secret-free account views and private authorization interactions. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization/types'

/** The two supported account connection kinds. */
export type ProviderId = 'chatgpt' | 'claude'
/** Capability returned only on the stream that owns an authorization attempt. */
export type AttemptId = Branded<'ThirdPartyAuthAttempt'>
/** One input request within its owning attempt. */
export type PromptId = Branded<'ThirdPartyAuthPrompt'>
/** Session identity owned by the native Claude workspace, distinct from Harness Sessions. */
export type ClaudeSessionId = Branded<'ThirdPartyClaudeSession'>
/** A native Claude conversation opened from the optional account workspace. */
export interface ClaudeSessionView {
  id: ClaudeSessionId
  title: string
  model: string
  cwd: string
  updatedAt: number
}
/** Display projection of native SDK messages; native records remain authoritative for resume. */
export interface ClaudeMessage { role: 'user' | 'assistant'; text: string }
/** A native turn's private interaction stream. */
export type ClaudeTurnEvent = ConnectEvent
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'completed'; outcome: 'success' | 'cancelled' | 'failed' }
/** Model identity and human-readable name reported by a provider. */
export interface AccountModel { id: string; name: string }
/** Native authentication status, without any credential material. */
export interface AccountStatus {
  connected: boolean
  email?: string
  unavailable?: 'runtime-missing' | 'route-conflict' | 'status-failed'
}
/** Persisted non-secret account preferences. */
export interface AccountPreference { enabled: boolean; model?: string; managedRoute?: boolean }
/** Settings document owned by the optional account plugin. */
export interface AccountSettings { accounts: Partial<Record<ProviderId, AccountPreference>> }
/** One card's independently observable authentication and catalog state. */
export interface AccountView extends AccountStatus {
  id: ProviderId
  enabled: boolean
  connecting: boolean
  model?: string
  models: AccountModel[]
  catalogFailed: boolean
}
/** Serializable authorization prompt; cancellation remains on the Host. */
export type AccountPrompt = Omit<Extract<AuthorizationPrompt, { kind: 'text' }>, 'signal'>
  | Omit<Extract<AuthorizationPrompt, { kind: 'secret' }>, 'signal'>
  | Omit<Extract<AuthorizationPrompt, { kind: 'select' }>, 'signal'>
/** Private stream events; never forwarded to the application-wide event stream. */
export type ConnectEvent =
  | { kind: 'started'; attemptId: AttemptId }
  | { kind: 'notice'; notice: AuthorizationNotice }
  | { kind: 'prompt'; id: PromptId; prompt: AccountPrompt }
  | { kind: 'withdrawn'; id: PromptId }
  | { kind: 'settled'; status: 'connected' | 'cancelled' | 'failed' }
/** Interactions scoped to the caller who started the login. */
export interface ConnectInteraction {
  signal: AbortSignal
  notify(notice: AuthorizationNotice): void
  prompt(prompt: AuthorizationPrompt): Promise<string>
}
/** Provider-owned native authentication and inference-route activation. */
export interface AccountProvider {
  id: ProviderId
  status(signal: AbortSignal): Promise<AccountStatus>
  models(signal: AbortSignal): Promise<AccountModel[]>
  connect(interaction: ConnectInteraction): Promise<boolean>
  activate(signal: AbortSignal): Promise<void>
  deactivate(): Promise<void>
}
