/** Independent Session readers and copied Chat assembly; never changes global selection. */
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context } from '@deepseek-ai/cordis'
import type { FeedReader } from '@deepseek-ai/dsh-api-chat-feed/client'
import type { SessionJournalChange } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ConversationNodeAssembler } from './assembly/assembler.ts'
import { ClientAssistantStream, type ClientAssistantStreamResult } from './assembly/assistant-stream.ts'
import { ConversationEventRegistry } from './assembly/event-registry.ts'
import { ConversationViewRegistry } from './assembly/view-registry.ts'
import { registerConversationNodes } from './conversation-nodes/register.ts'
import { EMPTY_CHAT_SNAPSHOT, type ChatSnapshot } from './contract/snapshot.ts'
import type { ChatScrollPosition } from './contract/slots.ts'

/** State read by one mounted transcript. */
export interface FeedSnapshot {
  chat: ChatSnapshot
  openState: 'idle' | 'loading' | 'open' | 'error'
  openError: { message: string; code: string } | null
  hasMore: boolean
  loadingOlder: boolean
}

interface Reader {
  source: SnapshotStore<FeedSnapshot>
  assembly: ConversationNodeAssembler
  assistant: ClientAssistantStream
  stream: FeedReader | undefined
  users: number
  baseSeq: number
  scroll: ChatScrollPosition | null
  closing: Promise<void>
  frame: number | undefined
}

/** Per-plugin readers share a Session connection only between this plugin's consumers. */
export class FeedRuntime {
  private readonly readers = new Map<SessionId, Reader>()
  private readonly events: ConversationEventRegistry
  private readonly views: ConversationViewRegistry
  private disposed = false

  /**
   * Resolve the addressed feed data.
   * @param ctx - plugin lifetime and shared protocol services.
   * @param pageMessages - validated history page size.
   */
  constructor(private readonly ctx: Context, private readonly pageMessages: number) {
    this.events = new ConversationEventRegistry(ctx)
    this.views = new ConversationViewRegistry(ctx)
    registerConversationNodes({ uiConversation: {
      events: this.events, views: this.views,
      inspectSystemPrompt: (previous, event) => ctx.uiConversation.inspectSystemPrompt(previous, event),
      inspectRequestPrompt: (previous, event, system) => ctx.uiConversation.inspectRequestPrompt(previous, event, system),
    } })
    ctx.effect(() => async () => {
      this.disposed = true
      await Promise.all([...this.readers.values()].map(reader => this.close(reader)))
      this.readers.clear()
    }, 'chat-feed readers')
  }

  /**
   * Resolve the addressed feed data.
   * @param id - addressed Session.
   * @returns stable snapshot source, without opening a stream.
   */
  source(id: SessionId): SnapshotStore<FeedSnapshot> { return this.reader(id).source }

  /**
   * Keep the Session stream open while a transcript is mounted.
   * @param id - mounted Session.
   * @returns idempotent release function.
   */
  retain(id: SessionId): () => void {
    const reader = this.reader(id)
    reader.users++
    void reader.closing.then(() => {
      if (!this.disposed && reader.users > 0 && reader.stream === undefined) this.open(id, reader)
    })
    let released = false
    return () => {
      if (released) return
      released = true
      if (--reader.users === 0) void this.close(reader)
    }
  }

  /**
   * Load one older page into this Session history.
   * @param id - viewed Session.
   * @returns after loading one preceding page.
   */
  async older(id: SessionId): Promise<void> {
    const reader = this.reader(id)
    const stream = reader.stream
    if (!stream || !reader.source.getSnapshot().hasMore || reader.source.getSnapshot().loadingOlder) return
    reader.source.update((state) => { state.loadingOlder = true })
    try { await stream.prepend({ beforeSeq: reader.baseSeq, maxMessages: this.pageMessages }) }
    catch (error) { if (reader.stream === stream) this.fail(reader, error) }
    finally { if (reader.stream === stream) reader.source.update((state) => { state.loadingOlder = false }) }
  }

  /**
   * Load preceding pages until the requested position is available.
   * @param id - viewed Session.
   * @param seq - requested history position.
   * @returns after the requested page is loaded.
   */
  async through(id: SessionId, seq: SessionSeq): Promise<void> {
    const reader = this.reader(id)
    while (reader.stream && reader.baseSeq > seq && reader.source.getSnapshot().hasMore) {
      const before = reader.baseSeq
      await this.older(id)
      if (reader.baseSeq === before) break
    }
  }

