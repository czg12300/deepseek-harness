/** Multica host project storage; creation and editing have no agent or Session side effects. */

import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { openDatabase, transaction } from './database.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { roleConfigSchema, roleIdSchema, taskRequestSchema, targetFields } from './workflow-schema.ts'
import { StudioWorkflowStore } from './workflow-store.ts'
import type {
  StudioRoleConfig,
  StudioRoleId,
  StudioRoleRevision,
  StudioTarget,
  StudioWorkspace,
  StudioWorkspaceId,
  StudioWorkspaceView,
  StudioTaskRequest,
  StudioTask,
  StudioTaskView,
  StudioTaskId,
  StudioProposalId,
  StudioProposal,
  StudioApplyRequest,
  StudioApplyResult,
  StudioField,
  StudioReview,
  StudioReviewId,
  StudioAssistantBackend,
  StudioAssistantCatalog,
  StudioFieldValue,
  StudioCreationId,
  StudioCreationDraft,
  StudioCreationSummary,
  StudioCreationSaveResult,
} from './workflow-types.ts'
import { projectIdSchema, projectInputSchema, projectSchema, revisionSchema } from './validation.ts'
import type { Project, ProjectId, ProjectInput, ProjectSummary, ProjectCover, SaveResult } from './types.ts'

export type * from './types.ts'
export { SCHEMA_VERSION } from './database.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    studioProjects: StudioProjects
  }
}

/** Deployment-owned database location and SQLite writer contention budget. */
export interface Config {
  /** Harness home; omitted follows DSH_HOME, then ~/.dsh. */
  dshHome?: string
  /** Absolute or home-relative path inside the Harness home; defaults to multica/studio.sqlite. */
  databasePath?: string
  /** SQLite lock wait in milliseconds; defaults to 5000. */
  busyTimeoutMs?: number
  /** Maximum decoded bytes for a custom cover; defaults to 1048576. */
  maxCoverBytes?: number
  /** Initial professional-role execution defaults; published role versions retain their own values. */
  assistantDefaults?: {
    /** Maximum output tokens for newly seeded roles. */
    maxTokens: number
    /** Maximum model steps per task for newly seeded roles. */
    maxSteps: number
    /** Wall-clock execution deadline in milliseconds for newly seeded roles. */
    timeoutMs: number
  }
}

/** Revisioned projects and permanent episode identities exposed as studioProjects Remote methods. */
export class StudioProjects extends TypertRemoteService {
  static Config: Schema<
    Config,
    Config & {
      maxCoverBytes: number; databasePath: string; busyTimeoutMs: number
      assistantDefaults: { maxTokens: number; maxSteps: number; timeoutMs: number }
    }
  > = Schema.object({
    dshHome: Schema.string(),
    databasePath: Schema.string().default('multica/studio.sqlite'),
    busyTimeoutMs: Schema.number().step(1).min(0).max(2_147_483_647).default(5000),
    maxCoverBytes: Schema.number().step(1).min(1).max(8_388_608).default(1_048_576),
    assistantDefaults: Schema.object({
      maxTokens: Schema.number().step(1).min(1).default(8192),
      maxSteps: Schema.number().step(1).min(1).default(8),
      timeoutMs: Schema.number().step(1).min(1).default(180000),
    }).default({ maxTokens: 8192, maxSteps: 8, timeoutMs: 180000 }),
  })

  private readonly maxCoverBytes: number
  private readonly db: DatabaseSync
  private readonly workflow: StudioWorkflowStore
  private backend: StudioAssistantBackend | undefined
  private readonly pending = new Map<StudioTaskId, { backend: StudioAssistantBackend; done: Promise<StudioTask> }>()
  private closing = false

