/** Novel project operations exposed through the existing Typert Remote gateway. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NovelRegistry } from './registry.ts'
import { NovelTasks } from './tasks.ts'
import {
  createSchema,
  documentIdSchema,
  infoSchema,
  kindSchema,
  novelIdSchema,
  proposalIdSchema,
  requestIdSchema,
  revisionSchema,
  taskIdSchema,
} from './validation.ts'
import type {
  NovelAssistantBackend,
  NovelConversation,
  NovelCreate,
  NovelDocument,
  NovelDocumentId,
  NovelDocumentKind,
  NovelId,
  NovelInfo,
  NovelProject,
  NovelProposal,
  NovelProposalId,
  NovelRequestId,
  NovelRevision,
  NovelSaveResult,
  NovelSend,
  NovelSessionRoute,
  NovelTask,
  NovelTaskId,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Directory-backed novel projects and human-applied authoring revisions. */
    novelProjects: NovelProjects
  }
}

/** Deployment budgets; no author is required to enter these while creating a novel. */
export interface Config {
  /** Harness home for the directory index. */
  dshHome?: string
  /** SQLite writer lock wait; defaults to 5000 ms. */
  busyTimeoutMs?: number
  /** Maximum UTF-16 characters in one saved document; defaults to 100000. */
  maxDocumentChars?: number
  /** Maximum referenced text per task; defaults to 24000 characters. */
  maxContextChars?: number
  /** Maximum referenced documents per task; defaults to 8. */
  maxReferences?: number
}

