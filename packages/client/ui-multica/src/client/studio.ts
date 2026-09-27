/** Professional workspace queries and request ownership, independent of visible page selection. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  ModelSelection,
  ProjectInput,
  StudioTarget,
  StudioWorkspaceId,
  StudioWorkspaceView,
  StudioTaskRequest,
  StudioTaskView,
  StudioTaskId,
  StudioRequestId,
  StudioRoleId,
  StudioRoleRevision,
  StudioRoleConfig,
  StudioAssistantCatalog,
  StudioCreationId,
  StudioCreationDraft,
  StudioCreationSummary,
  StudioCreationSaveResult,
  StudioApplyRequest,
  StudioApplyResult,
  StudioProposalId,
  StudioProposal,
  StudioField,
  StudioReview,
  StudioReviewId,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Callback-only interface to the generated Host Remote. */
export interface StudioApi {
  creations(this: void): Promise<StudioCreationSummary[]>
  creation(this: void, id: StudioCreationId): Promise<StudioCreationDraft | null>
  saveCreation(this: void, id: StudioCreationId, revision: number | null, input: ProjectInput): Promise<StudioCreationSaveResult>
  catalog(this: void): Promise<StudioAssistantCatalog>
  roles(this: void): Promise<StudioRoleRevision[]>
  publishRole(this: void, role: StudioRoleId, revision: number, config: StudioRoleConfig): Promise<StudioRoleRevision>
  open(this: void, target: StudioTarget): Promise<StudioWorkspaceView>
  workspace(this: void, id: StudioWorkspaceId): Promise<StudioWorkspaceView>
  start(this: void, request: StudioTaskRequest): Promise<StudioTaskView>
  wait(this: void, id: StudioTaskId): Promise<StudioTaskView>
  cancel(this: void, id: StudioTaskId): Promise<StudioTaskView>
  apply(this: void, request: StudioApplyRequest): Promise<StudioApplyResult>
  ignore(this: void, id: StudioProposalId, fields: StudioField[]): Promise<StudioProposal>
  locks(this: void, target: StudioTarget, fields: StudioField[]): Promise<StudioField[]>
  reviews(this: void): Promise<StudioReview[]>
  submit(this: void, target: Exclude<StudioTarget, { kind: 'creation' }>, revision: number): Promise<StudioReview>
  decide(this: void, id: StudioReviewId, decision: 'approved' | 'returned', comment: string): Promise<StudioReview>
}

/** One workspace's observed content and current UI operation. */
export interface StudioQuery {
  view: StudioWorkspaceView | null
  loading: boolean
  busy: boolean
  error: string | null
  outcome: StudioApplyResult['status'] | null
  retry: StudioTaskRequest | null
}

/** Host observations consumed through an injected framework hook. */
export interface StudioState {
  catalog: StudioAssistantCatalog | null
  creations: StudioCreationSummary[]
  creationSaving: boolean
  creationError: string | null
  creationConflict: StudioCreationDraft | null
  roles: StudioRoleRevision[]
  loading: boolean
  error: string | null
  bindings: Record<string, StudioWorkspaceId>
  opening: Record<string, boolean>
  openErrors: Record<string, string | null>
  byId: Record<StudioWorkspaceId, StudioQuery>
  reviews: StudioReview[]
  reviewLoading: boolean
  reviewError: string | null
  reviewBusy: boolean
  publishing: boolean
}

/** Stable client lookup key; server parsing remains authoritative.
 * @param target - project, episode, or creation-form identity.
 * @returns a key for retained dialogue drafts and query bindings.
 */
export function studioTargetKey(target: StudioTarget): string {
  return JSON.stringify(target)
}

function query(): StudioQuery {
  return { view: null, loading: false, busy: false, error: null, outcome: null, retry: null }
}
function requireStudioQuery(state: StudioState, id: StudioWorkspaceId): StudioQuery {
  const current = state.byId[id]
  if (!current) throw new Error('The professional workspace has not been opened')
  return current
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
}

