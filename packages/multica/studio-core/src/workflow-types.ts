/** Durable professional workspaces, proposals, and human review records. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { EpisodeId, Project, ProjectId, ProjectInput } from './types.ts'

/** Stable professional role, independent of a published configuration revision. */
export type StudioRoleId =
  | 'planner'
  | 'writer'
  | 'character-designer'
  | 'art-director'
  | 'storyboard-director'
  | 'image-artist'
  | 'video-director'
  | 'editor'
  | 'continuity-reviewer'
/** Stable creation-form identity before a Project exists. */
export type StudioCreationId = Branded<'StudioCreationId'>
/** Idempotency key of a human task submission. */
export type StudioRequestId = Branded<'StudioRequestId'>
/** Workspace identity; navigation never changes an existing workspace's target. */
export type StudioWorkspaceId = Branded<'StudioWorkspaceId'>
/** One explicitly started professional task. */
export type StudioTaskId = Branded<'StudioTaskId'>
/** A model proposal, with its own immutable input and proposed field values. */
export type StudioProposalId = Branded<'StudioProposalId'>
/** One human review decision or submission. */
export type StudioReviewId = Branded<'StudioReviewId'>

/** Authoring target captured before a task starts. */
export type StudioTarget =
  | { kind: 'creation'; draftId: StudioCreationId }
  | { kind: 'outline'; projectId: ProjectId }
  | { kind: 'episodes'; projectId: ProjectId }
  | { kind: 'episode'; projectId: ProjectId; episodeId: EpisodeId }

/** Field names are a closed set, never object paths supplied by a model. */
export type StudioField =
  | 'name'
  | 'concept'
  | 'sourceText'
  | 'aspectRatio'
  | 'targetEpisodes'
  | 'episodeDuration'
  | 'outline'
  | 'episodes'
  | 'episodeTitle'
  | 'episodeScript'
/** Values accepted by the corresponding editable project fields. */
export type StudioFieldValue = string | number | null | ProjectInput['episodes']

/** Saved creation-form revision; publishing it remains a separate human operation. */
export interface StudioCreationDraft {
  id: StudioCreationId
  revision: number
  input: ProjectInput
  updatedAt: string
}

/** Lightweight recovery-list metadata for a saved creation form. */
export interface StudioCreationSummary {
  id: StudioCreationId
  revision: number
  name: string
  updatedAt: string
}

/** An outdated creation save preserves both the stored and caller-owned input. */
export type StudioCreationSaveResult = { status: 'saved' | 'conflict'; draft: StudioCreationDraft }

/** User-owned professional configuration; null model fields select the deployment route once per workspace. */
export interface StudioRoleConfig {
  persona: string
  provider: string | null
  model: string | null
  maxTokens: number
  maxSteps: number
  timeoutMs: number
  skills: string[]
  tools: string[]
}

/** An immutable published role configuration. */
export interface StudioRoleRevision {
  role: StudioRoleId
  revision: number
  config: StudioRoleConfig
  createdAt: string
}

/** Provider route and adapter-owned reasoning effort selected for a task. */
export interface StudioModelSelection {
  provider: string
  model: string
  reasoningEffort?: string | undefined
}

/** Effective dependencies frozen before execution. */
export interface StudioResolvedRole extends StudioModelSelection {
  skills: Array<{ name: string; content: string }>
  tools: string[]
}

/** One role/configuration/target binding, retained across page changes and restarts. */
export interface StudioWorkspace {
  id: StudioWorkspaceId
  target: StudioTarget
  role: StudioRoleRevision
  sessionId: SessionId
  resolved: StudioResolvedRole | null
  initialized: boolean
  createdAt: string
}

/** Caller input is frozen together with its saved-project revision; local unsaved fields are explicit. */
export interface StudioTaskRequest {
  workspaceId: StudioWorkspaceId
  requestId: StudioRequestId
  expectedRevision: number | null
  input: ProjectInput
  prompt: string
  modelSelection?: StudioModelSelection | undefined
}

/** Durable execution record; a process restart interrupts unfinished work rather than silently repeating it. */
export interface StudioTask {
  id: StudioTaskId
  workspaceId: StudioWorkspaceId
  requestId: StudioRequestId
  target: StudioTarget
  role: StudioRoleRevision
  resolved: StudioResolvedRole
  sessionId: SessionId
  expectedRevision: number | null
  input: ProjectInput
  prompt: string
  modelSelection?: StudioModelSelection | undefined
  reviews: StudioReview[]
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  reply: string
  error: string | null
  createdAt: string
  finishedAt: string | null
}

