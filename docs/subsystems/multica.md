# Multica projects

English | [中文](multica.zh.md)

The [Multica group](../../packages/multica/README.md) owns saved project specifications, outlines and episode drafts. The [browser workspace](../../packages/client/ui-multica/README.md) consumes the project service through typed Remote calls. The [project revision decision](../../.agents/notes/implemented/architecture/2026-09-10-multica-project-revisions.md) explains the storage scope and separation from Session logs.

## Identity and versions

Project and episode IDs are distinct branded strings. Episodes belong to one project; a save cannot reuse another project's episode identity. Project revisions are positive integers. The caller supplies the expected revision for every save or archive change.

A successful write returns the committed project. A conflict returns the current project and writes nothing. An archived project rejects content saves until explicitly restored. Project lookup and history always name the project identity; historical content remains accessible after later saves or archive changes.

The saved project includes its name, concept, imported source text, aspect ratio, optional target episode count and duration, outline and ordered episode drafts. Target counts are specifications rather than automatically generated episodes. Revisions preserve the complete project content; restoring content creates another revision instead of replacing history.

## Runtime ownership

The local SQLite database belongs to the host service and survives browser and server restarts. The browser retains pending edits for the current editing session and submits them explicitly. Browser storage is not the authority for saved projects.

Project creation and manual saves do not create Agents. The [professional runtime](../../packages/multica/studio-agents/README.md) executes explicit planner and writer tasks and logs their frozen inputs in dedicated Sessions. Proposal application and exact-version content approval remain separate human operations; media production is unavailable.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

/** Resolve model and dependency content once, before its workspace begins execution.
 * @param role - immutable, validated role configuration.
 * @returns the effective model and selected skill bodies/tool identities.
 */
async resolve(role: StudioRoleRevision): Promise<StudioResolvedRole>

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
```

Source: [`packages/multica/studio-agents/src/index.ts`](../../packages/multica/studio-agents/src/index.ts)

<a id="ctxstudioprojects--studioprojects"></a>

### `ctx.studioProjects` — `StudioProjects`

Revisioned projects and permanent episode identities exposed as studioProjects Remote methods.

```ts cordis-catalog
/**
 * List current projects, including archived ones, sorted by update time then stable identity.
 * @returns Metadata without creative text bodies; corrupt stored documents throw.
 */
@Remote('list') list(): ProjectSummary[]

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
 * @returns one current version for each role.
 */
@Remote('roles') roles(): StudioRoleRevision[]

/** Publish a human-edited role configuration; existing workspaces retain their versions.
 * @param role - role identity.
 * @param expectedRevision - version edited by the user.
 * @param config - complete professional configuration.
 * @returns the new immutable role revision.
 */
@Remote('publishRole') async publishRole(role: StudioRoleId, expectedRevision: number, config: StudioRoleConfig): Promise<StudioRoleRevision>

/** Open recorded dialogue without starting an Agent or making a model request.
 * @param target - stable project, episode, or creation-form target.
 * @returns its current role-version binding and recorded work.
 */
@Remote('openWorkspace') openWorkspace(target: StudioTarget): StudioWorkspaceView

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

Types: [SessionId](core.md)

Source: [`packages/multica/studio-core/src/index.ts`](../../packages/multica/studio-core/src/index.ts)
<!-- END GENERATED cordis-surface -->
