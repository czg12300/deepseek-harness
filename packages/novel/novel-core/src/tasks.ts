/** Captured assistant tasks and validated proposals; no model response writes manuscript text. */
import { randomUUID } from 'node:crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { transaction } from './database.ts'
import { json, type NovelProjectStore } from './project.ts'
import { assistantResultSchema, proposalSchema, taskSchema } from './validation.ts'
import type {
  NovelAssistantResult,
  NovelConversation,
  NovelDocumentId,
  NovelProposal,
  NovelProposalId,
  NovelReference,
  NovelSend,
  NovelSpan,
  NovelTask,
  NovelTaskId,
} from './types.ts'

/** Capture configuration is resolved before entering the task store. */
export interface TaskLimits {
  maxDocumentChars: number
  maxContextChars: number
  maxReferences: number
}

/** Task and conversation records share the novel's transaction owner. */
export class NovelTasks {
  /**
   * @param store - selected novel database.
   * @param limits - validated capture budgets.
   */
  constructor(
    private readonly store: NovelProjectStore,
    private readonly limits: TaskLimits,
  ) {}

  /** Reserve a document conversation and read its durable task history.
 * @param documentId - document owned by this novel.
   * @returns a durable conversation without creating an Agent.
 */
  conversation(documentId: NovelDocumentId): NovelConversation {
    return transaction(this.store.db, () => {
      this.store.document(documentId)
      this.store.db
        .prepare('INSERT OR IGNORE INTO conversations(document_id,session_id) VALUES(?,?)')
        .run(documentId, randomUUID())
      const sessionId = this.store.db
        .prepare('SELECT session_id FROM conversations WHERE document_id=?')
        .get(documentId)?.session_id
      if (typeof sessionId !== 'string') throw new Error('Novel conversation has no Session identity')
      this.recover(documentId)
      return {
        sessionId: sessionId as SessionId,
        tasks: this.store.db
          .prepare('SELECT data FROM tasks WHERE document_id=? ORDER BY rowid')
          .all(documentId)
          .map(row => taskSchema.parse(json(row.data))),
        proposals: this.store.db
          .prepare(
            'SELECT p.data FROM proposals p JOIN tasks t ON t.id=p.task_id WHERE t.document_id=? ORDER BY p.rowid',
          )
          .all(documentId)
          .map(row => proposalSchema.parse(json(row.data))),
      }
    })
  }

  /** Capture the saved document and allowed edit spans before dispatch.
 * @param request - validated user intent and saved-document version.
   * @returns existing retry or new frozen task.
 */
  start(request: NovelSend): { task: NovelTask; created: boolean } {
    const conversation = this.conversation(request.documentId)
    return transaction(this.store.db, () => {
      const old = this.store.db.prepare('SELECT data,input FROM tasks WHERE request_id=?').get(request.requestId)
      if (old) {
        if (old.input !== JSON.stringify(request))
          throw new Error('Novel task request ID was reused with different input')
        return { task: taskSchema.parse(json(old.data)), created: false }
      }
      const document = this.store.document(request.documentId)
      if (document.revision !== request.expectedRevision)
        throw new Error('Novel document changed; save or refresh before sending')
      if (this.store.db.prepare("SELECT id FROM tasks WHERE document_id=? AND state='running'").get(document.id))
        throw new Error('This novel document already has a running assistant task')
      const selection = request.selection
      if (selection && (selection.end > document.content.length || selection.start >= selection.end))
        throw new Error('Selected text is outside the saved document')
      const spans: NovelSpan[] = selection
        ? [
          {
            id: 'selection',
            start: selection.start,
            end: selection.end,
            text: document.content.slice(selection.start, selection.end),
          },
        ]
        : [...document.content.matchAll(/(?:[^\n]|\n(?!\n))+/g)].map((match, index) => ({
          id: `paragraph-${index + 1}`,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        }))
      if (spans.length === 0) spans.push({ id: 'empty-document', start: 0, end: 0, text: '' })
      const references: NovelReference[] = []
      let remaining = this.limits.maxContextChars
      const metadata = this.store.documents()
      const previous = metadata.filter(d => d.kind === 'chapter' && d.position < document.position).at(-1)
      const candidates = [...(previous ? [previous] : []), ...metadata.filter(d => d.id !== document.id && d.kind !== 'chapter')]
      for (const meta of candidates) {
        if (references.length >= this.limits.maxReferences || remaining <= 0) break
        const source = this.store.document(meta.id)
        const content = source.content.slice(0, remaining)
        remaining -= content.length
        references.push({ documentId: source.id, revision: source.revision, title: source.title, content })
      }
      const project = this.store.get()
      const task: NovelTask = {
        project: { title: project.title, synopsis: project.synopsis },
        id: randomUUID() as NovelTaskId,
        novelId: document.novelId,
        documentId: document.id,
        sessionId: conversation.sessionId,
        requestId: request.requestId,
        baseRevision: document.revision,
        prompt: request.prompt,
        title: document.title,
        content: document.content,
        spans,
        references,
        status: 'running',
        reply: '',
        error: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      }
      this.store.db
        .prepare('INSERT INTO tasks(id,document_id,request_id,input,owner_pid,state,data) VALUES(?,?,?,?,?,?,?)')
        .run(
          task.id,
          document.id,
          request.requestId,
          JSON.stringify(request),
          process.pid,
          task.status,
          JSON.stringify(task),
        )
      return { task, created: true }
    })
  }

