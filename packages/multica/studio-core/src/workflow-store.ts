/** SQLite transactions for role configurations, frozen tasks, partial proposals, and human reviews. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { transaction } from './database.ts'
import { projectInputSchema, revisionSchema } from './validation.ts'
import {
  roleIdSchema,
  roleConfigSchema,
  roleRevisionSchema,
  targetSchema,
  roleForTarget,
  targetFields,
  taskRequestSchema,
  taskSchema,
  workspaceSchema,
  proposalSchema,
  applyRequestSchema,
  assistantResultSchema,
  resolvedRoleSchema,
  reviewSchema,
  creationDraftSchema,
  creationInputSchema,
  readField,
  replaceField,
  fieldSchema,
} from './workflow-schema.ts'
import type { Project, ProjectId, ProjectInput } from './types.ts'
import type {
  StudioCreationDraft,
  StudioCreationSaveResult,
  StudioCreationId,
  StudioRoleId,
  StudioRoleConfig,
  StudioRoleRevision,
  StudioTarget,
  StudioWorkspace,
  StudioWorkspaceId,
  StudioResolvedRole,
  StudioTaskRequest,
  StudioTask,
  StudioTaskView,
  StudioTaskId,
  StudioAssistantResult,
  StudioProposal,
  StudioProposalId,
  StudioApplyRequest,
  StudioApplyResult,
  StudioField,
  StudioReview,
  StudioReviewId,
  StudioWorkspaceView,
} from './workflow-types.ts'

/** The project repository owns document validation and immutable append semantics. */
export interface WorkflowProjects {
  get(id: ProjectId): Project | null
  create(input: ProjectInput): Project
  revision(id: ProjectId, revision: number): Project | null
  append(current: Project, input: ProjectInput): Project
}