/** Own asynchronous requests without moving another workspace or replacing its unsent text. */
export class StudioModel {
  /** Catalog, workspace, proposal, and review observations for the renderer. */
  readonly source = createSnapshotStore<StudioState>({
    catalog: null,
    creations: [],
    creationSaving: false,
    creationError: null,
    creationConflict: null,
    roles: [],
    loading: false,
    error: null,
    bindings: {},
    opening: {},
    openErrors: {},
    byId: {},
    reviews: [],
    reviewLoading: false,
    reviewError: null,
    reviewBusy: false,
    publishing: false,
  })
  private alive = true
  private isAlive(): boolean {
    return this.alive
  }
  private catalogRead = 0
  private reviewRead = 0
  private creationRead = 0
  private readonly opens = new Map<string, number>()
  private readonly reads = new Map<StudioWorkspaceId, number>()
  private readonly watching = new Map<StudioTaskId, Promise<void>>()

  /** @param api - generated Remote callbacks. */
  constructor(private readonly api: StudioApi) {}

  /** Silence late publications; closing a page never claims to cancel a running Host task. */
  dispose(): void {
    this.alive = false
  }

  /** Read recoverable form metadata without depending on model configuration. */
  async creations(): Promise<void> {
    const request = ++this.creationRead
    try {
      const creations = await this.api.creations()
      if (this.isAlive() && request === this.creationRead)
        this.source.update((state) => {
          state.creations = creations
          state.creationError = null
        })
    } catch (error) {
      if (this.isAlive() && request === this.creationRead)
        this.source.update((state) => {
          state.creationError = errorText(error)
        })
    }
  }

