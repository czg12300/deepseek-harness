/** Optional account connection providers and their private Remote controller. */
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { ThirdPartyAuth } from './service.ts'
import { AccountController } from './controller.ts'
import { chatgptProvider } from './chatgpt.ts'
import { ClaudeRuntime, claudeProvider } from './claude-runtime.ts'
import { claudeModels } from './claude-sdk.ts'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { NativeSessions } from './native-sessions.ts'

export { ThirdPartyAuth } from './service.ts'
export { AccountController } from './controller.ts'
export { NativeSessions } from './native-sessions.ts'
export type * from './types.ts'

/** Runtime and authorization limits, owned by the optional installation layer. */
export interface Config {
  /** Maximum duration of one user-guided authorization attempt, in milliseconds. */
  connectTimeoutMs: number
  /** Maximum unread private authorization events before cancellation. */
  maxQueuedEvents: number
  /** Working directory for native account and model metadata probes. */
  cwd: string
  /** Managed-process termination grace, in milliseconds. */
  graceMs: number
  /** Deadline for native account and catalog probes, in milliseconds. */
  statusTimeoutMs: number
  /** Maximum collected native diagnostic bytes and accepted login-line length. */
  outputBytes: number
  /** Plugin-owned native transcript database; :memory: provides process-local storage. */
  databasePath: string
  /** Maximum duration of a native conversation turn, in milliseconds. */
  turnTimeoutMs: number
  /** Maximum unread native turn events before cancellation. */
  maxTurnEvents: number
  /** Official Claude configuration directory isolated from other native clients. */
  nativeConfigDir: string
}
export const name = 'third-party-auth'
export const inject = ['authorization', 'credentials', 'settings', 'llm', 'subprocess']
export const Config: Schema<Config> = Schema.object({
  connectTimeoutMs: Schema.number().min(1).max(2_147_483_647).default(180_000),
  maxQueuedEvents: Schema.number().min(4).max(1024).step(1).default(64),
  cwd: Schema.string().default(homedir()),
  graceMs: Schema.number().min(1).max(2_147_483_647).default(3000),
  statusTimeoutMs: Schema.number().min(1).max(2_147_483_647).default(15_000),
  outputBytes: Schema.number().min(1024).step(1).default(65_536),
  databasePath: Schema.string().default(dshHomePath('third-party-auth', 'claude-sessions.db')),
  turnTimeoutMs: Schema.number().min(1).max(2_147_483_647).default(1_800_000),
  maxTurnEvents: Schema.number().min(4).max(16384).step(1).default(2048),
  nativeConfigDir: Schema.string().default(dshHomePath('third-party-auth', 'claude')),
})

/**
 * Mount independent account providers without changing existing model or settings modules.
 * @param ctx - Host plugin context.
 * @param config - validated limits and working directory.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(ThirdPartyAuth, config)
  ctx.inject(['thirdPartyAuth'], (scope) => {
    scope.thirdPartyAuth.register(chatgptProvider(scope))
    const runtime = new ClaudeRuntime(scope, config)
    scope.thirdPartyAuth.register(claudeProvider(runtime, signal => claudeModels(scope, config, signal)))
    scope.plugin(NativeSessions, config)
    scope.plugin(AccountController)
  })
}
