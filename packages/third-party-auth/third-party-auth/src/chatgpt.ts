/** ChatGPT connection over the existing pi-ai OAuth flow and route settings. */
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-authorization'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import type { AccountProvider } from './types.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const routesSchema = z.object({ providers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}) })

/**
 * Connect ChatGPT using the already-mounted credentials, authorization, settings, and LLM services.
 * @param ctx - Host services owned by the account plugin.
 * @returns provider whose route activation never overwrites user configuration.
 */
export function chatgptProvider(ctx: Context): AccountProvider {
  const routes = () => routesSchema.parse(ctx.settings.get('llm-pi-ai')).providers
  const owned = () => ctx.thirdPartyAuth.preferences.get().accounts.chatgpt?.managedRoute === true
  const revision = () => ctx.settings.describe().find(entry => entry.ns === 'llm-pi-ai')?.revision
  return {
    id: 'chatgpt',
    async status(signal) {
      signal.throwIfAborted()
      const credential = await ctx.credentials.describeRecord(KEY)
      const route = routes()['openai-codex']
      return { connected: credential.configured && credential.kind === 'grant',
        ...(route === undefined || (owned() && route.apiKeyEnv === undefined) ? {} : { unavailable: 'route-conflict' as const }) }
    },
    async models(signal) {
      signal.throwIfAborted()
      return (await ctx.llm.listModels('openai-codex')).map(model => ({ id: model.id, name: model.name }))
    },
    async connect(interaction) {
      const route = routes()['openai-codex']
      if (route !== undefined && (!owned() || route.apiKeyEnv !== undefined)) throw new Error('Codex route has independent configuration')
      const result = await ctx.authorization.begin({
        key: KEY, method: 'oauth', signal: interaction.signal,
        interaction: { notify: notice => interaction.notify(notice), prompt: prompt => interaction.prompt(prompt) },
      })
      return result.status === 'authorized'
    },
    async activate(signal) {
      signal.throwIfAborted()
      const current = routes()['openai-codex']
      if (current !== undefined && (!owned() || current.apiKeyEnv !== undefined)) throw new Error('Codex route has independent configuration')
      if (current === undefined) {
        const expected = revision()
        await ctx.thirdPartyAuth.preferences.update({ accounts: { chatgpt: { managedRoute: true } } })
        try { await ctx.settings.update('llm-pi-ai', { providers: { 'openai-codex': {} } }, expected) }
        catch (error) {
          await ctx.thirdPartyAuth.preferences.update({ accounts: { chatgpt: { managedRoute: false } } })
          throw error
        }
      }
    },
    async deactivate() {
      await ctx.credentials.deleteRecord(KEY)
      const descriptor = ctx.settings.describe().find(entry => entry.ns === 'llm-pi-ai')
      const raw = routesSchema.safeParse(descriptor?.user)
      const current = raw.success ? raw.data.providers['openai-codex'] : undefined
      if (owned() && current !== undefined && Object.keys(current).length === 0) {
        await ctx.settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', 'openai-codex'] }], descriptor?.revision)
      }
      await ctx.thirdPartyAuth.preferences.update({ accounts: { chatgpt: { managedRoute: false } } })
    },
  }
}
