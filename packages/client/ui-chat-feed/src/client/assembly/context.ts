/** Private registries keep feed definitions out of the main Chat assembly. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationEventRegistry } from './event-registry.ts'
import type { ConversationViewRegistry } from './view-registry.ts'

/** Registration capabilities available to the copied message definitions. */
export interface FeedAssemblyContext {
  uiConversation: Pick<Context['uiConversation'], 'inspectSystemPrompt' | 'inspectRequestPrompt'> & {
    events: ConversationEventRegistry
    views: ConversationViewRegistry
  }
}