  constructor(ctx: Context, config: Config = {}) {
    const parsed = StudioProjects.Config(config)
    const home = resolveDshHome(parsed.dshHome)
    const path = resolve(home, parsed.databasePath)
    const child = relative(home, path)
    if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error('Multica databasePath must name a file inside dshHome')
    }
    super(ctx, 'studioProjects')
    this.maxCoverBytes = parsed.maxCoverBytes
    this.db = openDatabase(path, parsed.busyTimeoutMs)
    ctx.effect(() => () => {
      this.db.close()
    })
    this.workflow = new StudioWorkflowStore(this.db, {
      get: id => this.get(id),
      create: input => this.createProject(input),
      revision: (id, revision) => {
        const row = this.db.prepare('SELECT * FROM project_revisions WHERE project_id = ? AND revision = ?').get(id, revision)
        return row ? this.decode(row) : null
      },
      append: (current, input) => this.append({ ...current, ...input, ...this.nextRevision(current) }),
    })
    this.workflow.seedRoles(parsed.assistantDefaults)
    ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled(
        [...this.pending].map(async ([id, run]) => {
          await Promise.allSettled([Promise.resolve().then(() => run.backend.cancel(id)), run.done])
        }),
      )
    })
  }

  /**
   * List current projects, including archived ones, sorted by update time then stable identity.
   * @returns Metadata without creative text bodies; corrupt stored documents throw.
   */
  @Remote('list')
  list(): ProjectSummary[] {
    return this.db
      .prepare(
        `
      SELECT r.project_id, r.revision, r.document FROM projects p
      LEFT JOIN project_revisions r ON r.project_id = p.id
      AND r.revision = (SELECT MAX(revision) FROM project_revisions WHERE project_id = p.id)
    `,
      )
      .all()
      .map((row) => {
        if (row.document === null) throw new Error('Multica project has no revisions')
        const project = this.decode(row)
        return {
          id: project.id,
          cover: this.readCover(project.id),
          name: project.name,
          concept: project.concept,
          aspectRatio: project.aspectRatio,
          targetEpisodes: project.targetEpisodes,
          episodeDuration: project.episodeDuration,
          episodeCount: project.episodes.length,
          archived: project.archived,
          revision: project.revision,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  }

  /** Read the deployment upload limit before selecting a cover.
   * @returns maximum decoded image bytes accepted by setCover.
   */
  @Remote('coverUploadLimit')
  coverUploadLimit(): number {
    return this.maxCoverBytes
  }

  private readCover(id: ProjectId): ProjectCover {
    const row = this.db.prepare('SELECT revision, image FROM project_covers WHERE project_id = ?').get(id)
    if (!row) return { revision: 0, image: null }
    return z.strictObject({ revision: revisionSchema, image: z.string().nullable() }).parse(row)
  }

  /** Replace or remove a custom project cover independently of text revisions.
   * @param id - existing, non-archived project UUID.
   * @param expectedRevision - cover revision observed in list(); zero before any upload.
   * @param image - PNG, JPEG or WebP base64 data URL within coverUploadLimit(), or null to remove it.
   * @returns committed cover metadata; invalid images, stale revisions and archived projects throw without writing.
   */
  @Remote('setCover')
  setCover(id: ProjectId, expectedRevision: number, image: string | null): ProjectCover {
    const key = projectIdSchema.parse(id)
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).parse(expectedRevision)
    if (image !== null) {
      z.string().max(Math.ceil(this.maxCoverBytes / 3) * 4 + 32).parse(image)
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
      const encoded = match?.[2]
      if (!match || !encoded) throw new Error('Cover must be a PNG, JPEG or WebP image')
      const bytes = Buffer.from(encoded, 'base64')
      const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : match[1] === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      if (!valid || bytes.length > this.maxCoverBytes || bytes.toString('base64') !== encoded)
        throw new Error('Cover image is invalid or exceeds the upload limit')
    }
    return transaction(this.db, () => {
      const project = this.get(key)
      if (!project || project.archived) throw new Error('Cover requires an existing, active project')
      const current = this.readCover(key)
      if (current.revision !== expectedRevision) throw new Error('Cover has changed; refresh the project before replacing it')
      const cover = { revision: current.revision + 1, image }
      this.db.prepare(`INSERT INTO project_covers (project_id, revision, image) VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, image = excluded.image`)
        .run(key, cover.revision, cover.image)
      return cover
    })
  }

  /**
   * Read the latest immutable revision directly from SQLite.
   * @param id - Existing or unknown canonical project UUID.
   * @returns The current document, or null when the project does not exist; corruption throws.
   */
  @Remote('get')
  get(id: ProjectId): Project | null {
    const key = projectIdSchema.parse(id)
    const row = this.db
      .prepare(
        `
      SELECT * FROM project_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1
    `,
      )
      .get(key)
    if (row !== undefined) return this.decode(row)
    if (this.db.prepare('SELECT id FROM projects WHERE id = ?').get(key) !== undefined) {
      throw new Error(`Multica project ${key} has no revisions`)
    }
    return null
  }

  /**
   * Persist a complete project without starting an agent or generation task.
   * @param input - Complete editable content with caller-created episode UUIDs.
   * @returns The first durable revision; invalid content or foreign episode ownership throws.
   */
  @Remote('create')
  create(input: ProjectInput): Project {
    const content = projectInputSchema.parse(input)
    return transaction(this.db, () => this.createProject(content))
  }

  private createProject(content: ProjectInput): Project {
    const id = projectIdSchema.parse(randomUUID())
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO projects (id) VALUES (?)').run(id)
    return this.append({ ...content, id, revision: 1, archived: false, createdAt: now, updatedAt: now })
  }

  /**
   * Save all editable content as a new immutable revision.
   * @param id - Project to edit; unknown projects throw.
   * @param expectedRevision - Revision used to prepare the caller's draft.
   * @param input - Complete replacement content; metadata fields are rejected.
   * @returns Saved revision or unchanged current project on conflict/archive; stale checks take precedence.
   */
  @Remote('save')
  save(id: ProjectId, expectedRevision: number, input: ProjectInput): SaveResult {
    const content = projectInputSchema.parse(input)
    return this.change(id, expectedRevision, (current) => {
      if (current.archived) return { status: 'archived', project: current }
      return { status: 'saved', project: this.append({ ...current, ...content, ...this.nextRevision(current) }) }
    })
  }

  /**
   * Archive or restore a project without altering its creative content.
   * @param id - Project to archive or restore; unknown projects throw.
   * @param expectedRevision - Revision used for this decision.
   * @param archived - True for read-only archive, false to restore editing.
   * @returns A new revision on transition, current revision for an identical state, or conflict.
   */
  @Remote('setArchived')
  setArchived(id: ProjectId, expectedRevision: number, archived: boolean): SaveResult {
    z.boolean().parse(archived)
    return this.change(id, expectedRevision, current => ({
      status: 'saved',
      project: current.archived === archived ? current : this.append({ ...current, archived, ...this.nextRevision(current) }),
    }))
  }

  /**
   * Read every project revision, including removed episodes and archive transitions.
   * @param id - Project UUID.
   * @returns Detached documents oldest first, or an empty array for an unknown project; corruption throws.
   */
  @Remote('history')
  history(id: ProjectId): Project[] {
    const key = projectIdSchema.parse(id)
    const projects = this.db
      .prepare(
        `
      SELECT * FROM project_revisions WHERE project_id = ? ORDER BY revision
    `,
      )
      .all(key)
      .map(row => this.decode(row))
    const first = projects[0]
    if (first === undefined) {
      if (this.db.prepare('SELECT id FROM projects WHERE id = ?').get(key) !== undefined) {
        throw new Error(`Multica project ${key} has no revisions`)
      }
      return []
    }
    let updatedAt = first.createdAt
    for (const [index, project] of projects.entries()) {
      if (project.revision !== index + 1 || project.createdAt !== first.createdAt || project.updatedAt < updatedAt) {
        throw new Error(`Invalid Multica revision history for ${key}`)
      }
      updatedAt = project.updatedAt
    }
    return projects
  }

  /** List saved creation forms independently of formal projects.
   * @returns recoverable, unpublished creation drafts.
   */
  @Remote('creationDrafts')
  creationDrafts(): StudioCreationSummary[] {
    return this.workflow
      .creations()
      .map(draft => ({ id: draft.id, revision: draft.revision, name: draft.input.name, updatedAt: draft.updatedAt }))
  }

  /** Reopen the latest saved creation form without invoking an assistant.
   * @param id - creation-form identity.
   * @returns saved input or null when unknown.
   */
  @Remote('creationDraft')
  creationDraft(id: StudioCreationId): StudioCreationDraft | null {
    return this.workflow.creation(id)
  }

  /** Save a creation form without creating a Project or starting an Agent.
   * @param id - independent creation-form identity.
   * @param expectedRevision - last observed form revision, or null for a new form.
   * @param input - complete form fields; the title may still be empty.
   * @returns saved state or a conflict retaining current data.
   */
  @Remote('saveCreationDraft')
  saveCreationDraft(id: StudioCreationId, expectedRevision: number | null, input: ProjectInput): StudioCreationSaveResult {
    return this.workflow.saveCreation(id, expectedRevision, input)
  }

  /** Create a formal project from a saved form exactly once.
   * @param id - creation-form identity.
   * @param expectedRevision - form version confirmed by the user.
   * @param input - valid complete project content.
   * @returns the created project; stale or different repeated input is rejected.
   */
  @Remote('createFromDraft')
  createFromDraft(id: StudioCreationId, expectedRevision: number, input: ProjectInput): Project {
    return this.workflow.createFromDraft(id, expectedRevision, input)
  }

  /** Read actual dependency availability for the professional configuration panel.
   * @returns registered capabilities; missing providers are reported explicitly.
   */
  @Remote('assistantCatalog')
  async assistantCatalog(): Promise<StudioAssistantCatalog> {
    return this.backend ? this.backend.catalog() : { backendAvailable: false, enabledRoles: [], defaultModel: null, skills: [], tools: [] }
  }

  /** Read the field policy used by both proposal schemas and application validation.
   * @param target - frozen authoring target.
   * @returns target-owned field identities.
   */
  proposalFields(target: StudioTarget): StudioField[] {
    return targetFields(target)
  }

  /** List the published professional-role configurations.
   * @returns one current version for each role.
   */
  @Remote('roles')
  roles(): StudioRoleRevision[] {
    return this.workflow.roles()
  }

  /** Publish a human-edited role configuration; existing workspaces retain their versions.
   * @param role - role identity.
   * @param expectedRevision - version edited by the user.
   * @param config - complete professional configuration.
   * @returns the new immutable role revision.
   */
  @Remote('publishRole')
  async publishRole(role: StudioRoleId, expectedRevision: number, config: StudioRoleConfig): Promise<StudioRoleRevision> {
    const backend = this.requireBackend()
    const parsed = roleConfigSchema.parse(config)
    roleIdSchema.parse(role)
    revisionSchema.parse(expectedRevision)
    await backend.resolve({ role, revision: expectedRevision + 1, config: parsed, createdAt: new Date().toISOString() })
    if (this.closing || this.backend !== backend) throw new Error('Professional execution provider changed; retry publication')
    return this.workflow.publishRole(role, expectedRevision, parsed)
  }

  /** Open recorded dialogue without starting an Agent or making a model request.
   * @param target - stable project, episode, or creation-form target.
   * @returns its current role-version binding and recorded work.
   */
  @Remote('openWorkspace')
  openWorkspace(target: StudioTarget): StudioWorkspaceView {
    return this.workflow.view(this.workflow.open(target).id)
  }

  /** Read a previously bound workspace, including in-flight tasks from an older role version.
   * @param id - workspace identity.
   * @returns recorded tasks, suggestions, and locks.
   */
  @Remote('workspace')
  workspace(id: StudioWorkspaceId): StudioWorkspaceView {
    return this.workflow.view(id)
  }

  /** Resolve host policy when the Harness creates or resumes a bound Session.
   * @param sessionId - actual Session identity, never a model-reported role.
   * @returns its immutable professional binding, or null for an ordinary Session.
   */
  workspaceForSession(sessionId: SessionId): StudioWorkspace | null {
    return this.workflow.workspaceForSession(sessionId)
  }

  /** Record successful Session creation before sending its first professional input.
   * @param id - workspace whose reserved Session now exists.
   */
  markWorkspaceSession(id: StudioWorkspaceId): void {
    this.workflow.markSessionInitialized(id)
  }

  /** Install one trusted professional execution provider for this project service.
   * @param backend - real Agent/Session execution provider.
   * @returns a disposer that removes the provider; its owner drains live Agents.
   */
  registerAssistantBackend(backend: StudioAssistantBackend): () => void {
    if (this.backend) throw new Error('A professional execution provider is already registered')
    this.workflow.interruptPending((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    })
    this.backend = backend
    return () => {
      if (this.backend === backend) this.backend = undefined
    }
  }

  /** Capture a human request, then execute independently of browser navigation.
   * @param request - immutable target binding, local input, expected revision, and prompt.
   * @returns the recorded task immediately; waitTask observes its settlement.
   */
  @Remote('startAssistant')
  async startAssistant(request: StudioTaskRequest): Promise<StudioTaskView> {
    const backend = this.requireBackend()
    const parsed = taskRequestSchema.parse(request)
    const workspace = this.workflow.workspace(parsed.workspaceId)
    const resolved = workspace.resolved ?? (await backend.resolve(workspace.role))
    if (this.closing || this.backend !== backend) throw new Error('Professional execution provider changed; retry the request')
    const started = this.workflow.start(parsed, resolved)
    const task = deepFreeze(started.task)
    const created = started.created
    if (created) {
      const done = Promise.resolve().then(() => this.executeTask(task, backend))
      this.pending.set(task.id, { backend, done })
      void done.then(
        () => {
          this.pending.delete(task.id)
        },
        (error: unknown) => {
          this.ctx.logger.error('Unable to persist professional task settlement', error)
        },
      )
    }
    return this.workflow.taskView(task)
  }

  /** Assert that a professional execution belongs to this service's live dispatch and durable snapshot.
   * @param task - snapshot supplied to the registered execution provider.
   * @throws when an unowned or altered task attempts to drive a Session.
   */
  assertAssistantTask(task: StudioTask): void {
    if (!this.pending.has(task.id) || JSON.stringify(this.workflow.task(task.id)) !== JSON.stringify(task))
      throw new Error('Professional execution does not match an owned frozen task')
  }

  /** Await a task's recorded settlement without polling a model or repeating submission.
   * @param id - task identity returned by startAssistant.
   * @returns terminal state, or current state when another process owns execution.
   */
  @Remote('waitTask')
  async waitTask(id: StudioTaskId): Promise<StudioTaskView> {
    const task = this.workflow.task(id)
    return this.workflow.taskView(await (this.pending.get(id)?.done ?? task))
  }

  /** Stop owned professional work; external-process work is never falsely reported as stopped.
   * @param id - task identity.
   * @returns recorded final state after the Agent is quiescent.
   */
  @Remote('cancelAssistant')
  async cancelAssistant(id: StudioTaskId): Promise<StudioTaskView> {
    const task = this.workflow.task(id)
    const pending = this.pending.get(id)
    if (!pending) {
      if (task.status === 'running') throw new Error('This task belongs to another process; stop it in that application')
      return this.workflow.taskView(task)
    }
    await pending.backend.cancel(id)
    await pending.done
    return this.workflow.taskView(this.workflow.task(id))
  }

  /** Apply human-selected suggestions to a draft; this never approves content.
   * @param request - selected fields and current local/saved input.
   * @returns new draft input or an explicit conflict/lock/archive rejection.
   */
  @Remote('applyProposal')
  applyProposal(request: StudioApplyRequest): StudioApplyResult {
    return this.workflow.apply(request)
  }

  /** Ignore pending proposal fields without editing the project.
   * @param id - proposal identity.
   * @param fields - pending fields selected by the user.
   * @returns updated proposal disposition.
   */
  @Remote('ignoreProposal')
  ignoreProposal(id: StudioProposalId, fields: StudioField[]): StudioProposal {
    return this.workflow.ignore(id, fields)
  }

  /** Protect selected fields from assistant proposal application.
   * @param target - authoring target.
   * @param fields - complete set of protected fields.
   * @returns the saved lock set.
   */
  @Remote('setFieldLocks')
  setFieldLocks(target: StudioTarget, fields: StudioField[]): StudioField[] {
    return this.workflow.setLocks(target, fields)
  }

  /** Submit a saved target for human content review.
   * @param target - existing project content.
   * @param expectedRevision - exact saved project version.
   * @returns the queued review record.
   */
  @Remote('submitReview')
  submitReview(target: Exclude<StudioTarget, { kind: 'creation' }>, expectedRevision: number): StudioReview {
    return this.workflow.submitReview(target, expectedRevision)
  }

  /** Read pending and completed reviews for a project.
   * @param id - project identity.
   * @returns reviews tied to their original saved versions.
   */
  @Remote('reviews')
  reviews(id: ProjectId): StudioReview[] {
    return this.workflow.reviews(id)
  }

  /** Read the global human review queue across projects.
   * @returns review records carrying explicit project and version references.
   */
  @Remote('reviewQueue')
  reviewQueue(): StudioReview[] {
    return this.workflow.reviews()
  }

  /** Read an approved immutable input for a controlled, workspace-scoped context tool.
   * @param id - review identity already authorized by the frozen task.
   * @returns exact approved fields and their review reference.
   */
  approvedContext(id: StudioReviewId): { review: StudioReview; fields: { field: StudioField; value: StudioFieldValue }[] } {
    return this.workflow.approvedContext(id)
  }

  /** Record a human approval or return; professional tools do not expose this operation.
   * @param id - pending review identity.
   * @param decision - approve or return the saved content.
   * @param comment - review explanation.
   * @returns the immutable decision.
   */
  @Remote('decideReview')
  decideReview(id: StudioReviewId, decision: 'approved' | 'returned', comment: string): StudioReview {
    return this.workflow.decideReview(id, decision, comment)
  }

  private requireBackend(): StudioAssistantBackend {
    if (this.closing || !this.backend) throw new Error('Professional assistants are not configured')
    return this.backend
  }

  private async executeTask(task: StudioTask, backend: StudioAssistantBackend): Promise<StudioTask> {
    try {
      const result = await backend.execute(task)
      return this.workflow.complete(task.id, result)
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError'
      return this.workflow.fail(task.id, cancelled ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private change(id: ProjectId, expectedRevision: number, write: (current: Project) => SaveResult): SaveResult {
    const key = projectIdSchema.parse(id)
    revisionSchema.parse(expectedRevision)
    return transaction(this.db, () => {
      const current = this.get(key)
      if (current === null) throw new Error(`Multica project not found: ${key}`)
      if (current.revision !== expectedRevision) return { status: 'conflict', project: current }
      return write(current)
    })
  }

  private nextRevision(current: Project): Pick<Project, 'revision' | 'updatedAt'> {
    return {
      revision: revisionSchema.parse(current.revision + 1),
      updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString(),
    }
  }

  private append(project: Project): Project {
    for (const episode of project.episodes) {
      const owner = this.db.prepare('SELECT project_id FROM episode_owners WHERE episode_id = ?').get(episode.id)
      if (owner !== undefined && owner.project_id !== project.id) {
        throw new Error(`Episode ${episode.id} belongs to another Multica project`)
      }
      if (owner === undefined) {
        this.db.prepare('INSERT INTO episode_owners (episode_id, project_id) VALUES (?, ?)').run(episode.id, project.id)
      }
    }
    this.db
      .prepare('INSERT INTO project_revisions (project_id, revision, document) VALUES (?, ?, ?)')
      .run(project.id, project.revision, JSON.stringify(project))
    return project
  }

  private decode(row: Record<string, SQLOutputValue>): Project {
    const document = z.string().parse(row.document)
    const project = projectSchema.parse(JSON.parse(document) as unknown)
    if (project.id !== row.project_id || project.revision !== row.revision) {
      throw new Error('Multica project JSON disagrees with its revision columns')
    }
    for (const episode of project.episodes) {
      const owner = this.db.prepare('SELECT project_id FROM episode_owners WHERE episode_id = ?').get(episode.id)
      if (owner?.project_id !== project.id) throw new Error('Invalid Multica episode ownership in stored project')
    }
    return project
  }
}

export default StudioProjects
