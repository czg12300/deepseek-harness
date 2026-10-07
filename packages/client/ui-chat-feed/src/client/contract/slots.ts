/** Chat-owned Slot declarations and composed component props. */
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CommandNode, CompactionSummaryNode, ConversationLocationDataStore, ConversationTurnDataMap,
  MessageImageLoader, MessageImagesOwnerProps, RenderMessageImages, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  InjectFace, KeyedSnapshotSelectorHook, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
  SlotHookFactory, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createChatStore } from '../stores.ts'
import type { ToolCallId } from './store.ts'
import type { ChatConversationViewNode, ChatNode, ChatNodeKind } from './chat-nodes.ts'
import type {
  ChatSnapshot, ChatTurnProcessPresentation,
} from './snapshot.ts'
import type { TurnProcessSpec } from './turn-process.ts'

/** Selector hook over the current Conversation binding's Chat target. */
export type UseChat = SnapshotSelectorHook<ChatSnapshot>

/** Per-key selector hook over one Chat Node. */
export type UseChatNode = KeyedSnapshotSelectorHook<ChatConversationViewNode | undefined>

/** Per-key selector hook over one Chat Node's Turn-process presentation. */
export type UseChatNodeProcess = KeyedSnapshotSelectorHook<ChatTurnProcessPresentation | undefined>

/** Where in a file an open should land. */
export interface OpenFileOptions {
  /** 1-based line to reveal; absent = the file's beginning. */
  readonly line?: number
}

/** Owner currency of the completed-Turn extension chain. */
export interface FeedTurnTailOwnerProps {
  turn: TurnLocation
  seq: number
  openFile: (path: string) => void
}

/** Owner currency of finalized-assistant actions. */
export interface FeedAssistantActionOwnerProps {
  messageId: MessageId
}

/** Optional prose file-mention provider consumed by Chat. */
export interface ChatFileMentions {
  /**
   * Resolve prose links for one closing Turn.
   * @param owner - closing-Turn identity and file opener.
   * @param sessionId - viewed Session, including when history is inherited from a fork.
   * @returns link resolver when available.
   */
  forClosing(owner: FeedTurnTailOwnerProps, sessionId: SessionId): MarkdownFileMentions | undefined
}

/** Hook constrained to business data published on the current Chat Node's Turn. */
export type UseChatNodeTurnData = <Key extends Extract<keyof ConversationTurnDataMap, string>>(
  key: Key,
) => Readonly<ConversationTurnDataMap[Key]> | undefined

/** Slot-level Hook factory for keyed Chat renderers. */
export interface ChatNodeTurnDataInjected {
  hooks: { turnData: SlotHookFactory<'chat-feed.node', UseChatNodeTurnData> }
}

/** Stable owner currency delivered to a keyed Chat renderer. */
export interface FeedChatNodeOwnerProps {
  collapseUserContext?: boolean | undefined
  sessionId: SessionId
  latestTurn: number | undefined
  lastNodeKey: string | undefined

  cwd?: string | undefined
  /** Open the current source file of a skill referenced by a sent message. */
  openSkill: (name: string) => void
  openFile: (path: string, options?: OpenFileOptions) => void
  inspectCall: (callId: ToolCallId) => void
  forkAt?: ((seq: number) => void) | undefined
  /**
   * Session-authorized image loader, down-threaded from the Chat view so a
   * chat-node renderer can render the attachment presentation slot directly
   * with only the durable references plus this loader, instead of receiving a
   * rendering closure.
   */
  loadImage: MessageImageLoader
  renderMessageImages: RenderMessageImages
  fileMentions: (owner: FeedTurnTailOwnerProps) => MarkdownFileMentions | undefined
  /** Turn-process state when this Node belongs to a projected Turn. */
  turnProcess?: TurnProcessOwnerProps | undefined
}

/** Shared presentation state for one Turn-process answer generation. */
export interface TurnProcessOwnerProps {
  readonly spec: TurnProcessSpec
  readonly foldable: boolean
  readonly open: boolean
  setOpen(open: boolean): void
}

/** Full props of one keyed Chat renderer. */
export type ChatNodeViewProps<Kind extends ChatNodeKind = ChatNodeKind> =
  PropsRuntime<'chat-feed.node', Kind> & PropsLocale<'chat-feed'>

/** Command-row owner share. */
export interface FeedCommandRowOwnerProps {
  node: CommandNode
  compaction?: CompactionSummaryNode
}

/** Full props of a registered command row. */
export type CommandRowProps = PropsRuntime<'chat-feed.commandview'>

/** Shared Chat store handle. */
export type ChatStore = ReturnType<typeof createChatStore>

/** In-memory reader position resilient to transcript reflow. */
export interface ChatScrollPosition {
  readonly anchorKey: string
  readonly anchorTop: number
  readonly scrollTop: number
}

/** Business callbacks injected into the Chat view. */
export type ChatViewInjected = import('../feed-contract.ts').FeedInjected

/** Full Chat view props. */
export type ChatViewSlotProps =
  PropsRuntime<'chat-feed.view'>
  & PropsRenderSlots<'chat-feed.node' | 'chat-feed.images'>
  & PropsStore<ChatStore>
  & InjectFace<ChatViewInjected>
  & PropsLocale<'chat-feed'>

/** Full props of the durable-message image renderer. */
export type MessageImagesProps = PropsRuntime<'chat-feed.images'> & PropsLocale<'chat-feed'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Chat target, transcript node, statistics, and details copy. */
    'chat-feed': import('../locale.ts').ChatKey
  }

  interface SlotMap {
    /**
     * Final Chat node renderer, keyed by `ChatNodeKind`. The component receives
     * the typed node, shared Chat actions, and Turn-data hook. Reusing a key
     * replaces that node renderer; a kind with no occupant renders no row.
     */
    'chat-feed.node': {
      kind: 'keyed'
      scope: 'root'
      owner: FeedChatNodeOwnerProps
      keyProps: { [Kind in ChatNodeKind]: { node: ChatNode<Kind> } }
      hookContext: ConversationLocationDataStore<ConversationTurnDataMap> | undefined
      inject: ChatNodeTurnDataInjected
    }
    /**
     * Renderer for one consecutive group of durable message images. The owner
     * supplies image references, an authorized loader, and alignment. A
     * registration replaces the shipped gallery; without one, images are omitted.
     */
    'chat-feed.images': { kind: 'single'; scope: 'root'; owner: MessageImagesOwnerProps }
    /**
     * Command row keyed by the command name. The component receives the folded
     * command lifecycle and linked compaction when present. Reusing a key
     * replaces that command renderer; an unoccupied key uses the generic card.
     */
    'chat-feed.commandview': { kind: 'keyed'; scope: 'root'; owner: FeedCommandRowOwnerProps }
    /**
     * Selector-routed extension before a completed Turn's action row. The
     * component receives the Turn, closing sequence, and file opener. The first
     * selector that accepts the owner renders; an all-declined chain is empty.
     */
    'chat-feed.turnTail': { kind: 'chain'; scope: 'root'; owner: FeedTurnTailOwnerProps }
    /**
     * Ordered actions for one finalized assistant message. Each entry receives
     * the durable message id; a fresh `id` adds an action and reusing one replaces
     * that entry. With no entries, the standard action row remains unchanged.
     */
    'chat-feed.assistant-actions': { kind: 'list'; scope: 'root'; owner: FeedAssistantActionOwnerProps }
  }
}
