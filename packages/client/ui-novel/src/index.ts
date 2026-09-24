/** Host roster and configuration for the novel browser workspace. */
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'

/** Editor save timing; authoring forms contain only project metadata and location. */
export interface Config {
  /** Idle milliseconds before saving; zero disables automatic saves. Defaults to 1000. */
  autoSaveMs?: number
}

/** Resolve the complete editor timing before the browser plugin starts. */
export const Config: Schema<Config, Required<Config>> = Schema.object({
  autoSaveMs: Schema.number().min(0).step(1).default(1000),
})

/** Register Host-backed editor preferences for the browser workspace.
 * @param ctx - Host plugin context.
 * @param config - deployment defaults for the editor.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = Config(config)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register('ui-novel', Schema.object({
      autoSaveMs: Schema.number().min(0).step(1).default(resolved.autoSaveMs),
    }))
  })
}