const ROLE_PERSONAS: Record<StudioRoleId, string> = {
  planner:
    'Develop comic-series concepts and outlines: clarify the premise, central conflict, character arcs, world rules, and episode scale. Distinguish confirmed facts from open questions. Offer focused, editable changes rather than writing unrelated episodes.',
  writer:
    'Write and revise comic episode scripts with clear scene action, distinct character voices, causal progression, pacing, and closing suspense. Preserve the supplied outline and established facts. Work only on the selected episode or episode plan.',
  'character-designer':
    'Develop stable character identities, appearance anchors, wardrobe variants, expressions, and visual reference requirements. Keep identity separate from episode-specific clothing and states. Propose designs for human review.',
  'art-director':
    'Develop consistent scene layouts, fixed spatial relationships, lighting plans, and prop states. Explain unknown dimensions or positions instead of inventing authoritative continuity facts.',
  'storyboard-director':
    'Translate approved story action into readable shots with explicit framing, camera position, eye lines, duration, and transitions. Preserve character and spatial continuity and cite the source story segment.',
  'image-artist':
    'Prepare controlled keyframe requests that identify approved references, required changes, preserved features, and local repair regions. A proposal does not authorize generation or adopt a candidate.',
  'video-director':
    'Prepare shot motion and camera plans using approved input frames. State action start/end, duration, continuity constraints, and unsupported provider controls. Production requires separate human authorization.',
  editor:
    'Plan episode rhythm, shot ordering, trims, still-image movement, sound, and subtitles from explicit media versions. Propose editable timeline changes; final export requires approved content.',
  'continuity-reviewer':
    'Read supplied story, asset, and shot versions to identify concrete continuity discrepancies with object references and evidence. Explain uncertainty. Do not edit, approve, or authorize production.',
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
function targetKey(target: StudioTarget): string {
  return JSON.stringify(target)
}
function now(): string {
  return new Date().toISOString()
}

/** Transactional workflow storage inside the same database as project revisions. */
export class StudioWorkflowStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly projects: WorkflowProjects,
  ) {}

  /** List saved creation forms that have not been published as projects.
   * @returns latest form revisions, newest first.
   */
  creations(): StudioCreationDraft[] {
    return this.db
      .prepare(
        'SELECT d.* FROM studio_creation_drafts d WHERE revision = (SELECT MAX(revision) FROM studio_creation_drafts WHERE draft_id = d.draft_id) AND NOT EXISTS (SELECT 1 FROM studio_creation_projects WHERE draft_id = d.draft_id) ORDER BY rowid DESC',
      )
      .all()
      .map(row => this.decodeCreation(row))
  }

  /** Read a saved creation form without publishing it.
   * @param id - creation-form identity.
   * @returns its latest revision or null.
   */
  creation(id: StudioCreationId): StudioCreationDraft | null {
    z.uuid().parse(id)
    const row = this.db.prepare('SELECT * FROM studio_creation_drafts WHERE draft_id = ? ORDER BY revision DESC LIMIT 1').get(id)
    return row ? this.decodeCreation(row) : null
  }

  private decodeCreation(row: Record<string, unknown>): StudioCreationDraft {
    const draft = creationDraftSchema.parse(JSON.parse(z.string().parse(row.document)))
    if (draft.id !== row.draft_id || draft.revision !== row.revision) throw new Error('Creation draft disagrees with its revision columns')
    return draft
  }

  /** Save an independent creation form without creating a Project or Agent.
   * @param id - creation-form identity.
   * @param expectedRevision - known form revision, or null for a new form.
   * @param input - complete form, which may still lack a title.
   * @returns saved form or a conflict carrying its current revision.
   */
  saveCreation(id: StudioCreationId, expectedRevision: number | null, input: ProjectInput): StudioCreationSaveResult {
    z.uuid().parse(id)
    revisionSchema.nullable().parse(expectedRevision)
    const parsed = creationInputSchema.parse(input)
    return transaction(this.db, () => {
      if (this.db.prepare('SELECT 1 FROM studio_creation_projects WHERE draft_id = ?').get(id))
        throw new Error('This form already created a project; edit the project instead')
      const current = this.creation(id)
      if (current && same(current.input, parsed)) return { status: 'saved', draft: current }
      if ((current?.revision ?? null) !== expectedRevision) {
        if (!current) throw new Error('Creation draft not found')
        return { status: 'conflict', draft: current }
      }
      return { status: 'saved', draft: this.appendCreation(id, parsed) }
    })
  }

  private appendCreation(id: StudioCreationId, input: ProjectInput): StudioCreationDraft {
    if (this.db.prepare('SELECT 1 FROM studio_creation_projects WHERE draft_id = ?').get(id))
      throw new Error('This creation form is already published')
    const current = this.creation(id)
    const draft = creationDraftSchema.parse({ id, revision: (current?.revision ?? 0) + 1, input, updatedAt: now() })
    this.db
      .prepare('INSERT INTO studio_creation_drafts (draft_id, revision, document) VALUES (?, ?, ?)')
      .run(id, draft.revision, JSON.stringify(draft))
    return draft
  }

  /** Publish one saved form exactly once; retrying the same input returns its existing project.
   * @param id - saved creation-form identity.
   * @param expectedRevision - form revision edited by the user.
   * @param input - complete valid project content.
   * @returns the formal Project; different retry input and stale forms are rejected.
   */
  createFromDraft(id: StudioCreationId, expectedRevision: number, input: ProjectInput): Project {
    z.uuid().parse(id)
    revisionSchema.parse(expectedRevision)
    const parsed = projectInputSchema.parse(input)
    return transaction(this.db, () => {
      const published = this.db.prepare('SELECT * FROM studio_creation_projects WHERE draft_id = ?').get(id)
      if (published) {
        const row = this.db
          .prepare('SELECT * FROM studio_creation_drafts WHERE draft_id = ? AND revision = ?')
          .get(id, z.number().parse(published.draft_revision))
        if (!row || !same(this.decodeCreation(row).input, parsed))
          throw new Error('This form already created a project with different content')
        const project = this.projects.get(z.string().parse(published.project_id) as ProjectId)
        if (!project) throw new Error('The published project is missing')
        return project
      }
      const current = this.creation(id)
      if (!current || current.revision !== expectedRevision)
        throw new Error('Creation draft changed; reload it before creating the project')
      const draft = same(current.input, parsed) ? current : this.appendCreation(id, parsed)
      const project = this.projects.create(parsed)
      this.db
        .prepare('INSERT INTO studio_creation_projects (draft_id, project_id, draft_revision) VALUES (?, ?, ?)')
        .run(id, project.id, draft.revision)
      return project
    })
  }

  /** Seed only absent roles; user-published versions are never overwritten.
   * @param defaults - validated deployment defaults for model execution limits.
   */
  seedRoles(defaults: Pick<StudioRoleConfig, 'maxTokens' | 'maxSteps' | 'timeoutMs'>): void {
    transaction(this.db, () => {
      for (const role of roleIdSchema.options) {
        if (this.db.prepare('SELECT 1 FROM studio_roles WHERE role = ?').get(role)) continue
        const config: StudioRoleConfig = { ...defaults, persona: ROLE_PERSONAS[role], provider: null, model: null, skills: [], tools: [] }
        this.insertRole({ role, revision: 1, config, createdAt: now() })
      }
    })
  }

  /** List the current immutable configuration of each professional role.
   * @returns current role revisions in stable identity order.
   */
  roles(): StudioRoleRevision[] {
    return this.db
      .prepare('SELECT * FROM studio_roles r WHERE revision = (SELECT MAX(revision) FROM studio_roles WHERE role = r.role) ORDER BY role')
      .all()
      .map(row => this.decodeRole(row))
  }

  /** Publish a complete configuration against the expected role version.
   * @param role - stable professional identity.
   * @param expectedRevision - configuration shown to the human editor.
   * @param config - complete replacement configuration.
   * @returns the new immutable revision; a conflict throws without writing.
   */
  publishRole(role: StudioRoleId, expectedRevision: number, config: StudioRoleConfig): StudioRoleRevision {
    roleIdSchema.parse(role)
    revisionSchema.parse(expectedRevision)
    const parsed = roleConfigSchema.parse(config)
    return transaction(this.db, () => {
      const current = this.roles().find(value => value.role === role)
      if (!current || current.revision !== expectedRevision) throw new Error('Role configuration changed; reload before publishing')
      const published = { role, revision: expectedRevision + 1, config: parsed, createdAt: now() }
      this.insertRole(published)
      return published
    })
  }

  private insertRole(role: StudioRoleRevision): void {
    this.db
      .prepare('INSERT INTO studio_roles (role, revision, document) VALUES (?, ?, ?)')
      .run(role.role, role.revision, JSON.stringify(roleRevisionSchema.parse(role)))
  }

  /** Bind a target to the current role version without creating or driving an Agent.
   * @param target - project, episode, or independent creation draft.
   * @returns a durable workspace with a reserved Session identity.
   */
  open(target: StudioTarget): StudioWorkspace {
    const parsed = targetSchema.parse(target)
    this.requireTarget(parsed)
    return transaction(this.db, () => {
      const role = this.roles().find(value => value.role === roleForTarget(parsed))
      if (!role) throw new Error('The required professional role is not configured')
      const key = `${targetKey(parsed)}:${role.role}:${role.revision}`
      const existing = this.db.prepare('SELECT * FROM studio_workspaces WHERE binding_key = ?').get(key)
      if (existing) return this.decodeWorkspace(existing)
      const workspace = workspaceSchema.parse({
        id: randomUUID(),
        target: parsed,
        role,
        sessionId: randomUUID(),
        resolved: null,
        initialized: false,
        createdAt: now(),
      })
      this.db
        .prepare('INSERT INTO studio_workspaces (id, binding_key, session_id, document) VALUES (?, ?, ?, ?)')
        .run(workspace.id, key, workspace.sessionId, JSON.stringify(workspace))
      return workspace
    })
  }

  /** Read one exact workspace, including an older role configuration.
   * @param id - workspace identity.
   * @returns the durable binding; unknown identities throw.
   */
  workspace(id: StudioWorkspaceId): StudioWorkspace {
    z.uuid().parse(id)
    const row = this.db.prepare('SELECT * FROM studio_workspaces WHERE id = ?').get(id)
    if (!row) throw new Error('Professional workspace not found')
    return this.decodeWorkspace(row)
  }

  /** Find the host-owned policy for a Session, including cold resumes.
   * @param sessionId - Session identity observed by the Agent lifecycle.
   * @returns its workspace, or null for an ordinary Harness Session.
   */
  workspaceForSession(sessionId: SessionId): StudioWorkspace | null {
    const row = this.db.prepare('SELECT * FROM studio_workspaces WHERE session_id = ?').get(sessionId)
    return row ? this.decodeWorkspace(row) : null
  }

  /** Mark the first successful Session publication; a missing log must never silently reset this workspace.
   * @param id - workspace whose Agent was published.
   */
  markSessionInitialized(id: StudioWorkspaceId): void {
    const workspace = this.workspace(id)
    if (!workspace.initialized)
      this.db.prepare('UPDATE studio_workspaces SET document = ? WHERE id = ?').run(JSON.stringify({ ...workspace, initialized: true }), id)
  }

  private decodeRole(row: Record<string, unknown>): StudioRoleRevision {
    const role = roleRevisionSchema.parse(JSON.parse(z.string().parse(row.document)))
    if (role.role !== row.role || role.revision !== row.revision) throw new Error('Role configuration disagrees with its revision columns')
    return role
  }

  private decodeWorkspace(row: Record<string, unknown>): StudioWorkspace {
    const workspace = workspaceSchema.parse(JSON.parse(z.string().parse(row.document)))
    const key = `${targetKey(workspace.target)}:${workspace.role.role}:${workspace.role.revision}`
    if (workspace.id !== row.id || workspace.sessionId !== row.session_id || key !== row.binding_key)
      throw new Error('Workspace identity disagrees with its binding columns')
    const role = this.db
      .prepare('SELECT * FROM studio_roles WHERE role = ? AND revision = ?')
      .get(workspace.role.role, workspace.role.revision)
    if (!role || !same(this.decodeRole(role), workspace.role)) throw new Error('Workspace role differs from its immutable configuration')
    if (workspace.target.kind !== 'creation' && !this.projects.get(workspace.target.projectId))
      throw new Error('Workspace project is missing')
    return workspace
  }

  /** Read settled and in-flight dialogue plus proposals for one workspace.
   * @param id - workspace identity.
   * @returns recorded content and target-owned field locks.
   */
  view(id: StudioWorkspaceId): StudioWorkspaceView {
    const workspace = this.workspace(id)
    const tasks = this.db
      .prepare('SELECT * FROM studio_tasks WHERE workspace_id = ? ORDER BY rowid')
      .all(id)
      .map(row => this.taskView(this.decodeTask(row)))
    const proposals = this.db
      .prepare('SELECT * FROM studio_proposals WHERE workspace_id = ? ORDER BY rowid')
      .all(id)
      .map(row => this.decodeProposal(row))
    const versions = this.db
      .prepare("SELECT * FROM studio_workspaces WHERE json_extract(document, '$.target') = ? ORDER BY rowid DESC")
      .all(targetKey(workspace.target))
      .map((row) => {
        const bound = this.decodeWorkspace(row)
        return {
          id: bound.id,
          roleRevision: bound.role.revision,
          running: this.db.prepare("SELECT 1 FROM studio_tasks WHERE workspace_id = ? AND state = 'running'").get(bound.id) !== undefined,
        }
      })
    return {
      workspace,
      tasks,
      proposals,
      lockedFields: this.locks(workspace.target),
      creation: workspace.target.kind === 'creation' ? this.creation(workspace.target.draftId) : null,
      allowedFields: targetFields(workspace.target),
      versions,
    }
  }

  /** Freeze a task and its effective dependencies under the SQLite writer lock.
   * @param request - explicit human prompt, local draft, and expected saved revision.
   * @param resolved - host-resolved dependencies for a previously unresolved workspace.
   * @returns the new task, or its existing idempotent submission; overlapping work throws.
   */
  start(request: StudioTaskRequest, resolved: StudioResolvedRole): { task: StudioTask; created: boolean } {
    const input = taskRequestSchema.parse(request)
    const dependencies = resolvedRoleSchema.parse(resolved)
    return transaction(this.db, () => {
      const previous = this.db.prepare('SELECT * FROM studio_tasks WHERE request_id = ?').get(input.requestId)
      if (previous) {
        const task = this.decodeTask(previous)
        if (
          task.workspaceId !== input.workspaceId ||
          task.prompt !== input.prompt ||
          task.expectedRevision !== input.expectedRevision ||
          !same(task.input, input.input) ||
          !same(task.modelSelection ?? null, input.modelSelection ?? null)
        )
          throw new Error('A task request ID cannot be reused with different input')
        return { task, created: false }
      }
      const workspace = this.workspace(input.workspaceId)
      if (this.roles().find(role => role.role === workspace.role.role)?.revision !== workspace.role.revision)
        throw new Error('Professional configuration changed; reopen the workspace before starting another task')
      const project = this.requireTarget(workspace.target)
      if (project?.archived) throw new Error('Archived projects cannot start professional tasks')
      const creation = workspace.target.kind === 'creation' ? this.creation(workspace.target.draftId) : null
      if (
        workspace.target.kind === 'creation' &&
        this.db.prepare('SELECT 1 FROM studio_creation_projects WHERE draft_id = ?').get(workspace.target.draftId)
      )
        throw new Error('This form already created a project; open the project workspace')
      if ((project?.revision ?? creation?.revision ?? null) !== input.expectedRevision)
        throw new Error('Project or creation draft changed; reload or save it before starting')
      if (workspace.target.kind === 'creation' && (!creation || !same(creation.input, input.input)))
        throw new Error('Save the creation draft before sending its first request')
      if (project) projectInputSchema.parse(input.input)
      for (const field of targetFields(workspace.target)) readField(input.input, workspace.target, field)
      if (this.db.prepare("SELECT 1 FROM studio_tasks WHERE workspace_id = ? AND state = 'running'").get(workspace.id))
        throw new Error('This workspace already has a running task')
      const bound = { ...workspace, resolved: workspace.resolved ?? dependencies }
      this.db.prepare('UPDATE studio_workspaces SET document = ? WHERE id = ?').run(JSON.stringify(bound), workspace.id)
      const task = taskSchema.parse({
        id: randomUUID(),
        workspaceId: workspace.id,
        requestId: input.requestId,
        target: workspace.target,
        role: workspace.role,
        resolved: dependencies,
        modelSelection: input.modelSelection,
        sessionId: workspace.sessionId,
        expectedRevision: input.expectedRevision,
        input: input.input,
        prompt: input.prompt,
        reviews: project ? this.reviews(project.id) : [],
        status: 'running',
        reply: '',
        error: null,
        createdAt: now(),
        finishedAt: null,
      })
      this.db
        .prepare('INSERT INTO studio_tasks (id, workspace_id, request_id, owner_pid, state, document) VALUES (?, ?, ?, ?, ?, ?)')
        .run(task.id, task.workspaceId, task.requestId, process.pid, task.status, JSON.stringify(task))
      return { task, created: true }
    })
  }

  /** Project a task for browser dialogue without copying its complete input into every refresh.
   * @param task - validated host record.
   * @returns compact user-visible task facts.
   */
  taskView(task: StudioTask): StudioTaskView {
    return {
      id: task.id,
      workspaceId: task.workspaceId,
      requestId: task.requestId,
      target: task.target,
      sessionId: task.sessionId,
      role: task.role.role,
      roleRevision: task.role.revision,
      provider: task.resolved.provider,
      model: task.resolved.model,
      ...(task.resolved.reasoningEffort === undefined ? {} : { reasoningEffort: task.resolved.reasoningEffort }),
      expectedRevision: task.expectedRevision,
      prompt: task.prompt,
      status: task.status,
      reply: task.reply,
      error: task.error,
      createdAt: task.createdAt,
      finishedAt: task.finishedAt,
    }
  }

  /** Read one recorded task independently of the current browser selection.
   * @param id - task identity.
   * @returns current task state; unknown identities throw.
   */
  task(id: StudioTaskId): StudioTask {
    z.uuid().parse(id)
    const row = this.db.prepare('SELECT * FROM studio_tasks WHERE id = ?').get(id)
    if (!row) throw new Error('Professional task not found')
    return this.decodeTask(row)
  }

  private decodeTask(row: Record<string, unknown>): StudioTask {
    const task = taskSchema.parse(JSON.parse(z.string().parse(row.document)))
    if (task.id !== row.id || task.workspaceId !== row.workspace_id || task.requestId !== row.request_id || task.status !== row.state)
      throw new Error('Task identity or status disagrees with its columns')
    const workspace = this.workspace(task.workspaceId)
    if (
      task.sessionId !== workspace.sessionId ||
      !same(task.target, workspace.target) ||
      !same(task.role, workspace.role) ||
      !same(task.resolved, task.modelSelection
        ? { ...workspace.resolved, reasoningEffort: undefined, ...task.modelSelection }
        : workspace.resolved)
    )
      throw new Error('Task context differs from its workspace binding')
    if (task.target.kind !== 'creation') projectInputSchema.parse(task.input)
    for (const reference of task.reviews) {
      if (task.target.kind === 'creation' || reference.target.projectId !== task.target.projectId)
        throw new Error('Review reference belongs to another task scope')
      const row = this.db.prepare('SELECT * FROM studio_reviews WHERE id = ?').get(reference.id)
      if (!row) throw new Error('Task review reference is missing')
      const current = this.decodeReview(row)
      if (
        !same(reference.target, current.target) ||
        reference.projectRevision !== current.projectRevision ||
        (reference.status !== 'pending' && !same(reference, current))
      )
        throw new Error('Task review reference is inconsistent')
    }
    return task
  }

  /** Store a logged assistant result and an immutable proposal in one transaction.
   * @param id - host-owned task identity.
   * @param result - structured result already committed to its Session log.
   * @returns completed task; malformed or out-of-scope output leaves the running task unchanged.
   */
  complete(id: StudioTaskId, result: StudioAssistantResult): StudioTask {
    const parsed = assistantResultSchema.parse(result)
    return transaction(this.db, () => {
      const task = this.task(id)
      if (task.status !== 'running') return task
      for (const change of parsed.changes) replaceField(task.input, task.target, change.field, change.value)
      if (parsed.changes.length) {
        const proposal = proposalSchema.parse({
          id: randomUUID(),
          taskId: task.id,
          workspaceId: task.workspaceId,
          target: task.target,
          expectedRevision: task.expectedRevision,
          changes: parsed.changes.map(change => ({
            field: change.field,
            before: readField(task.input, task.target, change.field),
            after: change.value,
          })),
          applied: [],
          ignored: [],
          createdAt: now(),
        })
        this.db
          .prepare('INSERT INTO studio_proposals (id, task_id, workspace_id, document) VALUES (?, ?, ?, ?)')
          .run(proposal.id, task.id, task.workspaceId, JSON.stringify(proposal))
      }
      return this.writeTask({ ...task, status: 'completed', reply: parsed.reply, finishedAt: now() })
    })
  }

  /** Record a terminal failure without synthesizing assistant content.
   * @param id - task identity.
   * @param status - failure, cancellation, or restart interruption.
   * @param error - actionable diagnostic.
   * @returns settled task, preserving any prior terminal result.
   */
  fail(id: StudioTaskId, status: 'failed' | 'cancelled' | 'interrupted', error: string): StudioTask {
    return transaction(this.db, () => {
      const task = this.task(id)
      return task.status === 'running' ? this.writeTask({ ...task, status, error, finishedAt: now() }) : task
    })
  }

  private writeTask(task: StudioTask): StudioTask {
    const parsed = taskSchema.parse(task)
    this.db.prepare('UPDATE studio_tasks SET state = ?, document = ? WHERE id = ?').run(parsed.status, JSON.stringify(parsed), parsed.id)
    return parsed
  }

  /** Interrupt records whose owning process is known to have exited; live or inaccessible owners are retained.
   * @param ownerAlive - conservative process-liveness observation supplied by the host.
   */
  interruptPending(ownerAlive: (pid: number) => boolean): void {
    for (const row of this.db.prepare("SELECT id, owner_pid FROM studio_tasks WHERE state = 'running'").all()) {
      if (!ownerAlive(z.number().int().positive().parse(row.owner_pid)))
        this.fail(
          z.string().parse(row.id) as StudioTaskId,
          'interrupted',
          'The application stopped before this task settled; start a new request to continue',
        )
    }
  }

  /** Read a proposal and its accepted/ignored field set.
   * @param id - proposal identity.
   * @returns its durable comparison record.
   */
  proposal(id: StudioProposalId): StudioProposal {
    z.uuid().parse(id)
    const row = this.db.prepare('SELECT * FROM studio_proposals WHERE id = ?').get(id)
    if (!row) throw new Error('Change proposal not found')
    return this.decodeProposal(row)
  }

  private decodeProposal(row: Record<string, unknown>): StudioProposal {
    const proposal = proposalSchema.parse(JSON.parse(z.string().parse(row.document)))
    if (proposal.id !== row.id || proposal.taskId !== row.task_id || proposal.workspaceId !== row.workspace_id)
      throw new Error('Proposal identity disagrees with its columns')
    const task = this.task(proposal.taskId)
    if (
      !same(proposal.target, task.target) ||
      proposal.workspaceId !== task.workspaceId ||
      proposal.expectedRevision !== task.expectedRevision
    )
      throw new Error('Proposal target differs from its recorded task')
    const fields = proposal.changes.map(change => change.field)
    if (new Set(fields).size !== fields.length) throw new Error('Proposal contains repeated fields')
    const resolved = [...proposal.applied, ...proposal.ignored]
    if (new Set(resolved).size !== resolved.length || resolved.some(field => !fields.includes(field)))
      throw new Error('Proposal disposition is inconsistent')
    for (const change of proposal.changes) {
      if (!same(change.before, readField(task.input, task.target, change.field)))
        throw new Error('Proposal before-value differs from the frozen task')
      replaceField(task.input, task.target, change.field, change.after)
    }
    return proposal
  }

  private decodeReview(row: Record<string, unknown>): StudioReview {
    const review = reviewSchema.parse(JSON.parse(z.string().parse(row.document)))
    if (
      review.id !== row.id ||
      review.target.projectId !== row.project_id ||
      `${targetKey(review.target)}:${review.projectRevision}` !== row.review_key
    )
      throw new Error('Review target disagrees with its columns')
    if ((review.status === 'pending') !== (review.decidedAt === null)) throw new Error('Review decision timestamp is inconsistent')
    if (!this.projects.revision(review.target.projectId, review.projectRevision)) throw new Error('Reviewed project revision is missing')
    return review
  }

  /** Apply selected differences atomically, retaining changed local fields and immutable history.
   * @param request - human selection and complete local draft.
   * @returns applied input/project or an explicit conflict, lock, or archive rejection.
   */
  apply(request: StudioApplyRequest): StudioApplyResult {
    const parsed = applyRequestSchema.parse(request)
    return transaction(this.db, () => {
      const proposal = this.proposal(parsed.proposalId)
      const project = this.requireTarget(proposal.target)
      const creation = proposal.target.kind === 'creation' ? this.creation(proposal.target.draftId) : null
      if (project?.archived) return { status: 'archived', fields: [], project, creation }
      if ((project?.revision ?? creation?.revision ?? null) !== parsed.expectedRevision)
        return { status: 'conflict', fields: parsed.fields, project, creation }
      const selected = parsed.fields.map((field) => {
        const change = proposal.changes.find(value => value.field === field)
        if (!change || proposal.applied.includes(field) || proposal.ignored.includes(field))
          throw new Error('Select only unapplied proposal fields')
        return change
      })
      const locked = selected
        .filter(change => this.changeLocked(proposal.target, change.field, parsed.input, change.after))
        .map(change => change.field)
      if (locked.length) return { status: 'locked', fields: locked, project, creation }
      const base = project && proposal.expectedRevision !== null ? this.projects.revision(project.id, proposal.expectedRevision) : null
      const creationRow =
        proposal.target.kind === 'creation' && proposal.expectedRevision !== null
          ? this.db
            .prepare('SELECT * FROM studio_creation_drafts WHERE draft_id = ? AND revision = ?')
            .get(proposal.target.draftId, proposal.expectedRevision)
          : undefined
      const creationBase = creationRow ? this.decodeCreation(creationRow) : null
      if ((project && !base) || (creation && !creationBase)) throw new Error('The proposal base revision is missing')
      const currentInput = project ?? creation?.input
      const baseInput = base ?? creationBase?.input
      const conflicts = selected
        .filter(
          change =>
            !same(readField(parsed.input, proposal.target, change.field), change.before) ||
            (currentInput &&
              baseInput &&
              !same(readField(currentInput, proposal.target, change.field), readField(baseInput, proposal.target, change.field))),
        )
        .map(change => change.field)
      if (conflicts.length) return { status: 'conflict', fields: conflicts, project, creation }
      let input: ProjectInput = parsed.input
      for (const change of selected) input = replaceField(input, proposal.target, change.field, change.after)
      const saved = project ? this.projects.append(project, projectInputSchema.parse(input)) : null
      const savedCreation = proposal.target.kind === 'creation' ? this.appendCreation(proposal.target.draftId, input) : null
      const updated = { ...proposal, applied: [...proposal.applied, ...parsed.fields] }
      this.db.prepare('UPDATE studio_proposals SET document = ? WHERE id = ?').run(JSON.stringify(updated), proposal.id)
      return { status: 'applied', input, project: saved, creation: savedCreation, proposal: updated }
    })
  }

  /** Ignore selected suggestions without changing creative content.
   * @param id - proposal identity.
   * @param fields - pending fields to ignore.
   * @returns updated disposition metadata with unchanged comparisons.
   */
  ignore(id: StudioProposalId, fields: StudioField[]): StudioProposal {
    const selected = z.array(fieldSchema).min(1).parse(fields)
    return transaction(this.db, () => {
      const proposal = this.proposal(id)
      if (this.requireTarget(proposal.target)?.archived) throw new Error('Archived projects are read-only')
      for (const field of selected)
        if (!proposal.changes.some(change => change.field === field) || proposal.applied.includes(field))
          throw new Error('Only pending fields can be ignored')
      const updated = { ...proposal, ignored: [...new Set([...proposal.ignored, ...selected])] }
      this.db.prepare('UPDATE studio_proposals SET document = ? WHERE id = ?').run(JSON.stringify(updated), id)
      return updated
    })
  }

  private changeLocked(
    target: StudioTarget,
    field: StudioField,
    input: ProjectInput,
    after: import('./workflow-types.ts').StudioFieldValue,
  ): boolean {
    if (this.locks(target).includes(field)) return true
    if (target.kind === 'episode') return this.locks({ kind: 'episodes', projectId: target.projectId }).includes('episodes')
    if (target.kind !== 'episodes' || field !== 'episodes') return false
    const next = replaceField(input, target, field, after)
    const rows = this.db
      .prepare(
        "SELECT target_key, document FROM studio_field_locks WHERE json_extract(target_key, '$.projectId') = ? AND json_extract(target_key, '$.kind') = 'episode'",
      )
      .all(target.projectId)
    for (const row of rows) {
      const lockedTarget = targetSchema.parse(JSON.parse(z.string().parse(row.target_key)))
      if (lockedTarget.kind !== 'episode') throw new Error('Invalid episode lock target')
      const beforeEpisode = input.episodes.find(episode => episode.id === lockedTarget.episodeId)
      const afterEpisode = next.episodes.find(episode => episode.id === lockedTarget.episodeId)
      for (const locked of z.array(fieldSchema).parse(JSON.parse(z.string().parse(row.document)))) {
        if (locked !== 'episodeTitle' && locked !== 'episodeScript') throw new Error('Invalid episode lock field')
        if (
          !same(
            beforeEpisode?.[locked === 'episodeTitle' ? 'title' : 'script'],
            afterEpisode?.[locked === 'episodeTitle' ? 'title' : 'script'],
          )
        )
          return true
      }
    }
    return false
  }

  /** Read target-owned locks, shared by every role version of that target.
   * @param target - authoring target.
   * @returns locked field identities.
   */
  locks(target: StudioTarget): StudioField[] {
    const row = this.db.prepare('SELECT document FROM studio_field_locks WHERE target_key = ?').get(targetKey(target))
    return row ? z.array(fieldSchema).parse(JSON.parse(z.string().parse(row.document))) : []
  }

  /** Replace target locks through a human operation.
   * @param target - authoring target.
   * @param fields - complete locked-field list.
   * @returns validated locked fields.
   */
  setLocks(target: StudioTarget, fields: StudioField[]): StudioField[] {
    const parsed = targetSchema.parse(target)
    const locked = z.array(fieldSchema).parse(fields)
    return transaction(this.db, () => {
      if (this.requireTarget(parsed)?.archived) throw new Error('Archived projects are read-only')
      if (locked.some(field => !targetFields(parsed).includes(field))) throw new Error('A lock must name a target-owned field')
      this.db
        .prepare(
          'INSERT INTO studio_field_locks (target_key, document) VALUES (?, ?) ON CONFLICT(target_key) DO UPDATE SET document = excluded.document',
        )
        .run(targetKey(parsed), JSON.stringify([...new Set(locked)]))
      return locked
    })
  }

  /** Submit one saved target revision for human review.
   * @param target - saved authoring target.
   * @param expectedRevision - current saved project revision.
   * @returns the existing or newly queued review.
   */
  submitReview(target: Exclude<StudioTarget, { kind: 'creation' }>, expectedRevision: number): StudioReview {
    const parsed = targetSchema.parse(target)
    if (parsed.kind === 'creation') throw new Error('Create the project before submitting content for review')
    revisionSchema.parse(expectedRevision)
    return transaction(this.db, () => {
      const project = this.requireTarget(parsed)
      if (!project || project.archived || project.revision !== expectedRevision)
        throw new Error('Review requires the current saved revision of an active project')
      this.requireReviewContent(project, parsed)
      const key = `${targetKey(parsed)}:${expectedRevision}`
      const row = this.db.prepare('SELECT * FROM studio_reviews WHERE review_key = ?').get(key)
      if (row) return this.decodeReview(row)
      const review: StudioReview = {
        id: randomUUID() as StudioReviewId,
        target: parsed,
        projectRevision: expectedRevision,
        status: 'pending',
        comment: '',
        createdAt: now(),
        decidedAt: null,
      }
      this.db
        .prepare('INSERT INTO studio_reviews (id, project_id, review_key, document) VALUES (?, ?, ?, ?)')
        .run(review.id, parsed.projectId, key, JSON.stringify(review))
      return review
    })
  }

  /** List review records for a project; approval remains attached to its original revision.
   * @param id - project identity.
   * @returns pending and settled review records.
   */
  reviews(id?: ProjectId): StudioReview[] {
    if (id !== undefined && !this.projects.get(id)) throw new Error('Project not found')
    const rows =
      id === undefined
        ? this.db.prepare('SELECT * FROM studio_reviews ORDER BY rowid DESC').all()
        : this.db.prepare('SELECT * FROM studio_reviews WHERE project_id = ? ORDER BY rowid DESC').all(id)
    return rows.map(row => this.decodeReview(row))
  }

  /** Read content pinned by an immutable approval, without selecting a newer project version.
   * @param id - approved review identity.
   * @returns the reviewed target and its exact field values.
   */
  approvedContext(id: StudioReviewId): {
    review: StudioReview
    fields: Array<{ field: StudioField; value: import('./workflow-types.ts').StudioFieldValue }>
  } {
    z.uuid().parse(id)
    const row = this.db.prepare('SELECT * FROM studio_reviews WHERE id = ?').get(id)
    if (!row) throw new Error('Approved input not found')
    const review = this.decodeReview(row)
    if (review.status !== 'approved') throw new Error('This content is not approved')
    const project = this.projects.revision(review.target.projectId, review.projectRevision)
    if (!project) throw new Error('The approved project revision is missing')
    return { review, fields: targetFields(review.target).map(field => ({ field, value: readField(project, review.target, field) })) }
  }

  /** Approve or return an exact reviewed revision through a human-only endpoint.
   * @param id - queued review identity.
   * @param decision - human content decision.
   * @param comment - review explanation.
   * @returns immutable settled decision; stale inputs are rejected.
   */
  decideReview(id: StudioReviewId, decision: 'approved' | 'returned', comment: string): StudioReview {
    z.uuid().parse(id)
    z.enum(['approved', 'returned']).parse(decision)
    z.string().parse(comment)
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM studio_reviews WHERE id = ?').get(id)
      if (!row) throw new Error('Review not found')
      const review = this.decodeReview(row)
      if (review.status !== 'pending') throw new Error('This review already has a decision')
      const project = this.requireTarget(review.target)
      if (!project || project.archived || project.revision !== review.projectRevision)
        throw new Error('The reviewed input changed; submit its new saved revision')
      if (decision === 'approved') this.requireReviewContent(project, review.target)
      const settled = { ...review, status: decision, comment, decidedAt: now() }
      this.db.prepare('UPDATE studio_reviews SET document = ? WHERE id = ?').run(JSON.stringify(settled), id)
      return settled
    })
  }

  private requireReviewContent(project: Project, target: StudioReview['target']): void {
    if (target.kind === 'outline' && !project.outline.trim()) throw new Error('Write an outline before submitting it for review')
    if (target.kind === 'episodes' && (project.episodes.length === 0 || project.episodes.some(episode => !episode.title.trim())))
      throw new Error('Add titled episodes before submitting the episode plan')
    if (target.kind === 'episode') {
      const episode = project.episodes.find(episode => episode.id === target.episodeId)
      if (!episode?.title.trim() || !episode.script.trim())
        throw new Error('Write the episode title and script before submitting it for review')
    }
  }

  private requireTarget(target: StudioTarget): Project | null {
    if (target.kind === 'creation') return null
    const project = this.projects.get(target.projectId)
    if (!project) throw new Error('Project not found')
    if (target.kind === 'episode' && !project.episodes.some(episode => episode.id === target.episodeId))
      throw new Error('Episode does not belong to this project')
    return project
  }
}