  /** Save an independent creation form before sending it to a professional.
   * @param id - form identity.
   * @param revision - known saved form version.
   * @param input - complete captured input.
   * @returns confirmed saved form, or undefined on conflict/failure.
   */
  async saveCreation(id: StudioCreationId, revision: number | null, input: ProjectInput): Promise<StudioCreationDraft | undefined> {
    if (!this.isAlive() || this.source.getSnapshot().creationSaving) return undefined
    this.source.update((state) => {
      state.creationSaving = true
      state.creationError = null
      state.creationConflict = null
    })
    try {
      const result = await this.api.saveCreation(id, revision, input)
      if (!this.isAlive()) return undefined
      if (result.status === 'conflict') {
        this.source.update((state) => {
          state.creationConflict = result.draft
        })
        return undefined
      }
      await this.creations()
      return result.draft
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          state.creationError = errorText(error)
        })
      return undefined
    } finally {
      if (this.isAlive())
        this.source.update((state) => {
          state.creationSaving = false
        })
    }
  }

  /** Reopen a form from its server-owned identity without creating a formal project.
   * @param id - form selected from the recovery list.
   * @param loaded - declared-store callback, which preserves any later unsaved input.
   */
  async resumeCreation(id: StudioCreationId, loaded: (draft: StudioCreationDraft) => void): Promise<void> {
    if (!this.isAlive() || this.source.getSnapshot().creationSaving) return
    this.source.update((state) => {
      state.creationSaving = true
      state.creationError = null
      state.creationConflict = null
    })
    try {
      const draft = await this.api.creation(id)
      if (this.isAlive()) {
        if (draft) loaded(draft)
        else
          this.source.update((state) => {
            state.creationError = ''
          })
      }
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          state.creationError = errorText(error)
        })
    } finally {
      if (this.isAlive())
        this.source.update((state) => {
          state.creationSaving = false
        })
    }
  }

  /** Load actual dependency choices and published role versions without running an Agent. */
  async catalog(): Promise<void> {
    const request = ++this.catalogRead
    this.source.update((state) => {
      state.loading = true
      state.error = null
    })
    try {
      const [catalog, roles] = await Promise.all([this.api.catalog(), this.api.roles()])
      if (this.isAlive() && request === this.catalogRead)
        this.source.update((state) => {
          state.catalog = catalog
          state.roles = roles
          state.loading = false
        })
    } catch (error) {
      if (this.isAlive() && request === this.catalogRead)
        this.source.update((state) => {
          state.error = errorText(error)
          state.loading = false
        })
    }
  }

  /** Open the current role version for a target; page changes do not submit a prompt.
   * @param target - authoring target selected by the user.
   */
  async open(target: StudioTarget): Promise<void> {
    const key = studioTargetKey(target)
    const request = (this.opens.get(key) ?? 0) + 1
    this.opens.set(key, request)
    this.source.update((state) => {
      state.opening[key] = true
      state.openErrors[key] = null
    })
    try {
      const view = await this.api.open(target)
      if (!this.isAlive() || this.opens.get(key) !== request) return
      this.accept(view)
      this.source.update((state) => {
        state.bindings[key] = view.workspace.id
        state.opening[key] = false
      })
      for (const task of view.tasks) if (task.status === 'running') void this.watch(task)
    } catch (error) {
      if (this.isAlive() && this.opens.get(key) === request)
        this.source.update((state) => {
          state.opening[key] = false
          state.openErrors[key] = errorText(error)
        })
    }
  }

  /** Select a recorded role-version dialogue without changing its execution target.
   * @param target - current authoring target.
   * @param id - one of its recorded workspace versions.
   */
  async selectVersion(target: StudioTarget, id: StudioWorkspaceId): Promise<void> {
    const key = studioTargetKey(target)
    const current = this.source.getSnapshot().bindings[key]
    const versions = current ? this.source.getSnapshot().byId[current]?.view?.versions : undefined
    if (!versions?.some(version => version.id === id)) return
    this.source.update((state) => {
      state.bindings[key] = id
      state.byId[id] ??= query()
    })
    await this.refresh(id)
  }

  private accept(view: StudioWorkspaceView): void {
    const key = studioTargetKey(view.workspace.target)
    this.source.update((state) => {
      const current = (state.byId[view.workspace.id] ??= query())
      current.view = view
      current.loading = false
      if (current.retry && view.tasks.some(task => task.requestId === current.retry?.requestId)) current.retry = null
      for (const item of Object.values(state.byId)) {
        if (item.view && studioTargetKey(item.view.workspace.target) === key) item.view = { ...item.view, versions: view.versions }
      }
    })
  }

  /** Refresh one recorded dialogue and attach to any still-running local task.
   * @param id - workspace identity.
   */
  async refresh(id: StudioWorkspaceId): Promise<void> {
    const request = (this.reads.get(id) ?? 0) + 1
    this.reads.set(id, request)
    this.source.update((state) => {
      const current = (state.byId[id] ??= query())
      current.loading = true
      current.error = null
    })
    try {
      const view = await this.api.workspace(id)
      if (!this.isAlive() || this.reads.get(id) !== request) return
      this.accept(view)
      for (const task of view.tasks) if (task.status === 'running') void this.watch(task)
    } catch (error) {
      if (this.isAlive() && this.reads.get(id) === request)
        this.source.update((state) => {
          requireStudioQuery(state, id).loading = false
          requireStudioQuery(state, id).error = errorText(error)
        })
    }
  }

  /** Submit a new prompt, retaining its request id when the transport outcome is uncertain.
   * @param id - workspace identity.
   * @param revision - saved revision underlying the local draft, or null for creation.
   * @param input - complete captured local draft.
   * @param prompt - explicit human request.
   * @param submitted - clears only the exact submitted text in the declared draft store.
   * @param modelSelection - model and effort captured for this submission and transport retries.
   */
  async send(
    id: StudioWorkspaceId, revision: number | null, input: ProjectInput, prompt: string,
    submitted: () => void, modelSelection?: ModelSelection,
  ): Promise<void> {
    const current = requireStudioQuery(this.source.getSnapshot(), id)
    if (!this.isAlive() || current.busy || current.retry) return
    const request: StudioTaskRequest = {
      workspaceId: id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: revision,
      input,
      prompt,
      ...(modelSelection ? { modelSelection } : {}),
    }
    this.source.update((state) => {
      requireStudioQuery(state, id).retry = request
    })
    await this.submit(request, submitted)
  }

  /** Retry the same captured request and nonce, never silently resubmit edited content.
   * @param id - workspace with an uncertain submission.
   * @param submitted - clears only the successfully submitted prompt.
   */
  async retry(id: StudioWorkspaceId, submitted: () => void): Promise<void> {
    const current = this.source.getSnapshot().byId[id]
    if (current?.retry && !current.busy) await this.submit(current.retry, submitted)
  }

  /** Explicitly stop waiting for an uncertain submission; its Host work may still finish.
   * @param id - workspace selected by the user.
   */
  abandon(id: StudioWorkspaceId): void {
    this.source.update((state) => {
      const current = state.byId[id]
      if (current && !current.busy) {
        current.retry = null
        current.error = null
      }
    })
  }

  private async submit(request: StudioTaskRequest, submitted: () => void): Promise<void> {
    const id = request.workspaceId
    this.source.update((state) => {
      requireStudioQuery(state, id).busy = true
      requireStudioQuery(state, id).error = null
    })
    try {
      const task = await this.api.start(request)
      if (!this.isAlive()) return
      this.source.update((state) => {
        requireStudioQuery(state, id).retry = null
      })
      submitted()
      await this.refresh(id)
      if (task.status === 'running') await this.watch(task)
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, id).error = errorText(error)
        })
    } finally {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, id).busy = false
        })
    }
  }

  private watch(task: StudioTaskView): Promise<void> {
    const existing = this.watching.get(task.id)
    if (existing) return existing
    const done = (async () => {
      try {
        await this.api.wait(task.id)
        if (this.isAlive()) await this.refresh(task.workspaceId)
      } catch (error) {
        if (this.isAlive())
          this.source.update((state) => {
            requireStudioQuery(state, task.workspaceId).error = errorText(error)
          })
      }
    })()
    this.watching.set(task.id, done)
    void done.then(() => {
      this.watching.delete(task.id)
    })
    return done
  }

  /** Cancel a known Host task and read its actual settled state.
   * @param task - recorded task selected by the user.
   */
  async cancel(task: StudioTaskView): Promise<void> {
    try {
      await this.api.cancel(task.id)
      if (this.isAlive()) await this.refresh(task.workspaceId)
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, task.workspaceId).error = errorText(error)
        })
    }
  }

  /** Apply selected differences and report the exact returned draft to the owning store.
   * @param id - proposal's original workspace.
   * @param request - captured local fields and saved revision.
   * @param applied - owner callback that merges safe fields while preserving later manual edits.
   */
  async apply(id: StudioWorkspaceId, request: StudioApplyRequest, applied: (result: StudioApplyResult) => void): Promise<void> {
    const current = this.source.getSnapshot().byId[id]
    if (!current || current.busy) return
    this.source.update((state) => {
      requireStudioQuery(state, id).busy = true
      requireStudioQuery(state, id).error = null
      requireStudioQuery(state, id).outcome = null
    })
    try {
      const result = await this.api.apply(request)
      if (!this.isAlive()) return
      applied(result)
      this.source.update((state) => {
        requireStudioQuery(state, id).outcome = result.status
      })
      await this.refresh(id)
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, id).error = errorText(error)
        })
    } finally {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, id).busy = false
        })
    }
  }

  /** Ignore selected pending fields without changing any project data.
   * @param id - original workspace.
   * @param proposalId - proposal identity.
   * @param fields - human-selected fields.
   */
  async ignore(id: StudioWorkspaceId, proposalId: StudioProposalId, fields: StudioField[]): Promise<void> {
    try {
      await this.api.ignore(proposalId, fields)
      if (this.isAlive()) await this.refresh(id)
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, id).error = errorText(error)
        })
    }
  }

  /** Update target-owned field locks through the human endpoint.
   * @param view - exact workspace being edited.
   * @param fields - complete protected-field list.
   */
  async locks(view: StudioWorkspaceView, fields: StudioField[]): Promise<void> {
    if (!this.isAlive() || requireStudioQuery(this.source.getSnapshot(), view.workspace.id).busy) return
    this.source.update((state) => {
      requireStudioQuery(state, view.workspace.id).busy = true
    })
    try {
      await this.api.locks(view.workspace.target, fields)
      if (this.isAlive()) await this.refresh(view.workspace.id)
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, view.workspace.id).error = errorText(error)
        })
    } finally {
      if (this.isAlive())
        this.source.update((state) => {
          requireStudioQuery(state, view.workspace.id).busy = false
        })
    }
  }

  /** Publish a human role configuration without replacing an in-flight workspace.
   * @param role - existing published role.
   * @param config - complete edited configuration.
   * @param published - owner callback for the confirmed role draft.
   */
  async publish(role: StudioRoleRevision, config: StudioRoleConfig, published: (value: StudioRoleRevision) => void): Promise<void> {
    if (this.source.getSnapshot().publishing) return
    this.source.update((state) => {
      state.publishing = true
      state.error = null
    })
    try {
      const value = await this.api.publishRole(role.role, role.revision, config)
      if (this.isAlive()) {
        this.source.update((state) => {
          state.roles = [...state.roles.filter(item => item.role !== value.role), value]
        })
        published(value)
        await this.catalog()
      }
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          state.error = errorText(error)
        })
    } finally {
      if (this.isAlive())
        this.source.update((state) => {
          state.publishing = false
        })
    }
  }

  /** Read the global human review queue. */
  async reviews(): Promise<void> {
    const request = ++this.reviewRead
    this.source.update((state) => {
      state.reviewLoading = true
      state.reviewError = null
    })
    try {
      const reviews = await this.api.reviews()
      if (this.isAlive() && request === this.reviewRead)
        this.source.update((state) => {
          state.reviews = reviews
          state.reviewLoading = false
        })
    } catch (error) {
      if (this.isAlive() && request === this.reviewRead)
        this.source.update((state) => {
          state.reviewError = errorText(error)
          state.reviewLoading = false
        })
    }
  }

  /** Submit saved content for review; no Agent runs and no content is approved.
   * @param target - saved target identity.
   * @param revision - exact saved project version.
   */
  async submitReview(target: Exclude<StudioTarget, { kind: 'creation' }>, revision: number): Promise<void> {
    await this.reviewMutation(() => this.api.submit(target, revision))
  }

  /** Record a human decision for the selected immutable review.
   * @param review - pending review.
   * @param decision - approve or return.
   * @param comment - human explanation.
   */
  async decide(review: StudioReview, decision: 'approved' | 'returned', comment: string): Promise<void> {
    await this.reviewMutation(() => this.api.decide(review.id, decision, comment))
  }

  private async reviewMutation(operation: () => Promise<StudioReview>): Promise<void> {
    if (this.source.getSnapshot().reviewBusy) return
    this.source.update((state) => {
      state.reviewBusy = true
      state.reviewError = null
    })
    try {
      await operation()
      if (this.isAlive()) await this.reviews()
    } catch (error) {
      if (this.isAlive())
        this.source.update((state) => {
          state.reviewError = errorText(error)
        })
    } finally {
      if (this.isAlive())
        this.source.update((state) => {
          state.reviewBusy = false
        })
    }
  }
}

