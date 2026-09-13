/** Remote query projection and request ownership; drafts remain in the declared editor store. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { Project, ProjectId, ProjectInput, ProjectSummary, ProjectCover, SaveResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { createMulticaStore, ProjectDraft } from './drafts.ts'

type Actions = BoundActions<ReturnType<typeof createMulticaStore>>

/** Injected wire operations, kept separate from the generated service object's identity. */
export interface ProjectApi {
  coverUploadLimit: () => Promise<number>
  setCover: (id: ProjectId, revision: number, image: string | null) => Promise<ProjectCover>
  list: () => Promise<ProjectSummary[]>
  get: (id: ProjectId) => Promise<Project | null>
  create: (input: ProjectInput) => Promise<Project>
  save: (id: ProjectId, revision: number, input: ProjectInput) => Promise<SaveResult>
  setArchived: (id: ProjectId, revision: number, archived: boolean) => Promise<SaveResult>
  history: (id: ProjectId) => Promise<Project[]>
}

/** Read and write progress for one remote document. */
export interface ProjectQuery {
  project: Project | null
  loading: boolean
  saving: boolean
  error: boolean
  missing: boolean
  history: Project[]
  historyLoading: boolean
  historyError: boolean
}

/** Remote observations published through the injected framework hook. */
export interface ProjectQueries {
  maxCoverBytes: number | null
  covers: Record<ProjectId, { saving: boolean; error: boolean }>
  list: ProjectSummary[]
  loading: boolean
  error: boolean
  creating: boolean
  createError: boolean
  byId: Record<ProjectId, ProjectQuery>
}

function freshQuery(): ProjectQuery {
  return {
    project: null,
    loading: false,
    saving: false,
    error: false,
    missing: false,
    history: [],
    historyLoading: false,
    historyError: false,
  }
}

function requireQuery(state: ProjectQueries, id: ProjectId): ProjectQuery {
  const query = state.byId[id]
  if (query === undefined) throw new Error(`Multica query has not opened project ${id}`)
  return query
}

/** Own requests independently of React navigation; disposal silences late completions. */
export class ProjectModel {
  /** Saved-project observations and request progress consumed by the workspace hook. */
  readonly source = createSnapshotStore<ProjectQueries>({
    maxCoverBytes: null,
    covers: {},
    list: [],
    loading: false,
    error: false,
    creating: false,
    createError: false,
    byId: {},
  })
  private alive = true
  private listRequest = 0
  private reads = new Map<ProjectId, number>()
  private histories = new Map<ProjectId, number>()

  /** @param api - callback-only access to the generated Remote namespace. */
  constructor(private readonly api: ProjectApi) {}

  /** End this projection's lifetime without attempting to cancel committed Host writes. */
  dispose(): void {
    this.alive = false
  }

  private active(): boolean {
    return this.alive
  }

  /** Refresh catalog metadata; a later refresh supersedes an earlier response. */
  async list(): Promise<void> {
    const request = ++this.listRequest
    this.source.update((d) => {
      d.loading = true
      d.error = false
    })
    try {
      const [list, maxCoverBytes] = await Promise.all([this.api.list(), this.api.coverUploadLimit()])
      if (this.active() && request === this.listRequest)
        this.source.update((d) => {
          d.list = list
          d.maxCoverBytes = maxCoverBytes
          d.loading = false
        })
    } catch {
      if (this.active() && request === this.listRequest)
        this.source.update((d) => {
          d.error = true
          d.loading = false
        })
    }
  }

  /** Replace one catalog cover; late completion never changes another card or a disposed model.
   * @param id - project selected by the upload gesture.
   * @param revision - observed cover revision.
   * @param image - validated file data URL, or null to remove the custom image.
   */
  async setCover(id: ProjectId, revision: number, image: string | null): Promise<void> {
    if (!this.active() || this.source.getSnapshot().covers[id]?.saving) return
    this.source.update((d) => { d.covers[id] = { saving: true, error: false } })
    let failed = false
    try {
      await this.api.setCover(id, revision, image)
      if (this.active()) await this.list()
    } catch {
      if (this.active()) {
        failed = true
        await this.list()
      }
    } finally {
      if (this.active()) this.source.update((d) => { d.covers[id] = { saving: false, error: failed } })
    }
  }

  private accept(project: Project): Project {
    const current = this.source.getSnapshot().byId[project.id]?.project
    if (current && current.revision > project.revision) return current
    this.source.update((d) => {
      const query = (d.byId[project.id] ??= freshQuery())
      query.project = project
    })
    return project
  }

