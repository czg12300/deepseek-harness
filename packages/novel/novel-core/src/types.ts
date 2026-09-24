/** Browser-safe novel project, document, and assistant task records. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Permanent novel identity, independent of its directory or title. */
export type NovelId = Branded<'NovelId'>
/** Permanent document identity within one novel. */
export type NovelDocumentId = Branded<'NovelDocumentId'>
/** Caller-generated identity used to deduplicate one operation. */
export type NovelRequestId = Branded<'NovelRequestId'>
/** Durable assistant task identity. */
export type NovelTaskId = Branded<'NovelTaskId'>
/** Immutable proposed edit identity. */
export type NovelProposalId = Branded<'NovelProposalId'>
/** Authoring documents share the same versioned text editor. */
export type NovelDocumentKind = 'chapter' | 'outline' | 'character' | 'setting'

/** Editable project metadata; changing the title never moves its directory. */
export interface NovelInfo {
  title: string
  synopsis: string
}
/** Three-field creation form and its retry identity. */
export interface NovelCreate extends NovelInfo {
  parentDirectory: string
  requestId: NovelRequestId
}
/** List metadata does not include manuscript bodies. */
export interface NovelProject extends NovelInfo {
  id: NovelId
  directory: string
  revision: number
  chapterCount: number
  createdAt: string
  updatedAt: string
}
/** Document metadata and its saved text revision. */
export interface NovelDocument {
  id: NovelDocumentId
  novelId: NovelId
  kind: NovelDocumentKind
  title: string
  position: number
  revision: number
  content: string
  updatedAt: string
}
/** A historical text version remains immutable after creation. */
export interface NovelRevision {
  documentId: NovelDocumentId
  revision: number
  title: string
  content: string
  source: 'manual' | 'assistant' | 'restore'
  createdAt: string
}
/** Explicit optimistic concurrency result; conflicts retain the submitted local draft. */
export interface NovelSaveResult {
  status: 'saved' | 'conflict'
  document: NovelDocument
}
/** One bounded read-only reference captured before a model request. */
export interface NovelReference {
  documentId: NovelDocumentId
  title: string
  revision: number
  content: string
}
/** Host-generated edit range in the exact UTF-16 base text. */
export interface NovelSpan {
  id: string
  start: number
  end: number
  text: string
}
/** Selection offsets refer to the request's saved document version. */
export interface NovelSelection {
  start: number
  end: number
}
/** A task's target does not change when the browser navigates. */
export interface NovelTask {
  project: NovelInfo
  id: NovelTaskId
  novelId: NovelId
  documentId: NovelDocumentId
  sessionId: SessionId
  requestId: NovelRequestId
  baseRevision: number
  prompt: string
  title: string
  content: string
  spans: NovelSpan[]
  references: NovelReference[]
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  reply: string
  error: string | null
  createdAt: string
  finishedAt: string | null
}
/** Model output only names host-issued spans, never paths or unchecked offsets. */
export interface NovelAssistantResult {
  reply: string
  replacements: { spanId: string; replacement: string }[]
}
/** An immutable before/after comparison awaiting an explicit human decision. */
export interface NovelProposal {
  id: NovelProposalId
  taskId: NovelTaskId
  documentId: NovelDocumentId
  baseRevision: number
  changes: { start: number; end: number; before: string; after: string }[]
  status: 'pending' | 'applied' | 'discarded'
  appliedRevision: number | null
}
/** Saved task history and its related proposals for one document. */
export interface NovelConversation {
  sessionId: SessionId
  tasks: NovelTask[]
  proposals: NovelProposal[]
}
/** A dispatch captures the saved version, optional selection, and user intent. */
export interface NovelSend {
  novelId: NovelId
  documentId: NovelDocumentId
  requestId: NovelRequestId
  expectedRevision: number
  prompt: string
  selection: NovelSelection | null
}
/** Host execution plugin owns model work; project storage owns all mutations. */
export interface NovelAssistantBackend {
  /**
   * Run one captured task; resolve only after model and tool work have settled.
   * @param task - immutable persisted task input.
   * @returns validated later by the project service before proposal publication.
   */
  execute(task: NovelTask): Promise<NovelAssistantResult>
  /**
   * Stop one task and await its quiescence.
   * @param id - task returned by dispatch.
   */
  cancel(id: NovelTaskId): Promise<void>
}
/** Session storage routes include removed list entries so history remains addressable. */
export interface NovelSessionRoute {
  novelId: NovelId
  directory: string
  sessionId: SessionId
}