  /**
   * Retain the reader’s semantic scroll anchor.
   * @param id - viewed Session.
   * @param position - current semantic anchor.
   */
  saveScroll(id: SessionId, position: ChatScrollPosition | null): void { this.reader(id).scroll = position }
  /**
   * Read the Session’s saved scroll anchor.
   * @param id - viewed Session.
   * @returns its retained semantic anchor.
   */
  readScroll(id: SessionId): ChatScrollPosition | null { return this.reader(id).scroll }

  private reader(id: SessionId): Reader {
    let reader = this.readers.get(id)
    if (reader) return reader
    const assembly = new ConversationNodeAssembler(this.events, this.views)
    assembly.activateTarget('chat-feed')
    reader = {
      source: createSnapshotStore<FeedSnapshot>({ chat: EMPTY_CHAT_SNAPSHOT, openState: 'idle', openError: null, hasMore: false, loadingOlder: false }),
      assembly, assistant: new ClientAssistantStream(), stream: undefined, users: 0, baseSeq: 0,
      scroll: null, closing: Promise.resolve(), frame: undefined,
    }
    this.readers.set(id, reader)
    return reader
  }

  private open(id: SessionId, reader: Reader): void {
    const stream = this.ctx.chatFeedTransport.reader(id, {
      publish: (change) => { if (reader.stream === stream) this.accept(reader, change) },
      failed: (error: unknown) => { if (reader.stream === stream) this.fail(reader, error) },
    })
    reader.stream = stream
    reader.source.update((state) => { state.openState = 'loading'; state.openError = null; state.loadingOlder = false })
    void stream.open({ maxMessages: this.pageMessages }).then(() => {
      if (reader.stream === stream) reader.source.update((state) => { state.openState = 'open' })
    }, (error: unknown) => { if (reader.stream === stream) this.fail(reader, error) })
  }

  private accept(reader: Reader, change: SessionJournalChange): void {
    switch (change.type) {
      case 'replace':
        reader.baseSeq = change.entries[0]?.event.seq ?? 0
        reader.assembly.replaceWindow(reader.assistant.replace(change.entries, change.page.assistantStream), change.hasMore)
        reader.source.update((state) => { state.hasMore = change.hasMore })
        break
      case 'prepend':
        reader.baseSeq = change.entries[0]?.event.seq ?? reader.baseSeq
        reader.assembly.prepend(change.entries, change.hasMore)
        reader.source.update((state) => { state.hasMore = change.hasMore })
        break
      case 'append': this.append(reader, reader.assistant.acceptDurable(change.entry)); break
      case 'assistant-stream': this.append(reader, reader.assistant.acceptFrame(change.frame)); break
    }
    if (change.type === 'assistant-stream' && typeof requestAnimationFrame === 'function') {
      reader.frame ??= requestAnimationFrame(() => { reader.frame = undefined; this.publish(reader) })
    } else this.publish(reader)
  }

  private append(reader: Reader, result: ClientAssistantStreamResult): void {
    if (!result) return
    switch (result.type) {
      case 'publish': case 'transient': reader.assembly.append(result.entry); break
      case 'settlement': reader.assembly.settleAssistant(result.attemptId, result.entry); break
      case 'abandonment': reader.assembly.settleAssistant(result.attemptId); break
      case 'rebaseline': reader.stream?.restart(); break
    }
  }

  private publish(reader: Reader): void {
    reader.assembly.flush()
    reader.source.update((state) => { state.chat = reader.assembly.get('chat-feed') ?? EMPTY_CHAT_SNAPSHOT })
  }

  private fail(reader: Reader, error: unknown): void {
    reader.source.update((state) => {
      state.openState = 'error'
      state.openError = { message: error instanceof Error ? error.message : String(error), code: 'history' }
    })
  }

  private close(reader: Reader): Promise<void> {
    const stream = reader.stream
    reader.stream = undefined
    if (reader.frame !== undefined) cancelAnimationFrame(reader.frame)
    reader.frame = undefined
    reader.closing = reader.closing.then(async () => { await stream?.dispose() })
    return reader.closing
  }
}