  /** Read the validated persisted task state.
 * @param id - persisted task.
   * @returns its validated current state.
 */
  get(id: NovelTaskId): NovelTask {
    const row = this.store.db.prepare('SELECT data FROM tasks WHERE id=?').get(id)
    if (!row) throw new Error('Unknown novel task')
    return taskSchema.parse(json(row.data))
  }

  /**
   * Persist only validated model output with Host-resolved, non-overlapping ranges.
   * @param id - running task.
   * @param output - untrusted model result.
   * @returns the completed task; no manuscript mutation occurs.
   */
  complete(id: NovelTaskId, output: NovelAssistantResult): NovelTask {
    const result = assistantResultSchema.parse(output)
    return transaction(this.store.db, () => {
      const task = this.get(id)
      if (task.status !== 'running') throw new Error('Novel task has already settled')
      if (result.reply.length > this.limits.maxDocumentChars)
        throw new Error('Novel assistant reply exceeds its size limit')
      const seen = new Set<string>()
      const changes = result.replacements
        .map((replacement) => {
          const span = task.spans.find(s => s.id === replacement.spanId)
          if (!span || seen.has(span.id)) throw new Error('Novel proposal names an unknown or duplicate span')
          seen.add(span.id)
          return { start: span.start, end: span.end, before: span.text, after: replacement.replacement }
        })
        .sort((a, b) => a.start - b.start)
      const size =
        task.content.length + changes.reduce((sum, change) => sum + change.after.length - change.before.length, 0)
      if (size > this.limits.maxDocumentChars) throw new Error('Proposed novel document exceeds its size limit')
      let priorEnd = -1
      for (const change of changes) {
        if (change.start < priorEnd) throw new Error('Novel proposal contains overlapping edits')
        priorEnd = change.end
      }
      if (changes.length) {
        const proposal: NovelProposal = {
          id: randomUUID() as NovelProposalId,
          taskId: id,
          documentId: task.documentId,
          baseRevision: task.baseRevision,
          changes,
          status: 'pending',
          appliedRevision: null,
        }
        this.store.db
          .prepare('INSERT INTO proposals(id,task_id,data) VALUES(?,?,?)')
          .run(proposal.id, id, JSON.stringify(proposal))
      }
      return this.settle(task, 'completed', result.reply, null)
    })
  }

  /** Settle an unfinished task without publishing a proposal.
 * @param id - running task.
   * @param status - terminal failure status.
   * @param message - safe error detail.
   * @returns persisted terminal task.
 */
  fail(id: NovelTaskId, status: 'failed' | 'cancelled', message: string): NovelTask {
    return transaction(this.store.db, () => {
      const task = this.get(id)
      return task.status === 'running' ? this.settle(task, status, '', message) : task
    })
  }

  private settle(task: NovelTask, status: NovelTask['status'], reply: string, error: string | null): NovelTask {
    const next = { ...task, status, reply, error, finishedAt: new Date().toISOString() }
    this.store.db.prepare('UPDATE tasks SET state=?,data=? WHERE id=?').run(status, JSON.stringify(next), task.id)
    return next
  }

  private recover(documentId: NovelDocumentId): void {
    for (const row of this.store.db
      .prepare("SELECT owner_pid,data FROM tasks WHERE document_id=? AND state='running'")
      .all(documentId)) {
      try {
        process.kill(Number(row.owner_pid), 0)
      } catch (error) {
        // ESRCH proves the recorded owner is gone; permission failures do not prove that.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        this.settle(
          taskSchema.parse(json(row.data)),
          'interrupted',
          '',
          'The assistant process stopped before completing this task',
        )
      }
    }
  }
}
