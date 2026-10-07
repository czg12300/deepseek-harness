/** Session-journal factory for independently mounted transcript readers. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { SessionEventStream } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEventStreamOptions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** Reader lifecycle remains owned by the embedding transcript. */
export type FeedReader = Pick<SessionEventStream, 'open' | 'prepend' | 'restart' | 'dispose'>

/** Session-addressed journal transport; this service performs no UI selection. */
class ChatFeedTransport extends Service {
  /** @param ctx - generated Remote services and plugin lifetime. */
  constructor(ctx: Context) { super(ctx, 'chatFeedTransport') }

  /**
   * Construct an unopened reader using the common validated Session protocol.
   * @param id - durable Session identity.
   * @param options - consumer-owned publication and failure handlers.
   * @returns a reader whose caller must open and dispose it.
   */
  reader(id: SessionId, options: SessionEventStreamOptions): FeedReader {
    return new SessionEventStream(this.ctx.remote, { kind: 'session', sessionId: id }, options)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { chatFeedTransport: ChatFeedTransport }
}

/** Required generated Session transport. */
export const inject = ['remote', 'remote.session']

/** @param ctx - browser plugin context. */
export function apply(ctx: Context): void { new ChatFeedTransport(ctx) }
