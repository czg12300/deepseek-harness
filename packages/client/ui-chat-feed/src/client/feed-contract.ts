/** Application-owned selection and actions for the embedded transcript. */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ChatNodeSource, ChatNodeProcessSource } from './contract/snapshot.ts'
import type { FeedSnapshot } from './feed-runtime.ts'
import type { ChatScrollPosition } from './contract/slots.ts'

export type { FeedOwnerProps } from '@deepseek-ai/dsh-client-chat-feed-contract'
import type {} from '@deepseek-ai/dsh-client-chat-feed-contract'

/** Private runtime operations bound by the slot renderer. */
export interface FeedInjected {
  keyedHooks: {
    feed: (sessionId: string) => ObservableSnapshot<FeedSnapshot>
    chatNode: (address: string) => ChatNodeSource
    chatNodeProcess: (address: string) => ChatNodeProcessSource
  }
  /** @param id - selected Session. @returns a release function for this mounted reader. */
  retain: (id: SessionId) => () => void
  /** @param id - selected Session. @returns after one history page is read. */
  readOlder: (id: SessionId) => Promise<void>
  /** @param id - selected Session. @param seq - history destination. @returns after loading through the destination. */
  readThrough: (id: SessionId, seq: SessionSeq) => Promise<void>
  /** @param id - authorizing Session. @param attachment - logged image. @returns browser image URL. */
  readImage: (id: SessionId, attachment: ImageAttachmentRef) => Promise<string>
  /** @param id - selected Session. @param position - current reading anchor. */
  saveScroll: (id: SessionId, position: ChatScrollPosition | null) => void
  /** @param id - selected Session. @returns saved reading anchor. */
  readScroll: (id: SessionId) => ChatScrollPosition | null
}

