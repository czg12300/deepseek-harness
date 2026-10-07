/** Register the isolated, explicitly addressed Chat Feed. */
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ChatNodeTurnDataInjected } from './contract/slots.ts'
import { ChatView } from './chat/ChatView.tsx'
import { registerChatNodeRenderers } from './chat/register-node-renderers.ts'
import { useTurnDataValue } from './chat/use-turn-data.ts'
import { apply as registerTools } from './tools/apply.ts'
import { FeedRuntime } from './feed-runtime.ts'
import type { FeedInjected } from './feed-contract.ts'
import { createChatStore } from './stores.ts'
import { en, NS, zh } from './locale.ts'
import { FeedImages } from './chat/FeedExtras.tsx'

/** History and presentation options for this independent feed. */
export interface Config {
  /** Number of messages requested per history page. */
  pageMessages?: number
}
/** Validated page size for the Session history reader. */
export const Config: z<Config> = z.object({ pageMessages: z.number().step(1).min(1).default(50) })

/** Shared infrastructure; the main Chat plugin is not a dependency. */
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'chatFeedTransport', 'uiConversation']

/**
 * Register one application-embeddable transcript.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context, config: Config = Config({})): void {
  const runtime = new FeedRuntime(ctx, config.pageMessages as number)
  const store = createChatStore()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-feed dictionaries')
  registerChatNodeRenderers(ctx)
  registerTools(ctx)
  const nodeInject: ChatNodeTurnDataInjected = {
    hooks: { turnData: (_standard, data) => function useTurnData(key) { return useTurnDataValue(data, key) } },
  }
  ctx.slots.inject('chat-feed.view', () => ctx.slots.register({
    name: 'chat-feed.view', locale: NS, store,
    children: {
      'chat-feed.node': { kind: 'keyed', scope: 'root', inject: nodeInject },
      'chat-feed.images': { kind: 'single', scope: 'root' },
    },
    inject: (): FeedInjected => ({
      keyedHooks: {
        feed: id => runtime.source(id as SessionId),
        chatNode: (address) => {
          const [id, key] = JSON.parse(address) as [SessionId, string]
          return runtime.source(id).getSnapshot().chat.nodes.source(key)
        },
        chatNodeProcess: (address) => {
          const [id, key] = JSON.parse(address) as [SessionId, string]
          return runtime.source(id).getSnapshot().chat.nodes.processSource(key)
        },
      },
      retain: id => runtime.retain(id),
      readOlder: id => runtime.older(id),
      readThrough: (id, seq) => runtime.through(id, seq),
      readImage: async (id, attachment) => {
        const result = await ctx.remote.session.attachment({ sessionId: id, attachmentId: attachment.attachmentId })
        if (!result.ok) throw new Error(result.error.message)
        return `data:${result.value.attachment.mediaType};base64,${result.value.data}`
      },
      saveScroll: (id, position) => { runtime.saveScroll(id, position) },
      readScroll: id => runtime.readScroll(id),
    }),
  }, ChatView))
  ctx.slots.inject('chat-feed.images', () => ctx.slots.register({ name: 'chat-feed.images', locale: NS }, FeedImages))
  ctx.slots.inject('chat-feed.tool-images', () => ctx.slots.register({ name: 'chat-feed.tool-images', locale: NS }, FeedImages))
}