  /** Publish a confirmed project mutation from a professional proposal without accepting an older observation.
   * @param project - server-confirmed project revision.
   * @returns the latest observed project for reconciliation by the owning draft store.
   */
  adopt(project: Project): Project {
    const accepted = this.accept(project)
    void this.list()
    void this.history(project.id)
    return accepted
  }

  /** Read a project without changing selection or overwriting a dirty editor.
   * @param id - project to refresh.
   * @param actions - the declared draft mutation callbacks.
   */
  async open(id: ProjectId, actions: Actions): Promise<void> {
    const request = (this.reads.get(id) ?? 0) + 1
    this.reads.set(id, request)
    this.source.update((d) => {
      const q = (d.byId[id] ??= freshQuery())
      q.loading = true
      q.error = false
      q.missing = false
    })
    try {
      const project = await this.api.get(id)
      if (!this.active() || this.reads.get(id) !== request) return
      if (project) actions.received(this.accept(project))
      this.source.update((d) => {
        requireQuery(d, id).loading = false
        requireQuery(d, id).missing = project === null
      })
    } catch {
      if (this.active() && this.reads.get(id) === request)
        this.source.update((d) => {
          const query = requireQuery(d, id)
          query.loading = false
          query.error = true
        })
    }
  }

  /** Submit one creation at a time, preserving any later form edits.
   * @param input - captured complete form.
   * @param edit - submitted form edit counter.
   * @param actions - declared draft actions.
   * @param operation - optional idempotent publication of a saved creation form.
   */
  async create(input: ProjectInput, edit: number, actions: Actions, operation?: () => Promise<Project>): Promise<void> {
    if (!this.active() || this.source.getSnapshot().creating) return
    this.source.update((d) => {
      d.creating = true
      d.createError = false
    })
    try {
      const project = await (operation ? operation() : this.api.create(input))
      if (!this.active()) return
      this.accept(project)
      actions.created(project, edit)
      void this.list()
    } catch {
      if (this.active())
        this.source.update((d) => {
          d.createError = true
        })
    } finally {
      if (this.active())
        this.source.update((d) => {
          d.creating = false
        })
    }
  }

  /** Write with an expected revision; concurrent edits remain unsaved after completion.
   * @param id - stable project identity.
   * @param draft - submitted input, edit counter, and base revision.
   * @param actions - declared draft actions.
   * @param archived - archive transition, or undefined for a content save.
   */
  async save(id: ProjectId, draft: ProjectDraft, actions: Actions, archived?: boolean): Promise<void> {
    const query = requireQuery(this.source.getSnapshot(), id)
    if (!this.active() || query.saving) return
    this.source.update((d) => {
      requireQuery(d, id).saving = true
      requireQuery(d, id).error = false
    })
    // Reads issued before this mutation cannot replace its result or mark its draft conflicted.
    this.reads.set(id, (this.reads.get(id) ?? 0) + 1)
    try {
      const result =
        archived === undefined
          ? await this.api.save(id, draft.baseRevision, draft.input)
          : await this.api.setArchived(id, draft.baseRevision, archived)
      if (!this.active()) return
      const project = this.accept(result.project)
      if (result.status === 'saved') {
        if (archived !== undefined && draft.dirty) actions.received(project)
        else {
          actions.saved(result.project, draft.edit)
          if (project.revision > result.project.revision) actions.received(project)
        }
      } else actions.conflicted(id)
      void this.list()
      void this.history(id)
    } catch {
      if (this.active())
        this.source.update((d) => {
          requireQuery(d, id).error = true
        })
    } finally {
      if (this.active())
        this.source.update((d) => {
          requireQuery(d, id).saving = false
          requireQuery(d, id).loading = false
        })
    }
  }

  /** Read immutable revisions with latest-request-wins ordering.
   * @param id - owning project.
   */
  async history(id: ProjectId): Promise<void> {
    const request = (this.histories.get(id) ?? 0) + 1
    this.histories.set(id, request)
    this.source.update((d) => {
      const q = (d.byId[id] ??= freshQuery())
      q.historyLoading = true
      q.historyError = false
    })
    try {
      const history = await this.api.history(id)
      if (this.active() && this.histories.get(id) === request)
        this.source.update((d) => {
          const query = requireQuery(d, id)
          query.history = history
          query.historyLoading = false
        })
    } catch {
      if (this.active() && this.histories.get(id) === request)
        this.source.update((d) => {
          const query = requireQuery(d, id)
          query.historyError = true
          query.historyLoading = false
        })
    }
  }
}
