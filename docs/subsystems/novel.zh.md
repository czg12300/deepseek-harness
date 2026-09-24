# 小说项目

[English](novel.md) | 中文

[小说包组](../../packages/novel/README.zh.md)负责独立目录中的作品与会话，[浏览器页面](../../packages/client/ui-novel/README.zh.md)通过现有 Remote 网关访问它们。

## Identity and versions

作品、文档、任务和建议使用不同的品牌 ID。正文、大纲、人物与世界设定都是独立文档。保存比较预期版本；恢复历史新增版本，不修改原记录。

## Authoring ownership

任务固定小说、文档、基础版本、作者要求与可编辑范围。模型只能提出范围内的替换；人类应用操作再次检查基础版本，在同一 SQLite 事务中保存正文与建议状态。

作品目录包含 novel.json、.novel/project.sqlite 与 .novel/sessions。全局注册表只记录目录和 Session 路由；移除列表项不会删除文件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxnovelprojects--novelprojects"></a>

### `ctx.novelProjects` — `NovelProjects`

Authoritative project data and task dispatch, independent of browser navigation.

```ts cordis-catalog
/** List visible registered novels without loading manuscript bodies.
 * @returns metadata for registered novels without reading manuscript bodies.
 */
@Remote('list') list(): NovelProject[]

/** Create a new novel directory, or recover the same creation request.
 * @param input - three creation fields and a retry ID.
 * @returns the newly created directory-backed project.
 */
@Remote('create') create(input: NovelCreate): NovelProject

/** Register an existing complete novel without moving its files.
 * @param directory - existing project directory on the Host.
 * @returns validated project metadata.
 */
@Remote('importProject') importProject(directory: string): NovelProject

/** Read metadata from the registered novel directory.
 * @param id - registered novel.
 * @returns current project metadata.
 */
@Remote('get') get(id: NovelId): NovelProject

/** Update metadata only when the caller still owns the observed revision.
 * @param id - project.
 * @param revision - observed metadata version.
 * @param info - edited title and synopsis.
 * @returns saved project.
 */
@Remote('updateInfo') updateInfo(id: NovelId, revision: number, info: NovelInfo): NovelProject

/** Hide a list entry without deleting its directory or Session routes.
 * @param id - project to hide; its directory and history are retained.
 */
@Remote('removeRegistration') removeRegistration(id: NovelId): void

/** List ordered document metadata without their text bodies.
 * @param id - project.
 * @returns ordered document metadata, without text bodies.
 */
@Remote('documents') documents(id: NovelId): Omit<NovelDocument, 'content'>[]

/** Create an empty document with an immutable first revision.
 * @param id - project.
 * @param kind - authoring type.
 * @param title - initial title.
 * @param requestId - stable retry ID.
 * @returns empty document.
 */
@Remote('createDocument') createDocument( id: NovelId, kind: NovelDocumentKind, title: string, requestId: NovelRequestId, ): NovelDocument

/** Read a document only through its owning novel.
 * @param id - project.
 * @param documentId - owned document.
 * @returns its current saved text.
 */
@Remote('readDocument') readDocument(id: NovelId, documentId: NovelDocumentId): NovelDocument

/** Save one document using optimistic revision checks and a retry receipt.
 * @param id - project.
 * @param documentId - owned document.
 * @param revision - expected base.
 * @param title - edited title.
 * @param content - complete edited text.
 * @param requestId - retry ID.
 * @returns new version or conflict.
 */
@Remote('saveDocument') saveDocument( id: NovelId, documentId: NovelDocumentId, revision: number, title: string, content: string, requestId: NovelRequestId, ): NovelSaveResult

/** Replace the complete ordering without rewriting manuscript revisions.
 * @param id - project.
 * @param documents - every document exactly once.
 * @returns saved ordering.
 */
@Remote('reorder') reorder(id: NovelId, documents: NovelDocumentId[]): Omit<NovelDocument, 'content'>[]

/** Read immutable saved versions for one document.
 * @param id - project.
 * @param documentId - document.
 * @returns immutable versions, newest first.
 */
@Remote('history') history(id: NovelId, documentId: NovelDocumentId): NovelRevision[]

/** Restore historical text by appending a new version.
 * @param id - project.
 * @param documentId - document.
 * @param expected - current revision.
 * @param revision - historical revision.
 * @param requestId - retry ID.
 * @returns restored content as a new revision or conflict.
 */
@Remote('restore') restore( id: NovelId, documentId: NovelDocumentId, expected: number, revision: number, requestId: NovelRequestId, ): NovelSaveResult

/** Read conversation history and reserve its Session identity without running a model.
 * @param id - project.
 * @param documentId - document.
 * @returns its saved conversation without starting a model request.
 */
@Remote('conversation') conversation(id: NovelId, documentId: NovelDocumentId): NovelConversation

/** Report whether this Host can dispatch novel assistant tasks.
 * @returns whether a real assistant execution backend is composed.
 */
@Remote('assistantAvailable') assistantAvailable(): boolean

/** Persist a captured task before dispatching its controlled Agent.
 * @param request - target and saved version captured by the user gesture.
 * @returns a durable task immediately; completion is observed through waitTask.
 */
@Remote('send') send(request: NovelSend): NovelTask

/** Await the current Host task or return its stored state.
 * @param id - project.
 * @param taskId - task.
 * @returns after owned work settles; persisted tasks are returned immediately.
 */
@Remote('waitTask') async waitTask(id: NovelId, taskId: NovelTaskId): Promise<NovelTask>

/** Cancel owned model work and wait for durable task settlement.
 * @param id - project.
 * @param taskId - running task.
 * @returns after cancellation and durable settlement.
 */
@Remote('cancelTask') async cancelTask(id: NovelId, taskId: NovelTaskId): Promise<NovelTask>

/** Apply saved proposal ranges atomically against their original text version.
 * @param id - project.
 * @param proposalId - saved suggestion.
 * @param revision - current document version.
 * @param requestId - retry ID.
 * @returns atomically applied text or conflict.
 */
@Remote('applyProposal') applyProposal( id: NovelId, proposalId: NovelProposalId, revision: number, requestId: NovelRequestId, ): NovelSaveResult

/** Discard a suggestion without changing the manuscript.
 * @param id - project.
 * @param proposalId - pending suggestion.
 * @returns discarded suggestion, leaving text intact.
 */
@Remote('discardProposal') discardProposal(id: NovelId, proposalId: NovelProposalId): NovelProposal

/**
 * Install the sole model runtime; its disposer drains tasks before withdrawing it.
 * @param backend - controlled assistant execution.
 * @returns async registration disposer.
 */
registerAssistant(backend: NovelAssistantBackend): () => Promise<void>

/** Read durable Session ownership for the persistence router.
 * @returns all durable novel Session ownership records for the persistence router.
 */
sessionRoutes(): NovelSessionRoute[]

/** Resolve a Session to its registered novel without changing selection.
 * @param sessionId - Session being activated.
 * @returns its novel ownership, if any.
 */
sessionRoute(sessionId: SessionId): NovelSessionRoute | undefined

/** Check whether the reserved Session has published its first durable log.
 * @param sessionId - registered novel Session.
 * @returns whether its first durable log was published.
 */
sessionInitialized(sessionId: SessionId): boolean

/**
 * Record the first published Session so missing logs cannot silently start a new conversation.
 * @param sessionId - published novel Session.
 */
markSessionInitialized(sessionId: SessionId): void

/** Reject execution of a task that differs from its persisted input.
 * @param task - task supplied to the execution backend.
 */
assertTask(task: NovelTask): void
```

Types: [SessionId](core.zh.md)

Source: [`packages/novel/novel-core/src/index.ts`](../../packages/novel/novel-core/src/index.ts)
<!-- END GENERATED cordis-surface -->
