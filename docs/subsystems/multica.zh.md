# Multica 项目

[English](multica.md) | 中文

[Multica 组](../../packages/multica/README.zh.md)负责已保存的项目规格、大纲和单集草稿。[浏览器工作台](../../packages/client/ui-multica/README.zh.md)通过类型化 Remote 调用使用项目服务。[项目版本决定](../../.agents/notes/implemented/architecture/2026-09-10-multica-project-revisions.zh.md)说明存储范围及其与 Session 日志的分工。

## 标识与版本

`StudioFolderId` 是移动后保持不变的品牌化清单身份。`StudioFolder` 投影当前设备路径、可选的项目或创建表单身份、缓存标题与摘要，以及 `open`、`closed` 或 `missing` 可用状态。缓存摘要不授予写入权限；必须先打开所属目录。

项目和单集 ID 是分别带有品牌类型的字符串。每集属于一个项目；保存时不能复用其他项目的单集身份。项目版本为正整数。每次保存或修改归档状态时，调用者均提供预期版本。

成功写入返回已提交项目。冲突返回当前项目且不执行写入。归档项目拒绝内容保存，直到被显式恢复。项目读取与历史查询始终指定项目身份；后续保存或归档状态变化不会使历史内容失去可访问性。

已保存项目包含名称、构想、导入来源文本、画幅、可选的目标集数与时长、大纲，以及有序的单集草稿。目标集数属于规格，不会自动生成相应集数。版本保留完整项目内容；恢复内容会创建另一个版本，不会覆盖历史。

## 运行时职责