/** Compact dialogue projection; frozen input and skill bodies remain in the host task record and Session log. */
export interface StudioTaskView {
  id: StudioTaskId
  workspaceId: StudioWorkspaceId
  requestId: StudioRequestId
  target: StudioTarget
  sessionId: SessionId
  role: StudioRoleId
  roleRevision: number
  provider: string
  model: string
  reasoningEffort?: string
  expectedRevision: number | null
  prompt: string
  status: StudioTask['status']
  reply: string
  error: string | null
  createdAt: string
  finishedAt: string | null
}

/** A model may propose only target-owned fields; the host supplies each before-value. */
export interface StudioAssistantResult {
  reply: string
  changes: Array<{ field: StudioField; value: StudioFieldValue }>
}

/** A proposal retains immutable comparisons even after some fields have been accepted. */
export interface StudioProposal {
  id: StudioProposalId
  taskId: StudioTaskId
  workspaceId: StudioWorkspaceId
  target: StudioTarget
  expectedRevision: number | null
  changes: Array<{ field: StudioField; before: StudioFieldValue; after: StudioFieldValue }>
  applied: StudioField[]
  ignored: StudioField[]
  createdAt: string
}

/** Human application validates both the current saved revision and pending local edits. */
export interface StudioApplyRequest {
  proposalId: StudioProposalId
  expectedRevision: number | null
  input: ProjectInput
  fields: StudioField[]
}

/** Rejected application never changes the caller's draft or durable project. */
export type StudioApplyResult =
  | { status: 'applied'; input: ProjectInput; project: Project | null; creation: StudioCreationDraft | null; proposal: StudioProposal }
  | { status: 'conflict' | 'locked' | 'archived'; fields: StudioField[]; project: Project | null; creation: StudioCreationDraft | null }

/** Human-only review of one target at one immutable project revision. */
export interface StudioReview {
  id: StudioReviewId
  target: Exclude<StudioTarget, { kind: 'creation' }>
  projectRevision: number
  status: 'pending' | 'approved' | 'returned'
  comment: string
  createdAt: string
  decidedAt: string | null
}

/** Workspace content returned to the unified professional dialogue panel. */
export interface StudioWorkspaceView {
  workspace: StudioWorkspace
  tasks: StudioTaskView[]
  proposals: StudioProposal[]
  lockedFields: StudioField[]
  allowedFields: StudioField[]
  creation: StudioCreationDraft | null
  versions: Array<{ id: StudioWorkspaceId; roleRevision: number; running: boolean }>
}

/** Trusted execution provider; professional models never receive these host callbacks. */
export interface StudioAssistantBackend {
  /** Mount project-owned Session storage without creating or driving an Agent. */
  openProject?(this: void, root: string, check: () => void): void
  /** Copy complete legacy histories before the destination project registers its routes. */
  copySessions?(this: void, ids: SessionId[], root: string, check: () => void): Promise<void>
  /** Drain and release every runtime resource under this project directory. */
  closeProject?(this: void, root: string): Promise<void>
  /** Read actual registered skill/tool choices without invoking a model. */
  catalog(this: void): Promise<StudioAssistantCatalog>
  /** Resolve actual model, skill bodies, and controlled tool selections before persisting a task. */
  resolve(this: void, role: StudioRoleRevision, selection?: StudioModelSelection): Promise<StudioResolvedRole>
  /** Execute the frozen task and return only a logged response or proposal. */
  execute(this: void, task: StudioTask): Promise<StudioAssistantResult>
  /** Request cancellation and wait until the owned task has settled. */
  cancel(this: void, taskId: StudioTaskId): Promise<void>
}

/** Available, host-registered dependencies; an empty list never implies a configured provider. */
export interface StudioAssistantCatalog {
  backendAvailable: boolean
  enabledRoles: StudioRoleId[]
  defaultModel: StudioModelSelection | null
  skills: Array<{ name: string; description: string }>
  tools: Array<{ name: string; description: string; source: 'builtin' | 'mcp' }>
}