/** Authoritative project data and task dispatch, independent of browser navigation. */
export class NovelProjects extends TypertRemoteService {
  static Config = Schema.object({
    dshHome: Schema.string(),
    busyTimeoutMs: Schema.number().min(0).max(2_147_483_647).step(1).default(5000),
    maxDocumentChars: Schema.number().min(1).step(1).default(100000),
    maxContextChars: Schema.number().min(0).step(1).default(24000),
    maxReferences: Schema.number().min(0).step(1).default(8),
  })
  private readonly registry: NovelRegistry
  private readonly limits: { maxDocumentChars: number; maxContextChars: number; maxReferences: number }
  private backend: NovelAssistantBackend | undefined
  private readonly pending = new Map<
    NovelTaskId,
    { task: NovelTask; done: Promise<NovelTask>; cancel: () => Promise<void> }
  >()
  private closing = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'novelProjects', { namespace: 'novels' })
    const resolved = NovelProjects.Config(config)
    this.limits = resolved
    this.registry = new NovelRegistry(resolveDshHome(resolved.dshHome), resolved.busyTimeoutMs)
    ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled(
        [...this.pending.values()].map(async (entry) => {
          await entry.cancel()
          await entry.done
        }),
      )
      this.registry.close()
    })
  }

  /** List visible registered novels without loading manuscript bodies.
 * @returns metadata for registered novels without reading manuscript bodies.
 */
  @Remote('list') list(): NovelProject[] {
    return this.registry.list()
  }
  /** Create a new novel directory, or recover the same creation request.
 * @param input - three creation fields and a retry ID.
   * @returns the newly created directory-backed project.
 */
  @Remote('create') create(input: NovelCreate): NovelProject {
    return this.registry.create(createSchema.parse(input))
  }
  /** Register an existing complete novel without moving its files.
 * @param directory - existing project directory on the Host.
   * @returns validated project metadata.
 */
  @Remote('importProject') importProject(directory: string): NovelProject {
    return this.registry.import(z.string().min(1).parse(directory))
  }
  /** Read metadata from the registered novel directory.
 * @param id - registered novel.
   * @returns current project metadata.
 */
  @Remote('get') get(id: NovelId): NovelProject {
    return this.registry.open(novelIdSchema.parse(id)).get()
  }
  /** Update metadata only when the caller still owns the observed revision.
 * @param id - project.
   * @param revision - observed metadata version.
   * @param info - edited title and synopsis.
   * @returns saved project.
 */
  @Remote('updateInfo') updateInfo(id: NovelId, revision: number, info: NovelInfo): NovelProject {
    return this.registry
      .open(novelIdSchema.parse(id))
      .updateInfo(infoSchema.parse(info), revisionSchema.parse(revision))
  }
  /** Hide a list entry without deleting its directory or Session routes.
 * @param id - project to hide; its directory and history are retained.
 */
  @Remote('removeRegistration') removeRegistration(id: NovelId): void {
    this.registry.remove(novelIdSchema.parse(id))
  }
  /** List ordered document metadata without their text bodies.
 * @param id - project.
   * @returns ordered document metadata, without text bodies.
 */
  @Remote('documents') documents(id: NovelId): Omit<NovelDocument, 'content'>[] {
    return this.registry.open(novelIdSchema.parse(id)).documents()
  }
  /** Create an empty document with an immutable first revision.
 * @param id - project.
   * @param kind - authoring type.
   * @param title - initial title.
   * @param requestId - stable retry ID.
   * @returns empty document.
 */
  @Remote('createDocument') createDocument(
    id: NovelId,
    kind: NovelDocumentKind,
    title: string,
    requestId: NovelRequestId,
  ): NovelDocument {
    return this.registry
      .open(novelIdSchema.parse(id))
      .createDocument(
        kindSchema.parse(kind),
        z.string().trim().min(1).max(200).parse(title),
        requestIdSchema.parse(requestId),
      )
  }
  /** Read a document only through its owning novel.
 * @param id - project.
   * @param documentId - owned document.
   * @returns its current saved text.
 */
  @Remote('readDocument') readDocument(id: NovelId, documentId: NovelDocumentId): NovelDocument {
    return this.registry.open(novelIdSchema.parse(id)).document(documentIdSchema.parse(documentId))
  }
  /** Save one document using optimistic revision checks and a retry receipt.
 * @param id - project.
   * @param documentId - owned document.
   * @param revision - expected base.
   * @param title - edited title.
   * @param content - complete edited text.
   * @param requestId - retry ID.
   * @returns new version or conflict.
 */
  @Remote('saveDocument') saveDocument(
    id: NovelId,
    documentId: NovelDocumentId,
    revision: number,
    title: string,
    content: string,
    requestId: NovelRequestId,
  ): NovelSaveResult {
    return this.registry
      .open(novelIdSchema.parse(id))
      .save(
        documentIdSchema.parse(documentId),
        revisionSchema.parse(revision),
        z.string().trim().min(1).max(200).parse(title),
        z.string().max(this.limits.maxDocumentChars).parse(content),
        requestIdSchema.parse(requestId),
      )
  }
  /** Replace the complete ordering without rewriting manuscript revisions.
 * @param id - project.
   * @param documents - every document exactly once.
   * @returns saved ordering.
 */
  @Remote('reorder') reorder(id: NovelId, documents: NovelDocumentId[]): Omit<NovelDocument, 'content'>[] {
    return this.registry.open(novelIdSchema.parse(id)).reorder(z.array(documentIdSchema).parse(documents))
  }
  /** Read immutable saved versions for one document.
 * @param id - project.
   * @param documentId - document.
   * @returns immutable versions, newest first.
 */
  @Remote('history') history(id: NovelId, documentId: NovelDocumentId): NovelRevision[] {
    return this.registry.open(novelIdSchema.parse(id)).history(documentIdSchema.parse(documentId))
  }
  /** Restore historical text by appending a new version.
 * @param id - project.
   * @param documentId - document.
   * @param expected - current revision.
   * @param revision - historical revision.
   * @param requestId - retry ID.
   * @returns restored content as a new revision or conflict.
 */
  @Remote('restore') restore(
    id: NovelId,
    documentId: NovelDocumentId,
    expected: number,
    revision: number,
    requestId: NovelRequestId,
  ): NovelSaveResult {
    return this.registry
      .open(novelIdSchema.parse(id))
      .restore(
        documentIdSchema.parse(documentId),
        revisionSchema.parse(expected),
        revisionSchema.parse(revision),
        requestIdSchema.parse(requestId),
      )
  }
  /** Read conversation history and reserve its Session identity without running a model.
 * @param id - project.
   * @param documentId - document.
   * @returns its saved conversation without starting a model request.
 */
  @Remote('conversation') conversation(id: NovelId, documentId: NovelDocumentId): NovelConversation {
    const conversation = this.tasks(id).conversation(documentIdSchema.parse(documentId))
    this.registry.registerSession(id, conversation.sessionId)
    return conversation
  }
  /** Report whether this Host can dispatch novel assistant tasks.
 * @returns whether a real assistant execution backend is composed.
 */
  @Remote('assistantAvailable') assistantAvailable(): boolean {
    return this.backend !== undefined && !this.closing
  }

  /** Persist a captured task before dispatching its controlled Agent.
 * @param request - target and saved version captured by the user gesture.
   * @returns a durable task immediately; completion is observed through waitTask.
 */
  @Remote('send') send(request: NovelSend): NovelTask {
    if (this.closing || !this.backend) throw new Error('Novel assistant is unavailable')
    const parsed = z
      .object({
        novelId: novelIdSchema,
        documentId: documentIdSchema,
        requestId: requestIdSchema,
        expectedRevision: revisionSchema,
        prompt: z.string().trim().min(1).max(this.limits.maxDocumentChars),
        selection: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).nullable(),
      })
      .strict()
      .parse(request)
    const tasks = this.tasks(parsed.novelId)
    const { task, created } = tasks.start(parsed)
    this.registry.registerSession(task.novelId, task.sessionId)
    if (!created) return task
    const backend = this.backend
    let cancelled = false
    const done = Promise.resolve()
      .then(() => {
        if (cancelled) throw new DOMException('Cancelled before dispatch', 'AbortError')
        return backend.execute(deepFreeze(task))
      })
      .then(result =>
        cancelled ? tasks.fail(task.id, 'cancelled', 'Cancelled by the user') : tasks.complete(task.id, result),
      )
      .catch((error: unknown) =>
        tasks.fail(
          task.id,
          cancelled ? 'cancelled' : 'failed',
          error instanceof Error ? error.message : 'Novel assistant failed',
        ),
      )
      .finally(() => {
        this.pending.delete(task.id)
      })
    this.pending.set(task.id, {
      task,
      done,
      cancel: async () => {
        cancelled = true
        await backend.cancel(task.id)
      },
    })
    return task
  }
  /** Await the current Host task or return its stored state.
 * @param id - project.
   * @param taskId - task.
   * @returns after owned work settles; persisted tasks are returned immediately.
 */
  @Remote('waitTask') async waitTask(id: NovelId, taskId: NovelTaskId): Promise<NovelTask> {
    const task = this.tasks(id).get(taskIdSchema.parse(taskId))
    return this.pending.get(task.id)?.done ?? task
  }
  /** Cancel owned model work and wait for durable task settlement.
 * @param id - project.
   * @param taskId - running task.
   * @returns after cancellation and durable settlement.
 */
  @Remote('cancelTask') async cancelTask(id: NovelId, taskId: NovelTaskId): Promise<NovelTask> {
    const tasks = this.tasks(id)
    const task = tasks.get(taskIdSchema.parse(taskId))
    const pending = this.pending.get(task.id)
    if (!pending && task.status === 'running') throw new Error('The novel task is owned by another Host process')
    await pending?.cancel()
    return pending ? pending.done : task
  }
  /** Apply saved proposal ranges atomically against their original text version.
 * @param id - project.
   * @param proposalId - saved suggestion.
   * @param revision - current document version.
   * @param requestId - retry ID.
   * @returns atomically applied text or conflict.
 */
  @Remote('applyProposal') applyProposal(
    id: NovelId,
    proposalId: NovelProposalId,
    revision: number,
    requestId: NovelRequestId,
  ): NovelSaveResult {
    return this.registry
      .open(novelIdSchema.parse(id))
      .apply(proposalIdSchema.parse(proposalId), revisionSchema.parse(revision), requestIdSchema.parse(requestId))
  }
  /** Discard a suggestion without changing the manuscript.
 * @param id - project.
   * @param proposalId - pending suggestion.
   * @returns discarded suggestion, leaving text intact.
 */
  @Remote('discardProposal') discardProposal(id: NovelId, proposalId: NovelProposalId): NovelProposal {
    return this.registry.open(novelIdSchema.parse(id)).discard(proposalIdSchema.parse(proposalId))
  }

  /**
   * Install the sole model runtime; its disposer drains tasks before withdrawing it.
   * @param backend - controlled assistant execution.
   * @returns async registration disposer.
   */
  registerAssistant(backend: NovelAssistantBackend): () => Promise<void> {
    if (this.backend) throw new Error('A novel assistant backend is already registered')
    this.backend = backend
    return async () => {
      if (this.backend === backend) this.backend = undefined
      await Promise.allSettled(
        [...this.pending.values()].map(async (p) => {
          await p.cancel()
          await p.done
        }),
      )
    }
  }
  /** Read durable Session ownership for the persistence router.
 * @returns all durable novel Session ownership records for the persistence router.
 */
  sessionRoutes(): NovelSessionRoute[] {
    return this.registry.sessionRoutes()
  }
  /** Resolve a Session to its registered novel without changing selection.
 * @param sessionId - Session being activated.
   * @returns its novel ownership, if any.
 */
  sessionRoute(sessionId: SessionId): NovelSessionRoute | undefined {
    return this.sessionRoutes().find(route => route.sessionId === sessionId)
  }
  /** Check whether the reserved Session has published its first durable log.
 * @param sessionId - registered novel Session.
   * @returns whether its first durable log was published.
 */
  sessionInitialized(sessionId: SessionId): boolean {
    const route = this.sessionRoute(sessionId)
    if (!route) throw new Error('Unknown novel Session')
    return (
      this.registry
        .open(route.novelId)
        .db.prepare('SELECT initialized FROM conversations WHERE session_id=?')
        .get(sessionId)?.initialized === 1
    )
  }
  /**
   * Record the first published Session so missing logs cannot silently start a new conversation.
   * @param sessionId - published novel Session.
   */
  markSessionInitialized(sessionId: SessionId): void {
    const route = this.sessionRoute(sessionId)
    if (!route) throw new Error('Unknown novel Session')
    this.registry
      .open(route.novelId)
      .db.prepare('UPDATE conversations SET initialized=1 WHERE session_id=?')
      .run(sessionId)
  }
  /** Reject execution of a task that differs from its persisted input.
 * @param task - task supplied to the execution backend.
 */
  assertTask(task: NovelTask): void {
    if (!isDeepStrictEqual(this.tasks(task.novelId).get(task.id), task) || task.status !== 'running')
      throw new Error('Novel assistant task does not match its durable input')
  }
  private tasks(id: NovelId): NovelTasks {
    return new NovelTasks(this.registry.open(novelIdSchema.parse(id)), this.limits)
  }
}

export default NovelProjects