每个可携带项目拥有自己的目录、SQLite 版本、可恢复编辑缓冲和专业 Session 存储。设备数据库保留最近位置与旧作品。带版本的清单使项目身份独立于当前绝对目录；独占项目锁管理可写生命周期。打开、关闭和迁移语义由[项目服务](../../packages/multica/studio-core/README.zh.md#portable-project-folders)定义。

`ScriptDocumentId`、`ProductionUnitId`、`CanvasNodeId` 和 `ProjectMediaId` 标识项目内的 Markdown、画布、节点及导入文件。剧本文本镜像到 `scripts/`，并由项目 SQLite 索引。显式确认会记录已保存大纲和分集剧本的摘要；剧本修改使确认失效，重新确认前不能创建新的制作单位。制作节点与导入素材均存于项目文件夹；只为选中的预览读取图片、视频或音频字节。

演员库独立于项目。每个库在设备数据库同级的 `actor/` 目录下拥有自己的目录、SQLite 演员记录和引用图片。演员库可导出为有大小上限的 ZIP，也可合并且不覆盖冲突演员版本；[演员库方案](../../multica/doc/actor-library.md)定义文件和身份规则。

创建项目和手工保存不创建 Agent。[专业运行时](../../packages/multica/studio-agents/README.zh.md)执行显式策划和编剧任务，并将冻结输入记录到独立 Session。提案应用与具体版本内容批准仍是独立人工操作。制作画布可保存文本建议和导入素材；模型生成媒体尚未开放。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxstudioagents--studioagents"></a>

### `ctx.studioAgents` — `StudioAgents`

Scoped professional execution; no project mutation or approval tool is installed on an Agent.

```ts cordis-catalog
/** Register a host-reviewed, read-only integration; names cannot collide with structured proposal output.
 * @param tool - trusted implementation and actual source classification.
 * @returns its effect-owned disposer; removing a selected tool makes subsequent tasks fail explicitly.
 */
registerContextTool(tool: StudioContextTool): () => Promise<void>

/** Read available professional roles and actual skill/tool registrations.
 * @returns dependency choices without invoking a model.
 */
async catalog(): Promise<StudioAssistantCatalog>

/** Resolve a task model and selected dependency content before admission.
 * @param role - immutable, validated role configuration.
 * @param selection - explicit task model selection, overriding the role default.
 * @returns the effective model and selected skill bodies/tool identities.
 */
async resolve(role: StudioRoleRevision, selection?: Pick<StudioResolvedRole, 'provider' | 'model' | 'reasoningEffort'>): Promise<StudioResolvedRole>

/** Drive exactly one explicit task, retaining Session history while task-local tools are disposed.
 * @param task - fully frozen, persisted task supplied by the project service.
 * @returns only an authoritative, logged structured result.
 */
async execute(task: StudioTask): Promise<StudioAssistantResult>

/** Cancel task work and await its actual settlement.
 * @param id - host-owned task identity.
 * @returns after all task-local tools and pending model work have stopped.
 */
async cancel(id: StudioTaskId): Promise<void>

/**
 * Release the project runtime after its tasks settle.
 * @param root - current project directory.
 */
async closeProject(root: string): Promise<void>

/**
 * Mount project history without a model request.
 * @param root - opened directory.
 * @param check - disk identity check.
 */
openProject(root: string, check: () => void): void

/**
 * Copy legacy dialogue before installing its project route.
 * @param ids - initialized identities.
 * @param root - destination folder.
 * @param check - disk identity check.
 */
async copySessions(ids: SessionId[], root: string, check: () => void): Promise<void>
```

Types: [SessionId](core.zh.md)

Source: [`packages/multica/studio-agents/src/index.ts`](../../packages/multica/studio-agents/src/index.ts)

<a id="ctxstudioprojects--studioprojects"></a>

### `ctx.studioProjects` — `StudioProjects`

Project operations routed by stable identities to independently portable folders.

```ts cordis-catalog
/** List independent actor-library folders.
 * @returns local libraries and actor counts.
 */
@Remote('actorLibraries') actorLibraries(): ActorLibrarySummary[]

/** Create a portable actor library under the device's actor directory.
 * @param name - library name.
 * @returns new library summary.
 */
@Remote('createActorLibrary') createActorLibrary(name: string): ActorLibrarySummary

/** Search actors in one independent library.
 * @param id - library identity.
 * @param search - name fragment.
 * @param period - exact period filter.
 * @param region - exact region filter.
 * @param offset - result offset for paging.
 * @returns first page and full matching count.
 */
@Remote('libraryActors') libraryActors(id: ActorLibraryId, search: string, period: string, region: string, offset: number): ActorPage

/** Read one actor and its two reference images.
 * @param libraryId - library identity.
 * @param actorId - actor identity.
 * @returns actor or null.
 */
@Remote('libraryActor') libraryActor(libraryId: ActorLibraryId, actorId: ActorId): Actor | null

/** Save user-authored actor details without model work.
 * @param libraryId - destination library.
 * @param actorId - actor to replace, or null for a new actor.
 * @param input - complete details and reference images.
 * @returns committed actor.
 */
@Remote('saveLibraryActor') saveLibraryActor(libraryId: ActorLibraryId, actorId: ActorId | null, input: ActorInput): Actor

/** Export a complete portable library archive.
 * @param id - source library.
 * @returns ZIP data URL and suggested filename.
 */
@Remote('exportActorLibrary') exportActorLibrary(id: ActorLibraryId): { name: string; dataUrl: string }

/** Install or merge a validated actor-library archive.
 * @param dataUrl - ZIP data URL.
 * @param target - destination library, or null to install separately.
 * @returns destination and merge counts.
 */
@Remote('importActorLibrary') importActorLibrary(dataUrl: string, target: ActorLibraryId | null): ActorImportResult

/** List project-local Markdown files, materializing committed scripts on disk.
 * @param id - mounted project.
 * @returns ordered script documents.
 */
@Remote('scriptDocuments') scriptDocuments(id: ProjectId): ScriptDocument[]

/** Read a project Markdown document.
 * @param projectId - mounted project.
 * @param documentId - document identity.
 * @returns document or null.
 */
@Remote('scriptDocument') scriptDocument(projectId: ProjectId, documentId: ScriptDocumentId): ScriptDocument | null

/** Save Markdown, preserving project revision checks for outline and episode scripts.
 * @param projectId - mounted project.
 * @param documentId - document identity.
 * @param expectedRevision - observed document revision.
 * @param markdown - replacement text.
 * @returns committed document.
 */
@Remote('saveScriptDocument') saveScriptDocument(projectId: ProjectId, documentId: ScriptDocumentId, expectedRevision: number, markdown: string): ScriptDocument

/** Read the user's completion decision against the current script digest.
 * @param id - mounted project.
 * @returns whether the script remains complete.
 */
@Remote('scriptComplete') scriptComplete(id: ProjectId): boolean

/** Confirm a complete saved script before admitting production.
 * @param id - mounted project.
 * @param expectedRevision - reviewed saved revision.
 * @returns true after confirmation.
 */
@Remote('completeScript') completeScript(id: ProjectId, expectedRevision: number): boolean

/** List episode and whole-film production units.
 * @param id - mounted project.
 * @returns saved units.
 */
@Remote('productionUnits') productionUnits(id: ProjectId): ProductionUnit[]

/** Create an episode or whole-film canvas.
 * @param id - mounted project.
 * @param kind - production template.
 * @param episodeId - source episode for episode units.
 * @param title - unit name.
 * @returns created unit.
 */
@Remote('createProductionUnit') createProductionUnit(id: ProjectId, kind: ProductionUnit['kind'], episodeId: EpisodeId | null, title: string): ProductionUnit

/** Read one production canvas.
 * @param id - mounted project.
 * @param unitId - production unit.
 * @returns persisted nodes.
 */
@Remote('canvasNodes') canvasNodes(id: ProjectId, unitId: ProductionUnitId): CanvasNode[]

/** Add a text or media-reference node.
 * @param id - mounted project.
 * @param unitId - owning canvas.
 * @param kind - node kind.
 * @param label - node title.
 * @param x - canvas x coordinate.
 * @param y - canvas y coordinate.
 * @param assetId - optional media identity.
 * @param text - script-node text or null for media.
 * @returns created node.
 */
@Remote('addCanvasNode') addCanvasNode(id: ProjectId, unitId: ProductionUnitId, kind: CanvasNode['kind'], label: string, x: number, y: number, assetId: ProjectMediaId | null, text: string | null): CanvasNode

/** Move one canvas node under an expected revision.
 * @param id - mounted project.
 * @param unitId - owning canvas.
 * @param nodeId - node identity.
 * @param revision - observed revision.
 * @param x - new x coordinate.
 * @param y - new y coordinate.
 * @returns updated node.
 */
@Remote('moveCanvasNode') moveCanvasNode(id: ProjectId, unitId: ProductionUnitId, nodeId: CanvasNodeId, revision: number, x: number, y: number): CanvasNode

/** List indexed image, video and audio artifacts.
 * @param id - mounted project.
 * @returns media metadata.
 */
@Remote('projectMedia') projectMedia(id: ProjectId): ProjectMediaAsset[]

/** Import bounded media into one production canvas.
 * @param id - mounted project.
 * @param unitId - destination production unit.
 * @param name - source filename.
 * @param dataUrl - validated media bytes.
 * @returns indexed media.
 */
@Remote('importProjectMedia') importProjectMedia(id: ProjectId, unitId: ProductionUnitId, name: string, dataUrl: string): ProjectMediaAsset

/** Return bounded media bytes for an original-image or audio/video preview.
 * @param id - mounted project.
 * @param assetId - indexed media identity.
 * @returns data URL or null when unknown.
 */
@Remote('projectMediaData') projectMediaData(id: ProjectId, assetId: ProjectMediaId): string | null

/**
 * Read recent portable locations without opening or creating project files.
 * @returns recent folders and availability.
 */
@Remote('projectFolders') projectFolders(): StudioFolder[]

/**
 * Open a portable project or creation form.
 * @param path - absolute project directory.
 * @returns its current location.
 */
@Remote('openFolder') openFolder(path: string): StudioFolder

/**
 * Establish a portable creation form before any assistant task.
 * @param path - empty absolute directory.
 * @param id - form identity.
 * @param input - initial form.
 * @returns its saved location.
 */
@Remote('prepareFolder') async prepareFolder(path: string, id: StudioCreationId, input: ProjectInput): Promise<StudioFolder>

/**
 * Drain professional work, flush its history, then release all project files.
 * @param id - open folder identity.
 */
@Remote('closeFolder') async closeFolder(id: StudioFolderId): Promise<void>

/**
 * Hide a catalog entry without accessing project files or changing its mounted runtime.
 * @param id - recent location identity.
 */
@Remote('forgetFolder') forgetFolder(id: StudioFolderId): void

/**
 * Reveal the currently opened directory on the application host.
 * @param id - mounted folder.
 * @param signal - caller cancellation.
 */
@Remote('revealFolder') async revealFolder(id: StudioFolderId, signal: AbortSignal): Promise<void>

/** Copy a legacy project and its dialogue into an empty portable directory; the source remains intact.
 * @param id - legacy project identity.
 * @param path - empty destination directory.
 * @returns the opened portable location after all histories have been copied.
 */
@Remote('migrateProject') async migrateProject(id: ProjectId, path: string): Promise<StudioFolder>

/**
 * Save a complete copy and close the source for transfer.
 * @param id - source folder.
 * @param destination - empty absolute destination.
 */
@Remote('backupFolder') async backupFolder(id: StudioFolderId, destination: string): Promise<void>

/**
 * Persist a recoverable editor buffer without creating a formal content revision.
 * @param id - project identity.
 * @param baseRevision - version edited.
 * @param input - complete buffer.
 */
@Remote('saveEditorDraft') saveEditorDraft(id: ProjectId, baseRevision: number, input: ProjectInput): void

/**
 * Read a recoverable buffer; its base revision may require conflict resolution.
 * @param id - project identity.
 * @returns saved buffer or null.
 */
@Remote('editorDraft') editorDraft(id: ProjectId): { baseRevision: number; input: ProjectInput } | null

/**
 * Resolve a professional Session's currently mounted directory.
 * @param id - reserved Session identity.
 * @returns current root and disk check, or undefined for legacy sessions.
 */
sessionProject(id: SessionId): { root: string; check: () => void } | undefined

/**
 * List current projects, including archived ones, sorted by update time then stable identity.
 * @returns Metadata without creative text bodies; corrupt stored documents throw.
 */
@Remote('list') list(): ProjectSummary[]

/** Read the deployment upload limit before selecting a cover.
 * @returns maximum decoded image bytes accepted by setCover.
 */
@Remote('coverUploadLimit') coverUploadLimit(): number

/** Replace or remove a custom project cover independently of text revisions.
 * @param id - existing, non-archived project UUID.
 * @param expectedRevision - cover revision observed in list(); zero before any upload.
 * @param image - PNG, JPEG or WebP base64 data URL within coverUploadLimit(), or null to remove it.
 * @returns committed cover metadata; invalid images, stale revisions and archived projects throw without writing.
 */
@Remote('setCover') setCover(id: ProjectId, expectedRevision: number, image: string | null): ProjectCover

/**
 * Read the latest immutable revision directly from SQLite.
 * @param id - Existing or unknown canonical project UUID.
 * @returns The current document, or null when the project does not exist; corruption throws.
 */
@Remote('get') get(id: ProjectId): Project | null

/**
 * Persist a complete project without starting an agent or generation task.
 * @param input - Complete editable content with caller-created episode UUIDs.
 * @returns The first durable revision; invalid content or foreign episode ownership throws.
 */
@Remote('create') create(input: ProjectInput): Project

/**
 * Save all editable content as a new immutable revision.
 * @param id - Project to edit; unknown projects throw.
 * @param expectedRevision - Revision used to prepare the caller's draft.
 * @param input - Complete replacement content; metadata fields are rejected.
 * @returns Saved revision or unchanged current project on conflict/archive; stale checks take precedence.
 */
@Remote('save') save(id: ProjectId, expectedRevision: number, input: ProjectInput): SaveResult

/**
 * Archive or restore a project without altering its creative content.
 * @param id - Project to archive or restore; unknown projects throw.
 * @param expectedRevision - Revision used for this decision.
 * @param archived - True for read-only archive, false to restore editing.
 * @returns A new revision on transition, current revision for an identical state, or conflict.
 */
@Remote('setArchived') setArchived(id: ProjectId, expectedRevision: number, archived: boolean): SaveResult

/**
 * Read every project revision, including removed episodes and archive transitions.
 * @param id - Project UUID.
 * @returns Detached documents oldest first, or an empty array for an unknown project; corruption throws.
 */
@Remote('history') history(id: ProjectId): Project[]

/** List saved creation forms independently of formal projects.
 * @returns recoverable, unpublished creation drafts.
 */
@Remote('creationDrafts') creationDrafts(): StudioCreationSummary[]

/** Reopen the latest saved creation form without invoking an assistant.
 * @param id - creation-form identity.
 * @returns saved input or null when unknown.
 */
@Remote('creationDraft') creationDraft(id: StudioCreationId): StudioCreationDraft | null

/** Save a creation form without creating a Project or starting an Agent.
 * @param id - independent creation-form identity.
 * @param expectedRevision - last observed form revision, or null for a new form.
 * @param input - complete form fields; the title may still be empty.
 * @returns saved state or a conflict retaining current data.
 */
@Remote('saveCreationDraft') saveCreationDraft(id: StudioCreationId, expectedRevision: number | null, input: ProjectInput): StudioCreationSaveResult

/** Create a formal project from a saved form exactly once.
 * @param id - creation-form identity.
 * @param expectedRevision - form version confirmed by the user.
 * @param input - valid complete project content.
 * @returns the created project; stale or different repeated input is rejected.
 */
@Remote('createFromDraft') createFromDraft(id: StudioCreationId, expectedRevision: number, input: ProjectInput): Project

/** Read actual dependency availability for the professional configuration panel.
 * @returns registered capabilities; missing providers are reported explicitly.
 */
@Remote('assistantCatalog') async assistantCatalog(): Promise<StudioAssistantCatalog>

/** Read the field policy used by both proposal schemas and application validation.
 * @param target - frozen authoring target.
 * @returns target-owned field identities.
 */
proposalFields(target: StudioTarget): StudioField[]

/** List the published professional-role configurations.
 * @param folderId - open project identity, or omit for device templates.
 * @returns one current version for each role.
 */
@Remote('roles') roles(folderId?: StudioFolderId): StudioRoleRevision[]

/** Publish a human-edited role configuration; existing workspaces retain their versions.
 * @param role - role identity.
 * @param expectedRevision - version edited by the user.
 * @param config - complete professional configuration.
 * @param folderId - open project identity, or omit for device templates.
 * @returns the new immutable role revision.
 */
@Remote('publishRole') async publishRole( role: StudioRoleId, expectedRevision: number, config: StudioRoleConfig, folderId?: StudioFolderId, ): Promise<StudioRoleRevision>

/** Open recorded dialogue without starting an Agent or making a model request.
 * @param target - stable project, episode, or creation-form target.
 * @param newConversation - create a separate dialogue instead of reopening the latest one.
 * @returns its current role-version binding and recorded work.
 */
@Remote('openWorkspace') openWorkspace(target: StudioTarget, newConversation?: boolean): StudioWorkspaceView

/** Read a previously bound workspace, including in-flight tasks from an older role version.
 * @param id - workspace identity.
 * @returns recorded tasks, suggestions, and locks.
 */
@Remote('workspace') workspace(id: StudioWorkspaceId): StudioWorkspaceView

/** Resolve host policy when the Harness creates or resumes a bound Session.
 * @param sessionId - actual Session identity, never a model-reported role.
 * @returns its immutable professional binding, or null for an ordinary Session.
 */
workspaceForSession(sessionId: SessionId): StudioWorkspace | null

/** Record successful Session creation before sending its first professional input.
 * @param id - workspace whose reserved Session now exists.
 */
markWorkspaceSession(id: StudioWorkspaceId): void

/** Install one trusted professional execution provider for this project service.
 * @param backend - real Agent/Session execution provider.
 * @returns a disposer that removes the provider; its owner drains live Agents.
 */
registerAssistantBackend(backend: StudioAssistantBackend): () => void

/** Capture a human request, then execute independently of browser navigation.
 * @param request - immutable target binding, local input, expected revision, and prompt.
 * @returns the recorded task immediately; waitTask observes its settlement.
 */
@Remote('startAssistant') async startAssistant(request: StudioTaskRequest): Promise<StudioTaskView>

/** Assert that a professional execution belongs to this service's live dispatch and durable snapshot.
 * @param task - snapshot supplied to the registered execution provider.
 * @throws when an unowned or altered task attempts to drive a Session.
 */
assertAssistantTask(task: StudioTask): void

/** Await a task's recorded settlement without polling a model or repeating submission.
 * @param id - task identity returned by startAssistant.
 * @returns terminal state, or current state when another process owns execution.
 */
@Remote('waitTask') async waitTask(id: StudioTaskId): Promise<StudioTaskView>

/** Stop owned professional work; external-process work is never falsely reported as stopped.
 * @param id - task identity.
 * @returns recorded final state after the Agent is quiescent.
 */
@Remote('cancelAssistant') async cancelAssistant(id: StudioTaskId): Promise<StudioTaskView>

/** Apply human-selected suggestions to a draft; this never approves content.
 * @param request - selected fields and current local/saved input.
 * @returns new draft input or an explicit conflict/lock/archive rejection.
 */
@Remote('applyProposal') applyProposal(request: StudioApplyRequest): StudioApplyResult

/** Ignore pending proposal fields without editing the project.
 * @param id - proposal identity.
 * @param fields - pending fields selected by the user.
 * @returns updated proposal disposition.
 */
@Remote('ignoreProposal') ignoreProposal(id: StudioProposalId, fields: StudioField[]): StudioProposal

/** Protect selected fields from assistant proposal application.
 * @param target - authoring target.
 * @param fields - complete set of protected fields.
 * @returns the saved lock set.
 */
@Remote('setFieldLocks') setFieldLocks(target: StudioTarget, fields: StudioField[]): StudioField[]

/** Submit a saved target for human content review.
 * @param target - existing project content.
 * @param expectedRevision - exact saved project version.
 * @returns the queued review record.
 */
@Remote('submitReview') submitReview(target: Exclude<StudioTarget, { kind: 'creation' }>, expectedRevision: number): StudioReview

/** Read pending and completed reviews for a project.
 * @param id - project identity.
 * @returns reviews tied to their original saved versions.
 */
@Remote('reviews') reviews(id: ProjectId): StudioReview[]

/** Read the global human review queue across projects.
 * @returns review records carrying explicit project and version references.
 */
@Remote('reviewQueue') reviewQueue(): StudioReview[]

/** Read an approved immutable input for a controlled, workspace-scoped context tool.
 * @param id - review identity already authorized by the frozen task.
 * @returns exact approved fields and their review reference.
 */
approvedContext(id: StudioReviewId): { review: StudioReview; fields: { field: StudioField; value: StudioFieldValue }[] }

/** Record a human approval or return; professional tools do not expose this operation.
 * @param id - pending review identity.
 * @param decision - approve or return the saved content.
 * @param comment - review explanation.
 * @returns the immutable decision.
 */
@Remote('decideReview') decideReview(id: StudioReviewId, decision: 'approved' | 'returned', comment: string): StudioReview
```

Types: [SessionId](core.zh.md)

Source: [`packages/multica/studio-core/src/index.ts`](../../packages/multica/studio-core/src/index.ts)
<!-- END GENERATED cordis-surface -->