/** Plain callbacks passed to workspace components; no Service or model instance crosses into React. */
export interface StudioActions {
  creations(): Promise<void>
  saveCreation(id: StudioCreationId, revision: number | null, input: ProjectInput): Promise<void>
  resumeCreation(id: StudioCreationId): Promise<void>
  catalog(): Promise<void>
  open(target: StudioTarget): Promise<void>
  refresh(id: StudioWorkspaceId): Promise<void>
  selectVersion(target: StudioTarget, id: StudioWorkspaceId): Promise<void>
  send(id: StudioWorkspaceId, revision: number | null, input: ProjectInput, prompt: string, modelSelection?: ModelSelection): Promise<void>
  retry(id: StudioWorkspaceId): Promise<void>
  abandon(id: StudioWorkspaceId): void
  cancel(task: StudioTaskView): Promise<void>
  apply(id: StudioWorkspaceId, target: StudioTarget, request: StudioApplyRequest): Promise<void>
  ignore(id: StudioWorkspaceId, proposalId: StudioProposalId, fields: StudioField[]): Promise<void>
  locks(view: StudioWorkspaceView, fields: StudioField[]): Promise<void>
  publish(role: StudioRoleRevision, config: StudioRoleConfig, edit: number): Promise<void>
  reviews(): Promise<void>
  submitReview(target: Exclude<StudioTarget, { kind: 'creation' }>, revision: number): Promise<void>
  decide(review: StudioReview, decision: 'approved' | 'returned', comment: string): Promise<void>
}
