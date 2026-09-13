/** Independent settings navigation and private Remote account transport. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import accountRemote from '@deepseek-ai/dsh-third-party-auth/remote'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { AccountPageStore, type AccountOperations } from './store.ts'
import { Page } from './Page.tsx'
import { en, zh, type AccountKey } from './locales.ts'
import { NativePageStore } from './native-store.ts'
import { NativeWorkspace } from './NativeWorkspace.tsx'
import type { ProviderId } from '@deepseek-ai/dsh-third-party-auth/types'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'thirdPartyAuth': AccountKey }
}

/** Dependencies supplied by the settings-page plugin, never created by the component. */
export interface PageInjected {
  hooks: { accounts: AccountPageStore['state'] }
  controller: AccountPageStore
  local: boolean
  startSession(provider: ProviderId, model: string): Promise<void>
}
/** The standard renderer supplies localized copy, hooks, and settings navigation. */
export type PageProps = PropsRuntime<'settings.section'> & PropsLocale<'thirdPartyAuth'> & InjectFace<PageInjected>
/** Native workspace operations supplied by this plugin's overlay registration. */
export interface NativeInjected { hooks: { native: NativePageStore['state'] }; native: NativePageStore }
/** Standard slot props for the independent native conversation window. */
export type NativeProps = PropsRuntime<'shell.overlay'> & PropsLocale<'thirdPartyAuth'> & InjectFace<NativeInjected>

/**
 * Unwrap one generated Remote call; the page maps failures to localized copy.
 * @param result - generated success or failure result.
 * @returns the operation's successful value.
 */
function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}

export const inject = ['slots', 'locale', 'remote', 'sessions']

/**
 * Mount only this plugin's Remote contribution and register its settings entry.
 * @param ctx - browser context with existing settings and transport services.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount(accountRemote)
  ctx.inject(['remote.thirdPartyAuth', 'remote.session'], mountPage)
}

/** Register page consumers only after their generated namespaces are injectable. */
function mountPage(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('thirdPartyAuth', { zh, en }), 'third-party-auth: locale')
  const api = ctx.remote.thirdPartyAuth
  const operations: AccountOperations = {
    changes: signal => api.changes(signal),
    list: async signal => unwrap(await api.list(signal)),
    connect: (id, signal) => api.connect(id, signal),
    answer: async (attempt, prompt, answer) => { unwrap(await api.answer(attempt, prompt, answer)) },
    disconnect: async (id) => { unwrap(await api.disconnect(id)) },
    selectModel: async (id, model, signal) => { unwrap(await api.selectModel(id, model, signal)) },
  }
  const controller = new AccountPageStore(operations)
  const native = new NativePageStore({
    list: async () => unwrap(await api.claudeList()),
    create: async (cwd, model, signal) => unwrap(await api.claudeCreate(cwd, model, signal)),
    history: async id => unwrap(await api.claudeHistory(id)),
    turn: (id, text, model, signal) => api.claudeTurn(id, text, model, signal),
    answer: async (attempt, prompt, answer) => { unwrap(await api.claudeAnswer(attempt, prompt, answer)) },
    cancel: async (attempt) => { unwrap(await api.claudeCancel(attempt)) },
  })
  ctx.effect(() => () => native.dispose(), 'third-party-auth: native workspace lifetime')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'third-party-claude', locale: 'thirdPartyAuth',
    inject: (): NativeInjected => ({ hooks: { native: native.state }, native }),
  }, NativeWorkspace))
  ctx.effect(() => () => controller.dispose(), 'third-party-auth: page lifecycle')
  ctx.effect(() => ctx.on('connection/reset', () => { void controller.load() }), 'third-party-auth: reconnect')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'third-party-auth', order: 12, locale: 'thirdPartyAuth',
    label: () => ctx.locale.bind('thirdPartyAuth')('nav'),
    inject: (): PageInjected => ({
      hooks: { accounts: controller.state }, controller, local: ctx.remote.$host.isLoopback,
      async startSession(provider, model) {
        if (provider === 'claude') {
          const list = ctx.sessions.list.getSnapshot()
          const cwd = list.current === undefined ? '' : list.byId[list.current]?.cwd ?? ''
          await native.open(model, controller.state.getSnapshot().accounts.find(account => account.id === 'claude')?.models ?? [], cwd)
          return
        }
        const sessionId = await ctx.sessions.create()
        unwrap(await ctx.remote.session.selectModel({ sessionId, provider: 'openai-codex', model }))
        await ctx.sessions.refresh()
        ctx.sessions.open(sessionId)
      },
    }),
  }, Page))
}
