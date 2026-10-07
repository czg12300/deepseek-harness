/** Type-only contract between application shells and the Chat Feed plugin. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Optional file-navigation position supplied by a transcript link. */
export interface OpenFileOptions { readonly line?: number }

/** Applications own conversation selection, execution, and navigation. */
export interface FeedOwnerProps {
  sessionId: SessionId
  /** The Session exists, or its first task is starting. */
  available: boolean
  running: boolean
  emptyText: string
  /** Fold additional user text blocks as inspectable context without changing the log. */
  collapseUserContext?: boolean | undefined
  cwd?: string | undefined
  openFile?: ((path: string, options?: OpenFileOptions) => Promise<void>) | undefined
  openSkill?: ((name: string) => void) | undefined
  inspectCall?: ((callId: string) => void) | undefined
  forkAt?: ((seq: number) => void) | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Transcript with explicit, application-owned Session identity. */
    'chat-feed.view': { kind: 'single'; scope: 'root'; owner: FeedOwnerProps }
  }
}
